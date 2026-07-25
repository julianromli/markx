import { sql } from "drizzle-orm"
import {
  jsonb,
  pgTable,
  text,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core"

/**
 * One workspace row per Neon Auth user.
 *
 * The entire board state (folders, bookmarks, notes, image metadata) is
 * stored as a single versioned JSONB snapshot. This mirrors the in-memory
 * `MarkxState` aggregate and keeps undo/redo, optimistic versioning, and
 * offline replay simple. Normalised tables can be added later for
 * collaboration or cross-item queries without migrating this core.
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    state: jsonb("state").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [uniqueIndex("workspaces_user_id_idx").on(table.userId)]
)

/**
 * Asset lifecycle table for private R2 objects.
 *
 * Stores the R2 object key, owner, and soft-delete timestamp. The cron
 * trigger (daily at 03:00 UTC) deletes R2 objects whose `deletedAt` is
 * older than 7 days, then removes the row. Active images have
 * `deletedAt IS NULL`.
 */
export const assets = pgTable(
  "assets",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id").notNull(),
    objectKey: text("object_key").notNull(),
    mime: text("mime").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("assets_user_id_idx").on(table.userId),
    index("assets_deleted_at_idx").on(table.deletedAt),
  ]
)

export type Workspace = typeof workspaces.$inferSelect
export type NewWorkspace = typeof workspaces.$inferInsert
export type Asset = typeof assets.$inferSelect
export type NewAsset = typeof assets.$inferInsert
