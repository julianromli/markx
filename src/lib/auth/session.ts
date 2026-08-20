import { getAuthClient } from "@/lib/auth/client"
import type { AuthUser } from "@/lib/auth/types"
import { NEON_IDLE_POLL_MS } from "@/lib/neon-compute"

export type AuthSessionUser = AuthUser

export type AuthSessionSnapshot = {
  user: AuthSessionUser | null
  token: string | null
  isPending: boolean
  checkedAt: number
}

const SESSION_FRESH_MS = 5000
/** Fallback revalidation. Longer than Neon autosuspend so idle tabs can sleep. */
export const SESSION_POLL_MS = NEON_IDLE_POLL_MS
const serverSnapshot: AuthSessionSnapshot = {
  user: null,
  token: null,
  isPending: true,
  checkedAt: 0,
}

let snapshot = serverSnapshot
let inFlight: Promise<AuthSessionSnapshot> | null = null
let activeRequestId: symbol | null = null
let generation = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let browserListenersBound = false
const listeners = new Set<() => void>()

function isDocumentHidden(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  )
}

function refreshIfVisible(): void {
  if (isDocumentHidden()) return
  void refreshAuthSession()
}

function handleVisibilityChange(): void {
  if (typeof document === "undefined") return
  if (document.visibilityState !== "visible") return
  // Coalesce with the 5s freshness window; do not force a Neon Auth round-trip.
  void getAuthSession()
}

function handleWindowFocus(): void {
  void getAuthSession()
}

function bindBrowserSessionListeners(): void {
  if (browserListenersBound) return
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange)
  }
  if (typeof window !== "undefined") {
    window.addEventListener("focus", handleWindowFocus)
  }
  browserListenersBound = true
}

function unbindBrowserSessionListeners(): void {
  if (!browserListenersBound) return
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", handleVisibilityChange)
  }
  if (typeof window !== "undefined") {
    window.removeEventListener("focus", handleWindowFocus)
  }
  browserListenersBound = false
}

function publish(next: AuthSessionSnapshot): AuthSessionSnapshot {
  snapshot = next
  for (const listener of listeners) listener()
  return snapshot
}

/**
 * Resolve the browser session once and share the in-flight request between
 * bootstrap, header consumers, and authenticated server functions.
 */
export function getAuthSession(opts?: {
  force?: boolean
}): Promise<AuthSessionSnapshot> {
  const force = opts?.force ?? false
  if (
    !force &&
    !snapshot.isPending &&
    Date.now() - snapshot.checkedAt < SESSION_FRESH_MS
  ) {
    return Promise.resolve(snapshot)
  }
  if (inFlight) return inFlight

  const requestGeneration = generation
  const requestId = Symbol("auth-session-request")
  const request = (async () => {
    try {
      const authClient = await getAuthClient()
      const { data } = await authClient.getSession()
      if (requestGeneration !== generation) return snapshot
      const runtimeData = data as {
        user?: { id: string; email: string } | null
        session?: { token?: string | null } | null
      } | null
      return publish({
        user: runtimeData?.user
          ? { id: runtimeData.user.id, email: runtimeData.user.email }
          : null,
        token: runtimeData?.session?.token ?? null,
        isPending: false,
        checkedAt: Date.now(),
      })
    } catch {
      if (requestGeneration !== generation) return snapshot
      // Keep a previously confirmed session during transient failures. On the
      // initial check there is no safe identity to retain, so resolve as guest.
      if (snapshot.checkedAt > 0) return snapshot
      return publish({
        user: null,
        token: null,
        isPending: false,
        checkedAt: Date.now(),
      })
    } finally {
      if (activeRequestId === requestId) {
        inFlight = null
        activeRequestId = null
      }
    }
  })()

  activeRequestId = requestId
  inFlight = request
  return request
}

export function refreshAuthSession(): Promise<AuthSessionSnapshot> {
  return getAuthSession({ force: true })
}

export async function getAuthToken(): Promise<string | null> {
  return (await getAuthSession()).token
}

export function setAuthSessionGuest(): void {
  generation += 1
  inFlight = null
  activeRequestId = null
  publish({
    user: null,
    token: null,
    isPending: false,
    checkedAt: Date.now(),
  })
}

export function getAuthSessionSnapshot(): AuthSessionSnapshot {
  return snapshot
}

export function getAuthSessionServerSnapshot(): AuthSessionSnapshot {
  return serverSnapshot
}

export function subscribeAuthSession(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    void getAuthSession()
    pollTimer = setInterval(refreshIfVisible, SESSION_POLL_MS)
    bindBrowserSessionListeners()
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      unbindBrowserSessionListeners()
    }
  }
}
