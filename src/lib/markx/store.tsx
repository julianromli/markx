import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { nanoid } from "nanoid"

import { getAuthClient } from "@/lib/auth/client"
import { enrichLink } from "./enrich"
import { createEmptyState } from "./seed"
import {
  localMarkxStorage,
  nextZ,
  sweepOrphanImageBlobs,
} from "./storage"
import { SyncEngine } from "./sync"
import type { BoardImage, Bookmark, Folder, MarkxState, Note } from "./types"

type Listener = () => void
type PositionUpdate = { id: string; x: number; y: number; z?: number }

const MAX_HISTORY = 50

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
    style: Partial<Pick<Note, "color" | "font" | "fontSize">>,
  ) => void
  deleteNotes: (ids: string[]) => Note[]
  createImage: (meta: Omit<BoardImage, "z">) => BoardImage
  deleteImages: (ids: string[]) => BoardImage[]
  createBookmark: (
    folderId: string,
    url: string,
    x: number,
    y: number,
  ) => Promise<Bookmark>
  renameBookmark: (id: string, title: string) => void
  resizeItem: (
    id: string,
    rect: { x: number; width: number; height: number },
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

type MarkxStoreApi = {
  getState: () => MarkxState
  getHistory: () => MarkxHistory
  subscribe: (listener: Listener) => () => void
  actions: MarkxActions
  ready: boolean
  /** The active SyncEngine, or `null` in guest mode. */
  getSyncEngine: () => SyncEngine | null
  /** Attach a SyncEngine (on login) and hydrate from the cloud. */
  attachSync: (engine: SyncEngine) => void
  /** Detach the SyncEngine (on sign-out) and switch back to guest mode. */
  detachSync: () => void
  /** Replace the in-memory state without touching history (cloud load / conflict resolution). */
  replaceState: (newState: MarkxState) => void
  /** Hydrate from local guest storage (guest mode). */
  hydrate: () => Promise<void>
  /** Mark the store ready after a sync-engine state replacement. */
  markReady: () => void
  /** Resolve a sync conflict by keeping the cloud version. */
  resolveConflictUseCloud: () => Promise<void>
  /** Resolve a sync conflict by overwriting the cloud with local. */
  resolveConflictOverwriteCloud: () => Promise<void>
}

const MarkxStoreContext = createContext<MarkxStoreApi | null>(null)

function cloneState(source: MarkxState): MarkxState {
  return {
    hasOnboarded: source.hasOnboarded,
    zCounter: source.zCounter,
    folders: source.folders.map((folder) => ({ ...folder })),
    bookmarks: source.bookmarks.map((bookmark) => ({ ...bookmark })),
    notes: source.notes.map((note) => ({ ...note })),
    images: source.images.map((image) => ({ ...image })),
  }
}

function createMarkxStore() {
  let state: MarkxState = createEmptyState()
  let ready = false
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
        void localMarkxStorage.save(state)
      }
    }, 120)
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
            bump.has(f.id) ? { ...f, z: bump.get(f.id)! } : f,
          ),
          bookmarks: prev.bookmarks.map((b) =>
            bump.has(b.id) ? { ...b, z: bump.get(b.id)! } : b,
          ),
          notes: prev.notes.map((n) =>
            bump.has(n.id) ? { ...n, z: bump.get(n.id)! } : n,
          ),
          images: prev.images.map((i) =>
            bump.has(i.id) ? { ...i, z: bump.get(i.id)! } : i,
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
            (n) => n.folderId == null || !idSet.has(n.folderId),
          ),
          images: prev.images.filter(
            (i) => i.folderId == null || !idSet.has(i.folderId),
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
        notes: prev.notes.map((n) =>
          n.id === id ? { ...n, ...style } : n,
        ),
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

    async createBookmark(folderId, url, x, y) {
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

      try {
        const meta = await enrichLink({ data: { url: normalized } })
        patch((prev) => ({
          ...prev,
          bookmarks: prev.bookmarks.map((b) =>
            b.id === created.id
              ? {
                  ...b,
                  title: meta.title || b.title,
                  description: meta.description,
                  imageUrl: meta.imageUrl,
                  faviconUrl: meta.faviconUrl || b.faviconUrl,
                }
              : b,
          ),
        }))
      } catch {
        // keep optimistic card
      }

      return created
    },

    renameBookmark(id, title) {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id ? { ...b, title } : b,
        ),
      }))
    },

    resizeItem(id, rect) {
      commit((prev) => ({
        ...prev,
        bookmarks: prev.bookmarks.map((b) =>
          b.id === id
            ? { ...b, x: rect.x, width: rect.width, height: rect.height }
            : b,
        ),
        notes: prev.notes.map((n) =>
          n.id === id
            ? { ...n, x: rect.x, width: rect.width, height: rect.height }
            : n,
        ),
        images: prev.images.map((i) =>
          i.id === id
            ? { ...i, x: rect.x, width: rect.width, height: rect.height }
            : i,
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
            : b,
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
        prev.hasOnboarded ? prev : { ...prev, hasOnboarded: true },
      )
    },

    async enrichMissingBookmarks() {
      const missing = state.bookmarks.filter((b) => !b.imageUrl)
      if (missing.length === 0) return

      await Promise.all(
        missing.map(async (bookmark) => {
          try {
            const meta = await enrichLink({ data: { url: bookmark.url } })
            patch((prev) => ({
              ...prev,
              bookmarks: prev.bookmarks.map((b) =>
                b.id === bookmark.id
                  ? {
                      ...b,
                      title: meta.title || b.title,
                      description: meta.description ?? b.description,
                      imageUrl: meta.imageUrl ?? b.imageUrl,
                      faviconUrl: meta.faviconUrl || b.faviconUrl,
                    }
                  : b,
              ),
            }))
          } catch {
            // leave bookmark as-is
          }
        }),
      )
    },
  }

  return {
    getState: () => state,
    getHistory,
    getReady: () => ready,
    subscribe: (listener: Listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    actions,
    getSyncEngine: () => syncEngine,
    attachSync(engine: SyncEngine) {
      syncEngine = engine
      // Load the state that the SyncEngine already fetched from the cloud
      // (or the per-user cache). The engine stores its loaded state
      // internally; we pull it via the cloud-load path below.
      //
      // The actual state replacement happens in `hydrateForSync()` which
      // is called right after this by the provider.
    },
    detachSync() {
      syncEngine = null
      pendingDeletedImageIds.clear()
    },
    replaceState(newState: MarkxState) {
      state = newState
      past = []
      future = []
      emit()
      // Persist to whichever backend is active.
      persist()
    },
    async hydrate() {
      state = await localMarkxStorage.load()
      past = []
      future = []
      ready = true
      emit()
      void actions.enrichMissingBookmarks()
      // Sweep orphaned image blobs (from deleted images in previous sessions)
      const referencedImageIds = new Set(state.images.map((i) => i.imageId))
      void sweepOrphanImageBlobs(referencedImageIds)
    },
    markReady() {
      ready = true
      emit()
      void actions.enrichMissingBookmarks()
      const referencedImageIds = new Set(state.images.map((i) => i.imageId))
      void sweepOrphanImageBlobs(referencedImageIds)
    },
    async resolveConflictUseCloud() {
      if (!syncEngine) return
      const cloudState = await syncEngine.resolveConflictUseCloud()
      state = cloudState
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

export function MarkxProvider({ children }: { children: ReactNode }) {
  // Always start false so SSR + first client paint match (singleton may already be ready after HMR).
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function init() {
      // Check if the user is already logged in (e.g. returning session).
      try {
        const authClient = await getAuthClient()
        const { data } = await authClient.getSession()
        const user = data?.user

        if (cancelled) return

        if (user) {
          // Authenticated: create a SyncEngine and load from cloud.
          const engine = await SyncEngine.create(user.id)
          if (cancelled) {
            engine.destroy()
            return
          }
          store.attachSync(engine)
          const loaded = engine.getLoadedState()
          if (loaded) {
            store.replaceState(loaded)
          }
          store.markReady()
          setReady(true)
        } else {
          // Guest mode: load from local IndexedDB.
          await store.hydrate()
          if (cancelled) return
          setReady(true)
        }
      } catch {
        // Auth check failed — fall back to guest mode.
        if (cancelled) return
        await store.hydrate()
        if (cancelled) return
        setReady(true)
      }
    }

    void init()

    return () => {
      cancelled = true
    }
  }, [])

  const api: MarkxStoreApi = {
    getState: store.getState,
    getHistory: store.getHistory,
    subscribe: store.subscribe,
    actions: store.actions,
    ready,
    getSyncEngine: store.getSyncEngine,
    attachSync: store.attachSync,
    detachSync: store.detachSync,
    replaceState: store.replaceState,
    hydrate: store.hydrate,
    markReady: store.markReady,
    resolveConflictUseCloud: store.resolveConflictUseCloud,
    resolveConflictOverwriteCloud: store.resolveConflictOverwriteCloud,
  }

  if (!ready) {
    return <div className="markx-dot-bg h-svh" aria-busy="true" />
  }

  return (
    <MarkxStoreContext.Provider value={api}>{children}</MarkxStoreContext.Provider>
  )
}

export function useMarkxStore(): MarkxStoreApi {
  const ctx = useContext(MarkxStoreContext)
  if (!ctx) throw new Error("useMarkxStore must be used within MarkxProvider")
  return ctx
}

export function useMarkxState(): MarkxState {
  const storeApi = useMarkxStore()
  return useSyncExternalStore(
    storeApi.subscribe,
    storeApi.getState,
    storeApi.getState,
  )
}

export function useMarkxHistory(): MarkxHistory {
  const storeApi = useMarkxStore()
  return useSyncExternalStore(
    storeApi.subscribe,
    storeApi.getHistory,
    storeApi.getHistory,
  )
}

export function useMarkxActions(): MarkxActions {
  return useMarkxStore().actions
}
