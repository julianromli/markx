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
      const cloudState = await engine.refreshFromCloud()
      if (cancelled() || !cloudState || store.getSyncEngine() !== engine) return
      store.replaceState(cloudState, { persist: false })
      console.info("[markx init] applied cloud refresh")
    } catch (err) {
      console.error("[markx init] background cloud refresh failed", err)
    }
  })()
}
