import type { MarkxState } from "@/lib/markx/types"

function mergeById<T extends { id: string }>(
  local: readonly T[],
  cloud: readonly T[]
): T[] {
  const merged = new Map(cloud.map((item) => [item.id, item]))
  for (const item of local) {
    if (!merged.has(item.id)) merged.set(item.id, item)
  }
  return [...merged.values()]
}

/**
 * Merge non-overlapping workspace additions automatically.
 * Cloud wins when both devices changed the same entity.
 */
export function mergeWorkspaceStates(
  local: MarkxState,
  cloud: MarkxState
): MarkxState {
  return {
    folders: mergeById(local.folders, cloud.folders),
    bookmarks: mergeById(local.bookmarks, cloud.bookmarks),
    notes: mergeById(local.notes, cloud.notes),
    images: mergeById(local.images, cloud.images),
    hasOnboarded: local.hasOnboarded || cloud.hasOnboarded,
    zCounter: Math.max(local.zCounter, cloud.zCounter),
  }
}

/**
 * Soft-delete only asset ids that are not still referenced by the state
 * that will be written. Needed when a merge keeps a cloud image that the
 * client had queued for deletion.
 */
export function filterDeletedImageIdsForState(
  deletedImageIds: readonly string[] | undefined,
  state: MarkxState
): string[] {
  if (!deletedImageIds || deletedImageIds.length === 0) return []
  const retained = new Set(state.images.map((image) => image.imageId))
  return deletedImageIds.filter((id) => !retained.has(id))
}

/**
 * 3-way merge against the last adopted cloud snapshot.
 *
 * - Local-only adds (not in base) are kept.
 * - Cloud-only adds (not in base) are kept — this is what prevents an
 *   open tab from overwriting a bookmark the extension just wrote.
 * - Local deletes (in base, missing locally) are honored.
 * - Cloud deletes (in base, missing in cloud) are honored.
 * - When both sides still have the same id, cloud wins (matches
 *   {@link mergeWorkspaceStates}).
 */
export function threeWayMergeWorkspaceStates(
  base: MarkxState,
  local: MarkxState,
  cloud: MarkxState
): MarkxState {
  return {
    folders: threeWayById(base.folders, local.folders, cloud.folders),
    bookmarks: threeWayById(base.bookmarks, local.bookmarks, cloud.bookmarks),
    notes: threeWayById(base.notes, local.notes, cloud.notes),
    images: threeWayById(base.images, local.images, cloud.images),
    hasOnboarded: local.hasOnboarded || cloud.hasOnboarded,
    zCounter: Math.max(local.zCounter, cloud.zCounter),
  }
}

function threeWayById<T extends { id: string }>(
  base: readonly T[],
  local: readonly T[],
  cloud: readonly T[]
): T[] {
  const baseMap = new Map(base.map((item) => [item.id, item]))
  const localMap = new Map(local.map((item) => [item.id, item]))
  const cloudMap = new Map(cloud.map((item) => [item.id, item]))

  const kept = new Map<string, T>()
  // Cloud order first so remote additions land where the cloud put them.
  for (const item of cloud) {
    const inBase = baseMap.has(item.id)
    const inLocal = localMap.has(item.id)
    if (!inBase || inLocal) kept.set(item.id, item)
  }
  for (const item of local) {
    if (kept.has(item.id)) continue
    const inBase = baseMap.has(item.id)
    const inCloud = cloudMap.has(item.id)
    if (!inBase && !inCloud) kept.set(item.id, item)
  }
  return [...kept.values()]
}
