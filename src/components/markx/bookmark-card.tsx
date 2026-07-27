import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react"
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check"
import { CopySimpleIcon } from "@phosphor-icons/react/dist/csr/CopySimple"

import { ResizeHandle } from "@/components/markx/resize-handle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { BOOKMARK_SIZE, DRAG_THRESHOLD } from "@/lib/markx/geometry"
import { cn } from "@/lib/utils"
import type { Bookmark } from "@/lib/markx/types"

const URL_TOOLTIP_DELAY_MS = 500
const COPIED_RESET_MS = 1500

type BookmarkCardProps = {
  bookmark: Bookmark
  selected?: boolean
  /** True while this card is being dragged or resized on the board. */
  interacting?: boolean
  className?: string
}

export const BookmarkCard = memo(function BookmarkCard({
  bookmark,
  selected,
  interacting = false,
  className,
}: BookmarkCardProps) {
  // Preview and favicon are hotlinked from the origin, which may delete the file
  // or start blocking hotlinks long after the URL was cached. Remember which URL
  // failed rather than a bare flag, so a later enrichment gets a fresh attempt.
  const [failedPreview, setFailedPreview] = useState<string | null>(null)
  const [failedFavicon, setFailedFavicon] = useState<string | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const longPressCleanupRef = useRef<(() => void) | null>(null)
  const copiedResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const interactingRef = useRef(interacting)

  const hasImage =
    Boolean(bookmark.imageUrl) && failedPreview !== bookmark.imageUrl
  const hasFavicon =
    Boolean(bookmark.faviconUrl) && failedFavicon !== bookmark.faviconUrl
  const isEnriching = bookmark.enrichStatus === "pending" && !hasImage
  const brandFallback = !hasImage
  const width = bookmark.width ?? BOOKMARK_SIZE.width
  const height = bookmark.height ?? BOOKMARK_SIZE.height

  // Close when a drag/resize begins (React "adjust during render" pattern —
  // avoids a prop→setState effect).
  const [prevInteracting, setPrevInteracting] = useState(interacting)
  if (interacting !== prevInteracting) {
    setPrevInteracting(interacting)
    if (interacting && urlOpen) setUrlOpen(false)
  }

  function clearCopiedReset() {
    if (copiedResetRef.current == null) return
    clearTimeout(copiedResetRef.current)
    copiedResetRef.current = null
  }

  function clearLongPress() {
    longPressCleanupRef.current?.()
    longPressCleanupRef.current = null
  }

  useEffect(() => {
    interactingRef.current = interacting
    if (!interacting) return
    longPressCleanupRef.current?.()
    longPressCleanupRef.current = null
  }, [interacting])

  useEffect(() => {
    return () => {
      longPressCleanupRef.current?.()
      longPressCleanupRef.current = null
      if (copiedResetRef.current != null) {
        clearTimeout(copiedResetRef.current)
        copiedResetRef.current = null
      }
    }
  }, [])

  function armTouchLongPress(e: ReactPointerEvent) {
    if (e.pointerType !== "touch" || interactingRef.current) return

    clearLongPress()

    const pointerId = e.pointerId
    const startX = e.clientX
    const startY = e.clientY

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      if (
        Math.hypot(ev.clientX - startX, ev.clientY - startY) >= DRAG_THRESHOLD
      ) {
        clearLongPress()
      }
    }

    const onEnd = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return
      clearLongPress()
    }

    const timer = setTimeout(() => {
      longPressCleanupRef.current = null
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onEnd)
      window.removeEventListener("pointercancel", onEnd)
      if (!interactingRef.current) setUrlOpen(true)
    }, URL_TOOLTIP_DELAY_MS)

    longPressCleanupRef.current = () => {
      clearTimeout(timer)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onEnd)
      window.removeEventListener("pointercancel", onEnd)
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onEnd)
    window.addEventListener("pointercancel", onEnd)
  }

  async function copyUrl(e: ReactMouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(bookmark.url)
    } catch {
      return
    }
    setCopied(true)
    clearCopiedReset()
    copiedResetRef.current = setTimeout(() => {
      copiedResetRef.current = null
      setCopied(false)
    }, COPIED_RESET_MS)
  }

  return (
    <Tooltip
      open={urlOpen && !interacting}
      onOpenChange={(next) => {
        if (interacting) {
          setUrlOpen(false)
          clearCopiedReset()
          setCopied(false)
          return
        }
        setUrlOpen(next)
        if (!next) {
          clearCopiedReset()
          setCopied(false)
        }
      }}
      disabled={interacting}
    >
      <TooltipTrigger
        delay={URL_TOOLTIP_DELAY_MS}
        closeDelay={150}
        closeOnClick
        render={(props) => {
          const {
            className: triggerClassName,
            style: triggerStyle,
            onPointerDown,
            ...rest
          } = props
          return (
            <div
              {...rest}
              className={cn(
                "group relative overflow-hidden rounded-[25px] border-[3px] border-white/50",
                "shadow-[3px_3px_8px_rgba(0,0,0,0.1),11px_10px_15px_rgba(0,0,0,0.09),24px_24px_20px_rgba(0,0,0,0.05)]",
                selected && "border-black",
                brandFallback ? "bg-[#202020]" : "bg-white",
                triggerClassName,
                className
              )}
              style={
                {
                  ...triggerStyle,
                  width,
                  height,
                } as CSSProperties
              }
              onPointerDown={(e) => {
                onPointerDown?.(e)
                armTouchLongPress(e)
              }}
            >
              {hasImage ? (
                <img
                  src={bookmark.imageUrl}
                  alt=""
                  className="size-full object-cover outline outline-1 outline-black/10 transition-opacity duration-300 ease-[var(--ease-out-strong)] animate-in fade-in"
                  draggable={false}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setFailedPreview(bookmark.imageUrl ?? null)}
                />
              ) : isEnriching ? (
                <div
                  aria-busy="true"
                  aria-label="Loading preview"
                  className="relative size-full overflow-hidden bg-[#202020]"
                >
                  <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-[#2a2a2a] via-[#3d3d3d] to-[#242424]" />
                  <div className="absolute inset-0 -translate-x-full animate-[bookmark-shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                </div>
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-3 px-8 text-center text-white transition-opacity duration-300 ease-[var(--ease-out-strong)] animate-in fade-in">
                  {hasFavicon ? (
                    <img
                      src={bookmark.faviconUrl}
                      alt=""
                      className="size-12 rounded-xl outline outline-1 outline-white/15"
                      draggable={false}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setFailedFavicon(bookmark.faviconUrl ?? null)
                      }
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
        }}
      />
      <TooltipContent
        side="top"
        align="center"
        className="relative max-w-md py-1.5 pr-3 pl-3"
      >
        {/*
          URL drives the tooltip width; the copy control sits in reserved
          end padding so geometric center stays on the text (and the card).
        */}
        <span className="block max-w-full select-text whitespace-normal break-all pr-7 text-left">
          {bookmark.url}
        </span>
        <button
          type="button"
          aria-label={copied ? "Copied" : "Copy URL"}
          className={cn(
            "absolute top-1/2 right-1 flex size-6 -translate-y-1/2 items-center justify-center rounded-lg",
            "text-background/80 outline-none",
            // Extend hit area without changing visible size (dense desktop ≥40px).
            "before:absolute before:top-1/2 before:left-1/2 before:size-10 before:-translate-x-1/2 before:-translate-y-1/2",
            "transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.2,0,0,1)]",
            "focus-visible:ring-2 focus-visible:ring-background/40",
            "active:scale-[0.96]",
            "hover-fine:hover:bg-background/15 hover-fine:hover:text-background"
          )}
          onPointerDown={(e) => {
            // Keep the board from starting a drag; keep the tooltip open.
            e.stopPropagation()
          }}
          onClick={(e) => {
            void copyUrl(e)
          }}
        >
          <span className="relative size-3.5" aria-hidden>
            <CopySimpleIcon
              weight="bold"
              className={cn(
                "absolute inset-0 size-3.5 transition-[opacity,filter,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
                copied
                  ? "scale-[0.25] opacity-0 blur-[4px]"
                  : "scale-100 opacity-100 blur-0"
              )}
            />
            <CheckIcon
              weight="bold"
              className={cn(
                "absolute inset-0 size-3.5 transition-[opacity,filter,transform] duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
                copied
                  ? "scale-100 opacity-100 blur-0"
                  : "scale-[0.25] opacity-0 blur-[4px]"
              )}
            />
          </span>
        </button>
      </TooltipContent>
    </Tooltip>
  )
})
