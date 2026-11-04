package xyz.ianworley.continuarr.jellyfin

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
import xyz.ianworley.continuarr.TEST_ENCRYPTION_KEY_PROPERTY
import xyz.ianworley.continuarr.TestcontainersConfiguration
import org.springframework.jdbc.datasource.DriverManagerDataSource
import xyz.ianworley.continuarr.jellyfin.internal.EncryptionKeyProperties
import xyz.ianworley.continuarr.jellyfin.internal.JellyfinConnectionStore
import xyz.ianworley.continuarr.jellyfin.internal.StoredConnection
import xyz.ianworley.continuarr.server.MediaServer
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull

private const val URL = "http://jellyfin:8096"
private const val OTHER_URL = "https://media.example:8920"
private const val API_KEY = "0123456789abcdef0123456789abcdef"
private const val OTHER_API_KEY = "fedcba9876543210fedcba9876543210"
private const val INVALID_URL = "ftp://jellyfin"
private const val INVALID_API_KEY = "has a space"
private const val EXPECTED_AUTHORIZATION = """MediaBrowser Client="Continuarr", Token="$API_KEY""""
private const val OTHER_EXPECTED_AUTHORIZATION = """MediaBrowser Client="Continuarr", Token="$OTHER_API_KEY""""

private const val OTHER_ENCRYPTION_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"

private const val UNREACHABLE_DATABASE_URL = "jdbc:postgresql://127.0.0.1:1/continuarr"

private const val USERS_PATH = "/Users"
private const val USERS_BODY = """[{"Id": "valid-user", "Name": "valid", "Policy": {"IsDisabled": false}}]"""

@SpringBootTest(properties = [TEST_ENCRYPTION_KEY_PROPERTY])
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

	private fun storedCiphertext(): ByteArray =
		jdbcClient.sql("SELECT api_key_ciphertext FROM jellyfin_connection").query(ByteArray::class.java).single()

	@Test
	fun `save stores the API key encrypted`() {
		assertEquals(JellyfinSaveResult.Saved, settings.save(URL, API_KEY))

		assertFalse(String(storedCiphertext(), Charsets.ISO_8859_1).contains(API_KEY))
		val stored = assertIs<StoredConnection.Usable>(store.load())
		assertEquals(EXPECTED_AUTHORIZATION, stored.connection.apiKey.authorizationHeader())
	}

	@Test
	fun `saving again replaces the single row`() {
		settings.save(URL, API_KEY)

		settings.save(OTHER_URL, OTHER_API_KEY)

		assertEquals(1, rowCount())
		assertEquals(OTHER_URL, settings.savedUrl())
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
	fun `save without an encryption key returns EncryptionKeyMissing and stores nothing`() {
		val settingsWithoutKey = JellyfinConnectionSettings(JellyfinConnectionStore(jdbcClient, EncryptionKeyProperties()))

		assertEquals(JellyfinSaveResult.EncryptionKeyMissing, settingsWithoutKey.save(URL, API_KEY))
		assertEquals(0, rowCount())
	}

	@Test
	fun `with nothing saved the connection loads as NotConfigured`() {
		assertEquals(StoredConnection.NotConfigured, store.load())
		assertNull(settings.savedUrl())
	}

	@Test
	fun `a saved row loads as Unusable without an encryption key`() {
		settings.save(URL, API_KEY)

		assertIs<StoredConnection.Unusable>(JellyfinConnectionStore(jdbcClient, EncryptionKeyProperties()).load())
	}

	@Test
	fun `a row saved under another encryption key loads as Unusable`() {
		settings.save(URL, API_KEY)

		assertIs<StoredConnection.Unusable>(JellyfinConnectionStore(jdbcClient, EncryptionKeyProperties(OTHER_ENCRYPTION_KEY)).load())
	}

	@Test
	fun `the saved URL still reads when the API key won't decrypt`() {
		settings.save(URL, API_KEY)
		val settingsUnderOtherKey = JellyfinConnectionSettings(JellyfinConnectionStore(jdbcClient, EncryptionKeyProperties(OTHER_ENCRYPTION_KEY)))

		assertEquals(URL, settingsUnderOtherKey.savedUrl())
	}

	@Test
	fun `a database failure loads as Unusable instead of throwing`() {
		val unreachableDatabase = JdbcClient.create(DriverManagerDataSource(UNREACHABLE_DATABASE_URL))

		assertIs<StoredConnection.Unusable>(JellyfinConnectionStore(unreachableDatabase, EncryptionKeyProperties()).load())
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
