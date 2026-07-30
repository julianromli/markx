import ogs from "open-graph-scraper"
import type { ErrorResult, SuccessResult } from "open-graph-scraper/types"

import { fetchPublicHttp, withTimeout } from "@/lib/server/safe-fetch"
import {
  parseYoutubeVideoId,
  youtubeThumbnailUrl,
  youtubeWatchUrl,
} from "@/lib/markx/youtube"
import type { LinkMetadata } from "@/lib/markx/types"

export const ENRICH_PROVIDER_BUDGET_MS = 3_500
export const ENRICH_CACHE_TTL_MS = 10 * 60 * 1000

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"

type EnrichCacheEntry = {
  expiresAt: number
  value: LinkMetadata
}

/**
 * Isolate-local memo. Bounded (LRU) because the module scope lives as long as
 * the Workers isolate: without a cap, every unique URL ever enriched would
 * accumulate for the isolate's lifetime — expired entries are only dropped on
 * a cache read of that exact URL, so untouched URLs never get swept.
 */
const ENRICH_CACHE_MAX_ENTRIES = 500

const enrichCache = new Map<string, EnrichCacheEntry>()

/**
 * Concurrent enrich calls for the same URL share one scrape. Keyed by the
 * raw input URL; YouTube URL variants converge via the cache's dual writes.
 */
const enrichInFlight = new Map<string, Promise<LinkMetadata>>()

function hostnameTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

