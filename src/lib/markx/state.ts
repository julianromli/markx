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
  const demo = createDemoState()
  return (
    state.folders.length !== demo.folders.length ||
    state.bookmarks.length !== demo.bookmarks.length ||
    state.notes.length > 0 ||
    state.images.length > 0 ||
    state.zCounter !== demo.zCounter ||
    state.hasOnboarded !== demo.hasOnboarded
  )
}

export type GuestImportStorage = Pick<MarkxStorage, "load"> & {
  isGuestImported: (userId: string) => Promise<boolean>
}

export const guestImportStorage: GuestImportStorage = {
  load: loadState,
  isGuestImported,
}

export async function shouldImportGuest(
  userId: string,
  storage: GuestImportStorage = guestImportStorage
): Promise<boolean> {
  return (await getGuestImportDecision(userId, storage)).shouldImport
}

export async function getGuestImportDecision(
  userId: string,
  storage: GuestImportStorage = guestImportStorage
): Promise<{ shouldImport: boolean; guestState: MarkxState | null }> {
  if (await storage.isGuestImported(userId)) {
    return { shouldImport: false, guestState: null }
  }
  const guestState = await storage.load()
  return { shouldImport: isGuestModified(guestState), guestState }
}
