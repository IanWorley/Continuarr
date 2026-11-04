package xyz.ianworley.continuarr.jellyfin.internal

import com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder
import com.github.tomakehurst.wiremock.client.WireMock.aResponse
import com.github.tomakehurst.wiremock.client.WireMock.equalTo
import com.github.tomakehurst.wiremock.client.WireMock.get
import com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor
import com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo
import com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig
import com.github.tomakehurst.wiremock.junit5.WireMockExtension
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.extension.RegisterExtension
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.server.LibraryKind
import xyz.ianworley.continuarr.server.MediaServerException
import xyz.ianworley.continuarr.server.ServerAccount
import xyz.ianworley.continuarr.server.ServerAccountId
import xyz.ianworley.continuarr.server.ServerLibrary
import xyz.ianworley.continuarr.server.ServerLibraryId
import java.net.ServerSocket
import java.net.URI
import java.time.Duration
import kotlin.concurrent.thread
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

private const val FIXTURES = "wiremock/jellyfin"
private const val USERS_FIXTURE = "get-users.json"
private const val LIBRARIES_FIXTURE = "get-library-virtualfolders.json"
private const val API_KEY = "test-api-key"
private const val EXPECTED_AUTHORIZATION = """MediaBrowser Client="Continuarr", Token="$API_KEY""""

private const val USERS_PATH = "/Users"
private const val VIRTUAL_FOLDERS_PATH = "/Library/VirtualFolders"
private const val SYSTEM_INFO_PATH = "/System/Info"

private const val UNPARSEABLE_BODY = "this is not JSON"
private const val EMPTY_BODY = ""
private const val NULL_ELEMENT_BODY = "[null]"

// A UTF-32 byte-order mark, then a code point above U+10FFFF.
private val MALFORMED_UTF32_BODY = byteArrayOf(0, 0, 0xFE.toByte(), 0xFF.toByte(), 0, 0x11, 0, 0)
private const val UNPARSEABLE_CONTENT_TYPE = "not a media type"

private const val VALID_USERS_BODY = """[{"Id": "valid-user", "Name": "valid", "Policy": {"IsDisabled": false}}]"""

private const val KEPT_LIBRARY_NAME = "Films"
private const val LIBRARIES_WITH_UNSUPPORTED_KINDS = """[
	{"ItemId": "films", "Name": "$KEPT_LIBRARY_NAME", "CollectionType": "movies"},
	{"ItemId": "tunes", "Name": "Tunes", "CollectionType": "music"},
	{"ItemId": "everything", "Name": "Everything"}
]"""

private const val SHORT_READ_TIMEOUT_MILLIS = 500L
private val SHORT_READ_TIMEOUT: Duration = Duration.ofMillis(SHORT_READ_TIMEOUT_MILLIS)
private const val SLOWER_THAN_READ_TIMEOUT_MILLIS = 2000

private const val PARTIAL_BODY = """[{"Id": "dropped"""
private const val PARTIAL_CHUNKED_RESPONSE = "HTTP/1.1 200 OK\r\n" +
	"Content-Type: application/json\r\n" +
	"Transfer-Encoding: chunked\r\n" +
	"\r\n"
private const val HEX = 16

private const val JDK_HTTP_LOG_PROPERTY = "jdk.httpclient.HttpClient.log"
private const val JDK_HTTP_LOG_HEADERS = "requests,headers"
private const val LOST_MID_BODY = "while reading"

// RFC 6761 reserves .invalid, so it never resolves.
private const val UNRESOLVABLE_URL = "http://jellyfin.invalid"
private const val LOOPBACK_URL_PREFIX = "http://127.0.0.1:"

private val RECORDED_USERS = listOf("admin" to false, "user-a" to false, "user-b" to false, "user-disabled" to true)
private val RECORDED_LIBRARIES = listOf("Movies" to LibraryKind.MOVIES, "Shows" to LibraryKind.SHOWS)
private const val RECORDED_SERVER_NAME = "Seed Server"
private const val RECORDED_VERSION = "12.0.0"

private const val NOT_CONFIGURED_MESSAGE = "Jellyfin connection not configured"
private const val UNUSABLE_REASON = "The saved connection can't be used"

private fun usableConnection(url: String): StoredConnection =
	StoredConnection.Usable(JellyfinConnection(URI(url), assertNotNull(JellyfinApiKey.parseOrNull(API_KEY))))

private fun closedPortUrl(): String = LOOPBACK_URL_PREFIX + ServerSocket(0).use { it.localPort }

// IDs change on every re-record, so tests read them from the fixture by name.
private fun recordedIds(fixture: String, idProperty: String): Map<String, String> {
	val mapping = checkNotNull(JellyfinMediaServerTest::class.java.getResource("/$FIXTURES/mappings/$fixture")).readText()
	return JsonMapper().readTree(mapping).path("response").path("jsonBody")
		.associate { it.path("Name").asString() to it.path(idProperty).asString() }
}

