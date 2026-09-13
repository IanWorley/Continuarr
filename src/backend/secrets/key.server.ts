import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	DEFAULT_DATABASE_URL,
	getDatabaseUrl,
	IN_MEMORY_DATABASE_URL,
} from "~/db/config";
import { CREDENTIAL_KEY_BYTES, createSecretStorage } from "./storage";

const KEY_FILENAME = "credential-encryption.key";
const KEY_FILE_MODE = 0o600;

export function loadCredentialEncryptionKey(
	deploymentKey = process.env.CREDENTIAL_ENCRYPTION_KEY,
	databaseUrl = getDatabaseUrl(),
): string {
	if (deploymentKey) {
		createSecretStorage(deploymentKey);
		return deploymentKey;
	}

	const directory = dirname(
		resolve(
			databaseUrl === IN_MEMORY_DATABASE_URL
				? DEFAULT_DATABASE_URL
				: databaseUrl,
		),
	);
	const keyPath = join(directory, KEY_FILENAME);
	let encodedKey: string;
	try {
		encodedKey = readFileSync(keyPath, "utf8");
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			error.code !== "ENOENT"
		) {
			throw error;
		}
		mkdirSync(directory, { recursive: true });
		encodedKey = randomBytes(CREDENTIAL_KEY_BYTES).toString("base64");
		// Exclusive creation prevents another startup from replacing the key.
		try {
			writeFileSync(keyPath, encodedKey, {
				flag: "wx",
				mode: KEY_FILE_MODE,
				flush: true,
			});
		} catch (error) {
			if (
				!(error instanceof Error) ||
				!("code" in error) ||
				error.code !== "EEXIST"
			) {
				throw error;
			}
			encodedKey = readFileSync(keyPath, "utf8");
		}
	}
	createSecretStorage(encodedKey);
	return encodedKey;
}
