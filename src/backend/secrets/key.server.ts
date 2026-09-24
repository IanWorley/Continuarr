import { randomBytes } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getDataDirectory } from "~/db/config";
import { CREDENTIAL_KEY_BYTES, createSecretStorage } from "./storage";

const KEY_FILENAME = "credential-encryption.key";
const KEY_FILE_MODE = 0o600;
const GROUP_OTHER_PERMISSIONS = 0o077;
const KEY_FILE_ERROR =
	"Credential key must be a regular file owned by the service user with no group or other permissions";

function readSavedKey(keyPath: string): string {
	const flags =
		process.platform === "win32"
			? constants.O_RDONLY
			: constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
	const descriptor = openSync(keyPath, flags);
	try {
		// Inspect the opened file so a path replacement cannot bypass validation.
		const metadata = fstatSync(descriptor);
		if (
			!metadata.isFile() ||
			(process.platform !== "win32" &&
				(metadata.uid !== process.geteuid?.() ||
					(metadata.mode & GROUP_OTHER_PERMISSIONS) !== 0))
		) {
			throw new Error(KEY_FILE_ERROR);
		}
		return readFileSync(descriptor, "utf8");
	} finally {
		closeSync(descriptor);
	}
}

export function loadCredentialEncryptionKey(
	deploymentKey = process.env.CREDENTIAL_ENCRYPTION_KEY,
	dataDirectory = getDataDirectory(),
): string {
	if (deploymentKey) {
		createSecretStorage(deploymentKey);
		return deploymentKey;
	}

	const directory = resolve(dataDirectory);
	const keyPath = join(directory, KEY_FILENAME);
	let encodedKey: string;
	try {
		encodedKey = readSavedKey(keyPath);
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
			encodedKey = readSavedKey(keyPath);
		}
	}
	createSecretStorage(encodedKey);
	return encodedKey;
}
