import { and, eq, gt, lte } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { getDatabase } from "~/db/database";
import type * as schema from "~/db/schema";
import { administrator, administratorSessions } from "~/db/schema";

const OWNER_ID = 1;
type Database = BaseSQLiteDatabase<"sync", unknown, typeof schema>;

export function createAdministratorRepository(
	database: () => Database = () => getDatabase().db,
) {
	return {
		isConfigured() {
			return Boolean(
				database().select({ id: administrator.id }).from(administrator).get(),
			);
		},
		getOwner() {
			return database().select().from(administrator).get();
		},
		createOwner(username: string, passwordHash: string) {
			return Boolean(
				database()
					.insert(administrator)
					.values({ id: OWNER_ID, username, passwordHash })
					.onConflictDoNothing()
					.returning({ id: administrator.id })
					.get(),
			);
		},
		deleteExpiredSessions(now: number) {
			database()
				.delete(administratorSessions)
				.where(lte(administratorSessions.expiresAt, now))
				.run();
		},
		createSession(tokenHash: string, expiresAt: number) {
			database()
				.insert(administratorSessions)
				.values({ tokenHash, administratorId: OWNER_ID, expiresAt })
				.run();
		},
		hasActiveSession(tokenHash: string, now: number) {
			return Boolean(
				database()
					.select({ tokenHash: administratorSessions.tokenHash })
					.from(administratorSessions)
					.where(
						and(
							eq(administratorSessions.tokenHash, tokenHash),
							gt(administratorSessions.expiresAt, now),
						),
					)
					.get(),
			);
		},
		deleteSession(tokenHash: string) {
			database()
				.delete(administratorSessions)
				.where(eq(administratorSessions.tokenHash, tokenHash))
				.run();
		},
	};
}
