import { describe, expect, it } from "vitest"

import {
  classifyItemIds,
  countItemsInFolders,
  folderHasItems,
  selectWorkspaceItems,
} from "./workspace-items"
import type { MarkxState } from "./types"

const state: MarkxState = {
  hasOnboarded: true,
  zCounter: 8,
  folders: [
    { id: "f1", name: "One", x: 0, y: 0, z: 1 },
    { id: "f2", name: "Two", x: 0, y: 0, z: 2 },
  ],
  bookmarks: [
    {
      id: "b1",
      folderId: "f1",
      url: "https://example.com",
      title: "Example",
      x: 0,
      y: 0,
      z: 3,
    },
  ],
  notes: [
    {
      id: "n-home",
      folderId: null,
      content: "",
      color: "yellow",
      font: "sans",
      fontSize: "m",
      x: 0,
      y: 0,
      z: 4,
    },
    {
      id: "n1",
      folderId: "f1",
      content: "",
      color: "blue",
      font: "sans",
      fontSize: "m",
      x: 0,
      y: 0,
      z: 5,
    },
  ],
  images: [
    {
      id: "i-home",
      folderId: null,
      imageId: "asset-home",
      mime: "image/png",
      naturalWidth: 10,
      naturalHeight: 10,
      x: 0,
      y: 0,
      z: 6,
    },
    {
      id: "i1",
      folderId: "f1",
      imageId: "asset-1",
      mime: "image/png",
      naturalWidth: 10,
      naturalHeight: 10,
      x: 0,
      y: 0,
      z: 7,
    },
  ],
}

describe("workspace item helpers", () => {
  it("selects only items visible at the current location", () => {
    expect(
      selectWorkspaceItems(state, { mode: "home" }).map((item) => item.id)
    ).toEqual(["f1", "f2", "n-home", "i-home"])
    expect(
      selectWorkspaceItems(state, { mode: "folder", folderId: "f1" }).map(
        (item) => item.id
      )
    ).toEqual(["b1", "n1", "i1"])
  })

  it("classifies mixed IDs by entity type", () => {
    expect(classifyItemIds(state, ["i1", "f1", "missing", "n1", "b1"])).toEqual(
      {
        folderIds: ["f1"],
        bookmarkIds: ["b1"],
        noteIds: ["n1"],
        imageIds: ["i1"],
      }
    )
  })

  it("detects and counts folder contents across item types", () => {
    expect(folderHasItems(state, "f1")).toBe(true)
    expect(folderHasItems(state, "f2")).toBe(false)
    expect(countItemsInFolders(state, ["f1"])).toBe(3)
  })
})
