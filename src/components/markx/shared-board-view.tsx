import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Board } from "@/components/markx/board"
import type { BoardApi } from "@/components/markx/board"
import { WorkspaceBoardItem } from "@/components/markx/workspace-board-item"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { SignInIcon } from "@phosphor-icons/react/dist/csr/SignIn"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft"
import { selectWorkspaceItems } from "@/lib/markx/workspace-items"
import { nextZ } from "@/lib/markx/state"
import { SharedBoardSyncEngine } from "@/lib/markx/shared-board-sync"
import type { SharedBoardSnapshot } from "@/lib/markx/shared-board"
import { useAuthSession } from "@/lib/markx/hooks"
import { openExternalUrl } from "@/lib/markx/open-url"
import type {
  MarkxState,
  Note,
} from "@/lib/markx/types"
import type { BoardItemModel } from "@/lib/markx/geometry"

type SharedBoardViewProps = {
  snapshot: SharedBoardSnapshot
  /** The token used to load this snapshot (for duplicate). */
  token: string
  /** "view" = read-only public; "edit" = optimistic editable. */
  mode: "view" | "edit"
  /** Show the "Duplicate to my workspace" button. Default true. */
  showDuplicate?: boolean
  /**
   * When set, shows a "Log in to edit" button (top-right) that calls
   * this. Used for an anonymous visitor holding an edit-enabled link
   * who dismissed the login modal.
   */
  onRequestEdit?: () => void
  /** When set, shows a back button (top-left) that calls this. */
  onBack?: () => void
}

/**
 * Render a shared board. Reuses the canvas `Board` with a local state.
 * In "view" mode all edit callbacks are no-ops (read-only). In "edit"
 * mode a SharedBoardSyncEngine debounces optimistic saves.
 */
