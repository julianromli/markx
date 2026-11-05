import type { buildAuthClient } from "@/lib/auth/auth-client-factory"

export type AuthClient = ReturnType<typeof buildAuthClient>

/**
 * Lazily-created Better Auth client (email OTP plugin).
 *
 * Imported dynamically inside {@link getAuthClient} (which only runs in
 * client-side effects/handlers) so the browser client never evaluates in
 * the Workers global scope, where random values are forbidden. The created
 * client is cached after first use.
 *
 * Talks to the same-origin `/api/auth` handler (see `src/server.ts`), so
 * session cookies are first-party.
 */
let _client: AuthClient | null = null

/**
 * Resolve the Better Auth client's `baseURL` to an ABSOLUTE URL.
 *
 * Better Auth rejects relative base URLs — it runs `new URL(baseURL)`,
 * which throws for a bare path like `/api/auth` (no base to resolve
 * against), producing "Invalid base URL: /api/auth. Please provide a
 * valid base URL." We keep the same-origin `/api/auth` design
 * (first-party cookies via `src/server.ts`) but resolve it
 * against the current origin so the client receives e.g.
 * `https://markx.app/api/auth`.
 *
 * Resolution rules:
 *  1. An absolute `VITE_AUTH_URL` (http/https) is used as-is — this
 *     is the local-dev case (e.g. `http://localhost:3000/api/auth`).
 *  2. A relative `VITE_AUTH_URL` (e.g. `/api/auth`) is resolved
 *     against the page origin.
 *  3. When unset, defaults to `${origin}/api/auth` (same-origin handler).
 *
 * `envUrl` and `origin` are optional injection points for unit tests.
 */
export function resolveAuthBaseURL(opts?: {
  envUrl?: string
  origin?: string
}): string {
  const envUrl =
    opts && "envUrl" in opts ? opts.envUrl : import.meta.env.VITE_AUTH_URL
  // An explicitly-passed `origin` (even `undefined`) wins; otherwise fall
  // back to the browser's location so production resolves automatically.
  const origin =
    opts && "origin" in opts
      ? opts.origin
      : typeof window !== "undefined"
        ? window.location.origin
        : undefined

  if (envUrl) {
    // Already absolute (e.g. local dev) — use as-is.
    if (/^https?:\/\//i.test(envUrl)) return envUrl
    // Relative path — resolve against the current origin.
    if (origin) return new URL(envUrl, origin).href
  }

  // Default: same-origin `/api/auth` resolved against the origin.
  if (origin) return `${origin}/api/auth`

  throw new Error(
    "Auth client requires a browser environment (window.location) or an " +
      "absolute VITE_AUTH_URL to resolve the base URL."
  )
}

export async function getAuthClient(): Promise<AuthClient> {
  if (_client) return _client
  const { buildAuthClient } = await import("@/lib/auth/auth-client-factory")
  _client = buildAuthClient(resolveAuthBaseURL())
  return _client
}
