package xyz.ianworley.continuarr.security.encryptionkey

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.springframework.boot.SpringApplication
import org.springframework.mock.env.MockEnvironment
import xyz.ianworley.continuarr.TEST_ENCRYPTION_KEY
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermissions
import java.util.concurrent.Callable
import java.util.concurrent.CyclicBarrier
import java.util.concurrent.Executors
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val CONCURRENT_STARTS = 8
private val HEX_KEY = Regex("[0-9a-f]{64}")

class EncryptionKeyFileEnvironmentPostProcessorTest {

	@TempDir
	lateinit var dataDir: Path

	private fun start(vararg properties: Pair<String, String>): String? {
		val environment = MockEnvironment()
		properties.forEach { (name, value) -> environment.setProperty(name, value) }
		EncryptionKeyFileEnvironmentPostProcessor().postProcessEnvironment(environment, SpringApplication())
		return environment.getProperty(ENCRYPTION_KEY_PROPERTY)
	}

	private fun startWithDataDir(dir: Path = dataDir) = start("continuarr.data-dir" to dir.toString())

	@Test
	fun `a first start without a key creates one that only the owner can read`() {
		val key = startWithDataDir()

		assertTrue(key != null && HEX_KEY.matches(key))
		val keyFile = Files.list(dataDir).use { files -> files.toList().single() }
		assertEquals(key, Files.readString(keyFile))
		assertEquals("rw-------", PosixFilePermissions.toString(Files.getPosixFilePermissions(keyFile)))
	}

	@Test
	fun `a restart reuses the key from the first start`() {
		val first = startWithDataDir()

		assertEquals(first, startWithDataDir())
	}

	@Test
	fun `a restart reuses the key once it is committed`() {
		val first = checkNotNull(startWithDataDir())
		assertTrue(EncryptionKeyFiles(dataDir).commit(first))

		assertEquals(first, startWithDataDir())
	}

	@Test
	fun `committing a key that another start already committed succeeds`() {
		val files = EncryptionKeyFiles(dataDir)
		val key = files.loadOrCreate()
		assertTrue(files.commit(key))

		assertTrue(files.commit(key))
	}

	@Test
	fun `a configured key wins and no file is written`() {
		val key = start("continuarr.data-dir" to dataDir.toString(), ENCRYPTION_KEY_PROPERTY to TEST_ENCRYPTION_KEY)

		assertEquals(TEST_ENCRYPTION_KEY, key)
		assertEquals(0, Files.list(dataDir).use { it.count() })
	}

	@Test
	fun `a blank configured key counts as unset`() {
		val key = start("continuarr.data-dir" to dataDir.toString(), ENCRYPTION_KEY_PROPERTY to "")

		assertTrue(key != null && HEX_KEY.matches(key))
	}

	@Test
	fun `without a data dir the key stays unset`() {
		assertNull(start())
	}

	@Test
	fun `concurrent first starts agree on one key`() {
		val barrier = CyclicBarrier(CONCURRENT_STARTS)
		val executor = Executors.newFixedThreadPool(CONCURRENT_STARTS)
		val keys = try {
			executor.invokeAll(List(CONCURRENT_STARTS) { Callable { barrier.await(); startWithDataDir() } }).map { it.get() }
		} finally {
			executor.shutdown()
		}

		assertEquals(1, keys.toSet().size)
	}

	@Test
	fun `an unwritable data dir fails startup and names the directory`() {
		Files.setPosixFilePermissions(dataDir, PosixFilePermissions.fromString("r-x------"))
		try {
			val failure = assertFailsWith<IllegalStateException> { startWithDataDir() }

			assertTrue(dataDir.toString() in failure.message.orEmpty())
			assertTrue("CONTINUARR_DATA_DIR" in failure.message.orEmpty())
		} finally {
			Files.setPosixFilePermissions(dataDir, PosixFilePermissions.fromString("rwx------"))
		}
	}

	@Test
	fun `a malformed key file fails startup without echoing its contents`() {
		val contents = "not-a-key-but-maybe-a-secret"
		Files.writeString(dataDir.resolve("encryption.key"), contents)

		val failure = assertFailsWith<IllegalStateException> { startWithDataDir() }

		assertFalse(contents in failure.message.orEmpty())
	}
}
