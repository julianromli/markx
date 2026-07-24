import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"

import { cn } from "@/lib/utils"
import {
  BOOKMARK_SIZE,
  DRAG_THRESHOLD,
  FOLDER_SIZE,
  MAX_ZOOM,
  MIN_BOOKMARK_SIZE,
  MIN_IMAGE_SIZE,
  MIN_NOTE_SIZE,
  MIN_ZOOM,
  NOTE_SIZE,
  RESIZE_HANDLE_SIZE,
  fitImageToWidth,
  intersects,
  normalizeRect,
  screenToBoard,
  type Camera,
  type Rect,
} from "@/lib/markx/geometry"
import type { BoardImage, Bookmark, Folder, Note, ToolId } from "@/lib/markx/types"

export type BoardItemModel =
  | { id: string; kind: "folder"; data: Folder }
  | { id: string; kind: "bookmark"; data: Bookmark }
  | { id: string; kind: "note"; data: Note }
  | { id: string; kind: "image"; data: BoardImage }

export type BoardApi = {
  getViewCenter: () => { x: number; y: number }
}

type BoardProps = {
  items: BoardItemModel[]
  tool: ToolId
  selectedIds: Set<string>
  onSelectedIdsChange: (ids: Set<string>) => void
  onRaiseZ: (ids: string[]) => void
  onMoveItems: (
    updates: Array<{ id: string; x: number; y: number }>,
  ) => void
  onResizeItem: (
    id: string,
    rect: { x: number; width: number; height: number },
  ) => void
  onOpenItem: (id: string) => void
  onBoardCreate: (x: number, y: number) => void
  onTrashDrop: (ids: string[]) => void
  renderItem: (item: BoardItemModel, selected: boolean, dragging: boolean) => ReactNode
  trashRef: React.RefObject<HTMLElement | null>
  onZoomChange?: (zoomPercent: number) => void
  onContextPoint?: (point: { x: number; y: number }) => void
  editingId?: string
  boardApiRef?: React.RefObject<BoardApi | null>
  className?: string
}

type DragState = {
  mode: "pan" | "marquee" | "move" | "pending" | "place" | "resize"
  pointerId: number
  startScreen: { x: number; y: number }
  startBoard: { x: number; y: number }
  originCamera: Camera
  itemId?: string
  origins?: Map<string, { x: number; y: number }>
  originRect?: Rect
  minSize?: { width: number; height: number }
  aspectRatio?: number
}

function getBookmarkDimensions(bookmark: Bookmark) {
  return {
    width: bookmark.width ?? BOOKMARK_SIZE.width,
    height: bookmark.height ?? BOOKMARK_SIZE.height,
  }
}

function getNoteDimensions(note: Note) {
  return {
    width: note.width ?? NOTE_SIZE.width,
    height: note.height ?? NOTE_SIZE.height,
  }
}

function getImageDimensions(image: BoardImage) {
  if (image.width && image.height) {
    return { width: image.width, height: image.height }
  }
  return fitImageToWidth(image.naturalWidth, image.naturalHeight)
}

function isInBottomRightResizeZone(
  boardX: number,
  boardY: number,
  rect: Rect,
): boolean {
  return (
    boardX >= rect.x + rect.width - RESIZE_HANDLE_SIZE &&
    boardX <= rect.x + rect.width &&
    boardY >= rect.y + rect.height - RESIZE_HANDLE_SIZE &&
    boardY <= rect.y + rect.height
  )
}

function clampBottomRightResize(
  origin: Rect,
  boardDx: number,
  boardDy: number,
  minSize: { width: number; height: number },
  aspectRatio?: number,
): { x: number; width: number; height: number } {
  let newWidth = origin.width + boardDx
  let newHeight = origin.height + boardDy

  if (aspectRatio) {
    // Aspect-locked: use the dominant drag axis to determine size
    const fromWidth = newWidth
    const fromHeight = newWidth / aspectRatio
    const fromHeight2 = newHeight
    const fromWidth2 = newHeight * aspectRatio
    // Pick the larger of the two to follow the dominant drag direction
    if (fromWidth >= fromWidth2) {
      newWidth = fromWidth
      newHeight = fromHeight
    } else {
      newWidth = fromWidth2
      newHeight = fromHeight2
    }
  }

  if (newWidth < minSize.width) {
    newWidth = minSize.width
    if (aspectRatio) newHeight = newWidth / aspectRatio
  }
  if (newHeight < minSize.height) {
    newHeight = minSize.height
    if (aspectRatio) newWidth = newHeight * aspectRatio
  }

  return { x: origin.x, width: newWidth, height: newHeight }
}

