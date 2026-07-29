import { createFileRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { CheckCircleIcon, SpinnerIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  refreshEntitlements,
  type UserEntitlements,
} from "@/lib/server/subscription"

export const Route = createFileRoute("/subscription/success")({
  component: SubscriptionSuccessPage,
})

function SubscriptionSuccessPage() {
  const [entitlements, setEntitlements] = useState<UserEntitlements | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const next = await refreshEntitlements()
        if (!cancelled) setEntitlements(next)
      } catch {
        if (!cancelled) {
          setError("Gagal memuat status langganan. Coba refresh halaman ini.")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const isPro = entitlements?.plan === "pro"

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      {entitlements == null && error == null ? (
        <SpinnerIcon className="size-10 animate-spin text-muted-foreground" />
      ) : (
        <CheckCircleIcon
          className="size-12 text-emerald-600"
          weight="duotone"
        />
      )}
      <div className="max-w-md space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isPro ? "Markx Pro aktif" : "Pembayaran diterima"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {error ??
            (entitlements == null
              ? "Memverifikasi langganan…"
              : isPro
                ? "Kamu bisa menambah lebih dari 100 item di workspace. Perubahan bisa butuh beberapa detik."
                : "Pembayaran masih diproses. Jika status belum Pro, tunggu sebentar lalu buka halaman ini lagi.")}
        </p>
      </div>
      <Button render={<Link to="/" />}>Kembali ke workspace</Button>
    </div>
  )
}
