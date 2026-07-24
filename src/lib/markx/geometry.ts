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

export function screenToBoard(
  screenX: number,
  screenY: number,
  camera: Camera,
  viewport: DOMRect,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.left - camera.x) / camera.zoom,
    y: (screenY - viewport.top - camera.y) / camera.zoom,
  }
}

export function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
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
  b: { x: number; y: number; width: number; height: number },
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
  target = IMAGE_FIT_SIZE,
): { width: number; height: number } {
  const ratio = naturalWidth / naturalHeight
  if (ratio >= 1) {
    return { width: target, height: Math.round(target / ratio) }
  }
  return { width: Math.round(target * ratio), height: target }
}

export const MIN_ZOOM = 0.25
export const MAX_ZOOM = 2
export const DRAG_THRESHOLD = 5

/**
 * Find a top-left position near `preferred` that does not overlap any obstacle.
 * Tries the preferred spot first, then spirals outward so new items sit around
 * whatever already occupies the center of the view.
 */
export function findNonOverlappingPosition(
  preferred: { x: number; y: number },
  size: { width: number; height: number },
  obstacles: Rect[],
  options?: { gap?: number; step?: number; maxRings?: number },
): { x: number; y: number } {
  const gap = options?.gap ?? 24
  const step = options?.step ?? 48
  const maxRings = options?.maxRings ?? 24

  const overlaps = (x: number, y: number) => {
    const padded: Rect = {
      x: x - gap / 2,
      y: y - gap / 2,
      width: size.width + gap,
      height: size.height + gap,
    }
    return obstacles.some((obstacle) => intersects(padded, obstacle))
  }

  if (!overlaps(preferred.x, preferred.y)) {
    return { x: preferred.x, y: preferred.y }
  }

  for (let ring = 1; ring <= maxRings; ring++) {
    const dist = ring * step
    const samples = Math.max(8, ring * 8)
    for (let i = 0; i < samples; i++) {
      const angle = (i / samples) * Math.PI * 2
      const x = preferred.x + Math.cos(angle) * dist
      const y = preferred.y + Math.sin(angle) * dist
      if (!overlaps(x, y)) {
        return { x, y }
      }
    }
  }

  // Last resort: cascade away from the preferred point.
  return { x: preferred.x + maxRings * step, y: preferred.y + maxRings * step }
}
