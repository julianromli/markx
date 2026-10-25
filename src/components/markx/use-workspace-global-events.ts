import { useEffect, useRef } from "react"

type WorkspaceGlobalEventsOptions = {
  blocked: boolean
  editing: boolean
  mode: "home" | "folder"
  selectedIds: Set<string>
  selectedRenamable: boolean
  onAddImages: (files: File[]) => void | Promise<void>
  onCreateBookmark: (url: string) => void | Promise<void>
  onDeleteSelection: (ids: string[]) => void
  onNewFolder: () => void
  onRedo: () => void
  onRename: (id: string) => void
  onResetInteraction: () => void
  onUndo: () => void
  onNewFolderUnavailable: () => void
  onPasteUrlAtHome: () => void
}

export function useWorkspaceGlobalEvents(
  options: WorkspaceGlobalEventsOptions
): void {
  const latest = useRef(options)
  latest.current = options

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current
      if (
        current.blocked ||
        isEditableEventTarget(event.target) ||
        isOverlayActive(event.target) ||
        current.editing
      ) {
        return
      }

      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()
      if (mod && key === "n") {
        event.preventDefault()
        if (current.mode === "home") current.onNewFolder()
        else current.onNewFolderUnavailable()
        return
      }
      if (mod && key === "z") {
        event.preventDefault()
        if (event.shiftKey) current.onRedo()
        else current.onUndo()
        return
      }
      if (mod && key === "y") {
        event.preventDefault()
        current.onRedo()
        return
      }
      if (mod && key === "v") return

      // F2 renames; Enter is reserved for opening the focused board item
      // (handled by the Board's own key handler).
      if (event.key === "F2" && current.selectedRenamable) {
        const id = [...current.selectedIds][0]
        if (!id) return
        event.preventDefault()
        current.onRename(id)
        return
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault()
        current.onDeleteSelection([...current.selectedIds])
        return
      }
      if (event.key === "Escape") current.onResetInteraction()
    }

    const onPaste = (event: ClipboardEvent) => {
      const current = latest.current
      if (
        current.blocked ||
        current.editing ||
        isEditableEventTarget(event.target) ||
        isOverlayActive(event.target)
      ) {
        return
      }

      const imageFiles = Array.from(event.clipboardData?.files ?? []).filter(
        (file) => file.type.startsWith("image/")
      )
      if (imageFiles.length > 0) {
        event.preventDefault()
        void current.onAddImages(imageFiles)
        return
      }

      const text = event.clipboardData?.getData("text").trim()
      if (!text || !looksLikeUrl(text)) return
      if (current.mode === "home") {
        current.onPasteUrlAtHome()
        return
      }

      event.preventDefault()
      void current.onCreateBookmark(text)
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("paste", onPaste)
    }
  }, [])
}

const OVERLAY_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/**
 * True while a dialog, sheet, or menu owns the keyboard. Board shortcuts
 * (Delete, Backspace, Cmd+Z, Escape) must not act on the canvas behind it.
 */
export function isOverlayActive(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(OVERLAY_SELECTOR)) {
    return true
  }
  if (typeof document === "undefined") return false
  for (const el of document.querySelectorAll(OVERLAY_SELECTOR)) {
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) continue
    return true
  }
  return false
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT" ||
      target.isContentEditable)
  )
}

export function looksLikeUrl(text: string): boolean {
  return (
    /^https?:\/\//i.test(text) ||
    (!text.includes(" ") && text.includes(".") && text.length < 2048)
  )
}
