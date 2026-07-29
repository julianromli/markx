import { eq } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import {
  mayarProcessedTransactions,
  userSubscriptions,
} from "@/lib/db/schema"
import {
  FREE_TIER_ENTITY_LIMIT,
  countMarkxEntities,
} from "@/lib/markx/entity-count"
import type { MarkxState } from "@/lib/markx/types"
import {
  createMembershipInvoice,
  findMemberIdByEmail,
  getMembershipMemberDetail,
  isActiveMembershipStatus,
  registerMembershipMember,
} from "@/lib/mayar/client"
import { getMayarConfig } from "@/lib/mayar/env"

export type UserEntitlements = {
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
  const entityCount =
    state != null ? countMarkxEntities(state) : null

  return withDb(async ({ db }) => {
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1)

    if (rows.length === 0) {
      return {
        plan: "free",
        status: "inactive",
        entityLimit: FREE_TIER_ENTITY_LIMIT,
        entityCount,
        currentPeriodEnd: null,
      }
    }

    const row = rows[0]
    const proActive = row.plan === "pro" && row.status === "active"
    return {
      plan: proActive ? "pro" : "free",
      status: row.status,
      entityLimit: proActive ? null : FREE_TIER_ENTITY_LIMIT,
      entityCount,
      currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
    }
  })
}

export function assertWorkspaceEntityLimit(
  entitlements: UserEntitlements,
  state: MarkxState
): { ok: true } | { ok: false; count: number; limit: number } {
  if (entitlements.plan === "pro") {
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
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: userSubscriptions.userId,
        set: {
          email,
          mayarMemberId: data.mayarMemberId,
          mayarCustomerId: data.mayarCustomerId,
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

export async function refreshSubscriptionFromMayar(
  userId: string
): Promise<UserEntitlements> {
  const config = await getMayarConfig()

  const row = await withDb(async ({ db }) => {
    const rows = await db
      .select()
      .from(userSubscriptions)
      .where(eq(userSubscriptions.userId, userId))
      .limit(1)
    return rows[0] ?? null
  })

  if (!row?.mayarMemberId) {
    return getEntitlementsForUser(userId)
  }

  const detail = await getMembershipMemberDetail(
    row.mayarMemberId,
    config.productId
  )

  const periodEnd = detail.expiredAt ?? detail.nextPayment
  const active = isActiveMembershipStatus(detail.status)

  await withDb(async ({ db }) => {
    await db
      .update(userSubscriptions)
      .set({
        plan: active ? "pro" : "free",
        status: detail.status,
        mayarCustomerId: detail.customerId,
        currentPeriodEnd: periodEnd ? new Date(periodEnd) : null,
        updatedAt: new Date(),
      })
      .where(eq(userSubscriptions.userId, userId))
  })

  return getEntitlementsForUser(userId)
}

function normalizeMobile(mobile: string): string {
  const digits = mobile.replace(/\D/g, "")
  if (digits.length >= 10 && digits.length <= 15) return digits
  throw new Error("Nomor HP harus 10–15 digit.")
}

export async function startMembershipCheckout(input: {
  userId: string
  email: string
  name: string
  mobile: string
}): Promise<{ checkoutUrl: string }> {
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
    if (!message.includes("Email sudah terdaftar")) {
      throw err
    }
    const existing = await findMemberIdByEmail(config.productId, input.email)
    if (!existing) {
      throw new Error(
        "Email sudah terdaftar di Mayar, tapi member tidak ditemukan. Hubungi support."
      )
    }
    memberId = existing
    const detail = await getMembershipMemberDetail(memberId, config.productId)
    customerId = detail.customerId
    memberStatus = detail.status
  }

  await upsertSubscriptionCheckout(input.userId, input.email, {
    mayarMemberId: memberId,
    mayarCustomerId: customerId,
    status: memberStatus,
  })

  const invoice = await createMembershipInvoice(memberId, config.productId)
  if (!invoice.membershipBillUrl) {
    throw new Error("Mayar tidak mengembalikan URL checkout.")
  }

  return { checkoutUrl: invoice.membershipBillUrl }
}
