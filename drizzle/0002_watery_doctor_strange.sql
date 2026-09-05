CREATE TABLE `plex_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`client_identifier` text NOT NULL,
	`encrypted_credentials` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plex_connections_client_identifier_unique` ON `plex_connections` (`client_identifier`);--> statement-breakpoint
CREATE TABLE `plex_logins` (
	`state` text PRIMARY KEY NOT NULL,
	`browser_hash` text NOT NULL,
	`client_identifier` text NOT NULL,
	`pin_id` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`plex_id` integer NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_plex_id_unique` ON `users` (`plex_id`);