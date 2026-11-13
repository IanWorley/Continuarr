package xyz.ianworley.continuarr.mediaproviders.provider.plex

import org.slf4j.LoggerFactory
import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.boot.context.properties.ConfigurationProperties
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.parseBaseUrlOrNull
import java.net.URI

private const val URL_VARIABLE = "CONTINUARR_PLEX_URL"
private const val TOKEN_VARIABLE = "CONTINUARR_PLEX_TOKEN"

class PlexSeed(val url: URI, val token: PlexToken)

/**
 * Bound from CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN. Blank means unset. An invalid value makes the
 * constructor throw, so startup fails naming the variable but never echoing its value.
 */
@ConfigurationProperties("continuarr.plex")
class PlexSeedProperties(url: String = "", token: String = "") {

	val seed: PlexSeed? = if (url.isBlank() && token.isBlank()) null else parseSeed(url, token)

	override fun toString(): String = "PlexSeedProperties(hidden)"
}

private fun parseSeed(url: String, token: String): PlexSeed {
	require(url.isNotBlank() && token.isNotBlank()) { "Set both $URL_VARIABLE and $TOKEN_VARIABLE, or neither" }
	val baseUrl = requireNotNull(parseBaseUrlOrNull(url)) {
		"$URL_VARIABLE must be an http or https URL with a host and no user info, query, fragment, or percent sign"
	}
	val plexToken = requireNotNull(PlexToken.parseOrNull(token)) { "$TOKEN_VARIABLE must be visible ASCII with no spaces" }
	return PlexSeed(baseUrl, plexToken)
}

/** Seeds the Plex connection for local development. */
class PlexEnvironmentSeed(private val properties: PlexSeedProperties, private val store: PlexConnectionStore) : ApplicationRunner {

	private val log = LoggerFactory.getLogger(PlexEnvironmentSeed::class.java)

	override fun run(args: ApplicationArguments) {
		val seed = properties.seed ?: return
		when (store.seed(seed.url, seed.token)) {
			PlexSeedResult.SAVED -> log.info("Saved the Plex connection from {} and {}", URL_VARIABLE, TOKEN_VARIABLE)
			PlexSeedResult.KEPT_PLEX_TV_LINK ->
				log.info("Kept the Plex connection linked through plex.tv; {} and {} are ignored", URL_VARIABLE, TOKEN_VARIABLE)
			PlexSeedResult.ENCRYPTION_KEY_MISSING ->
				log.warn("{} is set but CONTINUARR_ENCRYPTION_KEY isn't, so the Plex connection wasn't saved", TOKEN_VARIABLE)
		}
	}
}
