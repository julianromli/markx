import { z } from "zod"

import { extractBearer, verifyNeonJwt } from "@/lib/auth/jwt"
import { enrichAndMirror } from "@/lib/server/enrich.server"
import {
  addBookmarkForUser,
  applyBookmarkEnrichmentForUser,
  listFoldersForUser,
} from "@/lib/server/extension.server"

const SESSION_PATH = "/api/extension/session"
const FOLDERS_PATH = "/api/extension/folders"
const BOOKMARKS_PATH = "/api/extension/bookmarks"

export function isExtensionApiPath(pathname: string): boolean {
  return (
    pathname === SESSION_PATH ||
    pathname === FOLDERS_PATH ||
    pathname === BOOKMARKS_PATH
  )
}

export function isAllowedExtensionOrigin(origin: string): boolean {
  return origin.startsWith("chrome-extension://")
}

export function extensionCorsHeaders(origin: string | null): Headers {
  const headers = new Headers()
  if (origin && isAllowedExtensionOrigin(origin)) {
    headers.set("Access-Control-Allow-Origin", origin)
    headers.set("Vary", "Origin")
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type")
  headers.set("Access-Control-Max-Age", "86400")
  return headers
}

const addBookmarkSchema = z.object({
  folderId: z.string().min(1),
  url: z.string().min(1),
})

function jsonResponse(
  body: unknown,
  status: number,
  origin: string | null
): Response {
  const headers = extensionCorsHeaders(origin)
  headers.set("Content-Type", "application/json")
  return new Response(JSON.stringify(body), { status, headers })
}

async function authenticate(
  request: Request,
  env: Env
): Promise<
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; response: Response }
> {
  const origin = request.headers.get("origin")
  const user = await verifyNeonJwt(
    extractBearer(request.headers.get("authorization")),
    env
  )
  if (!user) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, reason: "unauthorized" },
        401,
        origin
      ),
    }
  }
  return { ok: true, user }
}

/**
 * Same-origin-adjacent REST API for the Chrome extension.
 * Auth is the Neon Auth JWT in `Authorization: Bearer`, not cookies:
 * the extension origin is cross-site, so SameSite=Lax session cookies
 * are not sent. Do not change cookie SameSite to make this work.
 */
export async function handleExtensionApi(
  request: Request,
  env: Env,
  ctx: { waitUntil: (promise: Promise<unknown>) => void }
): Promise<Response | null> {
  const url = new URL(request.url)
  if (!isExtensionApiPath(url.pathname)) return null

  const origin = request.headers.get("origin")
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: extensionCorsHeaders(origin),
    })
  }

  if (url.pathname === SESSION_PATH && request.method === "GET") {
    const auth = await authenticate(request, env)
    if (!auth.ok) return auth.response
    return jsonResponse(
      { ok: true, user: { id: auth.user.id, email: auth.user.email } },
      200,
      origin
    )
  }

  if (url.pathname === FOLDERS_PATH && request.method === "GET") {
    const auth = await authenticate(request, env)
    if (!auth.ok) return auth.response
    const folders = await listFoldersForUser(auth.user.id)
    if (folders == null) {
      return jsonResponse({ ok: true, folders: [] }, 200, origin)
    }
    return jsonResponse({ ok: true, folders }, 200, origin)
  }

  if (url.pathname === BOOKMARKS_PATH && request.method === "POST") {
    const auth = await authenticate(request, env)
    if (!auth.ok) return auth.response
    let parsed: z.infer<typeof addBookmarkSchema>
    try {
      parsed = addBookmarkSchema.parse(await request.json())
    } catch {
      return jsonResponse({ ok: false, reason: "invalid_request" }, 400, origin)
    }
    const result = await addBookmarkForUser(auth.user.id, parsed)
    if (!result.ok) {
      const status =
        result.reason === "board_full"
          ? 403
          : result.reason === "folder_not_found" ||
              result.reason === "invalid_url"
            ? 400
            : result.reason === "no_workspace"
              ? 404
              : 409
      return jsonResponse(result, status, origin)
    }
    ctx.waitUntil(
      enrichAndMirror(result.bookmark.url)
        .then((metadata) =>
          applyBookmarkEnrichmentForUser(
            auth.user.id,
            result.bookmark.id,
            metadata
          )
        )
        .catch((err) => {
          console.error("[markx extension] enrich failed", err)
        })
    )
    return jsonResponse(result, 200, origin)
  }

  return jsonResponse({ ok: false, reason: "method_not_allowed" }, 405, origin)
}
