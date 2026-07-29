import type { MarkxState } from "@/lib/markx/types"

export const FREE_TIER_ENTITY_LIMIT = 100

/** Total placeable entities in the workspace snapshot. */
export function countMarkxEntities(state: MarkxState): number {
  return (
    state.folders.length +
    state.bookmarks.length +
    state.notes.length +
    state.images.length
  )
}

export function isWithinFreeEntityLimit(state: MarkxState): boolean {
  return countMarkxEntities(state) <= FREE_TIER_ENTITY_LIMIT
}
