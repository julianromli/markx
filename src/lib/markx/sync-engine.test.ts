import { afterEach, describe, expect, it, vi } from "vitest"

import { createEmptyState } from "@/lib/markx/state"
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
  saveResult?: Awaited<ReturnType<SyncEngineDependencies["workspace"]["save"]>>
}) {
  let pending = opts?.pending ?? null
  const cache = opts?.cached ?? createEmptyState()
  const cloud = opts?.cloud ?? stateWithFolder("cloud")
  const save = vi.fn(async () =>
    opts?.saveResult
      ? opts.saveResult
      : { ok: true as const, version: 2, updatedAt: "now" }
  )
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
      importGuest: vi.fn(async () => ({
        ok: true as const,
        version: 2,
        updatedAt: "now",
      })),
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
      loadGuestState: vi.fn(async () => createEmptyState()),
      loadUserState: vi.fn(async () => cache),
      saveUserState: vi.fn(async () => {}),
      clearUserCache: vi.fn(async () => {}),
      getCloudVersion: vi.fn(async () => 1),
      setCloudVersion: vi.fn(async () => {}),
      isGuestImported: vi.fn(async () => true),
      markGuestImported: vi.fn(async () => {}),
      getPendingSnapshot: vi.fn(async () => pending),
      setPendingSnapshot: vi.fn(async (_userId, state) => {
        pending = state
      }),
      addDeletedImageIds: vi.fn(async () => []),
      getDeletedImageIds: vi.fn(async () => []),
      clearDeletedImageIds: vi.fn(async () => {}),
      getAssetQueue: vi.fn(async () => []),
      enqueueAsset: vi.fn(async () => {}),
      removeAssetsFromQueue: vi.fn(async () => {}),
      saveImageBlob: vi.fn(async () => {}),
      getImageBlob: vi.fn(async () => undefined),
    },
  }
  return { dependencies, save }
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
})
