import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "~/db/schema";

const OWNER_ID = 1;
const SECOND_OWNER_ID = 2;
const SESSION_EXPIRY = 1_800_000_000;
let client: Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	client = new Database(":memory:");
	client.exec("PRAGMA foreign_keys = ON");
	db = drizzle({ client, schema });
	migrate(db, { migrationsFolder: "drizzle" });
});
afterEach(() => client.close());

describe("administrator schema", () => {
	it("rejects a second installation-owner identity", () => {
		db.insert(schema.administrator)
			.values({ id: OWNER_ID, username: "owner", passwordHash: "test-hash" })
			.run();
		expect(() =>
			db
				.insert(schema.administrator)
				.values({
					id: SECOND_OWNER_ID,
					username: "another-owner",
					passwordHash: "test-hash",
				})
				.run(),
		).toThrow();
		expect(db.select().from(schema.administrator).all()).toHaveLength(1);
	});

	it("requires a session to reference the installation owner", () => {
		expect(() =>
			db
				.insert(schema.administratorSessions)
				.values({
					tokenHash: "test-token-hash",
					administratorId: OWNER_ID,
					expiresAt: SESSION_EXPIRY,
				})
				.run(),
		).toThrow();
	});

	it("removes sessions when their owner is removed", () => {
		db.insert(schema.administrator)
			.values({ id: OWNER_ID, username: "owner", passwordHash: "test-hash" })
			.run();
		db.insert(schema.administratorSessions)
			.values({
				tokenHash: "test-token-hash",
				administratorId: OWNER_ID,
				expiresAt: SESSION_EXPIRY,
			})
			.run();
		db.delete(schema.administrator).run();
		expect(db.select().from(schema.administratorSessions).all()).toHaveLength(
			0,
		);
	});
});