function faviconFor(url: string): string {
  try {
    const host = new URL(url).hostname
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`
  } catch {
    return ""
  }
}

/**
 * Scrapers often report favicon / og:image as a site-relative path
 * ("/favicon.ico", "/og.png"). Stored as-is it would later resolve against
 * our own origin and 404, so resolve it against the page and fall back when
 * that fails.
 */
export function absoluteUrl(
  value: string | undefined,
  pageUrl: string
): string | undefined {
  if (!value) return undefined
  try {
    const resolved = new URL(value, pageUrl)
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
      return undefined
    }
    return resolved.toString()
  } catch {
    return undefined
  }
}

export function absoluteFavicon(
  favicon: string | undefined,
  pageUrl: string
): string {
  return absoluteUrl(favicon, pageUrl) ?? faviconFor(pageUrl)
}

export function absoluteImageUrl(
  image: string | undefined,
  pageUrl: string
): string | undefined {
  return absoluteUrl(image, pageUrl)
}

function readEnrichCache(url: string): LinkMetadata | null {
  const entry = enrichCache.get(url)
  if (!entry) return null
  if (entry.expiresAt <= Date.now()) {
    enrichCache.delete(url)
    return null
  }
  // LRU touch: Map preserves insertion order, so re-insert on hit.
  enrichCache.delete(url)
  enrichCache.set(url, entry)
  return entry.value
}

function writeEnrichCache(url: string, value: LinkMetadata): void {
  enrichCache.delete(url)
  enrichCache.set(url, {
    expiresAt: Date.now() + ENRICH_CACHE_TTL_MS,
    value,
  })
  while (enrichCache.size > ENRICH_CACHE_MAX_ENTRIES) {
    const oldest = enrichCache.keys().next().value
    if (oldest === undefined) break
    enrichCache.delete(oldest)
  }
}

/** Test seam — clears the isolate-local enrich memo. */
export function clearEnrichCache(): void {
  enrichCache.clear()
}

function pickImageUrl(
  images:
    | Array<{ url?: string; secureUrl?: string } | undefined>
    | undefined
): string | undefined {
  if (!images?.length) return undefined
  for (const image of images) {
    if (!image) continue
    const candidate = image.secureUrl || image.url
    if (candidate) return candidate
  }
  return undefined
}

async function enrichFromOgs(url: string): Promise<LinkMetadata | null> {
  let html: string
  let finalUrl = url
  try {
    const fetched = await fetchPublicHttp(url, {
      timeoutMs: ENRICH_PROVIDER_BUDGET_MS,
      maxRedirects: 5,
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    })
    const { response } = fetched
    finalUrl = fetched.finalUrl
    if (!response.ok) return null
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml")
    ) {
      void response.body?.cancel()
      return null
    }
    html = await response.text()
  } catch {
    return null
  }

  let data: SuccessResult | ErrorResult
  try {
    // Pass HTML we already fetched with safe redirects. open-graph-scraper
    // rejects combining `url` + `html`, so absolutize media against finalUrl.
    data = await ogs({ html })
  } catch {
    return null
  }

  if (data.error) return null

  const { result } = data
  const rawImage =
    pickImageUrl(result.ogImage) || pickImageUrl(result.twitterImage)

  return {
    title: result.ogTitle || result.twitterTitle || hostnameTitle(url),
    description: result.ogDescription || result.twitterDescription,
    imageUrl: absoluteImageUrl(rawImage, finalUrl),
    faviconUrl: absoluteFavicon(result.favicon, finalUrl),
  }
}

async function enrichFromMicrolink(url: string): Promise<LinkMetadata | null> {
  try {
    const endpoint = new URL("https://api.microlink.io")
    endpoint.searchParams.set("url", url)
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(ENRICH_PROVIDER_BUDGET_MS),
      headers: { "user-agent": BROWSER_UA },
    })
    if (!response.ok) return null
    const json: {
      status?: string
      data?: {
        title?: string
        description?: string
        image?: { url?: string } | string
        logo?: { url?: string } | string
      }
    } = await response.json()
    if (json.status !== "success" || !json.data) return null
    const image =
      typeof json.data.image === "string"
        ? json.data.image
        : json.data.image?.url
    const logo =
      typeof json.data.logo === "string" ? json.data.logo : json.data.logo?.url
    return {
      title: json.data.title || hostnameTitle(url),
      description: json.data.description,
      imageUrl: absoluteImageUrl(image || logo, url),
      faviconUrl: faviconFor(url),
    }
  } catch {
    return null
  }
}

function mergeMetadata(
  primary: LinkMetadata | null,
  secondary: LinkMetadata | null,
  url: string
): LinkMetadata {
  const fallback: LinkMetadata = {
    title: hostnameTitle(url),
    faviconUrl: faviconFor(url),
  }
  if (!primary && !secondary) return fallback

  const a = primary
  const b = secondary
  // Prefer whichever source actually found a preview image; fill gaps from
  // the other. Title/description prefer the primary (OGS) when present.
  const withImage = a?.imageUrl ? a : b?.imageUrl ? b : a ?? b
  return {
    title: a?.title || b?.title || fallback.title,
    description: a?.description || b?.description,
    imageUrl: withImage?.imageUrl,
    faviconUrl: a?.faviconUrl || b?.faviconUrl || fallback.faviconUrl,
  }
}

async function fetchYoutubeOembedTitle(
  watchUrl: string
): Promise<string | null> {
  try {
    const endpoint = new URL("https://www.youtube.com/oembed")
    endpoint.searchParams.set("url", watchUrl)
    endpoint.searchParams.set("format", "json")
    const { response } = await fetchPublicHttp(endpoint.toString(), {
      timeoutMs: ENRICH_PROVIDER_BUDGET_MS,
      headers: {
        accept: "application/json",
        "user-agent": BROWSER_UA,
      },
    })
    if (!response.ok) {
      void response.body?.cancel()
      return null
    }
    const json: { title?: string } = await response.json()
    const title = json.title?.trim()
    return title || null
  } catch {
    return null
  }
}

/**
 * Prefer maxres when the CDN serves it; hqdefault always exists for valid ids.
 */
async function resolveYoutubeThumbnailUrl(videoId: string): Promise<string> {
  const maxres = youtubeThumbnailUrl(videoId, "maxresdefault")
  const hq = youtubeThumbnailUrl(videoId, "hqdefault")
  try {
    const { response } = await fetchPublicHttp(maxres, {
      timeoutMs: ENRICH_PROVIDER_BUDGET_MS,
      headers: { "user-agent": BROWSER_UA },
    })
    // Missing maxres is usually 404; some edges return a tiny placeholder.
    const length = Number(response.headers.get("content-length") || 0)
    const usable =
      response.ok && (length === 0 || length > 5_000)
    void response.body?.cancel()
    if (usable) return maxres
  } catch {
    // Fall through to hqdefault.
  }
  return hq
}

async function mirrorImageUrl(imageUrl: string): Promise<string> {
  try {
    // Dynamic import keeps the enrich module testable without Cloudflare
    // bindings in the Vitest graph.
    const { mirrorOgImageToR2 } = await import("@/lib/server/og-preview")
    const mirrored = await mirrorOgImageToR2(imageUrl)
    return mirrored || imageUrl
  } catch {
    // Keep the remote hotlink if mirroring fails — better than no preview.
    return imageUrl
  }
}

async function enrichYoutube(
  url: string,
  videoId: string
): Promise<LinkMetadata> {
  const watchUrl = youtubeWatchUrl(videoId)
  const cached =
    readEnrichCache(url) ?? readEnrichCache(watchUrl)
  if (cached) return cached

  const [title, imageUrl] = await Promise.all([
    withTimeout(fetchYoutubeOembedTitle(watchUrl), ENRICH_PROVIDER_BUDGET_MS),
    withTimeout(
      resolveYoutubeThumbnailUrl(videoId),
      ENRICH_PROVIDER_BUDGET_MS
    ).then((resolved) => resolved ?? youtubeThumbnailUrl(videoId, "hqdefault")),
  ])

  const meta: LinkMetadata = {
    title: title || hostnameTitle(url),
    imageUrl: await mirrorImageUrl(imageUrl),
    faviconUrl: faviconFor(url),
  }

  writeEnrichCache(watchUrl, meta)
  writeEnrichCache(url, meta)
  return meta
}

async function scrapeAndMirror(url: string): Promise<LinkMetadata> {
  const videoId = parseYoutubeVideoId(url)
  if (videoId) return enrichYoutube(url, videoId)

  const [fromOgs, fromMicrolink] = await Promise.all([
    withTimeout(enrichFromOgs(url), ENRICH_PROVIDER_BUDGET_MS),
    withTimeout(enrichFromMicrolink(url), ENRICH_PROVIDER_BUDGET_MS),
  ])

  const merged = mergeMetadata(fromOgs, fromMicrolink, url)

  if (merged.imageUrl) {
    merged.imageUrl = await mirrorImageUrl(merged.imageUrl)
  }

  writeEnrichCache(url, merged)
  return merged
}

export async function enrichAndMirror(url: string): Promise<LinkMetadata> {
  const videoId = parseYoutubeVideoId(url)
  const cached =
    readEnrichCache(url) ??
    (videoId ? readEnrichCache(youtubeWatchUrl(videoId)) : null)
  if (cached) return cached

  // Coalesce concurrent calls for the same URL into one scrape; otherwise
  // N bookmarks sharing a URL (or a retry burst) each burn a full provider
  // budget before the first result lands in the cache.
  const inFlight = enrichInFlight.get(url)
  if (inFlight) return inFlight

  const promise = scrapeAndMirror(url).finally(() => {
    enrichInFlight.delete(url)
  })
  enrichInFlight.set(url, promise)
  return promise
}
