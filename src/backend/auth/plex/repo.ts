import { and, eq, gt, lte } from "drizzle-orm";
import { getDatabase } from "~/db/database";
import { plexConnections, plexLogins, sessions, users } from "~/db/schema";

type Login = typeof plexLogins.$inferInsert;

export function saveLogin(login: Login, db = getDatabase().db) {
	db.transaction((tx) => {
		tx.delete(plexLogins).where(lte(plexLogins.expiresAt, Date.now())).run();
		tx.delete(plexLogins)
			.where(eq(plexLogins.browserHash, login.browserHash))
			.run();
		tx.insert(plexLogins).values(login).run();
	});
}

// DELETE ... RETURNING claims a login once, including across concurrent requests.
export function takeLogin(
	state: string,
	browserHash: string,
	db = getDatabase().db,
) {
	return db
		.delete(plexLogins)
		.where(
			and(
				eq(plexLogins.state, state),
				eq(plexLogins.browserHash, browserHash),
				gt(plexLogins.expiresAt, Date.now()),
			),
		)
		.returning()
		.get();
}

export function findUser(plexId: number, db = getDatabase().db) {
	return db.select().from(users).where(eq(users.plexId, plexId)).get();
}

export function saveAuthenticatedUser(
	user: typeof users.$inferInsert,
	connection: typeof plexConnections.$inferInsert,
	session: typeof sessions.$inferInsert,
	db = getDatabase().db,
) {
	db.transaction((tx) => {
		tx.insert(users)
			.values(user)
			.onConflictDoUpdate({
				target: users.plexId,
				set: { displayName: user.displayName },
			})
			.run();
		tx.insert(plexConnections)
			.values(connection)
			.onConflictDoUpdate({
				target: plexConnections.userId,
				set: {
					clientIdentifier: connection.clientIdentifier,
					encryptedCredentials: connection.encryptedCredentials,
				},
			})
			.run();
		tx.delete(sessions).where(lte(sessions.expiresAt, Date.now())).run();
		tx.insert(sessions).values(session).run();
	});
}

export function sessionUser(tokenHash: string, db = getDatabase().db) {
	return db
		.select({ displayName: users.displayName })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(
			and(
				eq(sessions.tokenHash, tokenHash),
				gt(sessions.expiresAt, Date.now()),
			),
		)
		.get();
}

export function deleteSession(tokenHash: string, db = getDatabase().db) {
	db.delete(sessions).where(eq(sessions.tokenHash, tokenHash)).run();
}
