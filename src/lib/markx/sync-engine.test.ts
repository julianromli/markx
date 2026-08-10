import { afterEach, describe, expect, it, vi } from "vitest"

import { createDemoState, createEmptyState } from "@/lib/markx/seed"
import { SyncEngine } from "@/lib/markx/sync"
import type { SyncEngineDependencies } from "@/lib/markx/sync"
import { SYNC_VERSION_POLL_MS } from "@/lib/markx/sync-timings"
import type { MarkxState } from "@/lib/markx/types"

function stateWithFolder(id: string): MarkxState {
  return {
    ...createEmptyState(),
    folders: [{ id, name: id, x: 0, y: 0, z: 1 }],
  }
}

function createDependencies(opts?: {
  cached?: MarkxState | null
  pending?: MarkxState | null
  cloud?: MarkxState
  guestState?: MarkxState
  guestImported?: boolean
  saveResult?: Awaited<ReturnType<SyncEngineDependencies["workspace"]["save"]>>
  importGuestResult?: Awaited<
    ReturnType<SyncEngineDependencies["workspace"]["importGuest"]>
  >
  importGuestImpl?: SyncEngineDependencies["workspace"]["importGuest"]
}) {
  let pending = opts?.pending ?? null
  let guestImported = opts?.guestImported ?? true
  const cachedState =
    opts && "cached" in opts ? (opts.cached ?? null) : createEmptyState()
  const cloud = opts?.cloud ?? stateWithFolder("cloud")
  const guestState = opts?.guestState ?? createEmptyState()
  const save = vi.fn(async () =>
    opts?.saveResult
      ? opts.saveResult
      : {
          ok: true as const,
          version: 2,
          updatedAt: "now",
          state: cloud,
        }
  )
  const overwrite = vi.fn(async (input: { state: MarkxState }) => ({
    ok: true as const,
    version: 3,
    updatedAt: "now",
    state: input.state,
  }))
  const importGuest =
    opts?.importGuestImpl ??
    vi.fn(async () =>
      opts?.importGuestResult
        ? opts.importGuestResult
        : {
            ok: true as const,
            version: 2,
            updatedAt: "now",
            state: guestState,
          }
    )
  const resetGuestState = vi.fn(async () => createDemoState())
  const markGuestImported = vi.fn(async () => {
    guestImported = true
  })
  const enqueueAsset = vi.fn(async () => {})
  const getImageBlob = vi.fn(async () => undefined as Blob | undefined)
  const dependencies: SyncEngineDependencies = {
    workspace: {
      load: vi.fn(async () => ({
        id: "workspace",
        userId: "user-1",
        state: cloud,
        version: 2,
        updatedAt: "now",
      })),
      getVersion: vi.fn(async () => 2),
      save,
      importGuest,
      overwrite,
    },
    assets: {
      upload: vi.fn(async () => ({ ok: true })),
      fetch: vi.fn(async () => ({ ok: false as const })),
    },
    storage: {
      loadGuestState: vi.fn(async () => guestState),
      resetGuestState,
      loadUserState: vi.fn(async () => cachedState),
      saveUserState: vi.fn(async () => {}),
      clearUserCache: vi.fn(async () => {}),
      getCloudVersion: vi.fn(async () => 1),
      setCloudVersion: vi.fn(async () => {}),
      isGuestImported: vi.fn(async () => guestImported),
      markGuestImported,
      getPendingSnapshot: vi.fn(async () => pending),
      setPendingSnapshot: vi.fn(async (_userId, state) => {
        pending = state
      }),
      addDeletedImageIds: vi.fn(async () => []),
      getDeletedImageIds: vi.fn(async () => []),
      clearDeletedImageIds: vi.fn(async () => {}),
      getAssetQueue: vi.fn(async () => []),
      enqueueAsset,
      removeAssetsFromQueue: vi.fn(async () => {}),
      saveImageBlob: vi.fn(async () => {}),
      getImageBlob,
    },
  }
  return {
    dependencies,
    save,
    overwrite,
    importGuest,
    resetGuestState,
    markGuestImported,
    enqueueAsset,
    getImageBlob,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("SyncEngine last-writer-wins", () => {
  it("uses injected workspace and storage adapters", async () => {
    const { dependencies } = createDependencies()
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    const refreshed = await engine.refreshFromCloud()

    expect(dependencies.storage.loadUserState).toHaveBeenCalledWith("user-1")
    expect(dependencies.workspace.load).toHaveBeenCalledTimes(1)
    expect(refreshed?.folders[0]?.id).toBe("cloud")
    engine.destroy()
  })

  it("adopts cloud on explicit refreshFromCloud bootstrap", async () => {
    const remote = stateWithFolder("remote")
    const { dependencies } = createDependencies({
      cached: stateWithFolder("local"),
      cloud: remote,
    })
    dependencies.workspace.load = vi.fn(async () => ({
      id: "workspace",
      userId: "user-1",
      state: remote,
      version: 5,
      updatedAt: "later",
    }))

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    const refreshed = await engine.refreshFromCloud()

    expect(refreshed).toBe(remote)
    expect(engine.getCloudVersion()).toBe(5)
    expect(engine.isStale()).toBe(false)
    engine.destroy()
  })

  it("marks stale when remote version is ahead without loading state", async () => {
    const { dependencies } = createDependencies({
      cached: stateWithFolder("local"),
    })
    dependencies.storage.getCloudVersion = vi.fn(async () => 4)
    dependencies.workspace.getVersion = vi.fn(async () => 7)

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    await engine.checkRemoteVersion()

    expect(engine.isStale()).toBe(true)
    expect(engine.isStaleBannerVisible()).toBe(true)
    expect(dependencies.workspace.load).not.toHaveBeenCalled()
    engine.destroy()
  })

  it("re-shows stale banner on the next version check after dismiss", async () => {
    const { dependencies } = createDependencies()
    dependencies.storage.getCloudVersion = vi.fn(async () => 4)
    dependencies.workspace.getVersion = vi.fn(async () => 7)

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    await engine.checkRemoteVersion()
    engine.dismissStaleBanner()
    expect(engine.isStaleBannerVisible()).toBe(false)

    await engine.checkRemoteVersion()
    expect(engine.isStaleBannerVisible()).toBe(true)
    engine.destroy()
  })

  it("reloadFromCloud adopts cloud and clears stale", async () => {
    const remote = stateWithFolder("fresh-cloud")
    const { dependencies } = createDependencies({
      cached: stateWithFolder("stale-local"),
    })
    dependencies.storage.getCloudVersion = vi.fn(async () => 4)
    dependencies.workspace.getVersion = vi.fn(async () => 7)
    dependencies.workspace.load = vi.fn(async () => ({
      id: "workspace",
      userId: "user-1",
      state: remote,
      version: 7,
      updatedAt: "later",
    }))

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    await engine.checkRemoteVersion()
    expect(engine.isStaleBannerVisible()).toBe(true)

    const reloaded = await engine.reloadFromCloud()
    expect(reloaded).toBe(remote)
    expect(engine.isStale()).toBe(false)
    expect(engine.getCloudVersion()).toBe(7)
    engine.destroy()
  })

  it("probes version on the poll interval without full load when unchanged", async () => {
    vi.useFakeTimers()
    const { dependencies } = createDependencies()
    dependencies.storage.getCloudVersion = vi.fn(async () => 2)
    dependencies.workspace.getVersion = vi.fn(async () => 2)

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    await vi.advanceTimersByTimeAsync(SYNC_VERSION_POLL_MS)

    expect(dependencies.workspace.getVersion).toHaveBeenCalled()
    expect(dependencies.workspace.load).not.toHaveBeenCalled()
    expect(engine.isStale()).toBe(false)
    engine.destroy()
  })

  it("saves local state as last writer", async () => {
    vi.useFakeTimers()
    const local = stateWithFolder("laptop-folder")
    const { dependencies, save } = createDependencies({
      saveResult: {
        ok: true,
        version: 5,
        updatedAt: "now",
        state: local,
      },
    })
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    engine.onStateChange(local)
    await vi.advanceTimersByTimeAsync(1500)

    expect(engine.getStatus()).toBe("saved")
    expect(engine.getLoadedState()?.folders[0]?.id).toBe("laptop-folder")
    expect(save).toHaveBeenCalledTimes(1)
    expect(engine.isStale()).toBe(false)
    engine.destroy()
  })

  it("overwrites cloud when save returns conflict", async () => {
    vi.useFakeTimers()
    const local = stateWithFolder("laptop-folder")
    const { dependencies, save, overwrite } = createDependencies()
    save.mockResolvedValueOnce({
      ok: false,
      reason: "conflict",
      cloudVersion: 4,
      cloudState: stateWithFolder("mobile-folder"),
      cloudUpdatedAt: "later",
    })
    overwrite.mockResolvedValueOnce({
      ok: true,
      version: 5,
      updatedAt: "now",
      state: local,
    })

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    engine.onStateChange(local)
    await vi.advanceTimersByTimeAsync(1500)

    expect(overwrite).toHaveBeenCalledTimes(1)
    expect(engine.getStatus()).toBe("saved")
    expect(engine.getConflict()).toBeUndefined()
    expect(engine.getLoadedState()?.folders[0]?.id).toBe("laptop-folder")
    expect(engine.getCloudVersion()).toBe(5)
    engine.destroy()
  })

  it("keeps mid-save local edits without merging cloud entities", async () => {
    vi.useFakeTimers()
    const sent = stateWithFolder("sent-folder")
    const duringSave = stateWithFolder("during-folder")
    let resolveSave!: (value: {
      ok: true
      version: number
      updatedAt: string
      state: MarkxState
    }) => void
    const saveGate = new Promise<{
      ok: true
      version: number
      updatedAt: string
      state: MarkxState
    }>((resolve) => {
      resolveSave = resolve
    })
    const { dependencies, save } = createDependencies()
    save.mockImplementation(async () => saveGate)

    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    engine.onStateChange(sent)
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).toHaveBeenCalledTimes(1)

    engine.onStateChange(duringSave)
    resolveSave({
      ok: true,
      version: 5,
      updatedAt: "now",
      state: sent,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.getLoadedState()?.folders.map((folder) => folder.id)).toEqual(
      ["during-folder"]
    )
    engine.destroy()
  })

  it("keeps the per-user cache when logout cannot sync pending changes", async () => {
    const { dependencies } = createDependencies({
      saveResult: {
        ok: false,
        reason: "error",
        message: "offline",
      },
    })
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    engine.onStateChange(stateWithFolder("pending"))
    const canClearCache = await engine.flushAndDestroy()

    expect(canClearCache).toBe(false)
    expect(dependencies.storage.setPendingSnapshot).toHaveBeenCalled()
  })
})

describe("SyncEngine first-login guest bootstrap", () => {
  it("discards modified guest data and loads cloud on login", async () => {
    const guest = stateWithFolder("guest-folder")
    const cloud = stateWithFolder("cloud-folder")
    const { dependencies, importGuest, markGuestImported, resetGuestState } =
      createDependencies({
        guestImported: false,
        guestState: guest,
        cached: null,
        cloud,
      })

    const engine = await SyncEngine.create("user-1", dependencies)

    expect(importGuest).not.toHaveBeenCalled()
    expect(dependencies.workspace.load).toHaveBeenCalled()
    expect(engine.getLoadedState()?.folders[0]?.id).toBe("cloud-folder")
    expect(markGuestImported).toHaveBeenCalledWith("user-1")
    expect(resetGuestState).toHaveBeenCalled()
    expect(engine.getStatus()).toBe("saved")
    expect(engine.getConflict()).toBeUndefined()
    engine.destroy()
  })

  it("finalizes bootstrap from an empty cloud without importing guest", async () => {
    const { dependencies, importGuest, markGuestImported, resetGuestState } =
      createDependencies({
        guestImported: false,
        guestState: stateWithFolder("guest-folder"),
        cached: null,
        cloud: createEmptyState(),
      })

    const engine = await SyncEngine.create("user-1", dependencies)

    expect(importGuest).not.toHaveBeenCalled()
    expect(dependencies.workspace.load).toHaveBeenCalled()
    expect(engine.getLoadedState()?.folders).toEqual([])
    expect(markGuestImported).toHaveBeenCalledWith("user-1")
    expect(resetGuestState).toHaveBeenCalled()
    engine.destroy()
  })
})
