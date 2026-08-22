import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";

import { getDatabaseUrl, IN_MEMORY_DATABASE_URL } from "~/db/config";
import * as schema from "~/db/schema";

const ENABLE_FOREIGN_KEYS_SQL = "PRAGMA foreign_keys = ON";

export function createDatabase(databaseUrl = getDatabaseUrl()) {
	if (databaseUrl !== IN_MEMORY_DATABASE_URL) {
		mkdirSync(dirname(resolve(databaseUrl)), { recursive: true });
	}

	const client = new Database(databaseUrl, { create: true, strict: true });
	client.run(ENABLE_FOREIGN_KEYS_SQL);

	return {
		client,
		db: drizzle({ client, schema }),
	};
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
