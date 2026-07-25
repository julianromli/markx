import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authMiddleware, requireUser } from "@/lib/auth/middleware"
import {
  fetchImageAssetForUser,
  uploadImageAssetForUser,
} from "@/lib/server/assets.server"

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
    return uploadImageAssetForUser(user.id, data)
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
    return fetchImageAssetForUser(user.id, data.imageId)
  })
