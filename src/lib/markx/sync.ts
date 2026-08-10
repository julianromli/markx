import type { SaveResult, WorkspaceSnapshot } from "@/lib/server/workspace"
import { blobToDataUrl, dataUrlToBlob } from "@/lib/data-url"
import { createEmptyState } from "@/lib/markx/state"
import { mergeWorkspaceStates } from "@/lib/markx/merge-workspace"
import {
  addDeletedImageIds,
  clearDeletedImageIds,
  clearUserCache,
  getAssetQueue,
  getCloudVersion,
  getDeletedImageIds,
  getImageBlob,
  getPendingSnapshot,
  enqueueAsset,
  isGuestImported,
  loadState,
  loadUserState,
  markGuestImported,
  removeAssetsFromQueue,
  resetGuestState,
  saveImageBlob,
  saveUserState,
  setCloudVersion,
  setPendingSnapshot,
} from "@/lib/markx/storage"
import type { PendingAsset } from "@/lib/markx/storage"
import {
  SYNC_RETRY_DEBOUNCE_MS,
  SYNC_STATE_DEBOUNCE_MS,
} from "@/lib/markx/sync-timings"
import type { MarkxState } from "@/lib/markx/types"

export { mergeWorkspaceStates } from "@/lib/markx/merge-workspace"

/**
 * Sync status shown in the header.
 *
 * - `idle`     — guest mode, no cloud sync.
 * - `saved`    — all changes persisted to cloud; nothing pending.
 * - `saving`   — a save is in flight.
 * - `offline`  — navigator is offline; changes are queued locally.
 * - `conflict` — the cloud version moved ahead; user must choose.
 */
export type SyncStatus =
  "idle" | "saved" | "saving" | "offline" | "conflict" | "error"

export type ConflictData = {
  cloudVersion: number
  cloudState: MarkxState
  cloudUpdatedAt: string
}

type SyncListener = (
  status: SyncStatus,
  conflict?: ConflictData,
  /** When set, the store should adopt this as the authoritative workspace. */
  authoritativeState?: MarkxState
) => void

export type WorkspaceSyncDependency = {
  load: () => Promise<WorkspaceSnapshot | null>
  save: (input: {
    state: MarkxState
    baseVersion: number
    deletedImageIds: string[]
  }) => Promise<SaveResult>
  importGuest: (state: MarkxState) => Promise<SaveResult>
  overwrite: (input: {
    state: MarkxState
    deletedImageIds: string[]
  }) => Promise<SaveResult>
}

export type AssetSyncDependency = {
  upload: (asset: PendingAsset) => Promise<{ ok: boolean }>
  fetch: (
    imageId: string
  ) => Promise<{ ok: true; dataUrl: string } | { ok: false }>
}

export type SyncStorageDependency = {
  loadGuestState: () => Promise<MarkxState>
  resetGuestState: () => Promise<MarkxState>
  loadUserState: (userId: string) => Promise<MarkxState | null>
  saveUserState: (userId: string, state: MarkxState) => Promise<void>
  clearUserCache: (userId: string) => Promise<void>
  getCloudVersion: (userId: string) => Promise<number>
  setCloudVersion: (userId: string, version: number) => Promise<void>
  isGuestImported: (userId: string) => Promise<boolean>
  markGuestImported: (userId: string) => Promise<void>
  getPendingSnapshot: (userId: string) => Promise<MarkxState | null>
  setPendingSnapshot: (
    userId: string,
    state: MarkxState | null
  ) => Promise<void>
  addDeletedImageIds: (userId: string, ids: string[]) => Promise<string[]>
  getDeletedImageIds: (userId: string) => Promise<string[]>
  clearDeletedImageIds: (userId: string) => Promise<void>
  getAssetQueue: (userId: string) => Promise<PendingAsset[]>
  enqueueAsset: (userId: string, asset: PendingAsset) => Promise<void>
  removeAssetsFromQueue: (
    userId: string,
    uploadedImageIds: readonly string[]
  ) => Promise<void>
  saveImageBlob: (id: string, blob: Blob) => Promise<void>
  getImageBlob: (id: string) => Promise<Blob | undefined>
}

