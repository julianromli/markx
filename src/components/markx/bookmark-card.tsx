import { BOOKMARK_SIZE, RESIZE_HANDLE_SIZE } from "@/lib/markx/geometry"
import { cn } from "@/lib/utils"
import type { Bookmark } from "@/lib/markx/types"

type BookmarkCardProps = {
  bookmark: Bookmark
  selected?: boolean
  className?: string
}

export function BookmarkCard({
  bookmark,
  selected,
  className,
}: BookmarkCardProps) {
  const hasImage = Boolean(bookmark.imageUrl)
  const brandFallback = !hasImage
  const width = bookmark.width ?? BOOKMARK_SIZE.width
  const height = bookmark.height ?? BOOKMARK_SIZE.height

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-[25px] border-[3px] border-white/50",
        "shadow-[3px_3px_8px_rgba(0,0,0,0.1),11px_10px_15px_rgba(0,0,0,0.09),24px_24px_20px_rgba(0,0,0,0.05)]",
        selected && "border-black",
        brandFallback ? "bg-[#202020]" : "bg-white",
        className,
      )}
      style={{ width, height }}
    >
      {hasImage ? (
        <img
          src={bookmark.imageUrl}
          alt=""
          className="size-full object-cover outline outline-1 outline-black/10"
          draggable={false}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-3 px-8 text-center text-white">
          {bookmark.faviconUrl ? (
            <img
              src={bookmark.faviconUrl}
              alt=""
              className="size-12 rounded-xl outline outline-1 outline-white/15"
              draggable={false}
            />
          ) : (
            <span className="text-3xl font-semibold tracking-tight">
              {bookmark.title.slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="space-y-1">
            <p className="text-[22px] font-semibold tracking-tight text-balance">
              {bookmark.title}
            </p>
            {bookmark.description ? (
              <p className="line-clamp-2 text-[13px] text-pretty text-white/65">
                {bookmark.description}
              </p>
            ) : null}
          </div>
        </div>
      )}

      <div
        className={cn(
          "absolute right-0 bottom-0 flex cursor-se-resize items-end justify-end opacity-0 transition-opacity group-hover:opacity-100",
          selected && "opacity-100",
        )}
        style={{ width: RESIZE_HANDLE_SIZE, height: RESIZE_HANDLE_SIZE }}
        aria-hidden
      >
        <svg
          viewBox="0 0 16 16"
          className="mb-1.5 mr-1.5 size-3.5 text-black/35"
          fill="none"
        >
          <path
            d="M14 4L4 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M14 8L8 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M14 12L12 14"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  )
}
