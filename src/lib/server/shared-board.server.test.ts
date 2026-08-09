import { describe, expect, it } from "vitest"

import { generateShareToken } from "@/lib/server/shared-board.server"
import { parseSharedBoardAssetPath } from "@/lib/server/shared-board-asset"

describe("generateShareToken", () => {
  it("produces URL-safe tokens of ~22 chars", () => {
    const token = generateShareToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token.length).toBeGreaterThanOrEqual(20)
    expect(token.length).toBeLessThanOrEqual(24)
  })

  it("does not collide across many generations", () => {
    const seen = new Set<string>()
    let collisions = 0
    for (let i = 0; i < 5000; i++) {
      const t = generateShareToken()
      if (seen.has(t)) collisions += 1
      seen.add(t)
    }
    // 16 bytes of entropy → collisions should be effectively zero.
    expect(collisions).toBe(0)
  })
})

describe("parseSharedBoardAssetPath", () => {
  it("matches a well-formed asset path", () => {
    expect(parseSharedBoardAssetPath("/s/abc123/asset/img-9")).toEqual({
      token: "abc123",
      imageId: "img-9",
    })
  })

  it("is case-insensitive about leading slashes", () => {
    expect(parseSharedBoardAssetPath("s/tok/asset/im")).toEqual({
      token: "tok",
      imageId: "im",
    })
  })

  it("rejects non-asset /s/:token paths (the viewer route)", () => {
    expect(parseSharedBoardAssetPath("/s/abc123")).toBeNull()
    expect(parseSharedBoardAssetPath("/s/abc123/")).toBeNull()
  })

  it("rejects unrelated paths", () => {
    expect(parseSharedBoardAssetPath("/folder/x")).toBeNull()
    expect(parseSharedBoardAssetPath("/api/auth/ok")).toBeNull()
    expect(parseSharedBoardAssetPath("/")).toBeNull()
    expect(parseSharedBoardAssetPath("/s/t/asset/")).toBeNull()
    expect(parseSharedBoardAssetPath("/s/t/asset/x/extra")).toBeNull()
  })
})
