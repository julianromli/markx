import { getAuthClient } from "@/lib/auth/client"
import type { AuthUser } from "@/lib/auth/types"
import { NEON_IDLE_POLL_MS } from "@/lib/neon-compute"

export type AuthSessionUser = AuthUser

/**
 * `pending` — no definitive server answer yet.
 * `authenticated` / `guest` — the server answered.
 * `unavailable` — the last check failed in transit. Not published.
 */
export type AuthSessionOutcome =
  "pending" | "authenticated" | "guest" | "unavailable"

export type AuthSessionSnapshot = {
  user: AuthSessionUser | null
  token: string | null
  isPending: boolean
  checkedAt: number
  outcome: AuthSessionOutcome
}

const SESSION_FRESH_MS = 5000
/**
 * Neon Auth's client caches get-session until the JWT expires. The JWT
 * plugin default is 15 minutes. After that, a foreground check must hit
 * the server so Better Auth can roll `expiresAt` (updateAge) and re-set
 * the session cookie.
 */
export const SESSION_NETWORK_REFRESH_MS = 15 * 60 * 1000
/** Fallback revalidation. Longer than Neon autosuspend so idle tabs can sleep. */
export const SESSION_POLL_MS = NEON_IDLE_POLL_MS
const serverSnapshot: AuthSessionSnapshot = {
  user: null,
  token: null,
  isPending: true,
  checkedAt: 0,
  outcome: "pending",
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

function refreshSessionForForeground(): void {
  const age =
    snapshot.checkedAt > 0
      ? Date.now() - snapshot.checkedAt
      : Number.POSITIVE_INFINITY
  // Inside the JWT cache window a normal get-session is enough. Past it,
  // skip both the client cache and the 5-minute session_data cookie so
  // the server can extend the session and send a new Set-Cookie.
  if (age >= SESSION_NETWORK_REFRESH_MS) {
    void getAuthSession({ force: true, forceNetwork: true })
    return
  }
  void getAuthSession()
}

function handleVisibilityChange(): void {
  if (typeof document === "undefined") return
  if (document.visibilityState !== "visible") return
  refreshSessionForForeground()
}

function handleWindowFocus(): void {
  refreshSessionForForeground()
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
type SessionProbeResponse = {
  data?: {
    user?: { id: string; email: string } | null
    session?: { token?: string | null } | null
  } | null
  error?: { status?: number; message?: string } | null
}

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || !("status" in value)) return
  const status = (value as { status?: unknown }).status
  return typeof status === "number" ? status : undefined
}

function isUnauthenticatedStatus(status: number | undefined): boolean {
  return status === 401
}

function publishGuest(): AuthSessionSnapshot {
  return publish({
    user: null,
    token: null,
    isPending: false,
    checkedAt: Date.now(),
    outcome: "guest",
  })
}

/**
 * A transport failure must not sign the user out. Keep the last definitive
 * snapshot. On the first check, leave the published snapshot pending.
 */
function keepOrUnavailable(): AuthSessionSnapshot {
  if (snapshot.checkedAt > 0 && snapshot.outcome !== "pending") return snapshot
  return { ...snapshot, outcome: "unavailable" }
}

export function getAuthSession(opts?: {
  force?: boolean
  /** Bypass Neon Auth's memory cache and the session_data cookie. */
  forceNetwork?: boolean
}): Promise<AuthSessionSnapshot> {
  const force = opts?.force ?? false
  const forceNetwork = opts?.forceNetwork ?? false
  if (
    !force &&
    !forceNetwork &&
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
      const sessionResult = (await authClient.getSession(
        forceNetwork
          ? {
              query: { disableCookieCache: true },
              // Honored by @neondatabase/auth customFetchImpl (FORCE_FETCH_HEADER).
              // It skips that client's in-memory session cache.
              fetchOptions: { headers: { "X-Force-Fetch": "1" } },
            }
          : undefined
      )) as SessionProbeResponse
      if (requestGeneration !== generation) return snapshot
      if (
        sessionResult.error &&
        !isUnauthenticatedStatus(sessionResult.error.status)
      ) {
        console.warn("[markx init] getSession unavailable", sessionResult.error)
        return keepOrUnavailable()
      }
      const runtimeData = sessionResult.data
      if (
        isUnauthenticatedStatus(sessionResult.error?.status) ||
        !runtimeData?.user
      ) {
        return publishGuest()
      }
      return publish({
        user: { id: runtimeData.user.id, email: runtimeData.user.email },
        token: runtimeData.session?.token ?? null,
        isPending: false,
        checkedAt: Date.now(),
        outcome: "authenticated",
      })
    } catch (err) {
      if (requestGeneration !== generation) return snapshot
      if (isUnauthenticatedStatus(statusOf(err))) return publishGuest()
      console.warn("[markx init] getSession unavailable", err)
      return keepOrUnavailable()
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
    outcome: "guest",
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
