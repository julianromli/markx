import type { BoardImage, Bookmark, Folder, Note } from "./types"

export type Camera = {
  x: number
  y: number
  zoom: number
}

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type BoardItemModel =
  | { id: string; kind: "folder"; data: Folder }
  | { id: string; kind: "bookmark"; data: Bookmark }
  | { id: string; kind: "note"; data: Note }
  | { id: string; kind: "image"; data: BoardImage }

export type LiveResize = {
  x: number
  width: number
  height: number
}

export function screenToBoard(
  screenX: number,
  screenY: number,
  camera: Camera,
  viewport: DOMRect
): { x: number; y: number } {
  return {
    x: (screenX - viewport.left - camera.x) / camera.zoom,
    y: (screenY - viewport.top - camera.y) / camera.zoom,
  }
}

export function normalizeRect(
  a: { x: number; y: number },
  b: { x: number; y: number }
): Rect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  }
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  )
}

export function aabbBetweenCenters(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): Rect {
  const acx = a.x + a.width / 2
  const acy = a.y + a.height / 2
  const bcx = b.x + b.width / 2
  const bcy = b.y + b.height / 2
  return normalizeRect({ x: acx, y: acy }, { x: bcx, y: bcy })
}

export const FOLDER_SIZE = { width: 200, height: 185 }
export const BOOKMARK_SIZE = { width: 480, height: 252 }
export const NOTE_SIZE = { width: 300, height: 300 }
export const IMAGE_FIT_SIZE = 480
export const MIN_BOOKMARK_SIZE = { width: 220, height: 120 }
export const MIN_NOTE_SIZE = { width: 160, height: 120 }
export const MIN_IMAGE_SIZE = { width: 80, height: 80 }
export const RESIZE_HANDLE_SIZE = 20

export function fitImageToWidth(
  naturalWidth: number,
  naturalHeight: number,
  target = IMAGE_FIT_SIZE
): { width: number; height: number } {
  const ratio = naturalWidth / naturalHeight
  if (ratio >= 1) {
    return { width: target, height: Math.round(target / ratio) }
  }
  return { width: Math.round(target * ratio), height: target }
}

export function getBoardItemRect(item: BoardItemModel): Rect {
  if (item.kind === "folder") {
    return {
      x: item.data.x,
      y: item.data.y,
      width: FOLDER_SIZE.width,
      height: FOLDER_SIZE.height,
    }
  }

  const size =
    item.kind === "note"
      ? {
          width: item.data.width ?? NOTE_SIZE.width,
          height: item.data.height ?? NOTE_SIZE.height,
        }
      : item.kind === "image"
        ? item.data.width && item.data.height
          ? { width: item.data.width, height: item.data.height }
          : fitImageToWidth(item.data.naturalWidth, item.data.naturalHeight)
        : {
            width: item.data.width ?? BOOKMARK_SIZE.width,
            height: item.data.height ?? BOOKMARK_SIZE.height,
          }

  return { x: item.data.x, y: item.data.y, ...size }
}

export function hitTestBoardItems(
  items: readonly BoardItemModel[],
  boardX: number,
  boardY: number
): BoardItemModel | null {
  const sorted = [...items].sort((a, b) => b.data.z - a.data.z)
  for (const item of sorted) {
    if (pointInRect(boardX, boardY, getBoardItemRect(item))) return item
  }
  return null
}

export function isInBottomRightResizeZone(
  boardX: number,
  boardY: number,
  rect: Rect,
  handleSize: number = RESIZE_HANDLE_SIZE
): boolean {
  return pointInRect(boardX, boardY, {
    x: rect.x + rect.width - handleSize,
    y: rect.y + rect.height - handleSize,
    width: handleSize,
    height: handleSize,
  })
}

export function clampBottomRightResize(
  origin: Rect,
  boardDx: number,
  boardDy: number,
  minSize: { width: number; height: number },
  aspectRatio?: number
): LiveResize {
  let width = origin.width + boardDx
  let height = origin.height + boardDy

  if (aspectRatio) {
    if (width >= height * aspectRatio) height = width / aspectRatio
    else width = height * aspectRatio
  }

  if (width < minSize.width) {
    width = minSize.width
    if (aspectRatio) height = width / aspectRatio
  }
  if (height < minSize.height) {
    height = minSize.height
    if (aspectRatio) width = height * aspectRatio
  }

  return { x: origin.x, width, height }
}

export function withLiveResize(
  item: BoardItemModel,
  resize: LiveResize | undefined
): BoardItemModel {
  if (!resize || item.kind === "folder") return item
  return {
    ...item,
    data: {
      ...item.data,
      x: resize.x,
      width: resize.width,
      height: resize.height,
    },
  } as BoardItemModel
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
/** Discrete zoom picker steps (percent). Matches MIN_ZOOM…MAX_ZOOM. */
export const ZOOM_PRESET_PERCENTS = [
  25, 50, 75, 100, 125, 150, 175, 200,
] as const
export const DRAG_THRESHOLD = 5

/**
 * Zoom around the viewport center so content under the middle of the screen
 * stays put while the scale changes.
 */
export function cameraZoomAroundViewportCenter(
  camera: Camera,
  nextZoom: number,
  viewport: Pick<DOMRect, "width" | "height">
): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom))
  const cx = viewport.width / 2
  const cy = viewport.height / 2
  const boardX = (cx - camera.x) / camera.zoom
  const boardY = (cy - camera.y) / camera.zoom
  return {
    zoom,
    x: cx - boardX * zoom,
    y: cy - boardY * zoom,
  }
}

