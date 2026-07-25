import { useNavigate } from "@tanstack/react-router"
import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Board } from "@/components/markx/board"
import type { BoardApi, BoardItemModel } from "@/components/markx/board"
import { AppShell } from "@/components/markx/app-shell"
import {
  AddLinkDialog,
  ConfirmDeleteFolderDialog,
  MoveToDialog,
  RenameDialog,
} from "@/components/markx/dialogs"
import { useWorkspaceGlobalEvents } from "@/components/markx/use-workspace-global-events"
import { WorkspaceBoardItem } from "@/components/markx/workspace-board-item"
import { WorkspaceContextMenu } from "@/components/markx/workspace-context-menu"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Button } from "@/components/ui/button"
import {
  useMarkxActions,
  useMarkxImageIngest,
  useMarkxState,
  useMarkxStore,
} from "@/lib/markx/store"
import { prepareImage } from "@/lib/markx/images"
import type { ToolId } from "@/lib/markx/types"
import {
  classifyItemIds,
  countItemsInFolders,
  folderHasItems,
  selectWorkspaceItems,
} from "@/lib/markx/workspace-items"

type WorkspaceProps = { mode: "home" } | { mode: "folder"; folderId: string }

export function Workspace(props: WorkspaceProps) {
  const state = useMarkxState()
  const actions = useMarkxActions()
  const ingestImage = useMarkxImageIngest()
  const { initialSyncStatus, retryInitialSync } = useMarkxStore()
  const initialSyncBlocked = initialSyncStatus !== "idle"
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

  const items: BoardItemModel[] = useMemo(
    () => selectWorkspaceItems(state, props),
    [props, state]
  )

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

      const { folderIds, bookmarkIds, noteIds, imageIds } = classifyItemIds(
        state,
        ids
      )

      if (props.mode === "home") {
        const nonempty = folderIds.filter((id) => folderHasItems(state, id))
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
    const { folderIds } = classifyItemIds(state, [...selectedIds])
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
        const created = await ingestImage({
          blob: prepared.blob,
          folderId,
          mime: prepared.mime,
          naturalWidth: prepared.naturalWidth,
          naturalHeight: prepared.naturalHeight,
          x: center.x - 240 + cascade * 24,
          y: center.y - 160 + cascade * 24,
        })
        actions.raiseZ([created.id])
        cascade += 1
      }
      setTool("select")
    },
    [actions, ingestImage, props]
  )

  const selectedNotes = selectedItems.filter((item) => item.kind === "note")
  const selectedItem = selectedItems.at(0)
  const selectedRenamable =
    selectedIds.size === 1 &&
    selectedItem != null &&
    selectedItem.kind !== "note" &&
    selectedItem.kind !== "image"
  const selectedOpenable =
    selectedIds.size === 1 &&
    selectedItem != null &&
    selectedItem.kind !== "note" &&
    selectedItem.kind !== "image"

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

  useWorkspaceGlobalEvents({
    blocked: initialSyncBlocked,
    editing: editingNoteId != null,
    mode: props.mode,
    selectedIds,
    selectedRenamable,
    onAddImages: addImageFiles,
    onCreateBookmark: (url) => {
      if (props.mode !== "folder") return
      void actions.createBookmark(props.folderId, url, 200, 180)
      setTool("select")
    },
    onDeleteSelection: deleteSelection,
    onNewFolder: () => openNewFolderDialog(180, 160),
    onRedo: actions.redo,
    onRename: (id) => {
      setContextTargetId(id)
      setRenameOpen(true)
    },
    onResetInteraction: () => {
      setSelectedIds(new Set())
      setTool("select")
      setEditingNoteId(null)
    },
    onUndo: actions.undo,
    onNewFolderUnavailable: () => toast("Folders are created on Home"),
    onPasteUrlAtHome: () => toast("Open a folder to add links"),
  })

  if (props.mode === "folder" && !folder && !initialSyncBlocked) {
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
      onToolChange={initialSyncBlocked ? () => {} : setTool}
      trashRef={trashRef}
      zoomPercent={zoomPercent}
      onImageTool={
        initialSyncBlocked ? () => {} : () => fileInputRef.current?.click()
      }
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
            renderItem={(item, selected) => (
              <WorkspaceBoardItem
                item={item}
                selected={selected}
                editingNoteId={editingNoteId}
                bookmarks={state.bookmarks}
                onCommitNote={actions.updateNoteContent}
                onExitNoteEdit={() => setEditingNoteId(null)}
                onNoteStyleChange={actions.setNoteStyle}
              />
            )}
          />
        </ContextMenuTrigger>
        <WorkspaceContextMenu
          mode={props.mode}
          contextPoint={contextPoint}
          selectedIds={selectedIds}
          selectedNotes={selectedNotes}
          selectedOpenable={selectedOpenable}
          selectedRenamable={selectedRenamable}
          onCreateFolder={(point) => openNewFolderDialog(point.x, point.y)}
          onCreateBookmark={(point) => {
            setPendingCreate(point)
            setLinkOpen(true)
          }}
          onDelete={deleteSelection}
          onMove={() => setMoveOpen(true)}
          onOpen={openItem}
          onRename={(id) => {
            setContextTargetId(id)
            setRenameOpen(true)
          }}
          onResetSizes={actions.resetSizes}
          onSetNoteColor={(ids, color) => {
            for (const id of ids) actions.setNoteStyle(id, { color })
          }}
        />
      </ContextMenu>

      {initialSyncBlocked ? (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-white/35 backdrop-blur-[2px]"
          aria-busy={initialSyncStatus === "loading"}
          role="status"
        >
          <div className="max-w-sm rounded-2xl bg-white/90 px-6 py-5 text-center shadow-sm outline outline-1 outline-black/5">
            <p className="text-[15px] font-medium text-[#202020]">
              {initialSyncStatus === "loading"
                ? "Loading your workspace…"
                : "Workspace could not be loaded"}
            </p>
            <p className="mt-1 text-[13px] text-black/50">
              {initialSyncStatus === "loading"
                ? "Your boards will appear as soon as cloud sync finishes."
                : "Check your connection and try again. Editing stays disabled to protect your cloud data."}
            </p>
            {initialSyncStatus === "error" ? (
              <Button className="mt-4" onClick={retryInitialSync}>
                Try again
              </Button>
            ) : null}
          </div>
        </div>
      ) : items.length === 0 ? (
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
        count={countItemsInFolders(
          state,
          selectedItems
            .filter((item) => item.kind === "folder")
            .map((item) => item.id)
        )}
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
