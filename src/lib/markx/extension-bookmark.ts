import { FREE_TIER_ENTITY_LIMIT, countMarkxEntities } from "./entity-count"
import {
  BOOKMARK_SIZE,
  SLOT_OVERLAP_LIMIT,
  getBoardItemRect,
  overlapRatio,
} from "./geometry"
import type { Rect } from "./geometry"
import { getFolder, nextZ } from "./state"
import type { Bookmark, MarkxState } from "./types"
import { selectWorkspaceItems } from "./workspace-items"
import { buildOptimisticBookmark } from "./bookmark-meta"

/** Board origin inside a folder: top-left, no viewport. */
export const FOLDER_BOARD_ORIGIN = { x: 0, y: 0 }

/** Vertical gap between stacked extension bookmarks. */
export const FOLDER_STACK_GAP = 24

export type ExtensionFolder = {
  id: string
  name: string
}

export type AddBookmarkToFolderResult =
  | { ok: true; state: MarkxState; bookmark: Bookmark }
  | { ok: false; reason: "folder_not_found" }
  | { ok: false; reason: "invalid_url" }

export type BoardFullResult = {
  ok: false
  reason: "board_full"
  count: number
  limit: number
}

/**
 * Nearest empty slot from the folder's top-left, stacking downward
 * when the origin (and each step below it) is occupied.
 */
export function findSlotFromTopLeft(
  occupied: readonly Rect[],
  size: { width: number; height: number } = BOOKMARK_SIZE,
  origin: { x: number; y: number } = FOLDER_BOARD_ORIGIN
): { x: number; y: number } {
  const stepY = size.height + FOLDER_STACK_GAP
  for (let i = 0; i < 10_000; i += 1) {
    const candidate = {
      x: origin.x,
      y: origin.y + stepY * i,
      width: size.width,
      height: size.height,
    }
    const blocked = occupied.some(
      (rect) => overlapRatio(candidate, rect) > SLOT_OVERLAP_LIMIT
    )
    if (!blocked) return { x: candidate.x, y: candidate.y }
  }
  return {
    x: origin.x,
    y: origin.y + stepY * 10_000,
  }
}

export function occupiedRectsInFolder(
  state: MarkxState,
  folderId: string
): Rect[] {
  return selectWorkspaceItems(state, { mode: "folder", folderId }).map(
    getBoardItemRect
  )
}

/** Recency for "last-used first": the highest z of the folder or its items. */
export function folderRecency(state: MarkxState, folderId: string): number {
  let maxZ = 0
  const folder = getFolder(state.folders, folderId)
  if (folder) maxZ = folder.z
  for (const bookmark of state.bookmarks) {
    if (bookmark.folderId === folderId) maxZ = Math.max(maxZ, bookmark.z)
  }
  for (const note of state.notes) {
    if (note.folderId === folderId) maxZ = Math.max(maxZ, note.z)
  }
  for (const image of state.images) {
    if (image.folderId === folderId) maxZ = Math.max(maxZ, image.z)
  }
  return maxZ
}

/**
 * Folder list for the extension picker: last-used first, original
 * order as a stable tiebreaker.
 */
export function listFoldersLastUsedFirst(state: MarkxState): ExtensionFolder[] {
  return state.folders
    .map((folder, index) => ({ folder, index }))
    .sort((a, b) => {
      const recency =
        folderRecency(state, b.folder.id) - folderRecency(state, a.folder.id)
      if (recency !== 0) return recency
      return a.index - b.index
    })
    .map(({ folder }) => ({ id: folder.id, name: folder.name }))
}

/** True when adding one more entity would exceed the free-plan cap. */
export function wouldExceedFreeLimit(state: MarkxState): boolean {
  return countMarkxEntities(state) >= FREE_TIER_ENTITY_LIMIT
}

export function boardFullResult(state: MarkxState): BoardFullResult {
  return {
    ok: false,
    reason: "board_full",
    count: countMarkxEntities(state),
    limit: FREE_TIER_ENTITY_LIMIT,
  }
}

/**
 * Append one optimistic bookmark to the target folder at the next
 * empty downward slot. Does not enforce the free-plan limit — the
 * caller checks {@link wouldExceedFreeLimit} first, using entitlements.
 */
export function addBookmarkToFolderState(
  state: MarkxState,
  input: { id: string; folderId: string; url: string }
): AddBookmarkToFolderResult {
  if (!getFolder(state.folders, input.folderId)) {
    return { ok: false, reason: "folder_not_found" }
  }
  const existing = state.bookmarks.find((item) => item.id === input.id)
  if (existing) return { ok: true, state, bookmark: existing }
  const { z, zCounter } = nextZ(state)
  const point = findSlotFromTopLeft(
    occupiedRectsInFolder(state, input.folderId)
  )
  const bookmark = buildOptimisticBookmark({
    id: input.id,
    folderId: input.folderId,
    url: input.url,
    x: point.x,
    y: point.y,
    z,
    highlight: true,
  })
  if (!bookmark) return { ok: false, reason: "invalid_url" }
  return {
    ok: true,
    bookmark,
    state: {
      ...state,
      zCounter,
      hasOnboarded: true,
      bookmarks: [...state.bookmarks, bookmark],
    },
  }
}
