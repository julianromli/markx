import { and, eq, sql } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import { workspaces } from "@/lib/db/schema"
import { createEmptyState } from "@/lib/markx/seed"
import type { MarkxState } from "@/lib/markx/types"
import { softDeleteAssetRows } from "@/lib/server/assets.server"
import {
  hasWorkspaceItems,
  parseWorkspaceState,
  toConflictResult,
  toWorkspaceSnapshot,
} from "@/lib/server/workspace-helpers"
import type {
  SaveResult,
  WorkspaceSnapshot,
} from "@/lib/server/workspace-helpers"

export async function loadWorkspaceForUser(
  userId: string
): Promise<WorkspaceSnapshot | null> {
  return withDb(async ({ db }) => {
    await db
      .insert(workspaces)
      .values({
        id: crypto.randomUUID(),
        userId,
        state: createEmptyState(),
        version: 1,
      })
      .onConflictDoNothing()

    const rows = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.userId, userId))
      .limit(1)

    return rows.length > 0 ? toWorkspaceSnapshot(rows[0]) : null
  })
}

export async function saveWorkspaceForUser(
  userId: string,
  input: {
    state: MarkxState
    baseVersion: number
    deletedImageIds?: string[]
  }
): Promise<SaveResult> {
  return withDb(async ({ db }) => {
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(workspaces)
        .set({
          state: input.state,
          version: input.baseVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaces.userId, userId),
            eq(workspaces.version, input.baseVersion)
          )
        )
        .returning({
          version: workspaces.version,
          updatedAt: workspaces.updatedAt,
        })

      if (rows.length === 0) return null
      await softDeleteAssetRows(tx, userId, input.deletedImageIds)
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

export async function importGuestWorkspaceForUser(
  userId: string,
  state: MarkxState
): Promise<SaveResult> {
  return withDb(async ({ db }) => {
    const outcome = await db.transaction(async (tx) => {
      const insertedRows = await tx
        .insert(workspaces)
        .values({
          id: crypto.randomUUID(),
          userId,
          state,
          version: 1,
        })
        .onConflictDoNothing()
        .returning()

      if (insertedRows.length > 0) {
        return { kind: "saved" as const, workspace: insertedRows[0] }
      }

      const currentRows = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .limit(1)

      if (currentRows.length === 0) return { kind: "not_found" as const }
      const current = currentRows[0]
      if (hasWorkspaceItems(parseWorkspaceState(current.state))) {
        return { kind: "conflict" as const, workspace: current }
      }

      const updatedRows = await tx
        .update(workspaces)
        .set({
          state,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaces.id, current.id),
            eq(workspaces.version, current.version)
          )
        )
        .returning()

      if (updatedRows.length > 0) {
        return { kind: "saved" as const, workspace: updatedRows[0] }
      }

      const latestRows = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .limit(1)
      return latestRows.length > 0
        ? { kind: "conflict" as const, workspace: latestRows[0] }
        : { kind: "not_found" as const }
    })

    if (outcome.kind === "not_found") {
      return { ok: false, reason: "error", message: "Workspace not found" }
    }
    if (outcome.kind === "conflict") {
      return toConflictResult(outcome.workspace)
    }
    return {
      ok: true,
      version: outcome.workspace.version,
      updatedAt: outcome.workspace.updatedAt.toISOString(),
    }
  })
}

export async function overwriteWorkspaceForUser(
  userId: string,
  input: { state: MarkxState; deletedImageIds?: string[] }
): Promise<SaveResult> {
  return withDb(async ({ db }) => {
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(workspaces)
        .set({
          state: input.state,
          version: sql`${workspaces.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(workspaces.userId, userId))
        .returning({
          version: workspaces.version,
          updatedAt: workspaces.updatedAt,
        })

      if (rows.length === 0) return null
      await softDeleteAssetRows(tx, userId, input.deletedImageIds)
      return rows[0]
    })

    return updated
      ? {
          ok: true,
          version: updated.version,
          updatedAt: updated.updatedAt.toISOString(),
        }
      : { ok: false, reason: "error", message: "Workspace not found" }
  })
}
