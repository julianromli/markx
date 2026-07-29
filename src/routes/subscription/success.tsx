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
    let timer: ReturnType<typeof setTimeout> | undefined

    async function tick() {
      try {
        // DB-only read — Pro is granted by paid webhook, not member "active".
        // refreshEntitlements may only downgrade / refresh period metadata.
        if (attempts === 0 || attempts === 5) {
          try {
            await refreshEntitlements()
          } catch {
            // ignore — polling getEntitlements is the source of truth for Pro
          }
        }
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
          setError("Gagal memuat status langganan. Coba refresh halaman ini.")
        }
      }

      attempts += 1
      if (attempts >= MAX_ATTEMPTS) {
        if (!cancelled) setWaiting(false)
        return
      }
      timer = setTimeout(() => {
        void tick()
      }, POLL_MS)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
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
            ? "Markx Pro aktif"
            : waiting
              ? "Memverifikasi pembayaran…"
              : "Pembayaran diterima"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {error ??
            (isPro
              ? "Kamu bisa menambah lebih dari 100 item di workspace. Perubahan bisa butuh beberapa detik."
              : waiting
                ? "Menunggu konfirmasi dari Mayar. Jangan tutup halaman ini."
                : "Kalau status belum Pro, pembayaran mungkin masih diproses. Buka halaman ini lagi dalam satu menit, atau cek email Mayar.")}
        </p>
      </div>
      <Button render={<Link to="/" />}>Kembali ke workspace</Button>
    </div>
  )
}
