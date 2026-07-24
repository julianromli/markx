import type { SaveResult } from "@/lib/server/workspace"
import { authClient } from "@/lib/auth/client"
import {
  addDeletedImageIds,
  clearAssetQueue,
  clearDeletedImageIds,
  clearUserCache,
  getAssetQueue,
  getCloudVersion,
  getDeletedImageIds,
  getImageBlob,
  getPendingSnapshot,
  isGuestImported,
  loadState,
  loadUserState,
  markGuestImported,
  saveImageBlob,
  saveUserState,
  setCloudVersion,
  setPendingSnapshot,
  type PendingAsset,
} from "@/lib/markx/storage"
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
export type SyncStatus = "idle" | "saved" | "saving" | "offline" | "conflict" | "error"

export type ConflictData = {
  cloudVersion: number
  cloudState: MarkxState
  cloudUpdatedAt: string
}

type SyncListener = (status: SyncStatus, conflict?: ConflictData) => void

const SYNC_DEBOUNCE_MS = 1500

/**
 * SyncEngine orchestrates the local ↔ cloud sync for a single logged-in
 * user. It is created on login and destroyed on sign-out.
 *
 * Responsibilities:
 *  1. Load the cloud workspace (or cached copy) on init.
 *  2. Debounce local state changes and push coalesced snapshots to the
 *     cloud with optimistic version control.
 *  3. Queue writes when offline and flush them on reconnect.
 *  4. Surface conflicts to the UI so the user can choose "use cloud" or
 *     "overwrite cloud".
 *  5. Upload queued image assets to R2.
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

  private constructor(userId: string) {
    this.userId = userId
    this.online = typeof navigator !== "undefined" ? navigator.onLine : true
  }

  /**
   * Create and initialize a SyncEngine for the given user.
   *
   * Flow:
   *  1. If guest data has not been imported yet AND the guest workspace has
   *     been modified from the demo, attempt a one-time import.
   *  2. Otherwise, load the cloud workspace (or the per-user cache if the
   *     network is unavailable).
   */
  static async create(userId: string): Promise<SyncEngine> {
    const engine = new SyncEngine(userId)
    await engine.init()
    return engine
  }

  private async init(): Promise<void> {
    // Restore the last known cloud version from the cache.
    this.cloudVersion = await getCloudVersion(this.userId)

    const imported = await isGuestImported(this.userId)
    const guestState = await loadState()
    const guestModified = isGuestModified(guestState)

    if (!imported && guestModified) {
      // First login on this device with local guest changes — try to import.
      await this.tryImportGuest(guestState)
      return
    }

    // Normal load: cloud first, fall back to cache.
    await this.loadFromCloudOrCache()
    this.attachOnlineListeners()
  }

  /**
   * Attempt a one-time guest import. If the cloud is empty, the guest state
   * becomes the cloud state. If the cloud already has data, surface a
   * conflict so the user can choose.
   */
  private async tryImportGuest(guestState: MarkxState): Promise<void> {
    try {
      const { importGuestWorkspace } = await import("@/lib/server/workspace")
      const result = await importGuestWorkspace({
        data: { state: guestState },
      })
      if (result.ok) {
        await markGuestImported(this.userId)
        this.cloudVersion = result.version
        await setCloudVersion(this.userId, result.version)
        this.currentState = guestState
        await saveUserState(this.userId, guestState)
        this.setStatus("saved")
        this.attachOnlineListeners()
        return
      }

      if (result.reason === "conflict") {
        // Cloud already has data — let the user decide.
        this.conflict = {
          cloudVersion: result.cloudVersion,
          cloudState: result.cloudState,
          cloudUpdatedAt: result.cloudUpdatedAt,
        }
        this.cloudVersion = result.cloudVersion
        this.currentState = guestState
        await saveUserState(this.userId, guestState)
        this.setStatus("conflict")
        this.attachOnlineListeners()
        return
      }

      // Unexpected error — fall back to normal cloud load.
      await this.loadFromCloudOrCache()
      this.attachOnlineListeners()
    } catch {
      // Network error during import — load from cache and retry later.
      await this.loadFromCloudOrCache()
      this.attachOnlineListeners()
    }
  }

  /**
   * Load the workspace from the cloud, or fall back to the per-user
   * IndexedDB cache if the network is unavailable.
   */
  private async loadFromCloudOrCache(): Promise<void> {
    try {
      const { loadWorkspace } = await import("@/lib/server/workspace")
      const snapshot = await loadWorkspace()
      if (snapshot) {
        this.cloudVersion = snapshot.version
        await setCloudVersion(this.userId, snapshot.version)
        this.currentState = snapshot.state
        await saveUserState(this.userId, snapshot.state)
        this.setStatus("saved")
        return
      }
    } catch {
      // Network or auth error — fall through to cache.
    }

    // Offline / error: use the per-user cache.
    const cached = await loadUserState(this.userId)
    if (cached) {
      this.currentState = cached
      this.setStatus(this.online ? "saved" : "offline")
    } else {
      this.currentState = {
        folders: [],
        bookmarks: [],
        notes: [],
        images: [],
        hasOnboarded: true,
        zCounter: 1,
      }
      this.setStatus(this.online ? "saved" : "offline")
    }
  }

  /**
   * Called by the store whenever local state changes. Debounces and
   * coalesces writes into a single sync.
   */
  onStateChange(state: MarkxState, deletedImageIds: string[] = []): void {
    if (this.destroyed) return
    this.currentState = state

    // Always cache locally for instant load + offline.
    void saveUserState(this.userId, state)

    // Accumulate deleted image IDs for the next sync.
    if (deletedImageIds.length > 0) {
      void addDeletedImageIds(this.userId, deletedImageIds)
    }

    if (this.status === "conflict") {
      // Don't auto-sync while a conflict is unresolved; just keep caching.
      void setPendingSnapshot(this.userId, state)
      return
    }

    if (!this.online) {
      void setPendingSnapshot(this.userId, state)
      this.setStatus("offline")
      return
    }

    // Debounce the cloud write.
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      void this.sync()
    }, SYNC_DEBOUNCE_MS)
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
      const deletedImageIds = await getDeletedImageIds(this.userId)

      const { saveWorkspace } = await import("@/lib/server/workspace")
      const result: SaveResult = await saveWorkspace({
        data: { state, baseVersion, deletedImageIds },
      })

      if (result.ok) {
        this.cloudVersion = result.version
        await setCloudVersion(this.userId, result.version)
        await clearDeletedImageIds(this.userId)
        await setPendingSnapshot(this.userId, null)
        this.setStatus("saved")
      } else if (result.reason === "conflict") {
        this.conflict = {
          cloudVersion: result.cloudVersion,
          cloudState: result.cloudState,
          cloudUpdatedAt: result.cloudUpdatedAt,
        }
        this.cloudVersion = result.cloudVersion
        await setPendingSnapshot(this.userId, state)
        this.setStatus("conflict")
      } else {
        // Generic error — keep the pending snapshot and mark as error
        // so the UI shows a retry indicator instead of "saved".
        await setPendingSnapshot(this.userId, state)
        this.setStatus("error")
      }
    } catch {
      // Network error — queue and mark offline.
      await setPendingSnapshot(this.userId, this.currentState)
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
    const queue = await getAssetQueue(this.userId)
    if (queue.length === 0) return

    // Upload all items first; only clear and re-enqueue failures
    // afterwards so a crash during upload doesn't lose queued assets.
    const failed: PendingAsset[] = []
    for (const asset of queue) {
      try {
        const { uploadImageAsset } = await import("@/lib/server/assets")
        await uploadImageAsset({
          data: {
            imageId: asset.imageId,
            mime: asset.mime,
            dataUrl: asset.dataUrl,
          },
        })
      } catch {
        failed.push(asset)
      }
    }

    // Atomically replace the queue with only the failed items.
    await clearAssetQueue(this.userId)
    for (const asset of failed) {
      await this.enqueueAssetInternal(asset)
    }
  }

  private async enqueueAssetInternal(asset: PendingAsset): Promise<void> {
    const { enqueueAsset } = await import("@/lib/markx/storage")
    await enqueueAsset(this.userId, asset)
  }

  /**
   * Enqueue a new image for upload to R2. Also caches the blob locally so
   * it renders immediately.
   */
  async enqueueAsset(imageId: string, blob: Blob, mime: string): Promise<void> {
    await saveImageBlob(imageId, blob)
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
    const cached = await getImageBlob(imageId)
    if (cached) return cached
    if (!this.online) return undefined

    try {
      const { fetchImageAsset } = await import("@/lib/server/assets")
      const result = await fetchImageAsset({ data: { imageId } })
      if (!result.ok) return undefined
      const blob = dataUrlToBlob(result.dataUrl)
      await saveImageBlob(imageId, blob)
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
    await setCloudVersion(this.userId, this.cloudVersion)
    await setPendingSnapshot(this.userId, null)
    await clearDeletedImageIds(this.userId)
    this.currentState = state
    await saveUserState(this.userId, state)
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
    const deletedImageIds = await getDeletedImageIds(this.userId)

    const { overwriteWorkspace } = await import("@/lib/server/workspace")
    const result = await overwriteWorkspace({
      data: { state, deletedImageIds },
    })

    if (result.ok) {
      this.cloudVersion = result.version
      await setCloudVersion(this.userId, result.version)
      await clearDeletedImageIds(this.userId)
      await setPendingSnapshot(this.userId, null)
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
    // Flush any pending snapshot that accumulated while offline.
    const pending = await getPendingSnapshot(this.userId)
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
      void setPendingSnapshot(this.userId, this.currentState)
    }
    this.setStatus("offline")
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.sync(), 500)
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

  private setStatus(status: SyncStatus): void {
    if (this.status === status) return
    this.status = status
    for (const listener of this.listeners) {
      listener(status, this.conflict)
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
    await clearUserCache(this.userId)
  }
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

/**
 * Heuristic: has the guest workspace been modified from the seeded demo?
 * We compare a lightweight fingerprint (counts + zCounter) rather than a
 * deep equality check, which is sufficient to decide whether to offer an
 * import.
 */
export function isGuestModified(state: MarkxState): boolean {
  const demo = createDemoStateFingerprint()
  return (
    state.folders.length !== demo.folders ||
    state.bookmarks.length !== demo.bookmarks ||
    state.notes.length > 0 ||
    state.images.length > 0 ||
    state.zCounter !== demo.zCounter ||
    state.hasOnboarded !== demo.hasOnboarded
  )
}

function createDemoStateFingerprint() {
  // Mirrors createDemoState() in seed.ts — kept here to avoid importing
  // the full demo state just for the comparison.
  return {
    folders: 3,
    bookmarks: 5,
    zCounter: 10,
    hasOnboarded: false,
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error("Invalid data URL")
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))
  return new Blob([bytes], { type: match[1] })
}

/* ------------------------------------------------------------------ */
/* Session helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Get the current authenticated user from Neon Auth, or `null` if
 * logged out (guest mode).
 */
export async function getCurrentUser(): Promise<{
  id: string
  email: string
} | null> {
  try {
    const { data } = await authClient.getSession()
    if (!data?.user) return null
    return { id: data.user.id, email: data.user.email }
  } catch {
    return null
  }
}
