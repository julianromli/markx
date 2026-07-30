import type { RefObject } from "react"
import { TrashIcon } from "@phosphor-icons/react"

import { deleteDockLabel } from "@/lib/markx/delete-dock"
import { cn } from "@/lib/utils"

type DeleteDockProps = {
  open: boolean
  armed: boolean
  count: number
  hitRef: RefObject<HTMLDivElement | null>
}

/**
 * Mobile-only bottom delete dock (iOS homescreen–style).
 *
 * Visual pill is compact; `hitRef` wraps a taller bottom strip used for
 * geometric hit-testing during an active board drag (pointer-events stay
 * off so the board keeps capture).
 */
export function DeleteDock({ open, armed, count, hitRef }: DeleteDockProps) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40 md:hidden"
      aria-hidden={!open}
    >
      <div
        ref={hitRef}
        className="flex h-[7.5rem] items-end justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        <div
          data-open={open ? "true" : "false"}
          data-armed={armed ? "true" : "false"}
          className={cn(
            "flex items-center gap-2 rounded-full px-5 py-3 text-[13px] leading-none font-semibold",
            "transition-[opacity,transform,background-color,box-shadow,color] duration-200 ease-[var(--ease-out-strong)]",
            "motion-reduce:transition-opacity motion-reduce:duration-150",
            !open && "translate-y-3 scale-95 opacity-0",
            open && !armed && "translate-y-0 scale-100 opacity-100",
            open &&
              armed &&
              "translate-y-0 scale-110 bg-destructive text-white opacity-100 shadow-[0_10px_32px_color-mix(in_oklch,var(--destructive)_35%,transparent)]",
            open &&
              !armed &&
              "bg-ink/88 text-white shadow-[0_8px_28px_rgba(0,0,0,0.18),0_1px_0_rgba(255,255,255,0.12)_inset] backdrop-blur-xl"
          )}
        >
          <TrashIcon
            className={cn(
              "size-5 shrink-0 transition-[transform,opacity] duration-200 ease-[var(--ease-out-strong)] motion-reduce:transition-none",
              armed ? "scale-110" : "scale-100"
            )}
            weight={armed ? "fill" : "regular"}
          />
          <span className="tabular-nums">{deleteDockLabel(count)}</span>
        </div>
      </div>
    </div>
  )
}
