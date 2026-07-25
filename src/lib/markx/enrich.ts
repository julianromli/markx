import { createServerFn } from "@tanstack/react-start"
import ogs from "open-graph-scraper"
import type { ErrorResult, SuccessResult } from "open-graph-scraper/types"
import { z } from "zod"

import {
  createFixedWindowRateLimiter,
  isSafePublicHttpUrl,
} from "@/lib/server/guest-guards"
import { enforceRateLimit } from "@/lib/server/guest-rate-limit"
import type { LinkMetadata } from "./types"

export const MAX_ENRICH_URL_LENGTH = 2048

export const enrichLinkInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "URL is required")
      .max(
        MAX_ENRICH_URL_LENGTH,
        `URL must be at most ${MAX_ENRICH_URL_LENGTH} characters`
      )
      .url("URL must be valid")
      .refine(
        isSafePublicHttpUrl,
        "URL must use HTTP(S) and target a public host without credentials"
      ),
  })
  .strict()

const enrichLinkRateLimiter = createFixedWindowRateLimiter({
  limit: 30,
  windowMs: 60_000,
})

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

async function enrichFromOgs(url: string): Promise<LinkMetadata | null> {
  let data: SuccessResult | ErrorResult
  try {
    data = await ogs({
      url,
      timeout: 8,
      fetchOptions: {
        // Do not follow an otherwise-public URL to an unvalidated target.
        redirect: "error",
        headers: {
          "user-agent":
            "Mozilla/5.0 (compatible; markxBot/1.0; +https://markx.app) AppleWebKit/537.36",
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
        },
      },
    })
  } catch {
    return null
  }

  if (data.error) return null

  const { result } = data
  const imageUrl = result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url

  return {
    title: result.ogTitle || result.twitterTitle || hostnameTitle(url),
    description: result.ogDescription || result.twitterDescription,
    imageUrl,
    faviconUrl: result.favicon || faviconFor(url),
  }
}

async function enrichFromMicrolink(url: string): Promise<LinkMetadata | null> {
  try {
    const endpoint = new URL("https://api.microlink.io")
    endpoint.searchParams.set("url", url)
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const json: {
      status?: string
      data?: {
        title?: string
        description?: string
        image?: { url?: string } | string
      }
    } = await response.json()
    if (json.status !== "success" || !json.data) return null
    const image =
      typeof json.data.image === "string"
        ? json.data.image
        : json.data.image?.url
    return {
      title: json.data.title || hostnameTitle(url),
      description: json.data.description,
      imageUrl: image,
      faviconUrl: faviconFor(url),
    }
  } catch {
    return null
  }
}

export const enrichLink = createServerFn({ method: "POST" })
  .validator(enrichLinkInputSchema)
  .handler(async ({ data }): Promise<LinkMetadata> => {
    enforceRateLimit(enrichLinkRateLimiter, "enrichLink")

    const { url } = data
    const fallback: LinkMetadata = {
      title: hostnameTitle(url),
      faviconUrl: faviconFor(url),
    }

    const fromOgs = await enrichFromOgs(url)
    if (fromOgs?.imageUrl) return fromOgs

    const fromMicrolink = await enrichFromMicrolink(url)
    if (fromMicrolink?.imageUrl) {
      return {
        title: fromOgs?.title || fromMicrolink.title,
        description: fromOgs?.description || fromMicrolink.description,
        imageUrl: fromMicrolink.imageUrl,
        faviconUrl: fromOgs?.faviconUrl || fromMicrolink.faviconUrl,
      }
    }

    return fromOgs ?? fromMicrolink ?? fallback
  })
