import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/ui/input-otp"
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  EnvelopeSimpleIcon,
  PaperPlaneTiltIcon,
} from "@phosphor-icons/react"

import { sendOtp, verifyOtp, onLoginSuccess } from "@/lib/markx/auth-actions"
import {
  getOtpCooldownRemainingSeconds,
  OTP_SEND_COOLDOWN_SECONDS,
  startOtpCooldown,
} from "@/lib/markx/otp-cooldown"

type Step = "email" | "otp" | "success"

type AuthDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after a successful login (OTP verified + sync engine created). */
  onLoggedIn?: () => void
}

const OTP_LENGTH = 6

/**
 * Custom two-step email-to-OTP authentication dialog.
 *
 * Step 1: the user enters their email and clicks "Send code".
 * Step 2: a 6-digit OTP is entered; the form auto-submits on completion.
 *         Includes a "Change email" link, paste support, inline errors,
 *         and a 60-second send/resend cooldown (persisted in sessionStorage).
 *
 * On success, the dialog calls `onLoginSuccess()` to create the
 * SyncEngine and switch from guest mode to cloud sync, then closes.
 */
export function AuthDialog({
  open,
  onOpenChange,
  onLoggedIn,
}: AuthDialogProps) {
  const [step, setStep] = useState<Step>("email")
  const [email, setEmail] = useState("")
  const [otp, setOtp] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  const otpInputRef = useRef<HTMLDivElement>(null)

  // Reset form fields when the dialog is closed — keep cooldown (sessionStorage).
  useEffect(() => {
    if (!open) {
      const timer = setTimeout(() => {
        setStep("email")
        setEmail("")
        setOtp("")
        setError(null)
      }, 200)
      return () => clearTimeout(timer)
    }
  }, [open])

  // Sync remaining cooldown from sessionStorage for the current email.
  useEffect(() => {
    function syncCooldown() {
      setCooldown(getOtpCooldownRemainingSeconds(email))
    }
    syncCooldown()
    if (!open) return
    const timer = setInterval(syncCooldown, 1000)
    return () => clearInterval(timer)
  }, [email, open])

  // Auto-submit when all 6 digits are entered.
  useEffect(() => {
    if (step === "otp" && otp.length === OTP_LENGTH && !verifying) {
      void handleVerify()
    }
  }, [otp, step, verifying])

  // Focus the OTP input when switching to the OTP step.
  useEffect(() => {
    if (step === "otp") {
      requestAnimationFrame(() => {
        const input = otpInputRef.current?.querySelector("input")
        input?.focus()
      })
    }
  }, [step])

  function markCooldownStarted(targetEmail: string) {
    startOtpCooldown(targetEmail)
    setCooldown(OTP_SEND_COOLDOWN_SECONDS)
  }

  async function handleSendCode() {
    setError(null)
    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Please enter a valid email address")
      return
    }

    const remaining = getOtpCooldownRemainingSeconds(trimmed)
    if (remaining > 0) {
      setCooldown(remaining)
      setError(`Please wait ${remaining}s before requesting another code.`)
      return
    }

    setSending(true)
    const result = await sendOtp(trimmed)
    setSending(false)

    if (result.error) {
      setError(result.error)
      // Server may have rate-limited us — keep the client in sync.
      if (/wait|too many|rate/i.test(result.error)) {
        markCooldownStarted(trimmed)
      }
      return
    }

    setEmail(trimmed)
    markCooldownStarted(trimmed)
    setStep("otp")
  }

  async function handleResend() {
    const remaining = getOtpCooldownRemainingSeconds(email)
    if (remaining > 0) {
      setCooldown(remaining)
      return
    }

    setError(null)
    setSending(true)
    const result = await sendOtp(email)
    setSending(false)

    if (result.error) {
      setError(result.error)
      if (/wait|too many|rate/i.test(result.error)) {
        markCooldownStarted(email)
      }
      return
    }

    markCooldownStarted(email)
    setOtp("")
    toast.success("A new code has been sent to your email")
  }

  async function handleVerify() {
    if (otp.length !== OTP_LENGTH || verifying) return
    setError(null)
    setVerifying(true)

    const result = await verifyOtp(email, otp)

    if (result.error) {
      setVerifying(false)
      setError(result.error)
      setOtp("")
      return
    }

    // Success — create the sync engine and switch to cloud mode.
    try {
      await onLoginSuccess()
      setStep("success")
      onLoggedIn?.()
      // Close the dialog after a brief success flash.
      setTimeout(() => {
        onOpenChange(false)
      }, 800)
    } catch {
      setVerifying(false)
      setError("Login succeeded but cloud sync failed. Please refresh.")
    }
  }

  function handleChangeEmail() {
    setStep("email")
    setOtp("")
    setError(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:max-w-[400px]">
        {step === "email" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <EnvelopeSimpleIcon className="size-5" weight="regular" />
                Sign in to save
              </DialogTitle>
              <DialogDescription>
                Enter your email and we'll send you a one-time code. No password
                needed — use the same email to sign in everywhere.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                void handleSendCode()
              }}
              className="space-y-4"
            >
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                autoComplete="email"
                disabled={sending}
                aria-invalid={!!error}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                loading={sending}
                disabled={!email.trim() || cooldown > 0}
              >
                <PaperPlaneTiltIcon className="size-4" weight="regular" />
                {cooldown > 0 ? `Send code in ${cooldown}s` : "Send code"}
              </Button>
            </form>
          </>
        )}

        {step === "otp" && (
          <>
            <DialogHeader>
              <DialogTitle>Enter your code</DialogTitle>
              <DialogDescription>
                We sent a 6-digit code to{" "}
                <span className="font-medium text-foreground">{email}</span>
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div ref={otpInputRef} className="flex justify-center">
                <InputOTP
                  maxLength={OTP_LENGTH}
                  value={otp}
                  onChange={(v) => setOtp(v)}
                  disabled={verifying}
                  aria-invalid={!!error}
                >
                  <InputOTPGroup>
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup>
                    <InputOTPSlot index={3} />
                    <InputOTPSlot index={4} />
                    <InputOTPSlot index={5} />
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {error && (
                <p className="text-center text-sm text-red-600">{error}</p>
              )}

              <Button
                className="w-full"
                onClick={() => void handleVerify()}
                loading={verifying}
                disabled={otp.length !== OTP_LENGTH}
              >
                Verify
              </Button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <ArrowLeftIcon className="size-3.5" weight="regular" />
                  Change email
                </button>
                <button
                  type="button"
                  onClick={() => void handleResend()}
                  disabled={cooldown > 0 || sending}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  {cooldown > 0
                    ? `Resend in ${cooldown}s`
                    : sending
                      ? "Sending…"
                      : "Resend code"}
                </button>
              </div>
            </div>
          </>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center gap-3 py-8">
            <CheckCircleIcon className="size-12 text-green-600" weight="fill" />
            <DialogTitle className="text-lg">You're signed in</DialogTitle>
            <DialogDescription>
              Your workspace is now syncing to the cloud.
            </DialogDescription>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
