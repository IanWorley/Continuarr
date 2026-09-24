CREATE TABLE "administrator" (
	"id" integer PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	CONSTRAINT "single_administrator" CHECK ("administrator"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "administrator_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"administrator_id" integer NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jellyfin_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"server_id" text NOT NULL,
	"url" text NOT NULL,
	"token" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plex_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"token" text NOT NULL,
	CONSTRAINT "plex_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "plex_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"server_id" text NOT NULL,
	"server_name" text NOT NULL,
	"url" text NOT NULL,
	"token" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_pairings" (
	"id" text PRIMARY KEY NOT NULL,
	"plex_profile_id" text NOT NULL,
	"jellyfin_profile_id" text NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL,
	"last_attempt_at" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "sync_pairings_plex_profile_id_unique" UNIQUE("plex_profile_id"),
	CONSTRAINT "sync_pairings_jellyfin_profile_id_unique" UNIQUE("jellyfin_profile_id")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"pairing_id" text NOT NULL,
	"started_at" bigint NOT NULL,
	"finished_at" bigint,
	"status" text NOT NULL,
	"planned" integer DEFAULT 0 NOT NULL,
	"applied" integer DEFAULT 0 NOT NULL,
	"summary" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "administrator_sessions" ADD CONSTRAINT "administrator_sessions_administrator_id_administrator_id_fk" FOREIGN KEY ("administrator_id") REFERENCES "public"."administrator"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plex_profiles" ADD CONSTRAINT "plex_profiles_account_id_plex_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."plex_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_pairings" ADD CONSTRAINT "sync_pairings_plex_profile_id_plex_profiles_id_fk" FOREIGN KEY ("plex_profile_id") REFERENCES "public"."plex_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_pairings" ADD CONSTRAINT "sync_pairings_jellyfin_profile_id_jellyfin_profiles_id_fk" FOREIGN KEY ("jellyfin_profile_id") REFERENCES "public"."jellyfin_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_pairing_id_sync_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."sync_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "jellyfin_profile_identity" ON "jellyfin_profiles" USING btree ("user_id","server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plex_profile_identity" ON "plex_profiles" USING btree ("user_id","server_id");