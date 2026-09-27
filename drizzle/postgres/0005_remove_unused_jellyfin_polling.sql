ALTER TABLE "jellyfin_servers" DROP CONSTRAINT "jellyfin_poll_interval";--> statement-breakpoint
ALTER TABLE "jellyfin_servers" DROP COLUMN "poll_enabled";--> statement-breakpoint
ALTER TABLE "jellyfin_servers" DROP COLUMN "interval_minutes";--> statement-breakpoint
ALTER TABLE "jellyfin_servers" DROP COLUMN "next_attempt_at";