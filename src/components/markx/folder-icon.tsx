import pixelFolder from "@/assets/markx/pixel-folder.svg"
import { cn } from "@/lib/utils"

type FolderIconProps = {
  name: string
  count: number
  selected?: boolean
  className?: string
}

export function FolderIcon({
  name,
  count,
  selected,
  className,
}: FolderIconProps) {
  return (
    <div
      className={cn(
        "flex w-[200px] flex-col items-center px-3.5 pt-3 pb-3.5 transition-transform duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96]",
        className
      )}
    >
      <div
        className={cn(
          "relative size-[92px] transition-transform duration-150 ease-[var(--ease-out-strong)]",
          selected && "scale-95"
        )}
      >
        <img
          src={pixelFolder}
          alt=""
          className="size-full"
          width={92}
          height={92}
          draggable={false}
        />
      </div>
      <div className="mt-2 w-full px-1 text-center">
        <p className="truncate text-[20px] leading-7 font-semibold tracking-[-0.02em] text-balance text-ink/80">
          {name}
        </p>
        <p className="mt-0.5 text-[16px] leading-[1.05] text-ink-muted tabular-nums">
          {count} {count === 1 ? "page" : "pages"}
        </p>
      </div>
    </div>
  )
}
