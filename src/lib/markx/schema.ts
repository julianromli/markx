import { z } from "zod"

/**
 * Runtime Zod schemas mirroring the TypeScript types in `types.ts`.
 *
 * Used at server-function boundaries to validate workspace state instead
 * of trusting `z.any()` + casts. Keep these in sync with the types.
 */

const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
})

const bookmarkSchema = z.object({
  id: z.string(),
  folderId: z.string(),
  url: z.string(),
  title: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  faviconUrl: z.string().optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
})

const noteColorSchema = z.enum([
  "yellow",
  "blue",
  "pink",
  "green",
  "orange",
  "purple",
])

const noteFontSchema = z.enum(["sans", "serif", "mono", "hand"])
const noteSizeSchema = z.enum(["s", "m", "l", "xl"])

const noteSchema = z.object({
  id: z.string(),
  folderId: z.string().nullable(),
  content: z.string(),
  color: noteColorSchema,
  font: noteFontSchema,
  fontSize: noteSizeSchema,
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
})

const boardImageSchema = z.object({
  id: z.string(),
  folderId: z.string().nullable(),
  imageId: z.string(),
  mime: z.string(),
  naturalWidth: z.number(),
  naturalHeight: z.number(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
})

export const markxStateSchema = z.object({
  folders: z.array(folderSchema),
  bookmarks: z.array(bookmarkSchema),
  notes: z.array(noteSchema),
  images: z.array(boardImageSchema),
  hasOnboarded: z.boolean(),
  zCounter: z.number(),
})
