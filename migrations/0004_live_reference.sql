-- Switch shared boards to the live-reference model (Milanote-style):
-- the folder + items STAY in the owner's workspace blob; this table only
-- stores sharing metadata + a per-board version. Drops the `state`
-- snapshot column and the `shared_board_assets` table (images stay in the
-- owner's `assets`).
ALTER TABLE "shared_boards" ADD COLUMN "folder_id" text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "shared_boards" DROP COLUMN "state";--> statement-breakpoint
DROP TABLE "shared_board_assets";--> statement-breakpoint
CREATE UNIQUE INDEX "shared_boards_owner_user_id_folder_id_idx" ON "shared_boards" USING btree ("owner_user_id","folder_id");
