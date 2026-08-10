ALTER TABLE "shared_boards"
  ADD COLUMN "view_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "shared_boards"
  ADD COLUMN "recent_viewer_seeds" jsonb NOT NULL DEFAULT '[]'::jsonb;
