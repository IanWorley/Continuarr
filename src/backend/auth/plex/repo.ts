import { and, eq, exists, gt } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { getDatabase } from "~/db/database";
import * as schema from "~/db/schema";

type Database = BaseSQLiteDatabase<"sync", unknown, typeof schema>;
type FailureCode = NonNullable<
	typeof schema.authorizationAttempts.$inferInsert.failureCode
>;
const {
	authorizationAttempts: attempts,
	plexAuthorizationAttempts: pins,
	administratorSessions: sessions,
} = schema;

export function createPlexAttemptRepository(
	database: () => Database = () => getDatabase().db,
) {
	function activeSession(sessionHash: string, now: number) {
		return exists(
			database()
				.select({ tokenHash: sessions.tokenHash })
				.from(sessions)
				.where(
					and(eq(sessions.tokenHash, sessionHash), gt(sessions.expiresAt, now)),
				),
		);
	}
	return {
		start(
			state: string,
			sessionHash: string,
			clientIdentifier: string,
			now: number,
		) {
			database().transaction((tx) => {
				tx.insert(attempts)
					.values({
						state,
						service: "plex",
						sessionHash,
						status: "starting",
						createdAt: now,
					})
					.run();
				tx.insert(pins).values({ state, clientIdentifier }).run();
			});
		},
		ready(
			state: string,
			sessionHash: string,
			pinId: number,
			expiresAt: number,
			now: number,
		) {
			return database().transaction((tx) => {
				const updated = tx
					.update(attempts)
					.set({ status: "pending", expiresAt })
					.where(
						and(
							eq(attempts.state, state),
							eq(attempts.sessionHash, sessionHash),
							eq(attempts.status, "starting"),
							activeSession(sessionHash, now),
						),
					)
					.returning({ state: attempts.state })
					.get();
				if (!updated) return false;
				tx.update(pins).set({ pinId }).where(eq(pins.state, state)).run();
				return true;
			});
		},
		fail(state: string, failureCode: FailureCode, now: number) {
			database()
				.update(attempts)
				.set({ status: "failed", failureCode, finishedAt: now })
				.where(and(eq(attempts.state, state), eq(attempts.status, "starting")))
				.run();
		},
		// #60 can inspect a pending PIN repeatedly, then consume it only when approval is established.
		pending(state: string, sessionHash: string, now: number) {
			return (
				database()
					.select({
						pinId: pins.pinId,
						clientIdentifier: pins.clientIdentifier,
					})
					.from(attempts)
					.innerJoin(pins, eq(pins.state, attempts.state))
					.where(
						and(
							eq(attempts.state, state),
							eq(attempts.service, "plex"),
							eq(attempts.sessionHash, sessionHash),
							eq(attempts.status, "pending"),
							gt(attempts.expiresAt, now),
							activeSession(sessionHash, now),
						),
					)
					.get() ?? null
			);
		},
		consume(state: string, sessionHash: string, now: number) {
			// One conditional write makes completion single-use, including competing requests.
			return Boolean(
				database()
					.update(attempts)
					.set({ status: "consumed", finishedAt: now })
					.where(
						and(
							eq(attempts.state, state),
							eq(attempts.service, "plex"),
							eq(attempts.sessionHash, sessionHash),
							eq(attempts.status, "pending"),
							gt(attempts.expiresAt, now),
							activeSession(sessionHash, now),
						),
					)
					.returning({ state: attempts.state })
					.get(),
			);
		},
	};
}
