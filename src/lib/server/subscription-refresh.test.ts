import { describe, expect, it } from "vitest"

import { isPaidTransactionStatus } from "@/lib/mayar/client"

/**
 * Mirrors the expiry rule used by getEntitlementsForUser /
 * refreshSubscriptionFromMayar: a pro row whose period has ended is
 * downgraded lazily on read. A missing period end never expires.
 */
function isExpiredPro(
  row: { plan: string; currentPeriodEnd: Date | null },
  now: number
): boolean {
  return (
    row.plan === "pro" &&
    row.currentPeriodEnd != null &&
    row.currentPeriodEnd.getTime() < now
  )
}

describe("isPaidTransactionStatus (verify-on-read activation)", () => {
  it("treats paid/success/settled as paid, case-insensitively", () => {
    expect(isPaidTransactionStatus("paid")).toBe(true)
    expect(isPaidTransactionStatus("SUCCESS")).toBe(true)
    expect(isPaidTransactionStatus("Settled")).toBe(true)
  })

  it("rejects unpaid or terminal-but-unpaid statuses", () => {
    expect(isPaidTransactionStatus("created")).toBe(false)
    expect(isPaidTransactionStatus("pending")).toBe(false)
    expect(isPaidTransactionStatus("expired")).toBe(false)
    expect(isPaidTransactionStatus("failed")).toBe(false)
  })
})

describe("lazy Pro expiry", () => {
  const now = Date.now()

  it("expires pro once the period end has passed", () => {
    expect(
      isExpiredPro({ plan: "pro", currentPeriodEnd: new Date(now - 1000) }, now)
    ).toBe(true)
  })

  it("keeps pro while the period is still running", () => {
    expect(
      isExpiredPro(
        { plan: "pro", currentPeriodEnd: new Date(now + 60_000) },
        now
      )
    ).toBe(false)
  })

  it("never expires pro without period metadata", () => {
    expect(isExpiredPro({ plan: "pro", currentPeriodEnd: null }, now)).toBe(
      false
    )
  })

  it("ignores free rows regardless of period end", () => {
    expect(
      isExpiredPro(
        { plan: "free", currentPeriodEnd: new Date(now - 1000) },
        now
      )
    ).toBe(false)
  })
})
