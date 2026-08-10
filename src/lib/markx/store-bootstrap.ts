import { useEffect, useRef, useState } from "react"

import { getAuthSession } from "@/lib/auth/session"
import type { AuthUser } from "@/lib/auth/types"
import { getLastUserId } from "./storage"
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

export type InitialSyncStatus = "idle" | "loading" | "error"

type SessionCheckResult =
  | { status: "user"; user: AuthUser }
  | { status: "guest" }
  | { status: "timeout" }

export async function getSessionUserWithTimeout(
  timeoutMs = SESSION_TIMEOUT_MS
): Promise<SessionCheckResult> {
  try {
    const result = await Promise.race([
      getAuthSession().then((session) => ({
        kind: "session" as const,
        session,
      })),
      new Promise<{ kind: "timeout" }>((resolve) =>
        setTimeout(() => resolve({ kind: "timeout" }), timeoutMs)
      ),
    ])
    if (result.kind === "timeout") {
      console.warn(`[markx init] getSession timed out after ${timeoutMs}ms`)
      return { status: "timeout" }
    }
    return result.session.user
      ? { status: "user", user: result.session.user }
      : { status: "guest" }
  } catch (err) {
    console.error("[markx init] getSession failed", err)
    return { status: "guest" }
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

    async function init() {
      const initStartedAt = performance.now()
      const logTiming = (stage: string, startedAt = initStartedAt) => {
        console.info("[markx init] timing", {
          stage,
          durationMs: Math.round(performance.now() - startedAt),
        })
      }
      const markShellReady = (branch: string) => {
        shellReady = true
        clearTimeout(watchdog)
        setReady(true)
        requestAnimationFrame(() => logTiming("first-shell-paint"))
        console.info("[markx init] ready", { branch })
      }

      console.info("[markx init] starting")
      const sessionPromise = getSessionUserWithTimeout()
      const lastUserIdPromise = getLastUserId()
      const session = await sessionPromise
      if (isCancelled()) {
        return
      }
      console.info(
        "[markx init] session checked",
        session.status === "user" ? `user=${session.user.id}` : session.status
      )
      logTiming("session-restore")
      await lastUserIdPromise
      logTiming("cache-lookup")

      if (session.status !== "user") {
        await store.hydrate()
        if (isCancelled()) return
        markShellReady("guest")
        return
      }

      const user = session.user

      try {
        const cachedEngine = await SyncEngine.createFromCache(user.id)
        if (isCancelled()) {
          cachedEngine.destroy()
          return
        }

        if (cachedEngine.hasCachedState()) {
          await attachEngineAndPaint(store, cachedEngine)
          if (isCancelled()) {
            cachedEngine.destroy()
            return
          }
          markShellReady("cache")
          refreshEngineInBackground(store, cachedEngine, isCancelled)
          return
        }

        const engine = cachedEngine
        await attachEngineAndPaint(store, engine)
        if (isCancelled()) {
          engine.destroy()
          return
        }
        initialSyncEngineRef.current = engine
        setInitialSyncStatus("loading")
        markShellReady("cloud-loading")

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
          logTiming("initial-cloud-load", cloudLoadStartedAt)
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
      } catch (err) {
        console.error(
          "[markx init] auth/sync error, falling back to guest",
          err
        )
        if (isCancelled()) return
        await store.hydrate()
        if (isCancelled()) return
        markShellReady("sync-error-guest-fallback")
      }
    }

    const watchdog = setTimeout(() => {
      if (isCancelled() || shellReady) return
      console.error(
        `[markx init] bootstrap stalled for ${BOOTSTRAP_TIMEOUT_MS}ms`
      )
      setFailed(true)
    }, BOOTSTRAP_TIMEOUT_MS)

    void init().catch((err: unknown) => {
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
