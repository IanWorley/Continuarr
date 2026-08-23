import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_DATABASE_URL = "./data/continuarr.db";
export const IN_MEMORY_DATABASE_URL = ":memory:";

export function getDatabaseUrl() {
	return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

export function ensureDatabaseDirectory(databaseUrl = getDatabaseUrl()) {
	if (databaseUrl === IN_MEMORY_DATABASE_URL) {
		return databaseUrl;
	}

	mkdirSync(dirname(resolve(databaseUrl)), { recursive: true });
	return databaseUrl;
}
