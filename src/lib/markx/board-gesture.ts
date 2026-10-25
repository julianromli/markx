import {
  DRAG_THRESHOLD,
  MIN_BOOKMARK_SIZE,
  MIN_IMAGE_SIZE,
  MIN_NOTE_SIZE,
  RESIZE_HANDLE_SIZE,
  cameraFromTouchPinchPan,
  clampBottomRightResize,
  getBoardItemRect,
  hitTestBoardItems,
  intersects,
  isInBottomRightResizeZone,
  normalizeRect,
  pointInRect,
  pointerCentroid,
  pointerDistance,
  screenToBoard,
} from "./geometry"
import type { BoardItemModel, Camera, LiveResize, Rect } from "./geometry"

/**
 * Board gesture machine: turns raw pointer input into board intents.
 *
 * It owns no DOM and no React state. `Board` feeds it pointer events plus a
 * context snapshot and executes the returned effects. Previews (camera,
 * offsets, marquee, live resize) are effects too, so a test can drive a whole
 * gesture and assert what would be committed.
 */

type Point = { x: number; y: number }

export type ScreenRect = {
  left: number
  top: number
  right: number
  bottom: number
}

export type GestureContext = {
  items: readonly BoardItemModel[]
  selectedIds: ReadonlySet<string>
  editingId?: string
  camera: Camera
  /** Viewport rect in screen coordinates (`getBoundingClientRect`). */
  viewport: { left: number; top: number; width: number; height: number }
  /** Coarse pointer (touch): bigger resize hit zone. */
  coarse: boolean
  /** Phone layout: drop target is the delete dock instead of the trash. */
  mobileDock: boolean
  trashRect: ScreenRect | null
  dockRect: ScreenRect | null
}

export type PointerInput = {
  pointerId: number
  pointerType: string
  button: number
  x: number
  y: number
  time: number
  altKey?: boolean
  metaKey?: boolean
  ctrlKey?: boolean
  shiftKey?: boolean
}

export type GestureEffect =
  | { type: "select"; ids: Set<string> }
  | { type: "open"; id: string }
  | { type: "raise"; ids: string[] }
  | { type: "capture"; pointerIds: number[] }
  | { type: "release"; pointerId: number }
  | { type: "camera"; camera: Camera }
  | { type: "marquee"; rect: Rect | null }
  | { type: "liveOffsets"; offsets: Map<string, Point> }
  | { type: "liveResize"; resize: Map<string, LiveResize> }
  | { type: "moveStart"; count: number }
  | { type: "moveEnd" }
  | { type: "trashArmed"; armed: boolean }
  | { type: "commitMove"; updates: Array<{ id: string; x: number; y: number }> }
  | { type: "commitResize"; id: string; rect: LiveResize }
  | { type: "trashDrop"; ids: string[] }
  | { type: "blankPress" }
  | { type: "flush" }

type DragMode = "pan" | "marquee" | "move" | "pending" | "resize" | "touchPan"

type Drag = {
  mode: DragMode
  pointerId: number
  startScreen: Point
  startBoard: Point
  originCamera: Camera
  itemId?: string
  origins?: Map<string, Point>
  originRect?: Rect
  minSize?: { width: number; height: number }
  aspectRatio?: number
  resizeRect?: LiveResize
  lastCentroid?: Point
  lastDistance?: number
  armed?: boolean
}

const DOUBLE_CLICK_MS = 350

function toViewportRect(ctx: GestureContext): DOMRect {
  const { left, top, width, height } = ctx.viewport
  return { left, top, width, height, x: left, y: top } as DOMRect
}

