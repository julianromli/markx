export type ToolId = "select" | "link" | "board" | "note"

export type Folder = {
  id: string
  name: string
  x: number
  y: number
  z: number
}

export type Bookmark = {
  id: string
  folderId: string
  url: string
  title: string
  description?: string
  imageUrl?: string
  faviconUrl?: string
  x: number
  y: number
  z: number
  width?: number
  height?: number
}

export type NoteColor =
  | "yellow"
  | "blue"
  | "pink"
  | "green"
  | "orange"
  | "purple"

export type NoteFont = "sans" | "serif" | "mono" | "hand"

export type NoteSize = "s" | "m" | "l" | "xl"

export type Note = {
  id: string
  folderId: string | null
  content: string
  color: NoteColor
  font: NoteFont
  fontSize: NoteSize
  x: number
  y: number
  z: number
  width?: number
  height?: number
}

export type BoardImage = {
  id: string
  folderId: string | null
  imageId: string
  mime: string
  naturalWidth: number
  naturalHeight: number
  x: number
  y: number
  z: number
  width?: number
  height?: number
}

export type MarkxState = {
  folders: Folder[]
  bookmarks: Bookmark[]
  notes: Note[]
  images: BoardImage[]
  hasOnboarded: boolean
  zCounter: number
}

export type BoardItem =
  | { kind: "folder"; data: Folder }
  | { kind: "bookmark"; data: Bookmark }
  | { kind: "note"; data: Note }
  | { kind: "image"; data: BoardImage }

export type LinkMetadata = {
  title: string
  description?: string
  imageUrl?: string
  faviconUrl?: string
}
