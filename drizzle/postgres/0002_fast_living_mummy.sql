CREATE TABLE "jellyfin_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"token" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"poll_enabled" boolean DEFAULT true NOT NULL,
	"interval_minutes" integer DEFAULT 60 NOT NULL,
	"next_attempt_at" bigint DEFAULT 0 NOT NULL,
	"last_attempt_at" bigint,
	"last_success_at" bigint,
	"last_error" text,
	CONSTRAINT "jellyfin_servers_external_id_unique" UNIQUE("external_id"),
	CONSTRAINT "jellyfin_poll_interval" CHECK ("jellyfin_servers"."interval_minutes" between 1 and 1440)
);
--> statement-breakpoint
ALTER TABLE "jellyfin_profiles" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jellyfin_profiles" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "jellyfin_profiles" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "jellyfin_profiles" ADD COLUMN "user_details" jsonb;--> statement-breakpoint
ALTER TABLE "jellyfin_profiles" ADD COLUMN "presence" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "jellyfin_profiles" ADD COLUMN "disabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jellyfin_profiles" ADD CONSTRAINT "jellyfin_profiles_connection_id_jellyfin_servers_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."jellyfin_servers"("id") ON DELETE no action ON UPDATE no action;