import { and, eq, inArray } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import {
  assets,
  sharedBoardLinks,
  sharedBoardMembers,
  sharedBoards,
  workspaces,
} from "@/lib/db/schema"
import type { MarkxState } from "@/lib/markx/types"
import type {
  SharedBoardAccess,
  SharedBoardAccessView,
  SharedBoardLinkInfo,
  SharedBoardMemberInfo,
  SharedBoardRole,
  SharedBoardSaveResult,
  SharedBoardSnapshot,
  SharedWithMeBoard,
} from "@/lib/markx/shared-board"
import {
  assertWorkspaceEntityLimit,
  getEntitlementsForUser,
} from "@/lib/server/subscription.server"
import { assetKey } from "@/lib/server/asset-helpers"
import {
  parseWorkspaceState,
  toConflictResult,
} from "@/lib/server/workspace-helpers"
import type { SaveResult } from "@/lib/server/workspace-helpers"

export function generateShareToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function extractSlice(state: MarkxState, folderId: string): MarkxState {
  return {
    folders: state.folders.filter((f) => f.id === folderId),
    bookmarks: state.bookmarks.filter((b) => b.folderId === folderId),
    notes: state.notes.filter((n) => n.folderId === folderId),
    images: state.images.filter((i) => i.folderId === folderId),
    hasOnboarded: true,
    zCounter: state.zCounter,
  }
}

async function loadBoardByToken(token: string) {
  return withDb(async ({ db }) => {
    const linkRows = await db
      .select()
      .from(sharedBoardLinks)
      .where(eq(sharedBoardLinks.token, token))
      .limit(1)
    const link = linkRows.at(0)
    // No link, or both toggles off → link grants nothing.
    if (!link || (!link.allowRead && !link.allowEdit)) return null
    const boardRows = await db
      .select()
      .from(sharedBoards)
      .where(eq(sharedBoards.id, link.boardId))
      .limit(1)
    const board = boardRows.at(0)
    if (!board) return null
    return { board, link }
  })
}

async function loadBoardSlice(boardId: string): Promise<{
  board: typeof sharedBoards.$inferSelect
  slice: MarkxState
  workspaceVersion: number
  updatedAt: string
} | null> {
  return withDb(async ({ db }) => {
    const boardRows = await db
      .select()
      .from(sharedBoards)
      .where(eq(sharedBoards.id, boardId))
      .limit(1)
    const board = boardRows.at(0)
    if (!board) return null
    const wsRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, board.ownerUserId))
      .limit(1)
    const workspace = wsRows.at(0)
    if (!workspace) return null
    return {
      board,
      slice: extractSlice(parseWorkspaceState(workspace.state), board.folderId),
      workspaceVersion: workspace.version,
      updatedAt: workspace.updatedAt.toISOString(),
    }
  })
}

export type CreateSharedBoardResult =
  | { ok: true; boardId: string; token: string }
  | { ok: false; reason: "folder_not_found" }
  | { ok: false; reason: "already_shared" }
  | { ok: false; reason: "error"; message: string }

export async function createSharedBoardForUser(
  userId: string,
  ownerEmail: string,
  input: { folderId: string; title: string }
): Promise<CreateSharedBoardResult> {
  const boardId = crypto.randomUUID()
  const token = generateShareToken()

  return withDb(async ({ db }) => {
    const wsRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, userId))
      .limit(1)
    const workspace = wsRows.at(0)
    if (!workspace) {
      return { ok: false, reason: "error", message: "Workspace not found" }
    }
    const state = parseWorkspaceState(workspace.state)
    if (!state.folders.some((f) => f.id === input.folderId)) {
      return { ok: false, reason: "folder_not_found" }
    }
    const existing = await db
      .select({ id: sharedBoards.id })
      .from(sharedBoards)
      .where(
        and(
          eq(sharedBoards.ownerUserId, userId),
          eq(sharedBoards.folderId, input.folderId)
        )
      )
      .limit(1)
    if (existing.length > 0) {
      return { ok: false, reason: "already_shared" }
    }

    await db.insert(sharedBoards).values({
      id: boardId,
      ownerUserId: userId,
      ownerEmail,
      folderId: input.folderId,
      title: input.title,
      version: 1,
    })
    await db.insert(sharedBoardLinks).values({
      id: crypto.randomUUID(),
      boardId,
      token,
      allowRead: true,
      allowEdit: false,
    })
    return { ok: true, boardId, token }
  })
}

