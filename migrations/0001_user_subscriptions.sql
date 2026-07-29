CREATE TABLE "user_subscriptions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'inactive' NOT NULL,
	"mayar_member_id" text,
	"mayar_customer_id" text,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mayar_processed_transactions" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
