import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { SharedBoardSyncEngine } from "@/lib/markx/shared-board-sync"
import type { SharedBoardSaveResult } from "@/lib/markx/shared-board"
import { SYNC_STATE_DEBOUNCE_MS } from "@/lib/markx/sync-timings"
import { createEmptyState } from "@/lib/markx/seed"
import type { MarkxState } from "@/lib/markx/types"

const DEBOUNCE = SYNC_STATE_DEBOUNCE_MS

function makeSave(
  impl: (input: {
    boardId: string
    state: MarkxState
    baseVersion: number
    deletedImageIds: string[]
  }) => Promise<SharedBoardSaveResult>
) {
  return vi.fn(impl)
}

function stateWithNote(id: string): MarkxState {
  return {
    ...createEmptyState(),
    notes: [
      {
        id,
        folderId: "f1",
        content: id,
        color: "yellow",
        font: "sans",
        fontSize: "m",
        x: 0,
        y: 0,
        z: 1,
      },
    ],
  }
}

describe("SharedBoardSyncEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("debounces and pushes an optimistic save, advancing the cloud version", async () => {
    const save = makeSave(async (input) => ({
      ok: true,
      version: input.baseVersion + 1,
      updatedAt: new Date().toISOString(),
      state: input.state,
    }))
    const engine = new SharedBoardSyncEngine(
      "board-1",
      createEmptyState(),
      3,
      { save }
    )
    const next = stateWithNote("n1")
    engine.onStateChange(next)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(DEBOUNCE)
    await vi.waitFor(() => expect(engine.getStatus()).toBe("saved"))
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].baseVersion).toBe(3)
    expect(engine.getLoadedState()).toEqual(next)
  })

  it("adopts server-merged state without showing a conflict", async () => {
    const local = stateWithNote("local-note")
    const merged: MarkxState = {
      ...createEmptyState(),
      notes: [
        ...stateWithNote("cloud-note").notes,
        ...local.notes,
      ],
    }
    const save = makeSave(async () => ({
      ok: true,
      version: 5,
      updatedAt: new Date().toISOString(),
      state: merged,
    }))
    const engine = new SharedBoardSyncEngine("board-1", createEmptyState(), 1, {
      save,
    })
    let authoritative: MarkxState | undefined
    engine.subscribe((_status, _conflict, state) => {
      if (state) authoritative = state
    })

    engine.onStateChange(local)
    vi.advanceTimersByTime(DEBOUNCE)
    await vi.waitFor(() => expect(engine.getStatus()).toBe("saved"))

    expect(engine.getConflict()).toBeUndefined()
    expect(authoritative?.notes.map((note) => note.id)).toEqual([
      "cloud-note",
      "local-note",
    ])
  })

  it("keeps mid-save local edits when adopting server state", async () => {
    const sent = stateWithNote("sent-note")
    const during = stateWithNote("during-note")
    let resolveSave!: (value: SharedBoardSaveResult) => void
    const saveGate = new Promise<SharedBoardSaveResult>((resolve) => {
      resolveSave = resolve
    })
    const save = makeSave(async () => saveGate)
    const engine = new SharedBoardSyncEngine("board-1", createEmptyState(), 1, {
      save,
    })

    engine.onStateChange(sent)
    vi.advanceTimersByTime(DEBOUNCE)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    engine.onStateChange(during)
    resolveSave({
      ok: true,
      version: 5,
      updatedAt: new Date().toISOString(),
      state: sent,
    })
    await vi.advanceTimersByTimeAsync(0)

    expect(engine.getLoadedState().notes.map((note) => note.id)).toEqual([
      "sent-note",
      "during-note",
    ])
  })

  it("surfaces a conflict and resolves to cloud-wins", async () => {
    const cloudState = createEmptyState()
    const save = makeSave(async () => ({
      ok: false,
      reason: "conflict",
      cloudVersion: 9,
      cloudState,
      cloudUpdatedAt: new Date().toISOString(),
    }))
    const engine = new SharedBoardSyncEngine(
      "board-1",
      createEmptyState(),
      1,
      { save }
    )
    engine.onStateChange(createEmptyState())
    vi.advanceTimersByTime(DEBOUNCE)
    await vi.waitFor(() => expect(engine.getStatus()).toBe("conflict"))
    expect(engine.getConflict()?.cloudVersion).toBe(9)

    const adopted = await engine.resolveConflictUseCloud()
    expect(adopted).toBe(cloudState)
    expect(engine.getStatus()).toBe("saved")
    expect(engine.getConflict()).toBeUndefined()
  })

  it("emits an entity-limit event and stops saving", async () => {
    const handler = vi.fn()
    window.addEventListener("markx:entity-limit", handler)
    const save = makeSave(async () => ({
      ok: false,
      reason: "entity_limit",
      entityCount: 101,
      limit: 100,
      message: "limit",
    }))
    const engine = new SharedBoardSyncEngine(
      "board-1",
      createEmptyState(),
      1,
      { save }
    )
    engine.onStateChange(createEmptyState())
    vi.advanceTimersByTime(DEBOUNCE)
    await vi.waitFor(() => expect(engine.getStatus()).toBe("error"))
    expect(handler).toHaveBeenCalledTimes(1)
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      limit: 100,
      entityCount: 101,
    })
    window.removeEventListener("markx:entity-limit", handler)
  })

  it("does not save while offline", async () => {
    const save = makeSave(async (input) => ({
      ok: true,
      version: 2,
      updatedAt: new Date().toISOString(),
      state: input.state,
    }))
    const engine = new SharedBoardSyncEngine(
      "board-1",
      createEmptyState(),
      1,
      { save }
    )
    window.dispatchEvent(new Event("offline"))
    expect(engine.getStatus()).toBe("offline")
    engine.onStateChange(createEmptyState())
    vi.advanceTimersByTime(DEBOUNCE)
    expect(save).not.toHaveBeenCalled()
  })
})
