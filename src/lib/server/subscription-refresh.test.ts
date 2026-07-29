import { describe, expect, it } from "vitest"

import { isActiveMembershipStatus } from "@/lib/mayar/client"

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
