import { describe, expect, it } from "vitest"

import { BoardGesture } from "./board-gesture"
import type {
  GestureContext,
  GestureEffect,
  PointerInput,
} from "./board-gesture"
import type { BoardItemModel } from "./geometry"

const note: BoardItemModel = {
  id: "n1",
  kind: "note",
  data: {
    id: "n1",
    folderId: null,
    content: "",
    color: "yellow",
    font: "sans",
    fontSize: "m",
    x: 100,
    y: 100,
    z: 1,
  },
}

const folder: BoardItemModel = {
  id: "f1",
  kind: "folder",
  data: { id: "f1", name: "F", x: 600, y: 100, z: 2 },
}

function ctx(over: Partial<GestureContext> = {}): GestureContext {
  return {
    items: [note, folder],
    selectedIds: new Set(),
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { left: 0, top: 0, width: 1000, height: 800 },
    coarse: false,
    mobileDock: false,
    trashRect: null,
    dockRect: null,
    ...over,
  }
}

function input(over: Partial<PointerInput>): PointerInput {
  return {
    pointerId: 1,
    pointerType: "touch",
    button: 0,
    x: 0,
    y: 0,
    time: 0,
    ...over,
  }
}

function types(effects: GestureEffect[]): string[] {
  return effects.map((e) => e.type)
}

describe("BoardGesture", () => {
  it("MX-21 a pointercancel during an item drag reverts and never commits", () => {
    const g = new BoardGesture()
    g.pointerDown(input({ x: 150, y: 150 }), ctx())
    g.pointerMove(input({ x: 150, y: 200 }), ctx())
    expect(g.mode).toBe("move")

    // Chromium reports cancel coordinates as 0,0.
    const effects = g.pointerCancel(input({ x: 0, y: 0 }))

    expect(types(effects)).not.toContain("commitMove")
    expect(types(effects)).not.toContain("trashDrop")
    expect(effects).toContainEqual({ type: "liveOffsets", offsets: new Map() })
    expect(types(effects)).toContain("moveEnd")
    expect(g.mode).toBeNull()
  })

  it("MX-21 a pointercancel during a resize drops the live size", () => {
    const g = new BoardGesture()
    const c = ctx({ selectedIds: new Set(["n1"]) })
    g.pointerDown(input({ x: 395, y: 395, pointerType: "mouse" }), c)
    expect(g.mode).toBe("resize")
    g.pointerMove(input({ x: 450, y: 450, pointerType: "mouse" }), c)
    const effects = g.pointerCancel(input({}))
    expect(types(effects)).not.toContain("commitResize")
    expect(effects).toContainEqual({ type: "liveResize", resize: new Map() })
  })

  it("MX-21 a pointercancel during a pan restores the original camera", () => {
    const g = new BoardGesture()
    g.pointerDown(input({ x: 900, y: 700 }), ctx())
    g.pointerMove(input({ x: 800, y: 600 }), ctx())
    const effects = g.pointerCancel(input({}))
    expect(effects).toContainEqual({
      type: "camera",
      camera: { x: 0, y: 0, zoom: 1 },
    })
  })

  it("commits an item move on pointerup", () => {
    const g = new BoardGesture()
    g.pointerDown(input({ x: 150, y: 150 }), ctx())
    g.pointerMove(input({ x: 150, y: 200 }), ctx())
    const effects = g.pointerUp(input({ x: 150, y: 250 }), ctx())
    expect(effects).toContainEqual({
      type: "commitMove",
      updates: [{ id: "n1", x: 100, y: 200 }],
    })
  })

  it("drops on the trash instead of moving when released over it", () => {
    const g = new BoardGesture()
    const c = ctx({ trashRect: { left: 0, top: 700, right: 60, bottom: 800 } })
    g.pointerDown(input({ x: 150, y: 150 }), c)
    const armed = g.pointerMove(input({ x: 30, y: 750 }), c)
    expect(armed).toContainEqual({ type: "trashArmed", armed: true })
    const effects = g.pointerUp(input({ x: 30, y: 750 }), c)
    expect(effects).toContainEqual({ type: "trashDrop", ids: ["n1"] })
    expect(types(effects)).not.toContain("commitMove")
  })

  it("a second finger turns a drag into a two-finger pan without committing", () => {
    const g = new BoardGesture()
    g.pointerDown(input({ x: 150, y: 150 }), ctx())
    g.pointerMove(input({ x: 150, y: 200 }), ctx())
    const effects = g.pointerDown(
      input({ pointerId: 2, x: 300, y: 300 }),
      ctx()
    )
    expect(types(effects)).not.toContain("commitMove")
    expect(g.mode).toBe("touchPan")
  })

  it("opens an item on a double press", () => {
    const g = new BoardGesture()
    g.pointerDown(input({ x: 150, y: 150, time: 0 }), ctx())
    g.pointerUp(input({ x: 150, y: 150, time: 50 }), ctx())
    const effects = g.pointerDown(input({ x: 150, y: 150, time: 200 }), ctx())
    expect(effects).toEqual([{ type: "open", id: "n1" }])
  })

  it("reports a press on empty canvas", () => {
    const g = new BoardGesture()
    const effects = g.pointerDown(input({ x: 900, y: 700 }), ctx())
    expect(types(effects)).toContain("blankPress")
  })
})
