import type { Bookmark, LinkMetadata } from "./types"
import { parseBookmarkUrl } from "./board-items"
import { youtubeOptimisticImageUrl } from "./youtube"

export function applyBookmarkMetadata(
  bookmark: Bookmark,
  metadata: LinkMetadata
): Bookmark {
  return {
    ...bookmark,
    title: metadata.title || bookmark.title,
    description: metadata.description ?? bookmark.description,
    imageUrl: metadata.imageUrl ?? bookmark.imageUrl,
    faviconUrl: metadata.faviconUrl || bookmark.faviconUrl,
    enrichStatus: "done",
  }
}

/**
 * Optimistic bookmark the client and the extension endpoint both create
 * before OG enrich lands. Title is the host; YouTube gets a thumbnail
 * immediately. `enrichStatus` stays pending until metadata is applied.
 */
export function buildOptimisticBookmark(input: {
  id: string
  folderId: string
  url: string
  x: number
  y: number
  z: number
  highlight?: boolean
}): Bookmark | null {
  const parsed = parseBookmarkUrl(input.url)
  if (!parsed.ok) return null
  const host = parsed.host
  const optimisticImage = youtubeOptimisticImageUrl(parsed.url)
  return {
    id: input.id,
    folderId: input.folderId,
    url: parsed.url,
    title: host.replace(/^www\./, ""),
    faviconUrl: `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
    ...(optimisticImage ? { imageUrl: optimisticImage } : {}),
    enrichStatus: "pending",
    x: input.x,
    y: input.y,
    z: input.z,
    ...(input.highlight ? { highlight: true } : {}),
  }
}