export function SharedBoardView({ snapshot, token, mode, showDuplicate = true, onRequestEdit, onBack }: SharedBoardViewProps) {
  const folderId = snapshot.state.folders.at(0)?.id ?? ""
  const [state, setState] = useState<MarkxState>(() => snapshot.state)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const boardApiRef = useRef<BoardApi | null>(null)
  const trashRef = useRef<HTMLButtonElement>(null)
  // Pending sync flushed after the state commit (keeps the setState updater pure).
  const pendingSync = useRef<{
    state: MarkxState
    deletedImageIds: string[]
  } | null>(null)

  const editable = mode === "edit"

  useLayoutEffect(() => {
    if (!pendingSync.current) return
    const { state: next, deletedImageIds } = pendingSync.current
    pendingSync.current = null
    syncEngine?.onStateChange(next, deletedImageIds)
  })

  // Editable: sync engine backed by the saveSharedBoard server fn.
  const syncEngine = useMemo<SharedBoardSyncEngine | null>(() => {
    if (!editable) return null
    return new SharedBoardSyncEngine(snapshot.boardId, state, snapshot.version, {
      save: async (input) => {
        const { saveSharedBoard } = await import("@/lib/server/shared-board")
        return saveSharedBoard({ data: input })
      },
    })
  }, [editable])

  useEffect(() => {
    return () => {
      void syncEngine?.flushAndDestroy()
    }
  }, [syncEngine])

  // Subscribe to sync status; auto-adopt cloud state on conflict (cloud-wins).
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (!syncEngine) return
    return syncEngine.subscribe((_status, _conflict, authoritative) => {
      if (authoritative) setState(authoritative)
      forceRender((n) => n + 1)
    })
  }, [syncEngine])

  useEffect(() => {
    if (!syncEngine) return
    if (syncEngine.getConflict()) {
      void syncEngine.resolveConflictUseCloud().then((cloud) => {
        setState(cloud)
        toast.message("Another editor updated this board. Showing the latest.")
      })
    }
  }, [syncEngine])

  const items = useMemo(
    () => selectWorkspaceItems(state, { mode: "folder", folderId }),
    [state, folderId]
  )

  const handleMoveItems = useCallback(
    (updates: Array<{ id: string; x: number; y: number }>) => {
      if (!editable || updates.length === 0) return
      const map = new Map(updates.map((u) => [u.id, u]))
      setState((prev) => {
        const next = moveItems(prev, map)
        pendingSync.current = { state: next, deletedImageIds: [] }
        return next
      })
    },
    [editable]
  )

  const handleResizeItem = useCallback(
    (
      id: string,
      rect: { x: number; width: number; height: number }
    ) => {
      if (!editable) return
      setState((prev) => {
        const next = resizeItem(prev, id, rect)
        pendingSync.current = { state: next, deletedImageIds: [] }
        return next
      })
    },
    [editable]
  )

  const handleTrashDrop = useCallback(
    (ids: string[]) => {
      if (!editable || ids.length === 0) return
      const idSet = new Set(ids)
      setState((prev) => {
        const next = deleteItems(prev, idSet)
        const deletedImageIds = prev.images
          .filter((i) => idSet.has(i.id))
          .map((i) => i.imageId)
        pendingSync.current = { state: next, deletedImageIds }
        return next
      })
      setSelectedIds(new Set())
    },
    [editable]
  )

  const handleCommitNote = useCallback(
    (id: string, content: string) => {
      if (!editable) return
      setState((prev) => {
        const next = {
          ...prev,
          notes: prev.notes.map((n) => (n.id === id ? { ...n, content } : n)),
        }
        pendingSync.current = { state: next, deletedImageIds: [] }
        return next
      })
    },
    [editable]
  )

  const handleNoteStyleChange = useCallback(
    (id: string, style: Partial<Pick<Note, "color" | "font" | "fontSize">>) => {
      if (!editable) return
      setState((prev) => {
        const next = {
          ...prev,
          notes: prev.notes.map((n) => (n.id === id ? { ...n, ...style } : n)),
        }
        pendingSync.current = { state: next, deletedImageIds: [] }
        return next
      })
    },
    [editable]
  )

  const handleRaiseZ = useCallback(
    (ids: string[]) => {
      if (!editable || ids.length === 0) return
      setState((prev) => {
        const { z, zCounter } = nextZ(prev)
        const idSet = new Set(ids)
        const next = raiseZ(prev, idSet, z, zCounter)
        pendingSync.current = { state: next, deletedImageIds: [] }
        return next
      })
    },
    [editable]
  )

  const handleOpenItem = useCallback(
    (id: string) => {
      const item = items.find((i) => i.id === id)
      if (item?.kind === "bookmark") {
        openExternalUrl(item.data.url)
      }
    },
    [items]
  )

  // Duplicate into the logged-in viewer's own workspace.
  const session = useAuthSession()
  const [duplicating, setDuplicating] = useState(false)
  const handleDuplicate = useCallback(async () => {
    if (!session.user) {
      toast.message("Log in to duplicate this board to your workspace.")
      return
    }
    setDuplicating(true)
    try {
      const { loadWorkspace } = await import("@/lib/server/workspace")
      const ws = await loadWorkspace()
      if (!ws) {
        toast.error("Could not load your workspace.")
        return
      }
      const { duplicateSharedBoardToWorkspace } = await import(
        "@/lib/server/shared-board"
      )
      const result = await duplicateSharedBoardToWorkspace({
        data: { token, baseVersion: ws.version },
      })
      if (result.ok) {
        toast.success("Board duplicated to your workspace.")
      } else if (result.reason === "conflict") {
        toast.error("Your workspace changed. Try again.")
      } else {
        toast.error(result.message)
      }
    } catch {
      toast.error("Could not duplicate.")
    } finally {
      setDuplicating(false)
    }
  }, [session.user, token])

  const renderItem = useCallback(
    (item: BoardItemModel, selected: boolean, dragging: boolean) => (
      <WorkspaceBoardItem
        item={item}
        selected={selected}
        interacting={dragging}
        editing={editable && editingNoteId === item.id}
        onCommitNote={handleCommitNote}
        onExitNoteEdit={() => setEditingNoteId(null)}
        onNoteStyleChange={handleNoteStyleChange}
      />
    ),
    [editable, editingNoteId, handleCommitNote, handleNoteStyleChange]
  )

  return (
    <div className="relative h-svh w-svw overflow-hidden bg-white">
      <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-xl bg-white/85 px-3 py-2 text-sm shadow-sm outline outline-1 outline-black/5 backdrop-blur">
        {onBack ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 shrink-0"
            onClick={onBack}
            aria-label="Back to canvas"
          >
            <ArrowLeftIcon className="size-4" weight="regular" />
          </Button>
        ) : null}
        <span className="text-base font-medium">{snapshot.title}</span>
        <span className="text-ink-muted">
          {editable ? "· shared board" : "· read-only"}
        </span>
      </div>
      {showDuplicate && session.user ? (
        <Button
          variant="outline"
          size="sm"
          className="absolute right-3 top-3 z-30"
          onClick={handleDuplicate}
          disabled={duplicating}
        >
          {duplicating ? <Spinner /> : null}
          Duplicate to my workspace
        </Button>
      ) : null}
      {onRequestEdit ? (
        <Button
          variant="outline"
          size="sm"
          className="absolute right-3 top-3 z-30"
          onClick={onRequestEdit}
        >
          <SignInIcon className="size-4" weight="regular" />
          Log in to edit
        </Button>
      ) : null}
      <Board
        items={items}
        selectedIds={selectedIds}
        onSelectedIdsChange={editable ? setSelectedIds : () => {}}
        onRaiseZ={handleRaiseZ}
        onMoveItems={handleMoveItems}
        onResizeItem={handleResizeItem}
        onOpenItem={handleOpenItem}
        onTrashDrop={handleTrashDrop}
        renderItem={renderItem}
        trashRef={trashRef}
        editingId={editingNoteId ?? undefined}
        boardApiRef={boardApiRef}
        itemGesturesEnabled={editable}
      />
    </div>
  )
}

