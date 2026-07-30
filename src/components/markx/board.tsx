import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react"

import { DeleteDock } from "@/components/markx/delete-dock"
import { useIsMobile } from "@/hooks/use-mobile"
import { pointInElement, vibrateDeleteFeedback } from "@/lib/markx/delete-dock"
import { cn } from "@/lib/utils"
import {
  DIRECTION_VECTORS,
  DRAG_THRESHOLD,
  MAX_ZOOM,
  MIN_BOOKMARK_SIZE,
  MIN_IMAGE_SIZE,
  MIN_NOTE_SIZE,
  MIN_ZOOM,
  RESIZE_HANDLE_SIZE,
  cameraFitContent,
  cameraFromTouchPinchPan,
  cameraZoomAroundViewportCenter,
  clampBottomRightResize,
  findNearestInDirection,
  getBoardItemRect,
  hitTestBoardItems,
  intersects,
  isInBottomRightResizeZone,
  normalizeRect,
  pointerCentroid,
  pointerDistance,
  screenToBoard,
  withLiveResize,
} from "@/lib/markx/geometry"
import type {
  BoardItemModel,
  Camera,
  Direction,
  LiveResize,
  Rect,
} from "@/lib/markx/geometry"

export type { BoardItemModel } from "@/lib/markx/geometry"

/** Keyboard nudge distance in board units (Shift for the coarse step). */
const KEYBOARD_MOVE_STEP = 10
const KEYBOARD_MOVE_STEP_SHIFT = 50
const DOUBLE_TAP_DELAY_MS = 350
const DOUBLE_TAP_MAX_DISTANCE = 32

const ARROW_DIRECTIONS: Partial<Record<string, Direction>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
}

export type BoardApi = {
  getViewCenter: () => { x: number; y: number }
  /** The visible area in board coordinates, for placing items the user didn't point at. */
  getViewBounds: () => Rect
  /** Zoom to a percent (25–200), keeping the viewport center stable. */
  setZoomPercent: (percent: number) => void
  /** Fit all board items in the viewport with padding. */
  fitToContent: () => void
}

type BoardProps = {
  items: BoardItemModel[]
  selectedIds: Set<string>
  onSelectedIdsChange: (ids: Set<string>) => void
  onRaiseZ: (ids: string[]) => void
  onMoveItems: (updates: Array<{ id: string; x: number; y: number }>) => void
  onResizeItem: (
    id: string,
    rect: { x: number; width: number; height: number }
  ) => void
  onOpenItem: (id: string) => void
  onTrashDrop: (ids: string[]) => void
  renderItem: (
    item: BoardItemModel,
    selected: boolean,
    dragging: boolean
  ) => ReactNode
  trashRef: React.RefObject<HTMLElement | null>
  /** Desktop sidebar trash (and any host chrome) can mirror armed feedback. */
  onTrashArmedChange?: (armed: boolean) => void
  /** True while items are past the move threshold (drag in progress). */
  onItemMoveDragChange?: (active: boolean) => void
  onZoomChange?: (zoomPercent: number) => void
  onContextPoint?: (point: { x: number; y: number }) => void
  /** Request the host context menu after a stationary two-tap on empty mobile board space. */
  onBlankDoubleTap?: (point: { x: number; y: number }) => void
  /** Rename via keyboard (F2). Pointer rename stays on the context menu. */
  onRenameItem?: (id: string) => void
  /** Accessible name for each item, announced when it receives focus. */
  getItemLabel?: (item: BoardItemModel) => string
  editingId?: string
  boardApiRef?: React.RefObject<BoardApi | null>
  className?: string
}

type DragState = {
  mode: "pan" | "marquee" | "move" | "pending" | "resize" | "touchPan"
  pointerId: number
  startScreen: { x: number; y: number }
  startBoard: { x: number; y: number }
  originCamera: Camera
  itemId?: string
  origins?: Map<string, { x: number; y: number }>
  originRect?: Rect
  minSize?: { width: number; height: number }
  aspectRatio?: number
  /** Last two-finger centroid (screen coords) while in touchPan. */
  lastCentroid?: { x: number; y: number }
  /** Last two-finger span while in touchPan. */
  lastDistance?: number
}

