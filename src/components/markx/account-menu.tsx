import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  SignOutIcon,
  UserCircleIcon,
  SpinnerIcon,
} from "@phosphor-icons/react"

import { cn } from "@/lib/utils"
import { useAuthSession } from "@/lib/markx/hooks"
import { signOut } from "@/lib/markx/auth-actions"

/**
 * Account menu shown in the header when the user is signed in.
 *
 * Per the account-menu scope decision, this contains only:
 * - Session info (email)
 * - Sign out button
 *
 * Profile management and account deletion are a separate task.
 */
export function AccountMenu() {
  const { user, isPending } = useAuthSession()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  if (isPending || !user) return null

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
      toast.success("Signed out. You're now in guest mode.")
      setOpen(false)
    } catch {
      toast.error("Failed to sign out. Please try again.")
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        className="flex items-center rounded-md p-1.5 transition-colors hover:bg-black/[0.04]"
      >
        <UserCircleIcon className="size-5 text-muted-foreground" weight="regular" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-56 rounded-lg border bg-white p-1 shadow-lg">
          <div className="border-b px-3 py-2">
            <div className="text-xs text-muted-foreground">Signed in as</div>
            <div className="truncate text-sm font-medium">{user.email}</div>
          </div>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-black/[0.04] disabled:opacity-50",
            )}
          >
            {signingOut ? (
              <SpinnerIcon className="size-4 animate-spin" weight="regular" />
            ) : (
              <SignOutIcon className="size-4" weight="regular" />
            )}
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  )
}
