import { findEmptySlot, getBoardItemRect } from "./geometry"
import type { BoardItemModel, Rect } from "./geometry"
import type { BoardImage, Bookmark, Folder, MarkxState, Note } from "./types"
import type { WorkspaceLocation } from "./workspace-items"
import { selectWorkspaceItems } from "./workspace-items"

/**
 * Board items: the one place for containment and lifecycle rules.
 *
 * - Folders live on Home only (no nesting).
 * - Bookmarks live in a folder.
 * - Notes and images live on Home or in a folder, and can move between them.
 *
 * Every function here is pure: it takes a workspace state and returns a new
 * one (or a description), so UI handlers only decide *when* to call them.
 */

export type ItemKind = BoardItemModel["kind"]

export type ContentCounts = { bookmarks: number; notes: number; images: number }

export type DeleteCounts = ContentCounts & { folders: number }

export function findItem(
  state: MarkxState,
  id: string
): BoardItemModel | undefined {
  const folder = state.folders.find((f) => f.id === id)
  if (folder) return { id, kind: "folder", data: folder }
  const bookmark = state.bookmarks.find((b) => b.id === id)
  if (bookmark) return { id, kind: "bookmark", data: bookmark }
  const note = state.notes.find((n) => n.id === id)
  if (note) return { id, kind: "note", data: note }
  const image = state.images.find((i) => i.id === id)
  if (image) return { id, kind: "image", data: image }
  return undefined
}

export function canLiveIn(kind: ItemKind, target: WorkspaceLocation): boolean {
  switch (kind) {
    case "folder":
      return target.mode === "home"
    case "bookmark":
      return target.mode === "folder"
    case "note":
    case "image":
      return true
  }
}

function sameLocation(
  item: BoardItemModel,
  target: WorkspaceLocation
): boolean {
  if (item.kind === "folder") return target.mode === "home"
  const folderId = item.data.folderId
  return target.mode === "home"
    ? folderId == null
    : folderId === target.folderId
}

/** Where the current selection can move to. Folders never move. */
export function moveTargets(
  state: MarkxState,
  ids: readonly string[],
  current: WorkspaceLocation
): { home: boolean; folders: Folder[] } {
  const items = ids
    .map((id) => findItem(state, id))
    .filter((item): item is BoardItemModel => item != null)
  if (items.length === 0 || items.some((item) => item.kind === "folder")) {
    return { home: false, folders: [] }
  }
  const home =
    current.mode === "folder" &&
    items.every((item) => canLiveIn(item.kind, { mode: "home" }))
  const folders = state.folders.filter(
    (folder) => current.mode === "home" || folder.id !== current.folderId
  )
  return { home, folders }
}

/** Default area where moved items are laid out in their new location. */
const MOVE_LAYOUT_VIEW: Rect = { x: 120, y: 120, width: 1600, height: 1200 }

/**
 * Move items to `target`. Items that cannot live there are left in place
 * and reported as skipped. Moved items get free spots (no exact overlap)
 * and are raised above everything in their new location.
 */
export function moveItems(
  state: MarkxState,
  ids: readonly string[],
  target: WorkspaceLocation
): { state: MarkxState; moved: number; skipped: number } {
  const items = ids
    .map((id) => findItem(state, id))
    .filter((item): item is BoardItemModel => item != null)
  const movable = items.filter(
    (item) =>
      item.kind !== "folder" &&
      canLiveIn(item.kind, target) &&
      !sameLocation(item, target)
  )
  const skipped = items.length - movable.length
  if (movable.length === 0) return { state, moved: 0, skipped }

  const occupied = selectWorkspaceItems(state, target).map(getBoardItemRect)
  let zCounter = state.zCounter
  const placed = new Map<string, { x: number; y: number; z: number }>()
  for (const item of movable) {
    const rect = getBoardItemRect(item)
    let spot = findEmptySlot(occupied, MOVE_LAYOUT_VIEW, rect)
    // findEmptySlot falls back to its origin when the area is full; step
    // past earlier placements so moved items never stack exactly.
    while ([...placed.values()].some((p) => p.x === spot.x && p.y === spot.y)) {
      spot = { x: spot.x + 24, y: spot.y + 24 }
    }
    zCounter += 1
    placed.set(item.id, { ...spot, z: zCounter })
    occupied.push({ ...spot, width: rect.width, height: rect.height })
  }

  const folderId = target.mode === "folder" ? target.folderId : null
  const relocate = <T extends Note | BoardImage>(entity: T): T => {
    const spot = placed.get(entity.id)
    return spot ? { ...entity, ...spot, folderId } : entity
  }
  const relocateBookmark = (bookmark: Bookmark): Bookmark => {
    const spot = placed.get(bookmark.id)
    return spot && folderId != null
      ? { ...bookmark, ...spot, folderId }
      : bookmark
  }

  return {
    state: {
      ...state,
      zCounter,
      bookmarks: state.bookmarks.map(relocateBookmark),
      notes: state.notes.map(relocate),
      images: state.images.map(relocate),
    },
    moved: movable.length,
    skipped,
  }
}

/**
 * Delete any mix of items. Deleting a folder deletes its contents.
 * `removedImageIds` are the image blobs the sync engine should retire.
 */
