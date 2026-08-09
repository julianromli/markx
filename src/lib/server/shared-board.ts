import { createServerFn } from "@tanstack/react-start"
import { z } from "zod"

import { authMiddleware, requireUser } from "@/lib/auth/middleware"
import { markxStateSchema } from "@/lib/markx/schema"
import type {
  SharedBoardAccessView,
  SharedBoardSaveResult,
  SharedBoardSnapshot,
  SharedWithMeBoard,
} from "@/lib/markx/shared-board"
import {
  acceptEditorLinkForUser,
  createSharedBoardForUser,
  deleteSharedBoardForUser,
  duplicateSharedBoardToWorkspaceForUser,
  getSharedBoardAccessForUser,
  listMySharedBoardsForUser,
  listSharedWithMeForUser,
  loadSharedBoardByIdForCaller,
  loadSharedBoardSnapshotForCaller,
  regenerateLinkForUser,
  removeMemberForUser,
  saveSharedBoardForUser,
  updateLinkTogglesForUser,
} from "@/lib/server/shared-board.server"
import type {
  CreateSharedBoardResult,
} from "@/lib/server/shared-board.server"
import type { SaveResult } from "@/lib/server/workspace-helpers"

export type { CreateSharedBoardResult }

const createSchema = z.object({
  folderId: z.string(),
  title: z.string(),
})

/** Share a folder (owner only). No lift — the folder stays in the owner's workspace. */
export const createSharedBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(createSchema)
  .handler(async ({ data, context }): Promise<CreateSharedBoardResult> => {
    const user = requireUser(context)
    return createSharedBoardForUser(user.id, user.email, data)
  })

const tokenSchema = z.object({ token: z.string() })

/**
 * Load a shared board by token. Public: no login required for a view
 * token. An edit token returns `requiresLogin: true` when the caller is
 * not yet a member so the client can prompt login then accept.
 */
export const loadSharedBoardByToken = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(tokenSchema)
  .handler(async ({ data, context }): Promise<SharedBoardSnapshot | null> => {
    return loadSharedBoardSnapshotForCaller(data.token, context.user?.id ?? null)
  })

const boardIdOnlySchema = z.object({ boardId: z.string() })

/** Load a shared board by board id (owner/editor, authenticated). */
export const loadSharedBoardById = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(boardIdOnlySchema)
  .handler(async ({ data, context }): Promise<SharedBoardSnapshot | null> => {
    const user = requireUser(context)
    return loadSharedBoardByIdForCaller(user.id, data.boardId)
  })

const saveSchema = z.object({
  boardId: z.string(),
  state: markxStateSchema,
  baseVersion: z.number().int().positive(),
  deletedImageIds: z.array(z.string()).optional(),
})

/** Save a shared board with optimistic version control (owner/editor). */
export const saveSharedBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(saveSchema)
  .handler(async ({ data, context }): Promise<SharedBoardSaveResult> => {
    const user = requireUser(context)
    return saveSharedBoardForUser(user.id, data)
  })

/** Accept an edit link and become an editor member (logged-in caller). */
export const acceptEditorLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(tokenSchema)
  .handler(async ({ data, context }): Promise<{ boardId: string } | null> => {
    const user = requireUser(context)
    return acceptEditorLinkForUser(user.id, user.email, data.token)
  })

const duplicateSchema = z.object({
  token: z.string(),
  baseVersion: z.number().int().positive(),
})

/** Duplicate a shared board into the caller's workspace as a new folder. */
export const duplicateSharedBoardToWorkspace = createServerFn({
  method: "POST",
})
  .middleware([authMiddleware])
  .validator(duplicateSchema)
  .handler(async ({ data, context }): Promise<SaveResult> => {
    const user = requireUser(context)
    return duplicateSharedBoardToWorkspaceForUser(user.id, data.token, data.baseVersion)
  })

const boardIdSchema = z.object({ boardId: z.string() })

/** Manage-access view for the owner: the single link + members. */
export const getSharedBoardAccess = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(boardIdSchema)
  .handler(async ({ data, context }): Promise<SharedBoardAccessView | null> => {
    const user = requireUser(context)
    return getSharedBoardAccessForUser(user.id, data.boardId)
  })

/** Regenerate the single share link's token (owner). */
export const regenerateSharedBoardLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(boardIdSchema)
  .handler(async ({ data, context }): Promise<{ token: string } | null> => {
    const user = requireUser(context)
    return regenerateLinkForUser(user.id, data.boardId)
  })

const togglesSchema = z.object({
  boardId: z.string(),
  allowRead: z.boolean(),
  allowEdit: z.boolean(),
})

/** Update the single share link's read/edit toggles (owner). */
export const updateSharedBoardLinkToggles = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(togglesSchema)
  .handler(async ({ data, context }): Promise<boolean> => {
    const user = requireUser(context)
    return updateLinkTogglesForUser(user.id, data.boardId, data.allowRead, data.allowEdit)
  })

const removeMemberSchema = z.object({
  boardId: z.string(),
  memberUserId: z.string(),
})

/** Remove an editor member (owner). */
export const removeSharedBoardMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(removeMemberSchema)
  .handler(async ({ data, context }): Promise<boolean> => {
    const user = requireUser(context)
    return removeMemberForUser(user.id, data.boardId, data.memberUserId)
  })

const deleteSchema = z.object({
  boardId: z.string(),
})

/**
 * Unshare a board (owner only). The folder and its items stay in the
 * owner's workspace; only the sharing metadata is removed.
 */
export const deleteSharedBoard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(deleteSchema)
  .handler(async ({ data, context }) => {
    const user = requireUser(context)
    return deleteSharedBoardForUser(user.id, data.boardId)
  })

/** Boards shared with the caller (for the "shared with me" list). */
export const listSharedWithMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SharedWithMeBoard[]> => {
    const user = requireUser(context)
    return listSharedWithMeForUser(user.id)
  })

/** Boards owned by the caller (folderId → boardId, for "shared" folder badges). */
export const listMySharedBoards = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<{ folderId: string; boardId: string; title: string }[]> => {
      const user = requireUser(context)
      return listMySharedBoardsForUser(user.id)
    }
  )
