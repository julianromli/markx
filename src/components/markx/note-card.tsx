import { CaretDownIcon } from "@phosphor-icons/react"
import Underline from "@tiptap/extension-underline"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"

import {
  NOTE_COLORS,
  NoteColorChoices,
} from "@/components/markx/note-color-choices"
import { ResizeHandle } from "@/components/markx/resize-handle"
import { useIsMobile } from "@/hooks/use-mobile"
import { NOTE_SIZE } from "@/lib/markx/geometry"
import { cn } from "@/lib/utils"
import type { Note, NoteFont, NoteSize } from "@/lib/markx/types"

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

const FONT_OPTIONS: Array<{ value: NoteFont; label: string }> = [
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "mono", label: "Mono" },
  { value: "hand", label: "Hand" },
]

const SIZE_OPTIONS: Array<{ value: NoteSize; label: string }> = [
  { value: "s", label: "Small" },
  { value: "m", label: "Medium" },
  { value: "l", label: "Large" },
  { value: "xl", label: "Huge" },
]

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
  const committedRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const editor = useEditor(
    {
      extensions: [StarterKit, Underline],
      content: note.content,
      autofocus: "end",
      editorProps: {
        attributes: {
          class:
            "outline-none min-h-[1em] [&_p]:my-0 [&_p+p]:mt-2 [&_strong]:font-semibold",
        },
      },
      onBlur: ({ editor: ed, event }) => {
        if (committedRef.current) return
        const related = event.relatedTarget
        if (related instanceof Node && rootRef.current?.contains(related)) {
          return
        }
        committedRef.current = true
        onCommit?.(ed.getHTML())
        onExitEdit?.()
      },
    },
    [editing, note.id]
  )

  useEffect(() => {
    if (!editing) {
      committedRef.current = false
    }
  }, [editing])

  useEffect(() => {
    if (!editing) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      // An open toolbar dropdown consumes the first Escape; the next one
      // exits editing.
      if (openMenu != null) {
        setOpenMenu(null)
        return
      }
      if (committedRef.current) return
      committedRef.current = true
      onCommit?.(editor.getHTML())
      onExitEdit?.()
      editor.commands.blur()
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [editing, editor, openMenu, onCommit, onExitEdit])

  const fontFamily = NOTE_FONTS[note.font]
  const fontSize = NOTE_FONT_SIZES[note.fontSize]

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      style={{ width, height }}
    >
      {editing ? (
        <div
          className={cn(
            "note-toolbar-in absolute z-10 flex items-center gap-0.5 rounded-[13px] border border-black/10 bg-white px-1.5 py-1 shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]",
            isMobile
              ? "top-full left-0 mt-2 max-w-[88vw] overflow-x-auto overscroll-x-contain"
              : "-top-[52px] left-1/2 -translate-x-1/2"
          )}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ToolbarDropdown
            id="color"
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
            hasPopup="true"
            triggerLabel={
              <span
                className="size-4 rounded-full border border-black/15"
                style={{ backgroundColor: NOTE_COLORS[note.color] }}
              />
            }
          >
            {(close) => (
              <div className="p-1">
                <NoteColorChoices
                  selected={note.color}
                  onSelect={(color) => {
                    onStyleChange?.({ color })
                    editor.commands.focus()
                    close()
                  }}
                />
              </div>
            )}
          </ToolbarDropdown>

          <ToolbarDivider />

          <ToolbarDropdown
            id="font"
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
            triggerLabel={<span className="text-[13px] font-medium">Aa</span>}
          >
            {(close) => (
              <div className="min-w-[120px] p-0.5" role="menu">
                {FONT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={note.font === option.value}
                    onClick={() => {
                      onStyleChange?.({ font: option.value })
                      editor.commands.focus()
                      close()
                    }}
                    className={cn(
                      "flex h-8 w-full items-center rounded-md px-3 text-[13px] text-ink transition-colors hover:bg-black/5",
                      note.font === option.value && "bg-black/5"
                    )}
                    style={{ fontFamily: NOTE_FONTS[option.value] }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </ToolbarDropdown>

          <ToolbarDivider />

          <ToolbarDropdown
            id="size"
            openMenu={openMenu}
            onOpenMenuChange={setOpenMenu}
            triggerLabel={
              <span className="text-[12px] font-medium">
                {SIZE_OPTIONS.find((o) => o.value === note.fontSize)?.label ??
                  "Medium"}
              </span>
            }
          >
            {(close) => (
              <div className="min-w-[120px] p-0.5" role="menu">
                {SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={note.fontSize === option.value}
                    onClick={() => {
                      onStyleChange?.({ fontSize: option.value })
                      editor.commands.focus()
                      close()
                    }}
                    className={cn(
                      "flex h-8 w-full items-center rounded-md px-3 text-[13px] text-ink transition-colors hover:bg-black/5",
                      note.fontSize === option.value && "bg-black/5"
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </ToolbarDropdown>

          <ToolbarDivider />

          <ToolbarButton
            active={editor.isActive("bold")}
            label="Bold"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("italic")}
            label="Italic"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive("underline")}
            label="Underline"
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          >
            U
          </ToolbarButton>
        </div>
      ) : null}

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
            <EditorContent editor={editor} />
          ) : note.content ? (
            <div
              className="[&_p]:my-0 [&_p+p]:mt-2 [&_strong]:font-semibold"
              dangerouslySetInnerHTML={{ __html: note.content }}
            />
          ) : (
            <p className="text-ink/70">
              {isMobile ? "Double-tap to edit" : "Double-click to edit"}
            </p>
          )}
        </div>

        {!editing ? <ResizeHandle selected={selected} /> : null}
      </div>
    </div>
  )
}

function ToolbarButton({
  active,
  label,
  onClick,
  children,
}: {
  active?: boolean
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onPointerDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg text-[13px] font-semibold text-ink transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96]",
        active ? "bg-black/10" : "hover:bg-black/5"
      )}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <div className="mx-0.5 h-6 w-px bg-black/10" aria-hidden />
}

function ToolbarDropdown({
  id,
  openMenu,
  onOpenMenuChange,
  triggerLabel,
  hasPopup = "menu",
  children,
}: {
  id: string
  openMenu: string | null
  onOpenMenuChange: (id: string | null) => void
  triggerLabel: ReactNode
  /** "menu" when the popup has menu semantics; "true" for a generic panel. */
  hasPopup?: "menu" | "true"
  children: (close: () => void) => ReactNode
}) {
  const open = openMenu === id

  useEffect(() => {
    if (!open) return
    const onPointerDown = () => onOpenMenuChange(null)
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [open, onOpenMenuChange])

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup={hasPopup}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenMenuChange(open ? null : id)
        }}
        className={cn(
          "flex h-8 items-center gap-1 rounded-lg px-2 text-ink transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96]",
          open ? "bg-black/5" : "hover:bg-black/5"
        )}
      >
        {triggerLabel}
        <CaretDownIcon className="size-3 text-black/40" weight="bold" />
      </button>
      {open ? (
        <div
          className="toolbar-dropdown-in absolute top-full left-0 z-20 mt-1 origin-top-left rounded-xl border border-black/10 bg-white p-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.15)]"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {children(() => onOpenMenuChange(null))}
        </div>
      ) : null}
    </div>
  )
}
