import { describe, expect, it } from "vitest"

import {
  extensionCorsHeaders,
  isAllowedExtensionOrigin,
  isExtensionApiPath,
} from "@/lib/server/extension-api"

describe("isExtensionApiPath", () => {
  it("matches the three extension routes only", () => {
    expect(isExtensionApiPath("/api/extension/session")).toBe(true)
    expect(isExtensionApiPath("/api/extension/folders")).toBe(true)
    expect(isExtensionApiPath("/api/extension/bookmarks")).toBe(true)
    expect(isExtensionApiPath("/api/extension/folders/")).toBe(false)
    expect(isExtensionApiPath("/api/auth/get-session")).toBe(false)
  })
})

describe("extension CORS", () => {
  it("allows chrome-extension origins and echoes them", () => {
    const origin = "chrome-extension://abcdefghijklmnopqrstuvwxyz"
    expect(isAllowedExtensionOrigin(origin)).toBe(true)
    const headers = extensionCorsHeaders(origin)
    expect(headers.get("Access-Control-Allow-Origin")).toBe(origin)
    expect(headers.get("Access-Control-Allow-Headers")).toMatch(/Authorization/)
    expect(headers.get("Access-Control-Allow-Credentials")).toBeNull()
  })

  it("does not reflect arbitrary web origins", () => {
    expect(isAllowedExtensionOrigin("https://evil.example")).toBe(false)
    const headers = extensionCorsHeaders("https://evil.example")
    expect(headers.get("Access-Control-Allow-Origin")).toBeNull()
  })
})
