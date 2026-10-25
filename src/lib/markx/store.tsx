import { nanoid } from "nanoid"

import {
  deleteItems as deleteBoardItems,
  moveItems as moveBoardItems,
  parseBookmarkUrl,
} from "./board-items"
import { enrichLink } from "./enrich"
import { cloneState, createEmptyState, nextZ } from "./state"
import { localMarkxStorage, sweepOrphanImageBlobs } from "./storage"
import type { MarkxStorage } from "./storage"
import type { SyncEngine } from "./sync"
import {
  STORE_ENRICH_BATCH_WINDOW_MS,
  STORE_PERSIST_DEBOUNCE_MS,
} from "./sync-timings"
import type {
  BoardImage,
  Bookmark,
  Folder,
  LinkMetadata,
  MarkxState,
  Note,
} from "./types"
import type { WorkspaceLocation } from "./workspace-items"
import { youtubeOptimisticImageUrl } from "./youtube"

type Listener = () => void
type PositionUpdate = { id: string; x: number; y: number; z?: number }

const MAX_HISTORY = 50

/**
 * True when `ids` already sit above every other item, in the given order.
 * Raising them again would only rewrite and re-sync the workspace.
 */
function isAlreadyOnTop(state: MarkxState, ids: readonly string[]): boolean {
  const wanted = new Set(ids)
  let othersMax = -Infinity
  const zById = new Map<string, number>()
  for (const list of [
    state.folders,
    state.bookmarks,
    state.notes,
    state.images,
  ]) {
    for (const item of list) {
      if (wanted.has(item.id)) zById.set(item.id, item.z)
      else othersMax = Math.max(othersMax, item.z)
    }
  }
  let previous = othersMax
  for (const id of ids) {
    const z = zById.get(id)
    if (z == null || z <= previous) return false
    previous = z
  }
  return true
}

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
  if (
    !state.bookmarks.some((bookmark) => bookmark.enrichStatus === "pending")
  ) {
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
  /**
   * Updates from one editing `session` (autosave drafts plus the final
   * commit) share a single undo step. An unchanged content is a no-op.
   */
  updateNoteContent: (
    id: string,
    content: string,
    opts?: { session?: string }
  ) => void
  setNoteStyle: (
    id: string,
    style: Partial<Pick<Note, "color" | "font" | "fontSize">>
  ) => void
  deleteNotes: (ids: string[]) => Note[]
  createImage: (meta: Omit<BoardImage, "z">) => BoardImage
  deleteImages: (ids: string[]) => BoardImage[]
  /**
   * Returns the optimistic bookmark synchronously so callers can select it right
   * away. Open Graph metadata arrives later via a background patch. Returns
   * null when `url` is not a valid http(s) link.
   */
  createBookmark: (
    folderId: string,
    url: string,
    x: number,
    y: number
  ) => Bookmark | null
  renameBookmark: (id: string, title: string) => void
  resizeItem: (
    id: string,
    rect: { x: number; width: number; height: number }
  ) => void
  resetSizes: (ids: string[]) => void
  /**
   * Move bookmarks, notes, and images to Home or a folder (see
   * board-items.ts for what can live where). Returns what moved.
   */
  moveItems: (
    ids: string[],
    target: WorkspaceLocation
  ) => { moved: number; skipped: number }
  deleteBookmarks: (ids: string[]) => Bookmark[]
  /**
   * Delete any mix of items in one undo step. Deleting a folder also
   * deletes everything inside it.
   */
  deleteItems: (ids: string[]) => {
    folders: number
    bookmarks: number
    notes: number
    images: number
  }
  /** Id of the latest undo step, for toast "Undo" buttons. */
  lastEntryId: () => number | null
  /**
   * Undo `entryId` only if it is still the latest step. Returns false (and
   * changes nothing) when newer changes came after it.
   */
  undoEntry: (entryId: number | null) => boolean
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
  /**
   * Run a pending debounced save now. `unloading` also writes the guest
   * state synchronously, since async storage may not finish before unload.
   */
  flush: (opts?: { unloading?: boolean }) => void
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
  type HistoryEntry = { id: number; snapshot: MarkxState }
  let past: HistoryEntry[] = []
  let future: HistoryEntry[] = []
  let nextEntryId = 1

  /**
   * Enrich bookkeeping, so undo/redo can restore a bookmark snapshot taken
   * while its enrich was pending without a shimmer that never ends.
   */
  const enrichInFlight = new Set<string>()
  const enrichResults = new Map<string, LinkMetadata | null>()

  const reconcileEnrich = (snapshot: MarkxState): MarkxState => {
    if (!snapshot.bookmarks.some((b) => b.enrichStatus === "pending")) {
      return snapshot
    }
    return {
      ...snapshot,
      bookmarks: snapshot.bookmarks.map((b) => {
        if (b.enrichStatus !== "pending") return b
        if (enrichResults.has(b.id)) {
          const meta = enrichResults.get(b.id)
          return meta
            ? applyBookmarkMetadata(b, meta)
            : { ...b, enrichStatus: "done" as const }
        }
        return enrichInFlight.has(b.id)
          ? b
          : { ...b, enrichStatus: "done" as const }
      }),
    }
  }
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

  let pendingSave: (() => void) | null = null

  /**
   * Single save path. Logged in: every user change goes straight to the
   * sync engine, which owns the only (cloud) debounce. Guest: one local
   * debounce to IndexedDB. Background patches (`sync: false`) are never sent
   * to the engine and never cancel a pending user save.
   */
  const persist = (opts?: { sync?: boolean }) => {
    if (syncEngine) {
      if (opts?.sync === false) return
      const deleted = [...pendingDeletedImageIds]
      pendingDeletedImageIds.clear()
      syncEngine.onStateChange(state, deleted)
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    const run = () => {
      saveTimer = null
      pendingSave = null
      void dependencies.storage.save(state)
    }
    pendingSave = run
    saveTimer = setTimeout(run, STORE_PERSIST_DEBOUNCE_MS)
  }

  const flush = (opts?: { unloading?: boolean }) => {
    if (syncEngine) {
      syncEngine.flushPending()
      return
    }
    if (saveTimer) clearTimeout(saveTimer)
    const hadPending = pendingSave != null
    pendingSave?.()
    if (opts?.unloading && hadPending) {
      dependencies.storage.saveBackup?.(state)
    }
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

  /** Key of the last coalescing commit; see {@link commitCoalesced}. */
  let coalesceKey: string | null = null

  /** Apply a change and push the previous snapshot onto the undo stack. */
  const commit = (updater: (prev: MarkxState) => MarkxState) => {
    coalesceKey = null
    past.push({ id: nextEntryId++, snapshot: cloneState(state) })
    if (past.length > MAX_HISTORY) past.shift()
    future = []
    state = updater(state)
    emit()
    persist()
  }

  /**
   * Like {@link commit}, but consecutive calls with the same key extend the
   * last undo step instead of adding one (note drafts while typing).
   */
  const commitCoalesced = (
    key: string,
    updater: (prev: MarkxState) => MarkxState
  ) => {
    if (coalesceKey !== key || past.length === 0) {
      commit(updater)
      coalesceKey = key
      return
    }
    future = []
    state = updater(state)
    emit()
    persist()
  }

  /** Apply a change without touching history (enrich, raiseZ, etc.). */
  const patch = (
    updater: (prev: MarkxState) => MarkxState,
    opts?: { sync?: boolean }
  ) => {
    state = updater(state)
    emit()
    persist(opts)
  }

  const actions: MarkxActions = {
    undo() {
      coalesceKey = null
      const previous = past.pop()
      if (!previous) return
      future.push({ id: previous.id, snapshot: cloneState(state) })
      state = reconcileEnrich(previous.snapshot)
      emit()
      persist()
    },

    redo() {
      coalesceKey = null
      const next = future.pop()
      if (!next) return
      past.push({ id: next.id, snapshot: cloneState(state) })
      state = reconcileEnrich(next.snapshot)
      emit()
      persist()
    },

    deleteItems(ids) {
      let counts = { folders: 0, bookmarks: 0, notes: 0, images: 0 }
      if (ids.length === 0) return counts
      const result = deleteBoardItems(state, ids)
      counts = result.counts
      if (
        counts.folders + counts.bookmarks + counts.notes + counts.images ===
        0
      ) {
        return counts
      }
      for (const imageId of result.removedImageIds) {
        pendingDeletedImageIds.add(imageId)
      }
      commit(() => result.state)
      return counts
    },

    lastEntryId() {
      return past.at(-1)?.id ?? null
    },

    undoEntry(entryId) {
      if (entryId == null || past.at(-1)?.id !== entryId) return false
      actions.undo()
      return true
    },

    raiseZ(ids) {
      if (ids.length === 0 || isAlreadyOnTop(state, ids)) return
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
      const folderIds = new Set(state.folders.map((f) => f.id))
      actions.deleteItems(ids.filter((id) => folderIds.has(id)))
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

    updateNoteContent(id, content, opts) {
      const current = state.notes.find((n) => n.id === id)
      if (!current || current.content === content) return
      const updater = (prev: MarkxState): MarkxState => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === id ? { ...n, content } : n)),
      })
      if (opts?.session) commitCoalesced(`note:${id}:${opts.session}`, updater)
      else commit(updater)
    },

    setNoteStyle(id, style) {
      commit((prev) => ({
        ...prev,
        notes: prev.notes.map((n) => (n.id === id ? { ...n, ...style } : n)),
      }))
    },

    deleteNotes(ids) {
      const idSet = new Set(ids)
      const removed = state.notes.filter((item) => idSet.has(item.id))
      actions.deleteItems(removed.map((item) => item.id))
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
      const removed = state.images.filter((item) => idSet.has(item.id))
      actions.deleteItems(removed.map((item) => item.id))
      return removed
    },

    createBookmark(folderId, url, x, y) {
      const parsed = parseBookmarkUrl(url)
      if (!parsed.ok) return null
      const normalized = parsed.url
      const host = parsed.host
      const optimisticImage = youtubeOptimisticImageUrl(normalized)
      let created!: Bookmark
      commit((prev) => {
        const { z, zCounter } = nextZ(prev)
        created = {
          id: nanoid(),
          folderId,
          url: normalized,
          title: host.replace(/^www\./, ""),
          faviconUrl: `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
          ...(optimisticImage ? { imageUrl: optimisticImage } : {}),
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
      // Do not mark SyncEngine dirty — the create commit already queued a sync.
      enrichInFlight.add(created.id)
      void (async () => {
        try {
          const meta = await dependencies.enrich({ data: { url: normalized } })
          enrichInFlight.delete(created.id)
          enrichResults.set(created.id, meta)
          patch(
            (prev) => ({
              ...prev,
              bookmarks: prev.bookmarks.map((b) =>
                b.id === created.id ? applyBookmarkMetadata(b, meta) : b
              ),
            }),
            { sync: false }
          )
        } catch {
          enrichInFlight.delete(created.id)
          enrichResults.set(created.id, null)
          // Keep the optimistic card, but clear the loading shimmer.
          patch(
            (prev) => ({
              ...prev,
              bookmarks: prev.bookmarks.map((b) =>
                b.id === created.id ? { ...b, enrichStatus: "done" } : b
              ),
            }),
            { sync: false }
          )
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

    moveItems(ids, target) {
      const result = moveBoardItems(state, ids, target)
      if (result.moved > 0) commit(() => result.state)
      return { moved: result.moved, skipped: result.skipped }
    },

    deleteBookmarks(ids) {
      const idSet = new Set(ids)
      const removed = state.bookmarks.filter((item) => idSet.has(item.id))
      actions.deleteItems(removed.map((item) => item.id))
      return removed
    },

    markxOnboarded() {
      patch((prev) =>
        prev.hasOnboarded ? prev : { ...prev, hasOnboarded: true }
      )
    },

    async enrichMissingBookmarks() {
      const missing = state.bookmarks.filter((b) => !b.imageUrl)
      if (missing.length === 0) return

      // Instant YouTube thumbnails while oEmbed / R2 mirror runs in enrich.
      const youtubeImages = new Map<string, string>()
      for (const bookmark of missing) {
        const imageUrl = youtubeOptimisticImageUrl(bookmark.url)
        if (imageUrl) youtubeImages.set(bookmark.id, imageUrl)
      }
      if (youtubeImages.size > 0) {
        patch(
          (prev) => ({
            ...prev,
            bookmarks: prev.bookmarks.map((b) => {
              const imageUrl = youtubeImages.get(b.id)
              return imageUrl && !b.imageUrl ? { ...b, imageUrl } : b
            }),
          }),
          { sync: false }
        )
      }

      // Fetches run in parallel, but results land in separate tasks — React
      // can't batch across them, so one patch per response would mean one
      // full workspace re-render per bookmark. Collect results and commit
      // them in waves instead. `null` marks a failed enrich (clear shimmer).
      const pendingMeta = new Map<string, LinkMetadata | null>()
      let flushTimer: ReturnType<typeof setTimeout> | null = null

      const flushEnrich = () => {
        flushTimer = null
        if (pendingMeta.size === 0) return
        const batch = new Map(pendingMeta)
        pendingMeta.clear()
        patch(
          (prev) => ({
            ...prev,
            bookmarks: prev.bookmarks.map((b) => {
              if (!batch.has(b.id)) return b
              const meta = batch.get(b.id)
              return meta
                ? applyBookmarkMetadata(b, meta)
                : { ...b, enrichStatus: "done" as const }
            }),
          }),
          { sync: false }
        )
      }

      await Promise.all(
        missing.map(async (bookmark) => {
          try {
            const meta = await dependencies.enrich({
              data: { url: bookmark.url },
            })
            pendingMeta.set(bookmark.id, meta)
            enrichResults.set(bookmark.id, meta)
          } catch {
            pendingMeta.set(bookmark.id, null)
            enrichResults.set(bookmark.id, null)
          }
          flushTimer ??= setTimeout(flushEnrich, STORE_ENRICH_BATCH_WINDOW_MS)
        })
      )

      const cancelPendingFlush = () => {
        if (flushTimer) clearTimeout(flushTimer)
        flushTimer = null
      }
      cancelPendingFlush()
      flushEnrich()
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
      // Adopt authoritative state only for explicit cloud adopts (bootstrap
      // load, stale-banner reload, shared-board lift). Save acks never emit
      // state, so they cannot overwrite newer local edits or undo history.
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
    flush,
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
