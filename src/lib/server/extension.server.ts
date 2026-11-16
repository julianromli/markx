import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"

import { withDb } from "@/lib/db/client"
import { workspaces } from "@/lib/db/schema"
import { applyBookmarkMetadata } from "@/lib/markx/bookmark-meta"
import {
  addBookmarkToFolderState,
  boardFullResult,
  listFoldersLastUsedFirst,
  wouldExceedFreeLimit,
} from "@/lib/markx/extension-bookmark"
import type {
  BoardFullResult,
  ExtensionFolder,
} from "@/lib/markx/extension-bookmark"
import type { Bookmark, LinkMetadata } from "@/lib/markx/types"
import { getEntitlementsForUser } from "@/lib/server/subscription.server"
import { parseWorkspaceState } from "@/lib/server/workspace-helpers"

export const EXTENSION_VERSION_ATTEMPTS = 4

export type ExtensionAddBookmarkResult =
  | {
      ok: true
      bookmark: Bookmark
      folder: ExtensionFolder
      version: number
    }
  | BoardFullResult
  | { ok: false; reason: "folder_not_found" }
  | { ok: false; reason: "invalid_url" }
  | { ok: false; reason: "no_workspace" }
  | { ok: false; reason: "conflict" }

export async function listFoldersForUser(
  userId: string
): Promise<ExtensionFolder[] | null> {
  return withDb(async ({ db }) => {
    const rows = await db
      .select({ state: workspaces.state })
      .from(workspaces)
      .where(eq(workspaces.userId, userId))
      .limit(1)
    if (rows.length === 0) return null
    return listFoldersLastUsedFirst(parseWorkspaceState(rows[0].state))
  })
}

export async function addBookmarkForUser(
  userId: string,
  input: { folderId: string; url: string; id?: string }
): Promise<ExtensionAddBookmarkResult> {
  const entitlements = await getEntitlementsForUser(userId)
  const enforceLimit =
    entitlements.billingEnabled && entitlements.plan !== "pro"
  const bookmarkId = input.id ?? nanoid()

  for (let attempt = 0; attempt < EXTENSION_VERSION_ATTEMPTS; attempt += 1) {
    const outcome = await withDb(async ({ db }) => {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.userId, userId))
          .limit(1)
          .for("update")

        if (rows.length === 0) {
          return { kind: "no_workspace" as const }
        }

        const current = rows[0]
        const state = parseWorkspaceState(current.state)
        if (enforceLimit && wouldExceedFreeLimit(state)) {
          return { kind: "board_full" as const, state }
        }

        const added = addBookmarkToFolderState(state, {
          id: bookmarkId,
          folderId: input.folderId,
          url: input.url,
        })
        if (!added.ok) return { kind: "add_failed" as const, result: added }

        const named = state.folders.find((item) => item.id === input.folderId)

        const updated = await tx
          .update(workspaces)
          .set({
            state: added.state,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workspaces.id, current.id),
              eq(workspaces.version, current.version)
            )
          )
          .returning({ version: workspaces.version })

        if (updated.length === 0) return { kind: "retry" as const }

        return {
          kind: "saved" as const,
          bookmark: added.bookmark,
          folder: { id: input.folderId, name: named?.name ?? "" },
          version: updated[0].version,
        }
      })
    })

    if (outcome.kind === "retry") continue
    if (outcome.kind === "no_workspace") {
      return { ok: false, reason: "no_workspace" }
    }
    if (outcome.kind === "board_full") {
      return boardFullResult(outcome.state)
    }
    if (outcome.kind === "add_failed") return outcome.result
    return {
      ok: true,
      bookmark: outcome.bookmark,
      folder: outcome.folder,
      version: outcome.version,
    }
  }

  return { ok: false, reason: "conflict" }
}

export async function applyBookmarkEnrichmentForUser(
  userId: string,
  bookmarkId: string,
  metadata: LinkMetadata
): Promise<void> {
  for (let attempt = 0; attempt < EXTENSION_VERSION_ATTEMPTS; attempt += 1) {
    const retried = await withDb(async ({ db }) => {
      return db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(workspaces)
          .where(eq(workspaces.userId, userId))
          .limit(1)
          .for("update")
        if (rows.length === 0) return false
        const current = rows[0]
        const state = parseWorkspaceState(current.state)
        const existing = state.bookmarks.find((item) => item.id === bookmarkId)
        if (!existing) return false
        const nextState = {
          ...state,
          bookmarks: state.bookmarks.map((item) =>
            item.id === bookmarkId
              ? applyBookmarkMetadata(item, metadata)
              : item
          ),
        }
        const updated = await tx
          .update(workspaces)
          .set({
            state: nextState,
            version: current.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(workspaces.id, current.id),
              eq(workspaces.version, current.version)
            )
          )
          .returning({ version: workspaces.version })
        return updated.length === 0
      })
    })
    if (!retried) return
  }
}
