import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import * as schema from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";

const createTestDatabase = setupTestDatabase();
const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("../../drizzle/postgres", import.meta.url),
);
const EXPECTED_SETTING = { key: "database-provider", value: "postgresql" };
const SAVED_TIMESTAMP = new Date("2026-09-24T01:23:45.678Z");
const RUN_STARTED_AT = 1_790_211_825_678;
const RUN_FINISHED_AT = 1_790_211_830_789;

describe("PostgreSQL schema migrations", () => {
	it("preserves existing settings and timestamps when migrations run again", async () => {
		const { db } = await createTestDatabase();
		const setting = {
			...EXPECTED_SETTING,
			createdAt: SAVED_TIMESTAMP,
			updatedAt: SAVED_TIMESTAMP,
		};
		await db.insert(schema.applicationSettings).values(setting);
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		expect(await db.select().from(schema.applicationSettings)).toEqual([
			setting,
		]);
	});

	it("preserves linked profiles, pairing options, and millisecond run times when migrations run again", async () => {
		const { db } = await createTestDatabase();
		const account = {
			id: "account",
			userId: "plex-owner",
			name: "Owner",
			token: "encrypted-account-token",
		};
		const plexProfile = {
			id: "plex-profile",
			accountId: account.id,
			userId: "plex-home-user",
			name: "Ian",
			serverId: "plex-server",
			serverName: "Plex",
			url: "http://plex.test",
			token: "encrypted-profile-token",
		};
		const jellyfinProfile = {
			id: "jellyfin-profile",
			userId: "jellyfin-user",
			name: "Ian",
			serverId: "jellyfin-server",
			url: "http://jellyfin.test",
			token: "encrypted-user-token",
		};
		await db.insert(schema.plexAccounts).values(account);
		await db.insert(schema.plexProfiles).values(plexProfile);
		await db.insert(schema.jellyfinProfiles).values(jellyfinProfile);
		await db.insert(schema.syncPairings).values({
			id: "pairing",
			plexProfileId: plexProfile.id,
			jellyfinProfileId: jellyfinProfile.id,
		});
		expect(await db.select().from(schema.syncPairings)).toEqual([
			{
				id: "pairing",
				plexProfileId: plexProfile.id,
				jellyfinProfileId: jellyfinProfile.id,
				automatic: false,
				lastAttemptAt: 0,
			},
		]);
		await db
			.update(schema.syncPairings)
			.set({ automatic: true, lastAttemptAt: RUN_STARTED_AT });
		await db.insert(schema.syncRuns).values({
			id: "run",
			pairingId: "pairing",
			startedAt: RUN_STARTED_AT,
			finishedAt: RUN_FINISHED_AT,
			status: "completed",
			planned: 2,
			applied: 2,
			summary: "Two watched updates completed.",
		});
		await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		expect(await db.select().from(schema.plexAccounts)).toEqual([account]);
		expect(await db.select().from(schema.plexProfiles)).toEqual([plexProfile]);
		expect(await db.select().from(schema.jellyfinProfiles)).toEqual([
			jellyfinProfile,
		]);
		expect(await db.select().from(schema.syncPairings)).toEqual([
			{
				id: "pairing",
				plexProfileId: plexProfile.id,
				jellyfinProfileId: jellyfinProfile.id,
				automatic: true,
				lastAttemptAt: RUN_STARTED_AT,
			},
		]);
		expect(await db.select().from(schema.syncRuns)).toEqual([
			{
				id: "run",
				pairingId: "pairing",
				startedAt: RUN_STARTED_AT,
				finishedAt: RUN_FINISHED_AT,
				status: "completed",
				planned: 2,
				applied: 2,
				summary: "Two watched updates completed.",
			},
		]);
	});
});
