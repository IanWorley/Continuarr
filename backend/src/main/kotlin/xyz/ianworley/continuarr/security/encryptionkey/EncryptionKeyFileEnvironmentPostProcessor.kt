package xyz.ianworley.continuarr.security.encryptionkey

import org.springframework.boot.EnvironmentPostProcessor
import org.springframework.boot.SpringApplication
import org.springframework.core.env.ConfigurableEnvironment
import org.springframework.core.env.MapPropertySource

internal const val PROPERTY_SOURCE_NAME = "continuarrEncryptionKeyFile"

/**
 * Supplies `continuarr.encryption-key` from the key file in `CONTINUARR_DATA_DIR` when nothing else sets it,
 * so a fresh install needs no key. It runs before any bean binds the property, so the rest of the app sees
 * a configured key. [PendingEncryptionKeyCheck] commits a new key once startup reaches the database.
 */
class EncryptionKeyFileEnvironmentPostProcessor : EnvironmentPostProcessor {

	override fun postProcessEnvironment(environment: ConfigurableEnvironment, application: SpringApplication) {
		if (!environment.getProperty(ENCRYPTION_KEY_PROPERTY).isNullOrBlank()) return
		val files = EncryptionKeyFiles.from(environment) ?: return
		// First, so it also beats the blank CONTINUARR_ENCRYPTION_KEY that compose.yaml passes when .env leaves it empty.
		environment.propertySources.addFirst(MapPropertySource(PROPERTY_SOURCE_NAME, mapOf(ENCRYPTION_KEY_PROPERTY to files.loadOrCreate())))
	}
}
