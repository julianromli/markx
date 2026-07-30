import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CheckCircleIcon, SpinnerIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  getEntitlements,
  refreshEntitlements,
  type UserEntitlements,
} from "@/lib/server/subscription"

export const Route = createFileRoute("/subscription/success")({
  component: SubscriptionSuccessPage,
})

const POLL_MS = 2000
const MAX_ATTEMPTS = 12

function SubscriptionSuccessPage() {
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(true)

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    // Timer id is always owned by this effect; reassigned only after prior clear.
    let timerId: ReturnType<typeof setTimeout> | null = null

    const clearTimer = () => {
      if (timerId !== null) {
        clearTimeout(timerId)
        timerId = null
      }
    }

    const scheduleNext = () => {
      clearTimer()
      if (cancelled) return
      timerId = setTimeout(() => {
        void runTick()
      }, POLL_MS)
    }

    async function runTick() {
      if (cancelled) return
      try {
        // DB read — Pro is granted by verify-on-read (paid transaction), not
        // member "active". refreshEntitlements force-checks the transaction.
        if (attempts === 0 || attempts === 5) {
          try {
            await refreshEntitlements()
          } catch {
            // ignore — polling getEntitlements is the source of truth for Pro
          }
        }
        if (cancelled) return
        const next = await getEntitlements()
        if (cancelled) return
        setEntitlements(next)
        setError(null)
        if (next.plan === "pro") {
          setWaiting(false)
          return
        }
      } catch {
        if (!cancelled) {
          setError(
            "Unable to load subscription status. Try refreshing this page."
          )
        }
      }

      if (cancelled) return
      attempts += 1
      if (attempts >= MAX_ATTEMPTS) {
        setWaiting(false)
        return
      }
      scheduleNext()
    }

    // Synchronous mount tick so cleanup always has a live timer id to clear.
    timerId = setTimeout(() => {
      void runTick()
    }, 0)

    return () => {
      cancelled = true
      clearTimer()
    }
  }, [])

  const isPro = entitlements?.plan === "pro"
  const loading = entitlements == null && error == null

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      {loading || (waiting && !isPro && error == null) ? (
        <SpinnerIcon className="size-10 animate-spin text-muted-foreground" />
      ) : (
        <CheckCircleIcon
          className="size-12 text-emerald-600"
          weight="duotone"
        />
      )}
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isPro
            ? "Markx Pro is active"
            : waiting
              ? "Verifying your payment…"
              : "Payment received"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {error ??
            (isPro
              ? "You can add more than 100 items to your workspace. Changes may take a few seconds."
              : waiting
                ? "Waiting for confirmation from Mayar. Don't close this page."
                : "If your plan isn't Pro yet, the payment may still be processing. Check this page again in a minute, or look for the Mayar email.")}
        </p>
      </div>
      <Button render={<Link to="/" />}>Back to workspace</Button>
    </div>
  )
}
