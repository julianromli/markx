import { getAuthClient } from "@/lib/auth/client"

export type AuthSessionUser = {
  id: string
  email: string
}

export type AuthSessionSnapshot = {
  user: AuthSessionUser | null
  token: string | null
  isPending: boolean
  checkedAt: number
}

const SESSION_FRESH_MS = 5000
const SESSION_POLL_MS = 10000
const serverSnapshot: AuthSessionSnapshot = {
  user: null,
  token: null,
  isPending: true,
  checkedAt: 0,
}

let snapshot = serverSnapshot
let inFlight: Promise<AuthSessionSnapshot> | null = null
let generation = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

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
  let request: Promise<AuthSessionSnapshot>
  request = (async () => {
    try {
      const authClient = await getAuthClient()
      const { data } = await authClient.getSession()
      if (requestGeneration !== generation) return snapshot
      return publish({
        user: data?.user
          ? { id: data.user.id, email: data.user.email }
          : null,
        token: data?.session?.token ?? null,
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
      if (inFlight === request) inFlight = null
    }
  })()

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
    pollTimer = setInterval(() => {
      void refreshAuthSession()
    }, SESSION_POLL_MS)
  }

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }
}
