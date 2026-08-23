CREATE TABLE `__new_application_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_application_settings` (`key`, `value`, `created_at`, `updated_at`)
SELECT `key`, `value`, unixepoch(), unixepoch()
FROM `application_settings`;--> statement-breakpoint
DROP TABLE `application_settings`;--> statement-breakpoint
ALTER TABLE `__new_application_settings` RENAME TO `application_settings`;
