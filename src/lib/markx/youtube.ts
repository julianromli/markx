/**
 * YouTube URL helpers for Bookmark previews.
 *
 * Parse common share forms into a video id, then build deterministic thumbnail
 * URLs (`img.youtube.com`) and a canonical watch URL for oEmbed / cache keys.
 * The Bookmark URL itself stays as the user pasted it.
 */

const YOUTUBE_VIDEO_ID_RE = /^[\w-]{11}$/

export type YoutubeThumbnailQuality = "maxresdefault" | "hqdefault"

function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === "youtu.be" ||
    host === "www.youtu.be" ||
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com"
  )
}

function normalizeVideoId(value: string | null | undefined): string | null {
  if (!value) return null
  const id = value.trim()
  return YOUTUBE_VIDEO_ID_RE.test(id) ? id : null
}

/**
 * Extract an 11-char video id from common YouTube share URLs.
 * Returns null for playlists, channels, music.youtube.com, and unknown shapes.
 */
export function parseYoutubeVideoId(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null
  }
  if (!isYoutubeHost(parsed.hostname)) return null

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const segments = parsed.pathname.split("/").filter(Boolean)

  if (host === "youtu.be") {
    return normalizeVideoId(segments[0])
  }

  // youtube.com / m.youtube.com
  const fromQuery = normalizeVideoId(parsed.searchParams.get("v"))
  if (fromQuery) return fromQuery

  const [head, maybeId] = segments
  if (
    (head === "shorts" || head === "embed" || head === "live") &&
    maybeId
  ) {
    return normalizeVideoId(maybeId)
  }

  return null
}

/** Canonical watch URL used for oEmbed and enrich cache keys — not stored. */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export function youtubeThumbnailUrl(
  videoId: string,
  quality: YoutubeThumbnailQuality = "hqdefault"
): string {
  return `https://img.youtube.com/vi/${videoId}/${quality}.jpg`
}

/**
 * Immediate client-side preview image for a pasted YouTube URL.
 * Uses hqdefault (always present); server enrich may upgrade + mirror.
 */
export function youtubeOptimisticImageUrl(url: string): string | undefined {
  const id = parseYoutubeVideoId(url)
  if (!id) return undefined
  return youtubeThumbnailUrl(id, "hqdefault")
}
