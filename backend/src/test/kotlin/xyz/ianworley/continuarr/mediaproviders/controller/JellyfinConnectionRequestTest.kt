package xyz.ianworley.continuarr.mediaproviders.controller

import kotlin.test.Test
import kotlin.test.assertFalse

private const val URL_PASSWORD = "url-password"
private const val URL_WITH_CREDENTIALS = "http://user:$URL_PASSWORD@jellyfin:8096"
private const val API_KEY = "0123456789abcdef0123456789abcdef"

class JellyfinConnectionRequestTest {

	@Test
	fun `toString hides the URL and the API key`() {
		val text = JellyfinConnectionRequest(URL_WITH_CREDENTIALS, API_KEY).toString()

		assertFalse(text.contains(URL_PASSWORD))
		assertFalse(text.contains(API_KEY))
	}
}
