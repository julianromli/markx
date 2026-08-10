import { useState } from "react"

import { Button } from "@/components/ui/button"
import { useSyncStatus } from "@/lib/markx/hooks"
import { useMarkxStore } from "@/lib/markx/store"

/**
 * Slim top bar when another tab/device saved a newer workspace version.
 * Reload soft-adopts cloud; Dismiss hides until the next version check.
 */
export function StaleWorkspaceBanner() {
  const store = useMarkxStore()
  const { engine, staleBannerVisible } = useSyncStatus()
  const [reloading, setReloading] = useState(false)

  if (!engine || !staleBannerVisible) return null

  async function handleReload() {
    setReloading(true)
    try {
      await store.reloadWorkspaceFromCloud()
    } finally {
      setReloading(false)
    }
  }

  return (
    <div
      role="status"
      className="relative z-30 flex items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-950 md:px-4"
    >
      <p className="min-w-0 flex-1 text-[13px] leading-snug">
        Workspace updated elsewhere. Reload to see the latest, or keep
        editing — your next save will replace the cloud copy.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={reloading}
          onClick={() => engine.dismissStaleBanner()}
        >
          Dismiss
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={reloading}
          onClick={() => void handleReload()}
        >
          {reloading ? "Reloading…" : "Reload"}
        </Button>
      </div>
    </div>
  )
}
