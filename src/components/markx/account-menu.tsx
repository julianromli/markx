import { useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import { SignOutIcon, UserCircleIcon, SpinnerIcon } from "@phosphor-icons/react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  const navigate = useNavigate()
  const { user, isPending } = useAuthSession()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const signingOutRef = useRef(false)

  if (isPending || !user) return null

  async function handleSignOut() {
    signingOutRef.current = true
    setSigningOut(true)
    try {
      await signOut()
      // Guest mode resets to the demo seed, so folder URLs from the signed-in
      // workspace would 404 — land on home instead.
      await navigate({ to: "/app" })
      toast.success("Signed out. You're now in guest mode.")
      setOpen(false)
    } catch {
      toast.error("Failed to sign out. Please try again.")
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (signingOutRef.current) return
        setOpen(next)
      }}
    >
      <DropdownMenuTrigger
        aria-label="Account"
        className="flex items-center rounded-md p-1.5 text-muted-foreground transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] outline-none hover:bg-black/[0.04] active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-black/10"
      >
        <UserCircleIcon className="size-5" weight="regular" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        <div className="px-3 py-2.5">
          <div className="text-xs text-muted-foreground">Signed in as</div>
          <div className="truncate text-sm font-medium">{user.email}</div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signingOut}
          onClick={() => void handleSignOut()}
        >
          {signingOut ? (
            <SpinnerIcon className="animate-spin" weight="regular" />
          ) : (
            <SignOutIcon weight="regular" />
          )}
          {signingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