function inScreenRect(x: number, y: number, r: ScreenRect | null): boolean {
  return !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

export function resizeZoneSize(coarse: boolean, zoom: number): number {
  return coarse ? Math.max(RESIZE_HANDLE_SIZE, 44 / zoom) : RESIZE_HANDLE_SIZE
}

export class BoardGesture {
  private pointers = new Map<number, Point>()
  private drag: Drag | null = null
  private lastClick: { id: string; time: number } | null = null
  anchorId: string | null = null

  get mode(): DragMode | null {
    return this.drag?.mode ?? null
  }

  get activePointerCount(): number {
    return this.pointers.size
  }

  pointerDown(e: PointerInput, ctx: GestureContext): GestureEffect[] {
    this.pointers.set(e.pointerId, { x: e.x, y: e.y })

    if (this.pointers.size >= 2) return this.beginTouchPan(e.pointerId, ctx)
    if (this.drag != null) return []

    const cam = ctx.camera
    const base = {
      pointerId: e.pointerId,
      startScreen: { x: e.x, y: e.y },
      originCamera: { ...cam },
    }

    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.drag = { ...base, mode: "pan", startBoard: { x: 0, y: 0 } }
      return [{ type: "capture", pointerIds: [e.pointerId] }]
    }
    if (e.button !== 0) return []

    const boardPoint = screenToBoard(e.x, e.y, cam, toViewportRect(ctx))
    const hit = hitTestBoardItems(ctx.items, boardPoint.x, boardPoint.y)
    const effects: GestureEffect[] = []

    if (!hit) {
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
        effects.push({ type: "select", ids: new Set() })
      }
      effects.push({ type: "blankPress" })
      effects.push({ type: "capture", pointerIds: [e.pointerId] })
      if (e.pointerType === "touch") {
        this.drag = { ...base, mode: "pan", startBoard: boardPoint }
        return effects
      }
      this.drag = { ...base, mode: "marquee", startBoard: boardPoint }
      effects.push({
        type: "marquee",
        rect: { x: boardPoint.x, y: boardPoint.y, width: 0, height: 0 },
      })
      return effects
    }

    if (hit.id === ctx.editingId) return []

    if (hit.kind !== "folder") {
      const rect = getBoardItemRect(hit)
      const zone = resizeZoneSize(ctx.coarse, cam.zoom)
      if (isInBottomRightResizeZone(boardPoint.x, boardPoint.y, rect, zone)) {
        if (!ctx.selectedIds.has(hit.id)) {
          effects.push({ type: "select", ids: new Set([hit.id]) })
          this.anchorId = hit.id
        }
        effects.push({ type: "raise", ids: [hit.id] })
        effects.push({ type: "capture", pointerIds: [e.pointerId] })
        this.drag = {
          ...base,
          mode: "resize",
          startBoard: boardPoint,
          itemId: hit.id,
          originRect: rect,
          minSize:
            hit.kind === "note"
              ? MIN_NOTE_SIZE
              : hit.kind === "image"
                ? MIN_IMAGE_SIZE
                : MIN_BOOKMARK_SIZE,
          aspectRatio:
            hit.kind === "image"
              ? hit.data.naturalWidth / hit.data.naturalHeight
              : undefined,
        }
        return effects
      }
    }

    const last = this.lastClick
    if (last && last.id === hit.id && e.time - last.time < DOUBLE_CLICK_MS) {
      this.lastClick = null
      return [{ type: "open", id: hit.id }]
    }
    this.lastClick = { id: hit.id, time: e.time }

    const nextSelection = this.selectionForPress(hit, e, ctx)
    if (nextSelection.changed) {
      effects.push({ type: "select", ids: nextSelection.ids })
    }
    effects.push({ type: "raise", ids: [...nextSelection.ids] })

    const origins = new Map<string, Point>()
    for (const item of ctx.items) {
      if (nextSelection.ids.has(item.id)) {
        origins.set(item.id, { x: item.data.x, y: item.data.y })
      }
    }
    effects.push({ type: "capture", pointerIds: [e.pointerId] })
    this.drag = {
      ...base,
      mode: "pending",
      startBoard: boardPoint,
      itemId: hit.id,
      origins,
    }
    return effects
  }

  pointerMove(e: PointerInput, ctx: GestureContext): GestureEffect[] {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.x, y: e.y })
    }
    const drag = this.drag
    if (!drag) return []

    if (drag.mode === "touchPan") {
      if (this.pointers.size < 2) return []
      const centroid = pointerCentroid(this.pointers.values())
      const distance = pointerDistance(this.pointers.values())
      if (!centroid || !drag.lastCentroid) return []
      const camera = cameraFromTouchPinchPan(
        ctx.camera,
        toViewportRect(ctx),
        drag.lastCentroid,
        centroid,
        drag.lastDistance ?? distance,
        distance
      )
      drag.lastCentroid = centroid
      drag.lastDistance = distance
      return [{ type: "camera", camera }]
    }

    if (drag.pointerId !== e.pointerId) return []

    const dx = e.x - drag.startScreen.x
    const dy = e.y - drag.startScreen.y
    const zoom = ctx.camera.zoom

    if (drag.mode === "pan") {
      return [
        {
          type: "camera",
          camera: {
            ...drag.originCamera,
            x: drag.originCamera.x + dx,
            y: drag.originCamera.y + dy,
          },
        },
      ]
    }

    if (drag.mode === "marquee") {
      const current = screenToBoard(e.x, e.y, ctx.camera, toViewportRect(ctx))
      const rect = normalizeRect(drag.startBoard, current)
      const additive = !!(e.metaKey || e.ctrlKey)
      const ids = additive ? new Set(ctx.selectedIds) : new Set<string>()
      for (const item of ctx.items) {
        if (intersects(rect, getBoardItemRect(item))) ids.add(item.id)
      }
      return [
        { type: "marquee", rect },
        { type: "select", ids },
      ]
    }

    if (drag.mode === "resize" && drag.originRect && drag.itemId) {
      const next = clampBottomRightResize(
        drag.originRect,
        dx / zoom,
        dy / zoom,
        drag.minSize ?? MIN_BOOKMARK_SIZE,
        drag.aspectRatio
      )
      drag.resizeRect = next
      return [{ type: "liveResize", resize: new Map([[drag.itemId, next]]) }]
    }

    const effects: GestureEffect[] = []
    if (drag.mode === "pending") {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return []
      drag.mode = "move"
      effects.push({ type: "moveStart", count: drag.origins?.size ?? 1 })
    }

    if (drag.mode === "move" && drag.origins) {
      const offsets = new Map<string, Point>()
      for (const [id, origin] of drag.origins) {
        offsets.set(id, { x: origin.x + dx / zoom, y: origin.y + dy / zoom })
      }
      effects.push({ type: "liveOffsets", offsets })
      const armed = this.isOverDropTarget(e, ctx)
      if (armed !== !!drag.armed) {
        drag.armed = armed
        effects.push({ type: "trashArmed", armed })
      }
    }
    return effects
  }

  pointerUp(e: PointerInput, ctx: GestureContext): GestureEffect[] {
    this.pointers.delete(e.pointerId)
    const effects: GestureEffect[] = [
      { type: "release", pointerId: e.pointerId },
    ]
    const drag = this.drag
    if (!drag) return effects

    if (drag.mode === "touchPan") {
      // Stay in touchPan until every finger lifts so the remaining finger
      // does not accidentally start a marquee or card drag.
      if (this.pointers.size === 0) {
        effects.push({ type: "flush" })
        this.drag = null
      } else if (this.pointers.size >= 2) {
        const centroid = pointerCentroid(this.pointers.values())
        if (centroid) {
          drag.lastCentroid = centroid
          drag.lastDistance = pointerDistance(this.pointers.values())
        }
      }
      return effects
    }

    if (drag.pointerId !== e.pointerId) return effects
    effects.push({ type: "flush" })

    if (drag.mode === "marquee") effects.push({ type: "marquee", rect: null })

    if (drag.mode === "resize" && drag.itemId) {
      if (drag.resizeRect) {
        effects.push({
          type: "commitResize",
          id: drag.itemId,
          rect: drag.resizeRect,
        })
      }
      effects.push({ type: "liveResize", resize: new Map() })
    }

    if (drag.mode === "move" && drag.origins) {
      if (this.isOverDropTarget(e, ctx)) {
        effects.push({ type: "trashDrop", ids: [...drag.origins.keys()] })
      } else {
        const zoom = ctx.camera.zoom
        const boardDx = (e.x - drag.startScreen.x) / zoom
        const boardDy = (e.y - drag.startScreen.y) / zoom
        effects.push({
          type: "commitMove",
          updates: [...drag.origins.entries()].map(([id, origin]) => ({
            id,
            x: origin.x + boardDx,
            y: origin.y + boardDy,
          })),
        })
      }
      effects.push({ type: "liveOffsets", offsets: new Map() })
      effects.push(...this.endMoveUi(drag))
    }

    this.drag = null
    return effects
  }

  /**
   * The browser took the pointer (native scroll, system gesture, call).
   * Cancel coordinates are unreliable (Chromium reports 0,0), so a cancel
   * never commits: it drops every preview and reverts to the origin.
   */
  pointerCancel(e: PointerInput): GestureEffect[] {
    this.pointers.delete(e.pointerId)
    const effects: GestureEffect[] = [
      { type: "release", pointerId: e.pointerId },
    ]
    const drag = this.drag
    if (!drag) return effects
    if (drag.mode === "touchPan") {
      if (this.pointers.size === 0) {
        effects.push({ type: "flush" })
        this.drag = null
      }
      return effects
    }
    if (drag.pointerId !== e.pointerId) return effects
    return [...effects, ...this.abort()]
  }

  /** Drop an in-progress one-finger gesture without committing it. */
  private abort(): GestureEffect[] {
    const drag = this.drag
    if (!drag || drag.mode === "touchPan") return []
    const effects: GestureEffect[] = [{ type: "flush" }]
    if (drag.mode === "pan") {
      effects.push({ type: "camera", camera: drag.originCamera })
    }
    if (drag.mode === "marquee") effects.push({ type: "marquee", rect: null })
    if (drag.mode === "resize") {
      effects.push({ type: "liveResize", resize: new Map() })
    }
    if (drag.mode === "move" || drag.mode === "pending") {
      effects.push({ type: "liveOffsets", offsets: new Map() })
      if (drag.mode === "move") effects.push(...this.endMoveUi(drag))
    }
    this.drag = null
    return effects
  }

  private endMoveUi(drag: Drag): GestureEffect[] {
    const effects: GestureEffect[] = [{ type: "moveEnd" }]
    if (drag.armed) effects.push({ type: "trashArmed", armed: false })
    drag.armed = false
    return effects
  }

  private beginTouchPan(
    pointerId: number,
    ctx: GestureContext
  ): GestureEffect[] {
    const effects = this.abort()
    effects.push({ type: "capture", pointerIds: [...this.pointers.keys()] })
    const centroid = pointerCentroid(this.pointers.values())
    if (!centroid || this.pointers.size < 2) return effects
    this.drag = {
      mode: "touchPan",
      pointerId,
      startScreen: { ...centroid },
      startBoard: { x: 0, y: 0 },
      originCamera: { ...ctx.camera },
      lastCentroid: centroid,
      lastDistance: pointerDistance(this.pointers.values()),
    }
    return effects
  }

  private isOverDropTarget(e: PointerInput, ctx: GestureContext): boolean {
    return inScreenRect(e.x, e.y, ctx.mobileDock ? ctx.dockRect : ctx.trashRect)
  }

  private selectionForPress(
    hit: BoardItemModel,
    e: PointerInput,
    ctx: GestureContext
  ): { ids: Set<string>; changed: boolean } {
    if (e.shiftKey && this.anchorId) {
      const anchor = ctx.items.find((i) => i.id === this.anchorId)
      let ids = new Set([hit.id])
      if (anchor) {
        const a = getBoardItemRect(anchor)
        const b = getBoardItemRect(hit)
        const union = normalizeRect(
          { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
          {
            x: Math.max(a.x + a.width, b.x + b.width),
            y: Math.max(a.y + a.height, b.y + b.height),
          }
        )
        ids = new Set()
        for (const item of ctx.items) {
          const r = getBoardItemRect(item)
          if (pointInRect(r.x + r.width / 2, r.y + r.height / 2, union)) {
            ids.add(item.id)
          }
        }
      }
      return { ids, changed: true }
    }
    if (e.metaKey || e.ctrlKey) {
      const ids = new Set(ctx.selectedIds)
      if (ids.has(hit.id)) ids.delete(hit.id)
      else ids.add(hit.id)
      this.anchorId = hit.id
      return { ids, changed: true }
    }
    this.anchorId = hit.id
    if (ctx.selectedIds.has(hit.id)) {
      // Keep multi-selection when dragging an already-selected item.
      return { ids: new Set(ctx.selectedIds), changed: false }
    }
    return { ids: new Set([hit.id]), changed: true }
  }
}
