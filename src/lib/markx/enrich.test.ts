import { describe, expect, it } from "vitest"

import {
  absoluteFavicon,
  absoluteImageUrl,
  absoluteUrl,
  enrichLinkInputSchema,
} from "./enrich"

const PAGE = "https://example.com/blog/post"

describe("absoluteUrl", () => {
  it("resolves a site-relative path against the page origin", () => {
    expect(absoluteUrl("/og.png", PAGE)).toBe("https://example.com/og.png")
  })

  it("resolves a path-relative reference against the page directory", () => {
    expect(absoluteUrl("cover.jpg", PAGE)).toBe(
      "https://example.com/blog/cover.jpg"
    )
  })

  it("leaves an absolute URL untouched", () => {
    expect(absoluteUrl("https://cdn.example.com/i.png", PAGE)).toBe(
      "https://cdn.example.com/i.png"
    )
  })

  it("keeps a protocol-relative URL on the page's scheme", () => {
    expect(absoluteUrl("//cdn.example.com/i.png", PAGE)).toBe(
      "https://cdn.example.com/i.png"
    )
  })

  it("rejects non-http schemes rather than passing them to an img src", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:image/svg+xml,<svg/>",
      "file:///etc/passwd",
    ]) {
      expect(absoluteUrl(hostile, PAGE)).toBeUndefined()
    }
  })
})

describe("absoluteFavicon", () => {
  it("resolves a site-relative path against the page origin", () => {
    expect(absoluteFavicon("/favicon.ico", PAGE)).toBe(
      "https://example.com/favicon.ico"
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

describe("absoluteImageUrl", () => {
  it("absolutizes relative Open Graph images", () => {
    expect(absoluteImageUrl("/assets/og.png", PAGE)).toBe(
      "https://example.com/assets/og.png"
    )
  })

  it("returns undefined when there is no image", () => {
    expect(absoluteImageUrl(undefined, PAGE)).toBeUndefined()
    expect(absoluteImageUrl("", PAGE)).toBeUndefined()
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
