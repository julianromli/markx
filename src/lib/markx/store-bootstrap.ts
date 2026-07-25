import { useEffect, useRef, useState } from "react"

import { getAuthSession } from "@/lib/auth/session"
import type { AuthUser } from "@/lib/auth/types"
import { shouldImportGuest } from "./state"
import { getLastUserId, loadUserState } from "./storage"
import {
  attachEngineAndPaint,
  refreshEngineInBackground,
} from "./sync-lifecycle"
import { SyncEngine } from "./sync"
import type { MarkxStore } from "./store"
import type { MarkxState } from "./types"

const SESSION_TIMEOUT_MS = 3000
const CLOUD_FIRST_LOAD_TIMEOUT_MS = 8000

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
  initialSyncStatus: InitialSyncStatus
  retryInitialSync: () => void
} {
  const [ready, setReady] = useState(false)
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

    async function init() {
      const initStartedAt = performance.now()
      const logTiming = (stage: string, startedAt = initStartedAt) => {
        console.info("[markx init] timing", {
          stage,
          durationMs: Math.round(performance.now() - startedAt),
        })
      }
      const markShellReady = (branch: string) => {
        setReady(true)
        requestAnimationFrame(() => logTiming("first-shell-paint"))
        console.info("[markx init] ready", { branch })
      }

      console.info("[markx init] starting")
      const sessionPromise = getSessionUserWithTimeout()
      let optimisticEngine: SyncEngine | null = null
      const lastUserId = await getLastUserId()
      if (isCancelled()) return

      if (lastUserId) {
        try {
          const cached = await loadUserState(lastUserId)
          if (isCancelled()) return
          if (cached) {
            optimisticEngine = await SyncEngine.createFromCache(lastUserId)
            if (isCancelled()) {
              optimisticEngine.destroy()
              return
            }
            await attachEngineAndPaint(store, optimisticEngine)
            if (isCancelled()) {
              optimisticEngine.destroy()
              return
            }
            markShellReady("cache-optimistic")
          }
        } catch (err) {
          console.error("[markx init] optimistic cache paint failed", err)
          optimisticEngine?.destroy()
          optimisticEngine = null
        }
      }
      logTiming("cache-lookup")

      const session = await sessionPromise
      if (isCancelled()) {
        optimisticEngine?.destroy()
        return
      }
      console.info(
        "[markx init] session checked",
        session.status === "user" ? `user=${session.user.id}` : session.status
      )
      logTiming("session-restore")

      if (session.status === "timeout" && optimisticEngine) {
        console.warn(
          "[markx init] session timeout — keeping optimistic cache paint"
        )
        refreshEngineInBackground(store, optimisticEngine, isCancelled)
        return
      }

      if (session.status !== "user") {
        if (optimisticEngine) {
          optimisticEngine.destroy()
          store.detachSync()
        }
        await store.hydrate()
        if (isCancelled()) return
        markShellReady("guest")
        return
      }

      const user = session.user
      if (optimisticEngine && optimisticEngine.getUserId() === user.id) {
        if (!(await shouldImportGuest(user.id))) {
          refreshEngineInBackground(store, optimisticEngine, isCancelled)
          return
        }
        optimisticEngine.destroy()
        store.detachSync()
        optimisticEngine = null
      }

      if (optimisticEngine) {
        optimisticEngine.destroy()
        store.detachSync()
      }

      try {
        const cachedEngine = await SyncEngine.createFromCache(user.id)
        if (isCancelled()) {
          cachedEngine.destroy()
          return
        }

        const importGuest = await shouldImportGuest(user.id)
        if (cachedEngine.hasCachedState() && !importGuest) {
          await attachEngineAndPaint(store, cachedEngine)
          if (isCancelled()) {
            cachedEngine.destroy()
            return
          }
          markShellReady("cache")
          refreshEngineInBackground(store, cachedEngine, isCancelled)
          return
        }

        if (importGuest) {
          cachedEngine.destroy()
          const createPromise = SyncEngine.create(user.id)
          const engine = await Promise.race([
            createPromise,
            new Promise<null>((resolve) =>
              setTimeout(() => resolve(null), CLOUD_FIRST_LOAD_TIMEOUT_MS)
            ),
          ])
          if (isCancelled()) {
            engine?.destroy()
            return
          }
          if (!engine) {
            console.warn(
              `[markx init] SyncEngine.create timed out after ${CLOUD_FIRST_LOAD_TIMEOUT_MS}ms — falling back to guest`
            )
            void createPromise
              .then((lateEngine) => lateEngine.destroy())
              .catch((err) =>
                console.error("[markx init] late guest import failed", err)
              )
            await store.hydrate()
            if (isCancelled()) return
            markShellReady("guest-import-timeout")
            return
          }
          await attachEngineAndPaint(store, engine)
          if (isCancelled()) {
            engine.destroy()
            return
          }
          markShellReady("guest-import")
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

    void init()
    return () => {
      cancelled.current = true
      initialSyncEngineRef.current = null
      retryInitialSyncRef.current = () => {}
    }
  }, [store])

  return {
    ready,
    initialSyncStatus,
    retryInitialSync: () => retryInitialSyncRef.current(),
  }
}
