import { describe, expect, it, vi } from "vitest"

import { createMarkxStore } from "@/lib/markx/store"
import type { MarkxStoreDependencies } from "@/lib/markx/store"
import { createEmptyState } from "@/lib/markx/state"
import type { LinkMetadata } from "@/lib/markx/types"

function makeStore(enrich?: MarkxStoreDependencies["enrich"]) {
  return createMarkxStore({
    storage: {
      load: vi.fn(async () => createEmptyState()),
      save: vi.fn(async () => {}),
    },
    enrich: enrich ?? vi.fn(async () => ({ title: "", faviconUrl: "" })),
    sweepOrphanImages: vi.fn(async () => {}),
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("one undo history", () => {
  it("MX-05 toast Undo after Cmd+Z does not duplicate a deleted bookmark", () => {
    const store = makeStore()
    const folder = store.actions.createFolder(0, 0, "F")
    const bookmark = store.actions.createBookmark(folder.id, "a.com", 0, 0)!

    store.actions.deleteBookmarks([bookmark.id])
    const entry = store.actions.lastEntryId()
    store.actions.undo() // keyboard or header Undo
    const undone = store.actions.undoEntry(entry) // then the toast Undo

    expect(undone).toBe(false)
    const copies = store
      .getState()
      .bookmarks.filter((b) => b.id === bookmark.id)
    expect(copies).toHaveLength(1)
  })

  it("MX-05 toast Undo restores the delete when it is still the latest step", () => {
    const store = makeStore()
    const folder = store.actions.createFolder(0, 0, "F")
    const bookmark = store.actions.createBookmark(folder.id, "a.com", 0, 0)!
    store.actions.deleteBookmarks([bookmark.id])
    expect(store.actions.undoEntry(store.actions.lastEntryId())).toBe(true)
    expect(store.getState().bookmarks.map((b) => b.id)).toEqual([bookmark.id])
    expect(store.getHistory().canRedo).toBe(true)
  })

  it("MX-05b toast Undo does not restore a bookmark into a folder that no longer exists", () => {
    const store = makeStore()
    const folder = store.actions.createFolder(0, 0, "F")
    const bookmark = store.actions.createBookmark(folder.id, "a.com", 0, 0)!
    store.actions.deleteBookmarks([bookmark.id])
    const entry = store.actions.lastEntryId()
    store.actions.deleteFolders([folder.id])
    store.actions.undoEntry(entry)

    const folderIds = new Set(store.getState().folders.map((f) => f.id))
    const orphans = store
      .getState()
      .bookmarks.filter((b) => !folderIds.has(b.folderId))
    expect(orphans).toHaveLength(0)
  })

  it("MX-07 redo of a bookmark created while enrich was pending does not leave a stuck loading shimmer", async () => {
    const pending = deferred<LinkMetadata>()
    const store = makeStore(vi.fn(() => pending.promise))
    const folder = store.actions.createFolder(0, 0, "F")
    const bookmark = store.actions.createBookmark(folder.id, "a.com", 0, 0)!

    store.actions.undo()
    pending.resolve({ title: "Arrived late", faviconUrl: "" })
    await Promise.resolve()
    await Promise.resolve()
    store.actions.redo()

    const restored = store
      .getState()
      .bookmarks.find((b) => b.id === bookmark.id)
    expect(restored?.enrichStatus).not.toBe("pending")
    expect(restored?.title).toBe("Arrived late")
  })
})