export function deleteItems(
  state: MarkxState,
  ids: readonly string[]
): { state: MarkxState; counts: DeleteCounts; removedImageIds: string[] } {
  const idSet = new Set(ids)
  const folderIds = new Set(
    state.folders.filter((f) => idSet.has(f.id)).map((f) => f.id)
  )
  const gone = (entity: { id: string; folderId: string | null }) =>
    idSet.has(entity.id) ||
    (entity.folderId != null && folderIds.has(entity.folderId))

  const folders = state.folders.filter((f) => !folderIds.has(f.id))
  const bookmarks = state.bookmarks.filter((b) => !gone(b))
  const notes = state.notes.filter((n) => !gone(n))
  const removedImages = state.images.filter(gone)
  const images = state.images.filter((i) => !gone(i))

  return {
    state: { ...state, folders, bookmarks, notes, images },
    counts: {
      folders: state.folders.length - folders.length,
      bookmarks: state.bookmarks.length - bookmarks.length,
      notes: state.notes.length - notes.length,
      images: removedImages.length,
    },
    removedImageIds: removedImages.map((i) => i.imageId),
  }
}

export function folderContents(
  state: MarkxState,
  folderId: string
): ContentCounts {
  return {
    bookmarks: state.bookmarks.filter((b) => b.folderId === folderId).length,
    notes: state.notes.filter((n) => n.folderId === folderId).length,
    images: state.images.filter((i) => i.folderId === folderId).length,
  }
}

export function contentsOfFolders(
  state: MarkxState,
  folderIds: readonly string[]
): ContentCounts {
  const total: ContentCounts = { bookmarks: 0, notes: 0, images: 0 }
  for (const id of folderIds) {
    const counts = folderContents(state, id)
    total.bookmarks += counts.bookmarks
    total.notes += counts.notes
    total.images += counts.images
  }
  return total
}

export function hasContents(counts: ContentCounts): boolean {
  return counts.bookmarks + counts.notes + counts.images > 0
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function countParts(counts: ContentCounts): string[] {
  const parts: string[] = []
  if (counts.bookmarks > 0)
    parts.push(plural(counts.bookmarks, "bookmark", "bookmarks"))
  if (counts.notes > 0) parts.push(plural(counts.notes, "note", "notes"))
  if (counts.images > 0) parts.push(plural(counts.images, "image", "images"))
  return parts
}

/** Short label for folder tiles: "3 bookmarks, 1 note" or "Empty". */
export function describeContents(counts: ContentCounts): string {
  const parts = countParts(counts)
  return parts.length > 0 ? parts.join(", ") : "Empty"
}

/** Sentence form: "3 bookmarks and 1 note". */
export function describeContentsSentence(counts: ContentCounts): string {
  const parts = countParts(counts)
  if (parts.length <= 1) return parts[0] ?? "nothing"
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

export type OpenIntent =
  | { type: "edit-note"; id: string }
  | { type: "open-folder"; folderId: string }
  | { type: "open-url"; url: string }
  | { type: "none" }

export function openIntent(state: MarkxState, id: string): OpenIntent {
  const item = findItem(state, id)
  switch (item?.kind) {
    case "note":
      return { type: "edit-note", id }
    case "folder":
      return { type: "open-folder", folderId: id }
    case "bookmark":
      return { type: "open-url", url: item.data.url }
    default:
      return { type: "none" }
  }
}

export type ParsedUrl =
  { ok: true; url: string; host: string } | { ok: false; reason: string }

/** Normalize and validate user input for a new bookmark. */
export function parseBookmarkUrl(input: string): ParsedUrl {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: "Enter a link." }
  if (/\s/.test(trimmed)) {
    return { ok: false, reason: "A link cannot contain spaces." }
  }
  // "host:port" is not a scheme; "javascript:" and "mailto:" are.
  const hasScheme = /^[a-z][a-z\d+.-]*:(?!\d)/i.test(trimmed)
  if (hasScheme && !/^https?:\/\//i.test(trimmed)) {
    return { ok: false, reason: "Only http and https links are supported." }
  }
  const withScheme = hasScheme ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return { ok: false, reason: "That does not look like a link." }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https links are supported." }
  }
  const host = url.hostname
  const looksLikeHost =
    host === "localhost" ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
    host.startsWith("[") ||
    /^[^.%]+(\.[^.%]+)+$/.test(host)
  if (!looksLikeHost) {
    return { ok: false, reason: "That does not look like a link." }
  }
  return { ok: true, url: withScheme, host }
}

/**
 * Keep a new item fully inside the visible board area when possible, so an
 * item created at a pointer near the edge does not land off-screen.
 */
export function clampIntoView(
  point: { x: number; y: number },
  size: { width: number; height: number },
  view: Rect,
  margin = 16
): { x: number; y: number } {
  if (view.width <= 0 || view.height <= 0) return point
  const maxX = view.x + view.width - size.width - margin
  const maxY = view.y + view.height - size.height - margin
  return {
    x: Math.max(view.x + margin, Math.min(point.x, maxX)),
    y: Math.max(view.y + margin, Math.min(point.y, maxY)),
  }
}
