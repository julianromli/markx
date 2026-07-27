import { act, fireEvent, render, screen } from "@testing-library/react"
import { beforeAll, describe, expect, it, vi } from "vitest"

import { BookmarkCard } from "./bookmark-card"
import { TooltipProvider } from "@/components/ui/tooltip"
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

function renderCard(
  bookmark: Bookmark,
  props: { interacting?: boolean } = {}
) {
  return render(
    <TooltipProvider delay={500}>
      <BookmarkCard bookmark={bookmark} {...props} />
    </TooltipProvider>
  )
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
    renderCard(makeBookmark({ imageUrl: "https://cdn.example.com/og.png" }))
    expect(preview()?.src).toBe("https://cdn.example.com/og.png")
  })

  it("falls back to the favicon card when the preview fails to load", () => {
    renderCard(
      makeBookmark({
        imageUrl: "https://cdn.example.com/gone.png",
        faviconUrl: "https://icons.example.com/favicon.ico",
      })
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
    renderCard(
      makeBookmark({
        title: "wikipedia",
        faviconUrl: "https://icons.example.com/dead.ico",
      })
    )

    const favicon = document.querySelector<HTMLImageElement>("img")
    expect(favicon).not.toBeNull()
    fireEvent.error(favicon!)

    expect(document.querySelector("img")).toBeNull()
    expect(screen.getByText("W")).not.toBeNull()
  })

  it("shows the title initial when there is no image or favicon at all", () => {
    renderCard(makeBookmark({ title: "example" }))
    expect(screen.getByText("E")).not.toBeNull()
  })

  it("retries when enrichment replaces a URL that had failed", () => {
    const { rerender } = renderCard(
      makeBookmark({ imageUrl: "https://cdn.example.com/bad.png" })
    )
    fireEvent.error(preview()!)
    expect(preview()).toBeNull()

    // A later enrichment supplies a different URL: it must get its own attempt
    // rather than inheriting the previous failure.
    rerender(
      <TooltipProvider delay={500}>
        <BookmarkCard
          bookmark={makeBookmark({
            imageUrl: "https://cdn.example.com/good.png",
          })}
        />
      </TooltipProvider>
    )
    expect(preview()?.src).toBe("https://cdn.example.com/good.png")
  })

  it("does not leak the referrer when hotlinking either image", () => {
    renderCard(makeBookmark({ imageUrl: "https://cdn.example.com/og.png" }))
    // jsdom doesn't reflect the property, so assert the attribute.
    expect(preview()?.getAttribute("referrerpolicy")).toBe("no-referrer")
  })

  it("shows a loading shimmer while enrichment is pending", () => {
    renderCard(
      makeBookmark({
        enrichStatus: "pending",
        faviconUrl: "https://icons.example.com/favicon.ico",
      })
    )
    expect(screen.getByLabelText("Loading preview")).not.toBeNull()
    expect(document.querySelector("img")).toBeNull()
  })

  it("swaps the shimmer for the OG image once enrichment finishes", () => {
    const { rerender } = renderCard(
      makeBookmark({
        enrichStatus: "pending",
        faviconUrl: "https://icons.example.com/favicon.ico",
      })
    )
    expect(screen.getByLabelText("Loading preview")).not.toBeNull()

    rerender(
      <TooltipProvider delay={500}>
        <BookmarkCard
          bookmark={makeBookmark({
            enrichStatus: "done",
            imageUrl: "https://cdn.example.com/og.png",
            faviconUrl: "https://icons.example.com/favicon.ico",
          })}
        />
      </TooltipProvider>
    )
    expect(screen.queryByLabelText("Loading preview")).toBeNull()
    expect(preview()?.src).toBe("https://cdn.example.com/og.png")
  })

  it("wires the card as a tooltip trigger for the Bookmark URL", () => {
    renderCard(
      makeBookmark({
        url: "https://example.com/very/long/path?q=1",
        imageUrl: "https://cdn.example.com/og.png",
      })
    )

    // Hover open is owned by Base UI (pointer rest delay); jsdom cannot reliably
    // drive that path. Assert the trigger wiring here; URL content is covered by
    // the long-press test below.
    expect(
      document.querySelector(
        '[data-slot="tooltip-trigger"][data-base-ui-tooltip-trigger]'
      )
    ).not.toBeNull()
  })

  it("does not open the URL tooltip while the card is interacting", async () => {
    vi.useFakeTimers()
    try {
      renderCard(
        makeBookmark({
          url: "https://example.com/hidden",
          imageUrl: "https://cdn.example.com/og.png",
        }),
        { interacting: true }
      )

      const trigger = document.querySelector(
        '[data-slot="tooltip-trigger"]'
      ) as HTMLElement
      fireEvent.pointerEnter(trigger, { pointerType: "mouse" })
      fireEvent.mouseMove(trigger)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(
        document.querySelector('[data-slot="tooltip-content"]')
      ).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("opens the URL tooltip on a still touch long-press", async () => {
    vi.useFakeTimers()
    try {
      renderCard(
        makeBookmark({
          url: "https://example.com/touch",
          imageUrl: "https://cdn.example.com/og.png",
        })
      )

      const trigger = document.querySelector(
        '[data-slot="tooltip-trigger"]'
      ) as HTMLElement
      fireEvent.pointerDown(trigger, {
        pointerType: "touch",
        pointerId: 1,
        clientX: 40,
        clientY: 40,
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      expect(
        document.querySelector('[data-slot="tooltip-content"]')?.textContent
      ).toContain("https://example.com/touch")
    } finally {
      vi.useRealTimers()
    }
  })

  it("copies the Bookmark URL from the tooltip button", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    })

    vi.useFakeTimers()
    try {
      renderCard(
        makeBookmark({
          url: "https://example.com/copy-me",
          imageUrl: "https://cdn.example.com/og.png",
        })
      )

      const trigger = document.querySelector(
        '[data-slot="tooltip-trigger"]'
      ) as HTMLElement
      fireEvent.pointerDown(trigger, {
        pointerType: "touch",
        pointerId: 1,
        clientX: 40,
        clientY: 40,
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(500)
      })

      const copyButton = screen.getByRole("button", { name: "Copy URL" })
      await act(async () => {
        fireEvent.click(copyButton)
      })

      expect(writeText).toHaveBeenCalledWith("https://example.com/copy-me")
      expect(screen.getByRole("button", { name: "Copied" })).not.toBeNull()
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
