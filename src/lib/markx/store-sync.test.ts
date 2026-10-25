/**
 * Store and sync engine persistence: one owner for workspace state, one
 * save timer per mode, and acks that never overwrite newer local edits.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import { createMarkxStore } from "@/lib/markx/store"
import type { MarkxStoreDependencies } from "@/lib/markx/store"
import { createEmptyState } from "@/lib/markx/seed"
import { SyncEngine } from "@/lib/markx/sync"
import type { SyncEngineDependencies } from "@/lib/markx/sync"
import type { LinkMetadata, MarkxState } from "@/lib/markx/types"

afterEach(() => {
  vi.useRealTimers()
})

function makeStore(enrich?: MarkxStoreDependencies["enrich"]) {
  const save = vi.fn(async (_state: MarkxState) => {})
  const store = createMarkxStore({
    storage: { load: vi.fn(async () => createEmptyState()), save },
    enrich:
      enrich ??
      vi.fn(async (): Promise<LinkMetadata> => ({
        title: "Example",
        faviconUrl: "",
      })),
    sweepOrphanImages: vi.fn(async () => {}),
  })
  return { store, save }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Minimal in-memory SyncEngine dependencies. `save` echoes the sent state. */
function makeEngineDeps(
  saveImpl?: SyncEngineDependencies["workspace"]["save"]
): SyncEngineDependencies {
  return {
    workspace: {
      load: vi.fn(async () => null),
      getVersion: vi.fn(async () => 1),
      save:
        saveImpl ??
        vi.fn(async (input) => ({
          ok: true as const,
          version: input.baseVersion + 1,
          updatedAt: "now",
          state: input.state,
        })),
      importGuest: vi.fn(),
      overwrite: vi.fn(),
    },
    assets: {
      upload: vi.fn(async () => ({ ok: true })),
      fetch: vi.fn(async () => ({ ok: false as const })),
    },
    storage: {
      loadGuestState: vi.fn(async () => createEmptyState()),
      resetGuestState: vi.fn(async () => createEmptyState()),
      loadUserState: vi.fn(async () => createEmptyState()),
      saveUserState: vi.fn(async () => {}),
      clearUserCache: vi.fn(async () => {}),
      getCloudVersion: vi.fn(async () => 1),
      setCloudVersion: vi.fn(async () => {}),
      isGuestImported: vi.fn(async () => true),
      markGuestImported: vi.fn(async () => {}),
      getPendingSnapshot: vi.fn(async () => null),
      setPendingSnapshot: vi.fn(async () => {}),
      addDeletedImageIds: vi.fn(async () => []),
      getDeletedImageIds: vi.fn(async () => []),
      clearDeletedImageIds: vi.fn(async () => {}),
      getAssetQueue: vi.fn(async () => []),
      enqueueAsset: vi.fn(async () => {}),
      removeAssetsFromQueue: vi.fn(async () => {}),
      saveImageBlob: vi.fn(async () => {}),
      getImageBlob: vi.fn(async () => undefined),
    },
  }
}

describe("store persistence with a sync engine", () => {
  it("MX-01 a user edit reaches the sync engine even when an enrich result lands inside the 120ms persist debounce", async () => {
    vi.useFakeTimers()
    // Open Graph scrape takes 300ms.
    const { store } = makeStore(
      () =>
        new Promise<LinkMetadata>((resolve) =>
          setTimeout(() => resolve({ title: "Example", faviconUrl: "" }), 300)
        )
    )
    const onStateChange = vi.fn()
    store.attachSync({
      onStateChange,
      subscribe: () => () => {},
    } as unknown as SyncEngine)

    const folder = store.actions.createFolder(0, 0, "Reading")
    store.actions.createBookmark(folder.id, "example.com", 0, 0)
    await vi.advanceTimersByTimeAsync(250) // bookmark create is pushed
    onStateChange.mockClear()

    // User renames the folder 50ms before the enrich result lands.
    store.actions.renameFolder(folder.id, "Reading list")
    await vi.advanceTimersByTimeAsync(1000)

    expect(onStateChange).toHaveBeenCalled()
    const lastPushed = onStateChange.mock.calls.at(-1)?.[0] as MarkxState
    expect(lastPushed.folders[0]?.name).toBe("Reading list")
  })

  it("MX-02 a successful cloud save keeps the local undo history", async () => {
    vi.useFakeTimers()
    const { store } = makeStore()
    const engine = await SyncEngine.createFromCache("u1", makeEngineDeps())
    store.attachSync(engine)

    store.actions.createFolder(0, 0, "A")
    expect(store.getHistory().canUndo).toBe(true)

    // 120ms store debounce + 1500ms engine debounce + save round-trip.
    await vi.advanceTimersByTimeAsync(2000)

    expect(engine.getStatus()).toBe("saved")
    expect(store.getHistory().canUndo).toBe(true)
    engine.destroy()
  })

  it("MX-03 an edit made while a cloud save is in flight is not reverted when the save returns", async () => {
    vi.useFakeTimers()
    const { store } = makeStore()
    const pendingSave = deferred<{
      ok: true
      version: number
      updatedAt: string
      state: MarkxState
    }>()
    let sentState: MarkxState | null = null
    const deps = makeEngineDeps(
      vi.fn(async (input) => {
        sentState = input.state
        return pendingSave.promise
      })
    )
    const engine = await SyncEngine.createFromCache("u1", deps)
    store.attachSync(engine)

    store.actions.createFolder(0, 0, "A")
    await vi.advanceTimersByTimeAsync(1700) // save for "A" is now in flight
    expect(sentState).not.toBeNull()

    // User adds folder B. Store debounce (120ms) has not fired yet.
    store.actions.createFolder(300, 0, "B")
    pendingSave.resolve({
      ok: true,
      version: 2,
      updatedAt: "now",
      state: sentState!,
    })
    await vi.advanceTimersByTimeAsync(10)

    expect(store.getState().folders.map((f) => f.name)).toEqual(["A", "B"])
    engine.destroy()
  })

  it("MX-08 a plain tap (raiseZ) does not schedule a cloud save", async () => {
    vi.useFakeTimers()
    const { store } = makeStore()
    const onStateChange = vi.fn()
    store.attachSync({
      onStateChange,
      subscribe: () => () => {},
    } as unknown as SyncEngine)
    const folder = store.actions.createFolder(0, 0, "F")
    await vi.advanceTimersByTimeAsync(200)
    onStateChange.mockClear()

    // Board.onPointerDown calls onRaiseZ for every tap on an item.
    store.actions.raiseZ([folder.id])
    await vi.advanceTimersByTimeAsync(200)

    expect(onStateChange).not.toHaveBeenCalled()
  })

  it("MX-02 a save ack never emits an authoritative state", async () => {
    vi.useFakeTimers()
    const engine = await SyncEngine.createFromCache("u1", makeEngineDeps())
    const listener = vi.fn()
    engine.subscribe(listener)
    engine.onStateChange({ ...createEmptyState(), zCounter: 2 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(engine.getStatus()).toBe("saved")
    for (const call of listener.mock.calls) expect(call[2]).toBeUndefined()
    engine.destroy()
  })

  it("MX-08 tapping an item that another item covers still raises it", () => {
    const { store } = makeStore()
    const low = store.actions.createFolder(0, 0, "Low")
    store.actions.createFolder(10, 10, "High")
    store.actions.raiseZ([low.id])
    const folders = store.getState().folders
    const lowZ = folders.find((f) => f.id === low.id)?.z ?? 0
    expect(lowZ).toBeGreaterThan(
      Math.max(...folders.filter((f) => f.id !== low.id).map((f) => f.z))
    )
  })
})
