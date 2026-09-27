import { randomUUID } from "node:crypto";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { JellyfinDirectory } from "~/backend/media/model";
import { type createSecretStorage, Secret } from "~/backend/secrets/storage";
import {
	findApplicationSetting,
	saveApplicationSetting,
} from "~/backend/shared/repo";
import { type AppDatabase, getDatabase } from "~/db/database";
import * as schema from "~/db/schema";
import { MILLISECONDS_PER_MINUTE } from "./constants";

const RECENT_RUN_LIMIT = 50;
const ACTIVE_PLEX_ACCOUNT_KEY = "active_plex_account_id";

export type MediaDatabase = AppDatabase;
export class JellyfinMigrationError extends Error {}
type MediaTransaction = Parameters<
	Parameters<MediaDatabase["transaction"]>[0]
>[0];
export function createMediaRepository(
	database: () => MediaDatabase = () => getDatabase().db,
) {
	const {
		plexAccounts,
		plexProfiles,
		jellyfinProfiles,
		jellyfinServers,
		syncPairings,
		syncRuns,
		manualMatches,
	} = schema;
	async function reconcileUsers(
		transaction: MediaTransaction,
		server: typeof jellyfinServers.$inferSelect,
		users: JellyfinDirectory["users"],
	) {
		await transaction
			.update(jellyfinProfiles)
			.set({ presence: "missing" })
			.where(eq(jellyfinProfiles.connectionId, server.id));
		for (const user of users)
			await transaction
				.insert(jellyfinProfiles)
				.values({
					id: randomUUID(),
					userId: user.id,
					name: user.name,
					serverId: server.externalId,
					connectionId: server.id,
					userDetails: user.details,
					presence: "present",
					disabled: user.disabled,
				})
				.onConflictDoUpdate({
					target: [jellyfinProfiles.serverId, jellyfinProfiles.userId],
					set: {
						name: user.name,
						connectionId: server.id,
						userDetails: user.details,
						presence: "present",
						disabled: user.disabled,
					},
				});
	}
	return {
		manualMatches: async (pairingId: string) =>
			await database()
				.select()
				.from(manualMatches)
				.where(eq(manualMatches.pairingId, pairingId)),
		removeManualMatch: async (row: typeof manualMatches.$inferInsert) =>
			await database()
				.delete(manualMatches)
				.where(
					and(
						eq(manualMatches.pairingId, row.pairingId),
						eq(manualMatches.plexItemId, row.plexItemId),
						eq(manualMatches.jellyfinItemId, row.jellyfinItemId),
					),
				)
				.execute(),
		addManualMatch: async (row: typeof manualMatches.$inferInsert) => {
			const [inserted] = await database()
				.insert(manualMatches)
				.values(row)
				.onConflictDoNothing()
				.returning();
			return inserted;
		},
		accounts: async () => await database().select().from(plexAccounts),
		activePlexAccountId: async () =>
			(await findApplicationSetting(ACTIVE_PLEX_ACCOUNT_KEY, database()))
				?.value ?? null,
		saveActivePlexAccountId: async (id: string) => {
			await saveApplicationSetting(ACTIVE_PLEX_ACCOUNT_KEY, id, database());
		},
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
		jellyfinServers: async () =>
			await database().select().from(jellyfinServers),
		backfillJellyfinServers: async (
			secrets: ReturnType<typeof createSecretStorage>,
		) =>
			database().transaction(async (transaction) => {
				const legacy = await transaction
					.select()
					.from(jellyfinProfiles)
					.where(eq(jellyfinProfiles.presence, "unverified"))
					.for("update");
				const groups = new Map<string, typeof legacy>();
				for (const profile of legacy) {
					if (profile.connectionId) continue;
					const group = groups.get(profile.serverId) ?? [];
					group.push(profile);
					groups.set(profile.serverId, group);
				}
				const candidates: Array<{
					externalId: string;
					url: string;
					token: string;
					ids: string[];
				}> = [];
				for (const [externalId, profiles] of groups) {
					const ids = profiles.map((profile) => profile.id);
					let credential: string | undefined;
					let url: string | undefined;
					try {
						for (const profile of profiles) {
							if (!profile.url || !profile.token)
								throw new Error("missing credential");
							const plain = secrets.decrypt(profile.id, profile.token).reveal();
							if (
								credential !== undefined &&
								(plain !== credential || profile.url !== url)
							)
								throw new Error("conflicting credential");
							credential = plain;
							url = profile.url;
						}
					} catch {
						throw new JellyfinMigrationError(
							`Jellyfin credential migration needs repair for profile IDs: ${ids.join(", ")}. Saved rows were not changed.`,
						);
					}
					if (!url || credential === undefined)
						throw new Error("Empty Jellyfin migration group.");
					candidates.push({ externalId, url, token: credential, ids });
				}
				for (const candidate of candidates) {
					const id = randomUUID();
					await transaction.insert(jellyfinServers).values({
						id,
						externalId: candidate.externalId,
						name: candidate.externalId,
						url: candidate.url,
						token: secrets.encrypt(id, new Secret(candidate.token)),
						nextAttemptAt: 0,
					});
					for (const profileId of candidate.ids)
						await transaction
							.update(jellyfinProfiles)
							.set({ connectionId: id })
							.where(eq(jellyfinProfiles.id, profileId));
				}
			}),
		jellyfinServer: async (id: string) => {
			const [row] = await database()
				.select()
				.from(jellyfinServers)
				.where(eq(jellyfinServers.id, id))
				.limit(1);
			return row;
		},
		dueJellyfinServers: async (now: number) =>
			await database()
				.select({ id: jellyfinServers.id })
				.from(jellyfinServers)
				.where(
					and(
						eq(jellyfinServers.pollEnabled, true),
						lte(jellyfinServers.nextAttemptAt, now),
					),
				),
		addJellyfinServer: async (
			row: typeof jellyfinServers.$inferInsert,
			users: JellyfinDirectory["users"],
			now: number,
		) =>
			database().transaction(async (transaction) => {
				const [server] = await transaction
					.insert(jellyfinServers)
					.values(row)
					.returning();
				await reconcileUsers(transaction, server, users);
				await transaction
					.update(jellyfinServers)
					.set({ lastSuccessAt: now, lastAttemptAt: now })
					.where(eq(jellyfinServers.id, row.id));
			}),
		replaceJellyfinServer: async (
			id: string,
			expectedRevision: number,
			row: Pick<typeof jellyfinServers.$inferInsert, "url" | "name" | "token">,
			users: JellyfinDirectory["users"],
			now: number,
		) =>
			database().transaction(async (transaction) => {
				const [updated] = await transaction
					.update(jellyfinServers)
					.set({
						...row,
						revision: expectedRevision + 1,
						lastAttemptAt: now,
						nextAttemptAt: sql`cast(${now} as bigint) + ${jellyfinServers.intervalMinutes} * ${MILLISECONDS_PER_MINUTE}`,
						lastSuccessAt: now,
						lastError: null,
					})
					.where(
						and(
							eq(jellyfinServers.id, id),
							eq(jellyfinServers.revision, expectedRevision),
						),
					)
					.returning();
				if (!updated) return false;
				await reconcileUsers(transaction, updated, users);
				return true;
			}),
		claimJellyfinRefresh: async (id: string, now: number) =>
			database().transaction(async (transaction) => {
				const [current] = await transaction
					.select()
					.from(jellyfinServers)
					.where(eq(jellyfinServers.id, id))
					.for("update");
				if (!current) return undefined;
				const [claimed] = await transaction
					.update(jellyfinServers)
					.set({
						revision: current.revision + 1,
						lastAttemptAt: now,
						nextAttemptAt:
							now + current.intervalMinutes * MILLISECONDS_PER_MINUTE,
					})
					.where(eq(jellyfinServers.id, id))
					.returning();
				return claimed;
			}),
		finishJellyfinRefresh: async (
			id: string,
			revision: number,
			users: JellyfinDirectory["users"],
			now: number,
			name: string,
		) =>
			database().transaction(async (transaction) => {
				const [updated] = await transaction
					.update(jellyfinServers)
					.set({ name, lastSuccessAt: now, lastError: null })
					.where(
						and(
							eq(jellyfinServers.id, id),
							eq(jellyfinServers.revision, revision),
						),
					)
					.returning();
				if (!updated) return false;
				await reconcileUsers(transaction, updated, users);
				return true;
			}),
		failJellyfinRefresh: async (
			id: string,
			revision: number,
			message: string,
		) => {
			const [updated] = await database()
				.update(jellyfinServers)
				.set({ lastError: message })
				.where(
					and(
						eq(jellyfinServers.id, id),
						eq(jellyfinServers.revision, revision),
					),
				)
				.returning();
			return !!updated;
		},
		configureJellyfinPolling: async (
			id: string,
			enabled: boolean,
			intervalMinutes: number,
			now: number,
		) => {
			const [updated] = await database()
				.update(jellyfinServers)
				.set({
					pollEnabled: enabled,
					intervalMinutes,
					nextAttemptAt: now + intervalMinutes * MILLISECONDS_PER_MINUTE,
				})
				.where(eq(jellyfinServers.id, id))
				.returning();
			return updated;
		},
		jellyfinProfile: async (id: string) => {
			const [row] = await database()
				.select()
				.from(jellyfinProfiles)
				.where(eq(jellyfinProfiles.id, id))
				.limit(1);
			return row;
		},
		saveJellyfinProfiles: (rows: Array<typeof jellyfinProfiles.$inferInsert>) =>
			database().transaction(async (transaction) => {
				for (const row of rows)
					await transaction
						.insert(jellyfinProfiles)
						.values(row)
						.onConflictDoUpdate({ target: jellyfinProfiles.id, set: row });
			}),
		pairings: async () => await database().select().from(syncPairings),
		pairing: async (id: string) => {
			const [row] = await database()
				.select()
				.from(syncPairings)
				.where(eq(syncPairings.id, id))
				.limit(1);
			return row;
		},
		addPairing: async (row: typeof syncPairings.$inferInsert) =>
			database().transaction(async (transaction) => {
				const [user] = await transaction
					.select()
					.from(jellyfinProfiles)
					.where(eq(jellyfinProfiles.id, row.jellyfinProfileId))
					.for("update");
				if (user?.presence !== "present" || user.disabled)
					return { kind: "unavailable" as const };
				const [inserted] = await transaction
					.insert(syncPairings)
					.values(row)
					.onConflictDoNothing()
					.returning();
				return inserted
					? { kind: "inserted" as const, row: inserted }
					: { kind: "conflict" as const };
			}),
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
