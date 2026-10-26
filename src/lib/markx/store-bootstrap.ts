import { useEffect, useRef, useState } from "react"

import { getAuthSession } from "@/lib/auth/session"
import type { AuthSessionSnapshot } from "@/lib/auth/session"
import type { AuthUser } from "@/lib/auth/types"
import { clearLastUserId, getLastUserId, resetGuestState } from "./storage"
import {
  attachEngineAndPaint,
  refreshEngineInBackground,
} from "./sync-lifecycle"
import { SyncEngine } from "./sync"
import type { MarkxStore } from "./store"
import type { MarkxState } from "./types"

const SESSION_TIMEOUT_MS = 3000
const CLOUD_FIRST_LOAD_TIMEOUT_MS = 8000
/**
 * The whole app renders behind this bootstrap, so a step that never settles
 * (IndexedDB blocked by another tab mid-upgrade, storage disabled by the
 * browser) would otherwise leave the loading shell up forever with no way
 * out. Generous enough that a slow-but-working cold start still wins.
 */
const BOOTSTRAP_TIMEOUT_MS = 15000

/** Backoff after a session check that failed in transit. The last delay repeats. */
export const SESSION_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000]

export type InitialSyncStatus = "idle" | "loading" | "error"

export type SessionCheckResult =
  | { status: "user"; user: AuthUser }
  | { status: "guest" }
  | { status: "unavailable" }

/**
 * Methods bootstrap needs from a sync engine. The real {@link SyncEngine}
 * satisfies this. Tests pass a fake.
 */
export type BootstrapEngine = {
  getUserId: () => string
  hasCachedState: () => boolean
  getLoadedState: () => MarkxState | null
  destroy: () => void
  flushAndDestroy: () => Promise<boolean>
  clearCache: () => Promise<void>
  subscribe: SyncEngine["subscribe"]
}

export type MarkxBootstrapPorts = {
  store: MarkxStore
  isCancelled: () => boolean
  probeSession: () => Promise<SessionCheckResult>
  getLastUserId: () => Promise<string | null>
  createEngineFromCache: (userId: string) => Promise<BootstrapEngine>
  sleep: (ms: number) => Promise<void>
  clearLastUserId: () => Promise<void>
  resetGuestState: () => Promise<MarkxState>
  onShellReady: (branch: string) => void
  onCachedUserConfirmed: (engine: BootstrapEngine) => void
  onCloudLoad: (engine: BootstrapEngine) => void
}

function classifySnapshot(session: AuthSessionSnapshot): SessionCheckResult {
  if (session.outcome === "unavailable" || session.outcome === "pending") {
    return { status: "unavailable" }
  }
  if (session.outcome === "guest") return { status: "guest" }
  if (session.isPending && !session.user) return { status: "unavailable" }
  if (session.user) return { status: "user", user: session.user }
  return { status: "guest" }
}

export async function getSessionUserWithTimeout(
  timeoutMs = SESSION_TIMEOUT_MS
): Promise<SessionCheckResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const result = await Promise.race([
    getAuthSession()
      .then((session) => ({ kind: "session" as const, session }))
      .catch((err: unknown) => {
        console.warn("[markx init] getSession failed", err)
        return { kind: "error" as const }
      }),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer)
  })
  if (result.kind === "timeout") {
    console.warn(`[markx init] getSession timed out after ${timeoutMs}ms`)
    return { status: "unavailable" }
  }
  if (result.kind === "error") return { status: "unavailable" }
  return classifySnapshot(result.session)
}

function retryDelay(attempt: number): number {
  return (
    SESSION_RETRY_DELAYS_MS[
      Math.min(attempt, SESSION_RETRY_DELAYS_MS.length - 1)
    ] ?? SESSION_RETRY_DELAYS_MS[0]
  )
}

function logSession(session: SessionCheckResult): void {
  console.info(
    "[markx init] session checked",
    session.status === "user" ? `user=${session.user.id}` : session.status
  )
}

async function readProbe(
  probeSession: () => Promise<SessionCheckResult>
): Promise<SessionCheckResult> {
  try {
    return await probeSession()
  } catch (err) {
    console.warn("[markx init] getSession failed", err)
    return { status: "unavailable" }
  }
}

function isAttached(store: MarkxStore, engine: BootstrapEngine): boolean {
  return store.getSyncEngine() === (engine as SyncEngine)
}

/**
 * Drop a signed-in engine after the server says the session is gone.
 * Unsynced edits stay in the per-user cache. A clean flush may clear it.
 * Does not call the auth server; the session is already gone.
 */
