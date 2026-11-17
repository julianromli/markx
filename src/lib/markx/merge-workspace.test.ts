import { describe, expect, it } from "vitest"

import {
  filterDeletedImageIdsForState,
  mergeWorkspaceStates,
  threeWayMergeWorkspaceStates,
} from "@/lib/markx/merge-workspace"
import { createEmptyState } from "@/lib/markx/seed"
import type { Bookmark, MarkxState } from "@/lib/markx/types"

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
    expect(filterDeletedImageIdsForState(["keep-me", "gone"], state)).toEqual([
      "gone",
    ])
  })

  it("returns an empty list when nothing was queued", () => {
    expect(
      filterDeletedImageIdsForState(undefined, createEmptyState())
    ).toEqual([])
  })
})

function bookmark(id: string, folderId = "f1"): Bookmark {
  return {
    id,
    folderId,
    url: `https://example.com/${id}`,
    title: id,
    x: 0,
    y: 0,
    z: 1,
  }
}

function stateWithBookmarks(ids: string[]): MarkxState {
  return {
    ...createEmptyState(),
    folders: [{ id: "f1", name: "F", x: 0, y: 0, z: 1 }],
    bookmarks: ids.map((id) => bookmark(id)),
    zCounter: 1,
  }
}

describe("threeWayMergeWorkspaceStates", () => {
  it("keeps a cloud-only add (extension bookmark) and a local-only add", () => {
    const base = stateWithBookmarks(["shared"])
    const local = stateWithBookmarks(["shared", "local-add"])
    const cloud = stateWithBookmarks(["shared", "extension-add"])
    const merged = threeWayMergeWorkspaceStates(base, local, cloud)
    expect(merged.bookmarks.map((item) => item.id)).toEqual([
      "shared",
      "extension-add",
      "local-add",
    ])
  })

  it("honors a local delete and a cloud delete", () => {
    const base = stateWithBookmarks(["keep", "local-deleted", "cloud-deleted"])
    const local = stateWithBookmarks(["keep", "cloud-deleted"])
    const cloud = stateWithBookmarks(["keep", "local-deleted"])
    const merged = threeWayMergeWorkspaceStates(base, local, cloud)
    expect(merged.bookmarks.map((item) => item.id)).toEqual(["keep"])
  })

  it("lets the cloud win when both sides changed the same entity", () => {
    const base = stateWithFolder("same", "base-name")
    const local = stateWithFolder("same", "local-name")
    const cloud = stateWithFolder("same", "cloud-name")
    const merged = threeWayMergeWorkspaceStates(base, local, cloud)
    expect(merged.folders[0]?.name).toBe("cloud-name")
  })
})
