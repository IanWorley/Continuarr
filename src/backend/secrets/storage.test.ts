import { afterEach, describe, expect, it } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import Elysia from "elysia";
import { createSecretStorage, Secret } from "./storage";

const KEY_BYTES = 32;
const CONNECTION_ID = "plex-connection-1";
const OTHER_CONNECTION_ID = "plex-connection-2";
const TOKEN = "private-media-token-🔑";
const REDACTED = "[REDACTED]";
const FAILURE = "Unable to process stored credential";
const KEY_FAILURE =
	"CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key";
const key = randomBytes(KEY_BYTES).toString("base64");
const storage = createSecretStorage(key);

function encrypt() {
	return storage.encrypt(CONNECTION_ID, new Secret(TOKEN));
}

describe("credential storage", () => {
	it.each([TOKEN, "", "token with\nnewlines"])("round trips %s", (value) => {
		const stored = storage.encrypt(CONNECTION_ID, new Secret(value));
		expect(
			createSecretStorage(key).decrypt(CONNECTION_ID, stored).reveal(),
		).toBe(value);
	});

	it("uses a fresh nonce for identical input", () => {
		const first = encrypt();
		const second = encrypt();
		expect(first).not.toBe(second);
		expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
	});

	it.each([1, 2, 3])(
		"rejects tampering with envelope component %s",
		(index) => {
			const parts = encrypt().split(":");
			const bytes = Buffer.from(parts[index], "base64");
			bytes[0] ^= 1;
			parts[index] = bytes.toString("base64");
			expect(() => storage.decrypt(CONNECTION_ID, parts.join(":"))).toThrow(
				FAILURE,
			);
		},
	);

	it("rejects a different key", () => {
		const other = createSecretStorage(
			randomBytes(KEY_BYTES).toString("base64"),
		);
		expect(() => other.decrypt(CONNECTION_ID, encrypt())).toThrow(FAILURE);
	});

	it("rejects swapping credentials between records", () => {
		const first = encrypt();
		const second = storage.encrypt(
			OTHER_CONNECTION_ID,
			new Secret("other-token"),
		);
		expect(() => storage.decrypt(OTHER_CONNECTION_ID, first)).toThrow(FAILURE);
		expect(() => storage.decrypt(CONNECTION_ID, second)).toThrow(FAILURE);
	});

	it.each(["", TOKEN, "v2:a:b:c", "v1:a:b:c", "v1::::", "v1:::"])(
		"rejects malformed storage %s without disclosing input",
		(stored) => {
			expect(() => storage.decrypt(CONNECTION_ID, stored)).toThrow(FAILURE);
		},
	);

	it("requires a connection identity", () => {
		expect(() => storage.encrypt("", new Secret(TOKEN))).toThrow(FAILURE);
		expect(() => storage.decrypt("", encrypt())).toThrow(FAILURE);
	});

	it.each([
		"",
		TOKEN,
		randomBytes(KEY_BYTES - 1).toString("base64"),
		`${key}\n`,
		key.replace(/=+$/, ""),
	])(
		"rejects invalid deployment keys without disclosing them",
		(invalidKey) => {
			expect(() => createSecretStorage(invalidKey)).toThrow(KEY_FAILURE);
		},
	);

	it("redacts decrypted secrets in serialization and inspection", () => {
		const secret = storage.decrypt(CONNECTION_ID, encrypt());
		expect(JSON.stringify({ secret })).toBe(
			JSON.stringify({ secret: REDACTED }),
		);
		expect(String(secret)).toBe(REDACTED);
		expect(inspect(secret)).toBe(REDACTED);
		expect(JSON.stringify({ ...secret })).toBe("{}");
	});

	it("redacts secrets in serialized HTTP responses", async () => {
		const api = new Elysia().get("/credential", () => ({
			token: storage.decrypt(CONNECTION_ID, encrypt()),
		}));
		const response = await api.handle(
			new Request("http://localhost/credential"),
		);
		expect(await response.json()).toEqual({ token: REDACTED });
	});

	it("does not propagate sensitive causes into errors or HTTP responses", async () => {
		const secret = new Secret(TOKEN);
		secret.reveal = () => {
			throw new Error(TOKEN);
		};
		try {
			storage.encrypt(CONNECTION_ID, secret);
			throw new Error("Expected encryption failure");
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe(FAILURE);
			expect((error as Error).cause).toBeUndefined();
			expect(inspect(error)).not.toContain(TOKEN);
		}
		const api = new Elysia().get("/credential", () =>
			storage.encrypt(CONNECTION_ID, secret),
		);
		const response = await api.handle(
			new Request("http://localhost/credential"),
		);
		expect(response.status).toBe(500);
		expect(await response.text()).not.toContain(TOKEN);
	});
});

describe("server startup", () => {
	const directories: string[] = [];
	afterEach(() => {
		for (const directory of directories.splice(0))
			rmSync(directory, { recursive: true, force: true });
	});
	it.each(["", "invalid", key])(
		"validates deployment configuration before serving requests (%#)",
		(deploymentKey) => {
			const directory = mkdtempSync(join(tmpdir(), "continuarr-startup-"));
			directories.push(directory);
			const result = Bun.spawnSync(
				[process.execPath, "-e", 'await import("./src/backend/api.server.ts")'],
				{
					cwd: process.cwd(),
					env: {
						...process.env,
						CREDENTIAL_ENCRYPTION_KEY: deploymentKey,
						DATABASE_URL: join(directory, "app.db"),
					},
				},
			);
			if (deploymentKey !== "invalid") {
				expect(result.exitCode).toBe(0);
			} else {
				expect(result.exitCode).not.toBe(0);
				expect(result.stderr.toString()).toContain(KEY_FAILURE);
			}
		},
	);
});
