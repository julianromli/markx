import { useNavigate } from "@tanstack/react-router"
import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple"
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Board } from "@/components/markx/board"
import type { BoardApi, BoardItemModel } from "@/components/markx/board"
import type { Folder } from "@/lib/markx/types"
import { AppShell } from "@/components/markx/app-shell"
import { MobileSelectionBar } from "@/components/markx/mobile-selection-bar"
import { useCoarsePointer } from "@/hooks/use-coarse-pointer"
import { useIsMobile } from "@/hooks/use-mobile"
import type { SearchResult } from "@/components/markx/search-dialog"
import {
  requestItemFocus,
  takeItemFocusRequest,
} from "@/lib/markx/focus-request"
import { shortcutLabel } from "@/lib/platform"
import type { CreateAction } from "@/components/markx/app-shell"
import {
  AddLinkDialog,
  ConfirmDeleteFolderDialog,
  MoveToDialog,
  RenameDialog,
} from "@/components/markx/dialogs"
import { ShareDialog } from "@/components/markx/share-dialog"
import { listMySharedBoards } from "@/lib/server/shared-board"
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
import {
  clampIntoView,
  contentsOfFolders,
  describeContents,
  describeContentsSentence,
  folderContents,
  hasContents,
  moveTargets,
  openIntent,
} from "@/lib/markx/board-items"
import {
  classifyItemIds,
  selectWorkspaceItems,
} from "@/lib/markx/workspace-items"
import { cn } from "@/lib/utils"

const UNDO_TOAST_ID = "markx-undo"

type WorkspaceProps = { mode: "home" } | { mode: "folder"; folderId: string }

