package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.boot.test.context.runner.ApplicationContextRunner
import org.springframework.context.annotation.Configuration
import org.springframework.core.env.StandardEnvironment
import org.springframework.core.env.SystemEnvironmentPropertySource
import java.util.HexFormat
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertContentEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val ENCRYPTION_KEY_VARIABLE = "CONTINUARR_ENCRYPTION_KEY"
private const val VALID_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
private const val SHORT_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e"
private const val NON_HEX_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1g"

// Spring Boot maps environment variable names only for a source named like the real environment.
private const val TEST_ENVIRONMENT_SOURCE = "test-" + StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME

private fun rootCause(failure: Throwable): Throwable = generateSequence(failure) { it.cause }.last()

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(EncryptionKeyProperties::class)
private class EncryptionKeyConfiguration

class EncryptionKeyPropertiesTest {

	private val contextRunner = ApplicationContextRunner().withUserConfiguration(EncryptionKeyConfiguration::class.java)

	private fun withEnvironmentKey(key: String): ApplicationContextRunner = contextRunner.withInitializer {
		val variables = mapOf<String, Any>(ENCRYPTION_KEY_VARIABLE to key)
		it.environment.propertySources.addFirst(SystemEnvironmentPropertySource(TEST_ENVIRONMENT_SOURCE, variables))
	}

	@Test
	fun `starts without a key`() {
		contextRunner.run { context ->
			assertNull(context.startupFailure)
			assertNull(context.getBean(EncryptionKeyProperties::class.java).secretKey)
		}
	}

	private fun assertStartupFailsNamingTheVariableWithoutEchoing(key: String) {
		withEnvironmentKey(key).run { context ->
			val failure = assertNotNull(context.startupFailure)
			assertContains(rootCause(failure).message.orEmpty(), ENCRYPTION_KEY_VARIABLE)
			assertTrue(generateSequence(failure) { it.cause }.mapNotNull { it.message }.none { key in it })
		}
	}

	@Test
	fun `a key shorter than 64 hex characters fails startup naming CONTINUARR_ENCRYPTION_KEY without echoing it`() {
		assertStartupFailsNamingTheVariableWithoutEchoing(SHORT_KEY)
	}

	@Test
	fun `a key with a non-hex character fails startup naming CONTINUARR_ENCRYPTION_KEY without echoing it`() {
		assertStartupFailsNamingTheVariableWithoutEchoing(NON_HEX_KEY)
	}

	@Test
	fun `binds the key from CONTINUARR_ENCRYPTION_KEY`() {
		withEnvironmentKey(VALID_KEY).run { context ->
			val secretKey = assertNotNull(context.getBean(EncryptionKeyProperties::class.java).secretKey)
			assertContentEquals(HexFormat.of().parseHex(VALID_KEY), secretKey.encoded)
		}
	}
}
