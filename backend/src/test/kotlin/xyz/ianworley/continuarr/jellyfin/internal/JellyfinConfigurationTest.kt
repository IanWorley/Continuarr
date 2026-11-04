package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.core.env.MapPropertySource
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.env.SystemEnvironmentPropertySource
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private const val VALID_URL = "http://jellyfin:8096"
private const val URL_PASSWORD = "url-password"
private const val URL_WITH_CREDENTIALS = "ftp://user:$URL_PASSWORD@jellyfin"
private const val VALID_API_KEY = "test-api-key"
private const val BLANK_API_KEY = " "
private const val KEY_BEFORE_LINE_BREAK = "0123456789abcdef"
private const val API_KEY_WITH_LINE_BREAK = "$KEY_BEFORE_LINE_BREAK\n"
private const val EXPECTED_AUTHORIZATION = """MediaBrowser Client="Continuarr", Token="$VALID_API_KEY""""
private const val URL_VARIABLE = "CONTINUARR_JELLYFIN_URL"
private const val API_KEY_VARIABLE = "CONTINUARR_JELLYFIN_API_KEY"

// Spring Boot maps environment variable names only for a source named like the real environment.
private const val TEST_ENVIRONMENT_SOURCE = "test-" + StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME
private const val TEST_PROPERTY_SOURCE = "test-properties"

private fun rootCause(failure: Throwable): Throwable = generateSequence(failure) { it.cause }.last()

class JellyfinConfigurationTest {

	private val contextRunner = ApplicationContextRunner().withUserConfiguration(JellyfinConfiguration::class.java)

	private fun assertStartupFailsNaming(variable: String, vararg properties: String) {
		contextRunner.withPropertyValues(*properties).run { context ->
			assertContains(rootCause(assertNotNull(context.startupFailure)).message.orEmpty(), variable)
		}
	}

	@Test
	fun `missing URL fails startup naming CONTINUARR_JELLYFIN_URL`() {
		assertStartupFailsNaming(URL_VARIABLE, "continuarr.jellyfin.api-key=$VALID_API_KEY")
	}

	@Test
	fun `an invalid URL's startup failure leaves out the URL, which can hold credentials`() {
		contextRunner.withPropertyValues("continuarr.jellyfin.url=$URL_WITH_CREDENTIALS", "continuarr.jellyfin.api-key=$VALID_API_KEY")
			.run { context ->
				val messages = generateSequence(assertNotNull(context.startupFailure)) { it.cause }.mapNotNull { it.message }
				assertTrue(messages.none { URL_PASSWORD in it })
			}
	}

	@Test
	fun `blank API key fails startup naming CONTINUARR_JELLYFIN_API_KEY`() {
		assertStartupFailsNaming(API_KEY_VARIABLE, "continuarr.jellyfin.url=$VALID_URL", "continuarr.jellyfin.api-key=$BLANK_API_KEY")
	}

	// A property source keeps the line break, which inline property values would trim.
	@Test
	fun `an API key with a line break fails startup naming CONTINUARR_JELLYFIN_API_KEY without echoing it`() {
		val properties = mapOf<String, Any>("continuarr.jellyfin.url" to VALID_URL, "continuarr.jellyfin.api-key" to API_KEY_WITH_LINE_BREAK)
		contextRunner
			.withInitializer { it.environment.propertySources.addFirst(MapPropertySource(TEST_PROPERTY_SOURCE, properties)) }
			.run { context ->
				val failure = assertNotNull(context.startupFailure)
				assertContains(rootCause(failure).message.orEmpty(), API_KEY_VARIABLE)
				assertTrue(generateSequence(failure) { it.cause }.mapNotNull { it.message }.none { KEY_BEFORE_LINE_BREAK in it })
			}
	}

	@Test
	fun `binds from the CONTINUARR_JELLYFIN environment variables`() {
		val variables = mapOf(URL_VARIABLE to VALID_URL, API_KEY_VARIABLE to VALID_API_KEY)
		contextRunner
			.withInitializer { it.environment.propertySources.addFirst(SystemEnvironmentPropertySource(TEST_ENVIRONMENT_SOURCE, variables)) }
			.run { context ->
				val properties = context.getBean(JellyfinProperties::class.java)
				assertEquals(URI(VALID_URL), properties.baseUrl)
				assertEquals(EXPECTED_AUTHORIZATION, properties.apiKey.authorizationHeader())
			}
	}
}
