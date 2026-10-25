import { useCoarsePointer } from "@/hooks/use-coarse-pointer"
import { RESIZE_HANDLE_SIZE } from "@/lib/markx/geometry"
import { cn } from "@/lib/utils"

/**
 * Bottom-right resize affordance. On touch it is drawn at the same size as
 * the hit zone in `resizeZoneSize` (44 screen px, at most 45% of the card)
 * and only on the selected card, because only the selected card can resize.
 */
export function ResizeHandle({
  selected,
  className,
}: {
  selected?: boolean
  className?: string
}) {
  const coarse = useCoarsePointer()
  if (coarse && !selected) return null
  const size = coarse
    ? "min(var(--resize-zone, 44px), 45%)"
    : `${RESIZE_HANDLE_SIZE}px`
  return (
    <div
      className={cn(
        "absolute right-0 bottom-0 flex cursor-se-resize items-end justify-end opacity-0 transition-opacity group-hover:opacity-100",
        selected && "opacity-100",
        className
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg
        viewBox="0 0 16 16"
        className={cn(
          "text-black/35",
          coarse ? "mr-[12%] mb-[12%] size-[45%]" : "mr-1.5 mb-1.5 size-3.5"
        )}
        fill="none"
      >
        <path
          d="M14 4L4 14M14 8L8 14M14 12L12 14"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  )
}
