import { describe, expect, it } from "vitest"

import { decodeDataUrl, encodeDataUrl } from "@/lib/data-url"
import { createEmptyState } from "@/lib/markx/seed"
import { assetKey, mapWithConcurrency } from "@/lib/server/asset-helpers"
import {
  hasWorkspaceItems,
  parseWorkspaceState,
  toConflictResult,
} from "@/lib/server/workspace-helpers"

describe("workspace service helpers", () => {
  it("parses JSONB state and rejects malformed records", () => {
    expect(parseWorkspaceState(createEmptyState())).toEqual(createEmptyState())
    expect(() => parseWorkspaceState({ folders: [] })).toThrow()
  })

  it("maps a workspace conflict through the validated state", () => {
    const updatedAt = new Date("2026-07-25T00:00:00.000Z")
    expect(
      toConflictResult({
        id: "workspace",
        userId: "user",
        state: createEmptyState(),
        version: 4,
        updatedAt,
      })
    ).toEqual({
      ok: false,
      reason: "conflict",
      cloudVersion: 4,
      cloudState: createEmptyState(),
      cloudUpdatedAt: updatedAt.toISOString(),
    })
  })

  it("detects content while treating an empty workspace as empty", () => {
    const empty = createEmptyState()
    expect(hasWorkspaceItems(empty)).toBe(false)
    expect(
      hasWorkspaceItems({
        ...empty,
        notes: [
          {
            id: "note",
            folderId: null,
            content: "",
            color: "yellow",
            font: "sans",
            fontSize: "m",
            x: 0,
            y: 0,
            z: 1,
          },
        ],
      })
    ).toBe(true)
  })
})

describe("asset service helpers", () => {
  it("uses user-scoped object keys", () => {
    expect(assetKey("user-1", "image-1")).toBe("users/user-1/images/image-1")
  })

  it("round-trips bytes through the shared data URL codec", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255])
    expect(decodeDataUrl(encodeDataUrl(bytes, "image/png"))).toEqual({
      mime: "image/png",
      bytes,
    })
  })

  it("preserves result order and bounds concurrency", async () => {
    let active = 0
    let maximumActive = 0
    const results = await mapWithConcurrency(
      [1, 2, 3, 4, 5],
      2,
      async (value) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await Promise.resolve()
        active -= 1
        return value * 2
      }
    )

    expect(results).toEqual([2, 4, 6, 8, 10])
    expect(maximumActive).toBe(2)
  })
})