export async function loadSharedBoardSnapshotForCaller(
  token: string,
  callerUserId: string | null
): Promise<SharedBoardSnapshot | null> {
  const loaded = await loadBoardByToken(token)
  if (!loaded) return null
  const { board, link } = loaded
  const slice = await loadBoardSlice(board.id)
  if (!slice) return null

  let role: SharedBoardRole | null = null
  if (callerUserId) {
    if (callerUserId === board.ownerUserId) {
      role = "owner"
    } else {
      const memberRows = await withDb(async ({ db }) =>
        db
          .select({ role: sharedBoardMembers.role })
          .from(sharedBoardMembers)
          .where(
            and(
              eq(sharedBoardMembers.boardId, board.id),
              eq(sharedBoardMembers.userId, callerUserId)
            )
          )
          .limit(1)
      )
      if (memberRows.length > 0) role = "editor"
    }
  }

  const access: SharedBoardAccess = link.allowEdit ? "edit" : "view"

  return {
    boardId: board.id,
    title: board.title,
    state: slice.slice,
    version: board.version,
    updatedAt: slice.updatedAt,
    access,
    requiresLogin: access === "edit" && role === null,
    role,
  }
}

export async function loadSharedBoardByIdForCaller(
  callerUserId: string,
  boardId: string
): Promise<SharedBoardSnapshot | null> {
  const slice = await loadBoardSlice(boardId)
  if (!slice) return null
  const board = slice.board

  let role: SharedBoardRole | null = null
  if (callerUserId === board.ownerUserId) {
    role = "owner"
  } else {
    const memberRows = await withDb(async ({ db }) =>
      db
        .select({ role: sharedBoardMembers.role })
        .from(sharedBoardMembers)
        .where(
          and(
            eq(sharedBoardMembers.boardId, boardId),
            eq(sharedBoardMembers.userId, callerUserId)
          )
        )
        .limit(1)
    )
    if (memberRows.length > 0) role = "editor"
  }
  if (!role) return null

  return {
    boardId: board.id,
    title: board.title,
    state: slice.slice,
    version: board.version,
    updatedAt: slice.updatedAt,
    access: "edit",
    requiresLogin: false,
    role,
  }
}

