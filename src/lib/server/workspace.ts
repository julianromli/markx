import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"
import { authMiddleware, requireUser } from "@/lib/auth/middleware"
import { markxStateSchema } from "@/lib/markx/schema"
import {
  importGuestWorkspaceForUser,
  loadWorkspaceForUser,
  overwriteWorkspaceForUser,
  saveWorkspaceForUser,
} from "@/lib/server/workspace.server"
import type {
  SaveResult,
  WorkspaceSnapshot,
} from "@/lib/server/workspace-helpers"

export type { SaveResult, WorkspaceSnapshot }

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
    return loadWorkspaceForUser(user.id)
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
    return saveWorkspaceForUser(user.id, data)
  })

/**
 * Import a guest workspace into the caller's cloud workspace on first
 * login. Only called once per device; the client tracks a flag in
 * IndexedDB so it does not re-import after the first successful sync.
 *
 * If the cloud already contains items, returns a conflict so the client can
 * prompt the user to choose. An empty cloud workspace is safe to replace
 * regardless of version (for example, after a failed first-login attempt).
 */
export const importGuestWorkspace = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ state: markxStateSchema }))
  .handler(async ({ data, context }): Promise<SaveResult> => {
    const user = requireUser(context)
    return importGuestWorkspaceForUser(user.id, data.state)
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
    })
  )
  .handler(async ({ data, context }): Promise<SaveResult> => {
    const user = requireUser(context)
    return overwriteWorkspaceForUser(user.id, data)
  })