/**
 * Two-finger pan + pinch: keep the board point under `prevCentroid` mapped to
 * `nextCentroid` after scaling zoom by the finger-distance ratio.
 */
export function cameraFromTouchPinchPan(
  camera: Camera,
  viewport: Pick<DOMRect, "left" | "top">,
  prevCentroid: { x: number; y: number },
  nextCentroid: { x: number; y: number },
  prevDistance: number,
  nextDistance: number
): Camera {
  const scale =
    prevDistance > 0 && nextDistance > 0 ? nextDistance / prevDistance : 1
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * scale))

  const prevCx = prevCentroid.x - viewport.left
  const prevCy = prevCentroid.y - viewport.top
  const boardX = (prevCx - camera.x) / camera.zoom
  const boardY = (prevCy - camera.y) / camera.zoom

  const nextCx = nextCentroid.x - viewport.left
  const nextCy = nextCentroid.y - viewport.top
  return {
    zoom: nextZoom,
    x: nextCx - boardX * nextZoom,
    y: nextCy - boardY * nextZoom,
  }
}

/** Average of active pointer screen positions. */
export function pointerCentroid(
  pointers: Iterable<{ x: number; y: number }>
): { x: number; y: number } | null {
  let count = 0
  let sx = 0
  let sy = 0
  for (const p of pointers) {
    sx += p.x
    sy += p.y
    count++
  }
  if (count === 0) return null
  return { x: sx / count, y: sy / count }
}

/** Distance between the first two pointer screen positions. */
export function pointerDistance(
  pointers: Iterable<{ x: number; y: number }>
): number {
  let a: { x: number; y: number } | undefined
  let b: { x: number; y: number } | undefined
  for (const p of pointers) {
    if (!a) {
      a = p
      continue
    }
    b = p
    break
  }
  if (!a || !b) return 0
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * Frame all items in the viewport with padding. Empty boards fall back to a
 * comfortable default camera.
 */
export function cameraFitContent(
  items: readonly BoardItemModel[],
  viewport: Pick<DOMRect, "width" | "height">,
  padding = 48
): Camera {
  if (items.length === 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { x: 80, y: 40, zoom: 0.85 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const item of items) {
    const r = getBoardItemRect(item)
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + r.width)
    maxY = Math.max(maxY, r.y + r.height)
  }

  const contentW = Math.max(1, maxX - minX)
  const contentH = Math.max(1, maxY - minY)
  const availW = Math.max(1, viewport.width - padding * 2)
  const availH = Math.max(1, viewport.height - padding * 2)
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(MIN_ZOOM, Math.min(availW / contentW, availH / contentH))
  )
  const contentCx = (minX + maxX) / 2
  const contentCy = (minY + maxY) / 2
  return {
    zoom,
    x: viewport.width / 2 - contentCx * zoom,
    y: viewport.height / 2 - contentCy * zoom,
  }
}

/**
 * Fraction of the new item's own area that may be covered by an existing item
 * before a candidate slot counts as occupied. Cards are large (a bookmark is
 * 480x252), so demanding zero overlap would push new items far away on a busy
 * board. Allowing a slight graze keeps them close and still legible.
 */
export const SLOT_OVERLAP_LIMIT = 0.25

/** Diagonal step between candidate slots, as a fraction of the item's width. */
export const SLOT_STEP_RATIO = 0.08

/**
 * How much of `subject` is covered by `other`, as a fraction of `subject`'s
 * area. Returns 0 when they don't intersect, 1 when `subject` is fully covered.
 */
export function overlapRatio(subject: Rect, other: Rect): number {
  const area = subject.width * subject.height
  if (area <= 0) return 0

  const overlapWidth =
    Math.min(subject.x + subject.width, other.x + other.width) -
    Math.max(subject.x, other.x)
  const overlapHeight =
    Math.min(subject.y + subject.height, other.y + other.height) -
    Math.max(subject.y, other.y)

  if (overlapWidth <= 0 || overlapHeight <= 0) return 0
  return (overlapWidth * overlapHeight) / area
}

/**
 * Pick where to drop an item the user did not point at (sidebar button,
 * keyboard shortcut). Starts centred in the viewport, then steps diagonally
 * until the candidate is clear enough, stopping before it would leave the
 * visible area.
 *
 * `viewBounds` is the viewport expressed in board coordinates. The returned
 * point is the item's top-left corner, matching how items store `x`/`y`.
 *
 * When every candidate is blocked, falls back to the centred slot: an item that
 * overlaps is recoverable, an item off-screen looks like nothing happened.
 */
export function findEmptySlot(
  occupied: readonly Rect[],
  viewBounds: Rect,
  size: { width: number; height: number }
): { x: number; y: number } {
  const origin = {
    x: viewBounds.x + viewBounds.width / 2 - size.width / 2,
    y: viewBounds.y + viewBounds.height / 2 - size.height / 2,
  }

  const step = Math.max(1, Math.round(size.width * SLOT_STEP_RATIO))

  for (let i = 0; ; i += 1) {
    const candidate = {
      x: origin.x + step * i,
      y: origin.y + step * i,
      width: size.width,
      height: size.height,
    }

    // Stop once the candidate would extend past the visible area. The origin is
    // always tried, even on a viewport too small to contain the item.
    if (
      i > 0 &&
      (candidate.x + candidate.width > viewBounds.x + viewBounds.width ||
        candidate.y + candidate.height > viewBounds.y + viewBounds.height)
    ) {
      return origin
    }

    const blocked = occupied.some(
      (rect) => overlapRatio(candidate, rect) > SLOT_OVERLAP_LIMIT
    )
    if (!blocked) return { x: candidate.x, y: candidate.y }
  }
}
