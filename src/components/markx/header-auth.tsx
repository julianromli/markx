import { useState } from "react"

import { AccountMenu } from "@/components/markx/account-menu"
import { AuthDialog } from "@/components/markx/auth-dialog"
import {
  ConflictResolutionDialog,
  SyncStatusBadge,
} from "@/components/markx/sync-status"
import { Button } from "@/components/ui/button"
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
      <Button size="sm" onClick={() => setAuthOpen(true)}>
        <span className="md:hidden">Sign in</span>
        <span className="hidden md:inline">Sign in to save</span>
      </Button>
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onLoggedIn={() => setAuthOpen(false)}
      />
    </>
  )
}