export function Board({
  items,
  tool,
  selectedIds,
  onSelectedIdsChange,
  onRaiseZ,
  onMoveItems,
  onResizeItem,
  onOpenItem,
  onBoardCreate,
  onTrashDrop,
  renderItem,
  trashRef,
  onZoomChange,
  onContextPoint,
  editingId,
  boardApiRef,
  className,
}: BoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<Camera>({ x: 80, y: 40, zoom: 0.85 })

  useEffect(() => {
    onZoomChange?.(Math.round(camera.zoom * 100))
  }, [camera.zoom, onZoomChange])

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
          camera,
          rect,
        )
      },
    }
  })
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [liveOffsets, setLiveOffsets] = useState<Map<string, { x: number; y: number }>>(
    new Map(),
  )
  const [liveResize, setLiveResize] = useState<
    Map<string, { x: number; width: number; height: number }>
  >(new Map())
  const dragRef = useRef<DragState | null>(null)
  const selectedRef = useRef(selectedIds)
  const itemsRef = useRef(items)
  const anchorIdRef = useRef<string | null>(null)
  const lastClickRef = useRef<{ id: string; time: number } | null>(null)

  selectedRef.current = selectedIds
  itemsRef.current = items

  const getItemRect = useCallback((item: BoardItemModel): Rect => {
    if (item.kind === "folder") {
      return {
        x: item.data.x,
        y: item.data.y,
        width: FOLDER_SIZE.width,
        height: FOLDER_SIZE.height,
      }
    }
    if (item.kind === "note") {
      const size = getNoteDimensions(item.data)
      return {
        x: item.data.x,
        y: item.data.y,
        width: size.width,
        height: size.height,
      }
    }
    if (item.kind === "image") {
      const size = getImageDimensions(item.data)
      return {
        x: item.data.x,
        y: item.data.y,
        width: size.width,
        height: size.height,
      }
    }
    const size = getBookmarkDimensions(item.data)
    return {
      x: item.data.x,
      y: item.data.y,
      width: size.width,
      height: size.height,
    }
  }, [])

  const hitTest = useCallback(
    (boardX: number, boardY: number) => {
      const sorted = [...itemsRef.current].sort((a, b) => b.data.z - a.data.z)
      for (const item of sorted) {
        const rect = getItemRect(item)
        if (
          boardX >= rect.x &&
          boardX <= rect.x + rect.width &&
          boardY >= rect.y &&
          boardY <= rect.y + rect.height
        ) {
          return item
        }
      }
      return null
    },
    [getItemRect],
  )

  const getViewportRect = () => viewportRef.current!.getBoundingClientRect()

  const applySelectionFromMarquee = (rect: Rect, additive: boolean) => {
    const next = additive ? new Set(selectedRef.current) : new Set<string>()
    for (const item of itemsRef.current) {
      if (intersects(rect, getItemRect(item))) next.add(item.id)
    }
    onSelectedIdsChange(next)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        mode: "pan",
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        startBoard: { x: 0, y: 0 },
        originCamera: { ...camera },
      }
      return
    }
    if (e.button !== 0) return

    const viewport = getViewportRect()
    const boardPoint = screenToBoard(e.clientX, e.clientY, camera, viewport)
    const hit = hitTest(boardPoint.x, boardPoint.y)

    if (!hit) {
      if (tool === "board" || tool === "link" || tool === "note") {
        // Place on single click only — ignore 2nd click of a double-click
        if (e.detail > 1) return
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = {
          mode: "place",
          pointerId: e.pointerId,
          startScreen: { x: e.clientX, y: e.clientY },
          startBoard: boardPoint,
          originCamera: { ...camera },
        }
        return
      }
      if (!e.metaKey && !e.ctrlKey && !e.shiftKey) {
        onSelectedIdsChange(new Set())
      }
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        mode: "marquee",
        pointerId: e.pointerId,
        startScreen: { x: e.clientX, y: e.clientY },
        startBoard: boardPoint,
        originCamera: { ...camera },
      }
      setMarquee({ x: boardPoint.x, y: boardPoint.y, width: 0, height: 0 })
      return
    }

    if (hit.id === editingId) {
      return
    }

    if (
      (hit.kind === "bookmark" || hit.kind === "note" || hit.kind === "image") &&
      tool === "select"
    ) {
      const rect = getItemRect(hit)
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
      if (isInBottomRightResizeZone(boardPoint.x, boardPoint.y, rect)) {
        if (!selectedRef.current.has(hit.id)) {
          onSelectedIdsChange(new Set([hit.id]))
          anchorIdRef.current = hit.id
        }
        onRaiseZ([hit.id])
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = {
          mode: "resize",
          pointerId: e.pointerId,
          startScreen: { x: e.clientX, y: e.clientY },
          startBoard: boardPoint,
          originCamera: { ...camera },
          itemId: hit.id,
          originRect: rect,
          minSize,
          aspectRatio,
        }
        return
      }
    }

    // While placing, don't open items on double-click
    if (tool !== "board" && tool !== "link" && tool !== "note") {
      const now = Date.now()
      const last = lastClickRef.current
      if (last && last.id === hit.id && now - last.time < 350) {
        onOpenItem(hit.id)
        lastClickRef.current = null
        return
      }
      lastClickRef.current = { id: hit.id, time: now }
    } else {
      lastClickRef.current = null
    }

    const additive = e.metaKey || e.ctrlKey
    let nextSelection: Set<string>

    if (e.shiftKey && anchorIdRef.current) {
      const anchor = itemsRef.current.find((i) => i.id === anchorIdRef.current)
      const target = itemsRef.current.find((i) => i.id === hit.id)
      nextSelection = new Set([hit.id])
      if (anchor && target) {
        const a = getItemRect(anchor)
        const b = getItemRect(target)
        const union = normalizeRect(
          { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
          {
            x: Math.max(a.x + a.width, b.x + b.width),
            y: Math.max(a.y + a.height, b.y + b.height),
          },
        )
        nextSelection = new Set()
        for (const item of itemsRef.current) {
          const r = getItemRect(item)
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
    const movingIds = [...nextSelection]
    const origins = new Map<string, { x: number; y: number }>()
    for (const item of itemsRef.current) {
      if (movingIds.includes(item.id)) {
        origins.set(item.id, { x: item.data.x, y: item.data.y })
      }
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      mode: "pending",
      pointerId: e.pointerId,
      startScreen: { x: e.clientX, y: e.clientY },
      startBoard: boardPoint,
      originCamera: { ...camera },
      itemId: hit.id,
      origins,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const dx = e.clientX - drag.startScreen.x
    const dy = e.clientY - drag.startScreen.y

    if (drag.mode === "pan") {
      setCamera({
        ...drag.originCamera,
        x: drag.originCamera.x + dx,
        y: drag.originCamera.y + dy,
      })
      return
    }

    if (drag.mode === "marquee") {
      const viewport = getViewportRect()
      const current = screenToBoard(e.clientX, e.clientY, camera, viewport)
      const rect = normalizeRect(drag.startBoard, current)
      setMarquee(rect)
      applySelectionFromMarquee(rect, e.metaKey || e.ctrlKey)
      return
    }

    if (drag.mode === "resize" && drag.originRect && drag.itemId) {
      const boardDx = dx / camera.zoom
      const boardDy = dy / camera.zoom
      const minSize = drag.minSize ?? MIN_BOOKMARK_SIZE
      const next = clampBottomRightResize(
        drag.originRect,
        boardDx,
        boardDy,
        minSize,
        drag.aspectRatio,
      )
      setLiveResize(new Map([[drag.itemId, next]]))
      return
    }

    if (drag.mode === "pending") {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
      drag.mode = "move"
    }

    if (drag.mode === "move" && drag.origins) {
      const boardDx = dx / camera.zoom
      const boardDy = dy / camera.zoom
      const next = new Map<string, { x: number; y: number }>()
      for (const [id, origin] of drag.origins) {
        next.set(id, { x: origin.x + boardDx, y: origin.y + boardDy })
      }
      setLiveOffsets(next)
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    if (drag.mode === "marquee") {
      setMarquee(null)
    }

    if (drag.mode === "place") {
      const moved = Math.hypot(
        e.clientX - drag.startScreen.x,
        e.clientY - drag.startScreen.y,
      )
      // Place on click-release; double-clicks are ignored at pointerdown (detail > 1)
      if (moved < DRAG_THRESHOLD) {
        onBoardCreate(drag.startBoard.x, drag.startBoard.y)
      }
      dragRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
      return
    }

    if (drag.mode === "resize" && drag.originRect && drag.itemId) {
      const boardDx = (e.clientX - drag.startScreen.x) / camera.zoom
      const boardDy = (e.clientY - drag.startScreen.y) / camera.zoom
      const minSize = drag.minSize ?? MIN_BOOKMARK_SIZE
      onResizeItem(
        drag.itemId,
        clampBottomRightResize(
          drag.originRect,
          boardDx,
          boardDy,
          minSize,
          drag.aspectRatio,
        ),
      )
      setLiveResize(new Map())
    }

    if (drag.mode === "move" && drag.origins) {
      const trashEl = trashRef.current
      const overTrash =
        trashEl &&
        (() => {
          const r = trashEl.getBoundingClientRect()
          return (
            e.clientX >= r.left &&
            e.clientX <= r.right &&
            e.clientY >= r.top &&
            e.clientY <= r.bottom
          )
        })()

      if (overTrash) {
        onTrashDrop([...drag.origins.keys()])
        setLiveOffsets(new Map())
      } else {
        const boardDx = (e.clientX - drag.startScreen.x) / camera.zoom
        const boardDy = (e.clientY - drag.startScreen.y) / camera.zoom
        const updates = [...drag.origins.entries()].map(([id, origin]) => ({
          id,
          x: origin.x + boardDx,
          y: origin.y + boardDy,
        }))
        onMoveItems(updates)
        setLiveOffsets(new Map())
      }
    }

    dragRef.current = null
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
  }

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const viewport = el.getBoundingClientRect()

      // Pinch-zoom (ctrl/meta) or trackpad pinch
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.0015
        setCamera((prev) => {
          const nextZoom = Math.min(
            MAX_ZOOM,
            Math.max(MIN_ZOOM, prev.zoom * (1 + delta)),
          )
          const cursorX = e.clientX - viewport.left
          const cursorY = e.clientY - viewport.top
          const boardX = (cursorX - prev.x) / prev.zoom
          const boardY = (cursorY - prev.y) / prev.zoom
          return {
            zoom: nextZoom,
            x: cursorX - boardX * nextZoom,
            y: cursorY - boardY * nextZoom,
          }
        })
        return
      }

      setCamera((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }))
    }

    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  const sortedItems = [...items].sort((a, b) => a.data.z - b.data.z)

  return (
    <div
      ref={viewportRef}
      className={cn(
        "markx-dot-bg relative h-full w-full touch-none overflow-hidden select-none",
        tool === "board" || tool === "link" || tool === "note"
          ? "cursor-crosshair"
          : "cursor-default",
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onContextMenu={(e) => {
        if (!viewportRef.current) return
        const viewport = getViewportRect()
        const boardPoint = screenToBoard(e.clientX, e.clientY, camera, viewport)
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
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        }}
      >
        {sortedItems.map((item) => {
          const live = liveOffsets.get(item.id)
          const resize = liveResize.get(item.id)
          const x = resize?.x ?? live?.x ?? item.data.x
          const y = live?.y ?? item.data.y
          const selected = selectedIds.has(item.id)
          const dragging = liveOffsets.has(item.id)
          const resizing = liveResize.has(item.id)
          // Override the live rect while resizing. Each branch narrows `item`
          // to a single variant so `data` stays correlated with `kind`.
          let renderItemModel: BoardItemModel = item
          if (resize && item.kind === "bookmark") {
            renderItemModel = {
              ...item,
              data: { ...item.data, x: resize.x, width: resize.width, height: resize.height },
            }
          } else if (resize && item.kind === "note") {
            renderItemModel = {
              ...item,
              data: { ...item.data, x: resize.x, width: resize.width, height: resize.height },
            }
          } else if (resize && item.kind === "image") {
            renderItemModel = {
              ...item,
              data: { ...item.data, x: resize.x, width: resize.width, height: resize.height },
            }
          }
          return (
            <div
              key={item.id}
              data-board-item={item.id}
              className="absolute"
              style={{
                transform: `translate(${x}px, ${y}px)`,
                zIndex: item.data.z,
              }}
            >
              {renderItem(renderItemModel, selected, dragging || resizing)}
            </div>
          )
        })}

        {marquee ? (
          <div
            className="pointer-events-none absolute border border-blue-500/70 bg-blue-500/10"
            style={{
              transform: `translate(${marquee.x}px, ${marquee.y}px)`,
              width: marquee.width,
              height: marquee.height,
            }}
          />
        ) : null}
      </div>

    </div>
  )
}
