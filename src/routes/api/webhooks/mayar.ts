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
  findUserIdBySubscriptionEmail,
} from "@/lib/server/subscription.server"

interface WebhookPayload {
  event?: string
  type?: string
  data?: { id?: string }
}

// TODO: ganti verify-by-fetch dengan signature verification saat Mayar merilis HMAC webhook.

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
        const txId = payload.data?.id
        if (event !== "payment.received" || !txId) {
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

        const userId = await findUserIdBySubscriptionEmail(detail.customer.email)
        if (!userId) {
          return Response.json({ ok: true })
        }

        const claimed = await claimProcessedTransaction(txId, userId)
        if (!claimed) {
          return Response.json({ ok: true })
        }

        let periodEnd: Date | null = null
        let memberId: string | undefined
        try {
          const config = await getMayarConfig()
          const row = await withDb(async ({ db }) => {
            const rows = await db
              .select()
              .from(userSubscriptions)
              .where(eq(userSubscriptions.userId, userId))
              .limit(1)
            return rows[0]
          })
          memberId = row?.mayarMemberId ?? undefined
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
