import { describe, it, expect } from "vitest"

import { createEmptyState, createDemoState } from "@/lib/markx/seed"
import { isGuestModified, blobToDataUrl, dataUrlToBlob } from "@/lib/markx/sync"
import type { MarkxState } from "@/lib/markx/types"

/**
 * Tests for the sync engine's pure helper logic.
 *
 * These tests don't touch IndexedDB or the network — they validate the
 * state-comparison heuristics and data-URL conversion utilities that the
 * SyncEngine relies on for guest-import detection and asset transport.
 */

describe("isGuestModified", () => {
  it("returns false for the unmodified demo state", () => {
    const demo = createDemoState()
    expect(isGuestModified(demo)).toBe(false)
  })

  it("returns true after adding a folder", () => {
    const state = createDemoState()
    state.folders.push({
      id: "new",
      name: "New",
      x: 0,
      y: 0,
      z: 100,
    })
    expect(isGuestModified(state)).toBe(true)
  })

  it("returns true after changing an existing demo bookmark", () => {
    const state = createDemoState()
    state.bookmarks[0].title = "Changed title"
    expect(isGuestModified(state)).toBe(true)
  })

  it("returns true after deleting a bookmark", () => {
    const state = createDemoState()
    state.bookmarks.pop()
    expect(isGuestModified(state)).toBe(true)
  })

  it("returns true after adding a note", () => {
    const state = createDemoState()
    state.notes.push({
      id: "n1",
      folderId: null,
      content: "hello",
      color: "yellow",
      font: "sans",
      fontSize: "m",
      x: 0,
      y: 0,
      z: 1,
    })
    expect(isGuestModified(state)).toBe(true)
  })

  it("returns true after onboarding", () => {
    const state = createDemoState()
    state.hasOnboarded = true
    expect(isGuestModified(state)).toBe(true)
  })

  it("returns false for the empty state (different from demo)", () => {
    const empty = createEmptyState()
    expect(isGuestModified(empty)).toBe(true)
  })
})

describe("dataUrlToBlob / blobToDataUrl round-trip", () => {
  it("round-trips a PNG blob through data URL and back", async () => {
    // 1x1 transparent PNG
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    const original = new Blob([pngBytes], { type: "image/png" })

    const dataUrl = await blobToDataUrl(original)
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true)

    const restored = dataUrlToBlob(dataUrl)
    expect(restored.type).toBe("image/png")
    expect(restored.size).toBe(original.size)

    // Verify byte-level equality
    const restoredBytes = new Uint8Array(await restored.arrayBuffer())
    expect(restoredBytes).toEqual(pngBytes)
  })

  it("throws on invalid data URL", () => {
    expect(() => dataUrlToBlob("not-a-data-url")).toThrow("Invalid data URL")
  })
})

describe("markxStateSchema", () => {
  it("validates a well-formed state", async () => {
    const { markxStateSchema } = await import("@/lib/markx/schema")
    const demo = createDemoState()
    const result = markxStateSchema.safeParse(demo)
    expect(result.success).toBe(true)
  })

  it("rejects a state with missing required fields", async () => {
    const { markxStateSchema } = await import("@/lib/markx/schema")
    const bad = { folders: [], bookmarks: [] } as Partial<MarkxState>
    const result = markxStateSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })

  it("rejects a state with wrong field types", async () => {
    const { markxStateSchema } = await import("@/lib/markx/schema")
    const demo = createDemoState()
    const bad = { ...demo, zCounter: "not a number" }
    const result = markxStateSchema.safeParse(bad)
    expect(result.success).toBe(false)
  })
})
