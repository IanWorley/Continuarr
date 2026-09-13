import {
	createCipheriv,
	createDecipheriv,
	createSecretKey,
	randomBytes,
} from "node:crypto";
import { inspect } from "node:util";

const ALGORITHM = "aes-256-gcm";
export const CREDENTIAL_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";
const ENVELOPE_PARTS = 4;
const REDACTED = "[REDACTED]";
const AAD_NAMESPACE = "continuarr:credential";
const KEY_ERROR =
	"CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte key";
const STORAGE_ERROR = "Unable to process stored credential";

/** Plaintext must be explicitly revealed only when calling a media server. */
export class Secret {
	#value: string;

	constructor(value: string) {
		this.#value = value;
	}

	reveal(): string {
		return this.#value;
	}

	toJSON(): string {
		return REDACTED;
	}

	toString(): string {
		return REDACTED;
	}

	[inspect.custom](): string {
		return REDACTED;
	}
}

function decodeBase64(value: string): Buffer {
	const decoded = Buffer.from(value, "base64");
	if (decoded.toString("base64") !== value) {
		throw new Error(STORAGE_ERROR);
	}
	return decoded;
}

/** The identity must be the stable, unique connection ID from the caller's record. */
function associatedData(connectionId: string): Buffer {
	if (typeof connectionId !== "string" || connectionId.length === 0) {
		throw new Error(STORAGE_ERROR);
	}
	return Buffer.from(JSON.stringify([AAD_NAMESPACE, VERSION, connectionId]));
}

export function createSecretStorage(
	encodedKey: string | undefined = process.env.CREDENTIAL_ENCRYPTION_KEY,
) {
	const key = (() => {
		try {
			if (!encodedKey) throw new Error(KEY_ERROR);
			const bytes = decodeBase64(encodedKey);
			if (bytes.length !== CREDENTIAL_KEY_BYTES) throw new Error(KEY_ERROR);
			return createSecretKey(bytes);
		} catch {
			throw new Error(KEY_ERROR);
		}
	})();

	return {
		encrypt(connectionId: string, secret: Secret): string {
			try {
				const nonce = randomBytes(NONCE_BYTES);
				const cipher = createCipheriv(ALGORITHM, key, nonce, {
					authTagLength: TAG_BYTES,
				});
				cipher.setAAD(associatedData(connectionId));
				const ciphertext = Buffer.concat([
					cipher.update(secret.reveal(), "utf8"),
					cipher.final(),
				]);
				return [
					VERSION,
					nonce.toString("base64"),
					ciphertext.toString("base64"),
					cipher.getAuthTag().toString("base64"),
				].join(":");
			} catch {
				// Never attach causes: provider errors may include sensitive inputs.
				throw new Error(STORAGE_ERROR);
			}
		},

		decrypt(connectionId: string, stored: string): Secret {
			try {
				const parts = stored.split(":");
				const [version, encodedNonce, encodedCiphertext, encodedTag] = parts;
				if (parts.length !== ENVELOPE_PARTS || version !== VERSION)
					throw new Error(STORAGE_ERROR);
				const nonce = decodeBase64(encodedNonce);
				const ciphertext = decodeBase64(encodedCiphertext);
				const tag = decodeBase64(encodedTag);
				if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES)
					throw new Error(STORAGE_ERROR);
				const decipher = createDecipheriv(ALGORITHM, key, nonce, {
					authTagLength: TAG_BYTES,
				});
				decipher.setAAD(associatedData(connectionId));
				decipher.setAuthTag(tag);
				const plaintext = Buffer.concat([
					decipher.update(ciphertext),
					decipher.final(),
				]);
				return new Secret(plaintext.toString("utf8"));
			} catch {
				throw new Error(STORAGE_ERROR);
			}
		},
	};
}
