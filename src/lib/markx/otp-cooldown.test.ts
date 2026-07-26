import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  clearOtpCooldown,
  getOtpCooldownRemainingSeconds,
  OTP_SEND_COOLDOWN_SECONDS,
  startOtpCooldown,
} from "./otp-cooldown"

describe("otp-cooldown", () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    sessionStorage.clear()
  })

  it("returns 0 when no cooldown is stored", () => {
    expect(getOtpCooldownRemainingSeconds("user@example.com")).toBe(0)
  })

  it("starts a 60s cooldown normalized by email", () => {
    const now = 1_000_000
    startOtpCooldown("  User@Example.com ", now)

    expect(getOtpCooldownRemainingSeconds("user@example.com", now)).toBe(
      OTP_SEND_COOLDOWN_SECONDS
    )
    expect(
      getOtpCooldownRemainingSeconds("user@example.com", now + 30_000)
    ).toBe(30)
    expect(
      getOtpCooldownRemainingSeconds("user@example.com", now + 60_000)
    ).toBe(0)
  })

  it("tracks emails independently", () => {
    const now = 1_000_000
    startOtpCooldown("a@example.com", now)

    expect(getOtpCooldownRemainingSeconds("a@example.com", now)).toBe(
      OTP_SEND_COOLDOWN_SECONDS
    )
    expect(getOtpCooldownRemainingSeconds("b@example.com", now)).toBe(0)
  })

  it("clears a single email or the whole store", () => {
    const now = 1_000_000
    startOtpCooldown("a@example.com", now)
    startOtpCooldown("b@example.com", now)

    clearOtpCooldown("a@example.com")
    expect(getOtpCooldownRemainingSeconds("a@example.com", now)).toBe(0)
    expect(getOtpCooldownRemainingSeconds("b@example.com", now)).toBe(
      OTP_SEND_COOLDOWN_SECONDS
    )

    clearOtpCooldown()
    expect(getOtpCooldownRemainingSeconds("b@example.com", now)).toBe(0)
  })
})
