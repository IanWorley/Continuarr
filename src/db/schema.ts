import { sql } from "drizzle-orm/sql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type z from "zod";

export const applicationSettings = sqliteTable("application_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`)
		.$onUpdate(() => sql`(unixepoch())`),
});

export const applicationSettingsSchema =
	createSelectSchema(applicationSettings);
export const applicationSettingsInsertSchema =
	createInsertSchema(applicationSettings);

export type ApplicationSetting = z.infer<typeof applicationSettingsSchema>;
export type ApplicationSettingInsert = z.infer<
	typeof applicationSettingsInsertSchema
>;

export const users = sqliteTable("users", {
	id: text("id").primaryKey(),
	plexId: integer("plex_id").notNull().unique(),
	displayName: text("display_name").notNull(),
});

export const plexConnections = sqliteTable("plex_connections", {
	userId: text("user_id")
		.primaryKey()
		.references(() => users.id),
	clientIdentifier: text("client_identifier").notNull().unique(),
	encryptedCredentials: text("encrypted_credentials").notNull(),
});

export const sessions = sqliteTable("sessions", {
	tokenHash: text("token_hash").primaryKey(),
	userId: text("user_id")
		.notNull()
		.references(() => users.id),
	expiresAt: integer("expires_at").notNull(),
});

export const plexLogins = sqliteTable("plex_logins", {
	state: text("state").primaryKey(),
	browserHash: text("browser_hash").notNull(),
	clientIdentifier: text("client_identifier").notNull(),
	pinId: integer("pin_id").notNull(),
	expiresAt: integer("expires_at").notNull(),
});
