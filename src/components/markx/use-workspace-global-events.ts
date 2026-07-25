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

      if (event.key === "Enter" && current.selectedRenamable) {
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
        isEditableEventTarget(event.target)
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

export function isEditableEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable)
  )
}

export function looksLikeUrl(text: string): boolean {
  return (
    /^https?:\/\//i.test(text) ||
    (!text.includes(" ") && text.includes(".") && text.length < 2048)
  )
}
