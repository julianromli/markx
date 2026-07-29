import { describe, expect, it } from "vitest"

import { countMarkxEntities, FREE_TIER_ENTITY_LIMIT } from "@/lib/markx/entity-count"
import { createEmptyState } from "@/lib/markx/seed"

describe("countMarkxEntities", () => {
  it("sums folders, bookmarks, notes, and images", () => {
    const state = createEmptyState()
    state.folders.push({
      id: "f1",
      name: "A",
      x: 0,
      y: 0,
      z: 1,
    })
    state.bookmarks.push({
      id: "b1",
      folderId: "f1",
      url: "https://example.com",
      title: "x",
      x: 0,
      y: 0,
      z: 2,
    })
    expect(countMarkxEntities(state)).toBe(2)
    expect(FREE_TIER_ENTITY_LIMIT).toBe(100)
  })
})
