import {
	bigint,
	boolean,
	check,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type z from "zod";

export const applicationSettings = pgTable("application_settings", {
	key: text("key").primaryKey(),
	value: text("value").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.notNull()
		.defaultNow()
		.$onUpdate(() => sql`now()`),
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
export const administrator = pgTable(
	"administrator",
	{
		id: integer("id").primaryKey().notNull(),
		username: text("username").notNull(),
		passwordHash: text("password_hash").notNull(),
	},
	(table) => [check("single_administrator", sql`${table.id} = 1`)],
);

export const administratorSessions = pgTable("administrator_sessions", {
	tokenHash: text("token_hash").primaryKey(),
	administratorId: integer("administrator_id")
		.notNull()
		.references(() => administrator.id, { onDelete: "cascade" }),
	expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

export const plexAccounts = pgTable("plex_accounts", {
	id: text("id").primaryKey(),
	userId: text("user_id").notNull().unique(),
	name: text("name").notNull(),
	token: text("token").notNull(),
});

export const plexProfiles = pgTable(
	"plex_profiles",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id")
			.notNull()
			.references(() => plexAccounts.id),
		userId: text("user_id").notNull(),
		name: text("name").notNull(),
		serverId: text("server_id").notNull(),
		serverName: text("server_name").notNull(),
		url: text("url").notNull(),
		token: text("token").notNull(),
	},
	(table) => [
		uniqueIndex("plex_profile_identity").on(table.userId, table.serverId),
	],
);

export const jellyfinProfiles = pgTable(
	"jellyfin_profiles",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		name: text("name").notNull(),
		serverId: text("server_id").notNull(),
		url: text("url").notNull(),
		token: text("token").notNull(),
	},
	(table) => [
		uniqueIndex("jellyfin_profile_identity").on(table.userId, table.serverId),
	],
);

export const syncPairings = pgTable("sync_pairings", {
	id: text("id").primaryKey(),
	plexProfileId: text("plex_profile_id")
		.notNull()
		.unique()
		.references(() => plexProfiles.id),
	jellyfinProfileId: text("jellyfin_profile_id")
		.notNull()
		.unique()
		.references(() => jellyfinProfiles.id),
	automatic: boolean("automatic").notNull().default(false),
	lastAttemptAt: bigint("last_attempt_at", { mode: "number" })
		.notNull()
		.default(0),
});

export const syncRuns = pgTable("sync_runs", {
	id: text("id").primaryKey(),
	pairingId: text("pairing_id")
		.notNull()
		.references(() => syncPairings.id),
	startedAt: bigint("started_at", { mode: "number" }).notNull(),
	finishedAt: bigint("finished_at", { mode: "number" }),
	status: text("status", {
		enum: ["running", "completed", "failed"],
	}).notNull(),
	planned: integer("planned").notNull().default(0),
	applied: integer("applied").notNull().default(0),
	summary: text("summary").notNull(),
});
