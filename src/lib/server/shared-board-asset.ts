import { and, eq } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import { assets, sharedBoardLinks, sharedBoards } from "@/lib/db/schema"

/**
 * Match `/s/:token/asset/:imageId` and return the parsed parts, or null when
 * the path is not a shared-board asset request.
 */
export function parseSharedBoardAssetPath(pathname: string): {
  token: string
  imageId: string
} | null {
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length !== 4) return null
  if (segments[0] !== "s" || segments[2] !== "asset") return null
  const token = segments[1]
  const imageId = segments[3]
  if (!token || !imageId) return null
  return { token, imageId }
}

/**
 * Serve a shared-board image asset by share token. No login required — the
 * token (view or edit) grants read access. Resolves the token to a board,
 * then the board owner's `assets` row for the image, and streams the R2
 * blob with immutable cache headers.
 */
export async function serveSharedBoardAsset(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url)
  const parsed = parseSharedBoardAssetPath(url.pathname)
  if (!parsed) return null

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const { token, imageId } = parsed

  const resolved = await withDb(async ({ db }) => {
    const linkRows = await db
      .select({ boardId: sharedBoardLinks.boardId })
      .from(sharedBoardLinks)
      .where(eq(sharedBoardLinks.token, token))
      .limit(1)
    const link = linkRows.at(0)
    if (!link) return null

    const boardRows = await db
      .select({ ownerUserId: sharedBoards.ownerUserId })
      .from(sharedBoards)
      .where(eq(sharedBoards.id, link.boardId))
      .limit(1)
    const board = boardRows.at(0)
    if (!board) return null

    const assetRows = await db
      .select({ objectKey: assets.objectKey, mime: assets.mime })
      .from(assets)
      .where(
        and(eq(assets.userId, board.ownerUserId), eq(assets.id, imageId))
      )
      .limit(1)
    return assetRows.at(0) ?? null
  })

  if (!resolved) {
    return new Response("Not Found", { status: 404 })
  }

  const object = await env.MARKX_BUCKET.get(resolved.objectKey)
  if (!object) {
    return new Response("Not Found", { status: 404 })
  }

  const headers = new Headers()
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType ?? resolved.mime
  )
  headers.set("Cache-Control", "public, max-age=31536000, immutable")
  headers.set("X-Content-Type-Options", "nosniff")

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers })
  }

  return new Response(object.body, { status: 200, headers })
}
