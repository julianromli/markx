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
