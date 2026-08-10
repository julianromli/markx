import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { AuthDialog } from "@/components/markx/auth-dialog"
import { SharedBoardView } from "@/components/markx/shared-board-view"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle"
import { useAuthSession } from "@/lib/markx/hooks"
import type { SharedBoardSnapshot } from "@/lib/markx/shared-board"
import {
  acceptEditorLink,
  loadSharedBoardByToken,
  recordSharedBoardViewEvent,
} from "@/lib/server/shared-board"

export const Route = createFileRoute("/s/$token")({
  component: SharedBoardRoute,
  head: () => ({
    meta: [{ name: "robots", content: "noindex" }],
  }),
})

function SharedBoardRoute() {
  const { token } = Route.useParams()
  const session = useAuthSession()
  const [snapshot, setSnapshot] = useState<
    SharedBoardSnapshot | null | undefined
  >(undefined)
  const [authOpen, setAuthOpen] = useState(false)

  // Load the shared board by token (public; no login required for view).
  useEffect(() => {
    let cancelled = false
    loadSharedBoardByToken({ data: { token } })
      .then((snap) => {
        if (!cancelled) setSnapshot(snap)
      })
      .catch(() => {
        if (!cancelled) setSnapshot(null)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  // Count one view per browser tab session. The seed changes on a new visit,
  // which gives the owner a fresh anonymous avatar without storing identity.
  useEffect(() => {
    if (!snapshot || typeof window === "undefined") return
    const sessionKey = `markx:shared-board-viewed:${token}`
    try {
      if (window.sessionStorage.getItem(sessionKey)) return
      window.sessionStorage.setItem(sessionKey, "1")
      const viewerSeed =
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`
      void recordSharedBoardViewEvent({ data: { token, viewerSeed } })
    } catch {
      // Private browsing can disable sessionStorage. Do not block board viewing.
    }
  }, [snapshot, token])

  // After login (via the auth dialog), accept the edit link and reload.
  async function acceptAndReload() {
    try {
      const accepted = await acceptEditorLink({ data: { token } })
      if (!accepted) {
        toast.error("This edit link is no longer valid.")
        setSnapshot(null)
        return
      }
      const reloaded = await loadSharedBoardByToken({ data: { token } })
      setSnapshot(reloaded)
    } catch {
      toast.error("Could not join this board.")
    }
  }

  // Resolve whether the caller can edit and whether they need to log in first.
  const role = snapshot?.role ?? null
  const canEdit = snapshot != null && (role === "owner" || role === "editor")
  const needsAccept =
    snapshot != null && snapshot.access === "edit" && role === null

  // When the edit link is held by a logged-in non-member, accept automatically.
  useEffect(() => {
    if (!snapshot || !needsAccept) return
    if (session.user) {
      void acceptAndReload()
    }
  }, [snapshot, needsAccept, session.user])

  if (snapshot === undefined) {
    return <LoadingShell />
  }
  if (snapshot === null) {
    return <NotFoundShell />
  }

  // Edit link, not yet a member: show the board (read-only) behind a blurred
  // login modal. Logging in accepts the edit link and switches to edit mode.
  if (needsAccept && !session.user) {
    return (
      <>
        <SharedBoardView
          snapshot={snapshot}
          token={token}
          mode="view"
          onRequestEdit={() => setAuthOpen(true)}
        />
        <AuthDialog
          open
          onOpenChange={(open) => {
            // Keep the modal open until the user logs in or backs out.
            setAuthOpen(open)
          }}
          title="Log in to edit this board"
          description="Enter your email and we'll send you a one-time code."
          onLoggedIn={() => {
            void acceptAndReload()
          }}
        />
      </>
    )
  }

  return (
    <>
      <SharedBoardView
        snapshot={snapshot}
        token={token}
        mode={canEdit ? "edit" : "view"}
      />
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onLoggedIn={() => {
          void acceptAndReload()
        }}
      />
    </>
  )
}

function LoadingShell() {
  return (
    <div className="markx-dot-bg flex h-svh items-center justify-center">
      <Spinner />
    </div>
  )
}

function NotFoundShell() {
  const navigate = useNavigate()
  return (
    <main className="markx-dot-bg flex min-h-svh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white/80 px-6 py-10 text-center shadow-sm outline outline-1 outline-black/5 backdrop-blur">
        <div className="pointer-events-none mx-auto flex size-12 items-center justify-center rounded-full bg-black/[0.04] select-none">
          <WarningCircleIcon
            className="size-6 text-ink-muted"
            weight="regular"
          />
        </div>
        <h1 className="mt-5 text-lg font-medium text-balance">
          Board not found
        </h1>
        <p className="mt-1.5 text-sm text-pretty text-ink-muted">
          This share link is invalid, revoked, or the board was deleted.
        </p>
        <Button className="mt-6" onClick={() => void navigate({ to: "/" })}>
          Go to markx
        </Button>
      </div>
    </main>
  )
}