private fun serverThatDropsMidBody(): ServerSocket = ServerSocket(0).also { server ->
	thread(isDaemon = true) {
		server.accept().use { socket ->
			val request = socket.getInputStream().bufferedReader()
			generateSequence { request.readLine() }.takeWhile { it.isNotEmpty() }.count()
			val chunk = "${PARTIAL_BODY.length.toString(HEX)}\r\n$PARTIAL_BODY\r\n"
			socket.getOutputStream().write((PARTIAL_CHUNKED_RESPONSE + chunk).toByteArray())
		}
	}
}

@ExtendWith(OutputCaptureExtension::class)
class JellyfinMediaServerTest {

	@RegisterExtension
	private val wireMock: WireMockExtension = WireMockExtension.newInstance()
		.options(wireMockConfig().dynamicPort().usingFilesUnderClasspath(FIXTURES))
		.build()

	private fun mediaServer(url: String = wireMock.baseUrl()) = JellyfinMediaServer({ usableConnection(url) })

	// A cold JVM's first request can take longer than this short timeout.
	private fun impatientMediaServer() = JellyfinMediaServer({ usableConnection(wireMock.baseUrl()) }, SHORT_READ_TIMEOUT)

	private fun stub(path: String, response: ResponseDefinitionBuilder) {
		wireMock.stubFor(get(urlEqualTo(path)).willReturn(response))
	}

