/// <reference types="bun" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";

import {
	findApplicationSetting,
	saveApplicationSetting,
} from "~/backend/shared/repo";
import { IN_MEMORY_DATABASE_URL } from "~/db/config";
import * as schema from "~/db/schema";

const SETTING_KEY = "database-provider";
const INITIAL_SETTING_VALUE = "sqlite";
const UPDATED_SETTING_VALUE = "better-sqlite3";
const ORIGINAL_TIMESTAMP = new Date("2024-01-01T00:00:00.000Z");
const CREATE_APPLICATION_SETTINGS_TABLE_SQL = `
	CREATE TABLE application_settings (
		key text PRIMARY KEY NOT NULL,
		value text NOT NULL,
		created_at integer DEFAULT (unixepoch()) NOT NULL,
		updated_at integer DEFAULT (unixepoch()) NOT NULL
	)
`;

let client: InstanceType<typeof Database>;
let db: ReturnType<typeof drizzle<typeof schema>>;

beforeEach(() => {
	client = new Database(IN_MEMORY_DATABASE_URL);
	client.exec(CREATE_APPLICATION_SETTINGS_TABLE_SQL);
	db = drizzle({ client, schema });
});

afterEach(() => {
	client.close();
});

describe("application settings repository", () => {
	it("inserts a setting", () => {
		const savedSetting = saveApplicationSetting(
			SETTING_KEY,
			INITIAL_SETTING_VALUE,
			db,
		);

		expect(savedSetting).toMatchObject({
			key: SETTING_KEY,
			value: INITIAL_SETTING_VALUE,
		});
		expect(
			db
				.select()
				.from(schema.applicationSettings)
				.where(eq(schema.applicationSettings.key, SETTING_KEY))
				.get(),
		).toEqual(savedSetting);
	});

	it("reads an existing setting", () => {
		db.insert(schema.applicationSettings)
			.values({ key: SETTING_KEY, value: INITIAL_SETTING_VALUE })
			.run();

		expect(findApplicationSetting(SETTING_KEY, db)).toMatchObject({
			key: SETTING_KEY,
			value: INITIAL_SETTING_VALUE,
		});
	});

	it("updates the value and updatedAt without changing createdAt", () => {
		db.insert(schema.applicationSettings)
			.values({
				key: SETTING_KEY,
				value: INITIAL_SETTING_VALUE,
				createdAt: ORIGINAL_TIMESTAMP,
				updatedAt: ORIGINAL_TIMESTAMP,
			})
			.run();

		const updatedSetting = saveApplicationSetting(
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
});
