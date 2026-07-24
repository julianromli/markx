import { useEffect, useState } from "react"

import { RESIZE_HANDLE_SIZE, fitImageToWidth } from "@/lib/markx/geometry"
import { getImageObjectUrl } from "@/lib/markx/images"
import { getImageBlob } from "@/lib/markx/storage"
import { cn } from "@/lib/utils"
import type { BoardImage } from "@/lib/markx/types"

type ImageCardProps = {
  image: BoardImage
  selected?: boolean
  className?: string
}

export function ImageCard({ image, selected, className }: ImageCardProps) {
  const [url, setUrl] = useState<string | null>(null)

  const fitSize = fitImageToWidth(
    image.naturalWidth,
    image.naturalHeight,
  )
  const width = image.width ?? fitSize.width
  const height = image.height ?? fitSize.height

  useEffect(() => {
    let cancelled = false
    void getImageBlob(image.imageId).then((blob) => {
      if (cancelled || !blob) return
      setUrl(getImageObjectUrl(image.imageId, blob))
    })
    return () => {
      cancelled = true
    }
  }, [image.imageId])

  return (
    <div className={cn("relative", className)} style={{ width, height }}>
      <div
        className={cn(
          "group relative h-full w-full overflow-hidden rounded-[12px] shadow-[3px_3px_8px_rgba(0,0,0,0.08),11px_10px_15px_rgba(0,0,0,0.06)]",
          selected && "ring-2 ring-black/80 ring-offset-2 ring-offset-transparent",
        )}
      >
        {url ? (
          <img
            src={url}
            alt=""
            className="size-full object-contain"
            draggable={false}
            loading="lazy"
          />
        ) : (
          <div className="flex size-full items-center justify-center bg-black/5">
            <div className="size-6 animate-pulse rounded-full border-2 border-black/15 border-t-black/40" />
          </div>
        )}
      </div>

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
