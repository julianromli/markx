import { describe, expect, it } from "vitest"

import { installVisualViewportVars } from "./visual-viewport"

describe("visual viewport CSS variables", () => {
  it("MX-33 tracks the visible area when the keyboard shrinks it", () => {
    const listeners = new Map<string, () => void>()
    const vv = {
      offsetTop: 0,
      height: 800,
      addEventListener: (type: string, fn: () => void) =>
        listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
    }
    const win = { visualViewport: vv, document } as unknown as Window
    const uninstall = installVisualViewportVars(win)
    const style = document.documentElement.style
    expect(style.getPropertyValue("--vv-height")).toBe("800px")

    vv.height = 320
    vv.offsetTop = 40
    listeners.get("resize")?.()
    expect(style.getPropertyValue("--vv-height")).toBe("320px")
    expect(style.getPropertyValue("--vv-top")).toBe("40px")

    uninstall()
    expect(listeners.size).toBe(0)
  })
})
