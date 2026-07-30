import { eq } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import { mayarProcessedTransactions, userSubscriptions } from "@/lib/db/schema"
import {
  FREE_TIER_ENTITY_LIMIT,
  countMarkxEntities,
} from "@/lib/markx/entity-count"
import type { MarkxState } from "@/lib/markx/types"
import {
  createMembershipInvoice,
  findMemberIdByEmail,
  getMembershipMemberDetail,
  getTransaction,
  isActiveMembershipStatus,
  isPaidTransactionStatus,
  registerMembershipMember,
} from "@/lib/mayar/client"
import { getMayarConfig, isMayarBillingEnabled } from "@/lib/mayar/env"

/**
 * Minimum gap between Mayar re-checks per user on entitlement reads. Keeps
 * verify-on-read well under Mayar's 50 req/min rate limit even on busy pages.
 */
const MAYAR_RECHECK_INTERVAL_MS = 60_000

export type UserEntitlements = {
  /** False when `MAYAR_BILLING_ENABLED` is off — no limits / upgrade UI. */
  billingEnabled: boolean
  plan: "free" | "pro"
  status: string
  entityLimit: number | null
  entityCount: number | null
  currentPeriodEnd: string | null
}

export async function getEntitlementsForUser(
  userId: string,
  state?: MarkxState | null
): Promise<UserEntitlements> {
  const entityCount = state != null ? countMarkxEntities(state) : null
  const billingEnabled = await isMayarBillingEnabled()

  const row = await withDb(async ({ db }) => {
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1)
    return rows.at(0) ?? null
  })

  // Verify-on-read (no webhooks): a paid Mayar transaction is the only proof
  // of Pro. Re-check at most once per MAYAR_RECHECK_INTERVAL_MS per user.
  if (billingEnabled && row && isRecheckDue(row.mayarCheckedAt)) {
    try {
      if (row.plan !== "pro" && row.mayarTransactionId) {
        const activated = await activateIfTransactionPaid(userId, row)
        if (activated) return getEntitlementsForUser(userId, state)
      } else if (
        row.plan === "pro" &&
        row.currentPeriodEnd != null &&
        row.currentPeriodEnd.getTime() < Date.now()
      ) {
        // Past period end: confirm the member is still active (or downgrade).
        return refreshSubscriptionFromMayar(userId)
      }
    } catch {
      // Mayar unreachable — serve the current row as-is.
    }
  }

  if (!row) {
    return {
      billingEnabled,
      plan: "free",
      status: "inactive",
      // No free-tier cap while billing is feature-flagged off.
      entityLimit: billingEnabled ? FREE_TIER_ENTITY_LIMIT : null,
      entityCount,
      currentPeriodEnd: null,
    }
  }

  const proActive = row.plan === "pro" && row.status === "active"
  return {
    billingEnabled,
    plan: proActive ? "pro" : "free",
    status: row.status,
    entityLimit: !billingEnabled || proActive ? null : FREE_TIER_ENTITY_LIMIT,
    entityCount,
    currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
  }
}

function isRecheckDue(mayarCheckedAt: Date | null): boolean {
  return (
    mayarCheckedAt == null ||
    Date.now() - mayarCheckedAt.getTime() > MAYAR_RECHECK_INTERVAL_MS
  )
}

/**
 * API-only Pro activation: re-fetch the checkout transaction and activate
 * when Mayar confirms it paid. Idempotent — the activation upsert and the
 * processed-transaction claim make repeats safe. Always stamps
 * `mayar_checked_at` so failures don't hammer the API.
 */
async function activateIfTransactionPaid(
  userId: string,
  row: {
    mayarMemberId: string | null
    mayarTransactionId: string | null
  }
): Promise<boolean> {
  const txId = row.mayarTransactionId
  if (!txId) return false

  try {
    const detail = await getTransaction(txId)
    if (!isPaidTransactionStatus(detail.status)) return false

    await claimProcessedTransaction(txId, userId)

    const config = await getMayarConfig()
    let periodEnd: Date | null = null
    if (row.mayarMemberId) {
      try {
        const member = await getMembershipMemberDetail(
          row.mayarMemberId,
          config.productId
        )
        const end = member.expiredAt ?? member.nextPayment
        periodEnd = end ? new Date(end) : null
      } catch {
        // Provisioning still proceeds without period metadata.
      }
    }

    await activateProForUser(userId, {
      email: detail.customer.email,
      mayarMemberId: row.mayarMemberId ?? undefined,
      mayarCustomerId: detail.customer.id,
      currentPeriodEnd: periodEnd,
    })
    return true
  } finally {
    await withDb(async ({ db }) => {
      await db
        .update(userSubscriptions)
        .set({ mayarCheckedAt: new Date() })
        .where(eq(userSubscriptions.userId, userId))
    })
  }
}

