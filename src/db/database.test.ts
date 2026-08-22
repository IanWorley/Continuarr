/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { IN_MEMORY_DATABASE_URL } from "~/db/config";
import { createDatabase } from "~/db/database";
import { applicationSettings } from "~/db/schema";

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
);
const DATABASE_PROVIDER_SETTING = {
	key: "database-provider",
	value: "sqlite",
};

describe("Drizzle database", () => {
	it("applies migrations and persists application settings", async () => {
		const { client, db } = createDatabase(IN_MEMORY_DATABASE_URL);

		try {
			migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
			await db.insert(applicationSettings).values(DATABASE_PROVIDER_SETTING);

			const settings = await db.select().from(applicationSettings);

			expect(settings).toEqual([DATABASE_PROVIDER_SETTING]);
		} finally {
			client.close();
		}
	});
});
