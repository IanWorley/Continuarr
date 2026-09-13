import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "~/db/schema";

const CREATED_AT = 1_800_000_000;
const EXPIRES_AT = CREATED_AT + 300;
const OWNER_ID = 1;
const ATTEMPT = {
	state: "test-correlation-state",
	service: "plex" as const,
	sessionHash: "test-session-hash",
	status: "pending" as const,
	createdAt: CREATED_AT,
	expiresAt: EXPIRES_AT,
};
const PIN = {
	state: ATTEMPT.state,
	pinId: 12345,
	clientIdentifier: "test-client",
};
let client: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	client = new Database(":memory:");
	client.exec("PRAGMA foreign_keys = ON");
	db = drizzle({ client, schema });
	migrate(db, { migrationsFolder: "drizzle" });
});
afterEach(() => client.close());

it("round trips shared authorization history and its Plex details through the migrated schema", () => {
	db.insert(schema.authorizationAttempts).values(ATTEMPT).run();
	db.insert(schema.plexAuthorizationAttempts).values(PIN).run();
	expect(db.select().from(schema.authorizationAttempts).get()).toEqual({
		...ATTEMPT,
		finishedAt: null,
		failureCode: null,
	});
	expect(db.select().from(schema.plexAuthorizationAttempts).get()).toEqual(PIN);
});

it("rejects duplicate correlation state", () => {
	db.insert(schema.authorizationAttempts).values(ATTEMPT).run();
	expect(() =>
		db.insert(schema.authorizationAttempts).values(ATTEMPT).run(),
	).toThrow();
});

it("requires Plex details to belong to an attempt", () => {
	expect(() =>
		db.insert(schema.plexAuthorizationAttempts).values(PIN).run(),
	).toThrow();
});

it("retains history when the initiating administrator session is removed", () => {
	db.insert(schema.administrator)
		.values({ id: OWNER_ID, username: "owner", passwordHash: "unused" })
		.run();
	db.insert(schema.administratorSessions)
		.values({
			tokenHash: ATTEMPT.sessionHash,
			administratorId: OWNER_ID,
			expiresAt: EXPIRES_AT,
		})
		.run();
	db.insert(schema.authorizationAttempts).values(ATTEMPT).run();
	db.insert(schema.plexAuthorizationAttempts).values(PIN).run();
	db.delete(schema.administratorSessions).run();
	expect(db.select().from(schema.authorizationAttempts).get()).toMatchObject(
		ATTEMPT,
	);
	expect(db.select().from(schema.plexAuthorizationAttempts).get()).toEqual(PIN);
});
