export const OG_PREVIEW_PATH_PREFIX = "/api/og-preview/"
export const OG_PREVIEW_OBJECT_PREFIX = "og-previews/"
export const MAX_OG_PREVIEW_BYTES = 5 * 1024 * 1024

const ALLOWED_OG_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
])

export function ogPreviewObjectKey(hash: string): string {
  return `${OG_PREVIEW_OBJECT_PREFIX}${hash}`
}

export function ogPreviewPath(hash: string): string {
  return `${OG_PREVIEW_PATH_PREFIX}${hash}`
}

export function parseOgPreviewHash(pathname: string): string | null {
  if (!pathname.startsWith(OG_PREVIEW_PATH_PREFIX)) return null
  const hash = pathname.slice(OG_PREVIEW_PATH_PREFIX.length)
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null
}

export function normalizeImageContentType(
  contentType: string | null | undefined
): string | null {
  if (!contentType) return null
  const mime = contentType.split(";", 1)[0]?.trim().toLowerCase()
  if (!mime) return null
  if (mime === "image/jpg") return "image/jpeg"
  return ALLOWED_OG_IMAGE_TYPES.has(mime) ? mime : null
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
}