export async function saveSharedBoardForUser(
  userId: string,
  input: {
    boardId: string
    state: MarkxState
    baseVersion: number
    deletedImageIds?: string[]
  }
): Promise<SharedBoardSaveResult> {
  return withDb(async ({ db }) => {
    const boardRows = await db
      .select()
      .from(sharedBoards)
      .where(eq(sharedBoards.id, input.boardId))
      .limit(1)
    const board = boardRows.at(0)
    if (!board) {
      return { ok: false, reason: "error", message: "Board not found" }
    }

    const isOwner = board.ownerUserId === userId
    if (!isOwner) {
      const memberRows = await db
        .select()
        .from(sharedBoardMembers)
        .where(
          and(
            eq(sharedBoardMembers.boardId, input.boardId),
            eq(sharedBoardMembers.userId, userId)
          )
        )
        .limit(1)
      if (memberRows.length === 0) {
        return { ok: false, reason: "error", message: "Not an editor" }
      }
    }

    if (board.version !== input.baseVersion) {
      const slice = await loadBoardSlice(board.id)
      return slice
        ? {
            ok: false,
            reason: "conflict",
            cloudVersion: board.version,
            cloudState: slice.slice,
            cloudUpdatedAt: slice.updatedAt,
          }
        : { ok: false, reason: "error", message: "Board not found" }
    }

    const entitlements = await getEntitlementsForUser(board.ownerUserId, input.state)
    const limit = assertWorkspaceEntityLimit(entitlements, input.state)
    if (!limit.ok) {
      return {
        ok: false,
        reason: "entity_limit",
        entityCount: limit.count,
        limit: limit.limit,
        message: `Free plan is limited to ${limit.limit} items. Upgrade to Pro or remove items.`,
      }
    }

    const wsRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, board.ownerUserId))
      .limit(1)
    const workspace = wsRows.at(0)
    if (!workspace) {
      return { ok: false, reason: "error", message: "Workspace not found" }
    }
    const ownerState = parseWorkspaceState(workspace.state)
    const folderId = board.folderId
    const newState: MarkxState = {
      folders: ownerState.folders.map((f) =>
        f.id === folderId
          ? input.state.folders.find((sf) => sf.id === folderId) ?? f
          : f
      ),
      bookmarks: [
        ...ownerState.bookmarks.filter((b) => b.folderId !== folderId),
        ...input.state.bookmarks,
      ],
      notes: [
        ...ownerState.notes.filter((n) => n.folderId !== folderId),
        ...input.state.notes,
      ],
      images: [
        ...ownerState.images.filter((i) => i.folderId !== folderId),
        ...input.state.images,
      ],
      hasOnboarded: ownerState.hasOnboarded,
      zCounter: Math.max(ownerState.zCounter, input.state.zCounter),
    }

    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(workspaces)
        .set({ state: newState, version: workspace.version + 1, updatedAt: new Date() })
        .where(
          and(
            eq(workspaces.userId, board.ownerUserId),
            eq(workspaces.version, workspace.version)
          )
        )
        .returning({ version: workspaces.version })
      if (rows.length === 0) return null
      await tx
        .update(sharedBoards)
        .set({ version: board.version + 1, updatedAt: new Date() })
        .where(eq(sharedBoards.id, input.boardId))
      return rows[0]
    })

    if (!updated) {
      const slice = await loadBoardSlice(board.id)
      return slice
        ? {
            ok: false,
            reason: "conflict",
            cloudVersion: board.version,
            cloudState: slice.slice,
            cloudUpdatedAt: slice.updatedAt,
          }
        : { ok: false, reason: "error", message: "Workspace not found" }
    }

    return {
      ok: true,
      version: board.version + 1,
      updatedAt: new Date().toISOString(),
    }
  })
}

export async function acceptEditorLinkForUser(
  userId: string,
  email: string,
  token: string
): Promise<{ boardId: string } | null> {
  return withDb(async ({ db }) => {
    const linkRows = await db
      .select()
      .from(sharedBoardLinks)
      .where(eq(sharedBoardLinks.token, token))
      .limit(1)
    const link = linkRows.at(0)
    if (!link || !link.allowEdit) return null
    await db
      .insert(sharedBoardMembers)
      .values({ boardId: link.boardId, userId, email, role: "editor" })
      .onConflictDoUpdate({
        target: [sharedBoardMembers.boardId, sharedBoardMembers.userId],
        set: { role: "editor", email },
      })
    return { boardId: link.boardId }
  })
}

