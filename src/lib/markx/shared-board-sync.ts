import {
  SYNC_RETRY_DEBOUNCE_MS,
  SYNC_STATE_DEBOUNCE_MS,
} from "@/lib/markx/sync-timings"
import { mergeWorkspaceStates } from "@/lib/markx/merge-workspace"
import type { SharedBoardSaveResult } from "@/lib/markx/shared-board"
import type { MarkxState } from "@/lib/markx/types"

/**
 * Sync status for a shared board. Mirrors the workspace
 * {@link import("@/lib/markx/sync").SyncStatus} set.
 */
export type SharedBoardSyncStatus =
  "idle" | "saved" | "saving" | "offline" | "conflict" | "error"

export type SharedBoardConflictData = {
  cloudVersion: number
  cloudState: MarkxState
  cloudUpdatedAt: string
}

type SharedBoardSyncListener = (
  status: SharedBoardSyncStatus,
  conflict?: SharedBoardConflictData,
  /** When set, the store should adopt this as the authoritative state. */
  authoritativeState?: MarkxState
) => void

export type SharedBoardSyncDependency = {
  save: (input: {
    boardId: string
    state: MarkxState
    baseVersion: number
    deletedImageIds: string[]
  }) => Promise<SharedBoardSaveResult>
}

/**
 * SharedBoardSyncEngine orchestrates local ↔ cloud sync for a single shared
 * board (owner or editor). The server merges concurrent slice edits by
 * entity id; this client adopts the returned state and keeps mid-save local
 * additions.
 */
export class SharedBoardSyncEngine {
  private boardId: string
  private cloudVersion: number
  private currentState: MarkxState
  private deletedImageIds: string[] = []
  private status: SharedBoardSyncStatus = "saving"
  private conflict: SharedBoardConflictData | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private isSyncing = false
  private online = true
  private listeners = new Set<SharedBoardSyncListener>()
  private destroyed = false
  private editGeneration = 0
  private deps: SharedBoardSyncDependency

  constructor(
    boardId: string,
    initialState: MarkxState,
    initialVersion: number,
    deps: SharedBoardSyncDependency
  ) {
    this.boardId = boardId
    this.cloudVersion = initialVersion
    this.currentState = initialState
    this.deps = deps
    this.online = typeof navigator !== "undefined" ? navigator.onLine : true
    this.setStatus("saved")
    this.attachOnlineListeners()
  }

  getBoardId(): string {
    return this.boardId
  }

  getLoadedState(): MarkxState {
    return this.currentState
  }

  getStatus(): SharedBoardSyncStatus {
    return this.status
  }

  getConflict(): SharedBoardConflictData | undefined {
    return this.conflict
  }

  /**
   * Called by the store whenever local state changes. Debounces and
   * coalesces writes into a single sync.
   */
  onStateChange(state: MarkxState, deletedImageIds: string[] = []): void {
    if (this.destroyed) return
    this.currentState = state
    this.editGeneration += 1
    if (deletedImageIds.length > 0) {
      this.deletedImageIds = [...this.deletedImageIds, ...deletedImageIds]
    }

    if (this.status === "conflict") {
      return
    }

    if (!this.online) {
      this.setStatus("offline")
      return
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      void this.sync()
    }, SYNC_STATE_DEBOUNCE_MS)
  }

  /** Push the current state to the cloud with optimistic version control. */
  private async sync(): Promise<void> {
    if (this.isSyncing || this.destroyed) return
    this.isSyncing = true
    this.setStatus("saving")

    try {
      const sentState = this.currentState
      const generationAtStart = this.editGeneration
      const sentDeleted = [...this.deletedImageIds]
      const baseVersion = this.cloudVersion

      const result = await this.saveWithAutomaticMerge(
        sentState,
        baseVersion,
        sentDeleted
      )

      if (this.isDestroyed()) return

      if (result.ok) {
        this.cloudVersion = result.version
        const sent = new Set(sentDeleted)
        this.deletedImageIds = this.deletedImageIds.filter(
          (id) => !sent.has(id)
        )

        if (this.editGeneration === generationAtStart) {
          this.currentState = result.state
          this.setStatus("saved", result.state)
        } else {
          const adopted = mergeWorkspaceStates(this.currentState, result.state)
          this.currentState = adopted
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
        this.setStatus("conflict")
      } else if (result.reason === "entity_limit") {
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
        this.setStatus("error")
      }
    } catch {
      // Network error — mark offline; the next online event flushes.
      if (!this.isDestroyed()) this.setStatus("offline")
    } finally {
      this.isSyncing = false
    }
  }

  private async saveWithAutomaticMerge(
    state: MarkxState,
    baseVersion: number,
    deletedImageIds: string[],
    attempt = 0
  ): Promise<SharedBoardSaveResult> {
    const result = await this.deps.save({
      boardId: this.boardId,
      state,
      baseVersion,
      deletedImageIds,
    })
    if (result.ok || result.reason !== "conflict" || attempt >= 2) {
      return result
    }

    const localBase = this.currentState ?? state
    const merged = mergeWorkspaceStates(localBase, result.cloudState)
    this.currentState = merged
    this.cloudVersion = result.cloudVersion

    return this.saveWithAutomaticMerge(
      merged,
      result.cloudVersion,
      deletedImageIds,
      attempt + 1
    )
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flushTimer = setTimeout(() => void this.sync(), SYNC_RETRY_DEBOUNCE_MS)
  }

  /* ---------------------------------------------------------------- */
  /* Conflict resolution (called by the UI)                           */
  /* ---------------------------------------------------------------- */

  /** Resolve a conflict by keeping the cloud version. */
  async resolveConflictUseCloud(): Promise<MarkxState> {
    if (!this.conflict) throw new Error("No active conflict")
    const state = this.conflict.cloudState
    this.cloudVersion = this.conflict.cloudVersion
    this.currentState = state
    this.deletedImageIds = []
    this.conflict = undefined
    this.setStatus("saved", state)
    return state
  }

  /** Resolve a conflict by overwriting the cloud with the local version. */
  async resolveConflictOverwriteCloud(): Promise<void> {
    const state = this.currentState
    const result = await this.deps.save({
      boardId: this.boardId,
      state,
      baseVersion: this.cloudVersion,
      deletedImageIds: this.deletedImageIds,
    })
    if (result.ok) {
      this.cloudVersion = result.version
      this.deletedImageIds = []
      this.conflict = undefined
      this.currentState = result.state
      this.setStatus("saved", result.state)
    }
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
    if (this.status === "conflict") return
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    void this.sync()
  }

  private handleOffline = () => {
    this.online = false
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.setStatus("offline")
  }

  /* ---------------------------------------------------------------- */
  /* Status + subscription                                            */
  /* ---------------------------------------------------------------- */

  subscribe(listener: SharedBoardSyncListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setStatus(
    status: SharedBoardSyncStatus,
    authoritativeState?: MarkxState
  ): void {
    if (this.status === status && !authoritativeState) return
    this.status = status
    for (const listener of this.listeners) {
      listener(status, this.conflict, authoritativeState)
    }
  }

  /* ---------------------------------------------------------------- */
  /* Teardown                                                         */
  /* ---------------------------------------------------------------- */

  private isDestroyed(): boolean {
    return this.destroyed
  }

  /** Flush pending changes, then tear down listeners. */
  async flushAndDestroy(): Promise<void> {
    if (this.status !== "conflict") {
      await this.sync()
    }
    this.destroy()
  }

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
}
