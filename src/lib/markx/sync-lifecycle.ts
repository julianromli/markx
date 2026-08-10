import { setLastUserId } from "./storage"
import type { MarkxStore } from "./store"
import type { SyncEngine } from "./sync"

export async function attachEngineAndPaint(
  store: MarkxStore,
  engine: SyncEngine,
  persistLastUserId: (userId: string) => Promise<void> = setLastUserId
): Promise<void> {
  store.attachSync(engine)
  const loaded = engine.getLoadedState()
  if (loaded) {
    store.replaceState(loaded, { persist: false })
  }
  store.finishHydration()
  await persistLastUserId(engine.getUserId())
}

export function refreshEngineInBackground(
  store: MarkxStore,
  engine: SyncEngine,
  cancelled: () => boolean
): void {
  void (async () => {
    try {
      // Last-writer-wins: do not auto-adopt cloud on revisit. Only mark stale.
      await engine.checkRemoteVersion()
      if (cancelled() || store.getSyncEngine() !== engine) return
      console.info("[markx init] checked remote version")
    } catch (err) {
      console.error("[markx init] background version check failed", err)
    }
  })()
}
