import { describe, expect, it } from "vitest"

import {
  findNonOverlappingPosition,
  FOLDER_SIZE,
  NOTE_SIZE,
  type Rect,
} from "./geometry"

describe("findNonOverlappingPosition", () => {
  it("returns preferred when the center is free", () => {
    const preferred = { x: 100, y: 100 }
    const result = findNonOverlappingPosition(preferred, NOTE_SIZE, [])
    expect(result).toEqual(preferred)
  })

  it("moves around an obstacle occupying the preferred spot", () => {
    const preferred = { x: 100, y: 100 }
    const obstacles: Rect[] = [
      {
        x: preferred.x,
        y: preferred.y,
        width: NOTE_SIZE.width,
        height: NOTE_SIZE.height,
      },
    ]
    const result = findNonOverlappingPosition(preferred, NOTE_SIZE, obstacles)
    expect(result).not.toEqual(preferred)

    const placed: Rect = {
      x: result.x,
      y: result.y,
      width: NOTE_SIZE.width,
      height: NOTE_SIZE.height,
    }
    // Must not overlap the obstacle (allowing the placer's gap padding).
    const gap = 24
    const padded: Rect = {
      x: placed.x - gap / 2,
      y: placed.y - gap / 2,
      width: placed.width + gap,
      height: placed.height + gap,
    }
    const obstacle = obstacles[0]!
    const overlaps =
      padded.x < obstacle.x + obstacle.width &&
      padded.x + padded.width > obstacle.x &&
      padded.y < obstacle.y + obstacle.height &&
      padded.y + padded.height > obstacle.y
    expect(overlaps).toBe(false)
  })

  it("places a folder-sized item near a blocking note", () => {
    const preferred = { x: 200, y: 200 }
    const obstacles: Rect[] = [
      { x: 200, y: 200, width: NOTE_SIZE.width, height: NOTE_SIZE.height },
    ]
    const result = findNonOverlappingPosition(
      preferred,
      FOLDER_SIZE,
      obstacles,
    )
    expect(Math.hypot(result.x - preferred.x, result.y - preferred.y)).toBeGreaterThan(
      0,
    )
  })
})
