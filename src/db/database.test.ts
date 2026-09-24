import { describe, expect, it } from "bun:test";
import { applicationSettings } from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";

const createTestDatabase = setupTestDatabase();
const SAVED_SETTING = { key: "database-provider", value: "postgresql" };

describe("PostgreSQL database", () => {
	it("keeps separate installations' settings isolated", async () => {
		const first = await createTestDatabase();
		const second = await createTestDatabase();
		await first.db.insert(applicationSettings).values(SAVED_SETTING);
		expect(
			await first.db
				.select({
					key: applicationSettings.key,
					value: applicationSettings.value,
				})
				.from(applicationSettings),
		).toEqual([SAVED_SETTING]);
		expect(await second.db.select().from(applicationSettings)).toEqual([]);
	});

	it("rolls back a failed transaction without losing committed settings", async () => {
		const { db } = await createTestDatabase();
		await db.insert(applicationSettings).values(SAVED_SETTING);
		await expect(
			db.transaction(async (transaction) => {
				await transaction
					.insert(applicationSettings)
					.values({ key: "temporary", value: "uncommitted" });
				throw new Error("Stop this transaction");
			}),
		).rejects.toThrow("Stop this transaction");
		expect(
			await db
				.select({
					key: applicationSettings.key,
					value: applicationSettings.value,
				})
				.from(applicationSettings),
		).toEqual([SAVED_SETTING]);
	});
});
