import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react"

import { DeleteDock } from "@/components/markx/delete-dock"
import { useCoarsePointer } from "@/hooks/use-coarse-pointer"
import { useIsMobile } from "@/hooks/use-mobile"
import { vibrateDeleteFeedback } from "@/lib/markx/delete-dock"
import { cn } from "@/lib/utils"
import { BoardGesture } from "@/lib/markx/board-gesture"
import type {
  GestureContext,
  GestureEffect,
  PointerInput,
  ScreenRect,
} from "@/lib/markx/board-gesture"
import {
  DIRECTION_VECTORS,
  MAX_ZOOM,
  MIN_ZOOM,
  RESIZE_HANDLE_SIZE,
  cameraCenterOn,
  cameraFitContent,
  cameraFitContentAtMost,
  cameraToReveal,
  cameraZoomAroundViewportCenter,
  findNearestInDirection,
  getBoardItemRect,
  hitTestBoardItems,
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
  /** Pan (keeping zoom) so the item is in the center of the view. */
  centerOn: (id: string) => void
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
  /** A press on empty canvas (ends note editing, among others). */
  onBlankPress?: () => void
  /** Phone select mode: taps toggle items, blank drags draw a marquee. */
  touchSelectMode?: boolean
  /** Rename via keyboard (F2). Pointer rename stays on the context menu. */
  onRenameItem?: (id: string) => void
  /** Accessible name for each item, announced when it receives focus. */
  getItemLabel?: (item: BoardItemModel) => string
  editingId?: string
  boardApiRef?: React.RefObject<BoardApi | null>
  className?: string
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
  onRenameItem,
  onBlankPress,
  touchSelectMode = false,
  getItemLabel,
  editingId,
  boardApiRef,
  className,
}: BoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const deleteDockHitRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const coarse = useCoarsePointer()
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
  const gestureRef = useRef(new BoardGesture())
  const lastPointerTypeRef = useRef<string>("mouse")
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedRef = useRef(selectedIds)
  const itemsRef = useRef(items)
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
  const previousItemsRef = useRef(items)
  /** Board item that last had focus (kept while focus is "nowhere"). */
  const focusedIdRef = useRef<string | null>(null)
  /** True while the board itself moves focus (no selection change). */
  const restoringFocusRef = useRef(false)
  const [exitingItems, setExitingItems] = useState<BoardItemModel[]>([])
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set())
  const exitTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const exitFrameRef = useRef<number | null>(null)

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
      centerOn: (id: string) => {
        const viewport = viewportRef.current
        const item = itemsRef.current.find((i) => i.id === id)
        if (!viewport || !item) return
        commitCamera(
          cameraCenterOn(
            cameraRef.current,
            getBoardItemRect(item),
            viewport.getBoundingClientRect()
          )
        )
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
      if (armTimerRef.current) clearTimeout(armTimerRef.current)
    }
  }, [])

  const hitTest = useCallback(
    (boardX: number, boardY: number) =>
      hitTestBoardItems(itemsRef.current, boardX, boardY),
    []
  )

  // Phones open on a fixed camera that cut items off; fit them on first
  // paint instead, without zooming past the old 50% default.
  const firstFitDoneRef = useRef(false)
  useLayoutEffect(() => {
    if (firstFitDoneRef.current) return
    const viewport = viewportRef.current
    if (!viewport || typeof window === "undefined") return
    if (window.innerWidth >= 768 || items.length === 0) return
    firstFitDoneRef.current = true
    commitCamera(
      cameraFitContentAtMost(items, viewport.getBoundingClientRect(), 0.5)
    )
  }, [commitCamera, items])

  // Keep the note being edited above the virtual keyboard: when the visual
  // viewport shrinks, pan the board so the note sits in the visible band.
  useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport
    if (!editingId || !vv) return
    const reveal = () => {
      const viewport = viewportRef.current
      const item = itemsRef.current.find((i) => i.id === editingId)
      if (!viewport || !item) return
      const rect = viewport.getBoundingClientRect()
      const visibleBottom = vv.offsetTop + vv.height - rect.top
      const visibleTop = Math.max(0, vv.offsetTop - rect.top)
      const next = cameraToReveal(
        cameraRef.current,
        getBoardItemRect(item),
        visibleTop,
        Math.min(rect.height, visibleBottom)
      )
      if (next !== cameraRef.current) commitCamera(next)
    }
    reveal()
    vv.addEventListener("resize", reveal)
    return () => vv.removeEventListener("resize", reveal)
  }, [commitCamera, editingId])

  // Any keypress implies keyboard modality until the next pointer press.
  useEffect(() => {
    const onKey = () => {
      modalityRef.current = "keyboard"
      // A keyboard context menu (Shift+F10) must not be treated as touch.
      lastPointerTypeRef.current = "keyboard"
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

  useLayoutEffect(() => {
    const previousItems = previousItemsRef.current
    const currentIds = new Set(items.map((item) => item.id))
    const removedItems = previousItems.filter(
      (item) => !currentIds.has(item.id)
    )
    previousItemsRef.current = items

    setExitingItems((previous) => {
      const next = previous.filter((item) => !currentIds.has(item.id))
      for (const item of removedItems) {
        if (!next.some((candidate) => candidate.id === item.id)) {
          next.push(item)
        }
      }
      return next.length === previous.length &&
        next.every((item, index) => item === previous[index])
        ? previous
        : next
    })
    setExitingIds((previous) => {
      const next = new Set([...previous].filter((id) => !currentIds.has(id)))
      return next.size === previous.size ? previous : next
    })

    if (exitFrameRef.current != null) {
      cancelAnimationFrame(exitFrameRef.current)
      exitFrameRef.current = null
    }

    if (removedItems.length === 0) return

    // A deleted item must not take keyboard focus with it: move focus to
    // the nearest remaining item instead of dropping it on <body>.
    const focusedRemoved = removedItems.find(
      (item) => item.id === focusedIdRef.current
    )
    const active = document.activeElement
    if (
      focusedRemoved &&
      (active == null ||
        active === document.body ||
        active.getAttribute("data-board-item") === focusedRemoved.id)
    ) {
      const from = getBoardItemRect(focusedRemoved)
      let nearest: BoardItemModel | null = null
      let best = Infinity
      for (const item of items) {
        const r = getBoardItemRect(item)
        const d = Math.hypot(r.x - from.x, r.y - from.y)
        if (d < best) {
          best = d
          nearest = item
        }
      }
      focusedIdRef.current = null
      if (nearest) {
        const id = nearest.id
        setTabStopId(id)
        requestAnimationFrame(() => {
          // Only focus moves; the selection stays empty. Selecting here
          // opened the phone Selection toolbar under the delete toast, and
          // a second Delete press would delete the neighbour too.
          restoringFocusRef.current = true
          focusItem(id)
          restoringFocusRef.current = false
        })
      }
    }

    const removedIds = removedItems.map((item) => item.id)
    exitFrameRef.current = requestAnimationFrame(() => {
      exitFrameRef.current = null
      setExitingIds((previous) => {
        const next = new Set(previous)
        for (const id of removedIds) {
          if (!currentIds.has(id)) next.add(id)
        }
        return next
      })

      for (const id of removedIds) {
        const existingTimer = exitTimersRef.current.get(id)
        if (existingTimer != null) clearTimeout(existingTimer)
        exitTimersRef.current.set(
          id,
          setTimeout(() => {
            exitTimersRef.current.delete(id)
            setExitingItems((previous) =>
              previous.filter((item) => item.id !== id)
            )
            setExitingIds((previous) => {
              if (!previous.has(id)) return previous
              const next = new Set(previous)
              next.delete(id)
              return next
            })
          }, 150)
        )
      }
    })
  }, [items])

  useEffect(() => {
    return () => {
      if (exitFrameRef.current != null) {
        cancelAnimationFrame(exitFrameRef.current)
      }
      for (const timer of exitTimersRef.current.values()) {
        clearTimeout(timer)
      }
      exitTimersRef.current.clear()
    }
  }, [])

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
    gestureRef.current.anchorId = id
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

  const screenRectOf = (el: HTMLElement | null): ScreenRect | null => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }

  const gestureContext = (): GestureContext => {
    const viewport = getViewportRect()
    return {
      items: itemsRef.current,
      selectedIds: selectedRef.current,
      editingId,
      camera: cameraRef.current,
      viewport: {
        left: viewport.left,
        top: viewport.top,
        width: viewport.width,
        height: viewport.height,
      },
      coarse,
      mobileDock: isMobile,
      trashRect: isMobile ? null : screenRectOf(trashRef.current),
      dockRect: isMobile ? screenRectOf(deleteDockHitRef.current) : null,
      touchSelectMode,
    }
  }

  const toInput = (e: ReactPointerEvent<HTMLDivElement>): PointerInput => ({
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    button: e.button,
    x: e.clientX,
    y: e.clientY,
    time: Date.now(),
    altKey: e.altKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
  })

  const runEffects = (target: HTMLDivElement, effects: GestureEffect[]) => {
    for (const effect of effects) {
      switch (effect.type) {
        case "select":
          selectedRef.current = effect.ids
          onSelectedIdsChange(effect.ids)
          break
        case "open":
          onOpenItem(effect.id)
          break
        case "raise":
          onRaiseZ(effect.ids)
          break
        case "capture":
          for (const id of effect.pointerIds) capturePointer(target, id)
          break
        case "release":
          releasePointer(target, effect.pointerId)
          break
        case "camera":
          cameraRef.current = effect.camera
          pendingRef.current.camera = effect.camera
          scheduleFlush()
          break
        case "marquee":
          pendingRef.current.marquee = effect.rect
          if (effect.rect) scheduleFlush()
          else setMarquee(null)
          break
        case "liveOffsets":
          pendingRef.current.liveOffsets = effect.offsets
          if (effect.offsets.size > 0) scheduleFlush()
          else setLiveOffsets(new Map())
          break
        case "liveResize":
          pendingRef.current.liveResize = effect.resize
          if (effect.resize.size > 0) scheduleFlush()
          else setLiveResize(new Map())
          break
        case "moveStart":
          setDragItemCount(effect.count)
          onItemMoveDragChangeRef.current?.(true)
          if (isMobile) setMoveDockOpen(true)
          break
        case "moveEnd":
          clearMoveTrashUi()
          break
        case "trashArmed":
          setTrashArmedState(effect.armed)
          break
        case "armLater":
          if (armTimerRef.current) clearTimeout(armTimerRef.current)
          armTimerRef.current = setTimeout(() => {
            armTimerRef.current = null
            if (!viewportRef.current) return
            runEffects(
              viewportRef.current,
              gestureRef.current.tick(Date.now(), gestureContext())
            )
          }, effect.delayMs + 10)
          break
        case "commitMove":
          onMoveItems(effect.updates)
          break
        case "commitResize":
          onResizeItem(effect.id, effect.rect)
          break
        case "trashDrop":
          vibrateDeleteFeedback("commit")
          onTrashDrop(effect.ids)
          break
        case "blankPress":
          onBlankPress?.()
          break
        case "flush":
          flushNow()
          break
      }
    }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    modalityRef.current = "pointer"
    lastPointerTypeRef.current = e.pointerType
    if (e.pointerType === "touch") {
      // Touch long-press opens the context menu without a native
      // `contextmenu` event (see onContextMenu), so record the point here.
      onContextPoint?.(
        screenToBoard(
          e.clientX,
          e.clientY,
          cameraRef.current,
          getViewportRect()
        )
      )
    }
    runEffects(
      e.currentTarget,
      gestureRef.current.pointerDown(toInput(e), gestureContext())
    )
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    if (gestureRef.current.mode == null) {
      // No gesture: only keep finger positions fresh (a later second
      // finger computes the pinch centroid from them).
      gestureRef.current.trackPointer({
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
      })
      return
    }
    runEffects(
      e.currentTarget,
      gestureRef.current.pointerMove(toInput(e), gestureContext())
    )
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    runEffects(
      e.currentTarget,
      gestureRef.current.pointerUp(toInput(e), gestureContext())
    )
  }

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    runEffects(e.currentTarget, gestureRef.current.pointerCancel(toInput(e)))
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

    // After a long press opens the context menu, Chromium can still treat
    // the lift as a tap and send compat mousedown/click events, which land
    // on the menu backdrop and close it (MX-22). Cancel that touchend.
    const onTouchEnd = (e: TouchEvent) => {
      if (document.querySelector('[role="menu"]')) e.preventDefault()
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("touchend", onTouchEnd, { passive: false })
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("touchend", onTouchEnd)
    }
  }, [])

  const renderedItems = useMemo(() => {
    const currentIds = new Set(items.map((item) => item.id))
    return [
      ...items,
      ...exitingItems.filter((item) => !currentIds.has(item.id)),
    ]
  }, [exitingItems, items])
  const itemIds = useMemo(() => new Set(items.map((item) => item.id)), [items])
  const tabStop =
    tabStopId && itemIds.has(tabStopId)
      ? tabStopId
      : gestureRef.current.anchorId && itemIds.has(gestureRef.current.anchorId)
        ? gestureRef.current.anchorId
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
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => {
        if (!viewportRef.current) return
        const nativeType = (e.nativeEvent as Partial<PointerEvent>).pointerType
        const fromTouch = nativeType
          ? nativeType === "touch"
          : lastPointerTypeRef.current === "touch"
        if (fromTouch) {
          // Base UI already opens the menu from its own touch long-press
          // timer. Its native-contextmenu path adds a "release outside
          // closes" mouseup listener, and Chromium's compat mouseup after a
          // long hold then closes the menu (MX-22). Keep the event away
          // from it, and keep the browser's own menu away too.
          e.preventDefault()
          e.stopPropagation()
          return
        }
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
          gestureRef.current.anchorId = hit.id
          onRaiseZ([hit.id])
        }
      }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left will-change-transform"
        suppressHydrationWarning
        style={
          {
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
            // Resize handles size themselves to 44 screen px on touch.
            "--resize-zone": `${Math.max(RESIZE_HANDLE_SIZE, 44 / camera.zoom)}px`,
          } as CSSProperties
        }
      >
        {renderedItems.map((item) => {
          const live = liveOffsets.get(item.id)
          const resize = liveResize.get(item.id)
          const x = resize?.x ?? live?.x ?? item.data.x
          const y = live?.y ?? item.data.y
          const isLeaving = exitingIds.has(item.id)
          const selected = !isLeaving && selectedIds.has(item.id)
          const dragging =
            !isLeaving && (liveOffsets.has(item.id) || liveResize.has(item.id))
          const animateIn =
            !isLeaving &&
            seenIdsRef.current != null &&
            !seenIdsRef.current.has(item.id)
          return (
            <div
              key={item.id}
              data-board-item={item.id}
              role="button"
              tabIndex={isLeaving ? -1 : item.id === tabStop ? 0 : -1}
              data-leaving={isLeaving ? "" : undefined}
              aria-label={getItemLabel?.(item)}
              aria-pressed={selected}
              onBlur={(e) => {
                if (e.relatedTarget) focusedIdRef.current = null
              }}
              onFocus={() => {
                focusedIdRef.current = item.id
                setTabStopId(item.id)
                if (
                  modalityRef.current === "keyboard" &&
                  !restoringFocusRef.current &&
                  !selectedRef.current.has(item.id)
                ) {
                  onSelectedIdsChange(new Set([item.id]))
                  gestureRef.current.anchorId = item.id
                }
              }}
              className={cn(
                "absolute origin-top-left rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black/70",
                animateIn && "board-item-in",
                isLeaving && "pointer-events-none"
              )}
              style={{
                transform: `translate(${x}px, ${y}px)`,
                zIndex: item.data.z,
              }}
            >
              <div
                className={cn(
                  !isLeaving &&
                    "origin-center transition-[opacity,transform] duration-150 ease-[var(--ease-out-strong)] motion-reduce:transition-opacity",
                  dragging && trashArmed && "scale-90 opacity-50",
                  isLeaving && "board-item-out"
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
