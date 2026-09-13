CREATE TABLE `server_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`administrator_id` integer NOT NULL,
	`service` text NOT NULL,
	`server_id` text NOT NULL,
	`url` text NOT NULL,
	`display_name` text NOT NULL,
	`encrypted_credential` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`administrator_id`) REFERENCES `administrator`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "connection_service" CHECK("server_connections"."service" IN ('plex', 'jellyfin')),
	CONSTRAINT "connection_status" CHECK("server_connections"."status" IN ('connected', 'unavailable', 'revoked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_connections_service_unique` ON `server_connections` (`service`);