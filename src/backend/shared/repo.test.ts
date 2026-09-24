/// <reference types="bun" />

import { beforeEach, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import {
	findApplicationSetting,
	getOrCreateApplicationSetting,
	saveApplicationSetting,
} from "~/backend/shared/repo";
import type { AppDatabase } from "~/db/database";
import * as schema from "~/db/schema";
import { setupTestDatabase } from "~/db/test-database";

const SETTING_KEY = "database-provider";
const INITIAL_SETTING_VALUE = "postgres";
const UPDATED_SETTING_VALUE = "postgresql";
const ORIGINAL_TIMESTAMP = new Date("2024-01-01T00:00:00.000Z");
const createTestDatabase = setupTestDatabase();
let db: AppDatabase;

beforeEach(async () => {
	({ db } = await createTestDatabase());
});

describe("application settings repository", () => {
	it("inserts a setting", async () => {
		const savedSetting = await saveApplicationSetting(
			SETTING_KEY,
			INITIAL_SETTING_VALUE,
			db,
		);

		expect(savedSetting).toMatchObject({
			key: SETTING_KEY,
			value: INITIAL_SETTING_VALUE,
		});
		const [stored] = await db
			.select()
			.from(schema.applicationSettings)
			.where(eq(schema.applicationSettings.key, SETTING_KEY));
		expect(stored).toEqual(savedSetting);
	});

	it("reads an existing setting", async () => {
		await db
			.insert(schema.applicationSettings)
			.values({ key: SETTING_KEY, value: INITIAL_SETTING_VALUE });

		expect(await findApplicationSetting(SETTING_KEY, db)).toMatchObject({
			key: SETTING_KEY,
			value: INITIAL_SETTING_VALUE,
		});
	});

	it("updates the value and updatedAt without changing createdAt", async () => {
		await db.insert(schema.applicationSettings).values({
			key: SETTING_KEY,
			value: INITIAL_SETTING_VALUE,
			createdAt: ORIGINAL_TIMESTAMP,
			updatedAt: ORIGINAL_TIMESTAMP,
		});

		const updatedSetting = await saveApplicationSetting(
			SETTING_KEY,
			UPDATED_SETTING_VALUE,
			db,
		);

		expect(updatedSetting.value).toBe(UPDATED_SETTING_VALUE);
		expect(updatedSetting.createdAt).toEqual(ORIGINAL_TIMESTAMP);
		expect(updatedSetting.updatedAt.getTime()).toBeGreaterThan(
			ORIGINAL_TIMESTAMP.getTime(),
		);
	});

	it("keeps the first value when concurrent callers initialize a setting", async () => {
		const settings = await Promise.all([
			getOrCreateApplicationSetting(SETTING_KEY, "first", db),
			getOrCreateApplicationSetting(SETTING_KEY, "second", db),
		]);
		expect(settings[0].value).toBe(settings[1].value);
		expect((await findApplicationSetting(SETTING_KEY, db))?.value).toBe(
			settings[0].value,
		);
	});
});
