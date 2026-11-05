import { createMiddleware } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"

import type { VerifiedAuthUser } from "@/lib/auth/types"

/**
 * Authenticated user shape injected into server function context by
 * {@link authMiddleware}.
 */
export type AuthUser = VerifiedAuthUser

/**
 * TanStack Start middleware that reads the Better Auth session cookie
 * (same-origin, sent by the browser automatically) and injects a typed
 * `user` into the server function context. `user` is `null` for guests so
 * the handler can decide whether to reject (401) or allow guest access.
 *
 * Attach with `.middleware([authMiddleware])` on any server function that
 * needs an authenticated caller. Use {@link requireUser} to unwrap the user
 * and throw 401 when missing.
 *
 * **Note**: server-only modules are imported dynamically inside the server
 * callback so the client bundle never includes `cloudflare:workers`, the
 * database driver, or Better Auth's server code.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const [{ env }, { withDb }, { createAuth, getSessionUser }] =
      await Promise.all([
        import("cloudflare:workers"),
        import("@/lib/db/client"),
        import("@/lib/auth/server"),
      ])
    const headers = getRequest().headers
    const user = await withDb(({ db }) =>
      getSessionUser(createAuth(db, env), headers)
    )
    return next({ context: { user } })
  }
)

/**
 * Helper for server functions: returns the authenticated user from the
 * middleware context, or throws a 401 `Response` if absent/unverified.
 *
 * Throwing a `Response` is the TanStack Start convention for short-circuiting
 * a server function with a specific HTTP status; the framework serializes it
 * back to the client as-is.
 */
export function requireUser(context: { user: AuthUser | null }): AuthUser {
  if (!context.user) {
    throw new Response("Unauthorized", { status: 401 })
  }
  return context.user
}
