import { describe, expect, it, vi, afterEach } from "vitest"

import {
  deleteDockLabel,
  pointInElement,
  vibrateDeleteFeedback,
} from "@/lib/markx/delete-dock"

describe("deleteDockLabel", () => {
  it("labels a single item as Delete", () => {
    expect(deleteDockLabel(1)).toBe("Delete")
    expect(deleteDockLabel(0)).toBe("Delete")
  })

  it("includes the count for multi-select", () => {
    expect(deleteDockLabel(3)).toBe("Delete 3")
  })
})

describe("pointInElement", () => {
  it("returns false for a missing element", () => {
    expect(pointInElement(10, 10, null)).toBe(false)
  })

  it("detects points inside the element bounds", () => {
    const el = {
      getBoundingClientRect: () => ({
        left: 0,
        right: 100,
        top: 0,
        bottom: 50,
        width: 100,
        height: 50,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as HTMLElement

    expect(pointInElement(50, 25, el)).toBe(true)
    expect(pointInElement(150, 25, el)).toBe(false)
  })
})

describe("vibrateDeleteFeedback", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("no-ops when vibrate is unavailable", () => {
    vi.stubGlobal("navigator", {})
    expect(() => vibrateDeleteFeedback("armed")).not.toThrow()
  })

  it("calls vibrate for armed and commit patterns", () => {
    const vibrate = vi.fn()
    vi.stubGlobal("navigator", { vibrate })
    vibrateDeleteFeedback("armed")
    vibrateDeleteFeedback("commit")
    expect(vibrate).toHaveBeenNthCalledWith(1, 10)
    expect(vibrate).toHaveBeenNthCalledWith(2, [12, 24, 12])
  })
})
