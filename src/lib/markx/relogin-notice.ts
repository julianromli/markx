/**
 * One-time "please sign in again" notice for the move off Neon Auth.
 *
 * Old sessions do not carry over, so a returning user lands as a guest.
 * Bootstrap marks the notice "pending" when it drops a remembered user.
 * The banner shows while pending; dismissing it or signing in sets it to
 * "done" so it never shows again on this browser.
 */
const KEY = "markx:auth-migration-notice:v1"

type NoticeState = "pending" | "done" | null

const listeners = new Set<() => void>()

function read(): NoticeState {
  try {
    const value = localStorage.getItem(KEY)
    return value === "pending" || value === "done" ? value : null
  } catch {
    return null
  }
}

function write(value: Exclude<NoticeState, null>): void {
  try {
    localStorage.setItem(KEY, value)
  } catch {
    // Storage blocked: the notice is best effort.
  }
  for (const listener of listeners) listener()
}

/** Called when a remembered user's session was rejected. First time only. */
export function markReloginNeeded(): void {
  if (read() === null) write("pending")
}

export function completeReloginNotice(): void {
  if (read() === "pending") write("done")
}

export function isReloginNoticePending(): boolean {
  return read() === "pending"
}

export function subscribeReloginNotice(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