/* ---------------- pure state transforms ---------------- */

function moveItems(
  state: MarkxState,
  map: Map<string, { x: number; y: number }>
): MarkxState {
  const apply = <T extends { id: string; x: number; y: number }>(arr: T[]): T[] =>
    arr.map((it) => {
      const u = map.get(it.id)
      return u ? { ...it, x: u.x, y: u.y } : it
    })
  return {
    ...state,
    bookmarks: apply(state.bookmarks),
    notes: apply(state.notes),
    images: apply(state.images),
  }
}

function resizeItem(
  state: MarkxState,
  id: string,
  rect: { x: number; width: number; height: number }
): MarkxState {
  const patch = <T extends { id: string; x: number; width?: number; height?: number }>(
    arr: T[]
  ): T[] =>
    arr.map((it) =>
      it.id === id
        ? { ...it, x: rect.x, width: rect.width, height: rect.height }
        : it
    )
  return {
    ...state,
    bookmarks: patch(state.bookmarks),
    notes: patch(state.notes),
    images: patch(state.images),
  }
}

function deleteItems(state: MarkxState, idSet: Set<string>): MarkxState {
  const keep = <T extends { id: string }>(arr: T[]): T[] =>
    arr.filter((it) => !idSet.has(it.id))
  return {
    ...state,
    bookmarks: keep(state.bookmarks),
    notes: keep(state.notes),
    images: keep(state.images),
    folders: keep(state.folders),
  }
}

function raiseZ(
  state: MarkxState,
  idSet: Set<string>,
  z: number,
  zCounter: number
): MarkxState {
  const bump = <T extends { id: string; z: number }>(arr: T[]): T[] =>
    arr.map((it) => (idSet.has(it.id) ? { ...it, z } : it))
  return {
    ...state,
    zCounter,
    bookmarks: bump(state.bookmarks),
    notes: bump(state.notes),
    images: bump(state.images),
    folders: bump(state.folders),
  }
}