	private fun jsonResponse(status: HttpStatus, body: String = VALID_USERS_BODY): ResponseDefinitionBuilder =
		aResponse().withStatus(status.value()).withHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE).withBody(body)

	@Test
	fun `accounts include disabled users, flagged as disabled`() {
		val ids = recordedIds(USERS_FIXTURE, "Id")
		val expected = RECORDED_USERS.map { (name, disabled) -> ServerAccount(ServerAccountId(ids.getValue(name)), name, disabled) }

		assertEquals(expected, mediaServer().accounts())
	}

	@Test
	fun `libraries map movies and tvshows to their kinds`() {
		val ids = recordedIds(LIBRARIES_FIXTURE, "ItemId")
		val expected = RECORDED_LIBRARIES.map { (name, kind) -> ServerLibrary(ServerLibraryId(ids.getValue(name)), name, kind) }

		assertEquals(expected, mediaServer().libraries())
	}

	@Test
	fun `libraries skip music and mixed libraries`() {
		stub(VIRTUAL_FOLDERS_PATH, jsonResponse(HttpStatus.OK, LIBRARIES_WITH_UNSUPPORTED_KINDS))

		assertEquals(listOf(KEPT_LIBRARY_NAME), mediaServer().libraries().map { it.name })
	}

	@Test
	fun `requests send the API key only in a MediaBrowser authorization header`() {
		mediaServer().accounts()

		wireMock.verify(getRequestedFor(urlEqualTo(USERS_PATH)).withHeader(HttpHeaders.AUTHORIZATION, equalTo(EXPECTED_AUTHORIZATION)))
		assertTrue(wireMock.allServeEvents.none { API_KEY in it.request.url })
	}

	@Test
	fun `401 maps to Unauthorized`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.UNAUTHORIZED))

		assertFailsWith<MediaServerException.Unauthorized> { mediaServer().accounts() }
	}

	@Test
	fun `403 maps to Unauthorized`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.FORBIDDEN))

		assertFailsWith<MediaServerException.Unauthorized> { mediaServer().accounts() }
	}

	@Test
	fun `a server error maps to UnexpectedResponse with status and endpoint`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.INTERNAL_SERVER_ERROR))

		val failure = assertFailsWith<MediaServerException.UnexpectedResponse> { mediaServer().accounts() }
		assertContains(failure.message.orEmpty(), HttpStatus.INTERNAL_SERVER_ERROR.value().toString())
		assertContains(failure.message.orEmpty(), USERS_PATH)
	}

	@Test
	fun `an unparseable body maps to UnexpectedResponse with status and endpoint`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.OK, UNPARSEABLE_BODY))

		val failure = assertFailsWith<MediaServerException.UnexpectedResponse> { mediaServer().accounts() }
		assertContains(failure.message.orEmpty(), HttpStatus.OK.value().toString())
		assertContains(failure.message.orEmpty(), USERS_PATH)
	}

	@Test
	fun `an empty body maps to UnexpectedResponse with status and endpoint`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.OK, EMPTY_BODY))

		val failure = assertFailsWith<MediaServerException.UnexpectedResponse> { mediaServer().accounts() }
		assertContains(failure.message.orEmpty(), HttpStatus.OK.value().toString())
		assertContains(failure.message.orEmpty(), USERS_PATH)
	}

	@Test
	fun `a null array element maps to UnexpectedResponse with status and endpoint`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.OK, NULL_ELEMENT_BODY))

		val failure = assertFailsWith<MediaServerException.UnexpectedResponse> { mediaServer().accounts() }
		assertContains(failure.message.orEmpty(), HttpStatus.OK.value().toString())
		assertContains(failure.message.orEmpty(), USERS_PATH)
	}

	@Test
	fun `a body in a broken text encoding maps to UnexpectedResponse with status and endpoint`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.OK).withBody(MALFORMED_UTF32_BODY))

		val failure = assertFailsWith<MediaServerException.UnexpectedResponse> { mediaServer().accounts() }
		assertContains(failure.message.orEmpty(), HttpStatus.OK.value().toString())
		assertContains(failure.message.orEmpty(), USERS_PATH)
	}

	@Test
	fun `an unparseable content type maps to UnexpectedResponse with status and endpoint`() {
		stub(USERS_PATH, aResponse().withStatus(HttpStatus.OK.value()).withHeader(HttpHeaders.CONTENT_TYPE, UNPARSEABLE_CONTENT_TYPE).withBody(VALID_USERS_BODY))

		val failure = assertFailsWith<MediaServerException.UnexpectedResponse> { mediaServer().accounts() }
		assertContains(failure.message.orEmpty(), HttpStatus.OK.value().toString())
		assertContains(failure.message.orEmpty(), USERS_PATH)
	}

	@Test
	fun `connection refused maps to Unreachable`() {
		assertFailsWith<MediaServerException.Unreachable> { mediaServer(url = closedPortUrl()).accounts() }
	}

	@Test
	fun `DNS failure maps to Unreachable`() {
		assertFailsWith<MediaServerException.Unreachable> { mediaServer(url = UNRESOLVABLE_URL).accounts() }
	}

	@Test
	fun `read timeout maps to Unreachable`() {
		stub(USERS_PATH, jsonResponse(HttpStatus.OK).withFixedDelay(SLOWER_THAN_READ_TIMEOUT_MILLIS))

		assertFailsWith<MediaServerException.Unreachable> { impatientMediaServer().accounts() }
	}

	@Test
	fun `a connection that drops mid-body maps to Unreachable`() {
		serverThatDropsMidBody().use { server ->
			val failure = assertFailsWith<MediaServerException.Unreachable> { mediaServer(url = LOOPBACK_URL_PREFIX + server.localPort).accounts() }
			assertContains(failure.message.orEmpty(), LOST_MID_BODY)
		}
	}

	@Test
	fun `calls fail as Unreachable when no connection is saved`() {
		val server = JellyfinMediaServer({ StoredConnection.NotConfigured })

		val failure = assertFailsWith<MediaServerException.Unreachable> { server.accounts() }
		assertEquals(NOT_CONFIGURED_MESSAGE, failure.message)
	}

	@Test
	fun `calls fail as Unreachable with the reason when the saved connection is unusable`() {
		val server = JellyfinMediaServer({ StoredConnection.Unusable(UNUSABLE_REASON) })

		val failure = assertFailsWith<MediaServerException.Unreachable> { server.accounts() }
		assertEquals(UNUSABLE_REASON, failure.message)
	}

	@Test
	fun `each call goes to the connection saved at that moment`() {
		var stored = usableConnection(closedPortUrl())
		val server = JellyfinMediaServer({ stored })
		assertFailsWith<MediaServerException.Unreachable> { server.accounts() }

		stored = usableConnection(wireMock.baseUrl())
		server.accounts()

		wireMock.verify(getRequestedFor(urlEqualTo(USERS_PATH)))
	}

	@Test
	fun `startup check logs the server name and version`(output: CapturedOutput) {
		mediaServer().logServerInfo()

		assertContains(output.out, RECORDED_SERVER_NAME)
		assertContains(output.out, RECORDED_VERSION)
	}

	@Test
	fun `startup check logs a failure instead of throwing`(output: CapturedOutput) {
		wireMock.stubFor(get(urlEqualTo(SYSTEM_INFO_PATH)).willReturn(aResponse().withStatus(HttpStatus.INTERNAL_SERVER_ERROR.value())))

		mediaServer().logServerInfo()

		assertContains(output.out, SYSTEM_INFO_PATH)
	}

	@Test
	fun `startup warns when the JDK is set to log request headers`(output: CapturedOutput) {
		val server = mediaServer()
		val previous = System.setProperty(JDK_HTTP_LOG_PROPERTY, JDK_HTTP_LOG_HEADERS)
		try {
			server.warnIfJdkLogsHeaders()
		} finally {
			if (previous == null) System.clearProperty(JDK_HTTP_LOG_PROPERTY) else System.setProperty(JDK_HTTP_LOG_PROPERTY, previous)
		}

		assertContains(output.out, JDK_HTTP_LOG_PROPERTY)
	}
}
