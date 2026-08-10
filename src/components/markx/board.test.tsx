import { fireEvent, render } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { Board } from "./board"
import type { BoardItemModel } from "@/lib/markx/geometry"

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

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
    onOpenItem?: (id: string) => void
    itemGesturesEnabled?: boolean
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
      itemGesturesEnabled={options.itemGesturesEnabled}
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

describe("Board double-tap open", () => {
  it("opens a bookmark after two touch taps on its card", () => {
    const onOpenItem = vi.fn()
    const { board } = renderBoard({ items: [bookmark], onOpenItem })

    // Mobile default camera is zoom 0.5 at (16, 24); (100,100) maps onto the card.
    touchTap(board, 1, 100, 100)
    touchTap(board, 2, 104, 102)

    expect(onOpenItem).toHaveBeenCalledWith("bookmark-1")
  })

  it("opens a bookmark in read-only mode without item drag gestures", () => {
    const onOpenItem = vi.fn()
    const onMoveItems = vi.fn()
    const view = render(
      <Board
        items={[bookmark]}
        selectedIds={new Set()}
        onSelectedIdsChange={vi.fn()}
        onRaiseZ={vi.fn()}
        onMoveItems={onMoveItems}
        onResizeItem={vi.fn()}
        onOpenItem={onOpenItem}
        onTrashDrop={vi.fn()}
        trashRef={{ current: null }}
        renderItem={() => null}
        itemGesturesEnabled={false}
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

    touchTap(board, 1, 100, 100)
    touchTap(board, 2, 100, 100)

    expect(onOpenItem).toHaveBeenCalledWith("bookmark-1")
    expect(onMoveItems).not.toHaveBeenCalled()
  })

  it("does not open when the second tap is too far from the first", () => {
    const onOpenItem = vi.fn()
    const { board } = renderBoard({
      items: [bookmark],
      onOpenItem,
      itemGesturesEnabled: false,
    })

    touchTap(board, 1, 100, 100)
    touchTap(board, 2, 180, 100)

    expect(onOpenItem).not.toHaveBeenCalled()
  })
})
