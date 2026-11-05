/** Sign-in OTP rules shared by the server and tests. */
export const OTP_LENGTH = 6
export const OTP_EXPIRES_IN_SECONDS = 10 * 60

export const OTP_EMAIL_FROM = {
  email: "welcome@markx.faizintifada.com",
  name: "Markx",
} as const

export type OtpEmail = {
  to: string
  subject: string
  html: string
  text: string
}

/** The builder form of the Cloudflare Email Service `send_email` binding. */
export type EmailSender = {
  send: (message: EmailMessageBuilder) => Promise<EmailSendResult>
}

export function buildOtpEmail(to: string, otp: string): OtpEmail {
  const minutes = Math.round(OTP_EXPIRES_IN_SECONDS / 60)
  const text = [
    `Your Markx sign-in code is ${otp}`,
    "",
    `It expires in ${minutes} minutes. If you did not ask for it, ignore this email.`,
  ].join("\n")
  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111">
    <div style="max-width:420px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
      <p style="margin:0 0 12px;font-size:15px">Your Markx sign-in code:</p>
      <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">${otp}</p>
      <p style="margin:0;font-size:13px;color:#555">It expires in ${minutes} minutes. If you did not ask for it, ignore this email.</p>
    </div>
  </body>
</html>`
  return { to, subject: `${otp} is your Markx sign-in code`, html, text }
}

/**
 * Send the OTP through the Cloudflare Email Service binding. The binding
 * throws an Error with a `code` (e.g. E_SENDER_NOT_VERIFIED); log it here
 * because Better Auth turns a throw into a generic 500.
 */
export async function sendOtpEmail(
  sender: EmailSender | undefined,
  email: OtpEmail
): Promise<void> {
  if (!sender) {
    throw new Error("EMAIL (send_email) binding is not configured")
  }
  try {
    await sender.send({ ...email, from: OTP_EMAIL_FROM })
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err ? String(err.code) : ""
    console.error("[auth] OTP email failed", code, (err as Error).message)
    throw err
  }
}
