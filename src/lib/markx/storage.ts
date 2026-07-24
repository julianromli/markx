import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import { createDemoState, createEmptyState } from "./seed"
import type { Bookmark, Folder, MarkxState } from "./types"

const DB_NAME = "markx-db-v2"
const DB_VERSION = 2
const STATE_KEY = "state"
const IMAGES_STORE = "images"

interface MarkxDB extends DBSchema {
  meta: {
    key: string
    value: MarkxState
  }
  images: {
    key: string
    value: Blob
  }
}

async function getDb(): Promise<IDBPDatabase<MarkxDB>> {
  return openDB<MarkxDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore("meta")
      }
      if (oldVersion < 2) {
        db.createObjectStore(IMAGES_STORE)
      }
    },
  })
}

export async function loadState(): Promise<MarkxState> {
  if (typeof indexedDB === "undefined") {
    return createDemoState()
  }
  const db = await getDb()
  const existing = await db.get("meta", STATE_KEY)
  if (existing) {
    return {
      ...existing,
      notes: existing.notes ?? [],
      images: existing.images ?? [],
    }
  }
  const demo = createDemoState()
  await db.put("meta", demo, STATE_KEY)
  return demo
}

export async function saveState(state: MarkxState): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.put("meta", state, STATE_KEY)
}

export async function saveImageBlob(id: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.put(IMAGES_STORE, blob, id)
}

export async function getImageBlob(id: string): Promise<Blob | undefined> {
  if (typeof indexedDB === "undefined") return undefined
  const db = await getDb()
  return db.get(IMAGES_STORE, id)
}

export async function sweepOrphanImageBlobs(
  referencedIds: Set<string>,
): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  const tx = db.transaction(IMAGES_STORE, "readwrite")
  let cursor = await tx.store.openCursor()
  while (cursor) {
    if (!referencedIds.has(cursor.key as string)) {
      cursor.delete()
    }
    cursor = await cursor.continue()
  }
  await tx.done
}

export async function clearDemoAndReset(): Promise<MarkxState> {
  const empty = createEmptyState()
  await saveState(empty)
  return empty
}

export type MarkxStorage = {
  load: () => Promise<MarkxState>
  save: (state: MarkxState) => Promise<void>
}

export const localMarkxStorage: MarkxStorage = {
  load: loadState,
  save: saveState,
}

export function nextZ(state: MarkxState): { z: number; zCounter: number } {
  const z = state.zCounter + 1
  return { z, zCounter: z }
}

export function countBookmarksInFolder(
  bookmarks: Bookmark[],
  folderId: string,
): number {
  return bookmarks.filter((b) => b.folderId === folderId).length
}

export function getFolder(
  folders: Folder[],
  id: string,
): Folder | undefined {
  return folders.find((f) => f.id === id)
}
