import { useEffect, useState } from "react"

import { authClient } from "@/lib/auth/client"
import { useMarkxStore } from "@/lib/markx/store"
import type { SyncEngine, SyncStatus, ConflictData } from "@/lib/markx/sync"

/**
 * Lightweight pub/sub for auth state changes so hooks can re-check
 * immediately after login/logout instead of waiting for the next poll.
 */
type AuthListener = () => void
const authListeners = new Set<AuthListener>()

/**
 * Notify all `useAuthSession` subscribers to re-check the session
 * immediately. Call this after login or logout.
 */
export function notifyAuthChange(): void {
  for (const listener of authListeners) listener()
}

/**
 * React hook for the current Neon Auth session.
 *
 * Returns `{ user, isPending }` where `user` is `null` when logged out
 * (guest mode). Re-renders when the session changes (login, logout,
 * token refresh) or when {@link notifyAuthChange} is called.
 */
export function useAuthSession() {
  const [session, setSession] = useState<{
    user: { id: string; email: string } | null
    isPending: boolean
  }>({ user: null, isPending: true })

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const { data } = await authClient.getSession()
        if (cancelled) return
        if (data?.user) {
          setSession({
            user: { id: data.user.id, email: data.user.email },
            isPending: false,
          })
        } else {
          setSession({ user: null, isPending: false })
        }
      } catch {
        if (cancelled) return
        setSession({ user: null, isPending: false })
      }
    }

    void check()

    // Re-check when explicitly notified (login/logout).
    const listener = () => void check()
    authListeners.add(listener)

    // Also poll as a fallback for session expiry / external changes.
    const interval = setInterval(check, 10000)

    return () => {
      cancelled = true
      authListeners.delete(listener)
      clearInterval(interval)
    }
  }, [])

  return session
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
