CREATE TABLE `jellyfin_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`server_id` text NOT NULL,
	`url` text NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jellyfin_profile_identity` ON `jellyfin_profiles` (`user_id`,`server_id`);--> statement-breakpoint
CREATE TABLE `plex_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plex_accounts_user_id_unique` ON `plex_accounts` (`user_id`);--> statement-breakpoint
CREATE TABLE `plex_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`server_id` text NOT NULL,
	`server_name` text NOT NULL,
	`url` text NOT NULL,
	`token` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `plex_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `plex_profile_identity` ON `plex_profiles` (`user_id`,`server_id`);--> statement-breakpoint
CREATE TABLE `sync_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`plex_profile_id` text NOT NULL,
	`jellyfin_profile_id` text NOT NULL,
	`automatic` integer DEFAULT false NOT NULL,
	`last_attempt_at` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`plex_profile_id`) REFERENCES `plex_profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`jellyfin_profile_id`) REFERENCES `jellyfin_profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_pairings_plex_profile_id_unique` ON `sync_pairings` (`plex_profile_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sync_pairings_jellyfin_profile_id_unique` ON `sync_pairings` (`jellyfin_profile_id`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`pairing_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`planned` integer DEFAULT 0 NOT NULL,
	`applied` integer DEFAULT 0 NOT NULL,
	`summary` text NOT NULL,
	FOREIGN KEY (`pairing_id`) REFERENCES `sync_pairings`(`id`) ON UPDATE no action ON DELETE no action
);
