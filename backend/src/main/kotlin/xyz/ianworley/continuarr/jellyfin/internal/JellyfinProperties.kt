package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.boot.context.properties.ConfigurationProperties
import java.net.URI

private const val URL_VARIABLE = "CONTINUARR_JELLYFIN_URL"
private const val API_KEY_VARIABLE = "CONTINUARR_JELLYFIN_API_KEY"
private val URL_SCHEMES = setOf("http", "https")
private const val NO_PORT = -1
private const val MAX_PORT = 65_535
private val PORTS = 1..MAX_PORT
private const val CLIENT_NAME = "Continuarr"

// The key sits inside a quoted header parameter, so it must be visible ASCII without a quote or backslash.
private val API_KEY_CHARACTERS = '!'..'~'
private val QUOTED_STRING_SPECIALS = setOf('"', '\\')

/**
 * Bound from `CONTINUARR_JELLYFIN_URL` and `CONTINUARR_JELLYFIN_API_KEY`. Both are required, and the
 * constructor throws on a missing or invalid value, which fails startup. The empty defaults exist so a
 * missing variable reaches that check instead of failing with Kotlin's null-check message.
 */
@ConfigurationProperties("continuarr.jellyfin")
class JellyfinProperties(url: String = "", apiKey: String = "") {
	val baseUrl: URI = parseBaseUrl(url)
	val apiKey: JellyfinApiKey = JellyfinApiKey(apiKey)
}

// RestClient encodes the base URL again, so a percent-escape would reach Jellyfin encoded twice, and it
// rejects the other use of '%', an IPv6 zone ID.
private const val PERCENT = '%'

private fun parseBaseUrl(url: String): URI {
	val uri = runCatching { URI(url) }.getOrNull()
	require(uri != null && PERCENT !in url && uri.isJellyfinBaseUrl()) {
		"$URL_VARIABLE must be an absolute http or https URL with no query or percent-encoding, such as http://jellyfin:8096"
	}
	return uri
}

private fun URI.isJellyfinBaseUrl(): Boolean = isAbsolute && scheme.lowercase() in URL_SCHEMES && host != null &&
	(port == NO_PORT || port in PORTS) && rawQuery == null && rawFragment == null

/** Keeps the key out of logs: [toString] hides it, and [authorizationHeader] is the only way to read it. */
class JellyfinApiKey(private val value: String) {
	init {
		require(value.isNotEmpty() && value.all { it in API_KEY_CHARACTERS && it !in QUOTED_STRING_SPECIALS }) {
			"$API_KEY_VARIABLE must be a Jellyfin API key: visible ASCII characters with no spaces or quotes"
		}
	}

	/** Jellyfin 12 accepts the key only in the MediaBrowser scheme. */
	fun authorizationHeader(): String = """MediaBrowser Client="$CLIENT_NAME", Token="$value""""

	override fun toString(): String = "JellyfinApiKey(hidden)"
}
