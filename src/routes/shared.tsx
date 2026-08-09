import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { SharedWithMeBoard } from "@/lib/markx/shared-board"
import { listSharedWithMe } from "@/lib/server/shared-board"

export const Route = createFileRoute("/shared")({
  component: SharedWithMeRoute,
  head: () => ({
    meta: [{ name: "robots", content: "noindex" }],
  }),
})

function SharedWithMeRoute() {
  const navigate = useNavigate()
  const [boards, setBoards] = useState<
    SharedWithMeBoard[] | null | undefined
  >(undefined)

  useEffect(() => {
    let cancelled = false
    listSharedWithMe()
      .then((rows) => {
        if (!cancelled) setBoards(rows)
      })
      .catch(() => {
        if (!cancelled) setBoards(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (boards === undefined) {
    return (
      <div className="flex h-svh items-center justify-center bg-white">
        <Spinner />
      </div>
    )
  }

  return (
    <main className="container mx-auto p-4 pt-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-medium">Shared with me</h1>
        <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/" })}>
          Back to my canvas
        </Button>
      </div>
      {boards === null ? (
        <p className="text-sm text-ink-muted">Could not load shared boards.</p>
      ) : boards.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No one has shared a board with you yet. When someone shares a board
          and you accept an edit link, the board appears here.
        </p>
      ) : (
        <ul className="space-y-2">
          {boards.map((b) => (
            <li
              key={b.boardId}
              className="flex items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{b.title}</p>
                <p className="text-xs text-ink-muted">
                  Shared by {b.ownerEmail}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/b/$boardId",
                    params: { boardId: b.boardId },
                  })
                }
              >
                Open
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
