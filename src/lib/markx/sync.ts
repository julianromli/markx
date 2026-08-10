import type { SaveResult, WorkspaceSnapshot } from "@/lib/server/workspace"
import { blobToDataUrl, dataUrlToBlob } from "@/lib/data-url"
import { createEmptyState } from "@/lib/markx/state"
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
  SYNC_VERSION_POLL_MS,
} from "@/lib/markx/sync-timings"
import type { MarkxState } from "@/lib/markx/types"

/**
 * Sync status shown in the header.
 *
 * - `idle`     — guest mode, no cloud sync.
 * - `saved`    — all changes persisted to cloud; nothing pending.
 * - `saving`   — a save is in flight.
 * - `offline`  — navigator is offline; changes are queued locally.
 * - `conflict` — legacy status kept for store API compat (LWW no longer sets it).
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
  /** Cheap poll: workspace version only, or null if no row. */
  getVersion: () => Promise<number | null>
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
    async getVersion() {
      const { getWorkspaceVersion } = await import("@/lib/server/workspace")
      return getWorkspaceVersion()
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
 * SyncEngine orchestrates local ↔ cloud sync for one logged-in user.
 * It is created on login and destroyed on sign-out.
 *
 * Personal sync uses last-writer-wins (LWW): optimistic saves, and on
 * version conflict the engine overwrites the cloud with the local state
 * instead of opening a conflict dialog. When another device moves the
 * cloud version ahead, a stale banner can prompt a full reload.
 *
 * Responsibilities:
 *  1. Hydrate from the per-user IndexedDB cache for instant revisit paint.
 *  2. Full-load from the cloud on bootstrap / first load (always adopt).
 *  3. Debounce local edits and push coalesced snapshots; LWW overwrite
 *     on optimistic-version conflict.
 *  4. Queue writes when offline and flush them on reconnect.
 *  5. Cheap version poll while visible; surface a dismissible stale banner
 *     when remote version is ahead (Reload adopts cloud via reloadFromCloud).
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
  /**
   * True after the user edits locally until a clean save/reload adopts cloud.
   * Kept for reload/save bookkeeping (LWW no longer branches on it).
   */
  private localEditsSinceLoad = false
  /**
   * Bumped only by {@link onStateChange} so an in-flight save can detect
   * mid-save user edits.
   */
  private editGeneration = 0
  /** Cloud version is ahead of this tab's last confirmed version. */
  private stale = false
  /** User dismissed the stale banner until remote moves ahead again. */
  private staleBannerDismissed = false
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

  isStale(): boolean {
    return this.stale
  }

  /** Stale and the user has not dismissed the banner. */
  isStaleBannerVisible(): boolean {
    return this.stale && !this.staleBannerDismissed
  }

  dismissStaleBanner(): void {
    if (!this.stale || this.staleBannerDismissed) return
    this.staleBannerDismissed = true
    this.emitStatus()
  }

  private clearStale(notify = true): void {
    const wasVisible = this.isStaleBannerVisible()
    this.stale = false
    this.staleBannerDismissed = false
    if (notify && wasVisible) {
      this.emitStatus()
    }
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
   * Cheap version probe: if remote is ahead, mark stale (and re-show a
   * dismissed banner). Does not load the full snapshot.
   */
  async checkRemoteVersion(): Promise<void> {
    if (this.isDestroyed()) return
    if (this.cloudVersion <= 0) return

    try {
      const remote = await this.dependencies.workspace.getVersion()
      if (this.isDestroyed() || remote === null) return

      const wasVisible = this.isStaleBannerVisible()

      if (remote > this.cloudVersion) {
        this.stale = true
        if (this.staleBannerDismissed) {
          this.staleBannerDismissed = false
        }
      } else if (remote === this.cloudVersion) {
        this.stale = false
        this.staleBannerDismissed = false
      }

      if (this.isStaleBannerVisible() !== wasVisible) {
        this.emitStatus()
      }
    } catch (err) {
      console.error("[markx sync] checkRemoteVersion failed", err)
    }
  }

  /**
   * Always full-load the workspace from the cloud and adopt it.
   * Used by {@link SyncEngine.create} bootstrap and first load.
   */
  async refreshFromCloud(): Promise<MarkxState | null> {
    if (this.isDestroyed()) return null

    try {
      console.info("[markx sync] loading workspace from cloud")
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

      return await this.adoptCloudSnapshot(snapshot)
    } catch (err) {
      console.error("[markx sync] loadWorkspace failed, keeping cache", err)
      if (this.isDestroyed()) return null
      this.setStatus(this.online ? "saved" : "offline")
      return null
    }
  }

  /**
   * Full-load + adopt for the stale banner Reload action.
   * Clears pending local queue and treats cloud as source of truth.
   */
  async reloadFromCloud(): Promise<MarkxState | null> {
    if (this.isDestroyed()) return null

    await this.dependencies.storage.setPendingSnapshot(this.userId, null)
    this.localEditsSinceLoad = false

    try {
      console.info("[markx sync] reloading workspace from cloud")
      const snapshot = await this.dependencies.workspace.load()
      if (this.isDestroyed()) return null

      if (!snapshot) {
        this.clearStale()
        this.setStatus(this.online ? "saved" : "offline")
        return null
      }

      return await this.adoptCloudSnapshot(snapshot)
    } catch (err) {
      console.error("[markx sync] reloadFromCloud failed", err)
      if (this.isDestroyed()) return null
      this.setStatus(this.online ? "saved" : "offline")
      return null
    }
  }

  private async adoptCloudSnapshot(
    snapshot: WorkspaceSnapshot
  ): Promise<MarkxState> {
    this.cloudVersion = snapshot.version
    await this.dependencies.storage.setCloudVersion(
      this.userId,
      snapshot.version
    )
    this.currentState = snapshot.state
    await this.dependencies.storage.saveUserState(this.userId, snapshot.state)
    await this.finalizeFirstLoginBootstrap()
    this.localEditsSinceLoad = false
    this.clearStale(false)
    this.setStatus("saved", snapshot.state)
    return snapshot.state
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
   * Push the current state to the cloud. On optimistic conflict, overwrite
   * with the local state (last-writer-wins). Never sets status `conflict`.
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

      let result = await this.dependencies.workspace.save({
        state: sentState,
        baseVersion,
        deletedImageIds,
      })

      // Last-writer-wins: conflict → overwrite with current local state.
      if (!result.ok && result.reason === "conflict") {
        const overwriteState = this.currentState ?? sentState
        result = await this.dependencies.workspace.overwrite({
          state: overwriteState,
          deletedImageIds,
        })
      }

      if (result.ok) {
        await this.applySuccessfulSave(
          result,
          generationAtStart,
          deletedImageIds
        )
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

  private async applySuccessfulSave(
    result: Extract<SaveResult, { ok: true }>,
    generationAtStart: number,
    deletedImageIds: string[]
  ): Promise<void> {
    this.cloudVersion = result.version
    await this.dependencies.storage.setCloudVersion(
      this.userId,
      result.version
    )
    await this.retireDeletedImageIds(deletedImageIds)
    this.clearStale(false)

    if (this.editGeneration === generationAtStart) {
      await this.dependencies.storage.setPendingSnapshot(this.userId, null)
      this.currentState = result.state
      this.localEditsSinceLoad = false
      await this.dependencies.storage.saveUserState(this.userId, result.state)
      this.setStatus("saved", result.state)
    } else {
      // Mid-save edits: keep local state, re-queue, and flush again.
      await this.dependencies.storage.setPendingSnapshot(
        this.userId,
        this.currentState
      )
      this.localEditsSinceLoad = true
      this.setStatus("saved")
      this.scheduleFlush()
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

  /**
   * Upload any queued image assets to R2. Called before a snapshot sync
   * so the server has the blobs by the time it records the metadata.
   */
  private async flushAssetQueue(): Promise<void> {
    const queue = await this.dependencies.storage.getAssetQueue(this.userId)
    if (queue.length === 0) return

    const results = await Promise.all(
      queue.map(async (asset) => {
        try {
          const result = await this.dependencies.assets.upload(asset)
          return result.ok ? asset.imageId : null
        } catch {
          // Keep failed uploads queued for the next sync.
          return null
        }
      })
    )
    const uploadedImageIds = results.filter((id): id is string => id !== null)

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
  /* Conflict resolution (kept for store API compat)                  */
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
    this.clearStale(false)
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
      this.clearStale(false)
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
    this.clearStale(false)
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

    // Flush any pending snapshot that accumulated while offline (LWW).
    const pending = await this.dependencies.storage.getPendingSnapshot(
      this.userId
    )
    if (pending) {
      this.currentState = pending
      await this.sync()
    } else {
      this.setStatus("saved")
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

  private handleVisibilityChange = () => {
    if (typeof document === "undefined") return
    if (document.visibilityState !== "visible") return
    void this.checkRemoteVersion()
  }

  /**
   * Cheap version poll while visible. Full reload is user-driven via the
   * stale banner ({@link reloadFromCloud}).
   */
  private startRealtimeRefresh(): void {
    if (typeof window === "undefined" || this.refreshTimer) return
    this.refreshTimer = setInterval(() => {
      if (document.visibilityState === "hidden") return
      void this.checkRemoteVersion()
    }, SYNC_VERSION_POLL_MS)
    document.addEventListener("visibilitychange", this.handleVisibilityChange)
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

  /** Notify listeners even when status is unchanged (e.g. stale banner). */
  private emitStatus(authoritativeState?: MarkxState): void {
    for (const listener of this.listeners) {
      listener(this.status, this.conflict, authoritativeState)
    }
  }

  private setStatus(status: SyncStatus, authoritativeState?: MarkxState): void {
    if (this.status === status && !authoritativeState) return
    this.status = status
    this.emitStatus(authoritativeState)
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
    if (this.currentState) {
      await this.sync()
    }
    const [pending, deletedImageIds, assetQueue] = await Promise.all([
      this.dependencies.storage.getPendingSnapshot(this.userId),
      this.dependencies.storage.getDeletedImageIds(this.userId),
      this.dependencies.storage.getAssetQueue(this.userId),
    ])
    const canClearCache =
      this.status === "saved" &&
      !pending &&
      !this.localEditsSinceLoad &&
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
    if (typeof document !== "undefined") {
      document.removeEventListener(
        "visibilitychange",
        this.handleVisibilityChange
      )
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
