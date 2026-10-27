import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { SharedBoardView } from "./shared-board-view"
import { createEmptyState } from "@/lib/markx/seed"
import type { SharedBoardSnapshot } from "@/lib/markx/shared-board"

const session = vi.hoisted(() => ({
  current: { user: null as { id: string } | null, isPending: false },
}))

vi.mock("@/lib/markx/hooks", () => ({
  useAuthSession: () => session.current,
}))
// The canvas needs layout APIs jsdom lacks; the header chrome is what we test.
vi.mock("@/components/markx/board", () => ({ Board: () => null }))
vi.mock("@/components/markx/auth-dialog", () => ({
  AuthDialog: ({ open, title }: { open: boolean; title?: string }) =>
    open ? <div role="dialog">{title}</div> : null,
}))

function makeSnapshot(): SharedBoardSnapshot {
  return {
    boardId: "board-1",
    title: "UI Resources",
    state: createEmptyState(),
    version: 1,
    updatedAt: "2026-10-27T00:00:00.000Z",
    access: "view",
    role: null,
  }
}

const cta = () =>
  screen.queryByRole("button", { name: "Make yours: make your own board on markx" })
const duplicate = () =>
  screen.queryByRole("button", { name: /duplicate to my workspace/i })

describe("SharedBoardView share CTA", () => {
  beforeEach(() => {
    session.current = { user: null, isPending: false }
  })

  it("shows the CTA to anonymous viewers and opens the sign-up dialog", () => {
    render(
      <SharedBoardView
        snapshot={makeSnapshot()}
        token="t"
        mode="view"
        showCreateCta
      />
    )
    expect(cta()).not.toBeNull()
    expect(duplicate()).toBeNull()
    fireEvent.click(cta()!)
    expect(screen.getByRole("dialog").textContent).toBe(
      "Create your free board"
    )
  })

  it("shows Duplicate instead of the CTA to signed-in viewers", () => {
    session.current = { user: { id: "u1" }, isPending: false }
    render(
      <SharedBoardView
        snapshot={makeSnapshot()}
        token="t"
        mode="view"
        showCreateCta
      />
    )
    expect(cta()).toBeNull()
    expect(duplicate()).not.toBeNull()
  })

  it("hides the CTA while the session is resolving", () => {
    session.current = { user: null, isPending: true }
    render(
      <SharedBoardView
        snapshot={makeSnapshot()}
        token="t"
        mode="view"
        showCreateCta
      />
    )
    expect(cta()).toBeNull()
  })

  it("keeps only 'Log in to edit' on an edit link", () => {
    render(
      <SharedBoardView
        snapshot={makeSnapshot()}
        token="t"
        mode="view"
        showCreateCta
        onRequestEdit={() => {}}
      />
    )
    expect(cta()).toBeNull()
    expect(
      screen.getByRole("button", { name: /log in to edit/i })
    ).not.toBeNull()
  })

  it("does not show the CTA unless the route asks for it", () => {
    render(<SharedBoardView snapshot={makeSnapshot()} token="t" mode="view" />)
    expect(cta()).toBeNull()
  })
})
