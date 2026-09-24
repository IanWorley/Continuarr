import { afterEach, expect, it } from "bun:test";
import { getDatabaseUrl, getDataDirectory } from "./config";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalDataDirectory = process.env.DATA_DIRECTORY;
afterEach(() => {
	if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
	else process.env.DATABASE_URL = originalDatabaseUrl;
	if (originalDataDirectory === undefined) delete process.env.DATA_DIRECTORY;
	else process.env.DATA_DIRECTORY = originalDataDirectory;
});
it("accepts PostgreSQL URLs and rejects filesystem paths without exposing credentials", () => {
	process.env.DATABASE_URL =
		"postgresql://user:private-password@localhost/continuarr";
	expect(getDatabaseUrl()).toBe(
		"postgresql://user:private-password@localhost/continuarr",
	);
	process.env.DATABASE_URL = "./data/continuarr.db";
	expect(() => getDatabaseUrl()).toThrow(
		"DATABASE_URL must be a PostgreSQL connection URL.",
	);
	process.env.DATABASE_URL = "https://user:private-password@localhost/db";
	expect(() => getDatabaseUrl()).toThrow(
		"DATABASE_URL must be a PostgreSQL connection URL.",
	);
});
it("keeps the credential directory independent of the PostgreSQL address", () => {
	process.env.DATABASE_URL =
		"postgresql://user:private-password@remote/continuarr";
	process.env.DATA_DIRECTORY = "/tmp/continuarr-keys";
	expect(getDataDirectory()).toBe("/tmp/continuarr-keys");
	delete process.env.DATA_DIRECTORY;
	expect(getDataDirectory()).toBe("./data");
});
