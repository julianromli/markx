-- Consolidate to a single share link per board with read/edit toggles
-- (Relume-style: one flexible link instead of separate view/edit links).
ALTER TABLE "shared_board_links" ADD COLUMN "allow_read" boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE "shared_board_links" ADD COLUMN "allow_edit" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- Edit links grant read + edit.
UPDATE "shared_board_links" SET "allow_read" = true, "allow_edit" = true WHERE "access" = 'edit' AND "revoked_at" IS NULL;--> statement-breakpoint
-- Active view-only links grant read only.
UPDATE "shared_board_links" SET "allow_read" = true, "allow_edit" = false WHERE "access" = 'view' AND "revoked_at" IS NULL;--> statement-breakpoint
-- Drop old regenerated (revoked) links.
DELETE FROM "shared_board_links" WHERE "revoked_at" IS NOT NULL;--> statement-breakpoint
-- For boards with an edit link, drop the view link (keep the edit link).
DELETE FROM "shared_board_links" WHERE "access" = 'view' AND "board_id" IN (SELECT "board_id" FROM "shared_board_links" WHERE "access" = 'edit');--> statement-breakpoint
ALTER TABLE "shared_board_links" DROP COLUMN "access";--> statement-breakpoint
ALTER TABLE "shared_board_links" DROP COLUMN "revoked_at";--> statement-breakpoint
CREATE UNIQUE INDEX "shared_board_links_board_id_idx" ON "shared_board_links" USING btree ("board_id");
