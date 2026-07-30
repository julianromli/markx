import { describe, expect, it } from "vitest"

import {
  isActiveMembershipStatus,
  isPaidTransactionStatus,
} from "@/lib/mayar/client"

/**
 * Mirrors refreshSubscriptionFromMayar plan selection.
 * Pro is never granted from Mayar member status alone.
 */
function nextPlanFromRefresh(input: {
  rowPlan: "free" | "pro"
  memberStatus: string
}): "free" | "pro" {
  const memberActive = isActiveMembershipStatus(input.memberStatus)
  const alreadyPro = input.rowPlan === "pro"
  if (alreadyPro && memberActive) return "pro"
  return "free"
}

describe("refreshSubscriptionFromMayar plan rules", () => {
  it("does not upgrade free when Mayar member is active (pre-payment)", () => {
    expect(
      nextPlanFromRefresh({ rowPlan: "free", memberStatus: "active" })
    ).toBe("free")
  })

  it("keeps pro when already pro and member still active", () => {
    expect(
      nextPlanFromRefresh({ rowPlan: "pro", memberStatus: "active" })
    ).toBe("pro")
  })

  it("downgrades pro when member expired/inactive", () => {
    expect(
      nextPlanFromRefresh({ rowPlan: "pro", memberStatus: "expired" })
    ).toBe("free")
    expect(
      nextPlanFromRefresh({ rowPlan: "pro", memberStatus: "inactive" })
    ).toBe("free")
  })
})

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
