import { describe, expect, it } from "vitest"

import { BoardGesture, resizeZoneSize } from "./board-gesture"
import { MIN_NOTE_SIZE, MIN_ZOOM } from "./geometry"
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

  describe("MX-13 delete dock", () => {
    const dock = { left: 400, top: 700, right: 560, bottom: 770 }
    const phone = () => ctx({ mobileDock: true, dockRect: dock })

    it("does not delete when the item only passes over the dock", () => {
      const g = new BoardGesture()
      g.pointerDown(input({ x: 150, y: 150, time: 0 }), phone())
      g.pointerMove(input({ x: 480, y: 735, time: 20 }), phone())
      const effects = g.pointerUp(input({ x: 480, y: 735, time: 60 }), phone())
      expect(types(effects)).not.toContain("trashDrop")
      expect(types(effects)).toContain("commitMove")
    })

    it("arms after a short dwell on the dock and then deletes on release", () => {
      const g = new BoardGesture()
      g.pointerDown(input({ x: 150, y: 150, time: 0 }), phone())
      const over = g.pointerMove(input({ x: 480, y: 735, time: 20 }), phone())
      expect(over).not.toContainEqual({ type: "trashArmed", armed: true })
      expect(over).toContainEqual({
        type: "armLater",
        delayMs: expect.any(Number),
      })
      expect(g.tick(400, phone())).toContainEqual({
        type: "trashArmed",
        armed: true,
      })
      const effects = g.pointerUp(input({ x: 480, y: 735, time: 420 }), phone())
      expect(effects).toContainEqual({ type: "trashDrop", ids: ["n1"] })
    })

    it("disarms when the finger leaves the dock", () => {
      const g = new BoardGesture()
      g.pointerDown(input({ x: 150, y: 150, time: 0 }), phone())
      g.pointerMove(input({ x: 480, y: 735, time: 20 }), phone())
      g.tick(400, phone())
      const away = g.pointerMove(input({ x: 30, y: 740, time: 450 }), phone())
      expect(away).toContainEqual({ type: "trashArmed", armed: false })
      const effects = g.pointerUp(input({ x: 30, y: 740, time: 470 }), phone())
      expect(types(effects)).not.toContain("trashDrop")
    })
  })

  describe("MX-30 resize zone on touch", () => {
    it("a corner press on an unselected card moves it instead of resizing", () => {
      const g = new BoardGesture()
      const c = ctx({ coarse: true })
      g.pointerDown(input({ x: 390, y: 390 }), c)
      expect(g.mode).toBe("pending")
    })

    it("a corner press on a selected card resizes it", () => {
      const g = new BoardGesture()
      const c = ctx({ coarse: true, selectedIds: new Set(["n1"]) })
      g.pointerDown(input({ x: 390, y: 390 }), c)
      expect(g.mode).toBe("resize")
    })

    it("MX-09 at minimum zoom a minimum-size note still has a move area", () => {
      const note = { ...MIN_NOTE_SIZE }
      const zone = resizeZoneSize(note, true, MIN_ZOOM)
      expect(zone.width).toBeLessThan(note.width - 10)
      expect(zone.height).toBeLessThan(note.height - 10)
    })

    it("MX-09b the zone covers less than a quarter of a minimum-size note at any zoom", () => {
      for (const zoom of [MIN_ZOOM, 0.5, 1, 2]) {
        const zone = resizeZoneSize(MIN_NOTE_SIZE, true, zoom)
        const ratio =
          (zone.width * zone.height) /
          (MIN_NOTE_SIZE.width * MIN_NOTE_SIZE.height)
        expect(ratio).toBeLessThan(0.25)
      }
    })

    it("keeps the small desktop zone for fine pointers", () => {
      expect(resizeZoneSize({ width: 480, height: 252 }, false, 0.5)).toEqual({
        width: 20,
        height: 20,
      })
    })
  })
})
