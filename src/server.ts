/// <reference types="@cloudflare/vite-plugin" />
import handler from "@tanstack/react-start/server-entry"
import { cleanupExpiredAssets } from "@/lib/server/assets.server"
import {
  buildAuthProxyHeaders,
  buildAuthTargetUrl,
  isAuthProxyPath,
  rewriteAuthCookie,
} from "@/lib/server/auth-proxy"
import { serveOgPreview } from "@/lib/server/og-preview"

/**
 * Same-origin reverse proxy for Neon Auth (Better Auth).
 *
 * The browser calls `/api/auth/*` on the Worker origin. We forward each
 * request to the managed Neon Auth service, then rewrite Set-Cookie headers
 * so the session cookies become first-party (no Domain attribute). This
 * avoids Safari ITP blocking third-party cookies on the cross-origin auth
 * host while keeping JWT verification against the Neon JWKS endpoint.
 */
async function proxyAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!isAuthProxyPath(url.pathname)) return null

  const target = buildAuthTargetUrl(request.url, env.NEON_AUTH_BASE_URL)

  // Build a minimal header set for the upstream request. We deliberately do
  // NOT copy all request headers — the browser/dev-server sends headers
  // (Host, X-Forwarded-*, Referer, …) that Better Auth's hostname validation
  // rejects. The Workers runtime auto-sets `Host` from the target URL.
  const headers = buildAuthProxyHeaders(request.headers)

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

  // Strip Domain so cookies are first-party, and normalize an existing
  // SameSite attribute to Lax.
  const setCookies = response.headers.getSetCookie()
  if (setCookies.length > 0) {
    response.headers.delete("set-cookie")
    for (const cookie of setCookies) {
      response.headers.append("set-cookie", rewriteAuthCookie(cookie))
    }
  }

  return response
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const authResponse = await proxyAuth(request, env)
    if (authResponse) return authResponse

    const ogPreview = await serveOgPreview(request, env)
    if (ogPreview) return ogPreview

    // TanStack Start's handler only needs the Request. Cloudflare bindings
    // (env) are accessed inside server functions via `cloudflare:workers`,
    // and `ctx` is used here only for `waitUntil` on the scheduled path.
    return handler.fetch(request)
  },

  async scheduled(
    _event: ScheduledEvent,
    _env: Env,
    ctx: ExecutionContext
  ): Promise<void> {
    ctx.waitUntil(cleanupExpiredAssets())
  },
}
