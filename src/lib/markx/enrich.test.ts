import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  absoluteFavicon,
  absoluteImageUrl,
  absoluteUrl,
  clearEnrichCache,
  enrichAndMirror,
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

describe("enrichAndMirror cache", () => {
  const ogHtml = (title: string) =>
    `<html><head><meta property="og:title" content="${title}"/></head></html>`

  function mockFetch() {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.startsWith("https://api.microlink.io")) {
        return new Response(
          JSON.stringify({ status: "success", data: { title: "ML" } }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      }
      return new Response(ogHtml(`Title for ${url}`), {
        status: 200,
        headers: { "content-type": "text/html" },
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  const pageFetches = (fetchMock: ReturnType<typeof mockFetch>, url: string) =>
    fetchMock.mock.calls.filter(([input]) => String(input) === url)

  beforeEach(() => {
    clearEnrichCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("coalesces concurrent calls for the same URL into one scrape", async () => {
    const fetchMock = mockFetch()
    const url = "https://dedupe.example.com/post"

    const [a, b] = await Promise.all([
      enrichAndMirror(url),
      enrichAndMirror(url),
    ])

    expect(a).toEqual(b)
    expect(pageFetches(fetchMock, url)).toHaveLength(1)
  })

  it("serves repeat calls from the cache without re-fetching", async () => {
    const fetchMock = mockFetch()
    const url = "https://cached.example.com/post"

    await enrichAndMirror(url)
    const callsAfterFirst = fetchMock.mock.calls.length
    const again = await enrichAndMirror(url)

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst)
    expect(again.title).toBe(`Title for ${url}`)
  })

  it("evicts the oldest entry once the cache exceeds its cap", async () => {
    const fetchMock = mockFetch()
    const first = "https://site-0.example.com/"
    const third = "https://site-2.example.com/"

    // Fill past the 500-entry cap; the first URL becomes the eviction victim.
    for (let i = 0; i <= 500; i += 1) {
      await enrichAndMirror(`https://site-${i}.example.com/`)
    }

    // Evicted → scraped again. This write itself evicts the next-oldest.
    await enrichAndMirror(first)
    expect(pageFetches(fetchMock, first)).toHaveLength(2)

    // Still cached from the fill loop → no new fetch.
    await enrichAndMirror(third)
    expect(pageFetches(fetchMock, third)).toHaveLength(1)
  })
})
