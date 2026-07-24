import type { ReactBetterAuthClient } from "@neondatabase/neon-js/auth"

export type AuthClient = ReactBetterAuthClient

/**
 * Lazily-created Neon Auth client.
 *
 * The Better Auth client module (`@neondatabase/neon-js/auth`) calls
 * `crypto.randomUUID()` at module top level. Cloudflare Workers forbids
 * generating random values in global scope (module evaluation), so we
 * must never let that module be statically imported by server-side code.
 *
 * By importing it dynamically inside this function (which only ever runs
 * inside client-side effects/handlers), the Better Auth module is
 * evaluated in a handler context on the browser — never in the Workers
 * global scope. The created client is cached after first use.
 *
 * Uses the same-origin `/api/auth` proxy (see `src/server.ts`) so session
 * cookies are first-party, avoiding Safari ITP blocking third-party
 * cookies on the cross-origin Neon Auth host.
 */
let _client: AuthClient | null = null

/**
 * Resolve the Better Auth client's `baseURL` to an ABSOLUTE URL.
 *
 * Better Auth rejects relative base URLs — it runs `new URL(baseURL)`,
 * which throws for a bare path like `/api/auth` (no base to resolve
 * against), producing "Invalid base URL: /api/auth. Please provide a
 * valid base URL." We keep the same-origin `/api/auth` proxy design
 * (Safari-safe first-party cookies via `src/server.ts`) but resolve it
 * against the current origin so the client receives e.g.
 * `https://markx.app/api/auth`.
 *
 * Resolution rules:
 *  1. An absolute `VITE_NEON_AUTH_URL` (http/https) is used as-is — this
 *     is the local-dev case (e.g. `http://localhost:3000/api/auth`).
 *  2. A relative `VITE_NEON_AUTH_URL` (e.g. `/api/auth`) is resolved
 *     against the page origin.
 *  3. When unset, defaults to `${origin}/api/auth` (the same-origin proxy).
 *
 * `envUrl` and `origin` are optional injection points for unit tests.
 */
export function resolveAuthBaseURL(opts?: {
  envUrl?: string
  origin?: string
}): string {
  const envUrl =
    opts && "envUrl" in opts
      ? opts.envUrl
      : import.meta.env.VITE_NEON_AUTH_URL
  // An explicitly-passed `origin` (even `undefined`) wins; otherwise fall
  // back to the browser's location so production resolves automatically.
  const origin =
    opts && "origin" in opts
      ? opts.origin
      : typeof window !== "undefined" && window.location
        ? window.location.origin
        : undefined

  if (envUrl) {
    // Already absolute (e.g. local dev) — use as-is.
    if (/^https?:\/\//i.test(envUrl)) return envUrl
    // Relative path — resolve against the current origin.
    if (origin) return new URL(envUrl, origin).href
  }

  // Default: same-origin `/api/auth` proxy resolved against the origin.
  if (origin) return `${origin}/api/auth`

  throw new Error(
    "Auth client requires a browser environment (window.location) or an " +
      "absolute VITE_NEON_AUTH_URL to resolve the base URL.",
  )
}

export async function getAuthClient(): Promise<AuthClient> {
  if (_client) return _client
  const { createAuthClient } = await import("@neondatabase/neon-js/auth")
  const { BetterAuthReactAdapter } = await import(
    "@neondatabase/neon-js/auth/react/adapters"
  )
  _client = createAuthClient(resolveAuthBaseURL(), {
    adapter: BetterAuthReactAdapter({
      fetchOptions: { credentials: "include" },
    }),
  }) as AuthClient
  return _client
}
