package xyz.ianworley.continuarr.mediaproviders.service

import com.github.tomakehurst.wiremock.client.WireMock.aResponse
import com.github.tomakehurst.wiremock.client.WireMock.equalTo
import com.github.tomakehurst.wiremock.client.WireMock.get
import com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor
import com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo
import com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig
import com.github.tomakehurst.wiremock.junit5.WireMockExtension
import org.junit.jupiter.api.extension.RegisterExtension
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.transaction.CannotCreateTransactionException
import xyz.ianworley.continuarr.TestcontainersConfiguration
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinConnectionRepository
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinConnectionRow
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinConnectionStore
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.StoredConnection
import xyz.ianworley.continuarr.mediaproviders.MediaServer
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

private const val URL = "http://jellyfin:8096"
private const val OTHER_URL = "https://media.example:8920"
private const val API_KEY = "0123456789abcdef0123456789abcdef"
private const val OTHER_API_KEY = "fedcba9876543210fedcba9876543210"
private const val INVALID_URL = "ftp://jellyfin"
private const val INVALID_API_KEY = "has a space"
private const val EXPECTED_AUTHORIZATION = """MediaBrowser Client="Continuarr", Token="$API_KEY""""
private const val OTHER_EXPECTED_AUTHORIZATION = """MediaBrowser Client="Continuarr", Token="$OTHER_API_KEY""""

private const val UNREACHABLE_DATABASE_MESSAGE = "Could not open JPA EntityManager for transaction"

private const val USERS_PATH = "/Users"
private const val USERS_BODY = """[{"Id": "valid-user", "Name": "valid", "Policy": {"IsDisabled": false}}]"""

@SpringBootTest
@Import(TestcontainersConfiguration::class)
class JellyfinConnectionSettingsTest(
	@Autowired private val settings: JellyfinConnectionSettings,
	@Autowired private val store: JellyfinConnectionStore,
	@Autowired private val mediaServer: MediaServer,
	@Autowired private val jdbcClient: JdbcClient,
) {

	@RegisterExtension
	private val wireMock: WireMockExtension = WireMockExtension.newInstance().options(wireMockConfig().dynamicPort()).build()

	@BeforeTest
	fun startWithNothingSaved() {
		jdbcClient.sql("DELETE FROM jellyfin_connection").update()
	}

	private fun rowCount(): Long = jdbcClient.sql("SELECT count(*) FROM jellyfin_connection").query(Long::class.java).single()

	private fun saveUrlWithoutKey() {
		jdbcClient.sql("INSERT INTO jellyfin_connection (id, url) VALUES (1, :url)").param("url", URL).update()
	}

	@Test
	fun `save stores the API key the adapter then sends`() {
		assertEquals(JellyfinSaveResult.Saved, settings.save(URL, API_KEY))

		val stored = assertIs<StoredConnection.Usable>(store.load())
		assertEquals(EXPECTED_AUTHORIZATION, stored.connection.apiKey.authorizationHeader())
	}

	@Test
	fun `saving again replaces the single row`() {
		settings.save(URL, API_KEY)

		settings.save(OTHER_URL, OTHER_API_KEY)

		assertEquals(1, rowCount())
		assertEquals(OTHER_URL, settings.saved().url)
		val stored = assertIs<StoredConnection.Usable>(store.load())
		assertEquals(OTHER_EXPECTED_AUTHORIZATION, stored.connection.apiKey.authorizationHeader())
	}

	@Test
	fun `invalid values report both fields and store nothing`() {
		val result = settings.save(INVALID_URL, INVALID_API_KEY)

		assertEquals(JellyfinSaveResult.Invalid(setOf(JellyfinField.URL, JellyfinField.API_KEY)), result)
		assertEquals(0, rowCount())
	}

	@Test
	fun `with nothing saved the connection loads as NotConfigured`() {
		assertEquals(StoredConnection.NotConfigured, store.load())
		assertEquals(SavedJellyfinConnection(null, JellyfinApiKeyState.NONE), settings.saved())
	}

	@Test
	fun `a saved key reads as STORED`() {
		settings.save(URL, API_KEY)

		assertEquals(SavedJellyfinConnection(URL, JellyfinApiKeyState.STORED), settings.saved())
	}

	@Test
	fun `a saved URL with no key reads as NONE with its URL`() {
		saveUrlWithoutKey()

		assertEquals(SavedJellyfinConnection(URL, JellyfinApiKeyState.NONE), settings.saved())
	}

	@Test
	fun `a saved URL with no key loads as Unusable`() {
		saveUrlWithoutKey()

		assertIs<StoredConnection.Unusable>(store.load())
	}

	@Test
	fun `a saved URL with no key matches as NONE`() {
		saveUrlWithoutKey()

		assertEquals(JellyfinApiKeyMatch.NONE, settings.matchApiKeyOrNull(API_KEY))
	}

	@Test
	fun `a patch that sends only a URL needs the key when none is saved`() {
		saveUrlWithoutKey()

		assertEquals(JellyfinSaveResult.Invalid(setOf(JellyfinField.API_KEY)), settings.patch(JellyfinConnectionPatch(OTHER_URL, null)))
		assertEquals(SavedJellyfinConnection(URL, JellyfinApiKeyState.NONE), settings.saved())
	}

	@Test
	fun `a database failure loads as Unusable instead of throwing`() {
		// What the real repository throws when Postgres refuses the connection.
		val unreachableDatabase = object : JellyfinConnectionRepository {
			override fun findById(id: Short): JellyfinConnectionRow = throw CannotCreateTransactionException(UNREACHABLE_DATABASE_MESSAGE)

			override fun save(row: JellyfinConnectionRow): JellyfinConnectionRow = throw CannotCreateTransactionException(UNREACHABLE_DATABASE_MESSAGE)
		}

		assertIs<StoredConnection.Unusable>(JellyfinConnectionStore(unreachableDatabase).load())
	}

	@Test
	fun `the adapter's next call uses a newly saved server`() {
		wireMock.stubFor(
			get(urlEqualTo(USERS_PATH))
				.willReturn(aResponse().withHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE).withBody(USERS_BODY)),
		)

		settings.save(wireMock.baseUrl(), API_KEY)
		mediaServer.accounts()

		wireMock.verify(getRequestedFor(urlEqualTo(USERS_PATH)).withHeader(HttpHeaders.AUTHORIZATION, equalTo(EXPECTED_AUTHORIZATION)))
	}
}
