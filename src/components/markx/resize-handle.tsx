import { useIsMobile } from "@/hooks/use-mobile"
import { RESIZE_HANDLE_SIZE } from "@/lib/markx/geometry"
import { cn } from "@/lib/utils"

export function ResizeHandle({
  selected,
  className,
}: {
  selected?: boolean
  className?: string
}) {
  const isMobile = useIsMobile()
  return (
    <div
      className={cn(
        "absolute right-0 bottom-0 flex cursor-se-resize items-end justify-end opacity-0 transition-opacity group-hover:opacity-100",
        selected && "opacity-100",
        className
      )}
      style={{
        width: isMobile ? 32 : RESIZE_HANDLE_SIZE,
        height: isMobile ? 32 : RESIZE_HANDLE_SIZE,
      }}
      aria-hidden
    >
      <svg
        viewBox="0 0 16 16"
        className="mr-1.5 mb-1.5 size-3.5 text-black/35"
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
