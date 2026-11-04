package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.boot.context.properties.ConfigurationProperties
import java.net.URI

private const val URL_VARIABLE = "CONTINUARR_JELLYFIN_URL"
private const val API_KEY_VARIABLE = "CONTINUARR_JELLYFIN_API_KEY"

/**
 * Bound from `CONTINUARR_JELLYFIN_URL` and `CONTINUARR_JELLYFIN_API_KEY`. Both are required, and the
 * constructor throws on a missing or invalid value, which fails startup. The empty defaults exist so a
 * missing variable reaches that check instead of failing with Kotlin's null-check message.
 */
@ConfigurationProperties("continuarr.jellyfin")
class JellyfinProperties(url: String = "", apiKey: String = "") {
	val baseUrl: URI = requireNotNull(parseBaseUrlOrNull(url)) {
		"$URL_VARIABLE must be an absolute http or https URL with no query or percent-encoding, such as http://jellyfin:8096"
	}
	val apiKey: JellyfinApiKey = requireNotNull(JellyfinApiKey.parseOrNull(apiKey)) {
		"$API_KEY_VARIABLE must be a Jellyfin API key: visible ASCII characters with no spaces or quotes"
	}
}
