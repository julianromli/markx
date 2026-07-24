import { useEffect, useState, useSyncExternalStore } from "react"

import {
  getAuthSessionServerSnapshot,
  getAuthSessionSnapshot,
  subscribeAuthSession,
} from "@/lib/auth/session"
import { useMarkxStore } from "@/lib/markx/store"
import type { SyncEngine, SyncStatus, ConflictData } from "@/lib/markx/sync"

/**
 * React hook for the current Neon Auth session.
 *
 * Returns `{ user, isPending }` where `user` is `null` when logged out
 * (guest mode). All consumers share one initial request and polling loop.
 */
export function useAuthSession() {
  const session = useSyncExternalStore(
    subscribeAuthSession,
    getAuthSessionSnapshot,
    getAuthSessionServerSnapshot,
  )
  return { user: session.user, isPending: session.isPending }
}

/**
 * React hook for the current sync status (shown in the header).
 *
 * Returns `{ status, conflict }` where `status` is one of:
 * `idle` (guest), `saved`, `saving`, `offline`, `conflict`.
 *
 * Also subscribes to the store so it re-renders when the sync engine is
 * attached (login) or detached (sign-out).
 */
export function useSyncStatus(): {
  status: SyncStatus
  conflict: ConflictData | undefined
  engine: SyncEngine | null
} {
  const storeApi = useMarkxStore()
  // Subscribe to the store so we re-render when attachSync/detachSync
  // triggers a state replacement (which calls emit()).
  useSyncExternalStoreLite(storeApi.subscribe)
  const engine = storeApi.getSyncEngine()
  const [state, setState] = useState<{
    status: SyncStatus
    conflict: ConflictData | undefined
  }>({
    status: engine?.getStatus() ?? "idle",
    conflict: engine?.getConflict(),
  })

  useEffect(() => {
    if (!engine) {
      setState({ status: "idle", conflict: undefined })
      return
    }
    setState({ status: engine.getStatus(), conflict: engine.getConflict() })
    return engine.subscribe((status, conflict) => {
      setState({ status, conflict })
    })
  }, [engine])

  return { ...state, engine }
}

/**
 * Minimal `useSyncExternalStore` wrapper that just forces a re-render
 * when the store emits. We don't need a snapshot — only the notification.
 */
function useSyncExternalStoreLite(subscribe: (cb: () => void) => () => void) {
  const [, setTick] = useState(0)
  useEffect(() => {
    return subscribe(() => setTick((t) => t + 1))
  }, [subscribe])
}
