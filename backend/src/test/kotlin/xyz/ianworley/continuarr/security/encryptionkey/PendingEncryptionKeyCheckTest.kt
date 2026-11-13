package xyz.ianworley.continuarr.security.encryptionkey

import jakarta.persistence.EntityManager
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.io.TempDir
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.SpringApplication
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.mock.env.MockEnvironment
import xyz.ianworley.continuarr.TEST_ENCRYPTION_KEY
import xyz.ianworley.continuarr.TestcontainersConfiguration
import java.nio.file.Files
import java.nio.file.Path
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@SpringBootTest
@Import(TestcontainersConfiguration::class)
class PendingEncryptionKeyCheckTest(
	@Autowired private val entityManager: EntityManager,
	@Autowired private val jdbcClient: JdbcClient,
) {

	@TempDir
	lateinit var dataDir: Path

	private val committedKey get() = dataDir.resolve("encryption.key")

	@AfterEach
	fun deleteSavedSecrets() {
		jdbcClient.sql("DELETE FROM jellyfin_connection").update()
	}

	private fun startAndCheck(vararg properties: Pair<String, String>) {
		val environment = MockEnvironment().withProperty("continuarr.data-dir", dataDir.toString())
		properties.forEach { (name, value) -> environment.setProperty(name, value) }
		EncryptionKeyFileEnvironmentPostProcessor().postProcessEnvironment(environment, SpringApplication())
		PendingEncryptionKeyCheck(entityManager, environment).afterSingletonsInstantiated()
	}

	private fun saveSecret() {
		jdbcClient.sql("INSERT INTO jellyfin_connection (id, url, api_key_ciphertext) VALUES (1, 'http://jellyfin', '\\x00')").update()
	}

	@Test
	fun `a new key is committed when the database holds no secrets`() {
		startAndCheck()

		assertTrue(Files.exists(committedKey))
		assertEquals(listOf(committedKey), Files.list(dataDir).use { it.toList() })
	}

	@Test
	fun `a new key is refused when the database already holds secrets`() {
		saveSecret()

		val failure = assertFailsWith<IllegalStateException> { startAndCheck() }

		assertTrue("CONTINUARR_ENCRYPTION_KEY" in failure.message.orEmpty())
		assertTrue(committedKey.toString() in failure.message.orEmpty())
		assertFalse(Files.exists(committedKey))
	}

	@Test
	fun `a refused key stays refused on the next start`() {
		saveSecret()
		assertFailsWith<IllegalStateException> { startAndCheck() }

		assertFailsWith<IllegalStateException> { startAndCheck() }
	}

	@Test
	fun `a configured key starts even when an earlier start left a refused key`() {
		saveSecret()
		assertFailsWith<IllegalStateException> { startAndCheck() }

		startAndCheck(ENCRYPTION_KEY_PROPERTY to TEST_ENCRYPTION_KEY)

		assertFalse(Files.exists(committedKey))
	}

	@Test
	fun `a committed key starts with saved secrets`() {
		startAndCheck()
		saveSecret()

		startAndCheck()
	}
}
