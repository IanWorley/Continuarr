CREATE TABLE "show_matches" (
	"pairing_id" text NOT NULL,
	"plex_show_id" text NOT NULL,
	"jellyfin_show_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "show_matches" ADD CONSTRAINT "show_matches_pairing_id_sync_pairings_id_fk" FOREIGN KEY ("pairing_id") REFERENCES "public"."sync_pairings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "show_match_plex" ON "show_matches" USING btree ("pairing_id","plex_show_id");--> statement-breakpoint
CREATE UNIQUE INDEX "show_match_jellyfin" ON "show_matches" USING btree ("pairing_id","jellyfin_show_id");