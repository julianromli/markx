// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { MarkxState } from "@/lib/markx/types"

const emptyState: MarkxState = {
  folders: [],
  bookmarks: [],
  notes: [],
  images: [],
  hasOnboarded: true,
  zCounter: 1,
}

const populatedState: MarkxState = {
  ...emptyState,
  folders: [{ id: "folder-1", name: "Saved", x: 0, y: 0, z: 1 }],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

type EngineStub = {
  getUserId: () => string
  getLoadedState: () => MarkxState
  hasCachedState: () => boolean
  refreshFromCloud: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
}

async function setupProvider(opts: {
  session: Promise<{
    user: { id: string; email: string } | null
    token: string | null
    isPending: boolean
    checkedAt: number
  }>
  lastUserId: Promise<string | null>
  cachedState?: MarkxState | null
  setLastUserId?: () => Promise<void>
  engine?: EngineStub
  guestImported?: boolean
  guestModified?: boolean
}) {
  vi.resetModules()

  const getAuthSession = vi.fn(() => opts.session)
  const getLastUserId = vi.fn(() => opts.lastUserId)
  const setLastUserId = vi.fn(opts.setLastUserId ?? (async () => {}))
  const isGuestImported = vi.fn(async () => opts.guestImported ?? true)
  const engine =
    opts.engine ??
    ({
      getUserId: () => "user-1",
      getLoadedState: () => opts.cachedState ?? emptyState,
      hasCachedState: () => Boolean(opts.cachedState),
      refreshFromCloud: vi.fn(async () => emptyState),
      destroy: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    } satisfies EngineStub)
  const createFromCache = vi.fn(async () => engine)
  const create = vi.fn(async () => engine)

  vi.doMock("@/lib/auth/session", () => ({ getAuthSession }))
  vi.doMock("@/lib/markx/storage", () => ({
    getLastUserId,
    setLastUserId,
    loadUserState: vi.fn(async () => opts.cachedState ?? null),
    loadState: vi.fn(async () => emptyState),
    isGuestImported,
    localMarkxStorage: {
      load: vi.fn(async () => emptyState),
      save: vi.fn(async () => {}),
    },
    nextZ: vi.fn(() => 2),
    sweepOrphanImageBlobs: vi.fn(async () => {}),
  }))
  vi.doMock("@/lib/markx/sync", () => ({
    isGuestModified: vi.fn(() => opts.guestModified ?? false),
    SyncEngine: {
      createFromCache,
      create,
    },
  }))
  vi.doMock("@/lib/markx/enrich", () => ({
    enrichLink: vi.fn(),
  }))

  const module = await import("@/lib/markx/store")
  const bootstrap = await import("@/lib/markx/store-bootstrap")
  return {
    ...module,
    getSessionUserWithTimeout: bootstrap.getSessionUserWithTimeout,
    getAuthSession,
    getLastUserId,
    setLastUserId,
    isGuestImported,
    createFromCache,
    create,
    engine,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("MarkxProvider authenticated bootstrap", () => {
  it("returns timeout without adopting a late session completion", async () => {
    vi.useFakeTimers()
    const session = deferred<{
      user: { id: string; email: string } | null
      token: string | null
      isPending: boolean
      checkedAt: number
    }>()
    const { getSessionUserWithTimeout } = await setupProvider({
      session: session.promise,
      lastUserId: Promise.resolve(null),
    })

    const result = getSessionUserWithTimeout()
    await vi.advanceTimersByTimeAsync(3000)
    await expect(result).resolves.toEqual({ status: "timeout" })

    session.resolve({
      user: { id: "late-user", email: "late@example.com" },
      token: "token",
      isPending: false,
      checkedAt: Date.now(),
    })
    await session.promise
    await expect(result).resolves.toEqual({ status: "timeout" })
  })

  it("starts session restore before the IndexedDB cache lookup settles", async () => {
    const session = deferred<never>()
    const lastUserId = deferred<string | null>()
    const { MarkxProvider, getAuthSession, getLastUserId } =
      await setupProvider({
        session: session.promise,
        lastUserId: lastUserId.promise,
      })

    const view = render(<MarkxProvider>workspace</MarkxProvider>)
    await act(async () => {})

    expect(getAuthSession).toHaveBeenCalledTimes(1)
    expect(getLastUserId).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it("persists lastUserId before exposing a cached workspace", async () => {
    const lastUserWrite = deferred<void>()
    const { MarkxProvider } = await setupProvider({
      session: Promise.resolve({
        user: { id: "user-1", email: "user@example.com" },
        token: "token",
        isPending: false,
        checkedAt: Date.now(),
      }),
      lastUserId: Promise.resolve("user-1"),
      cachedState: emptyState,
      setLastUserId: () => lastUserWrite.promise,
    })

    render(<MarkxProvider>workspace-ready</MarkxProvider>)
    await act(async () => {})
    expect(screen.queryByText("workspace-ready")).toBeNull()

    await act(async () => {
      lastUserWrite.resolve()
      await lastUserWrite.promise
    })
    expect(await screen.findByText("workspace-ready")).toBeTruthy()
  })

  it("renders the shell while an uncached cloud workspace loads", async () => {
    const cloudState = deferred<MarkxState | null>()
    const engine: EngineStub = {
      getUserId: () => "user-1",
      getLoadedState: () => emptyState,
      hasCachedState: () => false,
      refreshFromCloud: vi.fn(() => cloudState.promise),
      destroy: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    }
    const { MarkxProvider, useMarkxStore } = await setupProvider({
      session: Promise.resolve({
        user: { id: "user-1", email: "user@example.com" },
        token: "token",
        isPending: false,
        checkedAt: Date.now(),
      }),
      lastUserId: Promise.resolve(null),
      engine,
    })

    function Status() {
      return <span>{useMarkxStore().initialSyncStatus}</span>
    }

    render(
      <MarkxProvider>
        <Status />
      </MarkxProvider>
    )

    expect(await screen.findByText("loading")).toBeTruthy()
    expect(engine.refreshFromCloud).toHaveBeenCalledTimes(1)

    await act(async () => {
      cloudState.resolve(emptyState)
      await cloudState.promise
    })
    await waitFor(() => expect(screen.getByText("idle")).toBeTruthy())
  })

  it("retries guest import when a user cache exists but the marker is absent", async () => {
    const { MarkxProvider, create, createFromCache, isGuestImported, engine } =
      await setupProvider({
        session: Promise.resolve({
          user: { id: "user-1", email: "user@example.com" },
          token: "token",
          isPending: false,
          checkedAt: Date.now(),
        }),
        lastUserId: Promise.resolve(null),
        cachedState: populatedState,
        guestImported: false,
        guestModified: true,
      })

    render(<MarkxProvider>cached-workspace</MarkxProvider>)
    expect(await screen.findByText("cached-workspace")).toBeTruthy()

    expect(createFromCache).toHaveBeenCalled()
    expect(isGuestImported).toHaveBeenCalledWith("user-1")
    expect(create).toHaveBeenCalledWith("user-1")
    expect(engine.refreshFromCloud).not.toHaveBeenCalled()
  })

  it("imports modified guest data when the authenticated cache is empty", async () => {
    const { MarkxProvider, create, createFromCache, isGuestImported } =
      await setupProvider({
        session: Promise.resolve({
          user: { id: "user-1", email: "user@example.com" },
          token: "token",
          isPending: false,
          checkedAt: Date.now(),
        }),
        lastUserId: Promise.resolve("user-1"),
        cachedState: emptyState,
        guestImported: false,
        guestModified: true,
      })

    render(<MarkxProvider>imported-workspace</MarkxProvider>)
    expect(await screen.findByText("imported-workspace")).toBeTruthy()

    expect(createFromCache).toHaveBeenCalled()
    expect(isGuestImported).toHaveBeenCalledWith("user-1")
    expect(create).toHaveBeenCalledWith("user-1")
  })

  it("clears the initial-sync guard when auth switches engines", async () => {
    const cloudState = deferred<MarkxState | null>()
    const engine: EngineStub = {
      getUserId: () => "user-1",
      getLoadedState: () => emptyState,
      hasCachedState: () => false,
      refreshFromCloud: vi.fn(() => cloudState.promise),
      destroy: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    }
    const { MarkxProvider, useMarkxStore, store } = await setupProvider({
      session: Promise.resolve({
        user: { id: "user-1", email: "user@example.com" },
        token: "token",
        isPending: false,
        checkedAt: Date.now(),
      }),
      lastUserId: Promise.resolve(null),
      engine,
    })

    function Status() {
      return <span>{useMarkxStore().initialSyncStatus}</span>
    }

    render(
      <MarkxProvider>
        <Status />
      </MarkxProvider>
    )
    expect(await screen.findByText("loading")).toBeTruthy()

    await act(async () => {
      store.detachSync()
      store.replaceState(emptyState, { persist: false })
    })
    expect(await screen.findByText("idle")).toBeTruthy()

    cloudState.resolve(null)
  })
})

describe("MarkxProvider bootstrap failure", () => {
  it("offers a reload when local storage rejects instead of hanging", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const lastUserId = deferred<string | null>()
    const { MarkxProvider } = await setupProvider({
      session: Promise.resolve({
        user: null,
        token: null,
        isPending: false,
        checkedAt: Date.now(),
      }),
      lastUserId: lastUserId.promise,
    })

    render(<MarkxProvider>workspace</MarkxProvider>)
    await act(async () => {
      lastUserId.reject(new Error("IndexedDB is blocked"))
    })

    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(screen.queryByText("workspace")).toBeNull()
  })

  it("offers a reload when the bootstrap never settles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.useFakeTimers()
    const { MarkxProvider } = await setupProvider({
      session: deferred<never>().promise,
      lastUserId: deferred<string | null>().promise,
    })

    render(<MarkxProvider>workspace</MarkxProvider>)
    await act(async () => {})
    expect(screen.queryByRole("alert")).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })
    expect(screen.getByRole("alert")).toBeTruthy()
  })
})
