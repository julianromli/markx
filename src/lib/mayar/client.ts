import type { MayarConfig } from "@/lib/mayar/env"
import { getMayarConfig } from "@/lib/mayar/env"

type MayarEnvelope<T> = {
  statusCode?: number
  messages?: string
  message?: string
  data?: T
}

async function mayarFetchRaw<T>(
  config: MayarConfig,
  path: string,
  init?: RequestInit
): Promise<
  MayarEnvelope<T> & { hasMore?: boolean; nextStartingAfter?: string }
> {
  const res = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })

  if (!res.ok) {
    let detail = String(res.status)
    try {
      const errBody: MayarEnvelope<unknown> = await res.json()
      detail = errBody.messages ?? errBody.message ?? detail
    } catch {
      // non-JSON error body
    }
    throw new Error(`Mayar ${path} failed: ${detail}`)
  }

  // Mayar write endpoints may still use HTTP 200 with statusCode >= 400 in body.
  const body: MayarEnvelope<T> & {
    hasMore?: boolean
    nextStartingAfter?: string
  } = await res.json()
  const msg = body.messages ?? body.message
  const statusCode = body.statusCode ?? res.status
  if (statusCode >= 400) {
    throw new Error(`Mayar ${path} failed: ${msg ?? statusCode}`)
  }
  return body
}

async function mayarFetch<T>(
  config: MayarConfig,
  path: string,
  init?: RequestInit
): Promise<T> {
  const body = await mayarFetchRaw<T>(config, path, init)
  return body.data as T
}

export type QrisInvoiceResult = {
  id: string
  transactionId: string
  amount: number
  status: string
  invoiceCode?: string
  /** ISO 8601; the QR string dies with the invoice. */
  expiredAt?: string
  paymentDetail?: {
    qr_code?: {
      channel_properties?: { qr_string?: string; expires_at?: string }
    }
  }
}

export type TransactionDetail = {
  id: string
  status: string
  amount: number
  customer: { id: string; email: string; name: string }
  paymentLink?: { id: string; type: string }
}

/**
 * Creates a QRIS-only invoice and returns the raw QR string so the app can
 * render its own checkout UI (no Mayar hosted page). `extraData.userId` ties
 * the payment back to the workspace owner for reconciliation.
 */
export async function createQrisInvoice(input: {
  name: string
  email: string
  mobile: string
  userId: string
  priceIdr: number
  /** Mayar-managed discount code applied to the rate; recorded for audit. */
  couponCode?: string | null
}): Promise<QrisInvoiceResult> {
  const config = await getMayarConfig()
  return mayarFetch<QrisInvoiceResult>(config, "/invoices/create", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      email: input.email,
      mobile: input.mobile,
      description: "Markx Pro — 1 month",
      items: [
        {
          quantity: 1,
          rate: input.priceIdr,
          description: "Markx Pro — 1 month",
        },
      ],
      paymentMethod: "qris",
      extraData: {
        userId: input.userId,
        ...(input.couponCode ? { couponCode: input.couponCode } : {}),
      },
    }),
  })
}

export async function getTransaction(id: string): Promise<TransactionDetail> {
  const config = await getMayarConfig()
  return mayarFetch<TransactionDetail>(
    config,
    `/transactions/${encodeURIComponent(id)}`
  )
}

export function isPaidTransactionStatus(status: string): boolean {
  return ["paid", "success", "settled"].includes(status.toLowerCase())
}

export type MayarCoupon = {
  code: string
  /** "reusable" | "onetime" */
  type: string | null
  isActive: boolean
  limit: number | null
  usageCount: number | null
  /** Epoch ms, normalized from either ISO strings or numbers. */
  expiredAt: number | null
  /** "monetary" | "percentage" */
  discountType: string
  discountValue: number
  minimumPurchase: number | null
}

type CouponCampaign = {
  status?: string
  discountType?: string
  discountValue?: number
  /** Discount-detail shape calls the same field `value`. */
  value?: number
  minimumPurchase?: number | null
  expiredAt?: number | string | null
  coupons?: Array<{
    code?: string
    type?: string
    isActive?: boolean
    limit?: number | null
    usageCount?: number | null
    expiredAt?: number | string | null
  }>
}

function toEpochMs(value: number | string | null | undefined): number | null {
  if (value == null) return null
  if (typeof value === "number") return value
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Finds an active coupon campaign by code, walking the paginated campaign
 * list (there is no lookup-by-code endpoint). The app's discount codes are
 * managed in the Mayar dashboard; redemption is not tracked.
 */
export async function findCouponByCode(
  code: string
): Promise<MayarCoupon | null> {
  const wanted = code.trim().toLowerCase()
  if (!wanted) return null

  const config = await getMayarConfig()
  let startingAfter: string | undefined
  for (let page = 0; page < 10; page += 1) {
    const params = new URLSearchParams({ limit: "50", status: "active" })
    if (startingAfter) params.set("startingAfter", startingAfter)
    const body = await mayarFetchRaw<
      CouponCampaign[] | { coupons?: CouponCampaign[] }
    >(config, `/coupons?${params.toString()}`)
    const campaigns = Array.isArray(body.data)
      ? body.data
      : (body.data?.coupons ?? [])

    for (const campaign of campaigns) {
      for (const coupon of campaign.coupons ?? []) {
        if (coupon.code?.trim().toLowerCase() !== wanted) continue
        return {
          code: coupon.code ?? code.trim(),
          type: coupon.type ?? null,
          isActive: coupon.isActive === true,
          limit: coupon.limit ?? null,
          usageCount: coupon.usageCount ?? null,
          expiredAt:
            toEpochMs(coupon.expiredAt) ?? toEpochMs(campaign.expiredAt),
          discountType: campaign.discountType ?? "",
          discountValue: campaign.discountValue ?? campaign.value ?? 0,
          minimumPurchase: campaign.minimumPurchase ?? null,
        }
      }
    }

    if (!body.hasMore || !body.nextStartingAfter) break
    startingAfter = body.nextStartingAfter
  }
  return null
}
