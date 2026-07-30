import { fireEvent, render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Board } from "./board"
import type { BoardItemModel } from "@/lib/markx/geometry"

const bookmark: BoardItemModel = {
  id: "bookmark-1",
  kind: "bookmark",
  data: {
    id: "bookmark-1",
    folderId: "folder-1",
    url: "https://example.com",
    title: "Example",
    x: 0,
    y: 0,
    z: 1,
  },
}

function renderBoard(
  options: {
    items?: BoardItemModel[]
    onBlankDoubleTap?: (point: { x: number; y: number }) => void
    onOpenItem?: (id: string) => void
  } = {}
) {
  const view = render(
    <Board
      items={options.items ?? []}
      selectedIds={new Set()}
      onSelectedIdsChange={vi.fn()}
      onRaiseZ={vi.fn()}
      onMoveItems={vi.fn()}
      onResizeItem={vi.fn()}
      onOpenItem={options.onOpenItem ?? vi.fn()}
      onTrashDrop={vi.fn()}
      trashRef={{ current: null }}
      renderItem={() => null}
      onBlankDoubleTap={options.onBlankDoubleTap}
    />
  )
  const board = view.getByRole("group", { name: "Board" })
  vi.spyOn(board, "getBoundingClientRect").mockReturnValue({
    bottom: 600,
    height: 600,
    left: 0,
    right: 800,
    top: 0,
    width: 800,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  return { ...view, board }
}

function touchTap(
  target: HTMLElement,
  pointerId: number,
  clientX: number,
  clientY: number
) {
  fireEvent.pointerDown(target, {
    button: 0,
    clientX,
    clientY,
    pointerId,
    pointerType: "touch",
  })
  fireEvent.pointerUp(target, {
    button: 0,
    clientX,
    clientY,
    pointerId,
    pointerType: "touch",
  })
}

describe("Board touch behavior", () => {
  it("requests the context menu after two stationary touches on blank board space", () => {
    const onBlankDoubleTap = vi.fn()
    const { board } = renderBoard({ onBlankDoubleTap })

    touchTap(board, 1, 600, 400)
    touchTap(board, 2, 608, 404)

    expect(onBlankDoubleTap).toHaveBeenCalledWith({ x: 608, y: 404 })
  })

  it("does not treat a two-finger pan as a blank-board double tap", () => {
    const onBlankDoubleTap = vi.fn()
    const { board } = renderBoard({ onBlankDoubleTap })

    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 400,
      clientY: 300,
      pointerId: 1,
      pointerType: "touch",
    })
    fireEvent.pointerDown(board, {
      button: 0,
      clientX: 460,
      clientY: 300,
      pointerId: 2,
      pointerType: "touch",
    })
    fireEvent.pointerMove(board, {
      clientX: 440,
      clientY: 320,
      pointerId: 1,
      pointerType: "touch",
    })
    fireEvent.pointerUp(board, {
      clientX: 440,
      clientY: 320,
      pointerId: 1,
      pointerType: "touch",
    })
    fireEvent.pointerUp(board, {
      clientX: 460,
      clientY: 300,
      pointerId: 2,
      pointerType: "touch",
    })

    expect(onBlankDoubleTap).not.toHaveBeenCalled()
  })

  it("opens a bookmark after two touch taps on its card", () => {
    const onOpenItem = vi.fn()
    const { board } = renderBoard({ items: [bookmark], onOpenItem })

    touchTap(board, 1, 100, 100)
    touchTap(board, 2, 100, 100)

    expect(onOpenItem).toHaveBeenCalledWith("bookmark-1")
  })
})
