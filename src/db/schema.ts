import {
	bigint,
	boolean,
	check,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm/sql";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import type z from "zod";
import {
	DEFAULT_USER_POLL_MINUTES,
	MAX_USER_POLL_MINUTES,
	MIN_USER_POLL_MINUTES,
} from "~/backend/media/constants";
import type { JsonObject } from "~/backend/media/model";

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
		url: text("url"),
		token: text("token"),
		connectionId: text("connection_id").references(() => jellyfinServers.id),
		userDetails: jsonb("user_details").$type<JsonObject>(),
		presence: text("presence", { enum: ["present", "missing", "unverified"] })
			.notNull()
			.default("unverified"),
		disabled: boolean("disabled").notNull().default(false),
	},
	(table) => [
		uniqueIndex("jellyfin_profile_identity").on(table.userId, table.serverId),
	],
);

export const jellyfinServers = pgTable(
	"jellyfin_servers",
	{
		id: text("id").primaryKey(),
		externalId: text("external_id").notNull().unique(),
		name: text("name").notNull(),
		url: text("url").notNull(),
		token: text("token").notNull(),
		revision: bigint("revision", { mode: "number" }).notNull().default(0),
		pollEnabled: boolean("poll_enabled").notNull().default(true),
		intervalMinutes: integer("interval_minutes")
			.notNull()
			.default(DEFAULT_USER_POLL_MINUTES),
		nextAttemptAt: bigint("next_attempt_at", { mode: "number" })
			.notNull()
			.default(0),
		lastAttemptAt: bigint("last_attempt_at", { mode: "number" }),
		lastSuccessAt: bigint("last_success_at", { mode: "number" }),
		lastError: text("last_error"),
	},
	(table) => [
		check(
			"jellyfin_poll_interval",
			sql`${table.intervalMinutes} between ${MIN_USER_POLL_MINUTES} and ${MAX_USER_POLL_MINUTES}`,
		),
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

export const manualMatches = pgTable(
	"manual_matches",
	{
		pairingId: text("pairing_id")
			.notNull()
			.references(() => syncPairings.id),
		plexItemId: text("plex_item_id").notNull(),
		jellyfinItemId: text("jellyfin_item_id").notNull(),
	},
	(table) => [
		uniqueIndex("manual_match_plex").on(table.pairingId, table.plexItemId),
		uniqueIndex("manual_match_jellyfin").on(
			table.pairingId,
			table.jellyfinItemId,
		),
	],
);
