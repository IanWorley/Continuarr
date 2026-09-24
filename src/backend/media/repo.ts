import { desc, eq } from "drizzle-orm";
import { type AppDatabase, getDatabase } from "~/db/database";
import * as schema from "~/db/schema";

const RECENT_RUN_LIMIT = 50;

export type MediaDatabase = AppDatabase;
export function createMediaRepository(
	database: () => MediaDatabase = () => getDatabase().db,
) {
	const {
		plexAccounts,
		plexProfiles,
		jellyfinProfiles,
		syncPairings,
		syncRuns,
	} = schema;
	return {
		accounts: async () => await database().select().from(plexAccounts),
		account: async (id: string) => {
			const [row] = await database()
				.select()
				.from(plexAccounts)
				.where(eq(plexAccounts.id, id))
				.limit(1);
			return row;
		},
		saveAccount: (row: typeof plexAccounts.$inferInsert) =>
			database()
				.insert(plexAccounts)
				.values(row)
				.onConflictDoUpdate({ target: plexAccounts.id, set: row })
				.execute(),
		plexProfiles: async () => await database().select().from(plexProfiles),
		plexProfile: async (id: string) => {
			const [row] = await database()
				.select()
				.from(plexProfiles)
				.where(eq(plexProfiles.id, id))
				.limit(1);
			return row;
		},
		savePlexProfile: (row: typeof plexProfiles.$inferInsert) =>
			database()
				.insert(plexProfiles)
				.values(row)
				.onConflictDoUpdate({ target: plexProfiles.id, set: row })
				.execute(),
		jellyfinProfiles: async () =>
			await database().select().from(jellyfinProfiles),
		jellyfinProfile: async (id: string) => {
			const [row] = await database()
				.select()
				.from(jellyfinProfiles)
				.where(eq(jellyfinProfiles.id, id))
				.limit(1);
			return row;
		},
		saveJellyfinProfile: (row: typeof jellyfinProfiles.$inferInsert) =>
			database()
				.insert(jellyfinProfiles)
				.values(row)
				.onConflictDoUpdate({ target: jellyfinProfiles.id, set: row })
				.execute(),
		pairings: async () => await database().select().from(syncPairings),
		pairing: async (id: string) => {
			const [row] = await database()
				.select()
				.from(syncPairings)
				.where(eq(syncPairings.id, id))
				.limit(1);
			return row;
		},
		addPairing: async (row: typeof syncPairings.$inferInsert) => {
			const [inserted] = await database()
				.insert(syncPairings)
				.values(row)
				.onConflictDoNothing()
				.returning();
			return inserted;
		},
		automatic: (id: string, automatic: boolean) =>
			database()
				.update(syncPairings)
				.set({ automatic })
				.where(eq(syncPairings.id, id))
				.execute(),
		attempted: (id: string, now: number) =>
			database()
				.update(syncPairings)
				.set({ lastAttemptAt: now })
				.where(eq(syncPairings.id, id))
				.execute(),
		startRun: (row: typeof syncRuns.$inferInsert) =>
			database().insert(syncRuns).values(row).execute(),
		updateRun: (id: string, row: Partial<typeof syncRuns.$inferInsert>) =>
			database().update(syncRuns).set(row).where(eq(syncRuns.id, id)).execute(),
		runs: async () =>
			await database()
				.select()
				.from(syncRuns)
				.orderBy(desc(syncRuns.startedAt))
				.limit(RECENT_RUN_LIMIT),
		interruptRuns: (now: number) =>
			database()
				.update(syncRuns)
				.set({
					status: "failed",
					finishedAt: now,
					summary:
						"Server restarted during sync. Run again to reconcile current watched status.",
				})
				.where(eq(syncRuns.status, "running"))
				.execute(),
	};
}
export type MediaRepository = ReturnType<typeof createMediaRepository>;
