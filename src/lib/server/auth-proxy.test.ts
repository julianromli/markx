import { describe, expect, it } from "vitest"

import {
  buildAuthProxyHeaders,
  buildAuthTargetUrl,
  isAuthProxyPath,
  isEmailOtpSendPath,
  rewriteAuthCookie,
} from "./auth-proxy"

describe("auth proxy helpers", () => {
  it("recognizes only auth proxy subpaths", () => {
    expect(isAuthProxyPath("/api/auth/sign-in")).toBe(true)
    expect(isAuthProxyPath("/api/authentic")).toBe(false)
    expect(isAuthProxyPath("/api/auth")).toBe(false)
  })

  it("recognizes the email OTP send endpoint", () => {
    expect(
      isEmailOtpSendPath("/api/auth/email-otp/send-verification-otp")
    ).toBe(true)
    expect(isEmailOtpSendPath("/api/auth/sign-in/email-otp")).toBe(false)
    expect(isEmailOtpSendPath("/api/auth/email-otp/verify-email")).toBe(false)
  })

  it("resolves auth subpaths against the full managed-auth base path", () => {
    expect(
      buildAuthTargetUrl(
        "https://markx.app/api/auth/sign-in/email?next=%2F",
        "https://auth.example/neondb/auth"
      ).href
    ).toBe("https://auth.example/neondb/auth/sign-in/email?next=%2F")
  })

  it("forwards only the allowlisted request headers", () => {
    const headers = buildAuthProxyHeaders(
      new Headers({
        authorization: "Bearer token",
        cookie: "session=abc",
        host: "markx.app",
        referer: "https://markx.app/",
      })
    )

    expect(Object.fromEntries(headers)).toEqual({
      authorization: "Bearer token",
      cookie: "session=abc",
    })
  })

  it("removes Domain and normalizes an existing SameSite attribute", () => {
    expect(
      rewriteAuthCookie(
        "session=abc; Path=/; Domain=auth.example; SameSite=None; Secure"
      )
    ).toBe("session=abc; Path=/; SameSite=Lax; Secure")
  })

  it("keeps a persistent session cookie persistent", () => {
    expect(
      rewriteAuthCookie(
        "better-auth.session_token=abc; Max-Age=604800; Expires=Thu, 01 Jan 2026 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=None; Domain=ep-example.neon.tech"
      )
    ).toBe(
      "better-auth.session_token=abc; Max-Age=604800; Expires=Thu, 01 Jan 2026 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax"
    )
  })

  it("does not turn a browser-session cookie into a persistent one", () => {
    expect(
      rewriteAuthCookie(
        "better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax"
      )
    ).toBe(
      "better-auth.session_token=abc; Path=/; HttpOnly; Secure; SameSite=Lax"
    )
  })
})
