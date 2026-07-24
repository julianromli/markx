import { useState } from "react"

import { AuthDialog } from "@/components/markx/auth-dialog"
import { AccountMenu } from "@/components/markx/account-menu"
import {
  SyncStatusBadge,
  ConflictResolutionDialog,
} from "@/components/markx/sync-status"
import { useAuthSession } from "@/lib/markx/hooks"

/**
 * Header auth cluster.
 *
 * In guest mode: shows a "Sign in to save" button that opens the OTP dialog.
 * When signed in: shows the sync status badge + account menu.
 */
export function HeaderAuth() {
  const { user, isPending } = useAuthSession()
  const [authOpen, setAuthOpen] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)

  if (isPending) {
    return null
  }

  if (user) {
    return (
      <>
        <SyncStatusBadge onConflictClick={() => setConflictOpen(true)} />
        <AccountMenu />
        <ConflictResolutionDialog
          open={conflictOpen}
          onOpenChange={setConflictOpen}
        />
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAuthOpen(true)}
        className="flex shrink-0 items-center whitespace-nowrap rounded-md bg-[rgba(32,32,32,0.9)] px-2 py-1 text-[11px] font-medium text-white transition-[transform,background-color] duration-150 ease-[var(--ease-out-strong)] hover:bg-[rgba(32,32,32,1)] active:scale-[0.96] md:gap-1.5 md:px-3 md:py-1.5 md:text-[13px]"
      >
        <span className="md:hidden">Sign in</span>
        <span className="hidden md:inline">Sign in to save</span>
      </button>
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onLoggedIn={() => setAuthOpen(false)}
      />
    </>
  )
}
