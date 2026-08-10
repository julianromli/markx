export const STORE_PERSIST_DEBOUNCE_MS = 120
/** Window to coalesce background enrich results into one store commit. */
export const STORE_ENRICH_BATCH_WINDOW_MS = 200
export const SYNC_STATE_DEBOUNCE_MS = 1500
export const SYNC_RETRY_DEBOUNCE_MS = 500
/** Cheap version probe while the tab is visible (last-writer-wins stale check). */
export const SYNC_VERSION_POLL_MS = 15_000
