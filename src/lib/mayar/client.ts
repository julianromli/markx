import type { MayarConfig } from "@/lib/mayar/env"
import { getMayarConfig } from "@/lib/mayar/env"

type MayarEnvelope<T> = {
  statusCode?: number
  messages?: string
  message?: string
  data?: T
}

async function mayarFetch<T>(
  config: MayarConfig,
  path: string,
  init?: RequestInit
): Promise<T> {
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
  const body: MayarEnvelope<T> = await res.json()
  const msg = body.messages ?? body.message
  const statusCode = body.statusCode ?? res.status
  if (statusCode >= 400) {
    throw new Error(`Mayar ${path} failed: ${msg ?? statusCode}`)
  }
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
      paymentMethod: "qrcode",
      extraData: { userId: input.userId },
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
