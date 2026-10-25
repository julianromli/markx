import { afterEach, describe, expect, it, vi } from "vitest"

import { createMarkxStore } from "@/lib/markx/store"
import type { GuestChannel, GuestMessage } from "@/lib/markx/store"
import { createEmptyState } from "@/lib/markx/state"
import type { MarkxState } from "@/lib/markx/types"

/** In-memory IndexedDB stand-in plus a BroadcastChannel stand-in. */
function sharedGuestWorld() {
  let saved: MarkxState = createEmptyState()
  const listeners = new Set<(message: GuestMessage) => void>()
  const storage = {
    load: vi.fn(async () => structuredClone(saved)),
    save: vi.fn(async (state: MarkxState) => {
      saved = structuredClone(state)
    }),
  }
  const makeChannel = (): GuestChannel => {
    let own: ((message: GuestMessage) => void) | null = null
    return {
      post: (message) => {
        for (const listener of listeners) {
          if (listener !== own) queueMicrotask(() => listener(message))
        }
      },
      subscribe: (listener) => {
        own = listener
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    }
  }
  const makeStore = () =>
    createMarkxStore({
      storage,
      enrich: vi.fn(async () => ({ title: "", faviconUrl: "" })),
      sweepOrphanImages: vi.fn(async () => {}),
      channel: makeChannel(),
    })
  return { makeStore, saved: () => saved }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("guest mode across tabs", () => {
  it("MX-29 a second tab adopts the first tab's save, so neither overwrites the other", async () => {
    vi.useFakeTimers()
    const world = sharedGuestWorld()
    const tabA = world.makeStore()
    const tabB = world.makeStore()
    await tabA.hydrate()
    await tabB.hydrate()

    tabA.actions.createFolder(0, 0, "From tab A")
    await vi.advanceTimersByTimeAsync(500)
    expect(tabB.getState().folders.map((f) => f.name)).toEqual(["From tab A"])

    tabB.actions.createFolder(300, 0, "From tab B")
    await vi.advanceTimersByTimeAsync(500)

    expect(
      world
        .saved()
        .folders.map((f) => f.name)
        .sort()
    ).toEqual(["From tab A", "From tab B"])
    expect(tabA.getState().folders).toHaveLength(2)
  })

  it("MX-29 a tab with unsaved edits does not adopt and lose them", async () => {
    vi.useFakeTimers()
    const world = sharedGuestWorld()
    const tabA = world.makeStore()
    const tabB = world.makeStore()
    await tabA.hydrate()
    await tabB.hydrate()

    tabB.actions.createFolder(300, 0, "B pending")
    tabA.actions.createFolder(0, 0, "A saved")
    tabA.flush()
    await vi.advanceTimersByTimeAsync(0)
    expect(tabB.getState().folders.map((f) => f.name)).toContain("B pending")
  })
})
