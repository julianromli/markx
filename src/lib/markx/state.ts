import { createDemoState, createEmptyState } from "./seed"
import { isGuestImported, loadState } from "./storage"
import type { MarkxStorage } from "./storage"
import type { Bookmark, Folder, MarkxState } from "./types"

export { createEmptyState }

export function cloneState(source: MarkxState): MarkxState {
  return {
    hasOnboarded: source.hasOnboarded,
    zCounter: source.zCounter,
    folders: source.folders.map((folder) => ({ ...folder })),
    bookmarks: source.bookmarks.map((bookmark) => ({ ...bookmark })),
    notes: source.notes.map((note) => ({ ...note })),
    images: source.images.map((image) => ({ ...image })),
  }
}

export function nextZ(state: MarkxState): { z: number; zCounter: number } {
  const z = state.zCounter + 1
  return { z, zCounter: z }
}

export function countBookmarksInFolder(
  bookmarks: Bookmark[],
  folderId: string
): number {
  return bookmarks.filter((bookmark) => bookmark.folderId === folderId).length
}

export function getFolder(folders: Folder[], id: string): Folder | undefined {
  return folders.find((folder) => folder.id === id)
}

export function isGuestModified(state: MarkxState): boolean {
  return JSON.stringify(state) !== JSON.stringify(createDemoState())
}

export type GuestImportStorage = Pick<MarkxStorage, "load"> & {
  isGuestImported: (userId: string) => Promise<boolean>
}

export const guestImportStorage: GuestImportStorage = {
  load: loadState,
  isGuestImported,
}

export async function shouldImportGuest(
  _userId: string,
  _storage: GuestImportStorage = guestImportStorage
): Promise<boolean> {
  // Guest edits are disposable. Login always loads the cloud workspace.
  return false
}

export async function getGuestImportDecision(
  _userId: string,
  _storage: GuestImportStorage = guestImportStorage
): Promise<{ shouldImport: boolean; guestState: MarkxState | null }> {
  return { shouldImport: false, guestState: null }
}