export async function duplicateSharedBoardToWorkspaceForUser(
  userId: string,
  token: string,
  baseVersion: number
): Promise<SaveResult> {
  const loaded = await loadBoardByToken(token)
  if (!loaded) {
    return { ok: false, reason: "error", message: "Board not found" }
  }
  const slice = await loadBoardSlice(loaded.board.id)
  if (!slice) {
    return { ok: false, reason: "error", message: "Board not found" }
  }
  const sourceFolder = slice.slice.folders.at(0)

  return withDb(async ({ db }) => {
    const wsRows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, userId))
      .limit(1)
    const workspace = wsRows.at(0)
    if (!workspace) {
      return { ok: false, reason: "error", message: "Workspace not found" }
    }
    const state = parseWorkspaceState(workspace.state)

    const newFolderId = crypto.randomUUID()
    const nextZ = state.zCounter + 1
    const newFolder = {
      id: newFolderId,
      name: loaded.board.title || sourceFolder?.name || "Shared board",
      x: 0,
      y: 0,
      z: nextZ,
    }
    const newBookmarks = slice.slice.bookmarks.map((b) => ({
      ...b,
      id: crypto.randomUUID(),
      folderId: newFolderId,
    }))
    const newNotes = slice.slice.notes.map((n) => ({
      ...n,
      id: crypto.randomUUID(),
      folderId: newFolderId,
    }))
    const newImages = slice.slice.images.map((i) => ({
      ...i,
      id: crypto.randomUUID(),
      folderId: newFolderId,
    }))

    // Copy image blobs from the owner's R2 keys into the caller's namespace.
    const { env } = await import("cloudflare:workers")
    const ownerAssetRows = await db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.userId, loaded.board.ownerUserId),
          inArray(assets.id, slice.slice.images.map((i) => i.imageId))
        )
      )
    const assetByOldImageId = new Map(ownerAssetRows.map((r) => [r.id, r]))

    const newAssetRows: {
      id: string
      userId: string
      objectKey: string
      mime: string
    }[] = []
    for (const img of newImages) {
      const source = assetByOldImageId.get(img.imageId)
      if (!source) continue
      const newImageId = img.id
      const newKey = assetKey(userId, newImageId)
      try {
        const obj = await env.MARKX_BUCKET.get(source.objectKey)
        if (obj) {
          const bytes = new Uint8Array(await obj.arrayBuffer())
          await env.MARKX_BUCKET.put(newKey, bytes, {
            httpMetadata: { contentType: img.mime },
          })
          newAssetRows.push({ id: newImageId, userId, objectKey: newKey, mime: img.mime })
        }
      } catch {
        // Skip images that fail to copy.
      }
      img.imageId = newImageId
    }

    const newState: MarkxState = {
      folders: [...state.folders, newFolder],
      bookmarks: [...state.bookmarks, ...newBookmarks],
      notes: [...state.notes, ...newNotes],
      images: [...state.images, ...newImages],
      hasOnboarded: state.hasOnboarded,
      zCounter: nextZ,
    }

    const entitlements = await getEntitlementsForUser(userId, newState)
    const limit = assertWorkspaceEntityLimit(entitlements, newState)
    if (!limit.ok) {
      return {
        ok: false,
        reason: "entity_limit",
        entityCount: limit.count,
        limit: limit.limit,
        message: `Free plan is limited to ${limit.limit} items. Upgrade to Pro or remove items.`,
      }
    }

    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(workspaces)
        .set({ state: newState, version: baseVersion + 1, updatedAt: new Date() })
        .where(
          and(eq(workspaces.userId, userId), eq(workspaces.version, baseVersion))
        )
        .returning({ version: workspaces.version, updatedAt: workspaces.updatedAt })
      if (rows.length === 0) return null
      if (newAssetRows.length > 0) {
        await tx.insert(assets).values(newAssetRows).onConflictDoNothing()
      }
      return rows[0]
    })

    if (!updated) {
      const cloudRows = await db
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .limit(1)
      return cloudRows.length > 0
        ? toConflictResult(cloudRows[0])
        : { ok: false, reason: "error", message: "Workspace not found" }
    }

    return {
      ok: true,
      version: updated.version,
      updatedAt: updated.updatedAt.toISOString(),
    }
  })
}

/**
 * Unshare a board (owner only). Live-reference: the folder and its items
 * STAY in the owner's workspace; only the sharing metadata is removed.
 */
export async function deleteSharedBoardForUser(
  userId: string,
  boardId: string
): Promise<{ ok: true } | { ok: false; reason: "error"; message: string }> {
  return withDb(async ({ db }) => {
    const boardRows = await db
      .select({ ownerUserId: sharedBoards.ownerUserId })
      .from(sharedBoards)
      .where(eq(sharedBoards.id, boardId))
      .limit(1)
    if (boardRows.at(0)?.ownerUserId !== userId) {
      return { ok: false, reason: "error", message: "Board not found or not owner" }
    }
    await db.delete(sharedBoardLinks).where(eq(sharedBoardLinks.boardId, boardId))
    await db.delete(sharedBoardMembers).where(eq(sharedBoardMembers.boardId, boardId))
    await db.delete(sharedBoards).where(eq(sharedBoards.id, boardId))
    return { ok: true }
  })
}

/* ------------------------------------------------------------------ */
/* Manage access (owner only)                                          */

async function requireBoardOwner(
  db: Parameters<Parameters<typeof withDb>[0]>[0]["db"],
  userId: string,
  boardId: string
): Promise<boolean> {
  const rows = await db
    .select({ ownerUserId: sharedBoards.ownerUserId })
    .from(sharedBoards)
    .where(eq(sharedBoards.id, boardId))
    .limit(1)
  return rows.at(0)?.ownerUserId === userId
}

