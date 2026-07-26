import { isSafePublicHttpUrl } from "@/lib/server/guest-guards"

export const DEFAULT_SAFE_FETCH_TIMEOUT_MS = 8_000
export const DEFAULT_MAX_REDIRECTS = 5

export type SafeFetchInit = {
  method?: string
  headers?: HeadersInit
  body?: BodyInit | null
  timeoutMs?: number
  maxRedirects?: number
  signal?: AbortSignal
}

/**
 * Fetch a public HTTP(S) URL while manually following redirects and
 * re-validating every hop against {@link isSafePublicHttpUrl}.
 *
 * Using `redirect: "error"` rejected too many legitimate sites (www ↔ apex,
 * http → https, short links). Blind `redirect: "follow"` would reopen SSRF
 * via open redirects into private ranges. This middle path keeps the guard.
 */
export type SafeFetchResult = {
  response: Response
  finalUrl: string
}

export async function fetchPublicHttp(
  url: string,
  init: SafeFetchInit = {}
): Promise<SafeFetchResult> {
  const maxRedirects = init.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const timeoutMs = init.timeoutMs ?? DEFAULT_SAFE_FETCH_TIMEOUT_MS

  let current = url
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    if (!isSafePublicHttpUrl(current)) {
      throw new Error(`Refusing to fetch unsafe URL: ${current}`)
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal

    const response = await fetch(current, {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      signal,
    })

    if (response.status < 300 || response.status >= 400) {
      return { response, finalUrl: current }
    }

    const location = response.headers.get("location")
    if (!location) {
      throw new Error(`Redirect ${response.status} without Location`)
    }

    // Drain/cancel the body so the connection can be reused.
    void response.body?.cancel()
    current = new URL(location, current).toString()
  }

  throw new Error(`Too many redirects (max ${maxRedirects})`)
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
