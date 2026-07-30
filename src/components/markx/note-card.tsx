import { Suspense, lazy, useState } from "react"

import { NOTE_COLORS } from "@/components/markx/note-color-choices"
import { ResizeHandle } from "@/components/markx/resize-handle"
import { useIsMobile } from "@/hooks/use-mobile"
import { NOTE_SIZE } from "@/lib/markx/geometry"
import { cn } from "@/lib/utils"
import type { Note, NoteFont, NoteSize } from "@/lib/markx/types"

// Tiptap + ProseMirror only ship (and an editor instance only exists) while a
// note is actually being edited — the static view renders plain HTML.
const NoteEditor = lazy(() => import("@/components/markx/note-editor"))

type NoteCardProps = {
  note: Note
  selected?: boolean
  editing?: boolean
  onCommit?: (content: string) => void
  onExitEdit?: () => void
  onStyleChange?: (
    style: Partial<Pick<Note, "color" | "font" | "fontSize">>
  ) => void
  className?: string
}

export const NOTE_FONTS: Record<NoteFont, string> = {
  sans: "var(--font-sans), ui-sans-serif, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace",
  hand: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive",
}

export const NOTE_FONT_SIZES: Record<NoteSize, number> = {
  s: 14,
  m: 18,
  l: 24,
  xl: 32,
}

export function NoteCard({
  note,
  selected,
  editing,
  onCommit,
  onExitEdit,
  onStyleChange,
  className,
}: NoteCardProps) {
  const width = note.width ?? NOTE_SIZE.width
  const height = note.height ?? NOTE_SIZE.height
  const isMobile = useIsMobile()
  // Callback ref as state so the lazily-mounted editor receives a non-null
  // portal target on its first render.
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  const fontFamily = NOTE_FONTS[note.font]
  const fontSize = NOTE_FONT_SIZES[note.fontSize]

  const staticContent = note.content ? (
    <div
      className="[&_p]:my-0 [&_p+p]:mt-2 [&_strong]:font-semibold"
      dangerouslySetInnerHTML={{ __html: note.content }}
    />
  ) : (
    <p className="text-ink/70">
      {isMobile ? "Double-tap to edit" : "Double-click to edit"}
    </p>
  )

  return (
    <div
      ref={setContainer}
      className={cn("relative", className)}
      style={{ width, height }}
    >
      <div
        className={cn(
          "group relative flex h-full flex-col overflow-hidden rounded-[12px] p-4 shadow-[3px_3px_8px_rgba(0,0,0,0.08),11px_10px_15px_rgba(0,0,0,0.06)]",
          selected &&
            "ring-2 ring-black/80 ring-offset-2 ring-offset-transparent"
        )}
        style={{ backgroundColor: NOTE_COLORS[note.color] }}
      >
        <div
          className="min-h-0 flex-1 overflow-y-auto leading-snug text-ink"
          style={{ fontFamily, fontSize }}
        >
          {editing ? (
            <Suspense fallback={staticContent}>
              <NoteEditor
                note={note}
                isMobile={isMobile}
                container={container}
                onCommit={onCommit}
                onExitEdit={onExitEdit}
                onStyleChange={onStyleChange}
              />
            </Suspense>
          ) : (
            staticContent
          )}
        </div>

        {!editing ? <ResizeHandle selected={selected} /> : null}
      </div>
    </div>
  )
}
