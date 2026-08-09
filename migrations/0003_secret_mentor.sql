CREATE TABLE "shared_board_assets" (
	"board_id" text NOT NULL,
	"image_id" text NOT NULL,
	"object_key" text NOT NULL,
	"mime" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_board_links" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"token" text NOT NULL,
	"access" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_board_members" (
	"board_id" text NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shared_boards" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"owner_email" text NOT NULL,
	"title" text NOT NULL,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "shared_board_assets_board_id_image_id_idx" ON "shared_board_assets" USING btree ("board_id","image_id");--> statement-breakpoint
CREATE INDEX "shared_board_assets_object_key_idx" ON "shared_board_assets" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_board_links_token_idx" ON "shared_board_links" USING btree ("token");--> statement-breakpoint
CREATE INDEX "shared_board_links_board_id_idx" ON "shared_board_links" USING btree ("board_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_board_members_board_id_user_id_idx" ON "shared_board_members" USING btree ("board_id","user_id");--> statement-breakpoint
CREATE INDEX "shared_board_members_user_id_idx" ON "shared_board_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "shared_boards_owner_user_id_idx" ON "shared_boards" USING btree ("owner_user_id");