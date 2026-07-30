import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import {
  createFixedWindowRateLimiter,
  isSafePublicHttpUrl,
} from "@/lib/server/guest-guards"
import { enforceRateLimit } from "@/lib/server/guest-rate-limit"
import { enrichAndMirror } from "@/lib/server/enrich.server"
import type { LinkMetadata } from "./types"

/**
 * The client store imports this module for `enrichLink`, so everything the
 * browser can reach from here ships in the client bundle. The scraper
 * implementation (open-graph-scraper → undici → Node globals) lives in
 * `enrich.server.ts` and must only ever be reachable from inside a
 * `.handler()` body, which the Start plugin strips from the client build.
 * Re-exporting anything from there — even "just for tests" — puts Node-only
 * code in the browser bundle, where it throws at module init and kills
 * hydration before the app renders.
 */

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

export const enrichLink = createServerFn({ method: "POST" })
  .validator(enrichLinkInputSchema)
  .handler(async ({ data }): Promise<LinkMetadata> => {
    enforceRateLimit(enrichLinkRateLimiter, "enrichLink")
    return enrichAndMirror(data.url)
  })
