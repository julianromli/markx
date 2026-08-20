/**
 * Neon Launch autosuspend is 5 minutes with no connections. Any poll at
 * or below this interval keeps compute active for the whole time a tab
 * stays open and burns CU-hours.
 */
export const NEON_AUTOSUSPEND_MS = 5 * 60 * 1000

/**
 * Idle poll interval for session and workspace version checks. Must stay
 * greater than {@link NEON_AUTOSUSPEND_MS} so an open tab can still sleep.
 */
export const NEON_IDLE_POLL_MS = 10 * 60 * 1000
