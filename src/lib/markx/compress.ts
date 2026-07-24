import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

export type CompressedImage = {
  base64: string
  mime: string
  width: number
  height: number
}

const MAX_DIMENSION = 1600
const AVIF_QUALITY = 50

export const compressImage = createServerFn({ method: "POST" })
  .validator(
    z.object({
      base64: z.string(),
      mime: z.string(),
    }),
  )
  .handler(async ({ data }): Promise<CompressedImage> => {
    const sharp = (await import("sharp")).default
    const buffer = Buffer.from(data.base64, "base64")

    const pipeline = sharp(buffer).rotate()

    const metadata = await pipeline.metadata()
    const originalWidth = metadata.width ?? 0
    const originalHeight = metadata.height ?? 0

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
      width: outputMeta.width ?? originalWidth,
      height: outputMeta.height ?? originalHeight,
    }
  })
