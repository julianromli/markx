import { useEffect, useState, useSyncExternalStore } from "react"

import { AuthDialog } from "@/components/markx/auth-dialog"
import { Button } from "@/components/ui/button"
import { useAuthSession } from "@/lib/markx/hooks"
import {
  completeReloginNotice,
  isReloginNoticePending,
  subscribeReloginNotice,
} from "@/lib/markx/relogin-notice"

/**
 * One-time bar after the sign-in move: returning users must sign in again.
 * Shows only to guests whose remembered session was rejected.
 */
export function ReloginBanner() {
  const { user, isPending } = useAuthSession()
  const pending = useSyncExternalStore(
    subscribeReloginNotice,
    isReloginNoticePending,
    () => false
  )
  const [authOpen, setAuthOpen] = useState(false)

  useEffect(() => {
    if (user && pending) completeReloginNotice()
  }, [user, pending])

  if (isPending || user || !pending) return null

  return (
    <div
      role="status"
      className="relative z-30 flex items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 md:px-4"
    >
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        We moved sign-in to a new system. Please sign in again with your
        email. Your boards are safe.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={completeReloginNotice}
        >
          Dismiss
        </Button>
        <Button type="button" size="sm" onClick={() => setAuthOpen(true)}>
          Sign in
        </Button>
      </div>
      <AuthDialog
        open={authOpen}
        onOpenChange={setAuthOpen}
        onLoggedIn={() => {
          setAuthOpen(false)
          completeReloginNotice()
        }}
      />
    </div>
  )
}
