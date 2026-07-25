import { BookmarkCard } from "./bookmark-card"
import { FolderIcon } from "./folder-icon"
import { ImageCard } from "./image-card"
import { NoteCard } from "./note-card"

import type { BoardItemModel } from "@/lib/markx/geometry"
import { countBookmarksInFolder } from "@/lib/markx/state"
import type { Bookmark, Note } from "@/lib/markx/types"

type WorkspaceBoardItemProps = {
  item: BoardItemModel
  selected: boolean
  editingNoteId: string | null
  bookmarks: Bookmark[]
  onCommitNote: (id: string, content: string) => void
  onExitNoteEdit: () => void
  onNoteStyleChange: (
    id: string,
    style: Partial<Pick<Note, "color" | "font" | "fontSize">>
  ) => void
}

export function WorkspaceBoardItem({
  item,
  selected,
  editingNoteId,
  bookmarks,
  onCommitNote,
  onExitNoteEdit,
  onNoteStyleChange,
}: WorkspaceBoardItemProps) {
  if (item.kind === "folder") {
    return (
      <FolderIcon
        name={item.data.name}
        count={countBookmarksInFolder(bookmarks, item.data.id)}
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
        onCommit={(content) => onCommitNote(item.id, content)}
        onExitEdit={onExitNoteEdit}
        onStyleChange={(style) => onNoteStyleChange(item.id, style)}
      />
    )
  }
  if (item.kind === "image") {
    return <ImageCard image={item.data} selected={selected} />
  }
  return <BookmarkCard bookmark={item.data} selected={selected} />
}
