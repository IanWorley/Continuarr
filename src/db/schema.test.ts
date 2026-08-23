/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { applicationSettings } from "~/db/schema";

const SETTING_KEY = "database-provider";
const INITIAL_SETTING_VALUE = "sqlite";
const UPDATED_SETTING_VALUE = "better-sqlite3";
const UTC_TIMESTAMP_SQL = "(unixepoch())";

const db = drizzle.mock({ schema: { applicationSettings } });

describe("applicationSettings timestamps", () => {
	it("uses UTC defaults when inserting a setting", () => {
		const query = db
			.insert(applicationSettings)
			.values({ key: SETTING_KEY, value: INITIAL_SETTING_VALUE })
			.toSQL();

		expect(query.sql.match(/\(unixepoch\(\)\)/g)).toHaveLength(2);
	});

	it("updates updatedAt and preserves createdAt for a Drizzle update", () => {
		const query = db
			.update(applicationSettings)
			.set({ value: UPDATED_SETTING_VALUE })
			.where(eq(applicationSettings.key, SETTING_KEY))
			.toSQL();

		expect(query.sql).toContain(`"updated_at" = ${UTC_TIMESTAMP_SQL}`);
		expect(query.sql).not.toContain('"created_at" =');
	});

	it("updates updatedAt during an upsert conflict", () => {
		const query = db
			.insert(applicationSettings)
			.values({ key: SETTING_KEY, value: INITIAL_SETTING_VALUE })
			.onConflictDoUpdate({
				target: applicationSettings.key,
				set: { value: UPDATED_SETTING_VALUE },
			})
			.toSQL();

		expect(query.sql).toContain(`"updated_at" = ${UTC_TIMESTAMP_SQL}`);
	});
});
