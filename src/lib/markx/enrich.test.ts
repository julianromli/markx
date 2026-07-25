import { describe, expect, it } from "vitest"

import { absoluteFavicon, enrichLinkInputSchema } from "./enrich"

const PAGE = "https://example.com/blog/post"

describe("absoluteFavicon", () => {
  it("resolves a site-relative path against the page origin", () => {
    expect(absoluteFavicon("/favicon.ico", PAGE)).toBe(
      "https://example.com/favicon.ico"
    )
  })

  it("resolves a path-relative reference against the page directory", () => {
    expect(absoluteFavicon("icon.png", PAGE)).toBe(
      "https://example.com/blog/icon.png"
    )
  })

  it("leaves an absolute URL untouched", () => {
    expect(absoluteFavicon("https://cdn.example.com/i.png", PAGE)).toBe(
      "https://cdn.example.com/i.png"
    )
  })

  it("keeps a protocol-relative URL on the page's scheme", () => {
    expect(absoluteFavicon("//cdn.example.com/i.png", PAGE)).toBe(
      "https://cdn.example.com/i.png"
    )
  })

  it("falls back to the Google service when the favicon is missing", () => {
    expect(absoluteFavicon(undefined, PAGE)).toContain(
      "google.com/s2/favicons?domain=example.com"
    )
    expect(absoluteFavicon("", PAGE)).toContain("google.com/s2/favicons")
  })

  it("rejects non-http schemes rather than passing them to an img src", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg/>",
      "file:///etc/passwd",
    ]) {
      expect(absoluteFavicon(hostile, PAGE)).toContain("google.com/s2/favicons")
    }
  })
})

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
