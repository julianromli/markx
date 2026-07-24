import { createServerFn } from "@tanstack/react-start"
import { and, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "@/lib/db/client"
import { assets, workspaces } from "@/lib/db/schema"
import { authMiddleware, requireUser } from "@/lib/auth/middleware"
import { markxStateSchema } from "@/lib/markx/schema"
import type { MarkxState } from "@/lib/markx/types"

export type WorkspaceSnapshot = {
  id: string
  userId: string
  state: MarkxState
  version: number
  updatedAt: string
}

export type SaveResult =
  | { ok: true; version: number; updatedAt: string }
  | {
      ok: false
      reason: "conflict"
      cloudVersion: number
      cloudState: MarkxState
      cloudUpdatedAt: string
    }
  | { ok: false; reason: "error"; message: string }

const emptyState: MarkxState = {
  folders: [],
  bookmarks: [],
  notes: [],
  images: [],
  hasOnboarded: true,
  zCounter: 1,
}

/**
 * Load the caller's workspace. Creates an empty workspace row on first
 * login if one does not exist yet. Uses `onConflictDoNothing` so
 * concurrent first-login requests don't collide on the unique
 * `user_id` index.
 */
export const loadWorkspace = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<WorkspaceSnapshot | null> => {
    const user = requireUser(context)
    const { db, sql: sqlClient } = await getDb()

    try {
      // Idempotent insert — safe under concurrent first-login races.
      await db
        .insert(workspaces)
        .values({
          id: crypto.randomUUID(),
          userId: user.id,
          state: emptyState,
          version: 1,
        })
        .onConflictDoNothing()

      const [ws] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, user.id))
        .limit(1)

      if (!ws) return null

      return {
        id: ws.id,
        userId: ws.userId,
        state: ws.state as MarkxState,
        version: ws.version,
        updatedAt: ws.updatedAt.toISOString(),
      }
    } finally {
      await sqlClient.end()
    }
  })

const saveSchema = z.object({
  state: markxStateSchema,
  baseVersion: z.number().int().positive(),
  deletedImageIds: z.array(z.string()).optional(),
})

/**
 * Save the workspace with optimistic version control.
 *
 * The client sends `baseVersion` (the version it last loaded). The
 * server only updates if `workspaces.version = baseVersion`, atomically
 * incrementing to `baseVersion + 1` and soft-deleting any removed image
 * assets in the same transaction. If the cloud version has moved ahead
 * (another device saved), the update affects 0 rows and the server
 * returns a conflict with the current cloud state so the client can
 * prompt the user.
 */
export const saveWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(saveSchema)
  .handler(async ({ data, context }): Promise<SaveResult> => {
    const user = requireUser(context)
    const { db, sql: sqlClient } = await getDb()

    try {
      const txResult = await db.transaction(async (tx) => {
        const updated = await tx
          .update(workspaces)
          .set({
            state: data.state as MarkxState,
            version: data.baseVersion + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workspaces.userId, user.id),
              eq(workspaces.version, data.baseVersion),
            ),
          )
          .returning({
            version: workspaces.version,
            updatedAt: workspaces.updatedAt,
          })

        if (updated.length === 0) return null

        // Soft-delete removed image assets in the same transaction.
        if (data.deletedImageIds && data.deletedImageIds.length > 0) {
          await tx
            .update(assets)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(assets.userId, user.id),
                inArray(assets.id, data.deletedImageIds),
              ),
            )
        }

        return updated[0]
      })

      if (!txResult) {
        // Version mismatch — fetch current cloud state for conflict prompt.
        const [cloud] = await db
          .select()
          .from(workspaces)
          .where(eq(workspaces.userId, user.id))
          .limit(1)

        if (!cloud) {
          return { ok: false, reason: "error", message: "Workspace not found" }
        }

        return {
          ok: false,
          reason: "conflict",
          cloudVersion: cloud.version,
          cloudState: cloud.state as MarkxState,
          cloudUpdatedAt: cloud.updatedAt.toISOString(),
        }
      }

      return {
        ok: true,
        version: txResult.version,
        updatedAt: txResult.updatedAt.toISOString(),
      }
    } finally {
      await sqlClient.end()
    }
  })

/**
 * Import a guest workspace into the caller's cloud workspace on first
 * login. Only called once per device; the client tracks a flag in
 * IndexedDB so it does not re-import after the first successful sync.
 *
 * If the cloud already has data (version > 1), returns a conflict so
 * the client can prompt the user to choose.
 */
export const importGuestWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ state: markxStateSchema }))
  .handler(async ({ data, context }): Promise<SaveResult> => {
    const user = requireUser(context)
    const { db, sql: sqlClient } = await getDb()

    try {
      const [existing] = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, user.id))
        .limit(1)

      if (existing && existing.version > 1) {
        return {
          ok: false,
          reason: "conflict",
          cloudVersion: existing.version,
          cloudState: existing.state as MarkxState,
          cloudUpdatedAt: existing.updatedAt.toISOString(),
        }
      }

      const state = data.state as MarkxState

      if (!existing) {
        await db
          .insert(workspaces)
          .values({
            id: crypto.randomUUID(),
            userId: user.id,
            state,
            version: 2,
          })
          .onConflictDoNothing()
      } else {
        await db
          .update(workspaces)
          .set({ state, version: 2, updatedAt: new Date() })
          .where(eq(workspaces.id, existing.id))
      }

      return { ok: true, version: 2, updatedAt: new Date().toISOString() }
    } finally {
      await sqlClient.end()
    }
  })

/**
 * Resolve a conflict by overwriting the cloud with the local device's
 * state. The client must have already prompted the user and received
 * confirmation. Reads the current version, increments it, and
 * soft-deletes removed assets — all in one transaction.
 */
export const overwriteWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      state: markxStateSchema,
      deletedImageIds: z.array(z.string()).optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<SaveResult> => {
    const user = requireUser(context)
    const { db, sql: sqlClient } = await getDb()

    try {
      const txResult = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({ version: workspaces.version, id: workspaces.id })
          .from(workspaces)
          .where(eq(workspaces.userId, user.id))
          .limit(1)

        if (!current) {
          return { notFound: true as const, updated: undefined }
        }

        const [updated] = await tx
          .update(workspaces)
          .set({
            state: data.state as MarkxState,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(workspaces.id, current.id))
          .returning({
            version: workspaces.version,
            updatedAt: workspaces.updatedAt,
          })

        if (data.deletedImageIds && data.deletedImageIds.length > 0) {
          await tx
            .update(assets)
            .set({ deletedAt: new Date() })
            .where(
              and(
                eq(assets.userId, user.id),
                inArray(assets.id, data.deletedImageIds),
              ),
            )
        }

        return { notFound: false as const, updated }
      })

      if (txResult.notFound) {
        return { ok: false, reason: "error", message: "Workspace not found" }
      }

      return {
        ok: true,
        version: txResult.updated!.version,
        updatedAt: txResult.updated!.updatedAt.toISOString(),
      }
    } finally {
      await sqlClient.end()
    }
  })
