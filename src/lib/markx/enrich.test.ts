import { describe, expect, it } from "vitest"

import { enrichLinkInputSchema } from "./enrich"

describe("enrichLinkInputSchema", () => {
  it("accepts a normal public URL", () => {
    expect(
      enrichLinkInputSchema.safeParse({ url: "https://example.com" }).success
    ).toBe(true)
  })

  it("rejects private, local and non-http targets", () => {
    for (const url of [
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/",
      "ftp://example.com/x",
      "https://user:pass@example.com/",
    ]) {
      expect(enrichLinkInputSchema.safeParse({ url }).success).toBe(false)
    }
  })

  it("rejects an over-long URL", () => {
    const url = `https://example.com/${"a".repeat(2100)}`
    expect(enrichLinkInputSchema.safeParse({ url }).success).toBe(false)
  })
})
