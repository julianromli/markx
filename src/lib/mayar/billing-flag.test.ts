import { describe, expect, it } from "vitest"

import { parseTruthyFlag } from "@/lib/mayar/env"

describe("parseTruthyFlag / MAYAR_BILLING_ENABLED", () => {
  it("is off for empty or unknown values", () => {
    expect(parseTruthyFlag(undefined)).toBe(false)
    expect(parseTruthyFlag(null)).toBe(false)
    expect(parseTruthyFlag("")).toBe(false)
    expect(parseTruthyFlag("false")).toBe(false)
    expect(parseTruthyFlag("0")).toBe(false)
    expect(parseTruthyFlag("no")).toBe(false)
  })

  it("is on for common truthy strings", () => {
    expect(parseTruthyFlag("true")).toBe(true)
    expect(parseTruthyFlag("TRUE")).toBe(true)
    expect(parseTruthyFlag("1")).toBe(true)
    expect(parseTruthyFlag("yes")).toBe(true)
    expect(parseTruthyFlag("on")).toBe(true)
    expect(parseTruthyFlag(" on ")).toBe(true)
  })
})
