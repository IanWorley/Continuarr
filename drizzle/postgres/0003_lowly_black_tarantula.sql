CREATE TABLE "directory_polling" (
	"id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"interval_minutes" integer DEFAULT 60 NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint DEFAULT 0 NOT NULL,
	"last_attempt_at" bigint,
	CONSTRAINT "single_directory_polling" CHECK ("directory_polling"."id" = 1),
	CONSTRAINT "directory_poll_interval" CHECK ("directory_polling"."interval_minutes" between 1 and 1440)
);
--> statement-breakpoint
CREATE TABLE "plex_servers" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"revision" bigint DEFAULT 0 NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"last_attempt_at" bigint,
	"last_success_at" bigint,
	"last_error" text,
	CONSTRAINT "plex_servers_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "jellyfin_servers" DROP CONSTRAINT "jellyfin_poll_interval";--> statement-breakpoint
ALTER TABLE "plex_profiles" ADD COLUMN "connection_id" text;--> statement-breakpoint
ALTER TABLE "plex_profiles" ADD COLUMN "presence" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "plex_profiles" ADD COLUMN "access_status" text DEFAULT 'available' NOT NULL;--> statement-breakpoint
ALTER TABLE "plex_servers" ADD CONSTRAINT "plex_servers_account_id_plex_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."plex_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plex_profiles" ADD CONSTRAINT "plex_profiles_connection_id_plex_servers_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."plex_servers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jellyfin_servers" ADD CONSTRAINT "jellyfin_poll_interval" CHECK ("jellyfin_servers"."interval_minutes" between 1 and 1440);