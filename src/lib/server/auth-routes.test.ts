import { describe, expect, it } from "vitest"

import { isAuthPath, isEmailOtpSendPath } from "./auth-routes"

describe("auth route helpers", () => {
  it("recognizes only auth subpaths", () => {
    expect(isAuthPath("/api/auth/sign-in")).toBe(true)
    expect(isAuthPath("/api/authentic")).toBe(false)
    expect(isAuthPath("/api/auth")).toBe(false)
  })

  it("recognizes the email OTP send endpoint", () => {
    expect(
      isEmailOtpSendPath("/api/auth/email-otp/send-verification-otp")
    ).toBe(true)
    expect(isEmailOtpSendPath("/api/auth/sign-in/email-otp")).toBe(false)
    expect(isEmailOtpSendPath("/api/auth/email-otp/verify-email")).toBe(false)
  })
})
