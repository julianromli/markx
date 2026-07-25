import { and, eq, inArray, isNotNull, lt } from "drizzle-orm"

import { decodeDataUrl, encodeDataUrl } from "@/lib/data-url"
import { withDb } from "@/lib/db/client"
import type { Database } from "@/lib/db/client"
import { assets } from "@/lib/db/schema"
import {
  ASSET_CLEANUP_CONCURRENCY,
  ASSET_RETENTION_DAYS,
  assetKey,
  mapWithConcurrency,
} from "@/lib/server/asset-helpers"

type AssetMutationDb = Pick<Database, "update">

export async function softDeleteAssetRows(
  db: AssetMutationDb,
  userId: string,
  imageIds: string[] | undefined
): Promise<void> {
  if (!imageIds || imageIds.length === 0) return

  await db
    .update(assets)
    .set({ deletedAt: new Date() })
    .where(and(eq(assets.userId, userId), inArray(assets.id, imageIds)))
}

export async function cleanupExpiredAssets(): Promise<void> {
  const { env } = await import("cloudflare:workers")

  await withDb(async ({ db }) => {
    const cutoff = new Date(
      Date.now() - ASSET_RETENTION_DAYS * 24 * 60 * 60 * 1000
    )
    const expired = await db
      .select({ id: assets.id, objectKey: assets.objectKey })
      .from(assets)
      .where(and(isNotNull(assets.deletedAt), lt(assets.deletedAt, cutoff)))

    const deletedIds = (
      await mapWithConcurrency(
        expired,
        ASSET_CLEANUP_CONCURRENCY,
        async (row) => {
          try {
            await env.MARKX_BUCKET.delete(row.objectKey)
            return row.id
          } catch (error) {
            console.error(
              `[asset cleanup] failed to delete ${row.objectKey}`,
              error
            )
            return null
          }
        }
      )
    ).filter((id): id is string => id !== null)

    if (deletedIds.length > 0) {
      await db
        .delete(assets)
        .where(
          and(
            inArray(assets.id, deletedIds),
            isNotNull(assets.deletedAt),
            lt(assets.deletedAt, cutoff)
          )
        )
    }
  })
}

export async function uploadImageAssetForUser(
  userId: string,
  input: { imageId: string; mime: string; dataUrl: string }
) {
  let decoded: ReturnType<typeof decodeDataUrl>
  try {
    decoded = decodeDataUrl(input.dataUrl)
  } catch {
    return { ok: false as const, reason: "invalid_data_url" as const }
  }
  if (decoded.mime !== input.mime) {
    return { ok: false as const, reason: "mime_mismatch" as const }
  }

  const objectKey = assetKey(userId, input.imageId)
  const { env } = await import("cloudflare:workers")

  return withDb(async ({ db }) => {
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(assets)
        .values({
          id: input.imageId,
          userId,
          objectKey,
          mime: input.mime,
        })
        .onConflictDoNothing()
        .returning({ id: assets.id })

      if (inserted.length === 0) {
        const existingRows = await tx
          .select({
            userId: assets.userId,
            objectKey: assets.objectKey,
          })
          .from(assets)
          .where(eq(assets.id, input.imageId))
          .limit(1)

        if (existingRows.length === 0) {
          return { ok: false as const, reason: "image_id_conflict" as const }
        }
        const existing = existingRows[0]
        if (existing.userId !== userId || existing.objectKey !== objectKey) {
          return { ok: false as const, reason: "image_id_conflict" as const }
        }
      }

      try {
        await env.MARKX_BUCKET.put(objectKey, decoded.bytes, {
          httpMetadata: { contentType: input.mime },
        })

        await tx
          .update(assets)
          .set({ mime: input.mime, deletedAt: null })
          .where(and(eq(assets.id, input.imageId), eq(assets.userId, userId)))

        return { ok: true as const, imageId: input.imageId, objectKey }
      } catch (error) {
        // The transaction rolls back a newly inserted reservation. Remove
        // the corresponding object while competing inserts are still blocked.
        if (inserted.length > 0) {
          try {
            await env.MARKX_BUCKET.delete(objectKey)
          } catch (cleanupError) {
            console.error(
              `[asset upload] failed to compensate ${objectKey}`,
              cleanupError
            )
          }
        }
        throw error
      }
    })
  })
}

export async function fetchImageAssetForUser(userId: string, imageId: string) {
  const { env } = await import("cloudflare:workers")

  return withDb(async ({ db }) => {
    const ownedRows = await db
      .select({ mime: assets.mime, deletedAt: assets.deletedAt })
      .from(assets)
      .where(and(eq(assets.id, imageId), eq(assets.userId, userId)))
      .limit(1)

    if (ownedRows.length === 0 || ownedRows[0].deletedAt !== null) {
      return { ok: false as const, reason: "not_found" as const }
    }
    const owned = ownedRows[0]

    const object = await env.MARKX_BUCKET.get(assetKey(userId, imageId))
    if (!object) {
      return { ok: false as const, reason: "not_found" as const }
    }

    const mime = object.httpMetadata?.contentType ?? owned.mime
    const bytes = new Uint8Array(await object.arrayBuffer())
    return {
      ok: true as const,
      dataUrl: encodeDataUrl(bytes, mime),
      mime,
    }
  })
}
