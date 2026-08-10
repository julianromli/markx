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
