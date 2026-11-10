package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val VALID_URL = "http://jellyfin:8096"
private const val RELATIVE_URL = "/jellyfin"
private const val NO_HOST_URL = "http:///jellyfin"
private const val NON_HTTP_URL = "ftp://jellyfin"
private const val TOO_HIGH_PORT_URL = "http://jellyfin:80960"
private const val ZERO_PORT_URL = "http://jellyfin:0"
private const val ZONE_ID_URL = "http://[fe80::1%en0]:8096"
private const val ENCODED_ZONE_ID_URL = "http://[fe80::1%25en0]:8096"
private const val URL_WITH_SPACE = "http://jellyfin:8096/my jellyfin"
private const val PERCENT_ENCODED_URL = "http://jellyfin:8096/my%20jellyfin"
private const val URL_WITH_QUERY = "http://jellyfin:8096/?api_key=0123456789abcdef"
private const val URL_WITH_FRAGMENT = "http://jellyfin:8096/#web"
private const val URL_WITH_USER_INFO = "http://user:url-password@jellyfin:8096"

private const val VALID_API_KEY = "test-api-key"
private const val EXPECTED_AUTHORIZATION = """MediaBrowser Client="Continuarr", Token="$VALID_API_KEY""""
private const val EMPTY_API_KEY = ""
private const val BLANK_API_KEY = " "
private const val API_KEY_WITH_LINE_BREAK = "0123456789abcdef\n"
private const val API_KEY_WITH_QUOTE = "0123456789\"abcdef"

class JellyfinConnectionTest {

	@Test
	fun `an absolute http URL with a host and port parses`() {
		assertEquals(URI(VALID_URL), parseBaseUrlOrNull(VALID_URL))
	}

	@Test
	fun `a relative URL is rejected`() {
		assertNull(parseBaseUrlOrNull(RELATIVE_URL))
	}

	@Test
	fun `a URL without a host is rejected`() {
		assertNull(parseBaseUrlOrNull(NO_HOST_URL))
	}

	@Test
	fun `a non-http URL is rejected`() {
		assertNull(parseBaseUrlOrNull(NON_HTTP_URL))
	}

	@Test
	fun `an out-of-range port is rejected`() {
		for (url in listOf(ZERO_PORT_URL, TOO_HIGH_PORT_URL)) {
			assertNull(parseBaseUrlOrNull(url), url)
		}
	}

	@Test
	fun `an IPv6 zone ID is rejected`() {
		for (url in listOf(ZONE_ID_URL, ENCODED_ZONE_ID_URL)) {
			assertNull(parseBaseUrlOrNull(url), url)
		}
	}

	@Test
	fun `a URL that RestClient would encode again is rejected`() {
		for (url in listOf(URL_WITH_SPACE, PERCENT_ENCODED_URL)) {
			assertNull(parseBaseUrlOrNull(url), url)
		}
	}

	@Test
	fun `a URL with a query is rejected`() {
		assertNull(parseBaseUrlOrNull(URL_WITH_QUERY))
	}

	@Test
	fun `a URL with a fragment is rejected`() {
		assertNull(parseBaseUrlOrNull(URL_WITH_FRAGMENT))
	}

	@Test
	fun `a URL with user info is rejected`() {
		assertNull(parseBaseUrlOrNull(URL_WITH_USER_INFO))
	}

	@Test
	fun `a valid API key goes into a MediaBrowser authorization header`() {
		assertEquals(EXPECTED_AUTHORIZATION, JellyfinApiKey.parseOrNull(VALID_API_KEY)?.authorizationHeader())
	}

	@Test
	fun `an empty API key is rejected`() {
		assertNull(JellyfinApiKey.parseOrNull(EMPTY_API_KEY))
	}

	@Test
	fun `a blank API key is rejected`() {
		assertNull(JellyfinApiKey.parseOrNull(BLANK_API_KEY))
	}

	@Test
	fun `an API key with a line break is rejected`() {
		assertNull(JellyfinApiKey.parseOrNull(API_KEY_WITH_LINE_BREAK))
	}

	@Test
	fun `an API key with a quote is rejected`() {
		assertNull(JellyfinApiKey.parseOrNull(API_KEY_WITH_QUOTE))
	}
}
