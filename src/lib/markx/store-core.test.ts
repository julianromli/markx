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

  it("sets an optimistic YouTube thumbnail on createBookmark", async () => {
    const enrich = vi.fn(
      async () =>
        new Promise<never>(() => {
          /* leave pending */
        })
    )
    const created = createMarkxStore({
      storage: {
        load: vi.fn(async () => createEmptyState()),
        save: vi.fn(async () => {}),
      },
      enrich,
      sweepOrphanImages: vi.fn(async () => {}),
    })

    created.actions.createFolder(0, 0, "Root")
    const folderId = created.getState().folders[0]!.id
    const bookmark = created.actions.createBookmark(
      folderId,
      "https://youtu.be/dQw4w9WgXcQ",
      10,
      20
    )

    expect(bookmark.imageUrl).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    )
    expect(bookmark.url).toBe("https://youtu.be/dQw4w9WgXcQ")
    expect(enrich).toHaveBeenCalledWith({
      data: { url: "https://youtu.be/dQw4w9WgXcQ" },
    })
  })

  it("lazy-repairs existing YouTube bookmarks missing an image", async () => {
    let resolveEnrich!: (value: {
      title: string
      imageUrl: string
      faviconUrl: string
    }) => void
    const enrich = vi.fn(
      () =>
        new Promise<{
          title: string
          imageUrl: string
          faviconUrl: string
        }>((resolve) => {
          resolveEnrich = resolve
        })
    )
    const initial = {
      ...createEmptyState(),
      folders: [{ id: "folder-1", name: "Root", x: 0, y: 0, z: 1 }],
      bookmarks: [
        {
          id: "bm-yt",
          folderId: "folder-1",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          title: "youtube.com",
          x: 0,
          y: 0,
          z: 1,
        },
      ],
      zCounter: 1,
    }

    const created = createMarkxStore({
      storage: {
        load: vi.fn(async () => initial),
        save: vi.fn(async () => {}),
      },
      enrich,
      sweepOrphanImages: vi.fn(async () => {}),
    })

    await created.hydrate()

    expect(created.getState().bookmarks[0]?.imageUrl).toBe(
      "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg"
    )

    resolveEnrich({
      title: "Never Gonna Give You Up",
      imageUrl: "/api/og-preview/abc",
      faviconUrl: "https://www.google.com/s2/favicons?domain=youtu.be&sz=64",
    })

    await vi.waitFor(() => {
      expect(created.getState().bookmarks[0]?.title).toBe(
        "Never Gonna Give You Up"
      )
    })
    expect(created.getState().bookmarks[0]?.imageUrl).toBe(
      "/api/og-preview/abc"
    )
    expect(enrich).toHaveBeenCalled()
  })
})