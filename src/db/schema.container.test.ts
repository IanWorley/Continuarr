/// <reference types="bun" />

import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";

const SQLITE_IMAGE =
	"keinos/sqlite3:3.53.4@sha256:6addaf450aea7e098e7d6f059d43501c317ec70494c1ace3cc94bfe1631cbfa5";
const MIGRATIONS_FOLDER = fileURLToPath(
	new URL("../../drizzle", import.meta.url),
);
const CONTAINER_MIGRATIONS_FOLDER = "/migrations";
const CONTAINER_DATABASE_FILE = "/tmp/continuarr.db";
const CONTAINER_READY_MESSAGE = "sqlite-ready";
const CONTAINER_TEST_TIMEOUT_MS = 120_000;
const EXPECTED_SETTING = {
	key: "database-provider",
	value: "sqlite",
};
const INITIAL_MIGRATION_FILE = "0000_initial.sql";
const TIMESTAMP_MIGRATION_FILE = "0001_flippant_mariko_yashida.sql";

async function startSqliteContainer() {
	return new GenericContainer(SQLITE_IMAGE)
		.withCommand([
			"/bin/sh",
			"-c",
			`echo ${CONTAINER_READY_MESSAGE} && tail -f /dev/null`,
		])
		.withCopyDirectoriesToContainer([
			{
				source: MIGRATIONS_FOLDER,
				target: CONTAINER_MIGRATIONS_FOLDER,
			},
		])
		.withWaitStrategy(Wait.forLogMessage(CONTAINER_READY_MESSAGE))
		.start();
}

describe("SQLite schema migrations", () => {
	it(
		"applies every generated migration in an isolated container",
		async () => {
			const container = await startSqliteContainer();

			try {
				const migrationResult = await container.exec([
					"/bin/sh",
					"-c",
					`cat ${CONTAINER_MIGRATIONS_FOLDER}/*.sql | sqlite3 ${CONTAINER_DATABASE_FILE}`,
				]);

				expect(migrationResult.exitCode).toBe(0);

				const queryResult = await container.exec([
					"sqlite3",
					"-json",
					CONTAINER_DATABASE_FILE,
					`INSERT INTO application_settings (key, value) VALUES ('${EXPECTED_SETTING.key}', '${EXPECTED_SETTING.value}'); SELECT key, value FROM application_settings;`,
				]);

				expect(queryResult.exitCode).toBe(0);
				expect(JSON.parse(queryResult.output)).toEqual([EXPECTED_SETTING]);
			} finally {
				await container.stop();
			}
		},
		CONTAINER_TEST_TIMEOUT_MS,
	);

	it(
		"preserves existing settings when adding timestamps",
		async () => {
			const container = await startSqliteContainer();

			try {
				const initialMigrationResult = await container.exec([
					"/bin/sh",
					"-c",
					`cat ${CONTAINER_MIGRATIONS_FOLDER}/${INITIAL_MIGRATION_FILE} | sqlite3 ${CONTAINER_DATABASE_FILE}`,
				]);
				expect(initialMigrationResult.exitCode).toBe(0);

				const insertResult = await container.exec([
					"sqlite3",
					CONTAINER_DATABASE_FILE,
					`INSERT INTO application_settings (key, value) VALUES ('${EXPECTED_SETTING.key}', '${EXPECTED_SETTING.value}');`,
				]);
				expect(insertResult.exitCode).toBe(0);

				const timestampMigrationResult = await container.exec([
					"/bin/sh",
					"-c",
					`cat ${CONTAINER_MIGRATIONS_FOLDER}/${TIMESTAMP_MIGRATION_FILE} | sqlite3 ${CONTAINER_DATABASE_FILE}`,
				]);
				expect(timestampMigrationResult.exitCode).toBe(0);

				const queryResult = await container.exec([
					"sqlite3",
					"-json",
					CONTAINER_DATABASE_FILE,
					"SELECT key, value, typeof(created_at) AS created_at_type, typeof(updated_at) AS updated_at_type FROM application_settings;",
				]);
				expect(queryResult.exitCode).toBe(0);
				expect(JSON.parse(queryResult.output)).toEqual([
					{
						...EXPECTED_SETTING,
						created_at_type: "integer",
						updated_at_type: "integer",
					},
				]);
			} finally {
				await container.stop();
			}
		},
		CONTAINER_TEST_TIMEOUT_MS,
	);
});
