import { useEffect, useState } from "react"

import { ResizeHandle } from "@/components/markx/resize-handle"
import { fitImageToWidth } from "@/lib/markx/geometry"
import { getImageObjectUrl, resolveImageBlob } from "@/lib/markx/images"
import { cn } from "@/lib/utils"
import type { BoardImage } from "@/lib/markx/types"

type ImageCardProps = {
  image: BoardImage
  selected?: boolean
  className?: string
}

export function ImageCard({ image, selected, className }: ImageCardProps) {
  const [url, setUrl] = useState<string | null>(null)
  const fitSize = fitImageToWidth(image.naturalWidth, image.naturalHeight)
  const width = image.width ?? fitSize.width
  const height = image.height ?? fitSize.height

  useEffect(() => {
    let cancelled = false
    void resolveImageBlob(image.imageId).then((blob) => {
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
          selected &&
            "ring-2 ring-black/80 ring-offset-2 ring-offset-transparent"
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

      <ResizeHandle selected={selected} />
    </div>
  )
}
