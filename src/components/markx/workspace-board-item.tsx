import { memo } from "react"

import { BookmarkCard } from "./bookmark-card"
import { FolderIcon } from "./folder-icon"
import { ImageCard } from "./image-card"
import { NoteCard } from "./note-card"

import type { BoardItemModel } from "@/lib/markx/geometry"
import type { Note } from "@/lib/markx/types"

type WorkspaceBoardItemProps = {
  item: BoardItemModel
  selected: boolean
  /** True while this item is being dragged or resized on the board. */
  interacting?: boolean
  /** True while this item's note editor is open. */
  editing: boolean
  /** Bookmark count shown on folder tiles (home board only). */
  folderBookmarkCount?: number
  onCommitNote: (id: string, content: string) => void
  onExitNoteEdit: () => void
  onNoteStyleChange: (
    id: string,
    style: Partial<Pick<Note, "color" | "font" | "fontSize">>
  ) => void
}

/**
 * Memoized so board gestures (drag/resize re-render the whole board per
 * frame) and unrelated store commits don't re-render every card. Item
 * wrappers are rebuilt by selectors on each state change, so the comparator
 * keys on the stable `data` entity reference instead of the wrapper.
 */
export const WorkspaceBoardItem = memo(
  function WorkspaceBoardItem({
    item,
    selected,
    interacting = false,
    editing,
    folderBookmarkCount = 0,
    onCommitNote,
    onExitNoteEdit,
    onNoteStyleChange,
  }: WorkspaceBoardItemProps) {
    if (item.kind === "folder") {
      return (
        <FolderIcon
          name={item.data.name}
          count={folderBookmarkCount}
          selected={selected}
        />
      )
    }
    if (item.kind === "note") {
      return (
        <NoteCard
          note={item.data}
          selected={selected}
          editing={editing}
          onCommit={(content) => onCommitNote(item.id, content)}
          onExitEdit={onExitNoteEdit}
          onStyleChange={(style) => onNoteStyleChange(item.id, style)}
        />
      )
    }
    if (item.kind === "image") {
      return <ImageCard image={item.data} selected={selected} />
    }
    return (
      <BookmarkCard
        bookmark={item.data}
        selected={selected}
        interacting={interacting}
      />
    )
  },
  (prev, next) =>
    prev.item.kind === next.item.kind &&
    prev.item.data === next.item.data &&
    prev.selected === next.selected &&
    prev.interacting === next.interacting &&
    prev.editing === next.editing &&
    prev.folderBookmarkCount === next.folderBookmarkCount &&
    prev.onCommitNote === next.onCommitNote &&
    prev.onExitNoteEdit === next.onExitNoteEdit &&
    prev.onNoteStyleChange === next.onNoteStyleChange
)