export type SyncEngineDependencies = {
  workspace: WorkspaceSyncDependency
  assets: AssetSyncDependency
  storage: SyncStorageDependency
}

const defaultSyncEngineDependencies: SyncEngineDependencies = {
  workspace: {
    async load() {
      const { loadWorkspace } = await import("@/lib/server/workspace")
      return loadWorkspace()
    },
    async save(input) {
      const { saveWorkspace } = await import("@/lib/server/workspace")
      return saveWorkspace({ data: input })
    },
    async importGuest(state) {
      const { importGuestWorkspace } = await import("@/lib/server/workspace")
      return importGuestWorkspace({ data: { state } })
    },
    async overwrite(input) {
      const { overwriteWorkspace } = await import("@/lib/server/workspace")
      return overwriteWorkspace({ data: input })
    },
  },
  assets: {
    async upload(asset) {
      const { uploadImageAsset } = await import("@/lib/server/assets")
      return uploadImageAsset({ data: asset })
    },
    async fetch(imageId) {
      const { fetchImageAsset } = await import("@/lib/server/assets")
      return fetchImageAsset({ data: { imageId } })
    },
  },
  storage: {
    loadGuestState: loadState,
    resetGuestState,
    loadUserState,
    saveUserState,
    clearUserCache,
    getCloudVersion,
    setCloudVersion,
    isGuestImported,
    markGuestImported,
    getPendingSnapshot,
    setPendingSnapshot,
    addDeletedImageIds,
    getDeletedImageIds,
    clearDeletedImageIds,
    getAssetQueue,
    enqueueAsset,
    removeAssetsFromQueue,
    saveImageBlob,
    getImageBlob,
  },
}

/**
 * Whether a cloud snapshot should be ignored in favor of keeping the
 * current local/cache state (pending offline edits, in-flight local
 * edits, or an unresolved conflict).
 */
export function shouldKeepLocalAfterCloudRefresh(opts: {
  hasPendingSnapshot: boolean
  localEditsSinceLoad: boolean
  hasDebouncedEdit: boolean
  status: SyncStatus
}): boolean {
  return (
    opts.hasPendingSnapshot ||
    opts.localEditsSinceLoad ||
    opts.hasDebouncedEdit ||
    opts.status === "conflict"
  )
}

/**
 * SyncEngine orchestrates the local ↔ cloud sync for a single logged-in
 * user. It is created on login and destroyed on sign-out.
 *
 * Responsibilities:
 *  1. Hydrate from the per-user IndexedDB cache for instant revisit paint.
 *  2. Refresh from the cloud in the background (or await on first login).
 *  3. Debounce local state changes and push coalesced snapshots to the
 *     cloud with optimistic version control.
 *  4. Queue writes when offline and flush them on reconnect.
 *  5. Surface mid-session conflicts to the UI so the user can choose
 *     "use cloud" or "overwrite cloud". Guest-vs-cloud at login is
 *     silent cloud-wins (no dialog).
 *  6. Upload queued image assets to R2.
 */
export class SyncEngine {
  private userId: string
  private cloudVersion = 0
  private currentState: MarkxState | null = null
  private status: SyncStatus = "saving"
  private conflict: ConflictData | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private isSyncing = false
  private online = true
  private listeners = new Set<SyncListener>()
  private destroyed = false
  /** True when IndexedDB already had a per-user snapshot for this user. */
  private hadCachedState = false
  /** True after the user edits locally (debounce scheduled) during init refresh. */
  private localEditsSinceLoad = false
  /**
   * Bumped only by {@link onStateChange} so an in-flight save can detect
   * mid-save user edits without treating merge-retry updates as edits.
   */
  private editGeneration = 0
  private dependencies: SyncEngineDependencies

  private constructor(userId: string, dependencies: SyncEngineDependencies) {
    this.userId = userId
    this.dependencies = dependencies
    this.online = typeof navigator !== "undefined" ? navigator.onLine : true
  }

