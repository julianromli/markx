import { describe, expect, it } from "vitest"

import { FREE_TIER_ENTITY_LIMIT } from "@/lib/markx/entity-count"
import {
  BOOKMARK_SIZE,
  SLOT_OVERLAP_LIMIT,
  overlapRatio,
} from "@/lib/markx/geometry"
import {
  FOLDER_BOARD_ORIGIN,
  FOLDER_STACK_GAP,
  addBookmarkToFolderState,
  boardFullResult,
  findSlotFromTopLeft,
  listFoldersLastUsedFirst,
  wouldExceedFreeLimit,
} from "@/lib/markx/extension-bookmark"
import { createEmptyState } from "@/lib/markx/seed"
import type { Bookmark, Folder, MarkxState } from "@/lib/markx/types"

function folder(id: string, name: string, z: number): Folder {
  return { id, name, x: 0, y: 0, z }
}

function bookmark(
  partial: Partial<Bookmark> & Pick<Bookmark, "id" | "folderId" | "z">
): Bookmark {
  return {
    url: "https://example.com",
    title: partial.id,
    x: 0,
    y: 0,
    ...partial,
  }
}

function stateWith(folders: Folder[], bookmarks: Bookmark[] = []): MarkxState {
  const zCounter = Math.max(
    0,
    ...folders.map((item) => item.z),
    ...bookmarks.map((item) => item.z)
  )
  return {
    ...createEmptyState(),
    folders,
    bookmarks,
    zCounter,
  }
}

describe("findSlotFromTopLeft", () => {
  it("returns the origin when the folder is empty", () => {
    expect(findSlotFromTopLeft([])).toEqual(FOLDER_BOARD_ORIGIN)
  })

  it("stacks downward when the origin is occupied", () => {
    const occupied = [
      {
        x: 0,
        y: 0,
        width: BOOKMARK_SIZE.width,
        height: BOOKMARK_SIZE.height,
      },
    ]
    const slot = findSlotFromTopLeft(occupied)
    expect(slot).toEqual({
      x: 0,
      y: BOOKMARK_SIZE.height + FOLDER_STACK_GAP,
    })
    const next = {
      ...slot,
      width: BOOKMARK_SIZE.width,
      height: BOOKMARK_SIZE.height,
    }
    expect(overlapRatio(next, occupied[0])).toBeLessThanOrEqual(
      SLOT_OVERLAP_LIMIT
    )
  })

  it("skips a blocked middle slot and takes the one below", () => {
    const first = {
      x: 0,
      y: 0,
      width: BOOKMARK_SIZE.width,
      height: BOOKMARK_SIZE.height,
    }
    const step = BOOKMARK_SIZE.height + FOLDER_STACK_GAP
    const third = { ...first, y: step * 2 }
    const slot = findSlotFromTopLeft([first, third])
    expect(slot).toEqual({ x: 0, y: step })
  })
})

describe("listFoldersLastUsedFirst", () => {
  it("sorts by the highest z among the folder and its items", () => {
    const state = stateWith(
      [folder("old", "Old", 1), folder("fresh", "Fresh", 2)],
      [
        bookmark({ id: "b1", folderId: "old", z: 9, y: 0 }),
        bookmark({ id: "b2", folderId: "fresh", z: 3, y: 0 }),
      ]
    )
    expect(listFoldersLastUsedFirst(state).map((item) => item.id)).toEqual([
      "old",
      "fresh",
    ])
  })

  it("keeps original order when recency ties", () => {
    const state = stateWith([folder("a", "A", 1), folder("b", "B", 1)])
    expect(listFoldersLastUsedFirst(state).map((item) => item.id)).toEqual([
      "a",
      "b",
    ])
  })
})

describe("addBookmarkToFolderState", () => {
  it("appends a pending bookmark at the next downward slot and marks highlight", () => {
    const existing = bookmark({
      id: "existing",
      folderId: "f1",
      z: 2,
      x: 0,
      y: 0,
    })
    const state = stateWith([folder("f1", "Design", 1)], [existing])
    const result = addBookmarkToFolderState(state, {
      id: "new",
      folderId: "f1",
      url: "https://example.com/x",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bookmark).toMatchObject({
      id: "new",
      folderId: "f1",
      url: "https://example.com/x",
      title: "example.com",
      enrichStatus: "pending",
      highlight: true,
      x: 0,
      y: BOOKMARK_SIZE.height + FOLDER_STACK_GAP,
      z: 3,
    })
    expect(result.state.zCounter).toBe(3)
    expect(result.state.bookmarks).toHaveLength(2)
    expect(result.state.hasOnboarded).toBe(true)
  })

  it("is idempotent when the bookmark id is already in the folder", () => {
    const existing = bookmark({
      id: "new",
      folderId: "f1",
      z: 2,
      url: "https://example.com/x",
    })
    const state = stateWith([folder("f1", "Design", 1)], [existing])
    const result = addBookmarkToFolderState(state, {
      id: "new",
      folderId: "f1",
      url: "https://example.com/x",
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.bookmarks).toHaveLength(1)
    expect(result.bookmark).toBe(existing)
  })

  it("returns folder_not_found when the folder is missing", () => {
    const result = addBookmarkToFolderState(createEmptyState(), {
      id: "new",
      folderId: "missing",
      url: "https://example.com",
    })
    expect(result).toEqual({ ok: false, reason: "folder_not_found" })
  })

  it("returns invalid_url for a non-http string", () => {
    const state = stateWith([folder("f1", "Design", 1)])
    const result = addBookmarkToFolderState(state, {
      id: "new",
      folderId: "f1",
      url: "javascript:alert(1)",
    })
    expect(result).toEqual({ ok: false, reason: "invalid_url" })
  })
})

describe("wouldExceedFreeLimit", () => {
  it("is false below the cap and true once the cap is full", () => {
    const state = createEmptyState()
    expect(wouldExceedFreeLimit(state)).toBe(false)
    for (let i = 0; i < FREE_TIER_ENTITY_LIMIT; i += 1) {
      state.folders.push(folder(`f${i}`, `F${i}`, i + 1))
    }
    expect(state.folders).toHaveLength(FREE_TIER_ENTITY_LIMIT)
    expect(wouldExceedFreeLimit(state)).toBe(true)
    expect(boardFullResult(state)).toEqual({
      ok: false,
      reason: "board_full",
      count: FREE_TIER_ENTITY_LIMIT,
      limit: FREE_TIER_ENTITY_LIMIT,
    })
  })
})
