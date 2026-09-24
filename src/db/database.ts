import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseUrl } from "~/db/config";
import * as schema from "~/db/schema";

const DATABASE_POOL_SIZE = 10;
const CONNECTION_TIMEOUT_MS = 10_000;
export function createDatabase(databaseUrl = getDatabaseUrl()) {
	const client = new Pool({
		connectionString: databaseUrl,
		max: DATABASE_POOL_SIZE,
		connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
	});
	client.on("error", () => {
		console.error(
			"An idle PostgreSQL connection failed. The pool will reconnect on the next request.",
		);
	});
	return { client, db: drizzle({ client, schema }) };
}
export type AppDatabase = ReturnType<typeof createDatabase>["db"];
declare global {
	var continuarrPostgres: ReturnType<typeof createDatabase> | undefined;
}
export function getDatabase() {
	globalThis.continuarrPostgres ??= createDatabase();
	return globalThis.continuarrPostgres;
}
