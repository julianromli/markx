import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { createFixedWindowRateLimiter } from "@/lib/server/guest-guards"
import { enforceRateLimit } from "@/lib/server/guest-rate-limit"

export type CompressedImage = {
  base64: string
  mime: string
  width: number
  height: number
}

const MAX_DIMENSION = 1600
const AVIF_QUALITY = 50
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4

export const compressImageInputSchema = z
  .object({
    base64: z
      .string()
      .min(1, "Image data is required")
      .max(MAX_IMAGE_BASE64_LENGTH, "Image data exceeds the 20 MB upload limit")
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        "Image data must be valid base64"
      ),
    mime: z
      .string()
      .regex(/^image\/[a-z0-9.+-]+$/i, "MIME type must be an image"),
  })
  .strict()

const compressImageRateLimiter = createFixedWindowRateLimiter({
  limit: 10,
  windowMs: 60_000,
})

export const compressImage = createServerFn({ method: "POST" })
  .validator(compressImageInputSchema)
  .handler(async ({ data }): Promise<CompressedImage> => {
    enforceRateLimit(compressImageRateLimiter, "compressImage")

    const sharp = (await import("sharp")).default
    const buffer = Buffer.from(data.base64, "base64")

    const pipeline = sharp(buffer).rotate()

    const resized = pipeline.resize(MAX_DIMENSION, MAX_DIMENSION, {
      fit: "inside",
      withoutEnlargement: true,
    })

    const outputBuffer = await resized
      .avif({ quality: AVIF_QUALITY })
      .toBuffer()

    const outputMeta = await sharp(outputBuffer).metadata()

    return {
      base64: outputBuffer.toString("base64"),
      mime: "image/avif",
      width: outputMeta.width,
      height: outputMeta.height,
    }
  })
