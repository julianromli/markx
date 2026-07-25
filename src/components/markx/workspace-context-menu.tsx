import { NoteColorChoices } from "./note-color-choices"

import {
  ArrowBendUpRightIcon,
  ArrowSquareOutIcon,
  CornersInIcon,
  FolderSimpleIcon,
  LinkIcon,
  NoteBlankIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react"

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu"
import type { BoardItemModel } from "@/lib/markx/geometry"

type WorkspaceContextMenuProps = {
  mode: "home" | "folder"
  contextPoint: { x: number; y: number }
  selectedIds: Set<string>
  selectedNotes: Extract<BoardItemModel, { kind: "note" }>[]
  selectedOpenable: boolean
  selectedRenamable: boolean
  onCreateFolder: (point: { x: number; y: number }) => void
  onCreateBookmark: (point: { x: number; y: number }) => void
  onCreateNote: (point: { x: number; y: number }) => void
  onDelete: (ids: string[]) => void
  onMove: () => void
  onOpen: (id: string) => void
  onRename: (id: string) => void
  onResetSizes: (ids: string[]) => void
  onSetNoteColor: (
    ids: string[],
    color: Extract<BoardItemModel, { kind: "note" }>["data"]["color"]
  ) => void
}

export function WorkspaceContextMenu({
  mode,
  contextPoint,
  selectedIds,
  selectedNotes,
  selectedOpenable,
  selectedRenamable,
  onCreateFolder,
  onCreateBookmark,
  onCreateNote,
  onDelete,
  onMove,
  onOpen,
  onRename,
  onResetSizes,
  onSetNoteColor,
}: WorkspaceContextMenuProps) {
  const ids = [...selectedIds]
  return (
    <ContextMenuContent>
      {/* Right-click carries an explicit location, so these place at the cursor
          rather than using the sidebar's automatic slot placement. */}
      {mode === "home" ? (
        <ContextMenuItem onClick={() => onCreateFolder(contextPoint)}>
          <FolderSimpleIcon weight="regular" />
          New Board
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onClick={() => onCreateBookmark(contextPoint)}>
          <LinkIcon weight="regular" />
          Add bookmark
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => onCreateNote(contextPoint)}>
        <NoteBlankIcon weight="regular" />
        New Note
      </ContextMenuItem>
      <ContextMenuSeparator />
      {selectedNotes.length > 0 ? (
        <>
          <div className="px-2 py-1.5">
            <p className="mb-2 text-[11px] font-medium text-black/45">
              Note color
            </p>
            <NoteColorChoices
              size="large"
              onSelect={(color) =>
                onSetNoteColor(
                  selectedNotes.map((item) => item.id),
                  color
                )
              }
            />
          </div>
          <ContextMenuSeparator />
        </>
      ) : null}
      <ContextMenuItem
        disabled={!selectedOpenable}
        onClick={() => {
          const id = ids[0]
          if (id) onOpen(id)
        }}
      >
        <ArrowSquareOutIcon weight="regular" />
        Open
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!selectedRenamable}
        onClick={() => {
          const id = ids[0]
          if (id) onRename(id)
        }}
      >
        <PencilSimpleIcon weight="regular" />
        Rename
      </ContextMenuItem>
      {mode === "folder" ? (
        <ContextMenuItem disabled={ids.length === 0} onClick={onMove}>
          <ArrowBendUpRightIcon weight="regular" />
          Move to…
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem
        disabled={ids.length === 0}
        onClick={() => onResetSizes(ids)}
      >
        <CornersInIcon weight="regular" />
        Reset Size
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={ids.length === 0}
        onClick={() => onDelete(ids)}
      >
        <TrashIcon weight="regular" />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
