import { describe, expect, it } from "vitest"

import {
  createFixedWindowRateLimiter,
  isSafePublicHttpUrl,
} from "./guest-guards"

describe("isSafePublicHttpUrl", () => {
  it.each([
    "https://example.com/page",
    "http://93.184.216.34/path",
    "https://[2606:4700:4700::1111]/",
  ])("accepts public HTTP(S) URL %s", (url) => {
    expect(isSafePublicHttpUrl(url)).toBe(true)
  })

  it.each([
    "ftp://example.com/file",
    "file:///etc/passwd",
    "https://user:secret@example.com",
    "https://localhost",
    "https://app.localhost",
    "https://printer.local",
    "https://intranet",
    "http://127.0.0.1",
    "http://127.1",
    "http://2130706433",
    "http://10.0.0.1",
    "http://100.64.0.1",
    "http://169.254.169.254",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://192.0.2.1",
    "http://198.18.0.1",
    "http://198.51.100.1",
    "http://203.0.113.1",
    "http://224.0.0.1",
    "http://255.255.255.255",
    "http://[::]",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
    "http://[fc00::1]",
    "http://[fe80::1]",
    "http://[2001:db8::1]",
    "http://[ff02::1]",
    "not a URL",
  ])("rejects unsafe URL %s", (url) => {
    expect(isSafePublicHttpUrl(url)).toBe(false)
  })
})

describe("createFixedWindowRateLimiter", () => {
  it("limits each key independently within a window", () => {
    let now = 1_000
    const limiter = createFixedWindowRateLimiter({
      limit: 2,
      windowMs: 10_000,
      now: () => now,
    })

    expect(limiter.check("client-a")).toMatchObject({
      allowed: true,
      remaining: 1,
    })
    expect(limiter.check("client-a")).toMatchObject({
      allowed: true,
      remaining: 0,
    })
    expect(limiter.check("client-a")).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 10_000,
    })
    expect(limiter.check("client-b").allowed).toBe(true)

    now += 10_000
    expect(limiter.check("client-a")).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 10_000,
    })
  })

  it("reports the remaining retry time", () => {
    let now = 0
    const limiter = createFixedWindowRateLimiter({
      limit: 1,
      windowMs: 1_000,
      now: () => now,
    })

    limiter.check("client")
    now = 250

    expect(limiter.check("client")).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 750,
    })
  })

  it("rejects invalid limiter configuration", () => {
    expect(() =>
      createFixedWindowRateLimiter({ limit: 0, windowMs: 1_000 })
    ).toThrow("Rate limit must be a positive integer")
    expect(() =>
      createFixedWindowRateLimiter({ limit: 1, windowMs: 0 })
    ).toThrow("Rate-limit window must be positive")
  })
})
