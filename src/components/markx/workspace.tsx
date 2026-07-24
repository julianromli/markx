import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { nanoid } from "nanoid"
import { toast } from "sonner"

import { BookmarkCard } from "@/components/markx/bookmark-card"
import {
  Board,
  type BoardApi,
  type BoardItemModel,
} from "@/components/markx/board"
import { AppShell } from "@/components/markx/app-shell"
import {
  AddLinkDialog,
  ConfirmDeleteFolderDialog,
  MoveToDialog,
  RenameDialog,
} from "@/components/markx/dialogs"
import { FolderIcon } from "@/components/markx/folder-icon"
import { ImageCard } from "@/components/markx/image-card"
import { NOTE_COLORS, NoteCard } from "@/components/markx/note-card"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Button } from "@/components/ui/button"
import { store, useMarkxActions, useMarkxState } from "@/lib/markx/store"
import { countBookmarksInFolder, saveImageBlob } from "@/lib/markx/storage"
import { prepareImage } from "@/lib/markx/images"
import type { NoteColor, ToolId } from "@/lib/markx/types"

type WorkspaceProps = { mode: "home" } | { mode: "folder"; folderId: string }

export function Workspace(props: WorkspaceProps) {
  const state = useMarkxState()
  const actions = useMarkxActions()
  const navigate = useNavigate()
  const trashRef = useRef<HTMLButtonElement>(null)
  const boardApiRef = useRef<BoardApi | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [tool, setTool] = useState<ToolId>("select")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renameOpen, setRenameOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmFolderOpen, setConfirmFolderOpen] = useState(false)
  const [pendingCreate, setPendingCreate] = useState<{
    x: number
    y: number
  } | null>(null)
  const [contextTargetId, setContextTargetId] = useState<string | null>(null)
  const [contextPoint, setContextPoint] = useState({ x: 180, y: 160 })
  const [zoomPercent, setZoomPercent] = useState(85)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)

  const folder =
    props.mode === "folder"
      ? state.folders.find((f) => f.id === props.folderId)
      : undefined

  const items: BoardItemModel[] = useMemo(() => {
    if (props.mode === "home") {
      const folders = state.folders.map((data) => ({
        id: data.id,
        kind: "folder" as const,
        data,
      }))
      const notes = state.notes
        .filter((note) => note.folderId == null)
        .map((data) => ({ id: data.id, kind: "note" as const, data }))
      const images = state.images
        .filter((image) => image.folderId == null)
        .map((data) => ({ id: data.id, kind: "image" as const, data }))
      return [...folders, ...notes, ...images]
    }
    const bookmarks = state.bookmarks
      .filter((b) => b.folderId === props.folderId)
      .map((data) => ({ id: data.id, kind: "bookmark" as const, data }))
    const notes = state.notes
      .filter((note) => note.folderId === props.folderId)
      .map((data) => ({ id: data.id, kind: "note" as const, data }))
    const images = state.images
      .filter((image) => image.folderId === props.folderId)
      .map((data) => ({ id: data.id, kind: "image" as const, data }))
    return [...bookmarks, ...notes, ...images]
  }, [props, state.bookmarks, state.folders, state.notes, state.images])

  const selectedItems = items.filter((i) => selectedIds.has(i.id))

  const openItem = useCallback(
    (id: string) => {
      const note = state.notes.find((n) => n.id === id)
      if (note) {
        setEditingNoteId(id)
        setSelectedIds(new Set([id]))
        actions.raiseZ([id])
        return
      }

      if (props.mode === "home") {
        void navigate({ to: "/folder/$folderId", params: { folderId: id } })
        return
      }
      const bookmark = state.bookmarks.find((b) => b.id === id)
      if (bookmark) window.open(bookmark.url, "_blank", "noopener,noreferrer")
    },
    [actions, navigate, props.mode, state.bookmarks, state.notes]
  )

  const deleteSelection = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return

      const folderIds = ids.filter((id) =>
        state.folders.some((folder) => folder.id === id)
      )
      const bookmarkIds = ids.filter((id) =>
        state.bookmarks.some((bookmark) => bookmark.id === id)
      )
      const noteIds = ids.filter((id) =>
        state.notes.some((note) => note.id === id)
      )
      const imageIds = ids.filter((id) =>
        state.images.some((image) => image.id === id)
      )

      if (props.mode === "home") {
        const nonempty = folderIds.filter(
          (id) =>
            countBookmarksInFolder(state.bookmarks, id) > 0 ||
            state.notes.some((note) => note.folderId === id) ||
            state.images.some((image) => image.folderId === id)
        )
        if (nonempty.length > 0) {
          setConfirmFolderOpen(true)
          return
        }
        if (folderIds.length > 0) {
          actions.deleteFolders(folderIds)
        }
        if (noteIds.length > 0) {
          actions.deleteNotes(noteIds)
        }
        if (imageIds.length > 0) {
          actions.deleteImages(imageIds)
        }
        if (editingNoteId && noteIds.includes(editingNoteId)) {
          setEditingNoteId(null)
        }
        setSelectedIds(new Set())
        toast(
          ids.length === 1
            ? folderIds.length > 0
              ? "Folder deleted"
              : noteIds.length > 0
                ? "Note deleted"
                : "Image deleted"
            : "Deleted"
        )
        return
      }

      if (bookmarkIds.length > 0) {
        const removed = actions.deleteBookmarks(bookmarkIds)
        toast("Bookmark deleted", {
          action: {
            label: "Undo",
            onClick: () => actions.restoreBookmarks(removed),
          },
        })
      }
      if (noteIds.length > 0) {
        actions.deleteNotes(noteIds)
        if (bookmarkIds.length === 0 && imageIds.length === 0) {
          toast("Note deleted")
        }
      }
      if (imageIds.length > 0) {
        actions.deleteImages(imageIds)
        if (bookmarkIds.length === 0 && noteIds.length === 0) {
          toast("Image deleted")
        }
      }
      if (editingNoteId && noteIds.includes(editingNoteId)) {
        setEditingNoteId(null)
      }
      setSelectedIds(new Set())
    },
    [
      actions,
      editingNoteId,
      props.mode,
      state.bookmarks,
      state.folders,
      state.notes,
    ]
  )

  const confirmDeleteFolders = () => {
    const folderIds = [...selectedIds].filter((id) =>
      state.folders.some((folder) => folder.id === id)
    )
    actions.deleteFolders(folderIds)
    setSelectedIds(new Set())
    toast("Folder deleted")
  }

  const openNewFolderDialog = useCallback((x: number, y: number) => {
    setPendingCreate({ x, y })
    setNewFolderOpen(true)
    setTool("select")
  }, [])

  const handleBoardCreate = (x: number, y: number) => {
    // Don't re-open while a create dialog is already up (double-click / burst)
    if (newFolderOpen || linkOpen) return

    if (tool === "note") {
      const folderId = props.mode === "folder" ? props.folderId : null
      const note = actions.createNote(x, y, folderId)
      setSelectedIds(new Set([note.id]))
      setEditingNoteId(note.id)
      actions.raiseZ([note.id])
      setTool("select")
      return
    }

    if (props.mode === "home") {
      if (tool !== "board") {
        if (tool === "link") {
          toast("Open a folder to add links")
          setTool("select")
        }
        return
      }
      openNewFolderDialog(x, y)
      return
    }

    if (tool !== "link") {
      if (tool === "board") {
        toast("Folders live on Home")
        setTool("select")
      }
      return
    }
    setPendingCreate({ x, y })
    setLinkOpen(true)
    setTool("select")
  }

  const handleMoveItems = (
    updates: Array<{ id: string; x: number; y: number }>
  ) => {
    actions.updatePositions(updates)
  }

  const handleResizeItem = (
    id: string,
    rect: { x: number; width: number; height: number }
  ) => {
    actions.resizeItem(id, rect)
  }

  const addImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const folderId = props.mode === "folder" ? props.folderId : null
      const center = boardApiRef.current?.getViewCenter() ?? { x: 200, y: 200 }
      const fileArray = Array.from(files).filter((f) =>
        f.type.startsWith("image/")
      )
      if (fileArray.length === 0) return

      let cascade = 0
      for (const file of fileArray) {
        const prepared = await prepareImage(file)
        if (!prepared) {
          toast("Could not add image (too large or unsupported)")
          continue
        }
        const imageId = nanoid()
        await saveImageBlob(imageId, prepared.blob)
        const created = actions.createImage({
          id: nanoid(),
          folderId,
          imageId,
          mime: prepared.mime,
          naturalWidth: prepared.naturalWidth,
          naturalHeight: prepared.naturalHeight,
          x: center.x - 240 + cascade * 24,
          y: center.y - 160 + cascade * 24,
        })
        // Enqueue the blob for R2 upload when the sync engine is active.
        const engine = store.getSyncEngine()
        if (engine) {
          void engine.enqueueAsset(imageId, prepared.blob, prepared.mime)
        }
        actions.raiseZ([created.id])
        cascade += 1
      }
      setTool("select")
    },
    [actions, props]
  )

  const selectedNotes = selectedItems.filter((item) => item.kind === "note")
  const selectedRenamable =
    selectedIds.size === 1 &&
    selectedItems[0] != null &&
    selectedItems[0].kind !== "note" &&
    selectedItems[0].kind !== "image"
  const selectedOpenable =
    selectedIds.size === 1 &&
    selectedItems[0] != null &&
    selectedItems[0].kind !== "note" &&
    selectedItems[0].kind !== "image"

  const renameTarget = (() => {
    const id = contextTargetId ?? [...selectedIds][0]
    if (!id) return null
    if (props.mode === "home") {
      const f = state.folders.find((item) => item.id === id)
      return f ? { id: f.id, value: f.name, kind: "folder" as const } : null
    }
    const b = state.bookmarks.find((item) => item.id === id)
    return b ? { id: b.id, value: b.title, kind: "bookmark" as const } : null
  })()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return
      }

      if (editingNoteId) return

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault()
        if (props.mode === "home") {
          openNewFolderDialog(180, 160)
        } else {
          toast("Folders are created on Home")
        }
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) actions.redo()
        else actions.undo()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault()
        actions.redo()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
        // Paste handled in paste listener
        return
      }

      if (e.key === "Enter" && selectedRenamable) {
        e.preventDefault()
        setContextTargetId([...selectedIds][0]!)
        setRenameOpen(true)
        return
      }

      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault()
        deleteSelection([...selectedIds])
      }

      if (e.key === "Escape") {
        setSelectedIds(new Set())
        setTool("select")
        setEditingNoteId(null)
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      if (editingNoteId) return

      // Check for pasted image files first
      const imageFiles = Array.from(e.clipboardData?.files ?? []).filter((f) =>
        f.type.startsWith("image/")
      )
      if (imageFiles.length > 0) {
        e.preventDefault()
        void addImageFiles(imageFiles)
        return
      }

      const text = e.clipboardData?.getData("text")?.trim()
      if (!text) return
      const looksLikeUrl =
        /^https?:\/\//i.test(text) ||
        (!text.includes(" ") && text.includes(".") && text.length < 2048)
      if (!looksLikeUrl) return

      if (props.mode === "home") {
        toast("Open a folder to add links")
        return
      }

      e.preventDefault()
      void actions.createBookmark(props.folderId, text, 200, 180)
      setTool("select")
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("paste", onPaste)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("paste", onPaste)
    }
  }, [
    actions,
    addImageFiles,
    deleteSelection,
    editingNoteId,
    openNewFolderDialog,
    props,
    selectedIds,
  ])

  if (props.mode === "folder" && !folder) {
    return (
      <div className="markx-dot-bg flex h-svh items-center justify-center">
        <div className="space-y-3 text-center">
          <p className="text-sm text-black/60">Folder not found</p>
          <Button onClick={() => void navigate({ to: "/" })}>
            Back to markx
          </Button>
        </div>
      </div>
    )
  }

  return (
    <AppShell
      title="markx"
      breadcrumb={
        props.mode === "folder"
          ? [
              { label: "Home", to: "/", home: true },
              { label: folder?.name ?? "Folder" },
            ]
          : [{ label: "Home", to: "/", home: true }]
      }
      tool={tool}
      onToolChange={setTool}
      trashRef={trashRef}
      zoomPercent={zoomPercent}
      onImageTool={() => fileInputRef.current?.click()}
    >
      <ContextMenu>
        <ContextMenuTrigger className="block h-full">
          <Board
            items={items}
            tool={tool}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            onRaiseZ={actions.raiseZ}
            onMoveItems={handleMoveItems}
            onResizeItem={handleResizeItem}
            onOpenItem={openItem}
            onBoardCreate={handleBoardCreate}
            onTrashDrop={deleteSelection}
            trashRef={trashRef}
            onZoomChange={setZoomPercent}
            onContextPoint={setContextPoint}
            editingId={editingNoteId ?? undefined}
            boardApiRef={boardApiRef}
            renderItem={(item, selected) => {
              if (item.kind === "folder") {
                return (
                  <FolderIcon
                    name={item.data.name}
                    count={countBookmarksInFolder(
                      state.bookmarks,
                      item.data.id
                    )}
                    selected={selected}
                  />
                )
              }
              if (item.kind === "note") {
                return (
                  <NoteCard
                    note={item.data}
                    selected={selected}
                    editing={editingNoteId === item.id}
                    onCommit={(content) =>
                      actions.updateNoteContent(item.id, content)
                    }
                    onExitEdit={() => setEditingNoteId(null)}
                    onStyleChange={(style) =>
                      actions.setNoteStyle(item.id, style)
                    }
                  />
                )
              }
              if (item.kind === "image") {
                return <ImageCard image={item.data} selected={selected} />
              }
              return <BookmarkCard bookmark={item.data} selected={selected} />
            }}
          />
        </ContextMenuTrigger>
        <ContextMenuContent>
          {props.mode === "home" ? (
            <ContextMenuItem
              onClick={() =>
                openNewFolderDialog(contextPoint.x, contextPoint.y)
              }
            >
              New Board
            </ContextMenuItem>
          ) : (
            <ContextMenuItem
              onClick={() => {
                setPendingCreate(contextPoint)
                setLinkOpen(true)
              }}
            >
              Add bookmark
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          {selectedNotes.length > 0 ? (
            <>
              <div className="px-2 py-1.5">
                <p className="mb-2 text-[11px] font-medium text-black/45">
                  Note color
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => (
                    <button
                      key={color}
                      type="button"
                      aria-label={color}
                      className="size-6 rounded-full border border-black/10 transition-transform active:scale-95 hover-fine:hover:scale-105"
                      style={{ backgroundColor: NOTE_COLORS[color] }}
                      onClick={() => {
                        for (const item of selectedNotes) {
                          actions.setNoteStyle(item.id, { color })
                        }
                      }}
                    />
                  ))}
                </div>
              </div>
              <ContextMenuSeparator />
            </>
          ) : null}
          <ContextMenuItem
            disabled={!selectedOpenable}
            onClick={() => {
              const id = [...selectedIds][0]
              if (id) openItem(id)
            }}
          >
            Open
          </ContextMenuItem>
          <ContextMenuItem
            disabled={!selectedRenamable}
            onClick={() => {
              setContextTargetId([...selectedIds][0] ?? null)
              setRenameOpen(true)
            }}
          >
            Rename
          </ContextMenuItem>
          {props.mode === "folder" ? (
            <>
              <ContextMenuItem
                disabled={selectedIds.size === 0}
                onClick={() => setMoveOpen(true)}
              >
                Move to…
              </ContextMenuItem>
              <ContextMenuItem
                disabled={selectedIds.size === 0}
                onClick={() => actions.resetSizes([...selectedIds])}
              >
                Reset Size
              </ContextMenuItem>
            </>
          ) : props.mode === "home" ? (
            <ContextMenuItem
              disabled={selectedIds.size === 0}
              onClick={() => actions.resetSizes([...selectedIds])}
            >
              Reset Size
            </ContextMenuItem>
          ) : null}
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={selectedIds.size === 0}
            onClick={() => deleteSelection([...selectedIds])}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {items.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl bg-white/80 px-6 py-5 text-center shadow-sm outline outline-1 outline-black/5 backdrop-blur">
            <p className="text-[15px] font-medium text-[#202020]">
              {props.mode === "home"
                ? "Create a folder or note"
                : "Add a link or note"}
            </p>
            <p className="mt-1 text-[13px] text-black/50">
              {props.mode === "home"
                ? "Select Board or Note, click the canvas — or press ⌘N"
                : "Select Link or Note and click, or paste a URL (⌘V)"}
            </p>
          </div>
        </div>
      ) : null}

      <RenameDialog
        open={newFolderOpen}
        title="New folder"
        initialValue=""
        onOpenChange={(open) => {
          setNewFolderOpen(open)
          if (!open) {
            setPendingCreate(null)
            setTool("select")
          }
        }}
        onSubmit={(value) => {
          const point = pendingCreate ?? { x: 180, y: 160 }
          const folderItem = actions.createFolder(point.x, point.y, value)
          setSelectedIds(new Set([folderItem.id]))
          setContextTargetId(folderItem.id)
          actions.raiseZ([folderItem.id])
          setPendingCreate(null)
          setTool("select")
        }}
      />

      <RenameDialog
        open={renameOpen}
        title={
          renameTarget?.kind === "bookmark"
            ? "Rename bookmark"
            : "Rename folder"
        }
        initialValue={renameTarget?.value ?? ""}
        onOpenChange={setRenameOpen}
        onSubmit={(value) => {
          if (!renameTarget) return
          if (renameTarget.kind === "folder")
            actions.renameFolder(renameTarget.id, value)
          else actions.renameBookmark(renameTarget.id, value)
          actions.markxOnboarded()
        }}
      />

      <AddLinkDialog
        open={linkOpen}
        onOpenChange={(open) => {
          setLinkOpen(open)
          if (!open) {
            setPendingCreate(null)
            setTool("select")
          }
        }}
        onSubmit={(url) => {
          if (props.mode !== "folder") return
          const point = pendingCreate ?? { x: 200, y: 180 }
          void actions.createBookmark(props.folderId, url, point.x, point.y)
          setPendingCreate(null)
          setTool("select")
        }}
      />

      <MoveToDialog
        open={moveOpen}
        folders={state.folders.filter((f) =>
          props.mode === "folder" ? f.id !== props.folderId : true
        )}
        onOpenChange={setMoveOpen}
        onSubmit={(folderId) => {
          actions.moveBookmarks([...selectedIds], folderId)
          setSelectedIds(new Set())
          toast("Moved")
        }}
      />

      <ConfirmDeleteFolderDialog
        open={confirmFolderOpen}
        count={selectedItems.reduce((sum, item) => {
          if (item.kind !== "folder") return sum
          return (
            sum +
            countBookmarksInFolder(state.bookmarks, item.data.id) +
            state.notes.filter((note) => note.folderId === item.data.id)
              .length +
            state.images.filter((image) => image.folderId === item.data.id)
              .length
          )
        }, 0)}
        onOpenChange={setConfirmFolderOpen}
        onConfirm={confirmDeleteFolders}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void addImageFiles(e.target.files)
          }
          e.target.value = ""
        }}
      />
    </AppShell>
  )
}
