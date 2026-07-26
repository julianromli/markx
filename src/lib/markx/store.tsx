import { nanoid } from "nanoid"

import { enrichLink } from "./enrich"
import { cloneState, createEmptyState, nextZ } from "./state"
import { localMarkxStorage, sweepOrphanImageBlobs } from "./storage"
import type { MarkxStorage } from "./storage"
import type { SyncEngine } from "./sync"
import { STORE_PERSIST_DEBOUNCE_MS } from "./sync-timings"
import type {
  BoardImage,
  Bookmark,
  Folder,
  LinkMetadata,
  MarkxState,
  Note,
} from "./types"

type Listener = () => void
type PositionUpdate = { id: string; x: number; y: number; z?: number }

const MAX_HISTORY = 50

function applyBookmarkMetadata(
  bookmark: Bookmark,
  metadata: LinkMetadata
): Bookmark {
  return {
    ...bookmark,
    title: metadata.title || bookmark.title,
    description: metadata.description ?? bookmark.description,
    imageUrl: metadata.imageUrl ?? bookmark.imageUrl,
    faviconUrl: metadata.faviconUrl || bookmark.faviconUrl,
    enrichStatus: "done",
  }
}

/** Pending enrich flags are session-local; never resume a shimmer after reload. */
function settleStaleEnrichStatus(state: MarkxState): MarkxState {
  if (!state.bookmarks.some((bookmark) => bookmark.enrichStatus === "pending")) {
    return state
  }
  return {
    ...state,
    bookmarks: state.bookmarks.map((bookmark) =>
      bookmark.enrichStatus === "pending"
        ? { ...bookmark, enrichStatus: "done" as const }
        : bookmark
    ),
  }
}

export type MarkxActions = {
  undo: () => void
  redo: () => void
  raiseZ: (ids: string[]) => void
  updatePositions: (updates: PositionUpdate[]) => void
  createFolder: (x: number, y: number, name?: string) => Folder
  renameFolder: (id: string, name: string) => void
  deleteFolders: (ids: string[]) => void
  createNote: (x: number, y: number, folderId: string | null) => Note
  updateNoteContent: (id: string, content: string) => void
  setNoteStyle: (
    id: string,
    style: Partial<Pick<Note, "color" | "font" | "fontSize">>
  ) => void
  deleteNotes: (ids: string[]) => Note[]
  createImage: (meta: Omit<BoardImage, "z">) => BoardImage
  deleteImages: (ids: string[]) => BoardImage[]
  /**
   * Returns the optimistic bookmark synchronously so callers can select it right
   * away. Open Graph metadata arrives later via a background patch.
   */
  createBookmark: (
    folderId: string,
    url: string,
    x: number,
    y: number
  ) => Bookmark
  renameBookmark: (id: string, title: string) => void
  resizeItem: (
    id: string,
    rect: { x: number; width: number; height: number }
  ) => void
  resetSizes: (ids: string[]) => void
  moveBookmarks: (ids: string[], folderId: string) => void
  deleteBookmarks: (ids: string[]) => Bookmark[]
  restoreBookmarks: (bookmarks: Bookmark[]) => void
  markxOnboarded: () => void
  enrichMissingBookmarks: () => Promise<void>
}

export type MarkxHistory = {
  canUndo: boolean
  canRedo: boolean
}

export type MarkxStore = {
  getState: () => MarkxState
  getHistory: () => MarkxHistory
  subscribe: (listener: Listener) => () => void
  actions: MarkxActions
  getSyncEngine: () => SyncEngine | null
  attachSync: (engine: SyncEngine) => void
  detachSync: () => void
  replaceState: (newState: MarkxState, opts?: { persist?: boolean }) => void
  hydrate: () => Promise<void>
  finishHydration: () => void
  resolveConflictUseCloud: () => Promise<void>
  resolveConflictOverwriteCloud: () => Promise<void>
}

export type MarkxStoreDependencies = {
  storage: MarkxStorage
  enrich: (input: { data: { url: string } }) => Promise<LinkMetadata>
  sweepOrphanImages: typeof sweepOrphanImageBlobs
}

const defaultDependencies: MarkxStoreDependencies = {
  storage: localMarkxStorage,
  enrich: enrichLink,
  sweepOrphanImages: sweepOrphanImageBlobs,
}

