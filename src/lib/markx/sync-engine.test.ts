import { afterEach, describe, expect, it, vi } from "vitest"

import { mergeWorkspaceStates } from "@/lib/markx/merge-workspace"
import { createDemoState, createEmptyState } from "@/lib/markx/seed"
import { SyncEngine } from "@/lib/markx/sync"
import type { SyncEngineDependencies } from "@/lib/markx/sync"
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
      save,
      importGuest,
      overwrite: vi.fn(async (input) => ({
        ok: true as const,
        version: 3,
        updatedAt: "now",
        state: input.state,
      })),
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

describe("SyncEngine dependency boundaries", () => {
  it("uses injected workspace and storage adapters", async () => {
    const { dependencies } = createDependencies()
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    const refreshed = await engine.refreshFromCloud()

    expect(dependencies.storage.loadUserState).toHaveBeenCalledWith("user-1")
    expect(dependencies.workspace.load).toHaveBeenCalledTimes(1)
    expect(refreshed?.folders[0]?.id).toBe("cloud")
    engine.destroy()
  })

  it("merges remote additions into local edits on cloud refresh", async () => {
    const local = stateWithFolder("local")
    const cloud = stateWithFolder("cloud")
    const { dependencies } = createDependencies({ cloud })
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    engine.onStateChange(local)
    const refreshed = await engine.refreshFromCloud()

    expect(refreshed?.folders.map((folder) => folder.id)).toEqual([
      "cloud",
      "local",
    ])
    expect(engine.getLoadedState()?.folders.map((folder) => folder.id)).toEqual(
      ["cloud", "local"]
    )
    engine.destroy()
  })

  it("adopts a newer remote snapshot during realtime refresh", async () => {
    vi.useFakeTimers()
    const remote = stateWithFolder("remote-bookmark")
    const { dependencies } = createDependencies({
      cached: stateWithFolder("local"),
    })
    dependencies.workspace.load = vi.fn(async () => ({
      id: "workspace",
      userId: "user-1",
      state: remote,
      version: 3,
      updatedAt: "later",
    }))

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    let authoritative: MarkxState | undefined
    engine.subscribe((_status, _conflict, state) => {
      authoritative = state
    })
    await vi.advanceTimersByTimeAsync(2000)

    expect(engine.getLoadedState()).toBe(remote)
    expect(authoritative).toBe(remote)
    expect(engine.getStatus()).toBe("saved")
    expect(dependencies.workspace.load).toHaveBeenCalledTimes(1)
    engine.destroy()
  })

  it("adopts newer cloud state even when another tab left a shared pending snapshot", async () => {
    const staleLocal = stateWithFolder("stale-local")
    const remote = stateWithFolder("from-other-tab")
    const { dependencies } = createDependencies({
      cached: staleLocal,
      pending: stateWithFolder("other-tab-pending"),
      cloud: remote,
    })
    dependencies.workspace.load = vi.fn(async () => ({
      id: "workspace",
      userId: "user-1",
      state: remote,
      version: 5,
      updatedAt: "later",
    }))
    dependencies.storage.getCloudVersion = vi.fn(async () => 4)

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    let authoritative: MarkxState | undefined
    engine.subscribe((_status, _conflict, state) => {
      if (state) authoritative = state
    })

    const refreshed = await engine.refreshFromCloud()

    expect(refreshed).toBe(remote)
    expect(authoritative).toBe(remote)
    expect(engine.getLoadedState()).toBe(remote)
    expect(engine.getStatus()).toBe("saved")
    engine.destroy()
  })

  it("refreshes from cloud immediately when the tab becomes visible", async () => {
    vi.useFakeTimers()
    const remote = stateWithFolder("visible-remote")
    const { dependencies } = createDependencies({
      cached: stateWithFolder("local"),
    })
    const load = vi.fn(async () => ({
      id: "workspace",
      userId: "user-1",
      state: remote,
      version: 3,
      updatedAt: "later",
    }))
    dependencies.workspace.load = load

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })

    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    await vi.advanceTimersByTimeAsync(2000)
    expect(load).not.toHaveBeenCalled()

    let visibility: DocumentVisibilityState = "visible"
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    })
    document.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(0)

    expect(load).toHaveBeenCalledTimes(1)
    expect(engine.getLoadedState()).toBe(remote)
    engine.destroy()
    visibility = "visible"
  })

  it("adopts server-merged state from a single save", async () => {
    vi.useFakeTimers()
    const local = stateWithFolder("laptop-folder")
    const cloud = stateWithFolder("mobile-folder")
    const merged = mergeWorkspaceStates(local, cloud)
    const { dependencies, save } = createDependencies({
      saveResult: {
        ok: true,
        version: 5,
        updatedAt: "now",
        state: merged,
      },
    })
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    engine.onStateChange(local)
    await vi.advanceTimersByTimeAsync(1500)

    expect(engine.getStatus()).toBe("saved")
    expect(engine.getConflict()).toBeUndefined()
    expect(engine.getLoadedState()?.folders.map((folder) => folder.id)).toEqual(
      ["mobile-folder", "laptop-folder"]
    )
    expect(save).toHaveBeenCalledTimes(1)
    engine.destroy()
  })

  it("keeps mid-save local edits when adopting server state", async () => {
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
    let authoritative: MarkxState | undefined
    engine.subscribe((_status, _conflict, state) => {
      if (state) authoritative = state
    })

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
      ["sent-folder", "during-folder"]
    )
    expect(authoritative?.folders.map((folder) => folder.id)).toEqual([
      "sent-folder",
      "during-folder",
    ])
    engine.destroy()
  })

  it("falls back to client merge when the server still returns conflict", async () => {
    vi.useFakeTimers()
    const local = stateWithFolder("laptop-folder")
    const cloud = stateWithFolder("mobile-folder")
    const { dependencies, save } = createDependencies({
      saveResult: {
        ok: false,
        reason: "conflict",
        cloudVersion: 4,
        cloudState: cloud,
        cloudUpdatedAt: "later",
      },
    })
    save
      .mockResolvedValueOnce({
        ok: false,
        reason: "conflict",
        cloudVersion: 4,
        cloudState: cloud,
        cloudUpdatedAt: "later",
      })
      .mockResolvedValueOnce({
        ok: true,
        version: 5,
        updatedAt: "now",
        state: mergeWorkspaceStates(local, cloud),
      })
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    engine.onStateChange(local)
    await vi.advanceTimersByTimeAsync(1500)

    expect(engine.getStatus()).toBe("saved")
    expect(engine.getConflict()).toBeUndefined()
    expect(engine.getLoadedState()?.folders.map((folder) => folder.id)).toEqual(
      ["mobile-folder", "laptop-folder"]
    )
    expect(save).toHaveBeenCalledTimes(2)
    engine.destroy()
  })

  it("surfaces and resolves an injected save conflict", async () => {
    vi.useFakeTimers()
    const cloud = stateWithFolder("cloud-conflict")
    const { dependencies } = createDependencies({
      saveResult: {
        ok: false,
        reason: "conflict",
        cloudVersion: 4,
        cloudState: cloud,
        cloudUpdatedAt: "later",
      },
    })
    const engine = await SyncEngine.createFromCache("user-1", dependencies)
    const statuses: string[] = []
    engine.subscribe((status) => statuses.push(status))

    engine.onStateChange(stateWithFolder("local"))
    await vi.advanceTimersByTimeAsync(1500)

    expect(engine.getStatus()).toBe("conflict")
    expect(engine.getConflict()?.cloudVersion).toBe(4)
    expect(statuses).toContain("conflict")

    await engine.resolveConflictUseCloud()
    expect(engine.getStatus()).toBe("saved")
    expect(engine.getLoadedState()).toBe(cloud)
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
