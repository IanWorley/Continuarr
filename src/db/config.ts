export const DEFAULT_DATABASE_URL = "./data/continuarr.db";
export const IN_MEMORY_DATABASE_URL = ":memory:";

export function getDatabaseUrl() {
	return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}
