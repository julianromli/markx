import { fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { BookmarkCard } from "./bookmark-card"
import type { Bookmark } from "@/lib/markx/types"

// ResizeHandle reads `useIsMobile`, which needs matchMedia; jsdom has none.
beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: "b1",
    folderId: "f1",
    url: "https://example.com/article",
    title: "Example",
    x: 0,
    y: 0,
    z: 1,
    ...overrides,
  }
}

/** The preview `<img>`; null once it has fallen back to the branded card. */
function preview(): HTMLImageElement | null {
  return (
    screen
      .queryAllByRole("presentation", { hidden: true })
      .find((el): el is HTMLImageElement =>
        el.className.includes("object-cover")
      ) ?? null
  )
}

describe("BookmarkCard", () => {
  it("renders the Open Graph preview when one is available", () => {
    render(
      <BookmarkCard
        bookmark={makeBookmark({ imageUrl: "https://cdn.example.com/og.png" })}
      />
    )
    expect(preview()?.src).toBe("https://cdn.example.com/og.png")
  })

  it("falls back to the favicon card when the preview fails to load", () => {
    render(
      <BookmarkCard
        bookmark={makeBookmark({
          imageUrl: "https://cdn.example.com/gone.png",
          faviconUrl: "https://icons.example.com/favicon.ico",
        })}
      />
    )

    const img = preview()
    expect(img).not.toBeNull()
    fireEvent.error(img!)

    // The dead preview is gone and the favicon branch took over.
    expect(preview()).toBeNull()
    const favicon = document.querySelector<HTMLImageElement>("img")
    expect(favicon?.src).toBe("https://icons.example.com/favicon.ico")
  })

  it("falls back to the title initial when the favicon also fails", () => {
    render(
      <BookmarkCard
        bookmark={makeBookmark({
          title: "wikipedia",
          faviconUrl: "https://icons.example.com/dead.ico",
        })}
      />
    )

    const favicon = document.querySelector<HTMLImageElement>("img")
    expect(favicon).not.toBeNull()
    fireEvent.error(favicon!)

    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByText("W")).not.toBeNull()
  })

  it("shows the title initial when there is no image or favicon at all", () => {
    render(<BookmarkCard bookmark={makeBookmark({ title: "example" })} />)
    expect(screen.getByText("E")).not.toBeNull()
  })

  it("retries when enrichment replaces a URL that had failed", () => {
    const { rerender } = render(
      <BookmarkCard
        bookmark={makeBookmark({ imageUrl: "https://cdn.example.com/bad.png" })}
      />
    )
    fireEvent.error(preview()!)
    expect(preview()).toBeNull()

    // A later enrichment supplies a different URL: it must get its own attempt
    // rather than inheriting the previous failure.
    rerender(
      <BookmarkCard
        bookmark={makeBookmark({
          imageUrl: "https://cdn.example.com/good.png",
        })}
      />
    )
    expect(preview()?.src).toBe("https://cdn.example.com/good.png")
  })

  it("does not leak the referrer when hotlinking either image", () => {
    render(
      <BookmarkCard
        bookmark={makeBookmark({ imageUrl: "https://cdn.example.com/og.png" })}
      />
    )
    // jsdom doesn't reflect the property, so assert the attribute.
    expect(preview()?.getAttribute("referrerpolicy")).toBe("no-referrer")
  })
})
