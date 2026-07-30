import { useNavigate } from "@tanstack/react-router"
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple"
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link"
import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Board } from "@/components/markx/board"
import type { BoardApi, BoardItemModel } from "@/components/markx/board"
import { AppShell } from "@/components/markx/app-shell"
import type { CreateAction } from "@/components/markx/app-shell"
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
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  useMarkxActions,
  useMarkxImageIngest,
  useMarkxState,
  useMarkxStore,
} from "@/lib/markx/store"
import { prepareImage } from "@/lib/markx/images"
import {
  BOOKMARK_SIZE,
  FOLDER_SIZE,
  NOTE_SIZE,
  findEmptySlot,
  getBoardItemRect,
} from "@/lib/markx/geometry"
import { countBookmarksInFolder } from "@/lib/markx/state"
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
  const contextMenuTriggerRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [renameOpen, setRenameOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmFolderOpen, setConfirmFolderOpen] = useState(false)
  const pendingCreateRef = useRef<{
    x: number
    y: number
  } | null>(null)
  const [contextTargetId, setContextTargetId] = useState<string | null>(null)
  const [contextPoint, setContextPoint] = useState({ x: 180, y: 160 })
  const [zoomPercent, setZoomPercent] = useState(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768) return 50
    return 85
  })
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [trashArmed, setTrashArmed] = useState(false)
  const [itemMoveDragging, setItemMoveDragging] = useState(false)

  const folder =
    props.mode === "folder"
      ? state.folders.find((f) => f.id === props.folderId)
      : undefined

  const items: BoardItemModel[] = useMemo(
    () => selectWorkspaceItems(state, props),
    [props, state]
  )

  // Folder tiles show a bookmark count; computed once per bookmarks change so
  // memoized board items get a primitive prop instead of the whole array.
  const folderBookmarkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    if (props.mode === "home") {
      for (const bookmark of state.bookmarks) {
        counts.set(bookmark.folderId, (counts.get(bookmark.folderId) ?? 0) + 1)
      }
    }
    return counts
  }, [state.bookmarks, props.mode])

  const exitNoteEdit = useCallback(() => setEditingNoteId(null), [])

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

  const openContextMenuAt = useCallback((point: { x: number; y: number }) => {
    contextMenuTriggerRef.current?.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: point.x,
        clientY: point.y,
      })
    )
  }, [])

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
    [actions, editingNoteId, props.mode, state]
  )

  const confirmDeleteFolders = () => {
    const { folderIds } = classifyItemIds(state, [...selectedIds])
    actions.deleteFolders(folderIds)
    setSelectedIds(new Set())
    toast("Folder deleted")
  }

  /**
   * Where to drop an item the user did not point at. Resolved at the moment of
   * creation, not when a dialog opens, so it reflects the latest board state
   * (the user may have panned, or a sync may have landed, in between).
   */
  const resolveSlot = useCallback(
    (size: { width: number; height: number }) => {
      const bounds = boardApiRef.current?.getViewBounds()
      if (!bounds || bounds.width === 0 || bounds.height === 0) {
        return { x: 180, y: 160 }
      }
      return findEmptySlot(items.map(getBoardItemRect), bounds, size)
    },
    [items]
  )

  /** The folder new items belong to; null on Home. */
  const activeFolderId = props.mode === "folder" ? props.folderId : null

  const createNoteAt = useCallback(
    (point: { x: number; y: number }) => {
      const note = actions.createNote(point.x, point.y, activeFolderId)
      setSelectedIds(new Set([note.id]))
      setEditingNoteId(note.id)
      actions.raiseZ([note.id])
    },
    [actions, activeFolderId]
  )

  const openNewFolderDialog = useCallback(
    (point?: { x: number; y: number }) => {
      pendingCreateRef.current = point ?? null
      setNewFolderOpen(true)
    },
    []
  )

  const openAddLinkDialog = useCallback((point?: { x: number; y: number }) => {
    pendingCreateRef.current = point ?? null
    setLinkOpen(true)
  }, [])

  /**
   * Sidebar buttons create in one click: no armed tool, no follow-up canvas
   * click. `link` and `board` still need their dialog for the URL or name, but
   * it opens immediately rather than after a placement click.
   */
  const handleCreate = useCallback(
    (action: CreateAction) => {
      if (initialSyncBlocked) return
      if (newFolderOpen || linkOpen) return

      switch (action) {
        case "note":
          createNoteAt(resolveSlot(NOTE_SIZE))
          return
        case "link":
          if (props.mode !== "folder") return
          openAddLinkDialog()
          return
        case "board":
          if (props.mode !== "home") return
          openNewFolderDialog()
          return
        case "image":
          fileInputRef.current?.click()
          return
      }
    },
    [
      createNoteAt,
      initialSyncBlocked,
      linkOpen,
      newFolderOpen,
      openAddLinkDialog,
      openNewFolderDialog,
      props.mode,
      resolveSlot,
    ]
  )

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
          folderId: activeFolderId,
          mime: prepared.mime,
          naturalWidth: prepared.naturalWidth,
          naturalHeight: prepared.naturalHeight,
          x: center.x - 240 + cascade * 24,
          y: center.y - 160 + cascade * 24,
        })
        actions.raiseZ([created.id])
        cascade += 1
      }
    },
    [actions, activeFolderId, ingestImage]
  )

  const selectedNotes = selectedItems.filter((item) => item.kind === "note")

  const getItemLabel = useCallback(
    (item: BoardItemModel): string => {
      switch (item.kind) {
        case "folder": {
          const count = countBookmarksInFolder(state.bookmarks, item.data.id)
          return `${item.data.name}, folder, ${count} ${count === 1 ? "bookmark" : "bookmarks"}`
        }
        case "bookmark":
          return `${item.data.title}, bookmark`
        case "note": {
          const excerpt = item.data.content
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80)
          return excerpt ? `Note: ${excerpt}` : "Empty note"
        }
        case "image":
          return "Image"
      }
    },
    [state.bookmarks]
  )

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
      const point = resolveSlot(BOOKMARK_SIZE)
      const bookmark = actions.createBookmark(
        props.folderId,
        url,
        point.x,
        point.y
      )
      setSelectedIds(new Set([bookmark.id]))
    },
    onDeleteSelection: deleteSelection,
    onNewFolder: () => openNewFolderDialog(),
    onRedo: actions.redo,
    onRename: (id) => {
      setContextTargetId(id)
      setRenameOpen(true)
    },
    onResetInteraction: () => {
      setSelectedIds(new Set())
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
      mode={props.mode}
      syncBlocked={initialSyncBlocked}
      onCreate={handleCreate}
      trashRef={trashRef}
      trashArmed={trashArmed}
      itemMoveDragging={itemMoveDragging}
      zoomPercent={zoomPercent}
      onZoomPreset={(percent) => boardApiRef.current?.setZoomPercent(percent)}
      onZoomFit={() => boardApiRef.current?.fitToContent()}
    >
      <ContextMenu>
        <ContextMenuTrigger
          ref={contextMenuTriggerRef}
          className="block h-full"
          disableTouchLongPress
        >
          <TooltipProvider delay={500} closeDelay={150}>
            <Board
              items={items}
              selectedIds={selectedIds}
              onSelectedIdsChange={setSelectedIds}
              onRaiseZ={actions.raiseZ}
              onMoveItems={handleMoveItems}
              onResizeItem={handleResizeItem}
              onOpenItem={openItem}
              onTrashDrop={deleteSelection}
              trashRef={trashRef}
              onTrashArmedChange={setTrashArmed}
              onItemMoveDragChange={setItemMoveDragging}
              onZoomChange={setZoomPercent}
              onContextPoint={setContextPoint}
              onBlankDoubleTap={openContextMenuAt}
              onRenameItem={(id) => {
                setContextTargetId(id)
                setRenameOpen(true)
              }}
              getItemLabel={getItemLabel}
              editingId={editingNoteId ?? undefined}
              boardApiRef={boardApiRef}
              renderItem={(item, selected, dragging) => (
                <WorkspaceBoardItem
                  item={item}
                  selected={selected}
                  interacting={dragging}
                  editing={editingNoteId === item.id}
                  folderBookmarkCount={
                    item.kind === "folder"
                      ? (folderBookmarkCounts.get(item.id) ?? 0)
                      : undefined
                  }
                  onCommitNote={actions.updateNoteContent}
                  onExitNoteEdit={exitNoteEdit}
                  onNoteStyleChange={actions.setNoteStyle}
                />
              )}
            />
          </TooltipProvider>
        </ContextMenuTrigger>
        <WorkspaceContextMenu
          mode={props.mode}
          contextPoint={contextPoint}
          selectedIds={selectedIds}
          selectedNotes={selectedNotes}
          selectedOpenable={selectedOpenable}
          selectedRenamable={selectedRenamable}
          onCreateFolder={(point) => openNewFolderDialog(point)}
          onCreateBookmark={(point) => openAddLinkDialog(point)}
          onCreateNote={createNoteAt}
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
            <p className="text-[15px] font-medium text-ink">
              {initialSyncStatus === "loading"
                ? "Loading your workspace…"
                : "Workspace could not be loaded"}
            </p>
            <p className="mt-1 text-[13px] text-ink-muted">
              {initialSyncStatus === "loading"
                ? "Your workspace will appear as soon as cloud sync finishes."
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
          <div className="pointer-events-auto rounded-2xl bg-white/80 px-6 py-5 text-center shadow-sm outline outline-1 outline-black/5 backdrop-blur">
            <p className="text-[15px] font-medium text-balance text-ink">
              {props.mode === "home"
                ? "Create a folder or note"
                : "Add a link or note"}
            </p>
            <p className="mt-1 text-[13px] text-pretty text-ink-muted">
              {props.mode === "home"
                ? "Press ⌘N for a new folder, or add a note from the sidebar"
                : "Add a note from the sidebar, or paste a URL (⌘V)"}
            </p>
            <Button
              className="mt-4"
              disabled={initialSyncBlocked}
              onClick={() =>
                handleCreate(props.mode === "home" ? "board" : "link")
              }
            >
              {props.mode === "home" ? (
                <>
                  <FolderSimpleIcon className="size-4" weight="regular" />
                  New folder
                </>
              ) : (
                <>
                  <LinkIcon className="size-4" weight="regular" />
                  Add link
                </>
              )}
            </Button>
          </div>
        </div>
      ) : null}

      <RenameDialog
        open={newFolderOpen}
        title="New folder"
        initialValue=""
        onOpenChange={(open) => {
          setNewFolderOpen(open)
          if (!open) pendingCreateRef.current = null
        }}
        onSubmit={(value) => {
          const point = pendingCreateRef.current ?? resolveSlot(FOLDER_SIZE)
          const folderItem = actions.createFolder(point.x, point.y, value)
          setSelectedIds(new Set([folderItem.id]))
          setContextTargetId(folderItem.id)
          actions.raiseZ([folderItem.id])
          pendingCreateRef.current = null
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
          if (!open) pendingCreateRef.current = null
        }}
        onSubmit={(url) => {
          if (props.mode !== "folder") return
          const point = pendingCreateRef.current ?? resolveSlot(BOOKMARK_SIZE)
          const bookmark = actions.createBookmark(
            props.folderId,
            url,
            point.x,
            point.y
          )
          setSelectedIds(new Set([bookmark.id]))
          actions.raiseZ([bookmark.id])
          pendingCreateRef.current = null
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
          selectedItems.flatMap((item) =>
            item.kind === "folder" ? [item.id] : []
          )
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
