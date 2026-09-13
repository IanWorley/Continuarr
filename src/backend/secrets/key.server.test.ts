import { afterEach, beforeEach, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCredentialEncryptionKey } from "./key.server";
import { CREDENTIAL_KEY_BYTES, createSecretStorage, Secret } from "./storage";

const PERMISSION_MASK = 0o777;
const OWNER_READ_WRITE = 0o600;
const GROUP_READ = 0o040;
const OTHER_WRITE = 0o002;
let directory: string;
let databaseUrl: string;
let keyPath: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "continuarr-key-"));
	databaseUrl = join(directory, "app.db");
	keyPath = join(directory, "credential-encryption.key");
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

it("persists a generated key so credentials survive later starts", () => {
	const firstKey = loadCredentialEncryptionKey("", databaseUrl);
	const encrypted = createSecretStorage(firstKey).encrypt(
		"connection",
		new Secret("token"),
	);
	const nextKey = loadCredentialEncryptionKey("", databaseUrl);
	expect(readFileSync(keyPath, "utf8")).toBe(firstKey);
	expect(Buffer.from(firstKey, "base64").length).toBe(CREDENTIAL_KEY_BYTES);
	expect(nextKey).toBe(firstKey);
	expect(
		createSecretStorage(nextKey).decrypt("connection", encrypted).reveal(),
	).toBe("token");
});

it.skipIf(process.platform === "win32")(
	"creates an owner-only key file",
	() => {
		loadCredentialEncryptionKey("", databaseUrl);
		expect(statSync(keyPath).mode & PERMISSION_MASK).toBe(OWNER_READ_WRITE);
	},
);

it("creates the database directory on first startup", () => {
	const nestedDatabase = join(directory, "nested", "app.db");
	const key = loadCredentialEncryptionKey("", nestedDatabase);
	expect(
		readFileSync(
			join(directory, "nested", "credential-encryption.key"),
			"utf8",
		),
	).toBe(key);
});

it.each(["", "invalid"])(
	"refuses to replace an invalid saved key (%#)",
	(invalidKey) => {
		writeFileSync(keyPath, invalidKey, { mode: OWNER_READ_WRITE });
		expect(() => loadCredentialEncryptionKey("", databaseUrl)).toThrow(
			"CREDENTIAL_ENCRYPTION_KEY must be",
		);
		expect(readFileSync(keyPath, "utf8")).toBe(invalidKey);
	},
);

it("uses an explicit deployment key without generating a file", () => {
	const key = randomBytes(CREDENTIAL_KEY_BYTES).toString("base64");
	expect(loadCredentialEncryptionKey(key, databaseUrl)).toBe(key);
	expect(existsSync(keyPath)).toBe(false);
});

it("does not replace the saved key when an override is provided", () => {
	const savedKey = loadCredentialEncryptionKey("", databaseUrl);
	const override = randomBytes(CREDENTIAL_KEY_BYTES).toString("base64");
	expect(loadCredentialEncryptionKey(override, databaseUrl)).toBe(override);
	expect(readFileSync(keyPath, "utf8")).toBe(savedKey);
});

it("rejects an invalid override without generating a fallback key", () => {
	expect(() => loadCredentialEncryptionKey("invalid", databaseUrl)).toThrow(
		"CREDENTIAL_ENCRYPTION_KEY must be",
	);
	expect(existsSync(keyPath)).toBe(false);
});

it.skipIf(process.platform === "win32")(
	"rejects keys accessible to another OS user without changing them",
	() => {
		const key = loadCredentialEncryptionKey("", databaseUrl);
		for (const permission of [GROUP_READ, OTHER_WRITE]) {
			chmodSync(keyPath, OWNER_READ_WRITE | permission);
			expect(() => loadCredentialEncryptionKey("", databaseUrl)).toThrow(
				"no group or other permissions",
			);
			expect(readFileSync(keyPath, "utf8")).toBe(key);
		}
	},
);

it.skipIf(process.platform === "win32")(
	"rejects symbolic links to otherwise valid keys",
	() => {
		const targetDatabase = join(directory, "target", "app.db");
		const key = loadCredentialEncryptionKey("", targetDatabase);
		const targetKey = join(directory, "target", "credential-encryption.key");
		symlinkSync(targetKey, keyPath);
		expect(() => loadCredentialEncryptionKey("", databaseUrl)).toThrow();
		expect(readFileSync(targetKey, "utf8")).toBe(key);
	},
);

it("rejects a directory in place of a key file", () => {
	mkdirSync(keyPath);
	expect(() => loadCredentialEncryptionKey("", databaseUrl)).toThrow();
	expect(statSync(keyPath).isDirectory()).toBe(true);
});
