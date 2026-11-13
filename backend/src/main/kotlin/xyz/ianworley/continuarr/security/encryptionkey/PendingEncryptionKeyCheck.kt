package xyz.ianworley.continuarr.security.encryptionkey

import jakarta.persistence.EntityManager
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.SmartInitializingSingleton
import org.springframework.core.env.ConfigurableEnvironment
import org.springframework.stereotype.Component

private val log = LoggerFactory.getLogger(PendingEncryptionKeyCheck::class.java)

// Every encrypted column is named *_ciphertext, so this finds saved secrets in tables added later too.
private const val CIPHERTEXT_COLUMNS_SQL = """
	SELECT format('SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I IS NOT NULL)', table_schema, table_name, column_name)
	FROM information_schema.columns
	WHERE table_schema = ANY (current_schemas(false)) AND column_name LIKE '%\_ciphertext'
"""

/**
 * Commits a key that [EncryptionKeyFileEnvironmentPostProcessor] just created, unless the database already
 * holds secrets. Those were saved under a key this install has lost, and a new key could never read them.
 * It runs once every bean exists, which is after Liquibase and before the web server or any startup runner.
 */
@Component
class PendingEncryptionKeyCheck(private val entityManager: EntityManager, private val environment: ConfigurableEnvironment) :
	SmartInitializingSingleton {

	override fun afterSingletonsInstantiated() {
		// A configured key wins, so a pending file left by an earlier start, even a damaged one, doesn't matter.
		if (!environment.propertySources.contains(PROPERTY_SOURCE_NAME)) return
		val files = EncryptionKeyFiles.from(environment) ?: return
		val key = files.pendingOrNull()
		if (key == null || key != environment.getProperty(ENCRYPTION_KEY_PROPERTY)) return
		check(!savedSecretsExist()) {
			"The database holds saved secrets, but CONTINUARR_ENCRYPTION_KEY isn't set and ${files.committed} doesn't " +
				"exist, so there's no key to read them. Set CONTINUARR_ENCRYPTION_KEY to the key they were saved with, " +
				"or restore ${files.committed} from a backup. To start over, set CONTINUARR_ENCRYPTION_KEY to a new " +
				"key and save each connection again. Continuarr doesn't make a new key here, because it would leave " +
				"those secrets unreadable."
		}
		check(files.commit(key)) { "Another Continuarr committed a different key to ${files.committed} while this one started" }
		log.info("Created a new encryption key in {}; back it up with the database", files.committed)
	}

	private fun savedSecretsExist(): Boolean =
		entityManager.createNativeQuery(CIPHERTEXT_COLUMNS_SQL, String::class.java).resultList.filterIsInstance<String>()
			.any { query -> entityManager.createNativeQuery(query, Boolean::class.java).singleResult == true }
}
