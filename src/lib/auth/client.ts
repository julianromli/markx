import { createAuthClient } from "@neondatabase/neon-js/auth"
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters"

/**
 * Neon Auth client.
 *
 * Uses the same-origin `/api/auth` proxy (see `src/server.ts`) so that
 * session cookies are first-party. This avoids Safari ITP blocking
 * third-party cookies on the cross-origin Neon Auth host.
 *
 * `credentials: "include"` is still set for safety, though same-origin
 * requests send cookies by default.
 */
export const authClient = createAuthClient(
  import.meta.env.VITE_NEON_AUTH_URL ?? "/api/auth",
  {
    adapter: BetterAuthReactAdapter({
      fetchOptions: { credentials: "include" },
    }),
  },
)
