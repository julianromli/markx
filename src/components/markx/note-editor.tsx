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

const NOTE_DRAFT_DEBOUNCE_MS = 400

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
  /**
   * Saves content. Called for autosave drafts while typing and for the final
   * commit; all calls from one mount share `session` (one undo step).
   */
  onCommit?: (content: string, session: string) => void
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
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [session] = useState(() => Math.random().toString(36).slice(2))
  const latestHtmlRef = useRef(note.content)
  const savedHtmlRef = useRef(note.content)
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onCommitRef = useRef(onCommit)
  onCommitRef.current = onCommit

  const saveDraft = () => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
    draftTimerRef.current = null
    if (latestHtmlRef.current === savedHtmlRef.current) return
    savedHtmlRef.current = latestHtmlRef.current
    onCommitRef.current?.(latestHtmlRef.current, session)
  }
  const saveDraftRef = useRef(saveDraft)
  saveDraftRef.current = saveDraft

  const editor = useEditor({
    extensions: [StarterKit, Underline],
    content: note.content,
    autofocus: "end",
    editorProps: {
      attributes: {
        class:
          "outline-none min-h-[1em] [&_p]:my-0 [&_p+p]:mt-2 [&_strong]:font-semibold",
      },
      // Tab moves to the toolbar (it is portaled, so it is not next in DOM
      // order). Inside a list, Tab keeps its indent meaning.
      handleKeyDown: (view, event) => {
        if (event.key !== "Tab" || event.shiftKey) return false
        const inList =
          view.state.selection.$from.node(-1).type.name === "listItem"
        if (inList) return false
        const first = toolbarRef.current?.querySelector<HTMLElement>("button")
        if (!first) return false
        event.preventDefault()
        first.focus()
        return true
      },
    },
    onUpdate: ({ editor: ed }) => {
      latestHtmlRef.current = ed.getHTML()
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current)
      draftTimerRef.current = setTimeout(
        () => saveDraftRef.current(),
        NOTE_DRAFT_DEBOUNCE_MS
      )
    },
    onBlur: ({ editor: ed, event }) => {
      if (committedRef.current) return
      const related = event.relatedTarget
      if (
        related instanceof Node &&
        (container?.contains(related) || toolbarRef.current?.contains(related))
      ) {
        return
      }
      committedRef.current = true
      latestHtmlRef.current = ed.getHTML()
      saveDraftRef.current()
      onExitEdit?.()
    },
  })

  // Phones discard background tabs, so save before the page can go away.
  // Capture phase: runs before the store's own flush listener.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") saveDraftRef.current()
    }
    const onPageHide = () => saveDraftRef.current()
    document.addEventListener("visibilitychange", onHide, true)
    window.addEventListener("pagehide", onPageHide, true)
    return () => {
      document.removeEventListener("visibilitychange", onHide, true)
      window.removeEventListener("pagehide", onPageHide, true)
      // Editing can end without a blur (blank-canvas tap, navigation).
      saveDraftRef.current()
    }
  }, [])

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
      latestHtmlRef.current = editor.getHTML()
      saveDraftRef.current()
      onExitEdit?.()
      editor.commands.blur()
    }

    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [editor, openMenu, onExitEdit])

  // The toolbar lives in screen space (portaled to <body>), not inside the
  // zoomed board, so its controls keep their real size at any zoom. It
  // follows the note every frame while editing.
  useEffect(() => {
    if (!container) return
    let frame = 0
    const place = () => {
      frame = requestAnimationFrame(place)
      const toolbarEl = toolbarRef.current
      if (!toolbarEl) return
      const noteRect = container.getBoundingClientRect()
      const bar = toolbarEl.getBoundingClientRect()
      const vv = window.visualViewport
      const viewTop = vv?.offsetTop ?? 0
      const viewLeft = vv?.offsetLeft ?? 0
      const viewWidth = vv?.width ?? window.innerWidth
      const viewHeight = vv?.height ?? window.innerHeight
      const gap = 8
      let top = isMobile
        ? noteRect.bottom + gap
        : noteRect.top - bar.height - 12
      if (isMobile && top + bar.height > viewTop + viewHeight - gap) {
        top = noteRect.top - bar.height - gap
      }
      if (!isMobile && top < viewTop + gap) top = noteRect.bottom + gap
      top = Math.max(
        viewTop + gap,
        Math.min(top, viewTop + viewHeight - bar.height - gap)
      )
      let left = isMobile
        ? noteRect.left
        : noteRect.left + noteRect.width / 2 - bar.width / 2
      left = Math.max(
        viewLeft + gap,
        Math.min(left, viewLeft + viewWidth - bar.width - gap)
      )
      toolbarEl.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
      toolbarEl.style.visibility = "visible"
    }
    place()
    return () => cancelAnimationFrame(frame)
  }, [container, isMobile])

  const toolbar = (
    <div
      ref={toolbarRef}
      data-note-toolbar=""
      className="note-toolbar-in fixed top-0 left-0 z-50 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-0.5 rounded-[13px] border border-black/10 bg-white px-1.5 py-1 shadow-[0_2px_6px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.12)]"
      style={{ visibility: "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // Shift+Tab from the first control goes back into the text.
        const first = toolbarRef.current?.querySelector("button")
        if (e.key === "Tab" && e.shiftKey && e.target === first) {
          e.preventDefault()
          editor.commands.focus()
        }
      }}
    >
      <ToolbarDropdown
        id="color"
        label="Note color"
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
        label="Font"
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
                  "flex h-8 w-full items-center rounded-md px-3 text-[13px] text-ink transition-colors hover:bg-black/5 pointer-coarse:h-11",
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
        label={`Text size: ${
          SIZE_OPTIONS.find((o) => o.value === note.fontSize)?.label ?? "Medium"
        }`}
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
                  "flex h-8 w-full items-center rounded-md px-3 text-[13px] text-ink transition-colors hover:bg-black/5 pointer-coarse:h-11",
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
      {container ? createPortal(toolbar, document.body) : null}
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
        "flex size-8 items-center justify-center rounded-lg text-[13px] font-semibold text-ink transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96] pointer-coarse:size-11",
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
  label,
  openMenu,
  onOpenMenuChange,
  triggerLabel,
  hasPopup = "menu",
  children,
}: {
  id: string
  /** Accessible name of the trigger, e.g. "Font". */
  label: string
  openMenu: string | null
  onOpenMenuChange: (id: string | null) => void
  triggerLabel: ReactNode
  /** "menu" when the popup has menu semantics; "true" for a generic panel. */
  hasPopup?: "menu" | "true"
  children: (close: () => void) => ReactNode
}) {
  const open = openMenu === id
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const focusFirstRef = useRef(false)

  useEffect(() => {
    if (!open) return
    const onPointerDown = () => onOpenMenuChange(null)
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [open, onOpenMenuChange])

  // Keyboard open moves focus into the panel; closing while focus was in
  // the (now removed) panel returns it to the trigger.
  const wasOpenRef = useRef(open)
  useEffect(() => {
    const wasOpen = wasOpenRef.current
    wasOpenRef.current = open
    if (open) {
      if (focusFirstRef.current) {
        focusFirstRef.current = false
        panelItems(panelRef.current)[0]?.focus()
      }
      return
    }
    const active = document.activeElement
    if (wasOpen && (active == null || active === document.body)) {
      triggerRef.current?.focus()
    }
  }, [open])

  const openFromKeyboard = () => {
    focusFirstRef.current = true
    onOpenMenuChange(id)
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup={hasPopup}
        onPointerDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onOpenMenuChange(open ? null : id)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault()
            if (open) onOpenMenuChange(null)
            else openFromKeyboard()
          }
        }}
        className={cn(
          "flex h-8 items-center gap-1 rounded-lg px-2 text-ink transition-[background-color,transform] duration-150 ease-[var(--ease-out-strong)] active:scale-[0.96] pointer-coarse:h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center",
          open ? "bg-black/5" : "hover:bg-black/5"
        )}
      >
        {triggerLabel}
        <CaretDownIcon className="size-3 text-black/40" weight="bold" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="toolbar-dropdown-in absolute top-full left-0 z-20 mt-1 origin-top-left rounded-xl border border-black/10 bg-white p-0.5 shadow-[0_4px_16px_rgba(0,0,0,0.15)]"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return
            e.preventDefault()
            const items = panelItems(panelRef.current)
            const index = items.indexOf(document.activeElement as HTMLElement)
            const step = e.key === "ArrowDown" ? 1 : -1
            items[(index + step + items.length) % items.length]?.focus()
          }}
        >
          {children(() => onOpenMenuChange(null))}
        </div>
      ) : null}
    </div>
  )
}

function panelItems(panel: HTMLElement | null): HTMLElement[] {
  return panel ? [...panel.querySelectorAll<HTMLElement>("button")] : []
}
