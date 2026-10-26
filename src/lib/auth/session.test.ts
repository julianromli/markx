// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}))

vi.mock("@/lib/auth/client", () => ({
  getAuthClient: vi.fn(async () => ({
    getSession: authMocks.getSession,
  })),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.resetModules()
  authMocks.getSession.mockReset()
})

const visibilityDescriptor =
  Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState") ??
  Object.getOwnPropertyDescriptor(document, "visibilityState")

afterEach(() => {
  vi.useRealTimers()
  if (visibilityDescriptor) {
    Object.defineProperty(document, "visibilityState", visibilityDescriptor)
  }
})

describe("shared auth session", () => {
  it("shares one in-flight lookup between concurrent callers", async () => {
    const response = deferred<{
      data: {
        user: { id: string; email: string }
        session: { token: string }
      }
    }>()
    authMocks.getSession.mockReturnValue(response.promise)
    const { getAuthSession } = await import("@/lib/auth/session")

    const first = getAuthSession()
    const second = getAuthSession()
    await vi.waitFor(() =>
      expect(authMocks.getSession).toHaveBeenCalledTimes(1)
    )

    response.resolve({
      data: {
        user: { id: "user-1", email: "user@example.com" },
        session: { token: "token" },
      },
    })

    await expect(first).resolves.toMatchObject({
      user: { id: "user-1" },
      token: "token",
    })
    await expect(second).resolves.toMatchObject({
      user: { id: "user-1" },
      token: "token",
    })
  })

  it("uses one initial lookup and a long idle poll for multiple subscribers", async () => {
    vi.useFakeTimers()
    authMocks.getSession.mockResolvedValue({ data: null })
    const { SESSION_POLL_MS, subscribeAuthSession } =
      await import("@/lib/auth/session")

    const unsubscribeFirst = subscribeAuthSession(vi.fn())
    const unsubscribeSecond = subscribeAuthSession(vi.fn())
    await vi.waitFor(() =>
      expect(authMocks.getSession).toHaveBeenCalledTimes(1)
    )

    await vi.advanceTimersByTimeAsync(10_000)
    expect(authMocks.getSession).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS)
    expect(authMocks.getSession).toHaveBeenCalledTimes(2)

    unsubscribeFirst()
    unsubscribeSecond()
    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS)
    expect(authMocks.getSession).toHaveBeenCalledTimes(2)
  })

  it("skips the idle session poll while the tab is hidden", async () => {
    vi.useFakeTimers()
    authMocks.getSession.mockResolvedValue({ data: null })
    const { SESSION_POLL_MS, subscribeAuthSession } =
      await import("@/lib/auth/session")

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })

    const unsubscribe = subscribeAuthSession(vi.fn())
    await vi.waitFor(() =>
      expect(authMocks.getSession).toHaveBeenCalledTimes(1)
    )

    await vi.advanceTimersByTimeAsync(SESSION_POLL_MS)
    expect(authMocks.getSession).toHaveBeenCalledTimes(1)

    unsubscribe()
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    })
  })

  it("rechecks the session when the tab becomes visible", async () => {
    vi.useFakeTimers()
    authMocks.getSession.mockResolvedValue({ data: null })
    const { subscribeAuthSession } = await import("@/lib/auth/session")

    let visibility: DocumentVisibilityState = "hidden"
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    })

    const unsubscribe = subscribeAuthSession(vi.fn())
    await vi.waitFor(() =>
      expect(authMocks.getSession).toHaveBeenCalledTimes(1)
    )

    // Freshness window is 5s; expire it so visibility can refetch.
    await vi.advanceTimersByTimeAsync(6_000)
    visibility = "visible"
    document.dispatchEvent(new Event("visibilitychange"))
    await vi.waitFor(() =>
      expect(authMocks.getSession).toHaveBeenCalledTimes(2)
    )

    unsubscribe()
  })

  it("does not republish an old in-flight user after sign-out", async () => {
    const response = deferred<{
      data: {
        user: { id: string; email: string }
        session: { token: string }
      }
    }>()
    authMocks.getSession.mockReturnValue(response.promise)
    const { getAuthSession, getAuthSessionSnapshot, setAuthSessionGuest } =
      await import("@/lib/auth/session")

    const pending = getAuthSession()
    setAuthSessionGuest()
    response.resolve({
      data: {
        user: { id: "old-user", email: "old@example.com" },
        session: { token: "old-token" },
      },
    })
    await pending

    expect(getAuthSessionSnapshot()).toMatchObject({
      user: null,
      token: null,
      isPending: false,
    })
  })

  it("does not publish a guest when the first check throws", async () => {
    authMocks.getSession.mockRejectedValue(new Error("network down"))
    const { getAuthSession, getAuthSessionSnapshot } =
      await import("@/lib/auth/session")

    await expect(getAuthSession()).resolves.toMatchObject({
      user: null,
      outcome: "unavailable",
    })
    expect(getAuthSessionSnapshot()).toMatchObject({
      user: null,
      isPending: true,
      outcome: "pending",
    })
  })

  it("does not treat a server error payload as signed out", async () => {
    authMocks.getSession.mockResolvedValue({
      data: null,
      error: { status: 500, message: "unavailable" },
    })
    const { getAuthSession, getAuthSessionSnapshot } =
      await import("@/lib/auth/session")

    await expect(getAuthSession()).resolves.toMatchObject({
      outcome: "unavailable",
    })
    expect(getAuthSessionSnapshot().outcome).toBe("pending")
  })

  it("treats HTTP 401 as a signed-out session", async () => {
    authMocks.getSession.mockRejectedValue(
      Object.assign(new Error("unauthorized"), { status: 401 })
    )
    const { getAuthSession } = await import("@/lib/auth/session")

    await expect(getAuthSession()).resolves.toMatchObject({
      user: null,
      isPending: false,
      outcome: "guest",
    })
  })

  it("treats an empty session payload as signed out", async () => {
    authMocks.getSession.mockResolvedValue({ data: null, error: null })
    const { getAuthSession } = await import("@/lib/auth/session")

    await expect(getAuthSession()).resolves.toMatchObject({
      user: null,
      isPending: false,
      outcome: "guest",
    })
  })

  it("keeps a confirmed user when a later check throws", async () => {
    authMocks.getSession
      .mockResolvedValueOnce({
        data: {
          user: { id: "user-1", email: "user@example.com" },
          session: { token: "token" },
        },
        error: null,
      })
      .mockRejectedValueOnce(new Error("network down"))
    const { getAuthSession, getAuthSessionSnapshot, refreshAuthSession } =
      await import("@/lib/auth/session")

    await getAuthSession()
    await expect(refreshAuthSession()).resolves.toMatchObject({
      user: { id: "user-1" },
      outcome: "authenticated",
    })
    expect(getAuthSessionSnapshot().outcome).toBe("authenticated")
  })

  it("asks the auth server directly on focus after the jwt cache window", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    authMocks.getSession.mockResolvedValue({
      data: {
        user: { id: "user-1", email: "user@example.com" },
        session: { token: "token" },
      },
      error: null,
    })
    const { SESSION_NETWORK_REFRESH_MS, subscribeAuthSession } =
      await import("@/lib/auth/session")

    const unsubscribe = subscribeAuthSession(vi.fn())
    await vi.waitFor(() =>
      expect(authMocks.getSession).toHaveBeenCalledTimes(1)
    )

    // The idle poll does not run while hidden, so the last server check
    // stays old enough that focus must bypass the session caches.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    await vi.advanceTimersByTimeAsync(SESSION_NETWORK_REFRESH_MS)
    window.dispatchEvent(new Event("focus"))
    await vi.waitFor(() =>
      expect(authMocks.getSession.mock.calls.length).toBeGreaterThan(1)
    )

    expect(authMocks.getSession.mock.calls.at(-1)?.[0]).toEqual({
      query: { disableCookieCache: true },
      fetchOptions: { headers: { "X-Force-Fetch": "1" } },
    })
    unsubscribe()
  })
})
