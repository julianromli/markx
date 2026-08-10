import { sql } from "drizzle-orm"
import {
  boolean,
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

/**
 * Billing state for a Neon Auth user (one row per user).
 *
 * `plan` is derived from Mayar membership status and webhook events.
 * `email` is denormalized for webhook matching when only the Mayar
 * customer email is available.
 */
export const userSubscriptions = pgTable("user_subscriptions", {
  userId: text("user_id").primaryKey().notNull(),
  email: text("email").notNull(),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("inactive"),
  mayarMemberId: text("mayar_member_id"),
  mayarCustomerId: text("mayar_customer_id"),
  /** Current-term membership invoice transaction; paid proof is re-fetched via API. */
  mayarTransactionId: text("mayar_transaction_id"),
  /** Last time Mayar was re-checked; throttles verify-on-read calls. */
  mayarCheckedAt: timestamp("mayar_checked_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
})

/**
 * Idempotent webhook processing — one row per Mayar transaction ID.
 */
export const mayarProcessedTransactions = pgTable(
  "mayar_processed_transactions",
  {
    transactionId: text("transaction_id").primaryKey().notNull(),
    userId: text("user_id"),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  }
)

export type UserSubscription = typeof userSubscriptions.$inferSelect
export type MayarProcessedTransaction =
  typeof mayarProcessedTransactions.$inferSelect

/**
 * A board shared by an owner with other users or via a public link.
 *
 * Live-reference model (Milanote-style): the folder and its items
 * STAY in the owner's workspace JSONB blob. This row only stores
 * the sharing metadata (which folder, links, members) plus a
 * per-board version for optimistic editor saves. The owner keeps
 * opening and editing the folder normally in their own workspace.
 */
export const sharedBoards = pgTable(
  "shared_boards",
  {
    id: text("id").primaryKey().notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    /** Denormalized at creation so members can see who shared with them. */
    ownerEmail: text("owner_email").notNull(),
    /** The shared folder's id in the owner's workspace blob. */
    folderId: text("folder_id").notNull(),
    title: text("title").notNull(),
    /** Per-board optimistic version for editor saves. */
    version: integer("version").notNull().default(1),
    /** Total public views. Incremented once per browser session by the view API. */
    viewCount: integer("view_count").notNull().default(0),
    /** Most recent anonymous viewer seeds, newest first. Capped by the view API. */
    recentViewerSeeds: jsonb("recent_viewer_seeds")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("shared_boards_owner_user_id_idx").on(table.ownerUserId),
    uniqueIndex("shared_boards_owner_user_id_folder_id_idx").on(
      table.ownerUserId,
      table.folderId
    ),
  ]
)

/**
 * Explicit members of a shared board (editors). Viewers do not need a row —
 * they access via a public view link. The owner is implied by
 * `sharedBoards.ownerUserId` and does not need a member row.
 */
export const sharedBoardMembers = pgTable(
  "shared_board_members",
  {
    boardId: text("board_id").notNull(),
    userId: text("user_id").notNull(),
    /** Denormalized at join time so the owner sees who has access. */
    email: text("email").notNull(),
    /** Only `editor` is stored; the owner is implicit. */
    role: text("role").notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("shared_board_members_board_id_user_id_idx").on(
      table.boardId,
      table.userId
    ),
    index("shared_board_members_user_id_idx").on(table.userId),
  ]
)

/**
 * One share link per board (Relume-style: a single flexible link
 * with `allowRead` / `allowEdit` toggles). When `allowEdit` is on, the
 * link grants edit (login required). When only `allowRead` is on, the
 * link is read-only (no login). Both off = link grants nothing.
 */
export const sharedBoardLinks = pgTable(
  "shared_board_links",
  {
    id: text("id").primaryKey().notNull(),
    boardId: text("board_id").notNull(),
    token: text("token").notNull(),
    allowRead: boolean("allow_read").notNull().default(true),
    allowEdit: boolean("allow_edit").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("shared_board_links_token_idx").on(table.token),
    uniqueIndex("shared_board_links_board_id_idx").on(table.boardId),
  ]
)

/**
 * Image assets for a shared board stay in the owner's `assets` table and
 * R2 bucket (live-reference model). The public asset endpoint resolves
 * a share token + imageId to the owner's asset row and streams the blob.
 */

export type SharedBoard = typeof sharedBoards.$inferSelect
export type NewSharedBoard = typeof sharedBoards.$inferInsert
export type SharedBoardMember = typeof sharedBoardMembers.$inferSelect
export type NewSharedBoardMember = typeof sharedBoardMembers.$inferInsert
export type SharedBoardLink = typeof sharedBoardLinks.$inferSelect
export type NewSharedBoardLink = typeof sharedBoardLinks.$inferInsert
