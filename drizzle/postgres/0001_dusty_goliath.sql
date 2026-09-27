CREATE TABLE "manual_matches" (
	"pairing_id" text NOT NULL,
	"plex_item_id" text NOT NULL,
	"jellyfin_item_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manual_matches" ADD CONSTRAINT "manual_matches_pairing_id_sync_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."sync_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_match_plex" ON "manual_matches" USING btree ("pairing_id","plex_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manual_match_jellyfin" ON "manual_matches" USING btree ("pairing_id","jellyfin_item_id");