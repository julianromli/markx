import { openDB, type DBSchema, type IDBPDatabase } from "idb"

import { createDemoState } from "./seed"
import type { Bookmark, Folder, MarkxState } from "./types"

const DB_NAME = "markx-db-v2"
const DB_VERSION = 3
const IMAGES_STORE = "images"
const SYNC_STORE = "sync"

/**
 * Meta store keys.
 *
 * - `state` — the guest (logged-out) workspace state. Kept for backward
 *   compatibility with v2 databases and so the guest demo works offline.
 * - `user:{userId}:state` — per-user cached workspace state, used for
 *   instant load on repeat visits and full offline editing.
 */
const GUEST_STATE_KEY = "state"
const userStateKey = (userId: string) => `user:${userId}:state`

/**
 * Sync store keys (all scoped per-user so switching accounts never mixes
 * pending writes or versions).
 *
 * - `cloudVersion:{userId}` — last known cloud `version` for optimistic
 *   locking. Updated after every successful save.
 * - `guestImported:{userId}` — `"1"` once the guest demo has been imported
 *   into this user's cloud workspace. Prevents re-importing on every login.
 * - `pendingSnapshot:{userId}` — coalesced latest state awaiting sync.
 *   `null`/absent means no pending write.
 * - `pendingDeletedImageIds:{userId}` — accumulated image IDs removed since
 *   the last successful sync, so the server can soft-delete them.
 * - `assetQueue:{userId}` — array of image blobs (as data URLs) waiting to
 *   be uploaded to R2 when the connection returns.
 */
const cloudVersionKey = (userId: string) => `cloudVersion:${userId}`
const guestImportedKey = (userId: string) => `guestImported:${userId}`
const pendingSnapshotKey = (userId: string) => `pendingSnapshot:${userId}`
const pendingDeletedKey = (userId: string) => `pendingDeletedImageIds:${userId}`
const assetQueueKey = (userId: string) => `assetQueue:${userId}`

export type PendingAsset = {
  imageId: string
  mime: string
  dataUrl: string
}

interface MarkxDB extends DBSchema {
  meta: {
    key: string
    value: MarkxState
  }
  images: {
    key: string
    value: Blob
  }
  sync: {
    key: string
    value: unknown
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
      if (oldVersion < 3) {
        db.createObjectStore(SYNC_STORE)
      }
    },
  })
}

/* ------------------------------------------------------------------ */
/* State load / save (guest + per-user)                                */
/* ------------------------------------------------------------------ */

/**
 * Load the guest (logged-out) workspace state. Seeds the demo state on
 * first run so the app is immediately useful without an account.
 */
export async function loadState(): Promise<MarkxState> {
  if (typeof indexedDB === "undefined") {
    return createDemoState()
  }
  const db = await getDb()
  const existing = await db.get("meta", GUEST_STATE_KEY)
  if (existing) {
    return {
      ...existing,
      notes: existing.notes ?? [],
      images: existing.images ?? [],
    }
  }
  const demo = createDemoState()
  await db.put("meta", demo, GUEST_STATE_KEY)
  return demo
}

/**
 * Save the guest workspace state (debounced by the store).
 */
export async function saveState(state: MarkxState): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.put("meta", state, GUEST_STATE_KEY)
}

/**
 * Load the per-user cached workspace state. Returns `null` if no cache
 * exists for this user yet (first login on this device).
 */
export async function loadUserState(
  userId: string,
): Promise<MarkxState | null> {
  if (typeof indexedDB === "undefined") return null
  const db = await getDb()
  const existing = await db.get("meta", userStateKey(userId))
  if (!existing) return null
  return {
    ...existing,
    notes: existing.notes ?? [],
    images: existing.images ?? [],
  }
}

/**
 * Save the per-user cached workspace state.
 */
export async function saveUserState(
  userId: string,
  state: MarkxState,
): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.put("meta", state, userStateKey(userId))
}

/**
 * Clear the per-user cache (used on sign-out so the next login starts
 * fresh from the cloud, and so a different user on this device doesn't
 * see stale data).
 *
 * Does NOT clear `guestImported` — that flag is durable and should
 * survive sign-out so the user isn't re-prompted to import on next
 * login.
 */
