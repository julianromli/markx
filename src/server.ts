/// <reference types="@cloudflare/vite-plugin" />
import handler from "@tanstack/react-start/server-entry"
import { cleanupExpiredAssets } from "@/lib/server/assets"

/**
 * Secrets not declared as `vars` in wrangler.jsonc (set via
 * `wrangler secret put` or `.dev.vars`). Augment the generated Env.
 */
interface MarkxEnv extends Env {
  DATABASE_URL?: string
  NEON_AUTH_COOKIE_SECRET?: string
}

/**
 * Same-origin reverse proxy for Neon Auth (Better Auth).
 *
 * The browser calls `/api/auth/*` on the Worker origin. We forward each
 * request to the managed Neon Auth service, then rewrite Set-Cookie headers
 * so the session cookies become first-party (no Domain attribute). This
 * avoids Safari ITP blocking third-party cookies on the cross-origin auth
 * host while keeping JWT verification against the Neon JWKS endpoint.
 */
async function proxyAuth(
  request: Request,
  env: MarkxEnv,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith("/api/auth/")) return null

  // Strip the `/api/auth` prefix, leaving the sub-path WITHOUT a leading
  // slash so `new URL()` resolves it relative to the base URL's path
  // (e.g. `/neondb/auth`), not as an absolute path that would replace it.
  const subPath = url.pathname.replace(/^\/api\/auth\/?/, "")
  // Ensure the base URL ends with `/` so `new URL()` treats it as a
  // directory. Without the trailing slash, RFC 3986 drops the last path
  // segment (e.g. `/neondb/auth` → `/neondb/`) and the route 404s.
  const base = env.NEON_AUTH_BASE_URL.endsWith("/")
    ? env.NEON_AUTH_BASE_URL
    : `${env.NEON_AUTH_BASE_URL}/`
  const target = new URL(subPath, base)
  target.search = url.search

  // Build a minimal header set for the upstream request. We deliberately do
  // NOT copy all request headers — the browser/dev-server sends headers
  // (Host, X-Forwarded-*, Referer, …) that Better Auth's hostname validation
  // rejects. The Workers runtime auto-sets `Host` from the target URL.
  const forwardHeaders = [
    "content-type",
    "origin",
    "cookie",
    "authorization",
    "accept",
    "accept-language",
  ]
  const headers = new Headers()
  for (const name of forwardHeaders) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body:
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : request.body,
    redirect: "manual",
  })

  const response = new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  })

  // Rewrite Set-Cookie: strip any Domain= attribute so the browser scopes
  // the cookie to the Worker origin (first-party). Force SameSite=Lax so
  // top-level navigations and same-origin fetches carry the cookie.
  const setCookies = response.headers.getSetCookie?.() ?? []
  if (setCookies.length > 0) {
    response.headers.delete("set-cookie")
    for (const cookie of setCookies) {
      const rewritten = cookie
        .replace(/;\s*Domain=[^;]*/gi, "")
        .replace(/;\s*SameSite=[^;]*/gi, "; SameSite=Lax")
      response.headers.append("set-cookie", rewritten)
    }
  }

  return response
}

export default {
  async fetch(
    request: Request,
    env: MarkxEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const authResponse = await proxyAuth(request, env)
    if (authResponse) return authResponse

    // TanStack Start's handler only needs the Request. Cloudflare bindings
    // (env) are accessed inside server functions via `cloudflare:workers`,
    // and `ctx` is used here only for `waitUntil` on the scheduled path.
    return handler.fetch(request)
  },

  async scheduled(
    _event: ScheduledEvent,
    _env: MarkxEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(cleanupExpiredAssets())
  },
}
