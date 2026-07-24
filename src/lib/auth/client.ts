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

export async function getAuthClient(): Promise<AuthClient> {
  if (_client) return _client
  const { createAuthClient } = await import("@neondatabase/neon-js/auth")
  const { BetterAuthReactAdapter } = await import(
    "@neondatabase/neon-js/auth/react/adapters"
  )
  _client = createAuthClient(
    import.meta.env.VITE_NEON_AUTH_URL ?? "/api/auth",
    {
      adapter: BetterAuthReactAdapter({
        fetchOptions: { credentials: "include" },
      }),
    },
  ) as AuthClient
  return _client
}