  /**
   * Create and fully initialize a SyncEngine (blocking).
   *
   * Used on explicit login (`onLoginSuccess`) where waiting for cloud is
   * expected. Returning visits should use {@link createFromCache} +
   * {@link refreshFromCloud} instead so the UI can paint from IndexedDB
   * immediately.
   *
   * Guest board edits are discarded: login always loads the cloud workspace
   * (or an empty cloud board) and resets the guest store.
   */
  static async create(
    userId: string,
    dependencies: SyncEngineDependencies = defaultSyncEngineDependencies
  ): Promise<SyncEngine> {
    const engine = new SyncEngine(userId, dependencies)
    await engine.initFromCache()
    await engine.refreshFromCloud()
    return engine
  }

  /**
   * Create a SyncEngine hydrated only from the per-user IndexedDB cache.
   * Does not touch the network — call {@link refreshFromCloud} afterwards
   * (typically in the background after the UI has painted).
   */
  static async createFromCache(
    userId: string,
    dependencies: SyncEngineDependencies = defaultSyncEngineDependencies
  ): Promise<SyncEngine> {
    const engine = new SyncEngine(userId, dependencies)
    await engine.initFromCache()
    return engine
  }

  /**
   * Whether this engine had a per-user IndexedDB snapshot at create time.
   * Used by the provider to decide whether it can paint immediately or
   * must wait on the first cloud load.
   */
  hasCachedState(): boolean {
    return this.hadCachedState
  }

  getUserId(): string {
    return this.userId
  }

  private async initFromCache(): Promise<void> {
    this.cloudVersion = await this.dependencies.storage.getCloudVersion(
      this.userId
    )
    const cached = await this.dependencies.storage.loadUserState(this.userId)
    if (cached) {
      this.hadCachedState = true
      this.currentState = cached
      console.info("[markx sync] hydrated from per-user cache")
    } else {
      this.hadCachedState = false
      this.currentState = createEmptyState()
      console.info(
        "[markx sync] no per-user cache — using empty onboarded state"
      )
    }
    // "saving" while a background cloud refresh may still be in flight.
    this.setStatus(this.online ? "saving" : "offline")
    this.attachOnlineListeners()
    this.startRealtimeRefresh()
  }

  /**
   * Mark first-login bootstrap complete and reset the guest store to demo.
   * No-ops when the flag is already set.
   */
  private async finalizeFirstLoginBootstrap(): Promise<void> {
    if (await this.dependencies.storage.isGuestImported(this.userId)) return
    await this.dependencies.storage.markGuestImported(this.userId)
    await this.dependencies.storage.resetGuestState()
  }

  private isDestroyed(): boolean {
    return this.destroyed
  }

