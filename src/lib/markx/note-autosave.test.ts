import { describe, expect, it, vi } from "vitest"

import { createMarkxStore } from "@/lib/markx/store"
import { createEmptyState } from "@/lib/markx/state"
import type { MarkxState } from "@/lib/markx/types"

function makeStore() {
  const save = vi.fn(async (_state: MarkxState) => {})
  const store = createMarkxStore({
    storage: { load: vi.fn(async () => createEmptyState()), save },
    enrich: vi.fn(async () => ({ title: "", faviconUrl: "" })),
    sweepOrphanImages: vi.fn(async () => {}),
  })
  return { store, save }
}

describe("note autosave", () => {
  it("MX-12 drafts from one editing session form a single undo step", () => {
    const { store } = makeStore()
    const note = store.actions.createNote(0, 0, null)
    store.actions.updateNoteContent(note.id, "<p>H</p>", { session: "s1" })
    store.actions.updateNoteContent(note.id, "<p>He</p>", { session: "s1" })
    store.actions.updateNoteContent(note.id, "<p>Hello</p>", { session: "s1" })

    store.actions.undo()

    expect(store.getState().notes[0]?.content).toBe("")
  })

  it("MX-12 a new editing session starts a new undo step", () => {
    const { store } = makeStore()
    const note = store.actions.createNote(0, 0, null)
    store.actions.updateNoteContent(note.id, "<p>One</p>", { session: "s1" })
    store.actions.updateNoteContent(note.id, "<p>Two</p>", { session: "s2" })
    store.actions.undo()
    expect(store.getState().notes[0]?.content).toBe("<p>One</p>")
  })

  it("MX-12 an unchanged commit adds no undo step", () => {
    const { store } = makeStore()
    const note = store.actions.createNote(0, 0, null)
    store.actions.updateNoteContent(note.id, "<p>One</p>", { session: "s1" })
    store.actions.updateNoteContent(note.id, "<p>One</p>", { session: "s2" })
    store.actions.undo()
    expect(store.getState().notes[0]?.content).toBe("")
  })

  it("MX-12 flush writes a pending guest save immediately", () => {
    vi.useFakeTimers()
    try {
      const { store, save } = makeStore()
      store.actions.createFolder(0, 0, "F")
      expect(save).not.toHaveBeenCalled()
      store.flush()
      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0]?.[0].folders).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("note autosave on unload", () => {
  it("MX-12 an unloading flush also writes the synchronous guest backup", () => {
    vi.useFakeTimers()
    try {
      const saveBackup = vi.fn()
      const store = createMarkxStore({
        storage: {
          load: vi.fn(async () => createEmptyState()),
          save: vi.fn(async () => {}),
          saveBackup,
        },
        enrich: vi.fn(async () => ({ title: "", faviconUrl: "" })),
        sweepOrphanImages: vi.fn(async () => {}),
      })
      store.actions.createFolder(0, 0, "F")
      store.flush({ unloading: true })
      expect(saveBackup).toHaveBeenCalledTimes(1)
      store.flush({ unloading: true })
      expect(saveBackup).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
