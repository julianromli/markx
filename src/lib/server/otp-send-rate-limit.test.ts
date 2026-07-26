import { describe, expect, it } from "vitest"

import {
  checkOtpSendRateLimit,
  clientIpFromHeaders,
} from "./otp-send-rate-limit"

function otpSendRequest(ipHeader: Record<string, string>): Request {
  return new Request(
    "https://markx.app/api/auth/email-otp/send-verification-otp",
    {
      method: "POST",
      headers: ipHeader,
    }
  )
}

describe("clientIpFromHeaders", () => {
  it("prefers cf-connecting-ip, then x-forwarded-for, then x-real-ip", () => {
    expect(
      clientIpFromHeaders(
        new Headers({
          "cf-connecting-ip": "1.2.3.4",
          "x-forwarded-for": "9.9.9.9",
          "x-real-ip": "8.8.8.8",
        })
      )
    ).toBe("1.2.3.4")

    expect(
      clientIpFromHeaders(
        new Headers({
          "x-forwarded-for": "9.9.9.9, 1.1.1.1",
          "x-real-ip": "8.8.8.8",
        })
      )
    ).toBe("9.9.9.9")

    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe(
      "8.8.8.8"
    )
    expect(clientIpFromHeaders(new Headers())).toBe("unknown-client")
  })
})

describe("checkOtpSendRateLimit", () => {
  it("allows the first OTP send per IP, then returns 429", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    const first = checkOtpSendRateLimit(
      otpSendRequest({ "cf-connecting-ip": ip })
    )
    expect(first).toBeNull()

    const second = checkOtpSendRateLimit(
      otpSendRequest({ "cf-connecting-ip": ip })
    )
    expect(second).not.toBeNull()
    expect(second?.status).toBe(429)
    expect(second?.headers.get("Retry-After")).toMatch(/^\d+$/)

    const body = (await second!.json()) as { message: string; code: string }
    expect(body.code).toBe("TOO_MANY_REQUESTS")
    expect(body.message).toMatch(/wait/i)
  })

  it("rate-limits IPs independently", () => {
    const a = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    const b = `198.51.100.${Math.floor(Math.random() * 200) + 1}`
    if (a === b) return

    expect(
      checkOtpSendRateLimit(otpSendRequest({ "cf-connecting-ip": a }))
    ).toBeNull()
    expect(
      checkOtpSendRateLimit(otpSendRequest({ "cf-connecting-ip": b }))
    ).toBeNull()
    expect(
      checkOtpSendRateLimit(otpSendRequest({ "cf-connecting-ip": a }))?.status
    ).toBe(429)
  })
})
