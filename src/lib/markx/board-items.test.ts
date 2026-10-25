import { describe, expect, it } from "vitest"

import {
  clampIntoView,
  deleteItems,
  describeContents,
  describeContentsSentence,
  folderContents,
  moveItems,
  moveTargets,
  openIntent,
  parseBookmarkUrl,
} from "./board-items"
import { createDemoState } from "./seed"
import type { MarkxState, Note } from "./types"

function note(id: string, folderId: string | null): Note {
  return {
    id,
    folderId,
    content: "",
    color: "yellow",
    font: "sans",
    fontSize: "m",
    x: 0,
    y: 0,
    z: 1,
  }
}

function demo(extra: Partial<MarkxState> = {}): MarkxState {
  const base = createDemoState()
  return { ...base, ...extra }
}

const VIBE = "folder-vibe-coding"
const AI = "folder-ai"

describe("board items", () => {
  it("MX-04 moved bookmarks get distinct spots and are raised", () => {
    const state = demo()
    const ids = ["bookmark-cursor", "bookmark-linear", "bookmark-shadcn"]
    const { state: next, moved } = moveItems(state, ids, {
      mode: "folder",
      folderId: AI,
    })
    expect(moved).toBe(3)
    const movedItems = next.bookmarks.filter((b) => ids.includes(b.id))
    const spots = new Set(movedItems.map((b) => `${b.x},${b.y}`))
    expect(spots.size).toBe(3)
    const others = next.bookmarks.filter(
      (b) => b.folderId === AI && !ids.includes(b.id)
    )
    for (const m of movedItems) {
      for (const o of others) expect(m.z).toBeGreaterThan(o.z)
    }
  })

  it("MX-15 moves notes and bookmarks together; reports what cannot move", () => {
    const state = demo({ notes: [note("n1", VIBE)] })
    const result = moveItems(state, ["bookmark-cursor", "n1"], {
      mode: "folder",
      folderId: AI,
    })
    expect(result.moved).toBe(2)
    expect(result.state.notes[0]?.folderId).toBe(AI)
    expect(
      result.state.bookmarks.find((b) => b.id === "bookmark-cursor")?.folderId
    ).toBe(AI)

    const toHome = moveItems(state, ["bookmark-cursor", "n1"], { mode: "home" })
    expect(toHome.moved).toBe(1)
    expect(toHome.skipped).toBe(1)
    expect(toHome.state.notes[0]?.folderId).toBeNull()
  })

  it("MX-38 offers Home as a target only when every selected item can live there", () => {
    const state = demo({ notes: [note("n1", VIBE)] })
    const here = { mode: "folder" as const, folderId: VIBE }
    expect(moveTargets(state, ["n1"], here).home).toBe(true)
    expect(moveTargets(state, ["n1", "bookmark-cursor"], here).home).toBe(false)
    expect(
      moveTargets(state, ["n1"], here).folders.map((f) => f.id)
    ).not.toContain(VIBE)
    expect(moveTargets(state, [VIBE], { mode: "home" }).folders).toEqual([])
  })

  it("MX-17 deletes every selected kind in one pass, with folder cascade", () => {
    const state = demo({ notes: [note("home-note", null), note("in", VIBE)] })
    const { state: next, counts } = deleteItems(state, [VIBE, "home-note"])
    expect(next.folders.map((f) => f.id)).not.toContain(VIBE)
    expect(next.notes).toEqual([])
    expect(next.bookmarks.some((b) => b.folderId === VIBE)).toBe(false)
    expect(counts).toEqual({ folders: 1, bookmarks: 3, notes: 2, images: 0 })
  })

  it("MX-18 counts and labels every kind inside a folder", () => {
    const state = demo({ notes: [note("in", VIBE)] })
    const counts = folderContents(state, VIBE)
    expect(counts).toEqual({ bookmarks: 3, notes: 1, images: 0 })
    expect(describeContents(counts)).toBe("3 bookmarks, 1 note")
    expect(describeContentsSentence(counts)).toBe("3 bookmarks and 1 note")
    expect(describeContents({ bookmarks: 0, notes: 0, images: 0 })).toBe(
      "Empty"
    )
  })

  it("MX-20 opening an image does nothing; folders and notes open", () => {
    const state = demo({
      images: [
        {
          id: "img",
          folderId: null,
          imageId: "blob",
          mime: "image/png",
          naturalWidth: 10,
          naturalHeight: 10,
          x: 0,
          y: 0,
          z: 1,
        },
      ],
      notes: [note("n1", null)],
    })
    expect(openIntent(state, "img")).toEqual({ type: "none" })
    expect(openIntent(state, VIBE)).toEqual({
      type: "open-folder",
      folderId: VIBE,
    })
    expect(openIntent(state, "n1")).toEqual({ type: "edit-note", id: "n1" })
  })

  it.each([
    ["my reading list", false],
    ["https://", false],
    ["https://[bad", false],
    ["notaurl", false],
    ["javascript:alert(1)", false],
    ["example.com", true],
    ["https://cursor.com", true],
    ["localhost:3000/x", true],
  ])("MX-06 parseBookmarkUrl(%j) ok=%s", (text, ok) => {
    expect(parseBookmarkUrl(text).ok).toBe(ok)
  })

  it("MX-06 keeps the user's URL text after adding the scheme", () => {
    expect(parseBookmarkUrl("cursor.com")).toEqual({
      ok: true,
      url: "https://cursor.com",
      host: "cursor.com",
    })
  })

  it("MX-37 clamps a new item into the visible area", () => {
    const view = { x: 0, y: 0, width: 1000, height: 600 }
    expect(
      clampIntoView({ x: 950, y: 580 }, { width: 300, height: 300 }, view)
    ).toEqual({ x: 684, y: 284 })
    expect(
      clampIntoView({ x: 100, y: 100 }, { width: 300, height: 300 }, view)
    ).toEqual({ x: 100, y: 100 })
  })
})
