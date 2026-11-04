package xyz.ianworley.continuarr.jellyfin.internal

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

private const val API_KEY = "0123456789abcdef0123456789abcdef"

class JellyfinApiKeyTest {

	@Test
	fun `toString hides the key`() {
		assertFalse(assertNotNull(JellyfinApiKey.parseOrNull(API_KEY)).toString().contains(API_KEY))
	}
}