export async function clearUserCache(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.delete("meta", userStateKey(userId))
  await db.delete("sync", cloudVersionKey(userId))
  await db.delete("sync", pendingSnapshotKey(userId))
  await db.delete("sync", pendingDeletedKey(userId))
  await db.delete("sync", assetQueueKey(userId))
}

/* ------------------------------------------------------------------ */
/* Image blobs (shared store, keyed by imageId)                       */
/* ------------------------------------------------------------------ */

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

export async function deleteImageBlobs(ids: string[]): Promise<void> {
  if (typeof indexedDB === "undefined" || ids.length === 0) return
  const db = await getDb()
  const tx = db.transaction(IMAGES_STORE, "readwrite")
  await Promise.all(ids.map((id) => tx.store.delete(id)))
  await tx.done
}

/* ------------------------------------------------------------------ */
/* Sync metadata (per-user)                                            */
/* ------------------------------------------------------------------ */

export async function getCloudVersion(userId: string): Promise<number> {
  if (typeof indexedDB === "undefined") return 0
  const db = await getDb()
  const v = await db.get("sync", cloudVersionKey(userId))
  return typeof v === "number" ? v : 0
}

export async function setCloudVersion(
  userId: string,
  version: number,
): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.put("sync", version, cloudVersionKey(userId))
}

export async function isGuestImported(userId: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false
  const db = await getDb()
  return (await db.get("sync", guestImportedKey(userId))) === "1"
}

export async function markGuestImported(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.put("sync", "1", guestImportedKey(userId))
}

/**
 * Read the coalesced pending snapshot (or `null` if the queue is empty).
 */
export async function getPendingSnapshot(
  userId: string,
): Promise<MarkxState | null> {
  if (typeof indexedDB === "undefined") return null
  const db = await getDb()
  const v = await db.get("sync", pendingSnapshotKey(userId))
  return (v as MarkxState | undefined) ?? null
}

/**
 * Overwrite the coalesced pending snapshot. Pass `null` to clear it
 * (after a successful sync).
 */
export async function setPendingSnapshot(
  userId: string,
  state: MarkxState | null,
): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  if (state === null) {
    await db.delete("sync", pendingSnapshotKey(userId))
  } else {
    await db.put("sync", state, pendingSnapshotKey(userId))
  }
}

/**
 * Accumulate deleted image IDs since the last sync. Returns the full
 * accumulated set so the caller can pass it with the next save.
 */
export async function addDeletedImageIds(
  userId: string,
  ids: string[],
): Promise<string[]> {
  if (typeof indexedDB === "undefined" || ids.length === 0) return []
  const db = await getDb()
  const existing =
    (await db.get("sync", pendingDeletedKey(userId))) ?? []
  const set = new Set(existing as string[])
  for (const id of ids) set.add(id)
  const merged = [...set]
  await db.put("sync", merged, pendingDeletedKey(userId))
  return merged
}

export async function getDeletedImageIds(userId: string): Promise<string[]> {
  if (typeof indexedDB === "undefined") return []
  const db = await getDb()
  return ((await db.get("sync", pendingDeletedKey(userId))) ?? []) as string[]
}

export async function clearDeletedImageIds(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.delete("sync", pendingDeletedKey(userId))
}

/**
 * Enqueue an image blob (as a data URL) for upload to R2.
 */
export async function enqueueAsset(
  userId: string,
  asset: PendingAsset,
): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  const existing =
    ((await db.get("sync", assetQueueKey(userId))) ?? []) as PendingAsset[]
  existing.push(asset)
  await db.put("sync", existing, assetQueueKey(userId))
}

export async function getAssetQueue(
  userId: string,
): Promise<PendingAsset[]> {
  if (typeof indexedDB === "undefined") return []
  const db = await getDb()
  return ((await db.get("sync", assetQueueKey(userId))) ?? []) as PendingAsset[]
}

export async function clearAssetQueue(userId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return
  const db = await getDb()
  await db.delete("sync", assetQueueKey(userId))
}

/* ------------------------------------------------------------------ */
/* Helpers + legacy exports                                           */
/* ------------------------------------------------------------------ */

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