export function assertWorkspaceEntityLimit(
  entitlements: UserEntitlements,
  state: MarkxState
): { ok: true } | { ok: false; count: number; limit: number } {
  if (!entitlements.billingEnabled || entitlements.plan === "pro") {
    return { ok: true }
  }
  const count = countMarkxEntities(state)
  if (count > FREE_TIER_ENTITY_LIMIT) {
    return { ok: false, count, limit: FREE_TIER_ENTITY_LIMIT }
  }
  return { ok: true }
}

export async function upsertSubscriptionCheckout(
  userId: string,
  email: string,
  data: {
    mayarMemberId: string
    mayarCustomerId: string
    mayarTransactionId: string | null
    status: string
  }
): Promise<void> {
  await withDb(async ({ db }) => {
    await db
      .insert(userSubscriptions)
      .values({
        userId,
        email,
        plan: "free",
        status: data.status,
        mayarMemberId: data.mayarMemberId,
        mayarCustomerId: data.mayarCustomerId,
        mayarTransactionId: data.mayarTransactionId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSubscriptions.userId,
        set: {
          email,
          mayarMemberId: data.mayarMemberId,
          mayarCustomerId: data.mayarCustomerId,
          mayarTransactionId: data.mayarTransactionId,
          status: data.status,
          updatedAt: new Date(),
        },
      })
  })
}

export async function activateProForUser(
  userId: string,
  input: {
    email?: string
    mayarMemberId?: string
    mayarCustomerId?: string
    currentPeriodEnd?: Date | null
  }
): Promise<void> {
  await withDb(async ({ db }) => {
    const email = input.email?.trim()
    if (email) {
      await db
        .insert(userSubscriptions)
        .values({
          userId,
          email,
          plan: "pro",
          status: "active",
          mayarMemberId: input.mayarMemberId,
          mayarCustomerId: input.mayarCustomerId,
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userSubscriptions.userId,
          set: {
            plan: "pro",
            status: "active",
            email,
            mayarMemberId: input.mayarMemberId,
            mayarCustomerId: input.mayarCustomerId,
            currentPeriodEnd: input.currentPeriodEnd ?? null,
            updatedAt: new Date(),
          },
        })
      return
    }

    await db
      .update(userSubscriptions)
      .set({
        plan: "pro",
        status: "active",
        mayarMemberId: input.mayarMemberId,
        mayarCustomerId: input.mayarCustomerId,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.userId, userId))
  })
}

export async function findUserIdBySubscriptionEmail(
  email: string
): Promise<string | null> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  return withDb(async ({ db }) => {
    const rows = await db.select().from(userSubscriptions)
    for (const row of rows) {
      if (row.email.trim().toLowerCase() === normalized) {
        return row.userId
      }
    }
    return null
  })
}

export async function findUserIdByMayarMemberId(
  memberId: string
): Promise<string | null> {
  const id = memberId.trim()
  if (!id) return null
  return withDb(async ({ db }) => {
    const rows = await db
      .select({ userId: userSubscriptions.userId })
      .from(userSubscriptions)
      .where(eq(userSubscriptions.mayarMemberId, id))
      .limit(1)
    return rows[0]?.userId ?? null
  })
}

/** Returns false when this transaction was already processed. */
export async function claimProcessedTransaction(
  transactionId: string,
  userId: string | null
): Promise<boolean> {
  return withDb(async ({ db }) => {
    const inserted = await db
      .insert(mayarProcessedTransactions)
      .values({ transactionId, userId })
      .onConflictDoNothing()
      .returning({ transactionId: mayarProcessedTransactions.transactionId })

    return inserted.length > 0
  })
}

/**
 * Re-sync membership metadata from Mayar.
 *
 * Important: Mayar marks members `active` at registration, before payment.
 * This function therefore never upgrades free → pro. Pro is granted only via
 * payment webhook after GET /transactions proves paid. It may downgrade pro
 * when Mayar reports inactive/expired/stopped.
 */
