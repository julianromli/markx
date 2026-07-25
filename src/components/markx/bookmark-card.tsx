import { ResizeHandle } from "@/components/markx/resize-handle"
import { BOOKMARK_SIZE } from "@/lib/markx/geometry"
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
        className
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

      <ResizeHandle selected={selected} />
    </div>
  )
}
