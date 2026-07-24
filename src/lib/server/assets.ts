import { createServerFn } from "@tanstack/react-start"
import { and, eq, inArray, isNotNull, lt } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/lib/db/client"
import { assets } from "@/lib/db/schema"
import { authMiddleware, requireUser } from "@/lib/auth/middleware"

export const ASSET_RETENTION_DAYS = 7

/**
 * Build the R2 object key for a user-scoped image.
 * Keys are `users/{userId}/images/{imageId}` so owner isolation is
 * enforced at the key prefix level, not just at the DB query level.
 */
export function assetKey(userId: string, imageId: string): string {
  return `users/${userId}/images/${imageId}`
}

/**
 * Soft-delete assets: mark `deleted_at` in Postgres but keep the R2
 * objects for 7 days so Undo/recovery can restore them. The cron
 * trigger hard-deletes expired objects.
 */
export async function softDeleteAssets(
  userId: string,
  imageIds: string[],
): Promise<void> {
  if (imageIds.length === 0) return
  const { db, sql } = await getDb()

  try {
    await db
      .update(assets)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(assets.userId, userId),
          inArray(assets.id, imageIds),
        ),
      )
  } finally {
    await sql.end()
  }
}

/**
 * Restore soft-deleted assets (Undo support). Clears `deleted_at` and
 * keeps the R2 objects intact.
 */
export async function restoreAssets(
  userId: string,
  imageIds: string[],
): Promise<void> {
  if (imageIds.length === 0) return
  const { db, sql } = await getDb()

  try {
    await db
      .update(assets)
      .set({ deletedAt: null })
      .where(
        and(eq(assets.userId, userId), inArray(assets.id, imageIds)),
      )
  } finally {
    await sql.end()
  }
}

/**
 * Cron-triggered cleanup: hard-delete R2 objects whose soft-delete
 * timestamp is older than `ASSET_RETENTION_DAYS`, then remove the DB
 * rows. Called daily at 03:00 UTC from `src/server.ts`.
 */
export async function cleanupExpiredAssets(): Promise<void> {
  const { env } = await import("cloudflare:workers")
  const { db, sql } = await getDb()

  try {
    const cutoff = new Date(
      Date.now() - ASSET_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    )

    const expired = await db
      .select({
        id: assets.id,
        objectKey: assets.objectKey,
        userId: assets.userId,
      })
      .from(assets)
      .where(and(isNotNull(assets.deletedAt), lt(assets.deletedAt, cutoff)))

    for (const row of expired) {
      await env.MARKX_BUCKET.delete(row.objectKey)
    }

    if (expired.length > 0) {
      await db
        .delete(assets)
        .where(
          and(isNotNull(assets.deletedAt), lt(assets.deletedAt, cutoff)),
        )
    }
  } finally {
    await sql.end()
  }
}

const uploadSchema = z.object({
  imageId: z.string().min(1),
  mime: z.string().min(1),
  // Base64-encoded image bytes. Server functions serialize JSON, so we
  // transport binary as a data URL string and decode on the server. This
  // keeps the boundary simple and avoids multipart handling in the RPC
  // layer; the client converts the Blob before calling.
  dataUrl: z.string().min(1),
})

/**
 * Upload an image to private R2 on behalf of the authenticated caller.
 *
 * The client encodes the `Blob` as a data URL (`data:<mime>;base64,...`).
 * We decode it here, stream the raw bytes into R2 under the caller's
 * user-scoped key, and record the asset row. Owner isolation is enforced
 * both by the JWT-derived `userId` and the `users/{userId}/images/...`
 * key prefix.
 */
export const uploadImageAsset = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(uploadSchema)
  .handler(async ({ data, context }) => {
    const user = requireUser(context)
    const objectKey = assetKey(user.id, data.imageId)
    const { env } = await import("cloudflare:workers")
    const { db, sql } = await getDb()

    try {
      // Decode the data URL into raw bytes.
      const match = /^data:([^;]+);base64,(.*)$/s.exec(data.dataUrl)
      if (!match) {
        return {
          ok: false as const,
          reason: "invalid_data_url" as const,
        }
      }
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0))

      await env.MARKX_BUCKET.put(objectKey, bytes, {
        httpMetadata: { contentType: data.mime },
      })

      await db
        .insert(assets)
        .values({
          id: data.imageId,
          userId: user.id,
          objectKey,
          mime: data.mime,
        })
        .onConflictDoNothing()

      return {
        ok: true as const,
        imageId: data.imageId,
        objectKey,
      }
    } finally {
      await sql.end()
    }
  })

const fetchSchema = z.object({ imageId: z.string().min(1) })

/**
 * Fetch an image blob from private R2 on behalf of the authenticated
 * caller.
 *
 * Returns the image as a data URL so the client can cache it in
 * IndexedDB and render it via a standard `<img src>`. The Worker verifies
 * the JWT, checks that the asset belongs to the caller, and only then
 * reads from R2 — the browser never touches the bucket binding directly.
 */
export const fetchImageAsset = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(fetchSchema)
  .handler(async ({ data, context }) => {
    const user = requireUser(context)
    const { env } = await import("cloudflare:workers")
    const { db, sql } = await getDb()

    try {
      // Verify ownership before reading from R2.
      const owned = await db
        .select({ mime: assets.mime, deletedAt: assets.deletedAt })
        .from(assets)
        .where(and(eq(assets.id, data.imageId), eq(assets.userId, user.id)))
        .limit(1)

      if (owned.length === 0 || owned[0].deletedAt !== null) {
        return { ok: false as const, reason: "not_found" as const }
      }

      const objectKey = assetKey(user.id, data.imageId)
      const object = await env.MARKX_BUCKET.get(objectKey)
      if (!object) {
        return { ok: false as const, reason: "not_found" as const }
      }

      const mime =
        object.httpMetadata?.contentType ??
        owned[0].mime ??
        "application/octet-stream"
      const buffer = await object.arrayBuffer()
      const base64 = arrayBufferToBase64(buffer)

      return {
        ok: true as const,
        dataUrl: `data:${mime};base64,${base64}`,
        mime,
      }
    } finally {
      await sql.end()
    }
  })

/**
 * Encode an ArrayBuffer to a base64 string without spreading the entire
 * byte array as function arguments (which would overflow the call stack
 * for large buffers). Processes in 8 KiB chunks.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize)
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}
