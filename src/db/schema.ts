import { sql } from "drizzle-orm/sql";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type z from "zod";

export const applicationSettings = sqliteTable("application_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	createdAt: integer("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
	updateAt: integer("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const applicationSettingsSchema =
	createSelectSchema(applicationSettings);
export const applicationSettingsInsertSchema =
	createInsertSchema(applicationSettings);

export type ApplicationSetting = z.infer<typeof applicationSettingsSchema>;
export type ApplicationSettingInsert = z.infer<
	typeof applicationSettingsInsertSchema
>;
