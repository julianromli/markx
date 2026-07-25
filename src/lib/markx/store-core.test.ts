import { describe, expect, it, vi } from "vitest"

import { createMarkxStore, store } from "@/lib/markx/store"
import { createEmptyState } from "@/lib/markx/state"

describe("createMarkxStore", () => {
  it("creates isolated stores with injectable persistence", async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const created = createMarkxStore({
      storage: {
        load: vi.fn(async () => createEmptyState()),
        save,
      },
      enrich: vi.fn(async () => ({
        title: "",
        description: undefined,
        imageUrl: undefined,
        faviconUrl: "",
      })),
      sweepOrphanImages: vi.fn(async () => {}),
    })
    const appFolderCount = store.getState().folders.length

    created.actions.createFolder(10, 20, "Factory")
    expect(created.getState().folders).toHaveLength(1)
    expect(store.getState().folders).toHaveLength(appFolderCount)

    await vi.advanceTimersByTimeAsync(120)
    expect(save).toHaveBeenCalledWith(created.getState())
    vi.useRealTimers()
  })
})
