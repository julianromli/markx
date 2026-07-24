import { createMiddleware } from "@tanstack/react-start"
import { getRequestHeader } from "@tanstack/react-start/server"

import { getAuthToken } from "@/lib/auth/session"
import { verifyNeonJwt, extractBearer } from "@/lib/auth/jwt"

/**
 * Authenticated user shape injected into server function context by
 * {@link authMiddleware}.
 */
export type AuthUser = {
  id: string
  email: string
  emailVerified: boolean
}

/**
 * TanStack Start middleware that:
 *
 *  - **Client side**: reads the Neon Auth session JWT via
 *    `authClient.getSession()` and attaches it as an
 *    `Authorization: Bearer <token>` header on every server-function call.
 *    The header is sent alongside the same-origin session cookie, so the
 *    Worker can verify the caller even if the cookie is absent (e.g. a
 *    cross-origin fetch from a preview URL).
 *
 *  - **Server side**: verifies the JWT against the Neon Auth JWKS endpoint
 *    and injects a typed `user` into the server function context. If no valid
 *    token is present, `user` is `null` so the handler can decide whether to
 *    reject (401) or allow guest access.
 *
 * Attach with `.middleware([authMiddleware])` on any server function that
 * needs an authenticated caller. Use {@link requireUser} to unwrap the user
 * and throw 401 when missing.
 *
 * **Note**: `cloudflare:workers` is imported dynamically inside the server
 * callback so that the client bundle never includes the Cloudflare-specific
 * module (which would break the browser build).
 */
export const authMiddleware = createMiddleware({ type: "function" })
  .client(async ({ next }) => {
    let authorization: string | undefined
    try {
      const token = await getAuthToken()
      if (token) authorization = `Bearer ${token}`
    } catch {
      // Not logged in — leave the header unset. The server middleware will
      // treat the absence as an unauthenticated (guest) request.
    }
    return next({
      headers: authorization ? { Authorization: authorization } : undefined,
    })
  })
  .server(async ({ next }) => {
    // Dynamic import so the client bundle never pulls in `cloudflare:workers`.
    const { env } = await import("cloudflare:workers")
    const user = await verifyNeonJwt(
      extractBearer(getRequestHeader("authorization")),
      env,
    )
    return next({ context: { user } })
  })

/**
 * Helper for server functions: returns the authenticated user from the
 * middleware context, or throws a 401 `Response` if absent/unverified.
 *
 * Throwing a `Response` is the TanStack Start convention for short-circuiting
 * a server function with a specific HTTP status; the framework serializes it
 * back to the client as-is.
 */
export function requireUser(context: {
  user: AuthUser | null
}): AuthUser {
  if (!context.user) {
    throw new Response("Unauthorized", { status: 401 })
  }
  return context.user
}
