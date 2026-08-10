import { markxStateSchema } from "@/lib/markx/schema"
import type { MarkxState } from "@/lib/markx/types"

export type WorkspaceRecord = {
  id: string
  userId: string
  state: unknown
  version: number
  updatedAt: Date
}

export type WorkspaceSnapshot = {
  id: string
  userId: string
  state: MarkxState
  version: number
  updatedAt: string
  entitlements?: import("@/lib/server/subscription.server").UserEntitlements
}

export type SaveResult =
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

export function parseWorkspaceState(state: unknown): MarkxState {
  return markxStateSchema.parse(state)
}

export function hasWorkspaceItems(state: MarkxState): boolean {
  return (
    state.folders.length > 0 ||
    state.bookmarks.length > 0 ||
    state.notes.length > 0 ||
    state.images.length > 0
  )
}

export function toWorkspaceSnapshot(
  workspace: WorkspaceRecord
): WorkspaceSnapshot {
  return {
    id: workspace.id,
    userId: workspace.userId,
    state: parseWorkspaceState(workspace.state),
    version: workspace.version,
    updatedAt: workspace.updatedAt.toISOString(),
  }
}

export function toConflictResult(
  workspace: WorkspaceRecord
): Extract<SaveResult, { reason: "conflict" }> {
  return {
    ok: false,
    reason: "conflict",
    cloudVersion: workspace.version,
    cloudState: parseWorkspaceState(workspace.state),
    cloudUpdatedAt: workspace.updatedAt.toISOString(),
  }
}
