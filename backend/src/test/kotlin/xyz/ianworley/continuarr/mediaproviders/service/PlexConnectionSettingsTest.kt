package xyz.ianworley.continuarr.mediaproviders.service

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.DefaultApplicationArguments
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import xyz.ianworley.continuarr.TestcontainersConfiguration
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionRepository
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionRow
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionSource
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionStore
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexEnvironmentSeed
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexSeedProperties
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

private const val URL = "http://plex:32400"
private const val OTHER_URL = "https://plex.example:32400"
private const val TOKEN = "plexSeedToken123"
private const val OTHER_TOKEN = "otherPlexToken456"
private const val PLEX_TV_TOKEN = "plexTvLinkToken789"

@SpringBootTest
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

	private fun storedToken(): String? = jdbcClient.sql("SELECT token FROM plex_connection").query(String::class.java).single()

	private fun seed(url: String, token: String) =
		PlexEnvironmentSeed(PlexSeedProperties(url, token), PlexConnectionStore(repository)).run(DefaultApplicationArguments())

	@Test
	fun `with nothing saved the connection reads as NONE`() {
		assertEquals(SavedPlexConnection(null, null, PlexTokenState.NONE), settings.saved())
	}

	@Test
	fun `the seed saves the URL and the token from the environment`() {
		seed(URL, TOKEN)

		assertEquals(SavedPlexConnection(URL, PlexConnectionSource.ENVIRONMENT, PlexTokenState.STORED), settings.saved())
		assertEquals(TOKEN, storedToken())
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
		repository.save(PlexConnectionRow(1, OTHER_URL, PLEX_TV_TOKEN, PlexConnectionSource.PLEX_TV))

		seed(URL, TOKEN)

		assertEquals(OTHER_URL, settings.saved().url)
		assertEquals(PlexConnectionSource.PLEX_TV, settings.saved().source)
		assertEquals(PLEX_TV_TOKEN, storedToken())
	}

	@Test
	fun `with neither variable set the seed saves nothing`() {
		seed("", "")

		assertEquals(0, rowCount())
	}

	@Test
	fun `a saved row with no token reads as NONE with its URL and source`() {
		repository.save(PlexConnectionRow(1, URL, null, PlexConnectionSource.ENVIRONMENT))

		assertEquals(SavedPlexConnection(URL, PlexConnectionSource.ENVIRONMENT, PlexTokenState.NONE), settings.saved())
	}
}
