import { describe, expect, it } from "vitest"

import { isApplePlatform, shortcutLabel } from "./platform"

describe("platform shortcut labels", () => {
  it("MX-35 uses Cmd on Apple platforms and Ctrl elsewhere", () => {
    expect(shortcutLabel("N", true)).toBe("⌘N")
    expect(shortcutLabel("V", false)).toBe("Ctrl+V")
    expect(isApplePlatform({ platform: "MacIntel", userAgent: "" })).toBe(true)
    expect(isApplePlatform({ platform: "Win32", userAgent: "" })).toBe(false)
    expect(isApplePlatform({ platform: "Linux x86_64", userAgent: "" })).toBe(
      false
    )
  })

  it("MX-35 shortcutLabel(key) reads the real navigator by default", () => {
    const original = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "platform"
    )
    try {
      Object.defineProperty(Navigator.prototype, "platform", {
        configurable: true,
        get: () => "MacIntel",
      })
      expect(shortcutLabel("N")).toBe("⌘N")
      Object.defineProperty(Navigator.prototype, "platform", {
        configurable: true,
        get: () => "Win32",
      })
      expect(shortcutLabel("N")).toBe("Ctrl+N")
    } finally {
      if (original)
        Object.defineProperty(Navigator.prototype, "platform", original)
    }
  })
})
