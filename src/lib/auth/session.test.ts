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

afterEach(() => {
  vi.useRealTimers()
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
    expect(authMocks.getSession).toHaveBeenCalledTimes(1)

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

  it("uses one initial lookup and polling loop for multiple subscribers", async () => {
    vi.useFakeTimers()
    authMocks.getSession.mockResolvedValue({ data: null })
    const { subscribeAuthSession } = await import("@/lib/auth/session")

    const unsubscribeFirst = subscribeAuthSession(vi.fn())
    const unsubscribeSecond = subscribeAuthSession(vi.fn())
    await vi.waitFor(() =>
      expect(authMocks.getSession).toHaveBeenCalledTimes(1),
    )

    await vi.advanceTimersByTimeAsync(10000)
    expect(authMocks.getSession).toHaveBeenCalledTimes(2)

    unsubscribeFirst()
    unsubscribeSecond()
    await vi.advanceTimersByTimeAsync(10000)
    expect(authMocks.getSession).toHaveBeenCalledTimes(2)
  })

  it("does not republish an old in-flight user after sign-out", async () => {
    const response = deferred<{
      data: {
        user: { id: string; email: string }
        session: { token: string }
      }
    }>()
    authMocks.getSession.mockReturnValue(response.promise)
    const {
      getAuthSession,
      getAuthSessionSnapshot,
      setAuthSessionGuest,
    } = await import("@/lib/auth/session")

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
})
