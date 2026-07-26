import { isSafePublicHttpUrl } from "@/lib/server/guest-guards"
import {
  MAX_OG_PREVIEW_BYTES,
  normalizeImageContentType,
  OG_PREVIEW_PATH_PREFIX,
  ogPreviewObjectKey,
  ogPreviewPath,
  parseOgPreviewHash,
  sha256Hex,
} from "@/lib/server/og-preview-helpers"
import { fetchPublicHttp } from "@/lib/server/safe-fetch"

export {
  MAX_OG_PREVIEW_BYTES,
  normalizeImageContentType,
  OG_PREVIEW_OBJECT_PREFIX,
  OG_PREVIEW_PATH_PREFIX,
  ogPreviewObjectKey,
  ogPreviewPath,
  parseOgPreviewHash,
  sha256Hex,
} from "@/lib/server/og-preview-helpers"

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"

/**
 * Download a remote OG image (SSRF-safe) and store it in R2 under a
 * content-addressed key derived from the source URL. Returns a same-origin
 * path the board can hotlink without depending on the origin CDN.
 */
export async function mirrorOgImageToR2(
  imageUrl: string
): Promise<string | null> {
  if (imageUrl.startsWith(OG_PREVIEW_PATH_PREFIX)) return imageUrl
  if (!isSafePublicHttpUrl(imageUrl)) return null

  const hash = await sha256Hex(imageUrl)
  const objectKey = ogPreviewObjectKey(hash)
  const path = ogPreviewPath(hash)

  const { env } = await import("cloudflare:workers")

  const existing = await env.MARKX_BUCKET.head(objectKey)
  if (existing) return path

  let response: Response
  try {
    ;({ response } = await fetchPublicHttp(imageUrl, {
      timeoutMs: 5_000,
      maxRedirects: 5,
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "user-agent": BROWSER_UA,
      },
    }))
  } catch {
    return null
  }

  if (!response.ok) {
    void response.body?.cancel()
    return null
  }

  const mime = normalizeImageContentType(response.headers.get("content-type"))
  if (!mime) {
    void response.body?.cancel()
    return null
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OG_PREVIEW_BYTES) {
    return null
  }

  await env.MARKX_BUCKET.put(objectKey, bytes, {
    httpMetadata: { contentType: mime },
  })

  return path
}

export async function serveOgPreview(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url)
  const hash = parseOgPreviewHash(url.pathname)
  if (!hash) return null

  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 })
  }

  const object = await env.MARKX_BUCKET.get(ogPreviewObjectKey(hash))
  if (!object) {
    return new Response("Not Found", { status: 404 })
  }

  const headers = new Headers()
  headers.set(
    "Content-Type",
    object.httpMetadata?.contentType ?? "application/octet-stream"
  )
  headers.set("Cache-Control", "public, max-age=31536000, immutable")
  headers.set("X-Content-Type-Options", "nosniff")

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers })
  }

  return new Response(object.body, { status: 200, headers })
}
