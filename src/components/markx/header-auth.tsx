import { useEffect, useState } from "react"

import { AccountMenu } from "@/components/markx/account-menu"
import { AuthDialog } from "@/components/markx/auth-dialog"
import { SyncStatusBadge } from "@/components/markx/sync-status"
import { Button } from "@/components/ui/button"
import { useAuthSession } from "@/lib/markx/hooks"
import { hasUpgradeParam } from "@/lib/markx/upgrade-query"

/**
 * Header auth cluster.
 *
 * In guest mode: shows a "Sign in to save" button that opens the OTP dialog.
 * When signed in: shows the sync status badge + account menu.
 */
export function HeaderAuth() {
  const { user, isPending } = useAuthSession()
  const [authOpen, setAuthOpen] = useState(false)

  // Signed-out visitors landing on /?upgrade=1 are sent to sign-in.
  // The query stays in the URL so AccountMenu can open the upgrade
  // dialog after a successful login.
  useEffect(() => {
    if (isPending || user) return
    if (hasUpgradeParam()) setAuthOpen(true)
  }, [isPending, user])

  if (isPending) {
    return null
  }

  if (user) {
    return (
      <>
        <SyncStatusBadge />
        <AccountMenu />
      </>
    )
  }

  return (
    <>
      <Button
        size="sm"
        className="pointer-coarse:h-11"
        onClick={() => setAuthOpen(true)}
      >
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
