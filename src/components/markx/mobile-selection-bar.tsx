import { ArrowBendUpRightIcon } from "@phosphor-icons/react/dist/csr/ArrowBendUpRight"
import { CheckSquareIcon } from "@phosphor-icons/react/dist/csr/CheckSquare"
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple"
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash"
import { useLayoutEffect, useRef } from "react"
import type { ReactNode } from "react"

import {
  BOTTOM_CHROME_VAR,
  floatingSurface,
} from "@/components/markx/floating-surface"

import { cn } from "@/lib/utils"

/**
 * Phone-only actions for the current selection: a visible, non-gesture path
 * to rename, move, and delete, plus a select mode for picking several items.
 */
export function MobileSelectionBar({
  count,
  selectMode,
  canRename,
  canMove,
  onToggleSelectMode,
  onRename,
  onMove,
  onDelete,
  onDone,
}: {
  count: number
  selectMode: boolean
  canRename: boolean
  canMove: boolean
  onToggleSelectMode: () => void
  onRename: () => void
  onMove: () => void
  onDelete: () => void
  onDone: () => void
}) {
  const barRef = useRef<HTMLDivElement>(null)

  // Reserve the bar's space at the bottom so toasts stack above it.
  useLayoutEffect(() => {
    const bar = barRef.current
    if (!bar) return
    const root = document.documentElement
    const update = () => {
      const top = bar.getBoundingClientRect().top
      root.style.setProperty(
        BOTTOM_CHROME_VAR,
        `${Math.max(0, window.innerHeight - top + 8)}px`
      )
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(bar)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", update)
      root.style.removeProperty(BOTTOM_CHROME_VAR)
    }
  }, [])

  return (
    <div
      role="toolbar"
      aria-label="Selection"
      ref={barRef}
      className={cn(
        "absolute inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-30 flex items-center gap-1 p-1 md:hidden",
        floatingSurface
      )}
    >
      <span
        className="min-w-0 flex-1 truncate px-2 text-[13px] font-medium text-ink/80 tabular-nums"
        aria-live="polite"
      >
        {count} selected
      </span>
      <BarButton
        label="Select more"
        pressed={selectMode}
        onClick={onToggleSelectMode}
        icon={
          <CheckSquareIcon
            className="size-5"
            weight={selectMode ? "fill" : "regular"}
          />
        }
      />
      {canRename ? (
        <BarButton
          label="Rename"
          onClick={onRename}
          icon={<PencilSimpleIcon className="size-5" />}
        />
      ) : null}
      <BarButton
        label="Move"
        disabled={!canMove || count === 0}
        onClick={onMove}
        icon={<ArrowBendUpRightIcon className="size-5" />}
      />
      <BarButton
        label="Delete"
        destructive
        disabled={count === 0}
        onClick={onDelete}
        icon={<TrashIcon className="size-5" />}
      />
      <button
        type="button"
        onClick={onDone}
        className="flex h-11 min-w-11 items-center justify-center rounded-xl px-3 text-[13px] font-semibold text-ink active:scale-[0.96]"
      >
        Done
      </button>
    </div>
  )
}

function BarButton({
  label,
  icon,
  pressed,
  disabled,
  destructive,
  onClick,
}: {
  label: string
  icon: ReactNode
  pressed?: boolean
  disabled?: boolean
  destructive?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-11 items-center justify-center rounded-xl text-ink/80 transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96] disabled:opacity-30",
        pressed && "bg-black/[0.06] text-ink",
        destructive && "text-destructive"
      )}
    >
      {icon}
    </button>
  )
}
