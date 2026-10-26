import { describe, expect, it, vi } from "vitest"

import type { AuthUser } from "@/lib/auth/types"
import { createEmptyState } from "@/lib/markx/state"
import { createMarkxStore } from "@/lib/markx/store"
import {
  runMarkxBootstrap,
  SESSION_RETRY_DELAYS_MS,
} from "@/lib/markx/store-bootstrap"
import type { SessionCheckResult } from "@/lib/markx/store-bootstrap"
import type { MarkxState } from "@/lib/markx/types"

const user: AuthUser = { id: "user-1", email: "user@example.com" }
const other: AuthUser = { id: "user-2", email: "other@example.com" }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

function workspace(name: string): MarkxState {
  return {
    ...createEmptyState(),
    folders: [{ id: name, name, x: 0, y: 0, z: 1 }],
  }
}

function fakeEngine(
  userId: string,
  cached: boolean,
  state = workspace(userId)
) {
  return {
    userId,
    cached,
    state,
    clearCache: vi.fn(async () => {}),
    flushAndDestroy: vi.fn(async () => false),
    destroy: vi.fn(),
    refreshFromCloud: vi.fn(async () => state),
    getUserId: () => userId,
    hasCachedState: () => cached,
    getLoadedState: () => state,
    subscribe: () => () => {},
  }
}

function createTestStore(guest = workspace("guest")) {
  const load = vi.fn(async () => guest)
  const save = vi.fn(async (_state: MarkxState) => {})
  const store = createMarkxStore({
    storage: {
      load,
      save,
    },
    enrich: vi.fn(async () => ({
      title: "",
      description: undefined,
      imageUrl: undefined,
      faviconUrl: "",
    })),
    sweepOrphanImages: vi.fn(async () => {}),
  })
  return { store, load, save }
}

