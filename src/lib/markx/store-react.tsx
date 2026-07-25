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
    return <div className="markx-dot-bg h-svh" aria-busy="true" />
  }

  return (
    <MarkxStoreContext.Provider value={api}>
      {children}
    </MarkxStoreContext.Provider>
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
