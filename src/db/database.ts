import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { ensureDatabaseDirectory, getDatabaseUrl } from "~/db/config";
import * as schema from "~/db/schema";

const ENABLE_FOREIGN_KEYS_SQL = "PRAGMA foreign_keys = ON";

const globalForDb = globalThis as typeof globalThis & {
	databaseConnection?: ReturnType<typeof createDatabase>;
};

export function createDatabase(databaseUrl = getDatabaseUrl()) {
	ensureDatabaseDirectory(databaseUrl);
	const client = new Database(databaseUrl);
	client.exec(ENABLE_FOREIGN_KEYS_SQL);
	return {
		client,
		db: drizzle({ client, schema }),
	};
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;

export function getDatabase() {
	if (!globalForDb.databaseConnection) {
		globalForDb.databaseConnection = createDatabase();
	}

	return globalForDb.databaseConnection;
}
