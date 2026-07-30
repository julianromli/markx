ALTER TABLE "user_subscriptions" ADD COLUMN "mayar_transaction_id" text;
--> statement-breakpoint
ALTER TABLE "user_subscriptions" ADD COLUMN "mayar_checked_at" timestamp with time zone;