async function releaseRejectedSession(
  store: MarkxStore,
  engine: BootstrapEngine
): Promise<void> {
  try {
    const canClear = await engine.flushAndDestroy()
    if (canClear) await engine.clearCache()
  } catch (err) {
    console.error("[markx init] flush before guest fallback failed", err)
    engine.destroy()
  }
  if (isAttached(store, engine)) store.detachSync()
}

/**
 * Boot the workspace.
 *
 * A last signed-in user with a local cache paints immediately. The session
 * check then runs, with backoff when the network fails. Only a definitive
 * guest result leaves that cache. A slow or failed check never does.
 * With no cache, the first failed check paints the guest workspace so an
 * offline visitor is not stuck, then upgrades if the session arrives.
 */
export async function runMarkxBootstrap(
  ports: MarkxBootstrapPorts
): Promise<void> {
  const {
    store,
    isCancelled,
    probeSession,
    getLastUserId: readLastUserId,
    createEngineFromCache,
    sleep,
    clearLastUserId: forgetLastUser,
    resetGuestState: loadGuestDemo,
    onShellReady,
    onCachedUserConfirmed,
    onCloudLoad,
  } = ports

  console.info("[markx init] starting")
  const startedAt = performance.now()
  const logTiming = (stage: string) => {
    console.info("[markx init] timing", {
      stage,
      durationMs: Math.round(performance.now() - startedAt),
    })
  }

  const firstProbe = readProbe(probeSession)
  // IndexedDB failure must reject. The hook shows the reload shell.
  const lastUserId = await readLastUserId()
  logTiming("cache-lookup")

  let prepared: BootstrapEngine | null = null
  let painted = false
  const ready = (branch: string) => {
    painted = true
    onShellReady(branch)
  }

  const useEngine = async (engine: BootstrapEngine): Promise<void> => {
    if (!isAttached(store, engine)) {
      await attachEngineAndPaint(store, engine as SyncEngine)
      if (isCancelled()) {
        engine.destroy()
        return
      }
    }
    if (engine.hasCachedState()) {
      if (!painted) ready("cache")
      onCachedUserConfirmed(engine)
      return
    }
    onCloudLoad(engine)
    ready("cloud-loading")
  }

  try {
    if (isCancelled()) return
    if (lastUserId) {
      prepared = await createEngineFromCache(lastUserId)
      if (isCancelled()) {
        prepared.destroy()
        return
      }
      if (prepared.hasCachedState()) {
        await attachEngineAndPaint(store, prepared as SyncEngine)
        if (isCancelled()) {
          prepared.destroy()
          return
        }
        painted = true
        onShellReady("optimistic-cache")
        console.info("[markx init] optimistic cache", { userId: lastUserId })
      }
    }

    let session = await firstProbe
    logTiming("session-restore")
    logSession(session)
    if (isCancelled()) return

    if (!painted && session.status === "unavailable") {
      await store.hydrate()
      if (isCancelled()) return
      ready("guest-pending")
    }

    let attempt = 0
    while (session.status === "unavailable") {
      if (isCancelled()) return
      const delay = retryDelay(attempt)
      attempt += 1
      console.warn(`[markx init] session unavailable, retrying in ${delay}ms`)
      await sleep(delay)
      if (isCancelled()) return
      session = await readProbe(probeSession)
      logSession(session)
    }

    if (session.status === "guest") {
      if (prepared && isAttached(store, prepared)) {
        console.info("[markx init] session rejected, returning to guest")
        await releaseRejectedSession(store, prepared)
        if (isCancelled()) return
        await forgetLastUser()
        store.replaceState(await loadGuestDemo(), { persist: false })
        return
      }
      prepared?.destroy()
      await forgetLastUser()
      if (!painted) {
        await store.hydrate()
        if (isCancelled()) return
        ready("guest")
      }
      return
    }

    if (prepared && prepared.getUserId() === session.user.id) {
      await useEngine(prepared)
      return
    }

    if (prepared) {
      console.info("[markx init] session user changed", {
        from: prepared.getUserId(),
        to: session.user.id,
      })
      if (isAttached(store, prepared)) store.detachSync()
      prepared.destroy()
    }

    const engine = await createEngineFromCache(session.user.id)
    if (isCancelled()) {
      engine.destroy()
      return
    }
    await useEngine(engine)
  } catch (err) {
    console.error("[markx init] auth/sync error, falling back to guest", err)
    if (isCancelled() || painted) return
    await store.hydrate()
    if (isCancelled()) return
    ready("sync-error-guest-fallback")
  }
}