  /**
   * Fetch the workspace from the cloud and update the local cache.
   *
   * Returns the cloud (or merged) state when the UI should adopt it, or
   * `null` when the existing local/cache state should be kept (network
   * failure, no snapshot).
   */
  async refreshFromCloud(): Promise<MarkxState | null> {
    if (this.isDestroyed()) return null

    try {
      console.info("[markx sync] loading workspace from cloud")
      console.info("[markx sync] calling loadWorkspace server fn")
      const snapshot = await this.dependencies.workspace.load()
      if (this.isDestroyed()) return null
      console.info(
        "[markx sync] loadWorkspace returned",
        snapshot ? `version=${snapshot.version}` : "null"
      )

      if (!snapshot) {
        this.setStatus(this.online ? "saved" : "offline")
        return null
      }

      const previousCloudVersion = this.cloudVersion

      const pending = await this.dependencies.storage.getPendingSnapshot(
        this.userId
      )
      if (
        shouldKeepLocalAfterCloudRefresh({
          hasPendingSnapshot: Boolean(pending),
          localEditsSinceLoad: this.localEditsSinceLoad,
          hasDebouncedEdit: this.debounceTimer !== null,
          status: this.status,
        })
      ) {
        if (this.status === "conflict") {
          console.info(
            "[markx sync] keeping local state after cloud refresh (unresolved conflict)"
          )
          return null
        }

        // Remote moved ahead while this device has local edits: merge by id
        // (cloud wins on same id), then push the union.
        if (snapshot.version > previousCloudVersion) {
          const local = pending ?? this.currentState
          if (!local) return null

          const merged = mergeWorkspaceStates(local, snapshot.state)
          this.cloudVersion = snapshot.version
          await this.dependencies.storage.setCloudVersion(
            this.userId,
            snapshot.version
          )
          this.currentState = merged
          await this.dependencies.storage.saveUserState(this.userId, merged)
          await this.dependencies.storage.setPendingSnapshot(
            this.userId,
            merged
          )
          await this.finalizeFirstLoginBootstrap()
          if (this.online) {
            void this.sync()
          }
          this.setStatus(this.online ? "saving" : "offline", merged)
          return merged
        }

        console.info(
          "[markx sync] keeping local state after cloud refresh (pending local edits)"
        )
        if (pending) {
          this.currentState = pending
        }
        await this.finalizeFirstLoginBootstrap()
        if (this.online) {
          void this.sync()
        } else {
          this.setStatus("offline")
        }
        return null
      }

      this.cloudVersion = snapshot.version
      await this.dependencies.storage.setCloudVersion(
        this.userId,
        snapshot.version
      )
      this.currentState = snapshot.state
      await this.dependencies.storage.saveUserState(this.userId, snapshot.state)
      await this.finalizeFirstLoginBootstrap()
      this.setStatus("saved", snapshot.state)
      return snapshot.state
    } catch (err) {
      console.error("[markx sync] loadWorkspace failed, keeping cache", err)
      if (this.isDestroyed()) return null
      this.setStatus(this.online ? "saved" : "offline")
      return null
    }
  }

