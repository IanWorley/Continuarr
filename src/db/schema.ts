import { sql } from "drizzle-orm/sql";
import { check, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

// A fixed primary key makes a second installation owner impossible, including during bootstrap races.
export const administrator = sqliteTable(
	"administrator",
	{
		id: integer("id").primaryKey().notNull(),
		username: text("username").notNull(),
		passwordHash: text("password_hash").notNull(),
	},
	(table) => [check("single_administrator", sql`${table.id} = 1`)],
);

export const administratorSessions = sqliteTable("administrator_sessions", {
	tokenHash: text("token_hash").primaryKey(),
	administratorId: integer("administrator_id")
		.notNull()
		.references(() => administrator.id, { onDelete: "cascade" }),
	expiresAt: integer("expires_at").notNull(),
});