export function Workspace(props: WorkspaceProps) {
  const state = useMarkxState()
  const actions = useMarkxActions()
  const ingestImage = useMarkxImageIngest()
  const storeApi = useMarkxStore()
  const { initialSyncStatus, retryInitialSync } = storeApi
  const initialSyncBlocked = initialSyncStatus !== "idle"
  const navigate = useNavigate()
  const trashRef = useRef<HTMLButtonElement>(null)
  const boardApiRef = useRef<BoardApi | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  /**
   * Dialogs here open from state, not from a trigger, so Base UI has no
   * element to return focus to. Remember where focus was and give it back
   * on close; fall back to the selected item, then the board's tab stop.
   */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const rememberFocus = useCallback(() => {
    const active = document.activeElement
    returnFocusRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      !active.closest('[role="menu"]')
        ? active
        : null
  }, [])
  const dialogFinalFocus = useCallback((): HTMLElement | boolean => {
    const remembered = returnFocusRef.current
    returnFocusRef.current = null
    if (remembered?.isConnected && !remembered.hasAttribute("data-leaving")) {
      return remembered
    }
    const selectedId = [...selectedIdsRef.current][0]
    const selectedEl = selectedId
      ? document.querySelector<HTMLElement>(
          `[data-board-item="${CSS.escape(selectedId)}"]:not([data-leaving])`
        )
      : null
    return (
      selectedEl ??
      document.querySelector<HTMLElement>(
        '[data-board-item][tabindex="0"]:not([data-leaving])'
      ) ??
      true
    )
  }, [])
  const [renameOpen, setRenameOpen] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [confirmFolderOpen, setConfirmFolderOpen] = useState(false)
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([])
  const [shareOpen, setShareOpen] = useState(false)
  const [shareFolder, setShareFolder] = useState<Folder | null>(null)
  const [emptyStateMounted, setEmptyStateMounted] = useState(
    () => selectWorkspaceItems(state, props).length === 0
  )
  const [emptyStateLeaving, setEmptyStateLeaving] = useState(false)
  const emptyStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // folderId → boardId for the owner's shared boards (drives "shared" badges + dialog mode).
  const [sharedBoardByFolder, setSharedBoardByFolder] = useState<
    Map<string, string>
  >(new Map())

  useEffect(() => {
    let cancelled = false
    listMySharedBoards()
      .then((rows) => {
        if (cancelled) return
        setSharedBoardByFolder(
          new Map(rows.map((r) => [r.folderId, r.boardId]))
        )
      })
      .catch(() => {
        // Ignore — badges are decorative.
      })
    return () => {
      cancelled = true
    }
  }, [])
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
  const [touchSelectMode, setTouchSelectMode] = useState(false)
  const isMobile = useIsMobile()

  const folder =
    props.mode === "folder"
      ? state.folders.find((f) => f.id === props.folderId)
      : undefined

  const items: BoardItemModel[] = useMemo(
    () => selectWorkspaceItems(state, props),
    [props, state]
  )

  // Search may navigate here to show one item: select and center it.
  useEffect(() => {
    const id = takeItemFocusRequest((candidate) =>
      items.some((item) => item.id === candidate)
    )
    if (!id) return
    setSelectedIds(new Set([id]))
    requestAnimationFrame(() => boardApiRef.current?.centerOn(id))
  }, [items])

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (result.kind === "folder") {
        void navigate({
          to: "/folder/$folderId",
          params: { folderId: result.id },
        })
        return
      }
      requestItemFocus(result.id)
      const here =
        result.location.mode === props.mode &&
        (result.location.mode === "home" ||
          (props.mode === "folder" &&
            result.location.folderId === props.folderId))
      if (here) {
        const id = takeItemFocusRequest(() => true)
        if (!id) return
        setSelectedIds(new Set([id]))
        boardApiRef.current?.centerOn(id)
        return
      }
      if (result.location.mode === "home") void navigate({ to: "/" })
      else
        void navigate({
          to: "/folder/$folderId",
          params: { folderId: result.location.folderId },
        })
    },
    [navigate, props]
  )

  useEffect(() => {
    if (emptyStateTimerRef.current != null) {
      clearTimeout(emptyStateTimerRef.current)
      emptyStateTimerRef.current = null
    }

    if (items.length === 0) {
      setEmptyStateMounted(true)
      setEmptyStateLeaving(false)
      return
    }

    if (!emptyStateMounted) return

    setEmptyStateLeaving(true)
    emptyStateTimerRef.current = setTimeout(() => {
      emptyStateTimerRef.current = null
      setEmptyStateMounted(false)
      setEmptyStateLeaving(false)
    }, 180)

    return () => {
      if (emptyStateTimerRef.current != null) {
        clearTimeout(emptyStateTimerRef.current)
        emptyStateTimerRef.current = null
      }
    }
  }, [emptyStateMounted, items.length])

  // Folder tiles show what they contain; computed once per state change so
  // memoized board items get a primitive prop instead of the whole state.
  const folderContentLabels = useMemo(() => {
    const labels = new Map<string, string>()
    if (props.mode === "home") {
      for (const f of state.folders) {
        labels.set(f.id, describeContents(folderContents(state, f.id)))
      }
    }
    return labels
  }, [state, props.mode])

  const exitNoteEdit = useCallback(() => setEditingNoteId(null), [])
  const commitNote = useCallback(
    (id: string, content: string, session: string) =>
      actions.updateNoteContent(id, content, { session }),
    [actions]
  )

  // Bubble phase: the note editor saves its draft in the capture phase first.
  useEffect(() => {
    const flush = () => storeApi.flush({ unloading: true })
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush()
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("pagehide", flush)
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("pagehide", flush)
    }
  }, [storeApi])

  /**
   * A press on empty canvas ends note editing. iOS Safari does not blur a
   * contenteditable when you tap a non-focusable element, so do it here.
   */
  const handleBlankPress = useCallback(() => {
    if (editingNoteId == null) return
    const active = document.activeElement
    if (active instanceof HTMLElement && active.isContentEditable) active.blur()
    setEditingNoteId(null)
  }, [editingNoteId])

  const selectedItems = items.filter((i) => selectedIds.has(i.id))

  const openItem = useCallback(
    (id: string) => {
      const intent = openIntent(state, id)
      switch (intent.type) {
        case "edit-note":
          setEditingNoteId(id)
          setSelectedIds(new Set([id]))
          actions.raiseZ([id])
          return
        case "open-folder":
          void navigate({
            to: "/folder/$folderId",
            params: { folderId: intent.folderId },
          })
          return
        case "open-url":
          window.open(intent.url, "_blank", "noopener,noreferrer")
          return
        case "none":
          return
      }
    },
    [actions, navigate, state]
  )

  /** Toast with an Undo that reverts exactly this step, if still latest. */
  const toastWithUndo = useCallback(
    (message: string) => {
      const entry = actions.lastEntryId()
      // One Undo toast at a time: only the latest step can be undone, so a
      // new delete or move replaces the previous toast instead of stacking.
      toast(message, {
        id: UNDO_TOAST_ID,
        action: {
          label: "Undo",
          onClick: () => {
            if (!actions.undoEntry(entry)) {
              toast("Newer changes came after this. Use Undo to step back.")
            }
          },
        },
      })
    },
    [actions]
  )

  const performDelete = useCallback(
    (ids: string[]) => {
      const counts = actions.deleteItems(ids)
      const total =
        counts.folders + counts.bookmarks + counts.notes + counts.images
      if (total === 0) return
      if (editingNoteId && ids.includes(editingNoteId)) setEditingNoteId(null)
      setSelectedIds(new Set())
      const message =
        ids.length > 1
          ? "Deleted"
          : counts.folders > 0
            ? "Folder deleted"
            : counts.bookmarks > 0
              ? "Bookmark deleted"
              : counts.notes > 0
                ? "Note deleted"
                : "Image deleted"
      toastWithUndo(message)
    },
    [actions, editingNoteId, toastWithUndo]
  )

  const deleteSelection = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      const { folderIds } = classifyItemIds(state, ids)
      if (hasContents(contentsOfFolders(state, folderIds))) {
        // Confirm deletes exactly these ids, even if the selection changes.
        setPendingDeleteIds(ids)
        rememberFocus()
        setConfirmFolderOpen(true)
        return
      }
      performDelete(ids)
    },
    [performDelete, rememberFocus, state]
  )

  const pendingFolderIds = classifyItemIds(state, pendingDeleteIds).folderIds

  const confirmDeleteFolders = () => {
    performDelete(pendingDeleteIds)
    setPendingDeleteIds([])
  }

  /** Context-menu creation: keep the new item inside the visible area. */
  const pointInView = useCallback(
    (
      point: { x: number; y: number },
      size: { width: number; height: number }
    ) => {
      const bounds = boardApiRef.current?.getViewBounds()
      return bounds ? clampIntoView(point, size, bounds) : point
    },
    []
  )

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
      rememberFocus()
      setNewFolderOpen(true)
    },
    [rememberFocus]
  )

  const openAddLinkDialog = useCallback(
    (point?: { x: number; y: number }) => {
      pendingCreateRef.current = point ?? null
      rememberFocus()
      setLinkOpen(true)
    },
    [rememberFocus]
  )

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

  // Shortcut hints only where a keyboard is likely, with the OS modifier.
  const coarsePointer = useCoarsePointer()
  const toolsPlace = isMobile ? "Tools" : "the sidebar"
  const emptyStateHint =
    props.mode === "home"
      ? coarsePointer
        ? `Add a folder or note from ${toolsPlace}`
        : `Press ${shortcutLabel("N")} for a new folder, or add a note from ${toolsPlace}`
      : coarsePointer
        ? `Add a link or note from ${toolsPlace}`
        : `Add a note from ${toolsPlace}, or paste a URL (${shortcutLabel("V")})`

  const selectedNotes = selectedItems.filter((item) => item.kind === "note")

  const getItemLabel = useCallback(
    (item: BoardItemModel): string => {
      switch (item.kind) {
        case "folder":
          return `${item.data.name}, ${describeContents(folderContents(state, item.data.id))}, folder`
        case "bookmark":
          return item.data.description
            ? `${item.data.title}, ${item.data.description}, bookmark`
            : `${item.data.title}, bookmark`
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
    [state]
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

  const moveOptions = moveTargets(state, [...selectedIds], props)
  const canMoveSelection = moveOptions.home || moveOptions.folders.length > 0

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
      if (!bookmark) {
        toast("That does not look like a link")
        return
      }
      setSelectedIds(new Set([bookmark.id]))
    },
    onDeleteSelection: deleteSelection,
    onNewFolder: () => openNewFolderDialog(),
    onRedo: actions.redo,
    onRename: (id) => {
      setContextTargetId(id)
      rememberFocus()
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
      onShare={
        props.mode === "folder" && folder
          ? () => {
              setShareFolder(folder)
              setShareOpen(true)
            }
          : undefined
      }
      shared={!!folder && sharedBoardByFolder.has(folder.id)}
      onSearchSelect={handleSearchSelect}
    >
      <ContextMenu>
        <ContextMenuTrigger className="block h-full">
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
              onBlankPress={handleBlankPress}
              touchSelectMode={touchSelectMode}
              onRenameItem={(id) => {
                setContextTargetId(id)
                rememberFocus()
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
                  shared={
                    item.kind === "folder" && sharedBoardByFolder.has(item.id)
                  }
                  folderContentsLabel={
                    item.kind === "folder"
                      ? folderContentLabels.get(item.id)
                      : undefined
                  }
                  onCommitNote={commitNote}
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
          canMove={canMoveSelection}
          onCreateFolder={(point) =>
            openNewFolderDialog(pointInView(point, FOLDER_SIZE))
          }
          onCreateBookmark={(point) =>
            openAddLinkDialog(pointInView(point, BOOKMARK_SIZE))
          }
          onCreateNote={(point) => createNoteAt(pointInView(point, NOTE_SIZE))}
          onDelete={deleteSelection}
          onMove={() => {
            rememberFocus()
            setMoveOpen(true)
          }}
          onOpen={openItem}
          onRename={(id) => {
            setContextTargetId(id)
            rememberFocus()
            setRenameOpen(true)
          }}
          onShare={(id) => {
            const targetFolder = state.folders.find((f) => f.id === id) ?? null
            if (targetFolder) {
              setShareFolder(targetFolder)
              setShareOpen(true)
            }
          }}
          onResetSizes={actions.resetSizes}
          onSetNoteColor={(ids, color) => {
            for (const id of ids) actions.setNoteStyle(id, { color })
          }}
        />
      </ContextMenu>

      {isMobile &&
      !initialSyncBlocked &&
      !itemMoveDragging &&
      editingNoteId == null &&
      (touchSelectMode || selectedIds.size > 0) ? (
        <MobileSelectionBar
          count={selectedIds.size}
          selectMode={touchSelectMode}
          canRename={selectedRenamable}
          canMove={canMoveSelection}
          onToggleSelectMode={() => setTouchSelectMode((on) => !on)}
          onRename={() => {
            const id = [...selectedIds][0]
            if (!id) return
            setContextTargetId(id)
            rememberFocus()
            setRenameOpen(true)
          }}
          onMove={() => {
            rememberFocus()
            setMoveOpen(true)
          }}
          onDelete={() => {
            deleteSelection([...selectedIds])
            setTouchSelectMode(false)
          }}
          onDone={() => {
            setTouchSelectMode(false)
            setSelectedIds(new Set())
          }}
        />
      ) : null}

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
      ) : emptyStateMounted ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className={cn(
              "workspace-empty-state pointer-events-auto rounded-2xl bg-white/80 px-6 py-5 text-center shadow-sm outline outline-1 outline-black/5 backdrop-blur",
              emptyStateLeaving && "is-leaving"
            )}
          >
            <p className="text-[15px] font-medium text-balance text-ink">
              {props.mode === "home"
                ? "Create a folder or note"
                : "Add a link or note"}
            </p>
            <p
              className="mt-1 text-[13px] text-pretty text-ink-muted"
              suppressHydrationWarning
            >
              {emptyStateHint}
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
        finalFocus={dialogFinalFocus}
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
        finalFocus={dialogFinalFocus}
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
        finalFocus={dialogFinalFocus}
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
          if (!bookmark) return
          setSelectedIds(new Set([bookmark.id]))
          actions.raiseZ([bookmark.id])
          pendingCreateRef.current = null
        }}
      />

      <MoveToDialog
        finalFocus={dialogFinalFocus}
        open={moveOpen}
        home={moveOptions.home}
        folders={moveOptions.folders}
        onOpenChange={setMoveOpen}
        onSubmit={(target) => {
          const { moved, skipped } = actions.moveItems([...selectedIds], target)
          if (moved === 0) return
          setSelectedIds(new Set())
          setTouchSelectMode(false)
          toastWithUndo(
            skipped > 0
              ? `Moved ${moved} of ${moved + skipped} items`
              : moved === 1
                ? "Moved"
                : `Moved ${moved} items`
          )
        }}
      />

      <ConfirmDeleteFolderDialog
        finalFocus={dialogFinalFocus}
        open={confirmFolderOpen}
        contents={describeContentsSentence(
          contentsOfFolders(state, pendingFolderIds)
        )}
        folderCount={pendingFolderIds.length}
        otherCount={pendingDeleteIds.length - pendingFolderIds.length}
        onOpenChange={(open) => {
          setConfirmFolderOpen(open)
          if (!open) setPendingDeleteIds([])
        }}
        onConfirm={confirmDeleteFolders}
      />

      {shareFolder ? (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          folder={shareFolder}
          initialBoardId={sharedBoardByFolder.get(shareFolder.id) ?? null}
          onShared={(result) => {
            setSharedBoardByFolder((prev) =>
              new Map(prev).set(shareFolder.id, result.boardId)
            )
          }}
          onUnshared={() => {
            setSharedBoardByFolder((prev) => {
              const next = new Map(prev)
              next.delete(shareFolder.id)
              return next
            })
          }}
        />
      ) : null}

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
