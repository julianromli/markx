import { useEffect, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import QRCode from "qrcode"
import {
  CheckCircleIcon,
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
import { cn } from "@/lib/utils"
import {
  getEntitlements,
  refreshEntitlements,
  startProCheckout,
  validateProCoupon,
} from "@/lib/server/subscription"
import type {
  ProCheckoutSession,
  ProCouponValidation,
  UserEntitlements,
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
  const [session, setSession] = useState<ProCheckoutSession | null>(null)
  const [paid, setPaid] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [couponInput, setCouponInput] = useState("")
  const [appliedCoupon, setAppliedCoupon] =
    useState<ProCouponValidation | null>(null)
  const [couponError, setCouponError] = useState<string | null>(null)
  const [couponLoading, setCouponLoading] = useState(false)
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const qrExpiredRef = useRef(false)
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
      const limit = detail.limit ?? 100
      const canUpgrade = entitlements?.billingEnabled === true
      toast.error(
        detail.message ??
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

  async function handleApplyCoupon() {
    setCouponError(null)
    setCouponLoading(true)
    try {
      const result = await validateProCoupon({
        data: { code: couponInput.trim() },
      })
      setAppliedCoupon(result)
    } catch (err) {
      setAppliedCoupon(null)
      setCouponError(
        err instanceof Error ? err.message : "Unable to validate coupon."
      )
    } finally {
      setCouponLoading(false)
    }
  }

  async function handleCheckout() {
    setCheckoutLoading(true)
    try {
      const next = await startProCheckout({
        data: { mobile, couponCode: appliedCoupon?.code },
      })
      setSession(next)
      setPaid(false)
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

  // Draw the QRIS payload onto the canvas whenever a new session arrives.
  useEffect(() => {
    if (!session || !qrCanvasRef.current) return
    void QRCode.toCanvas(qrCanvasRef.current, session.qrString, {
      width: 232,
      margin: 1,
    })
  }, [session])

  // Countdown to invoice expiry; the QR string dies with it.
  useEffect(() => {
    if (!session?.expiredAt) {
      setSecondsLeft(null)
      return
    }
    const expiry = new Date(session.expiredAt).getTime()
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.round((expiry - Date.now()) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [session])

  useEffect(() => {
    qrExpiredRef.current = secondsLeft === 0
  }, [secondsLeft])

  // Poll for payment while a session is active (verify-on-read on the server).
  useEffect(() => {
    if (!session || paid) return
    let cancelled = false
    const poll = async () => {
      if (qrExpiredRef.current) return
      try {
        const next = await refreshEntitlements()
        if (cancelled) return
        setEntitlements(next)
        if (next.plan === "pro") setPaid(true)
      } catch {
        // Transient failure — the next tick retries.
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [session, paid])

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
        onOpenChange={(nextOpen) => {
          setUpgradeOpen(nextOpen)
          if (!nextOpen) {
            // Reset after the close animation so a reopen starts fresh.
            setTimeout(() => {
              setSession(null)
              setPaid(false)
              setSecondsLeft(null)
            }, 200)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Markx Pro</DialogTitle>
            <DialogDescription>
              {paid
                ? "Your payment is confirmed."
                : session
                  ? "Scan with any mobile banking or e-wallet app."
                  : "More than 100 items in your workspace. Monthly subscription Rp 49,000 via Mayar."}
            </DialogDescription>
          </DialogHeader>

          {paid ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircleIcon
                className="size-12 text-green-600"
                weight="fill"
              />
              <p className="font-medium">Markx Pro is active</p>
              <p className="text-sm text-muted-foreground">
                You can add more than 100 items to your workspace.
              </p>
              <Button className="mt-2" onClick={() => setUpgradeOpen(false)}>
                Done
              </Button>
            </div>
          ) : session ? (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl border p-3">
                <canvas ref={qrCanvasRef} aria-label="QRIS payment code" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold tabular-nums">
                  Rp {new Intl.NumberFormat("id-ID").format(session.amount)}
                </p>
                {session.appliedCoupon ? (
                  <p className="text-sm text-muted-foreground">
                    <span className="tabular-nums line-through">
                      Rp{" "}
                      {new Intl.NumberFormat("id-ID").format(
                        session.listPriceIdr
                      )}
                    </span>{" "}
                    — coupon {session.appliedCoupon} applied
                  </p>
                ) : null}
              </div>
              {secondsLeft != null && secondsLeft > 0 ? (
                <p className="text-sm text-muted-foreground tabular-nums">
                  QR expires in {Math.floor(secondsLeft / 60)}:
                  {String(secondsLeft % 60).padStart(2, "0")}
                </p>
              ) : secondsLeft === 0 ? (
                <div className="flex flex-col items-center gap-2">
                  <p className="text-sm text-destructive">
                    QR expired. Generate a new one to continue.
                  </p>
                  <Button
                    variant="outline"
                    disabled={checkoutLoading}
                    onClick={() => void handleCheckout()}
                  >
                    {checkoutLoading ? (
                      <SpinnerIcon className="animate-spin" weight="regular" />
                    ) : (
                      "Generate new QR"
                    )}
                  </Button>
                </div>
              ) : null}
              <p className="text-center text-sm text-muted-foreground">
                Pro activates automatically once your payment is confirmed.
              </p>
            </div>
          ) : (
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

              <div className="space-y-1.5">
                <Label htmlFor="upgrade-coupon">Discount code (optional)</Label>
                {appliedCoupon ? (
                  <div className="flex items-center justify-between rounded-3xl border bg-accent/50 px-3 py-2 text-sm">
                    <span>
                      <span className="font-medium">{appliedCoupon.code}</span>{" "}
                      <span className="text-muted-foreground">
                        — Rp{" "}
                        {new Intl.NumberFormat("id-ID").format(
                          appliedCoupon.finalPriceIdr
                        )}
                        <span className="line-through">
                          {" "}
                          Rp{" "}
                          {new Intl.NumberFormat("id-ID").format(
                            appliedCoupon.listPriceIdr
                          )}
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => {
                        setAppliedCoupon(null)
                        setCouponError(null)
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      id="upgrade-coupon"
                      placeholder="e.g. LAUNCH50"
                      value={couponInput}
                      onChange={(e) => setCouponInput(e.target.value)}
                      aria-invalid={!!couponError}
                      aria-describedby="upgrade-coupon-error"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={couponLoading || !couponInput.trim()}
                      onClick={() => void handleApplyCoupon()}
                    >
                      {couponLoading ? (
                        <SpinnerIcon
                          className="animate-spin"
                          weight="regular"
                        />
                      ) : (
                        "Apply"
                      )}
                    </Button>
                  </div>
                )}
                <p
                  id="upgrade-coupon-error"
                  aria-live="polite"
                  className={cn(
                    "text-sm text-destructive",
                    !couponError && "sr-only"
                  )}
                >
                  {couponError}
                </p>
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
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
