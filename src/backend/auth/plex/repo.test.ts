import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import {
	deleteSession,
	saveAuthenticatedUser,
	saveLogin,
	sessionUser,
	takeLogin,
} from "~/backend/auth/plex/repo";
import * as schema from "~/db/schema";

const FUTURE_MS = 60_000;
function fixture() {
	const client = new Database(":memory:");
	client.exec("PRAGMA foreign_keys = ON");
	const bunDb = drizzle({ client, schema });
	migrate(bunDb, {
		migrationsFolder: fileURLToPath(
			new URL("../../../../drizzle", import.meta.url),
		),
	});
	// Both adapters execute the same synchronous SQLite queries; Bun cannot load better-sqlite3.
	const db = bunDb as unknown as NonNullable<Parameters<typeof saveLogin>[1]>;
	return { db, client };
}

describe("Plex persistence", () => {
	it("claims a browser-bound attempt once in SQLite", () => {
		const { db, client } = fixture();
		try {
			saveLogin(
				{
					state: "attempt",
					browserHash: "owner",
					clientIdentifier: "device",
					pinId: 1,
					expiresAt: Date.now() + FUTURE_MS,
				},
				db,
			);
			expect(takeLogin("attempt", "other", db)).toBeUndefined();
			expect(takeLogin("attempt", "owner", db)?.pinId).toBe(1);
			expect(takeLogin("attempt", "owner", db)).toBeUndefined();
		} finally {
			client.close();
		}
	});
	it("resolves and revokes sessions independently for two users", () => {
		const { db, client } = fixture();
		try {
			for (const [id, plexId] of [
				["alice", 101],
				["bob", 202],
			] as const) {
				saveAuthenticatedUser(
					{ id, plexId, displayName: id },
					{
						userId: id,
						clientIdentifier: id,
						encryptedCredentials: `encrypted-${id}`,
					},
					{ userId: id, tokenHash: id, expiresAt: Date.now() + FUTURE_MS },
					db,
				);
			}
			expect(sessionUser("alice", db)).toEqual({ displayName: "alice" });
			expect(sessionUser("bob", db)).toEqual({ displayName: "bob" });
			deleteSession("alice", db);
			expect(sessionUser("alice", db)).toBeUndefined();
			expect(sessionUser("bob", db)).toEqual({ displayName: "bob" });
		} finally {
			client.close();
		}
	});
	it("rejects expired sessions", () => {
		const { db, client } = fixture();
		try {
			saveAuthenticatedUser(
				{ id: "alice", plexId: 101, displayName: "Alice" },
				{
					userId: "alice",
					clientIdentifier: "device",
					encryptedCredentials: "encrypted",
				},
				{ userId: "alice", tokenHash: "expired", expiresAt: Date.now() - 1 },
				db,
			);
			expect(sessionUser("expired", db)).toBeUndefined();
		} finally {
			client.close();
		}
	});
});
