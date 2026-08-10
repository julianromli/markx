import { afterEach, describe, expect, it, vi } from "vitest"

import { openExternalUrl } from "./open-url"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("openExternalUrl", () => {
  it("opens a blank tab and clears opener when window.open succeeds", () => {
    const popup = { opener: window as unknown as null }
    const open = vi.fn(() => popup)
    vi.stubGlobal("open", open)

    openExternalUrl("https://example.com/path")

    expect(open).toHaveBeenCalledWith("https://example.com/path", "_blank")
    expect(popup.opener).toBeNull()
  })

  it("falls back to same-tab navigation when the popup is blocked", () => {
    const open = vi.fn(() => null)
    const assign = vi.fn()
    vi.stubGlobal("open", open)
    vi.stubGlobal("location", { assign })

    openExternalUrl("https://example.com/blocked")

    expect(open).toHaveBeenCalledWith("https://example.com/blocked", "_blank")
    expect(assign).toHaveBeenCalledWith("https://example.com/blocked")
  })

  it("ignores empty urls", () => {
    const open = vi.fn()
    vi.stubGlobal("open", open)

    openExternalUrl("")

    expect(open).not.toHaveBeenCalled()
  })
})
