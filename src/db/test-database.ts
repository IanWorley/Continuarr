import { afterAll, afterEach, beforeAll } from "bun:test";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from "testcontainers";
import { createDatabase } from "~/db/database";

const POSTGRES_IMAGE = "postgres:17.6-alpine";
const POSTGRES_PORT = 5432;
const POSTGRES_READY_LOG_OCCURRENCES = 2;
const TEST_DATABASE_USER = "continuarr";
const TEST_DATABASE_PASSWORD = "test-only-password";
const CONTAINER_TIMEOUT_MS = 120_000;
const MIGRATIONS_FOLDER = "./drizzle/postgres";

export function setupTestDatabase() {
	let container: StartedTestContainer;
	let admin: ReturnType<typeof createDatabase>;
	const databases: Array<{
		name: string;
		connection: ReturnType<typeof createDatabase>;
	}> = [];
	beforeAll(async () => {
		container = await new GenericContainer(POSTGRES_IMAGE)
			.withEnvironment({
				POSTGRES_USER: TEST_DATABASE_USER,
				POSTGRES_PASSWORD: TEST_DATABASE_PASSWORD,
				POSTGRES_DB: "postgres",
			})
			.withExposedPorts(POSTGRES_PORT)
			.withWaitStrategy(
				Wait.forLogMessage(
					"database system is ready to accept connections",
					POSTGRES_READY_LOG_OCCURRENCES,
				),
			)
			.start();
		admin = createDatabase(connectionUrl("postgres"));
	}, CONTAINER_TIMEOUT_MS);
	function connectionUrl(name: string) {
		return `postgresql://${TEST_DATABASE_USER}:${TEST_DATABASE_PASSWORD}@${container.getHost()}:${container.getMappedPort(POSTGRES_PORT)}/${name}`;
	}
	afterEach(async () => {
		for (const { name, connection } of databases.splice(0)) {
			await connection.client.end();
			await admin.client.query(`DROP DATABASE "${name}"`);
		}
	}, CONTAINER_TIMEOUT_MS);
	afterAll(async () => {
		await admin?.client.end();
		await container?.stop();
	}, CONTAINER_TIMEOUT_MS);
	return async () => {
		const name = `test_${randomUUID().replaceAll("-", "")}`;
		await admin.client.query(`CREATE DATABASE "${name}"`);
		const connection = createDatabase(connectionUrl(name));
		databases.push({ name, connection });
		await migrate(connection.db, { migrationsFolder: MIGRATIONS_FOLDER });
		return connection;
	};
}
