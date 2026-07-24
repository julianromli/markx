import { describe, it, expect } from "vitest"

import { resolveAuthBaseURL } from "@/lib/auth/client"

/**
 * Regression tests for the "Invalid base URL: /api/auth" sign-in failure.
 *
 * Better Auth's client runs `new URL(baseURL)` and rejects relative URLs.
 * `resolveAuthBaseURL` must therefore ALWAYS return an absolute URL
 * (http/https) so the client can be constructed in production, where
 * `VITE_NEON_AUTH_URL` is typically unset and the code previously fell
 * back to the bare relative path `/api/auth`.
 */

describe("resolveAuthBaseURL", () => {
  it("uses an absolute VITE_NEON_AUTH_URL as-is (local dev case)", () => {
    expect(
      resolveAuthBaseURL({
        envUrl: "http://localhost:3000/api/auth",
        origin: "https://markx.app",
      }),
    ).toBe("http://localhost:3000/api/auth")
  })

  it("resolves a relative env URL against the current origin", () => {
    expect(
      resolveAuthBaseURL({
        envUrl: "/api/auth",
        origin: "https://markx.app",
      }),
    ).toBe("https://markx.app/api/auth")
  })

  it("defaults to the same-origin /api/auth proxy when no env URL is set", () => {
    // `envUrl: undefined` simulates an unset VITE_NEON_AUTH_URL (the
    // production case), since the local .env populates it in tests.
    expect(
      resolveAuthBaseURL({ envUrl: undefined, origin: "https://markx.app" }),
    ).toBe("https://markx.app/api/auth")
  })

  it("always returns an absolute http(s) URL (never a bare relative path)", () => {
    const cases = [
      resolveAuthBaseURL({ origin: "https://markx.app" }),
      resolveAuthBaseURL({ envUrl: "/api/auth", origin: "https://markx.app" }),
      resolveAuthBaseURL({
        envUrl: "http://localhost:3000/api/auth",
        origin: "https://markx.app",
      }),
    ]
    for (const url of cases) {
      expect(url).toMatch(/^https?:\/\//i)
    }
  })

  it("throws when no origin and no absolute URL are available", () => {
    expect(() =>
      resolveAuthBaseURL({ envUrl: undefined, origin: undefined }),
    ).toThrow(/base URL/)
  })
})
