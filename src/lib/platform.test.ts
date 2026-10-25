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
})
