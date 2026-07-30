import { useState } from "react"
import { CloudSlashIcon } from "@phosphor-icons/react/dist/csr/CloudSlash"
import { CloudWarningIcon } from "@phosphor-icons/react/dist/csr/CloudWarning"
import { SpinnerIcon } from "@phosphor-icons/react/dist/csr/Spinner"
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useSyncStatus } from "@/lib/markx/hooks"
import { useMarkxStore } from "@/lib/markx/store"
import type { SyncStatus } from "@/lib/markx/sync"

type SyncStatusVisual = {
  label: string
  icon: React.ReactNode
  className: string
  tooltip: string
}

const SYNC_STATUS_CONFIG: Record<SyncStatus, SyncStatusVisual> = {
  idle: {
    label: "",
    icon: null,
    className: "",
    tooltip: "",
  },
  saved: {
    label: "Saved",
    icon: <CheckCircleIcon className="size-3.5 text-green-600" weight="fill" />,
    className: "text-green-700 bg-green-50",
    tooltip: "All changes saved to the cloud",
  },
  saving: {
    label: "Saving…",
    icon: <SpinnerIcon className="size-3.5 animate-spin" weight="regular" />,
    className: "text-blue-700 bg-blue-50",
    tooltip: "Saving your changes to the cloud",
  },
  offline: {
    label: "Offline (queued)",
    icon: <CloudSlashIcon className="size-3.5" weight="regular" />,
    className: "text-amber-700 bg-amber-50",
    tooltip:
      "You're offline. Changes are saved locally and will sync when you reconnect.",
  },
  conflict: {
    label: "Conflict",
    icon: <CloudWarningIcon className="size-3.5" weight="regular" />,
    className: "text-red-700 bg-red-50",
    tooltip: "The cloud version changed. Select to resolve.",
  },
  error: {
    label: "Sync issue",
    icon: <CloudWarningIcon className="size-3.5" weight="regular" />,
    className: "text-red-700 bg-red-50",
    tooltip:
      "Last sync failed. Free plan limit or network error. Upgrade to Pro if you have more than 100 items.",
  },
}

/**
 * Sync status indicator shown in the header.
 *
 * Displays one of:
 * - `Saved`      — all changes synced (green check)
 * - `Saving…`    — a save is in flight (spinner)
 * - `Offline`    — navigator offline; changes queued (cloud-slash)
 * - `Conflict`   — cloud version moved ahead; user must resolve
 * - (hidden)    — guest mode (no sync engine)
 *
 * Each state has a tooltip with more detail. Clicking the conflict
 * state opens the conflict resolution dialog (handled by the parent).
 */
export function SyncStatusBadge({
  onConflictClick,
}: {
  onConflictClick?: () => void
}) {
  const { status } = useSyncStatus()

  // In guest mode (no engine), show nothing.
  if (status === "idle") return null

  const c = SYNC_STATUS_CONFIG[status]
  const className = cn(
    "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors",
    c.className
  )
  const content = (
    <>
      {c.icon}
      <span className="tabular-nums">{c.label}</span>
    </>
  )

  // Passive states are read-only: a <button> would promise an action that
  // doesn't exist. role="status" also announces state changes politely.
  if (status !== "conflict") {
    return (
      <span role="status" title={c.tooltip} className={className}>
        {content}
      </span>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onConflictClick}
            className={cn(className, "cursor-pointer hover:opacity-80")}
          >
            {content}
          </button>
        }
      />
      <TooltipContent>{c.tooltip}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Conflict resolution dialog. Lets the user choose between:
 * - "Use cloud workspace" (default) — discards local pending changes.
 * - "Replace cloud with this device" — overwrites the cloud with local.
 */
export function ConflictResolutionDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const store = useMarkxStore()
  const { conflict } = useSyncStatus()
  const [resolving, setResolving] = useState(false)

  if (!conflict) return null

  async function handleUseCloud() {
    setResolving(true)
    try {
      await store.resolveConflictUseCloud()
      onOpenChange(false)
    } finally {
      setResolving(false)
    }
  }

  async function handleOverwriteCloud() {
    setResolving(true)
    try {
      await store.resolveConflictOverwriteCloud()
      onOpenChange(false)
    } finally {
      setResolving(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <AlertDialogHeader>
          <AlertDialogTitle>Sync conflict</AlertDialogTitle>
          <AlertDialogDescription>
            The cloud workspace was updated from another device or browser.
            Choose how to resolve the conflict:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleUseCloud()}
            disabled={resolving}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent disabled:opacity-50"
          >
            <CheckCircleIcon
              className="mt-0.5 size-5 text-green-600"
              weight="fill"
            />
            <div>
              <div className="font-medium">Use cloud workspace</div>
              <div className="text-sm text-muted-foreground">
                Keep the cloud version. Your local changes on this device will
                be discarded.
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => void handleOverwriteCloud()}
            disabled={resolving}
            className="flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:bg-accent disabled:opacity-50"
          >
            <CloudWarningIcon
              className="mt-0.5 size-5 text-amber-600"
              weight="regular"
            />
            <div>
              <div className="font-medium">Replace cloud with this device</div>
              <div className="text-sm text-muted-foreground">
                Overwrite the cloud with your local changes. The previous cloud
                version will be lost.
              </div>
            </div>
          </button>
        </div>
        <AlertDialogCancel className="w-full">Decide later</AlertDialogCancel>
      </AlertDialogContent>
    </AlertDialog>
  )
}