  /**
   * Called by the store whenever local state changes. Debounces and
   * coalesces writes into a single sync.
   */
  onStateChange(state: MarkxState, deletedImageIds: string[] = []): void {
    if (this.destroyed) return
    this.currentState = state
    this.localEditsSinceLoad = true
    this.editGeneration += 1

    // Always cache locally for instant load + offline.
    void this.dependencies.storage.saveUserState(this.userId, state)

    // Accumulate deleted image IDs for the next sync.
    if (deletedImageIds.length > 0) {
      void this.dependencies.storage.addDeletedImageIds(
        this.userId,
        deletedImageIds
      )
    }

    if (this.status === "conflict") {
      // Don't auto-sync while a conflict is unresolved; just keep caching.
      void this.dependencies.storage.setPendingSnapshot(this.userId, state)
      return
    }

    if (!this.online) {
      void this.dependencies.storage.setPendingSnapshot(this.userId, state)
      this.setStatus("offline")
      return
    }

    // Debounce the cloud write.
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      void this.sync()
    }, SYNC_STATE_DEBOUNCE_MS)
  }

  /**
   * Push the current state to the cloud with optimistic version control.
   */
  private async sync(): Promise<void> {
    if (this.isSyncing || this.destroyed || !this.currentState) return
    this.isSyncing = true
    this.setStatus("saving")

    try {
      // Flush any queued image assets first.
      await this.flushAssetQueue()

      const sentState = this.currentState
      const generationAtStart = this.editGeneration
      const baseVersion = this.cloudVersion
      const deletedImageIds =
        await this.dependencies.storage.getDeletedImageIds(this.userId)

      const result = await this.saveWithAutomaticMerge(
        sentState,
        baseVersion,
        deletedImageIds
      )

      if (result.ok) {
        this.cloudVersion = result.version
        await this.dependencies.storage.setCloudVersion(
          this.userId,
          result.version
        )
        await this.retireDeletedImageIds(deletedImageIds)

        if (this.editGeneration === generationAtStart) {
          await this.dependencies.storage.setPendingSnapshot(this.userId, null)
          this.currentState = result.state
          this.localEditsSinceLoad = false
          await this.dependencies.storage.saveUserState(
            this.userId,
            result.state
          )
          this.setStatus("saved", result.state)
        } else {
          // User edited while the save was in flight. Keep local-only
          // entities; server/cloud wins on the same id.
          const live = this.currentState ?? result.state
          const adopted = mergeWorkspaceStates(live, result.state)
          this.currentState = adopted
          await this.dependencies.storage.saveUserState(this.userId, adopted)
          await this.dependencies.storage.setPendingSnapshot(
            this.userId,
            adopted
          )
          this.localEditsSinceLoad = true
          this.setStatus("saved", adopted)
          this.scheduleFlush()
        }
      } else if (result.reason === "conflict") {
        this.conflict = {
          cloudVersion: result.cloudVersion,
          cloudState: result.cloudState,
          cloudUpdatedAt: result.cloudUpdatedAt,
        }
        this.cloudVersion = result.cloudVersion
        await this.dependencies.storage.setPendingSnapshot(
          this.userId,
          this.currentState
        )
        this.setStatus("conflict")
      } else if (result.reason === "entity_limit") {
        await this.dependencies.storage.setPendingSnapshot(
          this.userId,
          sentState
        )
        this.setStatus("error")
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("markx:entity-limit", {
              detail: {
                message: result.message,
                limit: result.limit,
                entityCount: result.entityCount,
              },
            })
          )
        }
      } else {
        // Generic error — keep the pending snapshot and mark as error
        // so the UI shows a retry indicator instead of "saved".
        await this.dependencies.storage.setPendingSnapshot(
          this.userId,
          sentState
        )
        this.setStatus("error")
      }
    } catch {
      // Network error — queue and mark offline.
      await this.dependencies.storage.setPendingSnapshot(
        this.userId,
        this.currentState
      )
      this.setStatus("offline")
    } finally {
      this.isSyncing = false
    }
  }

  /**
   * Drop only the deleted-image ids that this save attempted to flush so
   * mid-save deletions stay queued.
   */
  private async retireDeletedImageIds(sentIds: string[]): Promise<void> {
    if (sentIds.length === 0) return
    const current = await this.dependencies.storage.getDeletedImageIds(
      this.userId
    )
    const sent = new Set(sentIds)
    const remaining = current.filter((id) => !sent.has(id))
    await this.dependencies.storage.clearDeletedImageIds(this.userId)
    if (remaining.length > 0) {
      await this.dependencies.storage.addDeletedImageIds(
        this.userId,
        remaining
      )
    }
  }

  private async saveWithAutomaticMerge(
    state: MarkxState,
    baseVersion: number,
    deletedImageIds: string[],
    attempt = 0
  ): Promise<SaveResult> {
    const result = await this.dependencies.workspace.save({
      state,
      baseVersion,
      deletedImageIds,
    })
    if (result.ok || result.reason !== "conflict" || attempt >= 2) {
      return result
    }

    // Prefer live local state so mid-flight user adds are included in the
    // retry merge. Do not bump editGeneration here.
    const localBase = this.currentState ?? state
    const merged = mergeWorkspaceStates(localBase, result.cloudState)
    this.currentState = merged
    this.cloudVersion = result.cloudVersion
    await this.dependencies.storage.setCloudVersion(
      this.userId,
      result.cloudVersion
    )
    await this.dependencies.storage.setPendingSnapshot(this.userId, merged)

    return this.saveWithAutomaticMerge(
      merged,
      result.cloudVersion,
      deletedImageIds,
      attempt + 1
    )
  }

  /**
   * Upload any queued image assets to R2. Called before a snapshot sync
   * so the server has the blobs by the time it records the metadata.
   */
  private async flushAssetQueue(): Promise<void> {
    const queue = await this.dependencies.storage.getAssetQueue(this.userId)
    if (queue.length === 0) return

    const uploadedImageIds: string[] = []
    for (const asset of queue) {
      try {
        const result = await this.dependencies.assets.upload(asset)
        if (result.ok) uploadedImageIds.push(asset.imageId)
      } catch {
        // Keep failed uploads queued for the next sync.
      }
    }

    // Remove only confirmed uploads in one transaction. Assets enqueued
    // while this flush was running remain intact.
    await this.dependencies.storage.removeAssetsFromQueue(
      this.userId,
      uploadedImageIds
    )
  }

  private async enqueueAssetInternal(asset: PendingAsset): Promise<void> {
    await this.dependencies.storage.enqueueAsset(this.userId, asset)
  }

  /**
   * Enqueue a new image for upload to R2. Also caches the blob locally so
   * it renders immediately.
   */
  async enqueueAsset(imageId: string, blob: Blob, mime: string): Promise<void> {
    await this.dependencies.storage.saveImageBlob(imageId, blob)
    const dataUrl = await blobToDataUrl(blob)
    await this.enqueueAssetInternal({ imageId, mime, dataUrl })
    // Trigger a sync to flush the queue promptly.
    this.scheduleFlush()
  }

  /**
   * Fetch an image blob from R2 (via the authenticated Worker endpoint)
   * and cache it in IndexedDB for subsequent renders.
   */
  async fetchAsset(imageId: string): Promise<Blob | undefined> {
    // Check the local cache first.
    const cached = await this.dependencies.storage.getImageBlob(imageId)
    if (cached) return cached
    if (!this.online) return undefined

    try {
      const result = await this.dependencies.assets.fetch(imageId)
      if (!result.ok) return undefined
      const blob = dataUrlToBlob(result.dataUrl)
      await this.dependencies.storage.saveImageBlob(imageId, blob)
      return blob
    } catch {
      return undefined
    }
  }

  /* ---------------------------------------------------------------- */
  /* Conflict resolution (called by the UI)                           */
  /* ---------------------------------------------------------------- */

  /**
   * Resolve a conflict by keeping the cloud version. Discards local
   * pending changes and updates the local cache.
   */
  async resolveConflictUseCloud(): Promise<MarkxState> {
    if (!this.conflict) throw new Error("No active conflict")
    const state = this.conflict.cloudState
    this.cloudVersion = this.conflict.cloudVersion
    await this.dependencies.storage.setCloudVersion(
      this.userId,
      this.cloudVersion
    )
    await this.dependencies.storage.setPendingSnapshot(this.userId, null)
    await this.dependencies.storage.clearDeletedImageIds(this.userId)
    this.currentState = state
    await this.dependencies.storage.saveUserState(this.userId, state)
    this.conflict = undefined
    this.setStatus("saved")
    return state
  }

  /**
   * Resolve a conflict by overwriting the cloud with the local version.
   */
  async resolveConflictOverwriteCloud(): Promise<void> {
    if (!this.currentState) return
    const state = this.currentState
    const deletedImageIds = await this.dependencies.storage.getDeletedImageIds(
      this.userId
    )

    const result = await this.dependencies.workspace.overwrite({
      state,
      deletedImageIds,
    })

    if (result.ok) {
      this.cloudVersion = result.version
      await this.dependencies.storage.setCloudVersion(
        this.userId,
        result.version
      )
      await this.dependencies.storage.clearDeletedImageIds(this.userId)
      await this.dependencies.storage.setPendingSnapshot(this.userId, null)
      this.currentState = result.state
      this.conflict = undefined
      this.setStatus("saved", result.state)
    }
  }

  getConflict(): ConflictData | undefined {
    return this.conflict
  }

  /** The workspace cloud version last confirmed by the server. */
  getCloudVersion(): number {
    return this.cloudVersion
  }

  /**
   * Adopt a workspace state + version produced by an out-of-band server
   * operation (e.g. lifting a folder into a shared board). Caches the
   * state, advances the cloud version, and emits it as authoritative so
   * the store replaces its working state without scheduling a save.
   */
  async adoptExternalWorkspaceUpdate(
    newState: MarkxState,
    newVersion: number
  ): Promise<void> {
    if (this.destroyed) return
    this.cloudVersion = newVersion
    this.currentState = newState
    this.localEditsSinceLoad = false
    await this.dependencies.storage.setCloudVersion(this.userId, newVersion)
    await this.dependencies.storage.saveUserState(this.userId, newState)
    await this.dependencies.storage.setPendingSnapshot(this.userId, null)
    this.setStatus("saved", newState)
  }

  /* ---------------------------------------------------------------- */
  /* Online / offline handling                                         */
  /* ---------------------------------------------------------------- */

  private attachOnlineListeners(): void {
    if (typeof window === "undefined") return
    window.addEventListener("online", this.handleOnline)
    window.addEventListener("offline", this.handleOffline)
  }

  private handleOnline = async () => {
    this.online = true

    // First login that never reached the cloud yet.
    if (!(await this.dependencies.storage.isGuestImported(this.userId))) {
      const cloudState = await this.refreshFromCloud()
      if (this.isDestroyed()) return
      if (cloudState) {
        this.setStatus("saved", cloudState)
      }
      return
    }

    // Flush any pending snapshot that accumulated while offline.
    const pending = await this.dependencies.storage.getPendingSnapshot(
      this.userId
    )
    if (pending && this.status !== "conflict") {
      this.currentState = pending
      await this.sync()
    } else {
      this.setStatus(this.status === "conflict" ? "conflict" : "saved")
    }
  }

  private handleOffline = () => {
    this.online = false
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.currentState) {
      void this.dependencies.storage.setPendingSnapshot(
        this.userId,
        this.currentState
      )
    }
    this.setStatus("offline")
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.sync(), SYNC_RETRY_DEBOUNCE_MS)
  }

  /**
   * Poll the versioned snapshot so another device's save appears without a
   * manual reload. Polling is intentionally small and uses the existing API.
   */
  private startRealtimeRefresh(): void {
    if (typeof window === "undefined" || this.refreshTimer) return
    this.refreshTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return
      void this.refreshFromCloud()
    }, 2000)
  }

  /* ---------------------------------------------------------------- */
  /* Status + subscription                                             */
  /* ---------------------------------------------------------------- */

  getStatus(): SyncStatus {
    return this.status
  }

  /**
   * The workspace state the engine loaded from the cloud (or cache).
   * The store reads this on login to replace the guest state.
   */
  getLoadedState(): MarkxState | null {
    return this.currentState
  }

  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setStatus(status: SyncStatus, authoritativeState?: MarkxState): void {
    if (this.status === status && !authoritativeState) return
    this.status = status
    for (const listener of this.listeners) {
      listener(status, this.conflict, authoritativeState)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Teardown                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Flush pending changes, then tear down listeners. Called on sign-out
   * after the user confirms pending changes are synced.
   */
  async flushAndDestroy(): Promise<boolean> {
    // Try one final sync.
    if (this.currentState && this.status !== "conflict") {
      await this.sync()
    }
    const pending = await this.dependencies.storage.getPendingSnapshot(
      this.userId
    )
    const deletedImageIds = await this.dependencies.storage.getDeletedImageIds(
      this.userId
    )
    const assetQueue = await this.dependencies.storage.getAssetQueue(
      this.userId
    )
    const canClearCache =
      this.status === "saved" &&
      !pending &&
      deletedImageIds.length === 0 &&
      assetQueue.length === 0
    this.destroy()
    return canClearCache
  }

  /**
   * Destroy the engine without syncing. Clears the per-user cache so the
   * next user starts fresh.
   */
  destroy(): void {
    this.destroyed = true
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.handleOnline)
      window.removeEventListener("offline", this.handleOffline)
    }
    this.listeners.clear()
  }

  /**
   * Clear the per-user cache (called on sign-out after flush).
   */
  async clearCache(): Promise<void> {
    await this.dependencies.storage.clearUserCache(this.userId)
  }
}

export { blobToDataUrl, dataUrlToBlob }
export { isGuestModified } from "./state"