export function useMarkxBootstrap(store: MarkxStore): {
  ready: boolean
  failed: boolean
  initialSyncStatus: InitialSyncStatus
  retryInitialSync: () => void
} {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [initialSyncStatus, setInitialSyncStatus] =
    useState<InitialSyncStatus>("idle")
  const retryInitialSyncRef = useRef<() => void>(() => {})
  const initialSyncEngineRef = useRef<SyncEngine | null>(null)

  useEffect(
    () =>
      store.subscribe(() => {
        const initialEngine = initialSyncEngineRef.current
        if (initialEngine && store.getSyncEngine() !== initialEngine) {
          initialSyncEngineRef.current = null
          retryInitialSyncRef.current = () => {}
          setInitialSyncStatus("idle")
        }
      }),
    [store]
  )

  useEffect(() => {
    const cancelled = { current: false }
    const isCancelled = () => cancelled.current
    let shellReady = false
    const initStartedAt = performance.now()

    const markShellReady = (branch: string) => {
      shellReady = true
      clearTimeout(watchdog)
      setFailed(false)
      setReady(true)
      requestAnimationFrame(() =>
        console.info("[markx init] timing", {
          stage: "first-shell-paint",
          durationMs: Math.round(performance.now() - initStartedAt),
        })
      )
      console.info("[markx init] ready", { branch })
    }

    const beginCloudLoad = (engine: SyncEngine) => {
      initialSyncEngineRef.current = engine
      setInitialSyncStatus("loading")

      let activeCloudLoad: Promise<MarkxState | null> | null = null
      let cloudLoadStartedAt = performance.now()
      const applyCloudState = (cloudState: MarkxState | null) => {
        if (isCancelled() || store.getSyncEngine() !== engine) return
        if (cloudState) {
          store.replaceState(cloudState, { persist: false })
          initialSyncEngineRef.current = null
          retryInitialSyncRef.current = () => {}
          setInitialSyncStatus("idle")
          console.info("[markx init] initial cloud load applied")
        } else {
          setInitialSyncStatus("error")
          console.warn("[markx init] initial cloud load failed")
        }
        console.info("[markx init] timing", {
          stage: "initial-cloud-load",
          durationMs: Math.round(performance.now() - cloudLoadStartedAt),
        })
      }

      const runInitialCloudLoad = () => {
        if (isCancelled() || store.getSyncEngine() !== engine) return
        setInitialSyncStatus("loading")
        cloudLoadStartedAt = performance.now()
        const cloudLoad =
          activeCloudLoad ??
          engine.refreshFromCloud().finally(() => {
            activeCloudLoad = null
          })
        activeCloudLoad = cloudLoad
        void cloudLoad.then(applyCloudState)
        void Promise.race([
          cloudLoad.then(() => "settled" as const),
          new Promise<"timeout">((resolve) =>
            setTimeout(() => resolve("timeout"), CLOUD_FIRST_LOAD_TIMEOUT_MS)
          ),
        ]).then((result) => {
          if (
            result === "timeout" &&
            !isCancelled() &&
            store.getSyncEngine() === engine
          ) {
            setInitialSyncStatus("error")
            console.warn(
              `[markx init] initial cloud load still pending after ${CLOUD_FIRST_LOAD_TIMEOUT_MS}ms`
            )
          }
        })
      }

      retryInitialSyncRef.current = runInitialCloudLoad
      runInitialCloudLoad()
    }

    const watchdog = setTimeout(() => {
      if (isCancelled() || shellReady) return
      console.error(
        `[markx init] bootstrap stalled for ${BOOTSTRAP_TIMEOUT_MS}ms`
      )
      setFailed(true)
    }, BOOTSTRAP_TIMEOUT_MS)

    void runMarkxBootstrap({
      store,
      isCancelled,
      probeSession: () => getSessionUserWithTimeout(),
      getLastUserId,
      createEngineFromCache: (userId) => SyncEngine.createFromCache(userId),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      clearLastUserId,
      resetGuestState,
      onShellReady: markShellReady,
      onCachedUserConfirmed: (engine) => {
        refreshEngineInBackground(store, engine as SyncEngine, isCancelled)
      },
      onCloudLoad: (engine) => beginCloudLoad(engine as SyncEngine),
    }).catch((err: unknown) => {
      console.error("[markx init] bootstrap threw", err)
      if (isCancelled() || shellReady) return
      setFailed(true)
    })

    return () => {
      cancelled.current = true
      clearTimeout(watchdog)
      initialSyncEngineRef.current = null
      retryInitialSyncRef.current = () => {}
    }
  }, [store])

  return {
    ready,
    failed,
    initialSyncStatus,
    retryInitialSync: () => retryInitialSyncRef.current(),
  }
}