export async function getSharedBoardAccessForUser(
  userId: string,
  boardId: string
): Promise<SharedBoardAccessView | null> {
  return withDb(async ({ db }) => {
    if (!(await requireBoardOwner(db, userId, boardId))) return null
    const boardRows = await db
      .select()
      .from(sharedBoards)
      .where(eq(sharedBoards.id, boardId))
      .limit(1)
    const board = boardRows.at(0)
    if (!board) return null

    const linkRows = await db
      .select()
      .from(sharedBoardLinks)
      .where(eq(sharedBoardLinks.boardId, boardId))
      .limit(1)
    const link = linkRows.at(0)
    const linkInfo: SharedBoardLinkInfo | null = link
      ? {
          id: link.id,
          token: link.token,
          allowRead: link.allowRead,
          allowEdit: link.allowEdit,
          createdAt: link.createdAt.toISOString(),
        }
      : null

    const memberRows = await db
      .select()
      .from(sharedBoardMembers)
      .where(eq(sharedBoardMembers.boardId, boardId))
    const members: SharedBoardMemberInfo[] = memberRows.map((m) => ({
      userId: m.userId,
      email: m.email,
      role: m.role as SharedBoardRole,
      createdAt: m.createdAt.toISOString(),
    }))

    return { boardId, title: board.title, link: linkInfo, members }
  })
}

export async function listSharedWithMeForUser(
  userId: string
): Promise<SharedWithMeBoard[]> {
  return withDb(async ({ db }) => {
    const rows = await db
      .select({
        boardId: sharedBoardMembers.boardId,
        title: sharedBoards.title,
        ownerEmail: sharedBoards.ownerEmail,
        role: sharedBoardMembers.role,
        updatedAt: sharedBoards.updatedAt,
      })
      .from(sharedBoardMembers)
      .innerJoin(sharedBoards, eq(sharedBoards.id, sharedBoardMembers.boardId))
      .where(eq(sharedBoardMembers.userId, userId))
    return rows.map((r) => ({
      boardId: r.boardId,
      title: r.title,
      ownerEmail: r.ownerEmail,
      role: r.role as SharedBoardRole,
      updatedAt: r.updatedAt.toISOString(),
    }))
  })
}

/** Regenerate the single share link's token (owner). */
export async function regenerateLinkForUser(
  userId: string,
  boardId: string
): Promise<{ token: string } | null> {
  return withDb(async ({ db }) => {
    if (!(await requireBoardOwner(db, userId, boardId))) return null
    const token = generateShareToken()
    await db
      .update(sharedBoardLinks)
      .set({ token })
      .where(eq(sharedBoardLinks.boardId, boardId))
    return { token }
  })
}

/** Update the single share link's read/edit toggles (owner). */
export async function updateLinkTogglesForUser(
  userId: string,
  boardId: string,
  allowRead: boolean,
  allowEdit: boolean
): Promise<boolean> {
  return withDb(async ({ db }) => {
    if (!(await requireBoardOwner(db, userId, boardId))) return false
    await db
      .update(sharedBoardLinks)
      .set({ allowRead, allowEdit })
      .where(eq(sharedBoardLinks.boardId, boardId))
    return true
  })
}

export async function removeMemberForUser(
  userId: string,
  boardId: string,
  memberUserId: string
): Promise<boolean> {
  return withDb(async ({ db }) => {
    if (!(await requireBoardOwner(db, userId, boardId))) return false
    const result = await db
      .delete(sharedBoardMembers)
      .where(
        and(
          eq(sharedBoardMembers.boardId, boardId),
          eq(sharedBoardMembers.userId, memberUserId)
        )
      )
    return result.count > 0
  })
}

/** Boards owned by the caller (folderId → boardId map for "shared" badges). */
export async function listMySharedBoardsForUser(
  userId: string
): Promise<{ folderId: string; boardId: string; title: string }[]> {
  return withDb(async ({ db }) => {
    const rows = await db
      .select({
        boardId: sharedBoards.id,
        folderId: sharedBoards.folderId,
        title: sharedBoards.title,
      })
      .from(sharedBoards)
      .where(eq(sharedBoards.ownerUserId, userId))
    return rows.map((r) => ({
      boardId: r.boardId,
      folderId: r.folderId,
      title: r.title,
    }))
  })
}
