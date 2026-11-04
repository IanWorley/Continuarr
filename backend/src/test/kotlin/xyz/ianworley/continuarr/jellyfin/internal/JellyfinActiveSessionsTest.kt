package xyz.ianworley.continuarr.jellyfin.internal

import com.github.tomakehurst.wiremock.client.WireMock.aResponse
import com.github.tomakehurst.wiremock.client.WireMock.get
import com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo
import com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig
import com.github.tomakehurst.wiremock.junit5.WireMockExtension
import org.junit.jupiter.api.extension.RegisterExtension
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.server.ActiveSession
import xyz.ianworley.continuarr.server.ServerAccountId
import xyz.ianworley.continuarr.server.ServerItemId
import xyz.ianworley.continuarr.server.ServerSessionId
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.time.Duration.Companion.seconds

private const val FIXTURES = "wiremock/jellyfin"
private const val SESSIONS_FIXTURE = "get-sessions.json"
private const val API_KEY = "test-api-key"

private const val SEEDED_PLAYING_CLIENT = "seed-playing"
private const val SEEDED_PAUSED_CLIENT = "seed-paused"
private const val SEEDED_PAUSED_SECONDS = 3

private const val IDLE_SESSIONS = """[
	{"Id": "idle-web", "UserId": "someone", "Client": "Jellyfin Web", "PlayState": {"IsPaused": false}},
	{"Id": "idle-tv", "UserId": "someone-else", "Client": "Jellyfin Android TV", "PlayState": {"IsPaused": false}}
]"""

private const val PLAYING_WITHOUT_USABLE_POSITION = """[
	{"Id": "no-position", "UserId": "someone", "Client": "Jellyfin Web", "NowPlayingItem": {"Id": "some-item"}, "PlayState": {"IsPaused": false}},
	{"Id": "negative", "UserId": "someone", "Client": "Jellyfin Web", "NowPlayingItem": {"Id": "some-item"}, "PlayState": {"IsPaused": false, "PositionTicks": -50000000}}
]"""

private fun recordedSession(client: String): JsonNode {
	val mapping = checkNotNull(JellyfinActiveSessionsTest::class.java.getResource("/$FIXTURES/mappings/$SESSIONS_FIXTURE")).readText()
	return JsonMapper().readTree(mapping).path("response").path("jsonBody").single { it.path("Client").asString() == client }
}

class JellyfinActiveSessionsTest {

	@RegisterExtension
	private val wireMock: WireMockExtension = WireMockExtension.newInstance()
		.options(wireMockConfig().dynamicPort().usingFilesUnderClasspath(FIXTURES))
		.build()

	private fun mediaServer() = JellyfinMediaServer({
		StoredConnection.Usable(JellyfinConnection(URI(wireMock.baseUrl()), assertNotNull(JellyfinApiKey.parseOrNull(API_KEY))))
	})

	@Test
	fun `active sessions skip sessions with nothing playing`() {
		assertEquals(listOf(SEEDED_PAUSED_CLIENT, SEEDED_PLAYING_CLIENT), mediaServer().activeSessions().map { it.clientName }.sorted())
	}

	@Test
	fun `active sessions map IDs, position, paused state, and client`() {
		val recorded = recordedSession(SEEDED_PAUSED_CLIENT)
		val expected = ActiveSession(
			id = ServerSessionId(recorded.path("Id").asString()),
			accountId = ServerAccountId(recorded.path("UserId").asString()),
			itemId = ServerItemId(recorded.path("NowPlayingItem").path("Id").asString()),
			position = SEEDED_PAUSED_SECONDS.seconds,
			paused = true,
			clientName = SEEDED_PAUSED_CLIENT,
		)

		val sessions = mediaServer().activeSessions().associateBy { it.clientName }

		assertEquals(expected, sessions[SEEDED_PAUSED_CLIENT])
		assertFalse(assertNotNull(sessions[SEEDED_PLAYING_CLIENT]).paused)
	}

	private fun stubSessions(body: String) {
		wireMock.stubFor(
			get(urlEqualTo(SESSIONS_PATH))
				.willReturn(aResponse().withHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE).withBody(body)),
		)
	}

	@Test
	fun `active sessions are empty when nothing is playing`() {
		stubSessions(IDLE_SESSIONS)

		assertEquals(emptyList(), mediaServer().activeSessions())
	}

	@Test
	fun `active sessions skip a playing session with no usable position`() {
		stubSessions(PLAYING_WITHOUT_USABLE_POSITION)

		assertEquals(emptyList(), mediaServer().activeSessions())
	}
}
