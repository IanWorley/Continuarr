import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { createPlexAttemptRepository } from "~/backend/auth/plex/repo";
import * as schema from "~/db/schema";

const NOW = 1_800_000_000;
const PIN_EXPIRY = NOW + 300;
const SESSION_EXPIRY = NOW + 600;
const OWNER_ID = 1;
const SESSION = "initiating-session-hash";
const OTHER_SESSION = "other-session-hash";
const STATE = "test-state";
const CLIENT_ID = "test-client";
const PIN_ID = 12345;
let client: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReturnType<typeof createPlexAttemptRepository>;

beforeEach(() => {
	client = new Database(":memory:");
	client.exec("PRAGMA foreign_keys = ON");
	db = drizzle({ client, schema });
	migrate(db, { migrationsFolder: "drizzle" });
	db.insert(schema.administrator)
		.values({ id: OWNER_ID, username: "owner", passwordHash: "unused" })
		.run();
	db.insert(schema.administratorSessions)
		.values(
			[SESSION, OTHER_SESSION].map((tokenHash) => ({
				tokenHash,
				administratorId: OWNER_ID,
				expiresAt: SESSION_EXPIRY,
			})),
		)
		.run();
	repository = createPlexAttemptRepository(() => db);
	repository.start(STATE, SESSION, CLIENT_ID, NOW);
});
afterEach(() => client.close());

function ready() {
	expect(repository.ready(STATE, SESSION, PIN_ID, PIN_EXPIRY, NOW)).toBe(true);
}

it("persists the starting identity before a PIN is available", () => {
	expect(db.select().from(schema.authorizationAttempts).get()).toMatchObject({
		state: STATE,
		sessionHash: SESSION,
		status: "starting",
		createdAt: NOW,
	});
	expect(db.select().from(schema.plexAuthorizationAttempts).get()).toEqual({
		state: STATE,
		pinId: null,
		clientIdentifier: CLIENT_ID,
	});
	expect(repository.pending(STATE, SESSION, NOW)).toBeNull();
	expect(repository.consume(STATE, SESSION, NOW)).toBe(false);
});

it("preserves pending PINs across repository recreation and repeated reads", () => {
	ready();
	const restarted = createPlexAttemptRepository(() => db);
	expect(restarted.pending(STATE, SESSION, NOW)).toEqual({
		pinId: PIN_ID,
		clientIdentifier: CLIENT_ID,
	});
	expect(restarted.pending(STATE, SESSION, NOW)).toEqual({
		pinId: PIN_ID,
		clientIdentifier: CLIENT_ID,
	});
});

it("records terminal failure without allowing consumption or a later ready transition", () => {
	repository.fail(STATE, "plex_unavailable", NOW);
	expect(db.select().from(schema.authorizationAttempts).get()).toMatchObject({
		status: "failed",
		failureCode: "plex_unavailable",
		finishedAt: NOW,
	});
	expect(repository.ready(STATE, SESSION, PIN_ID, PIN_EXPIRY, NOW)).toBe(false);
	expect(repository.consume(STATE, SESSION, NOW)).toBe(false);
});

it("rejects a different active session without consuming the owner's attempt", () => {
	expect(repository.ready(STATE, OTHER_SESSION, PIN_ID, PIN_EXPIRY, NOW)).toBe(
		false,
	);
	ready();
	expect(repository.pending(STATE, OTHER_SESSION, NOW)).toBeNull();
	expect(repository.consume(STATE, OTHER_SESSION, NOW)).toBe(false);
	expect(repository.consume(STATE, SESSION, NOW)).toBe(true);
});

it("rejects unknown correlation state", () => {
	ready();
	expect(repository.pending("unknown", SESSION, NOW)).toBeNull();
	expect(repository.consume("unknown", SESSION, NOW)).toBe(false);
});

it("rejects a PIN at its exact expiry", () => {
	ready();
	expect(repository.pending(STATE, SESSION, PIN_EXPIRY)).toBeNull();
	expect(repository.consume(STATE, SESSION, PIN_EXPIRY)).toBe(false);
});

it("rejects revoked sessions while preserving attempt history", () => {
	ready();
	db.delete(schema.administratorSessions)
		.where(eq(schema.administratorSessions.tokenHash, SESSION))
		.run();
	expect(repository.pending(STATE, SESSION, NOW)).toBeNull();
	expect(repository.consume(STATE, SESSION, NOW)).toBe(false);
	expect(
		db.select().from(schema.authorizationAttempts).get()?.sessionHash,
	).toBe(SESSION);
});

it("rejects a session that expires before its PIN", () => {
	ready();
	db.update(schema.administratorSessions)
		.set({ expiresAt: NOW })
		.where(eq(schema.administratorSessions.tokenHash, SESSION))
		.run();
	expect(repository.pending(STATE, SESSION, NOW)).toBeNull();
	expect(repository.consume(STATE, SESSION, NOW)).toBe(false);
});

it("rejects a session revoked during PIN creation", () => {
	db.delete(schema.administratorSessions)
		.where(eq(schema.administratorSessions.tokenHash, SESSION))
		.run();
	expect(repository.ready(STATE, SESSION, PIN_ID, PIN_EXPIRY, NOW)).toBe(false);
});

it("allows only one competing consumption and rejects replay", async () => {
	ready();
	const otherRepository = createPlexAttemptRepository(() => db);
	const outcomes = await Promise.all(
		[repository, otherRepository].map(async (repo) =>
			repo.consume(STATE, SESSION, NOW),
		),
	);
	expect(outcomes.filter(Boolean)).toHaveLength(1);
	expect(repository.consume(STATE, SESSION, NOW)).toBe(false);
	expect(repository.pending(STATE, SESSION, NOW)).toBeNull();
	expect(db.select().from(schema.authorizationAttempts).get()).toMatchObject({
		status: "consumed",
		finishedAt: NOW,
	});
});

it("rolls back a partial start when Plex detail persistence fails", () => {
	const anotherState = "another-state";
	client.exec(
		"CREATE TRIGGER reject_pin BEFORE INSERT ON plex_authorization_attempts BEGIN SELECT RAISE(ABORT, 'database-error'); END;",
	);
	expect(() =>
		repository.start(anotherState, SESSION, CLIENT_ID, NOW),
	).toThrow();
	expect(
		db
			.select()
			.from(schema.authorizationAttempts)
			.where(eq(schema.authorizationAttempts.state, anotherState))
			.get(),
	).toBeUndefined();
});
