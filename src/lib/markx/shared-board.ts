import type { MarkxState } from "./types"

/** Access granted by a share link. */
export type SharedBoardAccess = "view" | "edit"

/** Resolved role of a caller against a shared board. */
export type SharedBoardRole = "owner" | "editor" | "viewer"

/**
 * Result of loading a shared board by token.
 *
 * The public view path needs no auth; `access` tells the client whether
 * the token grants read-only (`view`) or editable (`edit`) access. For an
 * edit token held by a caller who is not yet a member, `requiresLogin`
 * is true so the client can prompt login then call `acceptEditorLink`.
 */
export type SharedBoardSnapshot = {
  boardId: string
  title: string
  state: MarkxState
  version: number
  updatedAt: string
  access: SharedBoardAccess
  /** True for an edit token when the caller is not yet a member. */
  requiresLogin?: boolean
  /** Resolved role for a logged-in caller; null for an anonymous view. */
  role: SharedBoardRole | null
}

/**
 * Optimistic save result for a shared board, mirroring the workspace
 * {@link import("@/lib/server/workspace-helpers").SaveResult} shape so the
 * client-side sync engine can reuse the conflict-handling pattern.
 */
export type SharedBoardSaveResult =
  | { ok: true; version: number; updatedAt: string; state: MarkxState }
  | {
      ok: false
      reason: "conflict"
      cloudVersion: number
      cloudState: MarkxState
      cloudUpdatedAt: string
    }
  | { ok: false; reason: "error"; message: string }
  | {
      ok: false
      reason: "entity_limit"
      entityCount: number
      limit: number
      message: string
    }

/** A member row as seen by the owner in the manage-access panel. */
export type SharedBoardMemberInfo = {
  userId: string
  email: string
  role: SharedBoardRole
  createdAt: string
}

/** An active link for a board as seen by the owner. */
export type SharedBoardLinkInfo = {
  id: string
  token: string
  allowRead: boolean
  allowEdit: boolean
  createdAt: string
}

/** Manage-access response for the owner. */
export type SharedBoardAccessView = {
  boardId: string
  title: string
  link: SharedBoardLinkInfo | null
  members: SharedBoardMemberInfo[]
  viewCount: number
  recentViewerSeeds: string[]
}

/** A board shared with the caller (for the "shared with me" list). */
export type SharedWithMeBoard = {
  boardId: string
  title: string
  ownerEmail: string
  role: SharedBoardRole
  updatedAt: string
}
