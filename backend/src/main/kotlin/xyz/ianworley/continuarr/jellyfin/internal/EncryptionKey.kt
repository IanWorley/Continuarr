package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.security.crypto.encrypt.AesGcmBytesEncryptor
import java.util.HexFormat
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec

private const val ENCRYPTION_KEY_VARIABLE = "CONTINUARR_ENCRYPTION_KEY"

// AES-256 takes a 32-byte key, written as hex so `openssl rand -hex 32` makes one.
private const val AES_KEY_BYTES = 32
private const val HEX_DIGITS_PER_BYTE = 2
private const val AES_KEY_HEX_LENGTH = AES_KEY_BYTES * HEX_DIGITS_PER_BYTE
private const val AES_ALGORITHM = "AES"

/**
 * Bound from `CONTINUARR_ENCRYPTION_KEY`. Blank means no key, so a fresh install starts and only saving a
 * secret is refused. Any other value must be exactly 64 hex characters, or the constructor throws and
 * startup fails without echoing it.
 */
@ConfigurationProperties("continuarr")
class EncryptionKeyProperties(encryptionKey: String = "") {
	val secretKey: SecretKey? = if (encryptionKey.isBlank()) null else parseSecretKey(encryptionKey)
}

private fun parseSecretKey(hex: String): SecretKey {
	require(hex.length == AES_KEY_HEX_LENGTH && hex.all { HexFormat.isHexDigit(it.code) }) {
		"$ENCRYPTION_KEY_VARIABLE must be $AES_KEY_HEX_LENGTH hex characters; generate one with `openssl rand -hex $AES_KEY_BYTES`"
	}
	return SecretKeySpec(HexFormat.of().parseHex(hex), AES_ALGORITHM)
}

/**
 * Encrypts with AES-256-GCM. Each ciphertext carries its own random IV, so saving the same key twice stores
 * different bytes. The key is random, not a password, so there is no salt and no key derivation.
 */
class ApiKeyCipher(secretKey: SecretKey) {

	private val encryptor: AesGcmBytesEncryptor = AesGcmBytesEncryptor.withSecretKey(secretKey).build()

	fun encrypt(apiKey: JellyfinApiKey): ByteArray = encryptor.encrypt(apiKey.plaintext())

	/** Null when the GCM tag doesn't verify, as when the ciphertext was made under another key. */
	// The bytes come from the database, so any failure, such as a row too short to hold the IV, means
	// "doesn't decrypt" rather than an error that would escape the adapter.
	fun decrypt(ciphertext: ByteArray): String? = try {
		String(encryptor.decrypt(ciphertext), Charsets.US_ASCII)
	} catch (_: RuntimeException) {
		null
	}
}
