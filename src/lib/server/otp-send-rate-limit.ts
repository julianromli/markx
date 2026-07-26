import { createFixedWindowRateLimiter } from "./guest-guards"

/**
 * Best-effort OTP email send throttle (1 send / 60s / client IP).
 *
 * Isolate-local memory only — see `createFixedWindowRateLimiter`. Enough to
 * blunt accidental spam and protect developer SMTP quota; not a global quota.
 */
const otpSendRateLimiter = createFixedWindowRateLimiter({
  limit: 1,
  windowMs: 60_000,
})

export function clientIpFromHeaders(headers: Headers): string {
  const connectingIp = headers.get("cf-connecting-ip")?.trim()
  if (connectingIp) return connectingIp

  const forwardedFor = headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim()
  if (forwardedFor) return forwardedFor

  const realIp = headers.get("x-real-ip")?.trim()
  return realIp || "unknown-client"
}

/**
 * Returns a 429 Response when the client must wait, otherwise `null`.
 * Call before forwarding `email-otp/send-verification-otp` upstream.
 */
export function checkOtpSendRateLimit(request: Request): Response | null {
  const ip = clientIpFromHeaders(request.headers)
  const result = otpSendRateLimiter.check(`otp-send:${ip}`)
  if (result.allowed) return null

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
  return new Response(
    JSON.stringify({
      message: `Please wait ${retryAfterSeconds}s before requesting another code.`,
      code: "TOO_MANY_REQUESTS",
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSeconds),
      },
    }
  )
}
