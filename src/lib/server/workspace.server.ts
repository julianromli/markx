import { and, eq, sql } from "drizzle-orm"

import { withDb } from "@/lib/db/client"
import { workspaces } from "@/lib/db/schema"
import { filterDeletedImageIdsForState } from "@/lib/markx/merge-workspace"
import { createEmptyState } from "@/lib/markx/seed"
import type { MarkxState } from "@/lib/markx/types"
import { softDeleteAssetRows } from "@/lib/server/assets.server"
import {
  assertWorkspaceEntityLimit,
  getEntitlementsForUser,
} from "@/lib/server/subscription.server"
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

    if (rows.length === 0) return null
    const snapshot = toWorkspaceSnapshot(rows[0])
    const entitlements = await getEntitlementsForUser(
      userId,
      snapshot.state,
      db
    )
    return { ...snapshot, entitlements }
  })
}

/**
 * Cheap poll probe: read only `version` (no JSONB state, no entitlements).
 * Returns null when the user has no workspace row yet.
 */
export async function getWorkspaceVersionForUser(
  userId: string
): Promise<number | null> {
  return withDb(async ({ db }) => {
    const rows = await db
      .select({ version: workspaces.version })
      .from(workspaces)
      .where(eq(workspaces.userId, userId))
      .limit(1)
    if (rows.length === 0) return null
    return rows[0]!.version
  })
}

async function enforceEntityLimitForUser(
  userId: string,
  state: MarkxState
): Promise<Extract<SaveResult, { reason: "entity_limit" }> | null> {
  const entitlements = await getEntitlementsForUser(userId, state)
  const check = assertWorkspaceEntityLimit(entitlements, state)
  if (check.ok) return null
  return {
    ok: false,
    reason: "entity_limit",
    entityCount: check.count,
    limit: check.limit,
    message: `Free plan is limited to ${check.limit} items. Upgrade to Pro or remove items.`,
  }
}

export async function saveWorkspaceForUser(
  userId: string,
  input: {
    state: MarkxState
    baseVersion: number
    deletedImageIds?: string[]
  }
): Promise<SaveResult> {
  const entitlements = await getEntitlementsForUser(userId)

  return withDb(async ({ db }) => {
    const outcome = await db.transaction(async (tx) => {
      const currentRows = await tx
        .select()
        .from(workspaces)
        .where(eq(workspaces.userId, userId))
        .limit(1)
        .for("update")

      if (currentRows.length === 0) {
        return { kind: "not_found" as const }
      }

      const current = currentRows[0]
      // Last-writer-wins: always write the client's snapshot. A stale
      // baseVersion does not merge with cloud; this save replaces it.
      const stateToWrite = input.state

      const limit = assertWorkspaceEntityLimit(entitlements, stateToWrite)
      if (!limit.ok) {
        return {
          kind: "entity_limit" as const,
          entityCount: limit.count,
          limit: limit.limit,
        }
      }

      const rows = await tx
        .update(workspaces)
        .set({
          state: stateToWrite,
          version: current.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(workspaces.id, current.id),
            eq(workspaces.version, current.version)
          )
        )
        .returning({
          version: workspaces.version,
          updatedAt: workspaces.updatedAt,
          state: workspaces.state,
        })

      if (rows.length === 0) {
        return { kind: "race" as const }
      }

      await softDeleteAssetRows(
        tx,
        userId,
        filterDeletedImageIdsForState(input.deletedImageIds, stateToWrite)
      )
      return {
        kind: "saved" as const,
        version: rows[0].version,
        updatedAt: rows[0].updatedAt,
        state: stateToWrite,
      }
    })

    if (outcome.kind === "not_found") {
      return { ok: false, reason: "error", message: "Workspace not found" }
    }
    if (outcome.kind === "entity_limit") {
      return {
        ok: false,
        reason: "entity_limit",
        entityCount: outcome.entityCount,
        limit: outcome.limit,
        message: `Free plan is limited to ${outcome.limit} items. Upgrade to Pro or remove items.`,
      }
    }
    if (outcome.kind === "race") {
      // Another writer changed the row between SELECT FOR UPDATE and UPDATE.
      // Extremely rare under row lock; surface as conflict so the client retries.
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
      version: outcome.version,
      updatedAt: outcome.updatedAt.toISOString(),
      state: outcome.state,
    }
  })
}

export async function importGuestWorkspaceForUser(
  userId: string,
  state: MarkxState
): Promise<SaveResult> {
  const limitError = await enforceEntityLimitForUser(userId, state)
  if (limitError) return limitError

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
      state,
    }
  })
}

export async function overwriteWorkspaceForUser(
  userId: string,
  input: { state: MarkxState; deletedImageIds?: string[] }
): Promise<SaveResult> {
  const limitError = await enforceEntityLimitForUser(userId, input.state)
  if (limitError) return limitError

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
          state: input.state,
        }
      : { ok: false, reason: "error", message: "Workspace not found" }
  })
}
