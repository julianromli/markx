import { createFileRoute } from "@tanstack/react-router"
import { eq } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import { userSubscriptions } from "@/lib/db/schema"
import {
  getMembershipMemberDetail,
  getTransaction,
  isPaidTransactionStatus,
} from "@/lib/mayar/client"
import { getMayarConfig } from "@/lib/mayar/env"
import {
  activateProForUser,
  claimProcessedTransaction,
  deactivateProForUser,
  findUserIdByMayarMemberId,
  findUserIdBySubscriptionEmail,
} from "@/lib/server/subscription.server"

interface WebhookPayload {
  event?: string
  type?: string
  data?: {
    id?: string
    customerEmail?: string
    customer?: { email?: string; id?: string }
    memberId?: string
    membershipMemberId?: string
  }
}

// TODO: ganti verify-by-fetch dengan signature verification saat Mayar merilis HMAC webhook.

const EXPIRE_EVENTS = new Set([
  "membership.memberExpired",
  "membership.memberUnsubscribed",
])

function customerEmailFromPayload(payload: WebhookPayload): string | null {
  const email =
    payload.data?.customerEmail ?? payload.data?.customer?.email ?? null
  return email?.trim() ? email.trim() : null
}

function memberIdFromPayload(payload: WebhookPayload): string | null {
  const id = payload.data?.memberId ?? payload.data?.membershipMemberId ?? null
  return id?.trim() ? id.trim() : null
}

async function resolveUserId(
  payload: WebhookPayload,
  fallbackEmail?: string | null
): Promise<string | null> {
  const memberId = memberIdFromPayload(payload)
  if (memberId) {
    const byMember = await findUserIdByMayarMemberId(memberId)
    if (byMember) return byMember
  }
  const email = fallbackEmail ?? customerEmailFromPayload(payload)
  if (email) return findUserIdBySubscriptionEmail(email)
  return null
}

export const Route = createFileRoute("/api/webhooks/mayar")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let payload: WebhookPayload
        try {
          payload = (await request.json()) as WebhookPayload
        } catch {
          return Response.json({ ok: false }, { status: 400 })
        }

        const event = payload.event ?? payload.type

        if (event && EXPIRE_EVENTS.has(event)) {
          const userId = await resolveUserId(payload)
          if (userId) {
            await deactivateProForUser(
              userId,
              event === "membership.memberExpired" ? "expired" : "unsubscribed"
            )
          }
          return Response.json({ ok: true })
        }

        if (event !== "payment.received") {
          return Response.json({ ok: true })
        }

        const txId = payload.data?.id
        if (!txId) {
          return Response.json({ ok: true })
        }

        let detail
        try {
          detail = await getTransaction(txId)
        } catch {
          return Response.json({ ok: true })
        }

        if (!isPaidTransactionStatus(detail.status)) {
          return Response.json({ ok: true })
        }

        const userId = await resolveUserId(payload, detail.customer.email)
        if (!userId) {
          return Response.json({ ok: true })
        }

        const claimed = await claimProcessedTransaction(txId, userId)
        if (!claimed) {
          return Response.json({ ok: true })
        }

        let periodEnd: Date | null = null
        let memberId: string | undefined =
          memberIdFromPayload(payload) ?? undefined
        try {
          const config = await getMayarConfig()
          if (!memberId) {
            const row = await withDb(async ({ db }) => {
              const rows = await db
                .select()
                .from(userSubscriptions)
                .where(eq(userSubscriptions.userId, userId))
                .limit(1)
              return rows[0]
            })
            memberId = row?.mayarMemberId ?? undefined
          }
          if (memberId) {
            const member = await getMembershipMemberDetail(
              memberId,
              config.productId
            )
            const end = member.expiredAt ?? member.nextPayment
            periodEnd = end ? new Date(end) : null
          }
        } catch {
          // Provisioning still proceeds without period metadata.
        }

        await activateProForUser(userId, {
          email: detail.customer.email,
          mayarMemberId: memberId,
          mayarCustomerId: detail.customer.id,
          currentPeriodEnd: periodEnd,
        })

        return Response.json({ ok: true })
      },
    },
  },
})