type PendingGesture = {
  camera?: Camera
  liveOffsets?: Map<string, { x: number; y: number }>
  liveResize?: Map<string, LiveResize>
  marquee?: Rect | null
}

export function Board({
  items,
  selectedIds,
  onSelectedIdsChange,
  onRaiseZ,
  onMoveItems,
  onResizeItem,
  onOpenItem,
  onTrashDrop,
  renderItem,
  trashRef,
  onTrashArmedChange,
  onItemMoveDragChange,
  onZoomChange,
  onContextPoint,
  onBlankDoubleTap,
  onRenameItem,
  getItemLabel,
  editingId,
  boardApiRef,
  className,
}: BoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const deleteDockHitRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const [moveDockOpen, setMoveDockOpen] = useState(false)
  const [trashArmed, setTrashArmed] = useState(false)
  const [dragItemCount, setDragItemCount] = useState(1)
  const trashArmedRef = useRef(false)
  const onTrashArmedChangeRef = useRef(onTrashArmedChange)
  const onItemMoveDragChangeRef = useRef(onItemMoveDragChange)
  const onZoomChangeRef = useRef(onZoomChange)
  // Start zoomed-out on small screens so the large default items (bookmarks,
  // notes, folders) are visible without an immediate pinch-out. The lazy
  // initializer reads window once on the client; the wrapper div carries
  // `suppressHydrationWarning` to absorb the resulting style delta from SSR.
  const [camera, setCamera] = useState<Camera>(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      return { x: 16, y: 24, zoom: 0.5 }
    }
    return { x: 80, y: 40, zoom: 0.85 }
  })
  const cameraRef = useRef(camera)
  const lastNotifiedZoomRef = useRef(camera.zoom)

  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [liveOffsets, setLiveOffsets] = useState<
    Map<string, { x: number; y: number }>
  >(new Map())
  const [liveResize, setLiveResize] = useState<Map<string, LiveResize>>(
    new Map()
  )
  const dragRef = useRef<DragState | null>(null)
  /** Active pointer screen positions for multi-touch pan/pinch. */
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const selectedRef = useRef(selectedIds)
  const itemsRef = useRef(items)
  const anchorIdRef = useRef<string | null>(null)
  const lastClickRef = useRef<{ id: string; time: number } | null>(null)
  const lastBlankTouchTapRef = useRef<{
    x: number
    y: number
    time: number
  } | null>(null)
  const resizeRectRef = useRef<LiveResize | null>(null)
  /** Roving-tabindex stop for keyboard users reaching the canvas via Tab. */
  const [tabStopId, setTabStopId] = useState<string | null>(null)
  /**
   * Whether the last input came from keyboard or pointer. Focus events can't
   * tell them apart, but only keyboard focus should change the selection —
   * otherwise Cmd+click multi-select would collapse on every click.
   */
  const modalityRef = useRef<"pointer" | "keyboard">("pointer")
  const prevEditingIdRef = useRef<string | null>(null)
  /**
   * Ids present since this board mounted. The `.board-item-in` entrance
   * animation is for newly created items only — without this gate it fires
   * for every item on initial load, navigation, and sync remounts.
   * `null` until the first layout effect seeds it (SSR-safe).
   */
  const seenIdsRef = useRef<Set<string> | null>(null)

  // Coalesce gesture previews to one React commit per frame (single write path).
  const rafIdRef = useRef<number | null>(null)
  const pendingRef = useRef<PendingGesture>({})

  useLayoutEffect(() => {
    onTrashArmedChangeRef.current = onTrashArmedChange
    onItemMoveDragChangeRef.current = onItemMoveDragChange
    onZoomChangeRef.current = onZoomChange
    cameraRef.current = camera
    selectedRef.current = selectedIds
    itemsRef.current = items
  })

  const commitCamera = useCallback((next: Camera) => {
    cameraRef.current = next
    setCamera(next)
    if (next.zoom !== lastNotifiedZoomRef.current) {
      lastNotifiedZoomRef.current = next.zoom
      onZoomChangeRef.current?.(Math.round(next.zoom * 100))
    }
  }, [])

  const setTrashArmedState = useCallback((next: boolean) => {
    if (trashArmedRef.current === next) return
    trashArmedRef.current = next
    setTrashArmed(next)
    onTrashArmedChangeRef.current?.(next)
    if (next) vibrateDeleteFeedback("armed")
  }, [])

  const clearMoveTrashUi = useCallback(() => {
    setMoveDockOpen(false)
    setTrashArmedState(false)
    onItemMoveDragChangeRef.current?.(false)
  }, [setTrashArmedState])

  useEffect(() => {
    if (!boardApiRef) return
    boardApiRef.current = {
      getViewCenter: () => {
        const viewport = viewportRef.current
        if (!viewport) return { x: 0, y: 0 }
        const rect = viewport.getBoundingClientRect()
        return screenToBoard(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          cameraRef.current,
          rect
        )
      },
      getViewBounds: () => {
        const viewport = viewportRef.current
        if (!viewport) return { x: 0, y: 0, width: 0, height: 0 }
        const rect = viewport.getBoundingClientRect()
        const cam = cameraRef.current
        const origin = screenToBoard(rect.left, rect.top, cam, rect)
        return {
          x: origin.x,
          y: origin.y,
          width: rect.width / cam.zoom,
          height: rect.height / cam.zoom,
        }
      },
      setZoomPercent: (percent: number) => {
        const viewport = viewportRef.current
        if (!viewport) return
        const rect = viewport.getBoundingClientRect()
        const next = cameraZoomAroundViewportCenter(
          cameraRef.current,
          percent / 100,
          rect
        )
        commitCamera(next)
      },
      fitToContent: () => {
        const viewport = viewportRef.current
        if (!viewport) return
        const rect = viewport.getBoundingClientRect()
        const next = cameraFitContent(itemsRef.current, rect)
        commitCamera(next)
      },
    }
  })

  const flushPending = () => {
    const pending = pendingRef.current
    pendingRef.current = {}
    if (pending.camera) {
      commitCamera(pending.camera)
    }
    if (pending.liveOffsets) setLiveOffsets(pending.liveOffsets)
    if (pending.liveResize) setLiveResize(pending.liveResize)
    if ("marquee" in pending) setMarquee(pending.marquee ?? null)
  }

  const scheduleFlush = () => {
    if (rafIdRef.current != null) return
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null
      flushPending()
    })
  }

  const flushNow = () => {
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = null
    }
    flushPending()
  }

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current)
    }
  }, [])

  const hitTest = useCallback(
    (boardX: number, boardY: number) =>
      hitTestBoardItems(itemsRef.current, boardX, boardY),
    []
  )

  // Any keypress implies keyboard modality until the next pointer press.
  useEffect(() => {
    const onKey = () => {
      modalityRef.current = "keyboard"
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Record ids after each commit; during render, an id not yet in the set is
  // a genuinely new item and gets the entrance animation for that one commit.
  useLayoutEffect(() => {
    const seen = seenIdsRef.current ?? new Set<string>()
    for (const item of items) seen.add(item.id)
    seenIdsRef.current = seen
  }, [items])

  const focusItem = (id: string) => {
    viewportRef.current
      ?.querySelector<HTMLElement>(`[data-board-item="${id}"]`)
      ?.focus()
  }

  // Return focus to the note card when keyboard-driven editing ends, so the
  // user lands back where they were instead of on <body>.
  useEffect(() => {
    const prev = prevEditingIdRef.current
    prevEditingIdRef.current = editingId ?? null
    if (prev && !editingId && modalityRef.current === "keyboard") {
      focusItem(prev)
    }
  }, [editingId])

  const selectAndFocus = (id: string) => {
    onSelectedIdsChange(new Set([id]))
    anchorIdRef.current = id
    setTabStopId(id)
    // tabIndex=-1 elements accept programmatic focus, so this works before
    // the roving-tabindex rerender lands.
    focusItem(id)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editingId) return
    const target = e.target as HTMLElement
    // Only act when the item wrapper itself has focus; inner controls (note
    // editor, buttons) keep their native key behavior.
    if (!target.hasAttribute("data-board-item")) return
    const id = target.getAttribute("data-board-item")
    if (!id) return

    if (e.key === "Enter") {
      e.preventDefault()
      onOpenItem(id)
      return
    }
    if (e.key === "F2") {
      e.preventDefault()
      onRenameItem?.(id)
      return
    }

    const direction = ARROW_DIRECTIONS[e.key]
    if (!direction) return
    e.preventDefault()

    if (e.altKey) {
      if (selectedRef.current.size === 0) return
      const step = e.shiftKey ? KEYBOARD_MOVE_STEP_SHIFT : KEYBOARD_MOVE_STEP
      const vector = DIRECTION_VECTORS[direction]
      const updates: Array<{ id: string; x: number; y: number }> = []
      for (const selectedId of selectedRef.current) {
        const item = itemsRef.current.find((i) => i.id === selectedId)
        if (!item) continue
        updates.push({
          id: selectedId,
          x: item.data.x + vector.x * step,
          y: item.data.y + vector.y * step,
        })
      }
      if (updates.length > 0) onMoveItems(updates)
      return
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey) return

    const rects = itemsRef.current.map((item) => ({
      id: item.id,
      rect: getBoardItemRect(item),
    }))
    const next = findNearestInDirection(rects, id, direction)
    if (next) selectAndFocus(next)
  }

  const getViewportRect = () => viewportRef.current!.getBoundingClientRect()

  const applySelectionFromMarquee = (rect: Rect, additive: boolean) => {
    const next = additive ? new Set(selectedRef.current) : new Set<string>()
    for (const item of itemsRef.current) {
      if (intersects(rect, getBoardItemRect(item))) next.add(item.id)
    }
    onSelectedIdsChange(next)
  }

  const releasePointer = (target: HTMLDivElement, pointerId: number) => {
    try {
      target.releasePointerCapture(pointerId)
    } catch {
      // already released
    }
  }

  const capturePointer = (target: HTMLDivElement, pointerId: number) => {
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // synthetic pointer events (test/automation) have no active pointer
    }
  }

  /** Drop an in-progress one-finger gesture without committing move/resize. */
  const abortSingleFingerGesture = () => {
    const drag = dragRef.current
    if (!drag || drag.mode === "touchPan") return

    flushNow()

    if (drag.mode === "marquee") {
      pendingRef.current.marquee = null
      setMarquee(null)
    }
    if (drag.mode === "resize") {
      resizeRectRef.current = null
      pendingRef.current.liveResize = new Map()
      setLiveResize(new Map())
    }
    if (drag.mode === "move" || drag.mode === "pending") {
      pendingRef.current.liveOffsets = new Map()
      setLiveOffsets(new Map())
      clearMoveTrashUi()
    }
    dragRef.current = null
  }

  const beginTouchPan = (target: HTMLDivElement, pointerId: number) => {
    abortSingleFingerGesture()
    lastBlankTouchTapRef.current = null
    for (const id of pointersRef.current.keys()) {
      try {
        capturePointer(target, id)
      } catch {
        // pointer may already be gone
      }
    }
    const centroid = pointerCentroid(pointersRef.current.values())
    const distance = pointerDistance(pointersRef.current.values())
    if (!centroid || pointersRef.current.size < 2) return
    const cam = cameraRef.current
    dragRef.current = {
      mode: "touchPan",
      pointerId,
      startScreen: { ...centroid },
      startBoard: { x: 0, y: 0 },
      originCamera: { ...cam },
      lastCentroid: centroid,
      lastDistance: distance,
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return

    modalityRef.current = "pointer"
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    // Second (or later) finger: switch to two-finger pan + pinch.
    if (pointersRef.current.size >= 2) {
      beginTouchPan(e.currentTarget, e.pointerId)
      return
    }

    // Ignore extra pointers if somehow already gesturing without a map entry.
    if (dragRef.current != null) return

    const cam = cameraRef.current
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      capturePointer(e.currentTarget, e.pointerId)
      dragRef.current = {
        mode: "pan",
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        startBoard: { x: 0, y: 0 },
        originCamera: { ...cam },
      }
      return
    }
    if (e.button !== 0) return

    const viewport = getViewportRect()
    const boardPoint = screenToBoard(e.clientX, e.clientY, cam, viewport)
    const hit = hitTest(boardPoint.x, boardPoint.y)

    if (!hit) {
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
        onSelectedIdsChange(new Set())
      }
      capturePointer(e.currentTarget, e.pointerId)
      dragRef.current = {
        mode: "marquee",
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        startBoard: boardPoint,
        originCamera: { ...cam },
      }
      setMarquee({ x: boardPoint.x, y: boardPoint.y, width: 0, height: 0 })
      return
    }

    lastBlankTouchTapRef.current = null

    if (hit.id === editingId) {
      return
    }

    if (
      hit.kind === "bookmark" ||
      hit.kind === "note" ||
      hit.kind === "image"
    ) {
      const rect = getBoardItemRect(hit)
      const minSize =
        hit.kind === "note"
          ? MIN_NOTE_SIZE
          : hit.kind === "image"
            ? MIN_IMAGE_SIZE
            : MIN_BOOKMARK_SIZE
      const aspectRatio =
        hit.kind === "image"
          ? hit.data.naturalWidth / hit.data.naturalHeight
          : undefined
      if (
        isInBottomRightResizeZone(
          boardPoint.x,
          boardPoint.y,
          rect,
          isMobile
            ? Math.max(RESIZE_HANDLE_SIZE, 44 / cam.zoom)
            : RESIZE_HANDLE_SIZE
        )
      ) {
        if (!selectedRef.current.has(hit.id)) {
          onSelectedIdsChange(new Set([hit.id]))
          anchorIdRef.current = hit.id
        }
        onRaiseZ([hit.id])
        capturePointer(e.currentTarget, e.pointerId)
        dragRef.current = {
          mode: "resize",
          pointerId: e.pointerId,
          startScreen: { x: e.clientX, y: e.clientY },
          startBoard: boardPoint,
          originCamera: { ...cam },
          itemId: hit.id,
          originRect: rect,
          minSize,
          aspectRatio,
        }
        return
      }
    }

    const now = Date.now()
    const last = lastClickRef.current
    if (last && last.id === hit.id && now - last.time < DOUBLE_TAP_DELAY_MS) {
      onOpenItem(hit.id)
      lastClickRef.current = null
      return
    }
    lastClickRef.current = { id: hit.id, time: now }

    const additive = e.metaKey || e.ctrlKey
    let nextSelection: Set<string>

    if (e.shiftKey && anchorIdRef.current) {
      const anchor = itemsRef.current.find((i) => i.id === anchorIdRef.current)
      const target = itemsRef.current.find((i) => i.id === hit.id)
      nextSelection = new Set([hit.id])
      if (anchor && target) {
        const a = getBoardItemRect(anchor)
        const b = getBoardItemRect(target)
        const union = normalizeRect(
          { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
          {
            x: Math.max(a.x + a.width, b.x + b.width),
            y: Math.max(a.y + a.height, b.y + b.height),
          }
        )
        nextSelection = new Set()
        for (const item of itemsRef.current) {
          const r = getBoardItemRect(item)
          const cx = r.x + r.width / 2
          const cy = r.y + r.height / 2
          if (
            cx >= union.x &&
            cx <= union.x + union.width &&
            cy >= union.y &&
            cy <= union.y + union.height
          ) {
            nextSelection.add(item.id)
          }
        }
      }
      onSelectedIdsChange(nextSelection)
    } else if (additive) {
      nextSelection = new Set(selectedRef.current)
      if (nextSelection.has(hit.id)) nextSelection.delete(hit.id)
      else nextSelection.add(hit.id)
      onSelectedIdsChange(nextSelection)
      anchorIdRef.current = hit.id
    } else if (selectedRef.current.has(hit.id)) {
      // Keep multi-selection when dragging an already-selected item
      nextSelection = new Set(selectedRef.current)
      anchorIdRef.current = hit.id
    } else {
      nextSelection = new Set([hit.id])
      onSelectedIdsChange(nextSelection)
      anchorIdRef.current = hit.id
    }

    onRaiseZ([...nextSelection])
    const movingIds = new Set(nextSelection)
    const origins = new Map<string, { x: number; y: number }>()
    for (const item of itemsRef.current) {
      if (movingIds.has(item.id)) {
        origins.set(item.id, { x: item.data.x, y: item.data.y })
      }
    }

    capturePointer(e.currentTarget, e.pointerId)
    dragRef.current = {
      mode: "pending",
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startBoard: boardPoint,
      originCamera: { ...cam },
      itemId: hit.id,
      origins,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    }

    const drag = dragRef.current
    if (!drag) return

    if (drag.mode === "touchPan") {
      if (pointersRef.current.size < 2) return
      const centroid = pointerCentroid(pointersRef.current.values())
      const distance = pointerDistance(pointersRef.current.values())
      if (!centroid || !drag.lastCentroid) return

      const viewport = getViewportRect()
      const prev = pendingRef.current.camera ?? cameraRef.current
      const next = cameraFromTouchPinchPan(
        prev,
        viewport,
        drag.lastCentroid,
        centroid,
        drag.lastDistance ?? distance,
        distance
      )
      drag.lastCentroid = centroid
      drag.lastDistance = distance
      cameraRef.current = next
      pendingRef.current.camera = next
      scheduleFlush()
      return
    }

    if (drag.pointerId !== e.pointerId) return

    const dx = e.clientX - drag.startScreen.x
    const dy = e.clientY - drag.startScreen.y
    const zoom = cameraRef.current.zoom

    if (drag.mode === "pan") {
      const next: Camera = {
        ...drag.originCamera,
        x: drag.originCamera.x + dx,
        y: drag.originCamera.y + dy,
      }
      cameraRef.current = next
      pendingRef.current.camera = next
      scheduleFlush()
      return
    }

    if (drag.mode === "marquee") {
      const viewport = getViewportRect()
      const current = screenToBoard(
        e.clientX,
        e.clientY,
        cameraRef.current,
        viewport
      )
      const rect = normalizeRect(drag.startBoard, current)
      pendingRef.current.marquee = rect
      scheduleFlush()
      applySelectionFromMarquee(rect, e.metaKey || e.ctrlKey)
      if (
        e.pointerType === "touch" &&
        Math.hypot(
          e.clientX - drag.startScreen.x,
          e.clientY - drag.startScreen.y
        ) >= DRAG_THRESHOLD
      ) {
        lastBlankTouchTapRef.current = null
      }
      return
    }

    if (drag.mode === "resize" && drag.originRect && drag.itemId) {
      const next = clampBottomRightResize(
        drag.originRect,
        dx / zoom,
        dy / zoom,
        drag.minSize ?? MIN_BOOKMARK_SIZE,
        drag.aspectRatio
      )
      resizeRectRef.current = next
      pendingRef.current.liveResize = new Map([[drag.itemId, next]])
      scheduleFlush()
      return
    }

    if (drag.mode === "pending") {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      drag.mode = "move"
      setDragItemCount(drag.origins?.size ?? 1)
      onItemMoveDragChangeRef.current?.(true)
      if (isMobile) {
        setMoveDockOpen(true)
      }
    }

    if (drag.mode === "move" && drag.origins) {
      const boardDx = dx / zoom
      const boardDy = dy / zoom
      const next = new Map<string, { x: number; y: number }>()
      for (const [id, origin] of drag.origins) {
        next.set(id, { x: origin.x + boardDx, y: origin.y + boardDy })
      }
      pendingRef.current.liveOffsets = next
      scheduleFlush()

      const overTrash = isMobile
        ? pointInElement(e.clientX, e.clientY, deleteDockHitRef.current)
        : pointInElement(e.clientX, e.clientY, trashRef.current)
      setTrashArmedState(Boolean(overTrash))
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId)
    releasePointer(e.currentTarget, e.pointerId)

    const drag = dragRef.current
    if (!drag) return

    if (drag.mode === "touchPan") {
      // Stay in touchPan until every finger lifts so the remaining finger
      // does not accidentally start a marquee / card drag.
      if (pointersRef.current.size === 0) {
        flushNow()
        dragRef.current = null
        lastBlankTouchTapRef.current = null
      } else if (pointersRef.current.size >= 2) {
        const centroid = pointerCentroid(pointersRef.current.values())
        const distance = pointerDistance(pointersRef.current.values())
        if (centroid) {
          drag.lastCentroid = centroid
          drag.lastDistance = distance
        }
      }
      return
    }

    if (drag.pointerId !== e.pointerId) return

    flushNow()

    if (drag.mode === "marquee") {
      setMarquee(null)
      const isStationarySingleTouch =
        e.type === "pointerup" &&
        e.pointerType === "touch" &&
        pointersRef.current.size === 0 &&
        Math.hypot(
          e.clientX - drag.startScreen.x,
          e.clientY - drag.startScreen.y
        ) < DRAG_THRESHOLD

      if (isStationarySingleTouch) {
        const now = Date.now()
        const lastTap = lastBlankTouchTapRef.current
        if (
          lastTap &&
          now - lastTap.time < DOUBLE_TAP_DELAY_MS &&
          Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <=
            DOUBLE_TAP_MAX_DISTANCE
        ) {
          onBlankDoubleTap?.({ x: e.clientX, y: e.clientY })
          lastBlankTouchTapRef.current = null
        } else {
          lastBlankTouchTapRef.current = {
            x: e.clientX,
            y: e.clientY,
            time: now,
          }
        }
      } else {
        lastBlankTouchTapRef.current = null
      }
    }

    if (drag.mode === "resize" && drag.itemId) {
      const rect = resizeRectRef.current
      if (rect) onResizeItem(drag.itemId, rect)
      resizeRectRef.current = null
      setLiveResize(new Map())
    }

    if (drag.mode === "move" && drag.origins) {
      const overTrash = isMobile
        ? pointInElement(e.clientX, e.clientY, deleteDockHitRef.current)
        : pointInElement(e.clientX, e.clientY, trashRef.current)

      if (overTrash) {
        vibrateDeleteFeedback("commit")
        onTrashDrop([...drag.origins.keys()])
      } else {
        const zoom = cameraRef.current.zoom
        const boardDx = (e.clientX - drag.startScreen.x) / zoom
        const boardDy = (e.clientY - drag.startScreen.y) / zoom
        const updates = [...drag.origins.entries()].map(([id, origin]) => ({
          id,
          x: origin.x + boardDx,
          y: origin.y + boardDy,
        }))
        onMoveItems(updates)
      }
      setLiveOffsets(new Map())
      clearMoveTrashUi()
    }

    dragRef.current = null
  }

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const viewport = el.getBoundingClientRect()
      const prev = pendingRef.current.camera ?? cameraRef.current

      // Pinch-zoom (ctrl/meta) or trackpad pinch
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.0015
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, prev.zoom * (1 + delta))
        )
        const cursorX = e.clientX - viewport.left
        const cursorY = e.clientY - viewport.top
        const boardX = (cursorX - prev.x) / prev.zoom
        const boardY = (cursorY - prev.y) / prev.zoom
        const next: Camera = {
          zoom: nextZoom,
          x: cursorX - boardX * nextZoom,
          y: cursorY - boardY * nextZoom,
        }
        cameraRef.current = next
        pendingRef.current.camera = next
        scheduleFlush()
        return
      }

      // Trackpad pan (two-finger scroll).
      const next: Camera = {
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }
      cameraRef.current = next
      pendingRef.current.camera = next
      scheduleFlush()
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items])
  const tabStop =
    tabStopId && itemIds.has(tabStopId)
      ? tabStopId
      : anchorIdRef.current && itemIds.has(anchorIdRef.current)
        ? anchorIdRef.current
        : (items[0]?.id ?? null)

  // Keep DOM order stable. Stacking uses `style.zIndex` (item.data.z); hit-testing
  // sorts by z independently. Sorting the list here would move nodes on raiseZ and
  // re-fire `.board-item-in` @starting-style (visible blink on first select).
  return (
    <div
      ref={viewportRef}
      role="group"
      aria-label="Board"
      className={cn(
        "markx-dot-bg relative h-full w-full cursor-default touch-none overflow-hidden select-none",
        className
      )}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => {
        if (!viewportRef.current) return
        const viewport = getViewportRect()
        const boardPoint = screenToBoard(
          e.clientX,
          e.clientY,
          cameraRef.current,
          viewport
        )
        onContextPoint?.(boardPoint)
        const hit = hitTest(boardPoint.x, boardPoint.y)
        if (!hit) return
        if (!selectedIds.has(hit.id)) {
          onSelectedIdsChange(new Set([hit.id]))
          anchorIdRef.current = hit.id
          onRaiseZ([hit.id])
        }
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left will-change-transform"
        suppressHydrationWarning
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        {items.map((item) => {
          const live = liveOffsets.get(item.id)
          const resize = liveResize.get(item.id)
          const x = resize?.x ?? live?.x ?? item.data.x
          const y = live?.y ?? item.data.y
          const selected = selectedIds.has(item.id)
          const dragging = liveOffsets.has(item.id) || liveResize.has(item.id)
          const animateIn =
            seenIdsRef.current != null && !seenIdsRef.current.has(item.id)
          return (
            <div
              key={item.id}
              data-board-item={item.id}
              role="button"
              tabIndex={item.id === tabStop ? 0 : -1}
              aria-label={getItemLabel?.(item)}
              aria-pressed={selected}
              onFocus={() => {
                setTabStopId(item.id)
                if (
                  modalityRef.current === "keyboard" &&
                  !selectedRef.current.has(item.id)
                ) {
                  onSelectedIdsChange(new Set([item.id]))
                  anchorIdRef.current = item.id
                }
              }}
              className={cn(
                "absolute origin-top-left rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black/70",
                animateIn && "board-item-in"
              )}
              style={{
                transform: `translate(${x}px, ${y}px)`,
                zIndex: item.data.z,
              }}
            >
              <div
                className={cn(
                  "origin-center transition-[opacity,transform] duration-150 ease-[var(--ease-out-strong)] motion-reduce:transition-opacity",
                  dragging && trashArmed && "scale-90 opacity-50"
                )}
              >
                {renderItem(withLiveResize(item, resize), selected, dragging)}
              </div>
            </div>
          )
        })}

        {marquee ? (
          <div
            className="pointer-events-none absolute border border-selection/70 bg-selection/10"
            style={{
              transform: `translate(${marquee.x}px, ${marquee.y}px)`,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        ) : null}
      </div>

      {isMobile ? (
        <DeleteDock
          open={moveDockOpen}
          armed={trashArmed}
          count={dragItemCount}
          hitRef={deleteDockHitRef}
        />
      ) : null}
    </div>
  )
}
