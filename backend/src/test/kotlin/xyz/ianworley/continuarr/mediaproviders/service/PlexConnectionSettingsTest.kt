package xyz.ianworley.continuarr.mediaproviders.service

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.DefaultApplicationArguments
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import xyz.ianworley.continuarr.TEST_ENCRYPTION_KEY
import xyz.ianworley.continuarr.TEST_ENCRYPTION_KEY_PROPERTY
import xyz.ianworley.continuarr.TestcontainersConfiguration
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionRepository
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionRow
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionSource
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionStore
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexEnvironmentSeed
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexSeedProperties
import xyz.ianworley.continuarr.mediaproviders.provider.secrets.EncryptionKeyProperties
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse

private const val URL = "http://plex:32400"
private const val OTHER_URL = "https://plex.example:32400"
private const val TOKEN = "plexSeedToken123"
private const val OTHER_TOKEN = "otherPlexToken456"
private const val OTHER_ENCRYPTION_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
private val PLEX_TV_CIPHERTEXT = "a plex.tv link's ciphertext".toByteArray()

@SpringBootTest(properties = [TEST_ENCRYPTION_KEY_PROPERTY])
@Import(TestcontainersConfiguration::class)
class PlexConnectionSettingsTest(
	@Autowired private val settings: PlexConnectionSettings,
	@Autowired private val repository: PlexConnectionRepository,
	@Autowired private val jdbcClient: JdbcClient,
) {

	@BeforeTest
	fun startWithNothingSaved() {
		jdbcClient.sql("DELETE FROM plex_connection").update()
	}

	private fun rowCount(): Long = jdbcClient.sql("SELECT count(*) FROM plex_connection").query(Long::class.java).single()

	private fun storedCiphertext(): ByteArray =
		jdbcClient.sql("SELECT token_ciphertext FROM plex_connection").query(ByteArray::class.java).single()

	private fun seed(url: String, token: String, encryptionKey: String = TEST_ENCRYPTION_KEY) =
		PlexEnvironmentSeed(PlexSeedProperties(url, token), PlexConnectionStore(repository, EncryptionKeyProperties(encryptionKey)))
			.run(DefaultApplicationArguments())

	@Test
	fun `with nothing saved the connection reads as NONE`() {
		assertEquals(SavedPlexConnection(null, null, PlexTokenState.NONE), settings.saved())
	}

	@Test
	fun `the seed saves the URL and the token encrypted, from the environment`() {
		seed(URL, TOKEN)

		assertEquals(SavedPlexConnection(URL, PlexConnectionSource.ENVIRONMENT, PlexTokenState.STORED), settings.saved())
		assertFalse(String(storedCiphertext(), Charsets.ISO_8859_1).contains(TOKEN))
	}

	@Test
	fun `a later seed with new values replaces the single environment row`() {
		seed(URL, TOKEN)

		seed(OTHER_URL, OTHER_TOKEN)

		assertEquals(1, rowCount())
		assertEquals(SavedPlexConnection(OTHER_URL, PlexConnectionSource.ENVIRONMENT, PlexTokenState.STORED), settings.saved())
	}

	@Test
	fun `the seed never replaces a connection linked through plex tv`() {
		repository.save(PlexConnectionRow(1, OTHER_URL, PLEX_TV_CIPHERTEXT, PlexConnectionSource.PLEX_TV))

		seed(URL, TOKEN)

		assertEquals(OTHER_URL, settings.saved().url)
		assertEquals(PlexConnectionSource.PLEX_TV, settings.saved().source)
		assertEquals(PLEX_TV_CIPHERTEXT.toList(), storedCiphertext().toList())
	}

	@Test
	fun `without an encryption key the seed saves nothing`() {
		seed(URL, TOKEN, encryptionKey = "")

		assertEquals(0, rowCount())
	}

	@Test
	fun `with neither variable set the seed saves nothing`() {
		seed("", "")

		assertEquals(0, rowCount())
	}

	@Test
	fun `a token saved under another encryption key reads as UNREADABLE with its URL and source`() {
		seed(URL, TOKEN, encryptionKey = OTHER_ENCRYPTION_KEY)

		assertEquals(SavedPlexConnection(URL, PlexConnectionSource.ENVIRONMENT, PlexTokenState.UNREADABLE), settings.saved())
	}
}
