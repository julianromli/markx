import type { BoardItemModel } from "./geometry"
import type { MarkxState } from "./types"

export type WorkspaceLocation =
  { mode: "home" } | { mode: "folder"; folderId: string }

export type ClassifiedItemIds = {
  folderIds: string[]
  bookmarkIds: string[]
  noteIds: string[]
  imageIds: string[]
}

export function selectWorkspaceItems(
  state: MarkxState,
  location: WorkspaceLocation
): BoardItemModel[] {
  if (location.mode === "home") {
    return [
      ...state.folders.map((data) => ({
        id: data.id,
        kind: "folder" as const,
        data,
      })),
      ...state.notes
        .filter((note) => note.folderId == null)
        .map((data) => ({ id: data.id, kind: "note" as const, data })),
      ...state.images
        .filter((image) => image.folderId == null)
        .map((data) => ({ id: data.id, kind: "image" as const, data })),
    ]
  }

  return [
    ...state.bookmarks
      .filter((bookmark) => bookmark.folderId === location.folderId)
      .map((data) => ({ id: data.id, kind: "bookmark" as const, data })),
    ...state.notes
      .filter((note) => note.folderId === location.folderId)
      .map((data) => ({ id: data.id, kind: "note" as const, data })),
    ...state.images
      .filter((image) => image.folderId === location.folderId)
      .map((data) => ({ id: data.id, kind: "image" as const, data })),
  ]
}

export function classifyItemIds(
  state: MarkxState,
  ids: readonly string[]
): ClassifiedItemIds {
  const selected = new Set(ids)
  return {
    folderIds: state.folders.filter((item) => selected.has(item.id)).map(idOf),
    bookmarkIds: state.bookmarks
      .filter((item) => selected.has(item.id))
      .map(idOf),
    noteIds: state.notes.filter((item) => selected.has(item.id)).map(idOf),
    imageIds: state.images.filter((item) => selected.has(item.id)).map(idOf),
  }
}

function idOf(item: { id: string }): string {
  return item.id
}
