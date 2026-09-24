import { beforeEach, describe, expect, it } from "bun:test";
import type { AppDatabase } from "~/db/database";
import * as schema from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";

const OWNER_ID = 1;
const SECOND_OWNER_ID = 2;
const SESSION_EXPIRY = 1_800_000_000_123;
const OWNER = { id: OWNER_ID, username: "owner", passwordHash: "test-hash" };
const SESSION = {
	tokenHash: "test-token-hash",
	administratorId: OWNER_ID,
	expiresAt: SESSION_EXPIRY,
};
const createTestDatabase = setupTestDatabase();
let db: AppDatabase;

beforeEach(async () => {
	({ db } = await createTestDatabase());
});

describe("administrator schema", () => {
	it("rejects a second installation-owner identity", async () => {
		await db.insert(schema.administrator).values(OWNER);
		await expect(
			db
				.insert(schema.administrator)
				.values({
					id: SECOND_OWNER_ID,
					username: "another-owner",
					passwordHash: "test-hash",
				})
				.execute(),
		).rejects.toThrow();
		expect(await db.select().from(schema.administrator)).toEqual([OWNER]);
	});

	it("allows only one owner when bootstrap requests race", async () => {
		const results = await Promise.all([
			db
				.insert(schema.administrator)
				.values(OWNER)
				.onConflictDoNothing()
				.returning(),
			db
				.insert(schema.administrator)
				.values({ ...OWNER, username: "other-owner" })
				.onConflictDoNothing()
				.returning(),
		]);
		expect(results.flat()).toHaveLength(1);
		expect(await db.select().from(schema.administrator)).toEqual(
			results.flat(),
		);
	});

	it("requires a session to reference the installation owner", async () => {
		await expect(
			db.insert(schema.administratorSessions).values(SESSION).execute(),
		).rejects.toThrow();
		await db.insert(schema.administrator).values(OWNER);
		await db.insert(schema.administratorSessions).values(SESSION);
		expect(await db.select().from(schema.administratorSessions)).toEqual([
			SESSION,
		]);
	});

	it("removes sessions when their owner is removed", async () => {
		await db.insert(schema.administrator).values(OWNER);
		await db.insert(schema.administratorSessions).values(SESSION);
		expect(await db.select().from(schema.administratorSessions)).toEqual([
			SESSION,
		]);
		await db.delete(schema.administrator);
		expect(await db.select().from(schema.administratorSessions)).toEqual([]);
	});
});
