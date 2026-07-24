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

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

type EngineStub = {
  getUserId: () => string
  getLoadedState: () => MarkxState
  hasCachedState: () => boolean
  refreshFromCloud: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
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
}) {
  vi.resetModules()

  const getAuthSession = vi.fn(() => opts.session)
  const getLastUserId = vi.fn(() => opts.lastUserId)
  const setLastUserId = vi.fn(opts.setLastUserId ?? (async () => {}))
  const engine =
    opts.engine ??
    ({
      getUserId: () => "user-1",
      getLoadedState: () => emptyState,
      hasCachedState: () => Boolean(opts.cachedState),
      refreshFromCloud: vi.fn(async () => emptyState),
      destroy: vi.fn(),
    } satisfies EngineStub)

  vi.doMock("@/lib/auth/session", () => ({ getAuthSession }))
  vi.doMock("@/lib/markx/storage", () => ({
    getLastUserId,
    setLastUserId,
    loadUserState: vi.fn(async () => opts.cachedState ?? null),
    loadState: vi.fn(async () => emptyState),
    isGuestImported: vi.fn(async () => true),
    localMarkxStorage: {
      load: vi.fn(async () => emptyState),
      save: vi.fn(async () => {}),
    },
    nextZ: vi.fn(() => 2),
    sweepOrphanImageBlobs: vi.fn(async () => {}),
  }))
  vi.doMock("@/lib/markx/sync", () => ({
    isGuestModified: vi.fn(() => false),
    SyncEngine: {
      createFromCache: vi.fn(async () => engine),
      create: vi.fn(async () => engine),
    },
  }))
  vi.doMock("@/lib/markx/enrich", () => ({
    enrichLink: vi.fn(),
  }))

  const module = await import("@/lib/markx/store")
  return { ...module, getAuthSession, getLastUserId, setLastUserId, engine }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("MarkxProvider authenticated bootstrap", () => {
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

  it("persists lastUserId before exposing an optimistic cached workspace", async () => {
    const session = deferred<never>()
    const lastUserWrite = deferred<void>()
    const { MarkxProvider } = await setupProvider({
      session: session.promise,
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

  it("clears the initial-sync guard when auth switches engines", async () => {
    const cloudState = deferred<MarkxState | null>()
    const engine: EngineStub = {
      getUserId: () => "user-1",
      getLoadedState: () => emptyState,
      hasCachedState: () => false,
      refreshFromCloud: vi.fn(() => cloudState.promise),
      destroy: vi.fn(),
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
