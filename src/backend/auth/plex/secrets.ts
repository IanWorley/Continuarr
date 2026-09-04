import { createHash, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const ALGORITHM = "AES-GCM";

export function randomSecret() {
	return randomBytes(KEY_BYTES).toString("base64url");
}

export function hashSecret(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

export async function credentialKey(
	value = process.env.CREDENTIAL_ENCRYPTION_KEY,
) {
	if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
		throw new Error(
			"CREDENTIAL_ENCRYPTION_KEY must be a 32-byte hexadecimal key",
		);
	}
	return crypto.subtle.importKey(
		"raw",
		Buffer.from(value, "hex"),
		ALGORITHM,
		false,
		["encrypt", "decrypt"],
	);
}

export async function encryptCredentials(
	key: CryptoKey,
	userId: string,
	plaintext: string,
) {
	const iv = randomBytes(IV_BYTES);
	const ciphertext = await crypto.subtle.encrypt(
		{
			name: ALGORITHM,
			iv,
			additionalData: new TextEncoder().encode(userId),
		},
		key,
		new TextEncoder().encode(plaintext),
	);
	return JSON.stringify({
		iv: iv.toString("base64url"),
		ciphertext: Buffer.from(ciphertext).toString("base64url"),
	});
}
