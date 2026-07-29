import type { SaveResult, WorkspaceSnapshot } from "@/lib/server/workspace"
import { blobToDataUrl, dataUrlToBlob } from "@/lib/data-url"
import { createEmptyState, getGuestImportDecision } from "@/lib/markx/state"
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
  private isSyncing = false
  private online = true
  private listeners = new Set<SyncListener>()
  private destroyed = false
  /** True when IndexedDB already had a per-user snapshot for this user. */
  private hadCachedState = false
  /** True after the user edits locally (debounce scheduled) during init refresh. */
  private localEditsSinceLoad = false
  /**
   * Guest workspace awaiting first-login import after an offline / failed
   * attempt. Cleared once import or silent cloud-wins completes.
   */
  private pendingGuestImport: MarkxState | null = null
  private dependencies: SyncEngineDependencies

  private constructor(userId: string, dependencies: SyncEngineDependencies) {
    this.userId = userId
    this.dependencies = dependencies
    this.online = typeof navigator !== "undefined" ? navigator.onLine : true
  }

  /**
   * Create and fully initialize a SyncEngine (blocking).
   *
   * Used on explicit login (`onLoginSuccess`) where waiting for cloud /
   * guest-import is expected. Returning visits should use
   * {@link createFromCache} + {@link refreshFromCloud} instead so the UI
   * can paint from IndexedDB immediately.
   *
   * Flow:
   *  1. Load the per-user cache (or empty onboarded state).
   *  2. If first-login flag unset AND guest was modified from demo, attempt
   *     one-time import (cloud empty → import; cloud has data → silent
   *     cloud-wins). Offline → keep guest locally and retry on reconnect.
   *  3. Otherwise, refresh from the cloud and finalize first-login flag.
   */
  static async create(
    userId: string,
    dependencies: SyncEngineDependencies = defaultSyncEngineDependencies
  ): Promise<SyncEngine> {
    const engine = new SyncEngine(userId, dependencies)
    await engine.initFromCache()

    const decision = await getGuestImportDecision(userId, {
      load: dependencies.storage.loadGuestState,
      isGuestImported: dependencies.storage.isGuestImported,
    })
    if (decision.shouldImport && decision.guestState) {
      await engine.tryImportGuest(decision.guestState)
      return engine
    }

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
  }

  /**
   * Attempt a one-time guest import.
   *
   * - Cloud empty → guest becomes cloud; enqueue guest image uploads.
   * - Cloud already has data → silent cloud-wins (no conflict dialog).
   * - Network failure → keep guest locally and retry on reconnect without
   *   setting the first-login flag.
   */
  private async tryImportGuest(guestState: MarkxState): Promise<void> {
    try {
      const result = await this.dependencies.workspace.importGuest(guestState)
      if (this.isDestroyed()) return

      if (result.ok) {
        await this.applySuccessfulGuestImport(guestState, result.version)
        return
      }

      if (result.reason === "conflict") {
        await this.applySilentCloudWins(
          result.cloudState,
          result.cloudVersion,
          { notifyStore: Boolean(this.pendingGuestImport) }
        )
        return
      }

      await this.adoptPendingGuestImport(guestState)
    } catch {
      if (this.isDestroyed()) return
      await this.adoptPendingGuestImport(guestState)
    }
  }

  private async applySuccessfulGuestImport(
    guestState: MarkxState,
    version: number
  ): Promise<void> {
    this.pendingGuestImport = null
    this.cloudVersion = version
    await this.dependencies.storage.setCloudVersion(this.userId, version)
    this.currentState = guestState
    await this.dependencies.storage.saveUserState(this.userId, guestState)
    await this.enqueueGuestImages(guestState)
    await this.finalizeFirstLoginBootstrap()
    this.setStatus("saved")
    if (this.online) {
      this.scheduleFlush()
    }
  }

  private async applySilentCloudWins(
    cloudState: MarkxState,
    cloudVersion: number,
    opts?: { notifyStore?: boolean }
  ): Promise<void> {
    this.pendingGuestImport = null
    this.cloudVersion = cloudVersion
    await this.dependencies.storage.setCloudVersion(this.userId, cloudVersion)
    this.currentState = cloudState
    await this.dependencies.storage.saveUserState(this.userId, cloudState)
    await this.dependencies.storage.setPendingSnapshot(this.userId, null)
    await this.finalizeFirstLoginBootstrap()
    this.setStatus(
      "saved",
      opts?.notifyStore ? cloudState : undefined
    )
  }

  /**
   * Keep guest data as the working state until the cloud is reachable.
   * Does not set the first-login flag.
   */
  private async adoptPendingGuestImport(guestState: MarkxState): Promise<void> {
    this.pendingGuestImport = guestState
    this.currentState = guestState
    await this.dependencies.storage.saveUserState(this.userId, guestState)
    this.setStatus(this.online ? "error" : "offline")
  }

  private async enqueueGuestImages(state: MarkxState): Promise<void> {
    for (const image of state.images) {
      const blob = await this.dependencies.storage.getImageBlob(image.imageId)
      if (!blob) continue
      const dataUrl = await blobToDataUrl(blob)
      await this.enqueueAssetInternal({
        imageId: image.imageId,
        mime: image.mime,
        dataUrl,
      })
    }
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
   * Returns the cloud state when the UI should adopt it, or `null` when
   * the existing local/cache state should be kept (network failure, no
   * snapshot, or the user already made local edits / has a pending
   * snapshot).
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

      this.cloudVersion = snapshot.version
      await this.dependencies.storage.setCloudVersion(
        this.userId,
        snapshot.version
      )

      // If the user already diverged locally, keep local as source of truth
      // and let the normal sync / conflict path reconcile.
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
        console.info(
          "[markx sync] keeping local state after cloud refresh (pending local edits)"
        )
        if (pending) {
          this.currentState = pending
        }
        // Cloud was reachable — first-login flag can be set even if we keep
        // local pending (session-expire recovery path).
        await this.finalizeFirstLoginBootstrap()
        if (this.status !== "conflict" && this.online) {
          void this.sync()
        } else if (!this.online) {
          this.setStatus("offline")
        }
        return null
      }

      this.currentState = snapshot.state
      await this.dependencies.storage.saveUserState(this.userId, snapshot.state)
      await this.finalizeFirstLoginBootstrap()
      this.setStatus("saved")
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

      const state = this.currentState
      const baseVersion = this.cloudVersion
      const deletedImageIds =
        await this.dependencies.storage.getDeletedImageIds(this.userId)

      const result: SaveResult = await this.dependencies.workspace.save({
        state,
        baseVersion,
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
        this.setStatus("saved")
      } else if (result.reason === "conflict") {
        this.conflict = {
          cloudVersion: result.cloudVersion,
          cloudState: result.cloudState,
          cloudUpdatedAt: result.cloudUpdatedAt,
        }
        this.cloudVersion = result.cloudVersion
        await this.dependencies.storage.setPendingSnapshot(this.userId, state)
        this.setStatus("conflict")
      } else if (result.reason === "entity_limit") {
        await this.dependencies.storage.setPendingSnapshot(this.userId, state)
        this.setStatus("error")
        console.warn("[markx sync] entity limit:", result.message)
      } else {
        // Generic error — keep the pending snapshot and mark as error
        // so the UI shows a retry indicator instead of "saved".
        await this.dependencies.storage.setPendingSnapshot(this.userId, state)
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
      this.conflict = undefined
      this.setStatus("saved")
    }
  }

  getConflict(): ConflictData | undefined {
    return this.conflict
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

    // Finish first-login guest import that was deferred while offline.
    if (this.pendingGuestImport) {
      await this.tryImportGuest(this.pendingGuestImport)
      return
    }

    // First login with unmodified guest that never reached the cloud yet.
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

  private setStatus(
    status: SyncStatus,
    authoritativeState?: MarkxState
  ): void {
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
  async flushAndDestroy(): Promise<void> {
    // Try one final sync.
    if (this.currentState && this.status !== "conflict") {
      await this.sync()
    }
    this.destroy()
  }

  /**
   * Destroy the engine without syncing. Clears the per-user cache so the
   * next user starts fresh.
   */
  destroy(): void {
    this.destroyed = true
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    if (this.flushTimer) clearTimeout(this.flushTimer)
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
