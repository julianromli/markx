import { describe, expect, it, vi } from "vitest"

import {
  OTP_EMAIL_FROM,
  buildOtpEmail,
  sendOtpEmail,
} from "@/lib/auth/otp-email"

describe("OTP email", () => {
  it("puts the code in the subject and both bodies", () => {
    const email = buildOtpEmail("a@example.com", "123456")
    expect(email.to).toBe("a@example.com")
    expect(email.subject).toBe("123456 is your Markx sign-in code")
    expect(email.text).toContain("123456")
    expect(email.text).toContain("10 minutes")
    expect(email.html).toContain("123456")
  })

  it("sends from the Markx address through the binding", async () => {
    const send = vi.fn(async () => ({ messageId: "m1" }))
    await sendOtpEmail({ send }, buildOtpEmail("a@example.com", "123456"))
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "a@example.com",
        from: { email: "welcome@markx.faizintifada.com", name: "Markx" },
      })
    )
    expect(OTP_EMAIL_FROM.email).toBe("welcome@markx.faizintifada.com")
  })

  it("fails loudly when the binding is missing or rejects", async () => {
    const email = buildOtpEmail("a@example.com", "123456")
    await expect(sendOtpEmail(undefined, email)).rejects.toThrow(/EMAIL/)

    const error = Object.assign(new Error("sender not verified"), {
      code: "E_SENDER_NOT_VERIFIED",
    })
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(
      sendOtpEmail({ send: vi.fn().mockRejectedValue(error) }, email)
    ).rejects.toBe(error)
    expect(log).toHaveBeenCalledWith(
      "[auth] OTP email failed",
      "E_SENDER_NOT_VERIFIED",
      "sender not verified"
    )
    log.mockRestore()
  })
})
