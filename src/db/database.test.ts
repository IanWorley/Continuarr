/// <reference types="bun" />

import { Database } from "bun:sqlite";
import { describe, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

import { IN_MEMORY_DATABASE_URL } from "~/db/config";
import * as schema from "~/db/schema";

const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
);

describe("Drizzle database", () => {
	it("applies migrations", async () => {
		const client = new Database(IN_MEMORY_DATABASE_URL, {
			create: true,
			strict: true,
		});
		const db = drizzle({ client, schema });

		try {
			migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
		} finally {
			client.close();
		}
	});
});
