import pixelFolder from "@/assets/markx/pixel-folder.svg"
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork"
import { cn } from "@/lib/utils"

type FolderIconProps = {
  name: string
  count: number
  selected?: boolean
  /** Show a small "shared" badge at the folder's top-right corner. */
  shared?: boolean
  className?: string
}

export function FolderIcon({
  name,
  count,
  selected,
  shared,
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
        {shared ? (
          <span
            aria-label="Shared board"
            className="absolute -right-1 -top-1 flex size-6 items-center justify-center rounded-full bg-white shadow-sm outline outline-1 outline-black/10"
          >
            <ShareNetworkIcon className="size-3.5 text-ink" weight="fill" />
          </span>
        ) : null}
      </div>
      <div className="mt-2 w-full px-1 text-center">
        <p className="truncate text-[20px] leading-7 font-semibold tracking-[-0.02em] text-balance text-ink/80">
          {name}
        </p>
        <p className="mt-0.5 text-[16px] leading-[1.05] text-ink-muted tabular-nums">
          {count} {count === 1 ? "bookmark" : "bookmarks"}
        </p>
      </div>
    </div>
  )
}
