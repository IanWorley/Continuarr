import { and, eq, gt, lte } from "drizzle-orm";
import { type AppDatabase, getDatabase } from "~/db/database";
import { administrator, administratorSessions } from "~/db/schema";

const OWNER_ID = 1;

export function createAdministratorRepository(
	database: () => AppDatabase = () => getDatabase().db,
) {
	return {
		async isConfigured() {
			const rows = await database()
				.select({ id: administrator.id })
				.from(administrator)
				.limit(1);
			return rows.length !== 0;
		},
		async getOwner() {
			const [owner] = await database().select().from(administrator).limit(1);
			return owner;
		},
		async createOwner(username: string, passwordHash: string) {
			const rows = await database()
				.insert(administrator)
				.values({ id: OWNER_ID, username, passwordHash })
				.onConflictDoNothing()
				.returning({ id: administrator.id });
			return rows.length !== 0;
		},
		async deleteExpiredSessions(now: number) {
			await database()
				.delete(administratorSessions)
				.where(lte(administratorSessions.expiresAt, now));
		},
		async createSession(tokenHash: string, expiresAt: number) {
			await database()
				.insert(administratorSessions)
				.values({ tokenHash, administratorId: OWNER_ID, expiresAt });
		},
		async hasActiveSession(tokenHash: string, now: number) {
			const rows = await database()
				.select({ tokenHash: administratorSessions.tokenHash })
				.from(administratorSessions)
				.where(
					and(
						eq(administratorSessions.tokenHash, tokenHash),
						gt(administratorSessions.expiresAt, now),
					),
				)
				.limit(1);
			return rows.length !== 0;
		},
		async deleteSession(tokenHash: string) {
			await database()
				.delete(administratorSessions)
				.where(eq(administratorSessions.tokenHash, tokenHash));
		},
	};
}