export function createMarkxStore(
  dependencies: MarkxStoreDependencies = defaultDependencies
): MarkxStore {
  let state: MarkxState = createEmptyState()
  let past: MarkxState[] = []
  let future: MarkxState[] = []
  const listeners = new Set<Listener>()
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * When the user is logged in, this is set to the active SyncEngine so
   * that local changes are pushed to the cloud. When `null` (guest mode),
   * changes are persisted only to the local IndexedDB guest store.
   */
  let syncEngine: SyncEngine | null = null
  let syncUnsub: (() => void) | null = null

  /**
   * Image IDs removed since the last sync. Accumulated across multiple
   * edits and flushed to the server with the next save so R2 objects can
   * be soft-deleted.
   */
  const pendingDeletedImageIds = new Set<string>()

  const emit = () => {
    for (const listener of listeners) listener()
  }

  const persist = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (syncEngine) {
        const deleted = [...pendingDeletedImageIds]
        pendingDeletedImageIds.clear()
        syncEngine.onStateChange(state, deleted)
      } else {
        void dependencies.storage.save(state)
      }
    }, STORE_PERSIST_DEBOUNCE_MS)
  }

  let historySnapshot: MarkxHistory = { canUndo: false, canRedo: false }

  const getHistory = (): MarkxHistory => {
    const canUndo = past.length > 0
    const canRedo = future.length > 0
    if (
      historySnapshot.canUndo !== canUndo ||
      historySnapshot.canRedo !== canRedo
    ) {
      historySnapshot = { canUndo, canRedo }
    }
    return historySnapshot
  }

  /** Apply a change and push the previous snapshot onto the undo stack. */
  const commit = (updater: (prev: MarkxState) => MarkxState) => {
    past.push(cloneState(state))
    if (past.length > MAX_HISTORY) past.shift()
    future = []
    state = updater(state)
    emit()
    persist()
  }

  /** Apply a change without touching history (enrich, raiseZ, etc.). */
  const patch = (updater: (prev: MarkxState) => MarkxState) => {
    state = updater(state)
    emit()
    persist()
  }

  const actions: MarkxActions = {
    undo() {
      const previous = past.pop()
      if (!previous) return
      future.push(cloneState(state))
      state = previous
      emit()
      persist()
    },

    redo() {
      const next = future.pop()
      if (!next) return
      past.push(cloneState(state))
      state = next
      emit()
      persist()
    },

    raiseZ(ids) {
      if (ids.length === 0) return
      patch((prev) => {
        let { zCounter } = prev
        const bump = new Map<string, number>()
        for (const id of ids) {
          zCounter += 1
          bump.set(id, zCounter)
        }
        return {
          ...prev,
          zCounter,
          folders: prev.folders.map((f) =>
            bump.has(f.id) ? { ...f, z: bump.get(f.id)! } : f
          ),
          bookmarks: prev.bookmarks.map((b) =>
            bump.has(b.id) ? { ...b, z: bump.get(b.id)! } : b
          ),
          notes: prev.notes.map((n) =>
            bump.has(n.id) ? { ...n, z: bump.get(n.id)! } : n
          ),
          images: prev.images.map((i) =>
            bump.has(i.id) ? { ...i, z: bump.get(i.id)! } : i
          ),
        }
      })
    },

    updatePositions(updates) {
      if (updates.length === 0) return
      const map = new Map(updates.map((u) => [u.id, u]))
      commit((prev) => ({
        ...prev,
        folders: prev.folders.map((f) => {
          const u = map.get(f.id)
          if (!u) return f
          return { ...f, x: u.x, y: u.y, z: u.z ?? f.z }
        }),
        bookmarks: prev.bookmarks.map((b) => {
          const u = map.get(b.id)
          if (!u) return b
          return { ...b, x: u.x, y: u.y, z: u.z ?? b.z }
        }),
        notes: prev.notes.map((n) => {
          const u = map.get(n.id)
          if (!u) return n
          return { ...n, x: u.x, y: u.y, z: u.z ?? n.z }
        }),
        images: prev.images.map((i) => {
          const u = map.get(i.id)
          if (!u) return i
          return { ...i, x: u.x, y: u.y, z: u.z ?? i.z }
        }),
      }))
    },

    createFolder(x, y, name = "Untitled") {
      let created!: Folder
      commit((prev) => {
        const { z, zCounter } = nextZ(prev)
        created = { id: nanoid(), name, x, y, z }
        return {
          ...prev,
          zCounter,
          hasOnboarded: true,
          folders: [...prev.folders, created],
        }
      })
      return created
    },

    renameFolder(id, name) {
      commit((prev) => ({
        ...prev,
        folders: prev.folders.map((f) => (f.id === id ? { ...f, name } : f)),
      }))
    },

    deleteFolders(ids) {
      const idSet = new Set(ids)
      commit((prev) => {
        // Track images that are being removed so the sync engine can
        // soft-delete their R2 objects.
        for (const img of prev.images) {
          if (img.folderId != null && idSet.has(img.folderId)) {
            pendingDeletedImageIds.add(img.imageId)
          }
        }
        return {
          ...prev,
          folders: prev.folders.filter((f) => !idSet.has(f.id)),
          bookmarks: prev.bookmarks.filter((b) => !idSet.has(b.folderId)),
          notes: prev.notes.filter(
            (n) => n.folderId == null || !idSet.has(n.folderId)
          ),
          images: prev.images.filter(
            (i) => i.folderId == null || !idSet.has(i.folderId)
          ),
        }
      })
    },

    createNote(x, y, folderId) {
      let created!: Note
      commit((prev) => {
        const { z, zCounter } = nextZ(prev)
        created = {
          id: nanoid(),
          folderId,
          content: "",
          color: "yellow",
          font: "sans",
          fontSize: "m",
          x,
          y,
          z,
        }
        return {
          ...prev,
          zCounter,
          hasOnboarded: true,
          notes: [...prev.notes, created],
        }
      })
      return created
    },

    updateNoteContent(id, content) {
      commit((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === id ? { ...n, content } : n)),
      }))
    },

    setNoteStyle(id, style) {
      commit((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === id ? { ...n, ...style } : n)),
      }))
    },

    deleteNotes(ids) {
      const idSet = new Set(ids)
      let removed: Note[] = []
      commit((prev) => {
        removed = prev.notes.filter((n) => idSet.has(n.id))
        return {
          ...prev,
          notes: prev.notes.filter((n) => !idSet.has(n.id)),
        }
      })
      return removed
    },

    createImage(meta) {
      let created!: BoardImage
      commit((prev) => {
        const { z, zCounter } = nextZ(prev)
        created = { ...meta, z }
        return {
          ...prev,
          zCounter,
          hasOnboarded: true,
          images: [...prev.images, created],
        }
      })
      return created
    },

    deleteImages(ids) {
      const idSet = new Set(ids)
      let removed: BoardImage[] = []
      commit((prev) => {
        removed = prev.images.filter((i) => idSet.has(i.id))
        // Track for R2 soft-delete on next sync.
        for (const img of removed) {
          pendingDeletedImageIds.add(img.imageId)
        }
        return {
          ...prev,
          images: prev.images.filter((i) => !idSet.has(i.id)),
        }
      })
      return removed
    },

    createBookmark(folderId, url, x, y) {
      let normalized = url.trim()
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = `https://${normalized}`
      }

      const host = new URL(normalized).hostname
      let created!: Bookmark
      commit((prev) => {
        const { z, zCounter } = nextZ(prev)
        created = {
          id: nanoid(),
          folderId,
          url: normalized,
          title: host.replace(/^www\./, ""),
          faviconUrl: `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
          enrichStatus: "pending",
          x,
          y,
          z,
        }
        return {
          ...prev,
          zCounter,
          hasOnboarded: true,
          bookmarks: [...prev.bookmarks, created],
        }
      })

      // Enrich in the background: the card is already on the board, and waiting
      // for the scrape would delay selection and edit affordances.
      void (async () => {
        try {
          const meta = await dependencies.enrich({ data: { url: normalized } })
          patch((prev) => ({
            ...prev,
            bookmarks: prev.bookmarks.map((b) =>
              b.id === created.id ? applyBookmarkMetadata(b, meta) : b
            ),
          }))
        } catch {
          // Keep the optimistic card, but clear the loading shimmer.
          patch((prev) => ({
            ...prev,
            bookmarks: prev.bookmarks.map((b) =>
              b.id === created.id ? { ...b, enrichStatus: "done" } : b
            ),
          }))
        }
      })()

      return created
    },

    renameBookmark(id, title) {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id ? { ...b, title } : b
        ),
      }))
    },

    resizeItem(id, rect) {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id
            ? { ...b, x: rect.x, width: rect.width, height: rect.height }
            : b
        ),
        notes: prev.notes.map((n) =>
          n.id === id
            ? { ...n, x: rect.x, width: rect.width, height: rect.height }
            : n
        ),
        images: prev.images.map((i) =>
          i.id === id
            ? { ...i, x: rect.x, width: rect.width, height: rect.height }
            : i
        ),
      }))
    },

    resetSizes(ids) {
      const idSet = new Set(ids)
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) => {
          if (!idSet.has(b.id)) return b
          const { width: _w, height: _h, ...rest } = b
          return rest
        }),
        notes: prev.notes.map((n) => {
          if (!idSet.has(n.id)) return n
          const { width: _w, height: _h, ...rest } = n
          return rest
        }),
        images: prev.images.map((i) => {
          if (!idSet.has(i.id)) return i
          const { width: _w, height: _h, ...rest } = i
          return rest
        }),
      }))
    },

    moveBookmarks(ids, folderId) {
      const idSet = new Set(ids)
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b, index) =>
          idSet.has(b.id)
            ? {
                ...b,
                folderId,
                x: 140 + (index % 5) * 24,
                y: 140 + (index % 5) * 24,
              }
            : b
        ),
      }))
    },

    deleteBookmarks(ids) {
      const idSet = new Set(ids)
      let removed: Bookmark[] = []
      commit((prev) => {
        removed = prev.bookmarks.filter((b) => idSet.has(b.id))
        return {
          ...prev,
          bookmarks: prev.bookmarks.filter((b) => !idSet.has(b.id)),
        }
      })
      return removed
    },

    restoreBookmarks(bookmarks) {
      if (bookmarks.length === 0) return
      commit((prev) => ({
        ...prev,
        bookmarks: [...prev.bookmarks, ...bookmarks],
      }))
    },

    markxOnboarded() {
      patch((prev) =>
        prev.hasOnboarded ? prev : { ...prev, hasOnboarded: true }
      )
    },

    async enrichMissingBookmarks() {
      const missing = state.bookmarks.filter((b) => !b.imageUrl)
      if (missing.length === 0) return

      await Promise.all(
        missing.map(async (bookmark) => {
          try {
            const meta = await dependencies.enrich({
              data: { url: bookmark.url },
            })
            patch((prev) => ({
              ...prev,
              bookmarks: prev.bookmarks.map((b) =>
                b.id === bookmark.id ? applyBookmarkMetadata(b, meta) : b
              ),
            }))
          } catch {
            patch((prev) => ({
              ...prev,
              bookmarks: prev.bookmarks.map((b) =>
                b.id === bookmark.id ? { ...b, enrichStatus: "done" } : b
              ),
            }))
          }
        })
      )
    },
  }

  return {
    getState: () => state,
    getHistory,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    actions,
    getSyncEngine: () => syncEngine,
    attachSync(engine: SyncEngine) {
      syncUnsub?.()
      syncEngine = engine
      // Adopt authoritative remote state when the engine resolves a deferred
      // first-login bootstrap (e.g. offline guest import → cloud-wins).
      syncUnsub = engine.subscribe((_status, _conflict, authoritativeState) => {
        if (!authoritativeState || syncEngine !== engine) return
        state = authoritativeState
        past = []
        future = []
        emit()
      })
    },
    detachSync() {
      syncUnsub?.()
      syncUnsub = null
      syncEngine = null
      pendingDeletedImageIds.clear()
    },
    replaceState(newState: MarkxState, opts?: { persist?: boolean }) {
      state = settleStaleEnrichStatus(newState)
      past = []
      future = []
      emit()
      // Skip persist when applying a remote/cache snapshot so we don't
      // immediately schedule a redundant cloud write of the same data.
      if (opts?.persist !== false) {
        persist()
      }
    },
    async hydrate() {
      state = settleStaleEnrichStatus(await dependencies.storage.load())
      past = []
      future = []
      emit()
      void actions.enrichMissingBookmarks()
      const referencedImageIds = new Set(state.images.map((i) => i.imageId))
      void dependencies.sweepOrphanImages(referencedImageIds)
    },
    finishHydration() {
      state = settleStaleEnrichStatus(state)
      emit()
      void actions.enrichMissingBookmarks()
      const referencedImageIds = new Set(state.images.map((i) => i.imageId))
      void dependencies.sweepOrphanImages(referencedImageIds)
    },
    async resolveConflictUseCloud() {
      if (!syncEngine) return
      const cloudState = await syncEngine.resolveConflictUseCloud()
      state = settleStaleEnrichStatus(cloudState)
      past = []
      future = []
      emit()
    },
    async resolveConflictOverwriteCloud() {
      if (!syncEngine) return
      await syncEngine.resolveConflictOverwriteCloud()
    },
  }
}

export const store = createMarkxStore()

export {
  MarkxProvider,
  useMarkxActions,
  useMarkxHistory,
  useMarkxImageIngest,
  useMarkxState,
  useMarkxStore,
} from "./store-react"
export type { InitialSyncStatus, MarkxStoreApi } from "./store-react"
