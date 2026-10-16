CREATE TABLE "sync_item_states" (
	"pairing_id" text NOT NULL,
	"plex_item_id" text NOT NULL,
	"jellyfin_item_id" text NOT NULL,
	"scanned_plex_watched" boolean NOT NULL,
	"scanned_plex_position_ms" bigint,
	"scanned_jellyfin_watched" boolean NOT NULL,
	"scanned_jellyfin_position_ms" bigint,
	"target_plex_watched" boolean NOT NULL,
	"target_plex_position_ms" bigint,
	"target_jellyfin_watched" boolean NOT NULL,
	"target_jellyfin_position_ms" bigint,
	"jellyfin_played_at" bigint,
	"position_conflict" boolean NOT NULL,
	CONSTRAINT "sync_item_states_pairing_id_plex_item_id_jellyfin_item_id_pk" PRIMARY KEY("pairing_id","plex_item_id","jellyfin_item_id")
);
--> statement-breakpoint
ALTER TABLE "sync_item_states" ADD CONSTRAINT "sync_item_states_pairing_id_sync_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."sync_pairings"("id") ON DELETE no action ON UPDATE no action;