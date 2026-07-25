export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

type FixedWindowRateLimiterOptions = {
  limit: number
  windowMs: number
  now?: () => number
}

type WindowEntry = {
  count: number
  startedAt: number
}

/**
 * A small, reusable fixed-window limiter backed by isolate-local memory.
 *
 * This is only a best-effort abuse-control seam. Serverless isolates do not
 * share this state, and restarts erase it, so it must not be treated as a
 * globally authoritative quota or security boundary.
 */
export function createFixedWindowRateLimiter({
  limit,
  windowMs,
  now = Date.now,
}: FixedWindowRateLimiterOptions): {
  check: (key: string) => RateLimitResult
} {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("Rate limit must be a positive integer")
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("Rate-limit window must be positive")
  }

  const entries = new Map<string, WindowEntry>()
  let checksSinceCleanup = 0

  function cleanupExpiredEntries(currentTime: number): void {
    for (const [key, entry] of entries) {
      if (currentTime - entry.startedAt >= windowMs) entries.delete(key)
    }
  }

  return {
    check(key: string): RateLimitResult {
      const currentTime = now()
      checksSinceCleanup += 1
      if (checksSinceCleanup >= 100) {
        cleanupExpiredEntries(currentTime)
        checksSinceCleanup = 0
      }

      let entry = entries.get(key)
      if (!entry || currentTime - entry.startedAt >= windowMs) {
        entry = { count: 0, startedAt: currentTime }
        entries.set(key, entry)
      }

      const retryAfterMs = Math.max(0, entry.startedAt + windowMs - currentTime)
      if (entry.count >= limit) {
        return { allowed: false, remaining: 0, retryAfterMs }
      }

      entry.count += 1
      return {
        allowed: true,
        remaining: limit - entry.count,
        retryAfterMs,
      }
    },
  }
}

export type FixedWindowRateLimiter = ReturnType<
  typeof createFixedWindowRateLimiter
>

function parseIpv4(hostname: string): [number, number, number, number] | null {
  const parts = hostname.split(".")
  if (parts.length !== 4) return null

  const bytes = parts.map(Number)
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null
  }
  return bytes as [number, number, number, number]
}

function isUnsafeIpv4(bytes: number[]): boolean {
  const [a, b, c] = bytes

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

function parseIpv6(hostname: string): bigint | null {
  let input = hostname.toLowerCase()
  if (input.startsWith("[") && input.endsWith("]")) {
    input = input.slice(1, -1)
  }
  const zoneIndex = input.indexOf("%")
  if (zoneIndex >= 0) input = input.slice(0, zoneIndex)

  const ipv4Match = input.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (ipv4Match) {
    const ipv4 = parseIpv4(ipv4Match[1])
    if (!ipv4) return null
    const high = (ipv4[0] << 8) | ipv4[1]
    const low = (ipv4[2] << 8) | ipv4[3]
    input = `${input.slice(0, ipv4Match.index)}${high.toString(16)}:${low.toString(16)}`
  }

  const halves = input.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves[1] ? halves[1].split(":") : []
  const missing = 8 - left.length - right.length
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null
  }

  const groups = [...left, ...Array(missing).fill("0"), ...right]
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null
  }

  return groups.reduce(
    (value, group) => (value << 16n) | BigInt(`0x${group}`),
    0n
  )
}

function isInIpv6Range(
  value: bigint,
  prefix: bigint,
  prefixLength: number
): boolean {
  const shift = BigInt(128 - prefixLength)
  return value >> shift === prefix >> shift
}

function isUnsafeIpv6(value: bigint): boolean {
  const mappedIpv4Prefix = 0xffffn
  if (value >> 32n === mappedIpv4Prefix) {
    const ipv4 = Number(value & 0xffffffffn)
    return isUnsafeIpv4([
      (ipv4 >>> 24) & 0xff,
      (ipv4 >>> 16) & 0xff,
      (ipv4 >>> 8) & 0xff,
      ipv4 & 0xff,
    ])
  }

  return (
    value === 0n ||
    value === 1n ||
    isInIpv6Range(value, 0x64ff9b00010000000000000000000000n, 48) ||
    isInIpv6Range(value, 0x10000000000000000000000000n, 64) ||
    isInIpv6Range(value, 0x20010000000000000000000000000000n, 32) ||
    isInIpv6Range(value, 0x20010002000000000000000000000000n, 48) ||
    isInIpv6Range(value, 0x20010010000000000000000000000000n, 28) ||
    isInIpv6Range(value, 0x20010020000000000000000000000000n, 28) ||
    isInIpv6Range(value, 0x20010db8000000000000000000000000n, 32) ||
    isInIpv6Range(value, 0x20020000000000000000000000000000n, 16) ||
    isInIpv6Range(value, 0xfc000000000000000000000000000000n, 7) ||
    isInIpv6Range(value, 0xfe800000000000000000000000000000n, 10) ||
    isInIpv6Range(value, 0xfec00000000000000000000000000000n, 10) ||
    isInIpv6Range(value, 0xff000000000000000000000000000000n, 8)
  )
}

export function isSafePublicHttpUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  if (url.username || url.password) return false

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "")
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    return false
  }

  const ipv4 = parseIpv4(hostname)
  if (ipv4) return !isUnsafeIpv4(ipv4)

  const ipv6 = parseIpv6(hostname)
  if (ipv6 !== null) return !isUnsafeIpv6(ipv6)

  return hostname.includes(".")
}
