import { describe, expect, it } from "vitest"

import {
  normalizeImageContentType,
  ogPreviewObjectKey,
  ogPreviewPath,
  parseOgPreviewHash,
  sha256Hex,
} from "./og-preview-helpers"

describe("og preview helpers", () => {
  it("builds stable object keys and public paths", () => {
    const hash = "a".repeat(64)
    expect(ogPreviewObjectKey(hash)).toBe(`og-previews/${hash}`)
    expect(ogPreviewPath(hash)).toBe(`/api/og-preview/${hash}`)
  })

  it("parses only 64-char hex preview paths", () => {
    const hash = "b".repeat(64)
    expect(parseOgPreviewHash(`/api/og-preview/${hash}`)).toBe(hash)
    expect(parseOgPreviewHash("/api/og-preview/not-a-hash")).toBeNull()
    expect(parseOgPreviewHash("/api/assets/x")).toBeNull()
  })

  it("normalizes accepted image content types", () => {
    expect(normalizeImageContentType("image/jpeg; charset=binary")).toBe(
      "image/jpeg"
    )
    expect(normalizeImageContentType("image/jpg")).toBe("image/jpeg")
    expect(normalizeImageContentType("image/png")).toBe("image/png")
    expect(normalizeImageContentType("text/html")).toBeNull()
    expect(normalizeImageContentType(null)).toBeNull()
  })

  it("hashes preview source URLs with SHA-256", async () => {
    const hash = await sha256Hex("https://cdn.example.com/og.png")
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(await sha256Hex("https://cdn.example.com/og.png")).toBe(hash)
    expect(await sha256Hex("https://cdn.example.com/other.png")).not.toBe(hash)
  })
})
