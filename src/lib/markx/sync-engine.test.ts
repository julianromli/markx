import { afterEach, describe, expect, it, vi } from "vitest"

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
      : { ok: true as const, version: 2, updatedAt: "now" }
  )
  const importGuest =
    opts?.importGuestImpl ??
    vi.fn(async () =>
      opts?.importGuestResult
        ? opts.importGuestResult
        : { ok: true as const, version: 2, updatedAt: "now" }
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
      overwrite: vi.fn(async () => ({
        ok: true as const,
        version: 3,
        updatedAt: "now",
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

  it("keeps local edits when a cloud refresh completes later", async () => {
    const local = stateWithFolder("local")
    const { dependencies } = createDependencies()
    const engine = await SyncEngine.createFromCache("user-1", dependencies)

    engine.onStateChange(local)
    const refreshed = await engine.refreshFromCloud()

    expect(refreshed).toBeNull()
    expect(engine.getLoadedState()).toBe(local)
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
    await vi.advanceTimersByTimeAsync(2000)

    expect(engine.getLoadedState()).toBe(remote)
    expect(engine.getStatus()).toBe("saved")
    expect(dependencies.workspace.load).toHaveBeenCalledTimes(1)
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
  it("imports modified guest data when the cloud is empty", async () => {
    const guest = stateWithFolder("guest-folder")
    const { dependencies, importGuest, markGuestImported, resetGuestState } =
      createDependencies({
        guestImported: false,
        guestState: guest,
        cached: null,
        importGuestResult: {
          ok: true,
          version: 1,
          updatedAt: "now",
        },
      })

    const engine = await SyncEngine.create("user-1", dependencies)

    expect(importGuest).toHaveBeenCalledWith(guest)
    expect(engine.getLoadedState()?.folders[0]?.id).toBe("guest-folder")
    expect(markGuestImported).toHaveBeenCalledWith("user-1")
    expect(resetGuestState).toHaveBeenCalled()
    expect(engine.getStatus()).toBe("saved")
    expect(engine.getConflict()).toBeUndefined()
    engine.destroy()
  })

  it("silently adopts cloud when guest import conflicts", async () => {
    const guest = stateWithFolder("guest-folder")
    const cloud = stateWithFolder("cloud-folder")
    const { dependencies, markGuestImported, resetGuestState } =
      createDependencies({
        guestImported: false,
        guestState: guest,
        cached: null,
        importGuestResult: {
          ok: false,
          reason: "conflict",
          cloudVersion: 5,
          cloudState: cloud,
          cloudUpdatedAt: "now",
        },
      })

    const engine = await SyncEngine.create("user-1", dependencies)

    expect(engine.getLoadedState()?.folders[0]?.id).toBe("cloud-folder")
    expect(engine.getStatus()).toBe("saved")
    expect(engine.getConflict()).toBeUndefined()
    expect(markGuestImported).toHaveBeenCalledWith("user-1")
    expect(resetGuestState).toHaveBeenCalled()
    engine.destroy()
  })

  it("keeps guest locally without setting the flag when import is offline", async () => {
    const guest = stateWithFolder("guest-offline")
    const { dependencies, markGuestImported, resetGuestState } =
      createDependencies({
        guestImported: false,
        guestState: guest,
        cached: null,
        importGuestImpl: vi.fn(async () => {
          throw new Error("network down")
        }),
      })

    vi.stubGlobal("navigator", { onLine: false })
    const engine = await SyncEngine.create("user-1", dependencies)

    expect(engine.getLoadedState()?.folders[0]?.id).toBe("guest-offline")
    expect(engine.getStatus()).toBe("offline")
    expect(markGuestImported).not.toHaveBeenCalled()
    expect(resetGuestState).not.toHaveBeenCalled()
    engine.destroy()
    vi.unstubAllGlobals()
  })

  it("skips guest import for unmodified demo and finalizes from cloud", async () => {
    const { dependencies, importGuest, markGuestImported, resetGuestState } =
      createDependencies({
        guestImported: false,
        guestState: createDemoState(),
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

  it("enqueues guest image blobs on successful import", async () => {
    const guest: MarkxState = {
      ...stateWithFolder("guest-folder"),
      images: [
        {
          id: "board-img-1",
          folderId: null,
          imageId: "blob-1",
          mime: "image/png",
          naturalWidth: 1,
          naturalHeight: 1,
          x: 0,
          y: 0,
          z: 1,
        },
      ],
    }
    const png = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" })
    const { dependencies, enqueueAsset, getImageBlob } = createDependencies({
      guestImported: false,
      guestState: guest,
      cached: null,
      importGuestResult: { ok: true, version: 1, updatedAt: "now" },
    })
    getImageBlob.mockResolvedValue(png)

    const engine = await SyncEngine.create("user-1", dependencies)

    expect(enqueueAsset).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({
        imageId: "blob-1",
        mime: "image/png",
      })
    )
    engine.destroy()
  })
})
