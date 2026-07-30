import { createContext, useContext, useMemo, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { nanoid } from "nanoid"

import { useMarkxBootstrap } from "./store-bootstrap"
import type { InitialSyncStatus } from "./store-bootstrap"
import { store } from "./store"
import type { MarkxActions, MarkxHistory } from "./store"
import { saveImageBlob } from "./storage"
import type { SyncEngine } from "./sync"
import type { BoardImage, MarkxState } from "./types"

export type { InitialSyncStatus }

export type MarkxStoreApi = {
  getState: () => MarkxState
  getHistory: () => MarkxHistory
  subscribe: (listener: () => void) => () => void
  actions: MarkxActions
  initialSyncStatus: InitialSyncStatus
  retryInitialSync: () => void
  getSyncEngine: () => SyncEngine | null
  resolveConflictUseCloud: () => Promise<void>
  resolveConflictOverwriteCloud: () => Promise<void>
}

const MarkxStoreContext = createContext<MarkxStoreApi | null>(null)

export function MarkxProvider({ children }: { children: ReactNode }) {
  const bootstrap = useMarkxBootstrap(store)
  const api = useMemo<MarkxStoreApi>(
    () => ({
      getState: store.getState,
      getHistory: store.getHistory,
      subscribe: store.subscribe,
      actions: store.actions,
      initialSyncStatus: bootstrap.initialSyncStatus,
      retryInitialSync: bootstrap.retryInitialSync,
      getSyncEngine: store.getSyncEngine,
      resolveConflictUseCloud: store.resolveConflictUseCloud,
      resolveConflictOverwriteCloud: store.resolveConflictOverwriteCloud,
    }),
    [bootstrap.initialSyncStatus, bootstrap.retryInitialSync]
  )

  if (!bootstrap.ready) {
    return bootstrap.failed ? (
      <BootstrapFailure />
    ) : (
      <div className="markx-dot-bg h-svh" aria-busy="true" />
    )
  }

  return (
    <MarkxStoreContext.Provider value={api}>
      {children}
    </MarkxStoreContext.Provider>
  )
}

function BootstrapFailure() {
  return (
    <div
      className="markx-dot-bg flex h-svh items-center justify-center"
      role="alert"
    >
      <div className="max-w-sm rounded-2xl bg-white/90 px-6 py-5 text-center shadow-sm outline outline-1 outline-black/5">
        <p className="text-[15px] font-medium text-ink">
          markx could not start
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          Reloading usually fixes it. Nothing you saved has been lost.
        </p>
        {/* Bare button on purpose: this shell is in the entry chunk, and the
            design-system Button would drag Base UI into it for an error path
            most sessions never render. */}
        <button
          type="button"
          className="mt-4 inline-flex h-9 items-center justify-center rounded-4xl bg-ink px-4 text-sm font-medium text-white shadow-[0_1px_2px_rgba(0,0,0,0.22)] outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  )
}

export function useMarkxStore(): MarkxStoreApi {
  const context = useContext(MarkxStoreContext)
  if (!context) {
    throw new Error("useMarkxStore must be used within MarkxProvider")
  }
  return context
}

export function useMarkxState(): MarkxState {
  const storeApi = useMarkxStore()
  return useSyncExternalStore(
    storeApi.subscribe,
    storeApi.getState,
    storeApi.getState
  )
}

export function useMarkxHistory(): MarkxHistory {
  const storeApi = useMarkxStore()
  return useSyncExternalStore(
    storeApi.subscribe,
    storeApi.getHistory,
    storeApi.getHistory
  )
}

export function useMarkxActions(): MarkxActions {
  return useMarkxStore().actions
}

type ImageIngestInput = Omit<BoardImage, "id" | "imageId" | "z" | "mime"> & {
  blob: Blob
  mime: string
}

export function useMarkxImageIngest(): (
  input: ImageIngestInput
) => Promise<BoardImage> {
  const storeApi = useMarkxStore()
  return useMemo(
    () => async (input: ImageIngestInput) => {
      const imageId = nanoid()
      const { blob, ...meta } = input
      const engine = storeApi.getSyncEngine()
      if (engine) await engine.enqueueAsset(imageId, blob, input.mime)
      else await saveImageBlob(imageId, blob)

      return storeApi.actions.createImage({
        ...meta,
        id: nanoid(),
        imageId,
      })
    },
    [storeApi]
  )
}
