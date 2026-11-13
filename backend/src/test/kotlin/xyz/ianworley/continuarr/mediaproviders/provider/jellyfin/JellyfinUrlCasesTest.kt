package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import tools.jackson.module.kotlin.jacksonObjectMapper
import tools.jackson.module.kotlin.readValue
import kotlin.test.Test
import kotlin.test.assertEquals

// The frontend's checkUrl reads the same file, so the settings card refuses exactly what this parser refuses.
private const val CASES = "/jellyfin-url-cases.json"

private class UrlCases(val accept: List<String>, val refuse: List<String>)

class JellyfinUrlCasesTest {

	private val cases: UrlCases =
		jacksonObjectMapper().readValue(checkNotNull(javaClass.getResource(CASES)).readText())

	@Test
	fun `accepts every URL the shared cases accept`() {
		assertEquals(emptyList(), cases.accept.filter { parseBaseUrlOrNull(it) == null })
	}

	@Test
	fun `refuses every URL the shared cases refuse`() {
		assertEquals(emptyList(), cases.refuse.filter { parseBaseUrlOrNull(it) != null })
	}
}
