CREATE TABLE `authorization_attempts` (
	`state` text PRIMARY KEY NOT NULL,
	`service` text NOT NULL,
	`session_hash` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`finished_at` integer,
	`failure_code` text
);
--> statement-breakpoint
CREATE TABLE `plex_authorization_attempts` (
	`state` text PRIMARY KEY NOT NULL,
	`pin_id` integer,
	`client_identifier` text NOT NULL,
	FOREIGN KEY (`state`) REFERENCES `authorization_attempts`(`state`) ON UPDATE no action ON DELETE cascade
);
