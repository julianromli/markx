/**
 * AUDIT REPRO TESTS (2026-10). See docs/audit/2026-10-markx-audit.md.
 *
 * Each test asserts the CORRECT behavior, so it goes red while the bug
 * exists and green after the fix. They are skipped by default so CI stays
 * green. Run them with:
 *
 *   MARKX_AUDIT=1 bunx vitest run src/audit
 *
 * Test names start with the finding id from the audit report.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import { createMarkxStore } from "@/lib/markx/store"
import type { MarkxStoreDependencies } from "@/lib/markx/store"
import { createEmptyState } from "@/lib/markx/seed"
import {
  NOTE_SIZE,
  MIN_NOTE_SIZE,
  MIN_ZOOM,
  RESIZE_HANDLE_SIZE,
  isInBottomRightResizeZone,
} from "@/lib/markx/geometry"
import type { LinkMetadata, MarkxState } from "@/lib/markx/types"

const auditIt = process.env.MARKX_AUDIT ? it : it.skip

afterEach(() => {
  vi.useRealTimers()
})

function makeStore(enrich?: MarkxStoreDependencies["enrich"]) {
  const save = vi.fn(async (_state: MarkxState) => {})
  const store = createMarkxStore({
    storage: { load: vi.fn(async () => createEmptyState()), save },
    enrich:
      enrich ??
      vi.fn(async (): Promise<LinkMetadata> => ({
        title: "Example",
        faviconUrl: "",
      })),
    sweepOrphanImages: vi.fn(async () => {}),
  })
  return { store, save }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe("audit: store and sync", () => {
  auditIt(
    "MX-04 moveBookmarks gives each moved bookmark its own position",
    () => {
      const { store } = makeStore()
      const source = store.actions.createFolder(0, 0, "Source")
      const target = store.actions.createFolder(300, 0, "Target")
      const ids: string[] = []
      for (let i = 0; i < 6; i += 1) {
        ids.push(
          store.actions.createBookmark(source.id, `site${i}.com`, i * 500, 0).id
        )
      }

      // Move the 1st and the 6th bookmark (global index 0 and 5).
      store.actions.moveBookmarks([ids[0], ids[5]], target.id)

      const positions = store
        .getState()
        .bookmarks.filter((b) => b.folderId === target.id)
        .map((b) => `${b.x},${b.y}`)
      expect(positions).toHaveLength(2)
      expect(new Set(positions).size).toBe(2)
    }
  )

  auditIt(
    "MX-05 toast Undo after Cmd+Z does not duplicate a deleted bookmark",
    () => {
      const { store } = makeStore()
      const folder = store.actions.createFolder(0, 0, "F")
      const bookmark = store.actions.createBookmark(folder.id, "a.com", 0, 0)

      const removed = store.actions.deleteBookmarks([bookmark.id])
      store.actions.undo() // keyboard / header Undo
      store.actions.restoreBookmarks(removed) // then the toast "Undo" button

      const copies = store
        .getState()
        .bookmarks.filter((b) => b.id === bookmark.id)
      expect(copies).toHaveLength(1)
    }
  )

  auditIt(
    "MX-05b toast Undo does not restore a bookmark into a folder that no longer exists",
    () => {
      const { store } = makeStore()
      const folder = store.actions.createFolder(0, 0, "F")
      const bookmark = store.actions.createBookmark(folder.id, "a.com", 0, 0)
      const removed = store.actions.deleteBookmarks([bookmark.id])
      store.actions.deleteFolders([folder.id])
      store.actions.restoreBookmarks(removed)

      const folderIds = new Set(store.getState().folders.map((f) => f.id))
      const orphans = store
        .getState()
        .bookmarks.filter((b) => !folderIds.has(b.folderId))
      expect(orphans).toHaveLength(0)
    }
  )

  auditIt(
    "MX-06 createBookmark does not throw on an input that is not a valid URL",
    () => {
      const { store } = makeStore()
      const folder = store.actions.createFolder(0, 0, "F")
      // "https://" and "https://[x" throw in every URL parser. Text with
      // spaces throws in jsdom but becomes host "my%20notes" in Chromium.
      expect(() =>
        store.actions.createBookmark(folder.id, "https://", 0, 0)
      ).not.toThrow()
    }
  )

  auditIt(
    "MX-07 redo of a bookmark created while enrich was pending does not leave a stuck loading shimmer",
    async () => {
      const pending = deferred<LinkMetadata>()
      const { store } = makeStore(vi.fn(() => pending.promise))
      const folder = store.actions.createFolder(0, 0, "F")
      const bookmark = store.actions.createBookmark(folder.id, "a.com", 0, 0)

      store.actions.undo()
      pending.resolve({ title: "A", faviconUrl: "" })
      await Promise.resolve()
      await Promise.resolve()
      store.actions.redo()

      const restored = store
        .getState()
        .bookmarks.find((b) => b.id === bookmark.id)
      expect(restored?.enrichStatus).not.toBe("pending")
    }
  )
})

describe("audit: geometry", () => {
  auditIt(
    "MX-09 on mobile at minimum zoom a minimum-size note still has a move area outside the resize zone",
    () => {
      // Board.tsx: isMobile ? Math.max(RESIZE_HANDLE_SIZE, 44 / cam.zoom)
      const handle = Math.max(RESIZE_HANDLE_SIZE, 44 / MIN_ZOOM)
      const note = { x: 0, y: 0, ...MIN_NOTE_SIZE }
      // Grab the note near its top-left corner, where a user grabs to move.
      expect(isInBottomRightResizeZone(10, 10, note, handle)).toBe(false)
    }
  )

  auditIt(
    "MX-09b on mobile at the default 50% zoom the resize zone covers less than a quarter of a minimum-size note",
    () => {
      const handle = Math.max(RESIZE_HANDLE_SIZE, 44 / 0.5)
      const zoneArea = handle * handle
      // Sanity: a default 300x300 note is fine (about 9%).
      expect(zoneArea / (NOTE_SIZE.width * NOTE_SIZE.height)).toBeLessThan(0.25)
      // A 160x120 minimum note: 88*88 / (160*120) = 40%.
      const minArea = MIN_NOTE_SIZE.width * MIN_NOTE_SIZE.height
      expect(zoneArea / minArea).toBeLessThan(0.25)
    }
  )
})
