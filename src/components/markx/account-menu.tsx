import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  CrownIcon,
  SignOutIcon,
  SpinnerIcon,
  UserCircleIcon,
} from "@phosphor-icons/react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAuthSession } from "@/lib/markx/hooks"
import { signOut } from "@/lib/markx/auth-actions"
import {
  getEntitlements,
  startProCheckout,
  type UserEntitlements,
} from "@/lib/server/subscription"

/**
 * Account menu shown in the header when the user is signed in.
 */
export function AccountMenu() {
  const navigate = useNavigate()
  const { user, isPending } = useAuthSession()
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(
    null
  )
  const [mobile, setMobile] = useState("")
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const signingOutRef = useRef(false)

  useEffect(() => {
    if (!user) {
      setEntitlements(null)
      return
    }
    let cancelled = false
    void getEntitlements()
      .then((e) => {
        if (!cancelled) setEntitlements(e)
      })
      .catch(() => {
        if (!cancelled) setEntitlements(null)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    function onEntityLimit(event: Event) {
      const detail = (
        event as CustomEvent<{
          message?: string
          limit?: number
        }>
      ).detail
      const limit = detail?.limit ?? 100
      const canUpgrade = entitlements?.billingEnabled === true
      toast.error(
        detail?.message ??
          (canUpgrade
            ? `Free plan is limited to ${limit} items. Upgrade to Pro to continue.`
            : `Workspace limit reached (${limit} items).`),
        canUpgrade
          ? {
              action: {
                label: "Upgrade",
                onClick: () => setUpgradeOpen(true),
              },
            }
          : undefined
      )
      if (canUpgrade) {
        setUpgradeOpen(true)
        setOpen(false)
      }
    }
    window.addEventListener("markx:entity-limit", onEntityLimit)
    return () => {
      window.removeEventListener("markx:entity-limit", onEntityLimit)
    }
  }, [entitlements?.billingEnabled])

  if (isPending || !user) return null

  const billingEnabled = entitlements?.billingEnabled === true
  const isPro = entitlements?.plan === "pro"
  const showUpgrade = billingEnabled && !isPro

  async function handleSignOut() {
    signingOutRef.current = true
    setSigningOut(true)
    try {
      await signOut()
      await navigate({ to: "/" })
      toast.success("Signed out. You're now in guest mode.")
      setOpen(false)
    } catch {
      toast.error("Failed to sign out. Please try again.")
    } finally {
      signingOutRef.current = false
      setSigningOut(false)
    }
  }

  async function handleCheckout() {
    setCheckoutLoading(true)
    try {
      const { checkoutUrl } = await startProCheckout({ data: { mobile } })
      window.location.href = checkoutUrl
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Checkout failed. Please try again."
      toast.error(message)
    } finally {
      setCheckoutLoading(false)
    }
  }

  return (
    <>
      <DropdownMenu
        open={open}
        onOpenChange={(next) => {
          if (signingOutRef.current) return
          setOpen(next)
        }}
      >
        <DropdownMenuTrigger
          aria-label="Account"
          className="flex items-center rounded-md p-1.5 text-muted-foreground transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] outline-none hover:bg-black/[0.04] focus-visible:ring-2 focus-visible:ring-black/10 active:scale-[0.96]"
        >
          <UserCircleIcon className="size-5" weight="regular" />
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="min-w-56">
          <div className="px-3 py-2.5">
            <div className="text-xs text-muted-foreground">Signed in as</div>
            <div className="truncate text-sm font-medium">{user.email}</div>
            {entitlements != null && billingEnabled && (
              <div className="mt-1 text-xs text-muted-foreground">
                {isPro
                  ? "Markx Pro"
                  : `Free · max ${entitlements.entityLimit ?? 100} items`}
              </div>
            )}
          </div>
          <DropdownMenuSeparator />
          {showUpgrade && (
            <DropdownMenuItem
              onClick={() => {
                setUpgradeOpen(true)
                setOpen(false)
              }}
            >
              <CrownIcon weight="regular" />
              Upgrade to Pro — Rp 49,000/month
            </DropdownMenuItem>
          )}
          {showUpgrade && <DropdownMenuSeparator />}
          <DropdownMenuItem
            disabled={signingOut}
            onClick={() => void handleSignOut()}
          >
            {signingOut ? (
              <SpinnerIcon className="animate-spin" weight="regular" />
            ) : (
              <SignOutIcon weight="regular" />
            )}
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={billingEnabled && upgradeOpen}
        onOpenChange={setUpgradeOpen}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Markx Pro</DialogTitle>
            <DialogDescription>
              More than 100 items in your workspace. Monthly subscription Rp
              49,000 via Mayar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="upgrade-mobile">Mobile number (WhatsApp)</Label>
              <Input
                id="upgrade-mobile"
                inputMode="tel"
                placeholder="081234567890"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                autoComplete="tel"
              />
            </div>
            <Button
              className="w-full"
              disabled={checkoutLoading || mobile.trim().length < 10}
              onClick={() => void handleCheckout()}
            >
              {checkoutLoading ? (
                <SpinnerIcon className="animate-spin" weight="regular" />
              ) : (
                "Continue to payment"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
