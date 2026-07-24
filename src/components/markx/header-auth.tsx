import { useState } from "react"

import { AuthDialog } from "@/components/markx/auth-dialog"
import { AccountMenu } from "@/components/markx/account-menu"
import { SyncStatusBadge, ConflictResolutionDialog } from "@/components/markx/sync-status"
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
        className="flex items-center gap-1.5 rounded-md bg-[rgba(32,32,32,0.9)] px-3 py-1.5 text-[13px] font-medium text-white transition-transform active:scale-[0.96] hover:bg-[rgba(32,32,32,1)]"
      >
        Sign in to save
      </button>
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onLoggedIn={() => setAuthOpen(false)}
      />
    </>
  )
}
