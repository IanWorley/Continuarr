CREATE TABLE `administrator` (
	`id` integer PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	CONSTRAINT "single_administrator" CHECK("administrator"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `administrator_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`administrator_id` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`administrator_id`) REFERENCES `administrator`(`id`) ON UPDATE no action ON DELETE cascade
);
