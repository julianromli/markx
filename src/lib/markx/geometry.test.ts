import { describe, expect, it } from "vitest"

import {
  SLOT_STEP_RATIO,
  clampBottomRightResize,
  findEmptySlot,
  getBoardItemRect,
  hitTestBoardItems,
  isInBottomRightResizeZone,
  overlapRatio,
  withLiveResize,
} from "./geometry"
import type { BoardItemModel } from "./geometry"

const items: BoardItemModel[] = [
  {
    id: "back",
    kind: "note",
    data: {
      id: "back",
      folderId: null,
      content: "",
      color: "yellow",
      font: "sans",
      fontSize: "m",
      x: 10,
      y: 20,
      z: 1,
    },
  },
  {
    id: "front",
    kind: "image",
    data: {
      id: "front",
      folderId: null,
      imageId: "asset",
      mime: "image/png",
      naturalWidth: 800,
      naturalHeight: 400,
      x: 20,
      y: 30,
      z: 2,
    },
  },
]

describe("board geometry helpers", () => {
  it("derives default item rectangles and hit-tests by z order", () => {
    expect(getBoardItemRect(items[0])).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 300,
    })
    expect(getBoardItemRect(items[1])).toEqual({
      x: 20,
      y: 30,
      width: 480,
      height: 240,
    })
    expect(hitTestBoardItems(items, 25, 35)?.id).toBe("front")
    expect(hitTestBoardItems(items, 1000, 1000)).toBeNull()
  })

  it("detects the resize handle zone inclusively", () => {
    const rect = { x: 10, y: 20, width: 100, height: 80 }
    expect(isInBottomRightResizeZone(90, 80, rect, 20)).toBe(true)
    expect(isInBottomRightResizeZone(89, 80, rect, 20)).toBe(false)
  })

  it("clamps free and aspect-locked bottom-right resizing", () => {
    const origin = { x: 10, y: 20, width: 100, height: 50 }
    expect(
      clampBottomRightResize(origin, -200, -200, {
        width: 60,
        height: 40,
      })
    ).toEqual({ x: 10, width: 60, height: 40 })
    expect(
      clampBottomRightResize(origin, 100, 10, { width: 20, height: 20 }, 2)
    ).toEqual({ x: 10, width: 200, height: 100 })
  })

  it("applies live dimensions without mutating the source item", () => {
    const resized = withLiveResize(items[0], {
      x: 30,
      width: 200,
      height: 160,
    })
    expect(resized.data).toMatchObject({ x: 30, width: 200, height: 160 })
    expect(items[0].data.x).toBe(10)
  })
})

describe("overlapRatio", () => {
  const subject = { x: 0, y: 0, width: 100, height: 100 }

  it("returns 0 when the rects are apart or merely touching", () => {
    expect(
      overlapRatio(subject, { x: 200, y: 200, width: 50, height: 50 })
    ).toBe(0)
    expect(overlapRatio(subject, { x: 100, y: 0, width: 50, height: 50 })).toBe(
      0
    )
  })

  it("measures coverage as a fraction of the subject's own area", () => {
    // Half the width, all the height -> half the subject is covered.
    expect(
      overlapRatio(subject, { x: 50, y: 0, width: 100, height: 100 })
    ).toBeCloseTo(0.5)
    // A quarter in each axis -> a sixteenth of the area.
    expect(
      overlapRatio(subject, { x: 75, y: 75, width: 100, height: 100 })
    ).toBeCloseTo(0.0625)
  })

  it("reports 1 when fully covered, and is not symmetric", () => {
    const big = { x: -50, y: -50, width: 400, height: 400 }
    expect(overlapRatio(subject, big)).toBeCloseTo(1)
    expect(overlapRatio(big, subject)).toBeLessThan(0.1)
  })

  it("returns 0 for a zero-area subject", () => {
    expect(overlapRatio({ x: 0, y: 0, width: 0, height: 0 }, subject)).toBe(0)
  })
})

describe("findEmptySlot", () => {
  const bounds = { x: 0, y: 0, width: 1000, height: 1000 }
  const size = { width: 200, height: 200 }
  // Centred top-left: 500 - 100 = 400 on both axes.
  const centred = { x: 400, y: 400 }

  it("centres the item in the viewport when the board is empty", () => {
    expect(findEmptySlot([], bounds, size)).toEqual(centred)
  })

  it("accounts for the item's own size rather than returning the raw centre", () => {
    const wide = findEmptySlot([], bounds, { width: 480, height: 252 })
    expect(wide).toEqual({ x: 500 - 240, y: 500 - 126 })
  })

  it("steps diagonally until overlap falls within the limit", () => {
    const blocker = { ...centred, ...size }
    const step = Math.round(size.width * SLOT_STEP_RATIO)
    const slot = findEmptySlot([blocker], bounds, size)

    // Lands on the diagonal, offset by a whole number of steps.
    const offset = slot.x - centred.x
    expect(offset).toBe(slot.y - centred.y)
    expect(offset % step).toBe(0)

    // It is the *first* such candidate: this one passes, the previous fails.
    expect(overlapRatio({ ...slot, ...size }, blocker)).toBeLessThanOrEqual(
      0.25
    )
    const previous = { x: slot.x - step, y: slot.y - step }
    expect(overlapRatio({ ...previous, ...size }, blocker)).toBeGreaterThan(
      0.25
    )
  })

  it("tolerates overlap at or below the limit", () => {
    // Covers 10% of the candidate: under the 25% limit, so the centre stands.
    const graze = { x: centred.x + 180, y: centred.y, width: 200, height: 100 }
    expect(findEmptySlot([graze], bounds, size)).toEqual(centred)
  })

  it("keeps the item inside the viewport, falling back to the centre", () => {
    // A blocker spanning the whole search diagonal leaves no clear candidate.
    const wall = { x: 0, y: 0, width: 1000, height: 1000 }
    expect(findEmptySlot([wall], bounds, size)).toEqual(centred)
  })

  it("never returns a slot extending past the viewport", () => {
    const blockers = Array.from({ length: 40 }, (_, i) => ({
      x: centred.x + i * 16,
      y: centred.y + i * 16,
      width: 200,
      height: 200,
    }))
    const slot = findEmptySlot(blockers, bounds, size)
    expect(slot.x + size.width).toBeLessThanOrEqual(bounds.x + bounds.width)
    expect(slot.y + size.height).toBeLessThanOrEqual(bounds.y + bounds.height)
  })

  it("still returns the centred slot when the item exceeds the viewport", () => {
    const tiny = { x: 0, y: 0, width: 50, height: 50 }
    expect(findEmptySlot([], tiny, size)).toEqual({ x: -75, y: -75 })
  })

  it("respects a panned viewport's board-space origin", () => {
    const panned = { x: 2000, y: 1500, width: 800, height: 600 }
    expect(findEmptySlot([], panned, size)).toEqual({ x: 2300, y: 1700 })
  })
})
