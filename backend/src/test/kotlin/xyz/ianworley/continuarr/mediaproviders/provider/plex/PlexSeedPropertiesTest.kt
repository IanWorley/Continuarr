package xyz.ianworley.continuarr.mediaproviders.provider.plex

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.env.SystemEnvironmentPropertySource
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val URL_VARIABLE = "CONTINUARR_PLEX_URL"
private const val TOKEN_VARIABLE = "CONTINUARR_PLEX_TOKEN"
private const val URL = "http://plex:32400"
private const val TOKEN = "plexBindingToken321"
private const val URL_PASSWORD = "url-password"
private const val INVALID_URL = "http://user:$URL_PASSWORD@plex:32400"
private const val INVALID_TOKEN = "has a space"

// Spring Boot maps environment variable names only for a source named like the real environment.
private const val TEST_ENVIRONMENT_SOURCE = "test-" + StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME

private fun rootCause(failure: Throwable): Throwable = generateSequence(failure) { it.cause }.last()

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(PlexSeedProperties::class)
private class PlexSeedConfiguration

class PlexSeedPropertiesTest {

	private val contextRunner = ApplicationContextRunner().withUserConfiguration(PlexSeedConfiguration::class.java)

	private fun withEnvironment(vararg variables: Pair<String, String>): ApplicationContextRunner = contextRunner.withInitializer {
		it.environment.propertySources.addFirst(SystemEnvironmentPropertySource(TEST_ENVIRONMENT_SOURCE, mapOf<String, Any>(*variables)))
	}

	private fun assertStartupFailsNaming(variable: String, hidden: String, vararg variables: Pair<String, String>) {
		withEnvironment(*variables).run { context ->
			val failure = assertNotNull(context.startupFailure)
			assertContains(rootCause(failure).message.orEmpty(), variable)
			assertTrue(generateSequence(failure) { it.cause }.mapNotNull { it.message }.none { hidden in it })
		}
	}

	@Test
	fun `starts with no seed when neither variable is set`() {
		contextRunner.run { context ->
			assertNull(context.startupFailure)
			assertNull(context.getBean(PlexSeedProperties::class.java).seed)
		}
	}

	@Test
	fun `binds the seed from CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN`() {
		withEnvironment(URL_VARIABLE to URL, TOKEN_VARIABLE to TOKEN).run { context ->
			val seed = assertNotNull(context.getBean(PlexSeedProperties::class.java).seed)
			assertEquals(URL, seed.url.toString())
			assertEquals(TOKEN, String(seed.token.plaintext(), Charsets.US_ASCII))
		}
	}

	@Test
	fun `only one variable set fails startup naming the missing one`() {
		assertStartupFailsNaming(TOKEN_VARIABLE, URL, URL_VARIABLE to URL)
		assertStartupFailsNaming(URL_VARIABLE, TOKEN, TOKEN_VARIABLE to TOKEN)
	}

	@Test
	fun `an invalid URL fails startup naming CONTINUARR_PLEX_URL without echoing it`() {
		assertStartupFailsNaming(URL_VARIABLE, URL_PASSWORD, URL_VARIABLE to INVALID_URL, TOKEN_VARIABLE to TOKEN)
	}

	@Test
	fun `an invalid token fails startup naming CONTINUARR_PLEX_TOKEN without echoing it`() {
		assertStartupFailsNaming(TOKEN_VARIABLE, INVALID_TOKEN, URL_VARIABLE to URL, TOKEN_VARIABLE to INVALID_TOKEN)
	}
}
