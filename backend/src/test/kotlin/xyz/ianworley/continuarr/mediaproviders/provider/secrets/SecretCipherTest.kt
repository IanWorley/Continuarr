package xyz.ianworley.continuarr.mediaproviders.provider.secrets

import java.util.HexFormat
import javax.crypto.spec.SecretKeySpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

private const val SECRET = "0123456789abcdef0123456789abcdef"
private const val AES_ALGORITHM = "AES"
private const val KEY_HEX = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
private const val OTHER_KEY_HEX = "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff000102030405060708090a0b0c0d0e0f"

// Shorter than the 16-byte IV that AES-GCM ciphertext starts with.
private val TRUNCATED_CIPHERTEXT = ByteArray(8)

private fun cipher(keyHex: String) = SecretCipher(SecretKeySpec(HexFormat.of().parseHex(keyHex), AES_ALGORITHM))

private fun plaintext(): ByteArray = SECRET.toByteArray(Charsets.US_ASCII)

class SecretCipherTest {

	@Test
	fun `decrypts what it encrypted`() {
		val cipher = cipher(KEY_HEX)

		assertEquals(SECRET, cipher.decrypt(cipher.encrypt(plaintext())))
	}

	@Test
	fun `the ciphertext doesn't contain the secret`() {
		val ciphertext = cipher(KEY_HEX).encrypt(plaintext())

		assertFalse(String(ciphertext, Charsets.ISO_8859_1).contains(SECRET))
	}

	@Test
	fun `another key decrypts to null`() {
		val ciphertext = cipher(KEY_HEX).encrypt(plaintext())

		assertNull(cipher(OTHER_KEY_HEX).decrypt(ciphertext))
	}

	@Test
	fun `a ciphertext too short to hold an IV decrypts to null`() {
		assertNull(cipher(KEY_HEX).decrypt(TRUNCATED_CIPHERTEXT))
	}
}
