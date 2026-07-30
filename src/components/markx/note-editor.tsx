import { createPortal } from "react-dom"
import { useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown"
import Underline from "@tiptap/extension-underline"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"

import {
  NOTE_COLORS,
  NoteColorChoices,
} from "@/components/markx/note-color-choices"
import { NOTE_FONTS } from "@/components/markx/note-card"
import { cn } from "@/lib/utils"
import type { Note, NoteFont, NoteSize } from "@/lib/markx/types"

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

type NoteEditorProps = {
  note: Note
  isMobile: boolean
  /**
   * The note card root. The toolbar is portaled there so it escapes the
   * scrollable content area, and blur checks treat clicks inside it as
   * still editing.
   */
  container: HTMLElement | null
  onCommit?: (content: string) => void
  onExitEdit?: () => void
  onStyleChange?: (
    style: Partial<Pick<Note, "color" | "font" | "fontSize">>
  ) => void
}

/**
 * Loaded lazily from note-card so the ProseMirror stack only ships (and an
 * editor instance only exists) while a note is actually being edited.
 */
export default function NoteEditor({
  note,
  isMobile,
  container,
  onCommit,
  onExitEdit,
  onStyleChange,
}: NoteEditorProps) {
  const committedRef = useRef(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)

  const editor = useEditor({
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
      if (related instanceof Node && container?.contains(related)) {
        return
      }
      committedRef.current = true
      onCommit?.(ed.getHTML())
      onExitEdit?.()
    },
  })

  useEffect(() => {
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
  }, [editor, openMenu, onCommit, onExitEdit])

  const toolbar = (
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
  )

  return (
    <>
      {container ? createPortal(toolbar, container) : null}
      <EditorContent editor={editor} />
    </>
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
