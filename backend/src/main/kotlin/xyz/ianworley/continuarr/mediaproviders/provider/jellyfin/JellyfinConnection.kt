package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import java.net.URI
import java.security.MessageDigest

private val URL_SCHEMES = setOf("http", "https")
private const val NO_PORT = -1
private const val MAX_PORT = 65_535
private val PORTS = 1..MAX_PORT
private const val CLIENT_NAME = "Continuarr"

// RestClient encodes the base URL again, so a percent-escape would reach Jellyfin encoded twice, and it
// rejects the other use of '%', an IPv6 zone ID.
private const val PERCENT = '%'

// The key sits inside a quoted header parameter, so it must be visible ASCII without a quote or backslash.
private val API_KEY_CHARACTERS = '!'..'~'
private val QUOTED_STRING_SPECIALS = setOf('"', '\\')

class JellyfinConnection(val baseUrl: URI, val apiKey: JellyfinApiKey)

/**
 * Returns null unless [raw] is an absolute http or https URL with a host, a port in range if any, and no
 * query, fragment, user info, or percent sign. Does not trim. The URL is shown back to the admin, so user
 * info is refused rather than stored.
 */
fun parseBaseUrlOrNull(raw: String): URI? {
	val uri = runCatching { URI(raw) }.getOrNull() ?: return null
	return uri.takeIf { PERCENT !in raw && it.isJellyfinBaseUrl() }
}

private fun URI.isJellyfinBaseUrl(): Boolean = isAbsolute && scheme.lowercase() in URL_SCHEMES && host != null &&
	(port == NO_PORT || port in PORTS) && rawUserInfo == null && rawQuery == null && rawFragment == null

/** Keeps the key out of logs: [toString] hides it, and only [authorizationHeader] and [plaintext] read it. */
class JellyfinApiKey private constructor(private val value: String) {

	/** Jellyfin 12 accepts the key only in the MediaBrowser scheme. */
	fun authorizationHeader(): String = """MediaBrowser Client="$CLIENT_NAME", Token="$value""""

	/** For [ApiKeyCipher] to encrypt before the key is stored. */
	fun plaintext(): ByteArray = value.toByteArray(Charsets.US_ASCII)

	/** Compares in constant time, so the response time doesn't show how much of a wrong key was right. */
	fun matches(other: JellyfinApiKey): Boolean = MessageDigest.isEqual(plaintext(), other.plaintext())

	override fun toString(): String = "JellyfinApiKey(hidden)"

	companion object {
		/** Returns null unless [raw] is non-empty visible ASCII with no quote or backslash. Does not trim. */
		fun parseOrNull(raw: String): JellyfinApiKey? =
			if (raw.isNotEmpty() && raw.all { it in API_KEY_CHARACTERS && it !in QUOTED_STRING_SPECIALS }) JellyfinApiKey(raw) else null
	}
}
