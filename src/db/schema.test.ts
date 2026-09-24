import { describe, expect, it } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { applicationSettings } from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";

const createTestDatabase = setupTestDatabase();
const SETTING_KEY = "database-provider";
const INITIAL_SETTING_VALUE = "postgresql";
const UPDATED_SETTING_VALUE = "postgresql-17";
const ORIGINAL_TIMESTAMP = new Date("2020-01-01T00:00:00.000Z");

describe("applicationSettings timestamps", () => {
	it("stores the same timestamp instant regardless of the session timezone", async () => {
		const { db } = await createTestDatabase();
		await db.transaction(async (transaction) => {
			await transaction.execute(sql`SET LOCAL TIME ZONE 'America/Chicago'`);
			const [inserted] = await transaction
				.insert(applicationSettings)
				.values({ key: SETTING_KEY, value: INITIAL_SETTING_VALUE })
				.returning();
			await transaction.execute(sql`SET LOCAL TIME ZONE 'UTC'`);
			const [reread] = await transaction.select().from(applicationSettings);
			const [clock] = await transaction
				.select({ now: sql`now()`.mapWith(applicationSettings.updatedAt) })
				.from(applicationSettings);
			expect(reread).toEqual({
				key: SETTING_KEY,
				value: INITIAL_SETTING_VALUE,
				createdAt: clock.now,
				updatedAt: clock.now,
			});
			expect(inserted).toEqual(reread);
		});
	});

	it("updates updatedAt and preserves createdAt for a Drizzle update", async () => {
		const { db } = await createTestDatabase();
		await db.insert(applicationSettings).values({
			key: SETTING_KEY,
			value: INITIAL_SETTING_VALUE,
			createdAt: ORIGINAL_TIMESTAMP,
			updatedAt: ORIGINAL_TIMESTAMP,
		});
		await db.transaction(async (transaction) => {
			await transaction
				.update(applicationSettings)
				.set({ value: UPDATED_SETTING_VALUE })
				.where(eq(applicationSettings.key, SETTING_KEY));
			const [updated] = await transaction.select().from(applicationSettings);
			const [clock] = await transaction
				.select({ now: sql`now()`.mapWith(applicationSettings.updatedAt) })
				.from(applicationSettings);
			expect(updated).toEqual({
				key: SETTING_KEY,
				value: UPDATED_SETTING_VALUE,
				createdAt: ORIGINAL_TIMESTAMP,
				updatedAt: clock.now,
			});
			expect(updated.updatedAt.getTime()).toBeGreaterThan(
				ORIGINAL_TIMESTAMP.getTime(),
			);
		});
	});

	it("updates updatedAt during an upsert conflict without replacing createdAt", async () => {
		const { db } = await createTestDatabase();
		await db.insert(applicationSettings).values({
			key: SETTING_KEY,
			value: INITIAL_SETTING_VALUE,
			createdAt: ORIGINAL_TIMESTAMP,
			updatedAt: ORIGINAL_TIMESTAMP,
		});
		await db.transaction(async (transaction) => {
			await transaction
				.insert(applicationSettings)
				.values({ key: SETTING_KEY, value: INITIAL_SETTING_VALUE })
				.onConflictDoUpdate({
					target: applicationSettings.key,
					set: { value: UPDATED_SETTING_VALUE },
				});
			const [clock] = await transaction
				.select({ now: sql`now()`.mapWith(applicationSettings.updatedAt) })
				.from(applicationSettings);
			expect(await transaction.select().from(applicationSettings)).toEqual([
				{
					key: SETTING_KEY,
					value: UPDATED_SETTING_VALUE,
					createdAt: ORIGINAL_TIMESTAMP,
					updatedAt: clock.now,
				},
			]);
		});
	});
});
