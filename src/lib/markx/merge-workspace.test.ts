import { describe, expect, it } from "vitest"

import {
  filterDeletedImageIdsForState,
  mergeWorkspaceStates,
} from "@/lib/markx/merge-workspace"
import { createEmptyState } from "@/lib/markx/seed"
import type { MarkxState } from "@/lib/markx/types"

function stateWithFolder(id: string, name = id): MarkxState {
  return {
    ...createEmptyState(),
    folders: [{ id, name, x: 0, y: 0, z: 1 }],
    zCounter: 1,
  }
}

function stateWithImage(imageId: string): MarkxState {
  return {
    ...createEmptyState(),
    images: [
      {
        id: "board-" + imageId,
        folderId: null,
        imageId,
        mime: "image/png",
        naturalWidth: 1,
        naturalHeight: 1,
        x: 0,
        y: 0,
        z: 1,
      },
    ],
    zCounter: 1,
  }
}

describe("mergeWorkspaceStates", () => {
  it("unions folders with different ids", () => {
    const local = stateWithFolder("laptop")
    const cloud = stateWithFolder("mobile")
    const merged = mergeWorkspaceStates(local, cloud)
    expect(merged.folders.map((folder) => folder.id)).toEqual([
      "mobile",
      "laptop",
    ])
  })

  it("keeps the cloud entity when ids collide", () => {
    const local = stateWithFolder("same", "local-name")
    const cloud = stateWithFolder("same", "cloud-name")
    const merged = mergeWorkspaceStates(local, cloud)
    expect(merged.folders).toHaveLength(1)
    expect(merged.folders[0]?.name).toBe("cloud-name")
  })

  it("takes the max zCounter and ORs hasOnboarded", () => {
    const local: MarkxState = {
      ...createEmptyState(),
      hasOnboarded: true,
      zCounter: 3,
    }
    const cloud: MarkxState = {
      ...createEmptyState(),
      hasOnboarded: false,
      zCounter: 9,
    }
    const merged = mergeWorkspaceStates(local, cloud)
    expect(merged.hasOnboarded).toBe(true)
    expect(merged.zCounter).toBe(9)
  })
})

describe("filterDeletedImageIdsForState", () => {
  it("drops delete ids that the written state still references", () => {
    const state = stateWithImage("keep-me")
    expect(
      filterDeletedImageIdsForState(["keep-me", "gone"], state)
    ).toEqual(["gone"])
  })

  it("returns an empty list when nothing was queued", () => {
    expect(
      filterDeletedImageIdsForState(undefined, createEmptyState())
    ).toEqual([])
  })
})
