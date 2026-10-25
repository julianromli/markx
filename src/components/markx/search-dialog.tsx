import { FolderSimpleIcon } from "@phosphor-icons/react/dist/csr/FolderSimple"
import { LinkIcon } from "@phosphor-icons/react/dist/csr/Link"
import { NoteBlankIcon } from "@phosphor-icons/react/dist/csr/NoteBlank"

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { filterByKeywords, noteText } from "@/lib/markx/search"
import { useMarkxState } from "@/lib/markx/store"
import type { WorkspaceLocation } from "@/lib/markx/workspace-items"

export type SearchResult = {
  id: string
  kind: "folder" | "bookmark" | "note"
  location: WorkspaceLocation
}

/** Search folders, bookmarks (title and URL), and notes (text). */
export function SearchDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (result: SearchResult) => void
}) {
  const state = useMarkxState()
  const folderName = new Map(state.folders.map((f) => [f.id, f.name]))
  const pick = (result: SearchResult) => {
    onOpenChange(false)
    onSelect(result)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search folders, bookmarks, and notes"
    >
      <Command filter={filterByKeywords}>
        <CommandInput placeholder="Search folders, bookmarks, notes…" />
        {/* Fits in the visible area below the palette's top, keyboard open or not. */}
        <CommandList className="max-h-[min(18rem,calc(var(--vv-height,100dvh)*2/3-6rem))]">
          <CommandEmpty>Nothing found.</CommandEmpty>
          {state.folders.length > 0 ? (
            <CommandGroup heading="Folders">
              {state.folders.map((folder) => (
                <CommandItem
                  key={folder.id}
                  value={`folder:${folder.id}`}
                  keywords={[folder.name]}
                  onSelect={() =>
                    pick({
                      id: folder.id,
                      kind: "folder",
                      location: { mode: "home" },
                    })
                  }
                >
                  <FolderSimpleIcon />
                  {folder.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {state.bookmarks.length > 0 ? (
            <CommandGroup heading="Bookmarks">
              {state.bookmarks.map((bookmark) => (
                <CommandItem
                  key={bookmark.id}
                  value={`bookmark:${bookmark.id}`}
                  keywords={[bookmark.title, bookmark.url]}
                  onSelect={() =>
                    pick({
                      id: bookmark.id,
                      kind: "bookmark",
                      location: { mode: "folder", folderId: bookmark.folderId },
                    })
                  }
                >
                  <LinkIcon />
                  <span className="min-w-0 flex-1 truncate">
                    {bookmark.title}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {folderName.get(bookmark.folderId)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
          {state.notes.length > 0 ? (
            <CommandGroup heading="Notes">
              {state.notes.map((note) => {
                const text = noteText(note.content) || "Empty note"
                return (
                  <CommandItem
                    key={note.id}
                    value={`note:${note.id}`}
                    keywords={[text]}
                    onSelect={() =>
                      pick({
                        id: note.id,
                        kind: "note",
                        location:
                          note.folderId == null
                            ? { mode: "home" }
                            : { mode: "folder", folderId: note.folderId },
                      })
                    }
                  >
                    <NoteBlankIcon />
                    <span className="min-w-0 flex-1 truncate">{text}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {note.folderId ? folderName.get(note.folderId) : "Home"}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
