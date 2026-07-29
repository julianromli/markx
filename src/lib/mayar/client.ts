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
      const errBody = (await res.json()) as MayarEnvelope<unknown>
      detail = errBody.messages ?? errBody.message ?? detail
    } catch {
      // non-JSON error body
    }
    throw new Error(`Mayar ${path} failed: ${detail}`)
  }

  // Mayar write endpoints may still use HTTP 200 with statusCode >= 400 in body.
  const body = (await res.json()) as MayarEnvelope<T>
  const msg = body.messages ?? body.message
  const statusCode = body.statusCode ?? res.status
  if (statusCode >= 400) {
    throw new Error(`Mayar ${path} failed: ${msg ?? statusCode}`)
  }
  return body.data as T
}

export type MembershipMemberRecord = {
  id: string
  memberId: string
  customerId: string
  status: string
  nextPayment?: string | null
  expiredAt?: string | null
  customer?: { email: string; name: string; mobile: string }
}

export type RegisterMemberResult = {
  memberId: string
  customerId: string
  status: string
  nextPayment?: string | null
}

type RegisterMemberApiData = {
  memberId: string
  customerId: string
  status: string
  nextPayment?: string | null
  membershipCustomer?: RegisterMemberResult
}

export type MembershipInvoiceResult = {
  id: string
  transactionId?: string
  membershipBillUrl: string
  status: string
}

export type TransactionDetail = {
  id: string
  status: string
  amount: number
  customer: { id: string; email: string; name: string }
  paymentLink?: { id: string; type: string }
}

export async function registerMembershipMember(input: {
  productId: string
  membershipTierId: string
  customerInfo: { name: string; email: string; mobile: string }
  membershipMonthlyPeriod?: number
}): Promise<RegisterMemberResult> {
  const config = await getMayarConfig()
  const raw = await mayarFetch<RegisterMemberApiData>(
    config,
    "/memberships/members/create",
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        membershipMonthlyPeriod: input.membershipMonthlyPeriod ?? 1,
      }),
    }
  )
  if (raw.membershipCustomer) {
    return raw.membershipCustomer
  }
  return {
    memberId: raw.memberId,
    customerId: raw.customerId,
    status: raw.status,
    nextPayment: raw.nextPayment,
  }
}

export async function createMembershipInvoice(
  memberId: string,
  productId: string
): Promise<MembershipInvoiceResult> {
  const config = await getMayarConfig()
  return mayarFetch<MembershipInvoiceResult>(
    config,
    `/memberships/members/${encodeURIComponent(memberId)}/invoice/create`,
    {
      method: "POST",
      body: JSON.stringify({ productId }),
    }
  )
}

export async function getTransaction(id: string): Promise<TransactionDetail> {
  const config = await getMayarConfig()
  return mayarFetch<TransactionDetail>(
    config,
    `/transactions/${encodeURIComponent(id)}`
  )
}

export async function getMembershipMemberDetail(
  memberId: string,
  productId: string
): Promise<MembershipMemberRecord> {
  const config = await getMayarConfig()
  return mayarFetch<MembershipMemberRecord>(
    config,
    `/memberships/members/${encodeURIComponent(memberId)}?productId=${encodeURIComponent(productId)}`
  )
}

type MemberListRow = {
  memberId: string
  "customer.email"?: string
  status?: string
}

export async function findMemberIdByEmail(
  productId: string,
  email: string
): Promise<string | null> {
  const config = await getMayarConfig()
  const params = new URLSearchParams({
    productId,
    limit: "10",
    search: email,
  })
  const rows = await mayarFetch<MemberListRow[]>(
    config,
    `/memberships/members?${params.toString()}`
  )
  const normalized = email.trim().toLowerCase()
  for (const row of rows) {
    const rowEmail = row["customer.email"]?.trim().toLowerCase()
    if (rowEmail === normalized && row.memberId) {
      return row.memberId
    }
  }
  return null
}

export function isPaidTransactionStatus(status: string): boolean {
  return ["paid", "success", "settled"].includes(status.toLowerCase())
}

export function isActiveMembershipStatus(status: string): boolean {
  return status.toLowerCase() === "active"
}
