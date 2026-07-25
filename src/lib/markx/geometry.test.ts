import { describe, expect, it } from "vitest"

import {
  clampBottomRightResize,
  getBoardItemRect,
  hitTestBoardItems,
  isInBottomRightResizeZone,
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