describe("runMarkxBootstrap", () => {
  it("paints the cached user before the session probe resolves", async () => {
    const probe = deferred<SessionCheckResult>()
    const engine = fakeEngine(user.id, true)
    const { store } = createTestStore()
    const ready: string[] = []
    const confirmed = vi.fn()

    const done = runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: () => probe.promise,
      getLastUserId: async () => user.id,
      createEngineFromCache: async () => engine,
      sleep: async () => {},
      clearLastUserId: vi.fn(async () => {}),
      resetGuestState: vi.fn(async () => workspace("demo")),
      onShellReady: (branch) => ready.push(branch),
      onCachedUserConfirmed: confirmed,
      onCloudLoad: vi.fn(),
    })

    await vi.waitFor(() => expect(ready).toEqual(["optimistic-cache"]))
    expect(store.getSyncEngine()).toBe(engine)
    expect(store.getState().folders[0]?.id).toBe(user.id)
    expect(confirmed).not.toHaveBeenCalled()

    probe.resolve({ status: "user", user })
    await done
    expect(confirmed).toHaveBeenCalledWith(engine)
    expect(engine.clearCache).not.toHaveBeenCalled()
  })

  it("retries an unavailable probe and does not drop the cached user", async () => {
    const engine = fakeEngine(user.id, true)
    const { store, load } = createTestStore()
    const sleeps: number[] = []
    let calls = 0
    const resetGuestState = vi.fn(async () => workspace("demo"))

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => {
        calls += 1
        if (calls < 3) return { status: "unavailable" }
        return { status: "user", user }
      },
      getLastUserId: async () => user.id,
      createEngineFromCache: async () => engine,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      clearLastUserId: vi.fn(async () => {}),
      resetGuestState,
      onShellReady: () => {},
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: vi.fn(),
    })

    expect(calls).toBe(3)
    expect(sleeps).toEqual(SESSION_RETRY_DELAYS_MS.slice(0, 2))
    expect(store.getSyncEngine()).toBe(engine)
    expect(load).not.toHaveBeenCalled()
    expect(resetGuestState).not.toHaveBeenCalled()
    expect(engine.clearCache).not.toHaveBeenCalled()
    expect(engine.flushAndDestroy).not.toHaveBeenCalled()
  })

  it("keeps unsynced local edits when the server says there is no session", async () => {
    const engine = fakeEngine(user.id, true)
    const demo = workspace("demo")
    const { store } = createTestStore()
    const clearLastUserId = vi.fn(async () => {})
    const resetGuestState = vi.fn(async () => demo)

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => ({ status: "guest" }),
      getLastUserId: async () => user.id,
      createEngineFromCache: async () => engine,
      sleep: async () => {},
      clearLastUserId,
      resetGuestState,
      onShellReady: () => {},
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: vi.fn(),
    })

    expect(engine.flushAndDestroy).toHaveBeenCalledOnce()
    expect(engine.clearCache).not.toHaveBeenCalled()
    expect(clearLastUserId).toHaveBeenCalledOnce()
    expect(resetGuestState).toHaveBeenCalledOnce()
    expect(store.getSyncEngine()).toBeNull()
    expect(store.getState().folders[0]?.id).toBe("demo")
  })

  it("clears the user cache when the rejected session has nothing unsynced", async () => {
    const engine = fakeEngine(user.id, true)
    engine.flushAndDestroy.mockResolvedValue(true)
    const { store } = createTestStore()

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => ({ status: "guest" }),
      getLastUserId: async () => user.id,
      createEngineFromCache: async () => engine,
      sleep: async () => {},
      clearLastUserId: vi.fn(async () => {}),
      resetGuestState: vi.fn(async () => workspace("demo")),
      onShellReady: () => {},
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: vi.fn(),
    })

    expect(engine.clearCache).toHaveBeenCalledOnce()
  })

  it("attaches a late user instead of staying a guest", async () => {
    const engine = fakeEngine(user.id, false)
    const { store, load } = createTestStore()
    const branches: string[] = []
    const cloudLoad = vi.fn()
    let calls = 0

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => {
        calls += 1
        if (calls === 1) return { status: "unavailable" }
        return { status: "user", user }
      },
      getLastUserId: async () => null,
      createEngineFromCache: async () => engine,
      sleep: async () => {},
      clearLastUserId: vi.fn(async () => {}),
      resetGuestState: vi.fn(async () => workspace("demo")),
      onShellReady: (branch) => branches.push(branch),
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: cloudLoad,
    })

    expect(branches).toEqual(["guest-pending", "cloud-loading"])
    expect(load).toHaveBeenCalled()
    expect(cloudLoad).toHaveBeenCalledWith(engine)
    expect(store.getSyncEngine()).toBe(engine)
    expect(engine.destroy).not.toHaveBeenCalled()
  })

  it("does not flush one user into another account", async () => {
    const first = fakeEngine(user.id, true)
    const second = fakeEngine(other.id, true)
    const { store } = createTestStore()

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => ({ status: "user", user: other }),
      getLastUserId: async () => user.id,
      createEngineFromCache: async (userId) =>
        userId === user.id ? first : second,
      sleep: async () => {},
      clearLastUserId: vi.fn(async () => {}),
      resetGuestState: vi.fn(async () => workspace("demo")),
      onShellReady: () => {},
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: vi.fn(),
    })

    expect(first.flushAndDestroy).not.toHaveBeenCalled()
    expect(first.clearCache).not.toHaveBeenCalled()
    expect(first.destroy).toHaveBeenCalled()
    expect(store.getSyncEngine()).toBe(second)
    expect(store.getState().folders[0]?.id).toBe(other.id)
  })

  it("does not keep or save the previous user's board when the new cache read fails", async () => {
    const first = fakeEngine(user.id, true)
    const demo = workspace("demo")
    const { store, save } = createTestStore()

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => ({ status: "user", user: other }),
      getLastUserId: async () => user.id,
      createEngineFromCache: async (userId) => {
        if (userId === user.id) return first
        throw new Error("cache read failed")
      },
      sleep: async () => {},
      clearLastUserId: vi.fn(async () => {}),
      resetGuestState: vi.fn(async () => demo),
      onShellReady: () => {},
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: vi.fn(),
    })

    expect(store.getSyncEngine()).toBeNull()
    expect(
      store.getState().folders.some((folder) => folder.id === user.id)
    ).toBe(false)
    expect(store.getState().folders[0]?.id).toBe("demo")

    store.actions.createFolder(0, 0, "Later")
    store.flush()

    expect(save).toHaveBeenCalled()
    for (const [saved] of save.mock.calls) {
      expect(saved.folders.some((folder) => folder.id === user.id)).toBe(false)
    }
  })

  it("does not leave the cached user on screen when cleanup fails after a rejected session", async () => {
    const first = fakeEngine(user.id, true)
    const demo = workspace("demo")
    const { store, save } = createTestStore()
    const resetGuestState = vi.fn(async () => demo)

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => ({ status: "guest" }),
      getLastUserId: async () => user.id,
      createEngineFromCache: async () => first,
      sleep: async () => {},
      clearLastUserId: vi.fn(async () => {
        throw new Error("could not clear last user")
      }),
      resetGuestState,
      onShellReady: () => {},
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: vi.fn(),
    })

    expect(store.getSyncEngine()).toBeNull()
    expect(
      store.getState().folders.some((folder) => folder.id === user.id)
    ).toBe(false)

    store.actions.createFolder(0, 0, "Later")
    store.flush()
    for (const [saved] of save.mock.calls) {
      expect(saved.folders.some((folder) => folder.id === user.id)).toBe(false)
    }
  })

  it("detaches an engine when attach fails before the shell is ready", async () => {
    const engine = fakeEngine(user.id, true)
    engine.subscribe = () => {
      throw new Error("attach failed")
    }
    const guest = workspace("guest-board")
    const { store, save } = createTestStore(guest)

    await runMarkxBootstrap({
      store,
      isCancelled: () => false,
      probeSession: async () => ({ status: "user", user }),
      getLastUserId: async () => user.id,
      createEngineFromCache: async () => engine,
      sleep: async () => {},
      clearLastUserId: vi.fn(async () => {}),
      resetGuestState: vi.fn(async () => workspace("demo")),
      onShellReady: () => {},
      onCachedUserConfirmed: vi.fn(),
      onCloudLoad: vi.fn(),
    })

    expect(store.getSyncEngine()).toBeNull()
    expect(store.getState().folders[0]?.id).toBe("guest-board")
    store.actions.createFolder(0, 0, "Later")
    store.flush()
    expect(save).toHaveBeenCalled()
    expect(engine.destroy).toHaveBeenCalled()
  })
})
