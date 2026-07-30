import { eq } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import { mayarProcessedTransactions, userSubscriptions } from "@/lib/db/schema"
import {
  FREE_TIER_ENTITY_LIMIT,
  countMarkxEntities,
} from "@/lib/markx/entity-count"
import type { MarkxState } from "@/lib/markx/types"
import {
  createQrisInvoice,
  getTransaction,
  isPaidTransactionStatus,
} from "@/lib/mayar/client"
import { getMayarConfig, isMayarBillingEnabled } from "@/lib/mayar/env"

/**
 * Minimum gap between Mayar re-checks per user on entitlement reads. Keeps
 * verify-on-read well under Mayar's 50 req/min rate limit even on busy pages.
 */
const MAYAR_RECHECK_INTERVAL_MS = 60_000

/** Pro period granted per paid invoice. Renewal is manual, once per period. */
const PRO_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

export type UserEntitlements = {
  /** False when `MAYAR_BILLING_ENABLED` is off — no limits / upgrade UI. */
  billingEnabled: boolean
  plan: "free" | "pro"
  status: string
  entityLimit: number | null
  entityCount: number | null
  currentPeriodEnd: string | null
}

export type ProCheckoutSession = {
  transactionId: string
  /** Raw QRIS payload — rendered as a QR image by the client. */
  qrString: string
  amount: number
  invoiceCode: string | null
  /** ISO 8601; the QR dies at this time and must be regenerated. */
  expiredAt: string | null
}

function isExpiredPro(row: {
  plan: string
  currentPeriodEnd: Date | null
}): boolean {
  return (
    row.plan === "pro" &&
    row.currentPeriodEnd != null &&
    row.currentPeriodEnd.getTime() < Date.now()
  )
}

function isRecheckDue(mayarCheckedAt: Date | null): boolean {
  return (
    mayarCheckedAt == null ||
    Date.now() - mayarCheckedAt.getTime() > MAYAR_RECHECK_INTERVAL_MS
  )
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
      } else if (isExpiredPro(row)) {
        await downgradeExpiredPro(userId)
        return getEntitlementsForUser(userId, state)
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

/**
 * API-only Pro activation: re-fetch the checkout transaction and activate
 * when Mayar confirms it paid. Idempotent — the activation upsert and the
 * processed-transaction claim make repeats safe. Always stamps
 * `mayar_checked_at` so failures don't hammer the API.
 */
async function activateIfTransactionPaid(
  userId: string,
  row: { mayarTransactionId: string | null }
): Promise<boolean> {
  const txId = row.mayarTransactionId
  if (!txId) return false

  try {
    const detail = await getTransaction(txId)
    if (!isPaidTransactionStatus(detail.status)) return false

    await claimProcessedTransaction(txId, userId)

    await activateProForUser(userId, {
      email: detail.customer.email,
      currentPeriodEnd: new Date(Date.now() + PRO_PERIOD_MS),
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

/** Lazy expiry: period over and no newer paid invoice → back to free. */
async function downgradeExpiredPro(userId: string): Promise<void> {
  await withDb(async ({ db }) => {
    await db
      .update(userSubscriptions)
      .set({
        plan: "free",
        status: "expired",
        mayarCheckedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.userId, userId))
  })
}

export async function upsertSubscriptionCheckout(
  userId: string,
  email: string,
  data: {
    mayarTransactionId: string | null
    status: string
  }
): Promise<void> {
  await withDb(async ({ db }) => {
    const existing = (
      await db
        .select()
        .from(userSubscriptions)
        .where(eq(userSubscriptions.userId, userId))
        .limit(1)
    ).at(0)
    // A pro renewing keeps their active status until the new term is paid;
    // only the insert path and free users take the invoice's status.
    const status = existing?.plan === "pro" ? existing.status : data.status
    await db
      .insert(userSubscriptions)
      .values({
        userId,
        email,
        plan: "free",
        status,
        mayarTransactionId: data.mayarTransactionId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSubscriptions.userId,
        set: {
          email,
          status,
          mayarTransactionId: data.mayarTransactionId,
          // New transaction — allow an immediate paid re-check on next read.
          mayarCheckedAt: null,
          updatedAt: new Date(),
        },
      })
  })
}

export async function activateProForUser(
  userId: string,
  input: {
    email?: string
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
          currentPeriodEnd: input.currentPeriodEnd ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userSubscriptions.userId,
          set: {
            plan: "pro",
            status: "active",
            email,
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
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.userId, userId))
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
 * Forced (unthrottled) entitlement refresh — the success page polls this
 * right after checkout, so Pro activates as soon as Mayar confirms payment.
 * Also resolves lazy expiry for pro users past their period end.
 */
export async function refreshSubscriptionFromMayar(
  userId: string
): Promise<UserEntitlements> {
  const row = await withDb(async ({ db }) => {
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1)
    return rows.at(0) ?? null
  })

  if (!row) {
    return getEntitlementsForUser(userId)
  }

  if (row.plan !== "pro" && row.mayarTransactionId) {
    try {
      const activated = await activateIfTransactionPaid(userId, row)
      if (activated) {
        return getEntitlementsForUser(userId)
      }
    } catch {
      // Fall through — serve the current state.
    }
  }

  if (isExpiredPro(row)) {
    await downgradeExpiredPro(userId)
  }

  return getEntitlementsForUser(userId)
}

function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "")
  if (digits.length >= 10 && digits.length <= 15) return digits
  throw new Error("Mobile number must be 10–15 digits.")
}

/**
 * Starts a Pro checkout: creates a QRIS-only invoice at Mayar and stores the
 * transaction as the paid-proof for verify-on-read. The app renders the QR
 * itself — the user never sees a Mayar hosted page.
 */
export async function startProCheckout(input: {
  userId: string
  email: string
  name: string
  mobile: string
}): Promise<ProCheckoutSession> {
  if (!(await isMayarBillingEnabled())) {
    throw new Error("Billing is not enabled yet.")
  }

  const config = await getMayarConfig()
  const mobile = normalizeMobile(input.mobile)
  const customerName =
    input.name.trim() || input.email.split("@")[0] || "Markx User"

  const invoice = await createQrisInvoice({
    name: customerName,
    email: input.email,
    mobile,
    userId: input.userId,
    priceIdr: config.proPriceIdr,
  })

  const qrString = invoice.paymentDetail?.qr_code?.channel_properties?.qr_string
  if (!qrString || !invoice.transactionId) {
    throw new Error("Mayar did not return a QRIS code.")
  }

  await upsertSubscriptionCheckout(input.userId, input.email, {
    mayarTransactionId: invoice.transactionId,
    status: invoice.status,
  })

  return {
    transactionId: invoice.transactionId,
    qrString,
    amount: invoice.amount,
    invoiceCode: invoice.invoiceCode ?? null,
    expiredAt: invoice.expiredAt ?? null,
  }
}
