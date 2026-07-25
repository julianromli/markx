import { getRequestHeader } from "@tanstack/react-start/server"

import type { FixedWindowRateLimiter } from "./guest-guards"

function requestRateLimitKey(): string {
  const connectingIp = getRequestHeader("cf-connecting-ip")?.trim()
  if (connectingIp) return connectingIp

  const forwardedFor = getRequestHeader("x-forwarded-for")
    ?.split(",", 1)[0]
    ?.trim()
  if (forwardedFor) return forwardedFor

  const realIp = getRequestHeader("x-real-ip")?.trim()
  return realIp || "unknown-client"
}

export function enforceRateLimit(
  limiter: FixedWindowRateLimiter,
  endpoint: string
): void {
  const result = limiter.check(`${endpoint}:${requestRateLimitKey()}`)
  if (result.allowed) return

  const retryAfterSeconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000))
  throw new Response(
    `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    }
  )
}
