import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { SharedBoardView } from "@/components/markx/shared-board-view"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple"
import type { SharedBoardSnapshot } from "@/lib/markx/shared-board"
import { loadSharedBoardById } from "@/lib/server/shared-board"

export const Route = createFileRoute("/b/$boardId")({
  component: SharedBoardByIdRoute,
  head: () => ({
    meta: [{ name: "robots", content: "noindex" }],
  }),
})

function SharedBoardByIdRoute() {
  const { boardId } = Route.useParams()
  const navigate = useNavigate()
  const [snapshot, setSnapshot] = useState<
    SharedBoardSnapshot | null | undefined
  >(undefined)

  useEffect(() => {
    let cancelled = false
    loadSharedBoardById({ data: { boardId } })
      .then((snap) => {
        if (!cancelled) setSnapshot(snap)
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null)
      })
    return () => {
      cancelled = true
    }
  }, [boardId])

  if (snapshot === undefined) {
    return (
      <div className="markx-dot-bg flex h-svh items-center justify-center">
        <Spinner />
      </div>
    )
  }
  if (snapshot === null) {
    return <NotAvailableShell />
  }

  // Owners/editors always edit via this authenticated route.
  return (
    <SharedBoardView
      snapshot={snapshot}
      token=""
      mode="edit"
      showDuplicate={false}
      onBack={() => void navigate({ to: "/" })}
    />
  )
}

function NotAvailableShell() {
  const navigate = useNavigate()
  return (
    <main className="markx-dot-bg flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white/80 px-6 py-10 text-center shadow-sm outline outline-1 outline-black/5 backdrop-blur">
        <div className="pointer-events-none mx-auto flex size-12 select-none items-center justify-center rounded-full bg-black/[0.04]">
          <LockSimpleIcon className="size-6 text-ink-muted" weight="regular" />
        </div>
        <h1 className="mt-5 text-lg font-medium text-balance">Board not available</h1>
        <p className="mt-1.5 text-sm text-pretty text-ink-muted">
          You do not have access to this board, or it was deleted.
        </p>
        <Button className="mt-6" onClick={() => void navigate({ to: "/" })}>
          Go to my canvas
        </Button>
      </div>
    </main>
  )
}
