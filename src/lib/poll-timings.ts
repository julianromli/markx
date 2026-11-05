/**
 * Idle poll interval for session and workspace version checks while a tab
 * stays open. Focus and visibility changes trigger immediate checks, so the
 * poll is only a slow fallback that keeps DB traffic low.
 */
export const IDLE_POLL_MS = 10 * 60 * 1000
