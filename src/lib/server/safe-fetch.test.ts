import { afterEach, describe, expect, it, vi } from "vitest"

import { fetchPublicHttp, withTimeout } from "./safe-fetch"

describe("fetchPublicHttp", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the response when there is no redirect", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => new Response("ok", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { response, finalUrl } = await fetchPublicHttp(
      "https://example.com/page"
    )
    expect(await response.text()).toBe("ok")
    expect(finalUrl).toBe("https://example.com/page")
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" })
  })

  it("follows a safe redirect chain and re-validates each hop", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/final" },
        })
      )
      .mockResolvedValueOnce(new Response("final", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { response, finalUrl } = await fetchPublicHttp(
      "https://example.com/start"
    )
    expect(await response.text()).toBe("final")
    expect(finalUrl).toBe("https://cdn.example.com/final")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://cdn.example.com/final")
  })

  it("resolves relative Location headers against the previous URL", async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "/next" },
        })
      )
      .mockResolvedValueOnce(new Response("next", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)

    const { finalUrl } = await fetchPublicHttp("https://example.com/start")
    expect(finalUrl).toBe("https://example.com/next")
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://example.com/next")
  })

  it("refuses redirects into private / local targets", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >(async () => Response.redirect("http://127.0.0.1/secret", 302))
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchPublicHttp("https://example.com/open")).rejects.toThrow(
      /unsafe URL/
    )
  })

  it("rejects an initially unsafe URL without calling fetch", async () => {
    const fetchMock = vi.fn<
      (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    >()
    vi.stubGlobal("fetch", fetchMock)

    await expect(fetchPublicHttp("http://192.168.0.1/x")).rejects.toThrow(
      /unsafe URL/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("withTimeout", () => {
  it("returns null when the promise exceeds the budget", async () => {
    const result = await withTimeout(
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("late"), 50)
      }),
      5
    )
    expect(result).toBeNull()
  })

  it("returns the value when it settles in time", async () => {
    const result = await withTimeout(Promise.resolve("ok"), 50)
    expect(result).toBe("ok")
  })
})