export async function refreshSubscriptionFromMayar(
  userId: string
): Promise<UserEntitlements> {
  const [config, row] = await Promise.all([
    getMayarConfig(),
    withDb(async ({ db }) => {
      const rows = await db
        .select()
        .from(userSubscriptions)
        .where(eq(userSubscriptions.userId, userId))
        .limit(1)
      return rows.at(0) ?? null
    }),
  ])

  if (!row) {
    return getEntitlementsForUser(userId)
  }

  // Forced (unthrottled) paid check — the success page polls this right after
  // checkout, so activate as soon as Mayar confirms payment.
  if (row.plan !== "pro" && row.mayarTransactionId) {
    try {
      const activated = await activateIfTransactionPaid(userId, row)
      if (activated) {
        return getEntitlementsForUser(userId)
      }
    } catch {
      // Fall through to the member-status refresh below.
    }
  }

  if (!row.mayarMemberId) {
    return getEntitlementsForUser(userId)
  }

  const detail = await getMembershipMemberDetail(
    row.mayarMemberId,
    config.productId
  )

  const periodEnd = detail.expiredAt ?? detail.nextPayment
  const memberActive = isActiveMembershipStatus(detail.status)
  // plan=pro is only set by paid webhook — never infer from Mayar member status.
  const alreadyPro = row.plan === "pro"

  let nextPlan: "free" | "pro" = "free"
  let nextStatus = row.status
  let nextPeriodEnd = row.currentPeriodEnd

  if (alreadyPro && memberActive) {
    nextPlan = "pro"
    nextStatus = "active"
    nextPeriodEnd = periodEnd ? new Date(periodEnd) : row.currentPeriodEnd
  } else if (alreadyPro && !memberActive) {
    nextPlan = "free"
    nextStatus = detail.status || "inactive"
    nextPeriodEnd = periodEnd ? new Date(periodEnd) : row.currentPeriodEnd
  }
  // else: stay free; do not copy Mayar's pre-payment "active" into plan

  await withDb(async ({ db }) => {
    await db
      .update(userSubscriptions)
      .set({
        plan: nextPlan,
        status: nextStatus,
        mayarCustomerId: detail.customerId,
        currentPeriodEnd: nextPeriodEnd,
        mayarCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.userId, userId))
  })

  return getEntitlementsForUser(userId)
}

function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "")
  if (digits.length >= 10 && digits.length <= 15) return digits
  throw new Error("Mobile number must be 10–15 digits.")
}

export async function startMembershipCheckout(input: {
  userId: string
  email: string
  name: string
  mobile: string
}): Promise<{ checkoutUrl: string }> {
  if (!(await isMayarBillingEnabled())) {
    throw new Error("Billing is not enabled yet.")
  }

  const config = await getMayarConfig()
  const mobile = normalizeMobile(input.mobile)
  const customerName =
    input.name.trim() || input.email.split("@")[0] || "Markx User"

  let memberId: string
  let customerId: string
  let memberStatus: string

  try {
    const registered = await registerMembershipMember({
      productId: config.productId,
      membershipTierId: config.tierId,
      customerInfo: {
        name: customerName,
        email: input.email,
        mobile,
      },
    })
    memberId = registered.memberId
    customerId = registered.customerId
    memberStatus = registered.status
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Mayar's own duplicate-email error message is Indonesian — match it as-is.
    if (!message.includes("Email sudah terdaftar")) {
      throw err
    }
    const existing = await findMemberIdByEmail(config.productId, input.email)
    if (!existing) {
      throw new Error(
        "Email is already registered with Mayar, but the member was not found. Contact support."
      )
    }
    memberId = existing
    const detail = await getMembershipMemberDetail(memberId, config.productId)
    customerId = detail.customerId
    memberStatus = detail.status
  }

  const invoice = await createMembershipInvoice(memberId, config.productId)
  if (!invoice.membershipBillUrl) {
    throw new Error("Mayar did not return a checkout URL.")
  }

  // Store the current-term transaction: verify-on-read uses it as the paid
  // proof (no webhook involved).
  await upsertSubscriptionCheckout(input.userId, input.email, {
    mayarMemberId: memberId,
    mayarCustomerId: customerId,
    mayarTransactionId: invoice.transactionId ?? null,
    status: memberStatus,
  })

  return { checkoutUrl: invoice.membershipBillUrl }
}
