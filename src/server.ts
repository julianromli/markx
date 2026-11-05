/// <reference types="@cloudflare/vite-plugin" />
import handler from "@tanstack/react-start/server-entry"
import { createAuth } from "@/lib/auth/server"
import { withDb } from "@/lib/db/client"
import { cleanupExpiredAssets } from "@/lib/server/assets.server"
import { isAuthPath, isEmailOtpSendPath } from "@/lib/server/auth-routes"
import { checkOtpSendRateLimit } from "@/lib/server/otp-send-rate-limit"
import { serveOgPreview } from "@/lib/server/og-preview"
import { serveSharedBoardAsset } from "@/lib/server/shared-board-asset"

/**
 * Self-hosted Better Auth on the Worker origin (`/api/auth/*`). Session
 * cookies are first-party. Data lives in the `auth` schema of the app DB.
 */
async function handleAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!isAuthPath(url.pathname)) return null

  // Throttle OTP email sends before they reach the mailer.
  if (request.method === "POST" && isEmailOtpSendPath(url.pathname)) {
    const limited = checkOtpSendRateLimit(request)
    if (limited) return limited
  }

  return withDb(({ db }) => createAuth(db, env).handler(request))
}

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const authResponse = await handleAuth(request, env)
    if (authResponse) return authResponse

    const ogPreview = await serveOgPreview(request, env)
    if (ogPreview) return ogPreview

    const sharedAsset = await serveSharedBoardAsset(request, env)
    if (sharedAsset) return sharedAsset

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
