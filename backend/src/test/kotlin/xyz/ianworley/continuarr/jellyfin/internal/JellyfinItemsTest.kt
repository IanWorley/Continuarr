package xyz.ianworley.continuarr.jellyfin.internal

import com.github.tomakehurst.wiremock.client.WireMock.aResponse
import com.github.tomakehurst.wiremock.client.WireMock.equalTo
import com.github.tomakehurst.wiremock.client.WireMock.get
import com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor
import com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo
import com.github.tomakehurst.wiremock.core.WireMockConfiguration.wireMockConfig
import com.github.tomakehurst.wiremock.junit5.WireMockExtension
import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.api.extension.RegisterExtension
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.http.HttpHeaders
import org.springframework.http.MediaType
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.server.ExternalIds
import xyz.ianworley.continuarr.server.FileName
import xyz.ianworley.continuarr.server.ImdbId
import xyz.ianworley.continuarr.server.ServerItem
import xyz.ianworley.continuarr.server.ServerItemId
import xyz.ianworley.continuarr.server.ServerLibraryId
import xyz.ianworley.continuarr.server.TmdbId
import xyz.ianworley.continuarr.server.TvdbId
import java.io.File
import java.net.URI
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Duration.Companion.nanoseconds

private const val FIXTURES = "wiremock/jellyfin"
private const val LIBRARIES_FIXTURE = "get-library-virtualfolders.json"
private const val ITEMS_FIXTURE_PREFIX = "get-items-parentid-"
private const val API_KEY = "test-api-key"
private const val ITEMS_PATH = "/Items"
private const val MOVIE_TYPE = "Movie"
private const val EPISODE_TYPE = "Episode"
private const val ON_DISK = "FileSystem"
private const val MISSING = "Virtual"

private const val RECORDED_MOVIES = "Movies"
private const val RECORDED_SHOWS = "Shows"
private const val RECORDED_MOVIE = "Matched Movie"
private const val RECORDED_SHOW = "Seed Show"
private const val RECORDED_EPISODE = "Normal Episode"
private const val RECORDED_SPECIAL = "Special"
private const val RECORDED_DOUBLE_EPISODE = "Double Episode Part 1 / Double Episode Part 2"
private const val RECORDED_MOVIE_IMDB = "tt0900001"
private const val RECORDED_MOVIE_TMDB = "900001"
private const val RECORDED_MOVIE_YEAR = 2001
private const val RECORDED_MOVIE_FILE = "Matched Movie (2001).mkv"
private const val RECORDED_SHOW_TVDB = "900100"
private const val RECORDED_SHOW_YEAR = 2010
private const val RECORDED_SHOW_FOLDER = "Seed Show (2010)"
private const val RECORDED_EPISODE_TVDB = "900201"
private const val RECORDED_EPISODE_FILE = "Seed Show (2010) S01E01.mkv"
private const val RECORDED_EPISODE_SEASON = 1
private const val RECORDED_EPISODE_NUMBER = 1
private const val SPECIALS_SEASON = 0
private const val DOUBLE_EPISODE_START = 2
private const val DOUBLE_EPISODE_END = 3

private const val RECORDED_RUNTIME_MILLIS = 5_023L

private const val STUB_LIBRARY = "0123456789abcdef0123456789abcdef"
private const val STUB_SHOW = "stub-show"
private const val MALFORMED_IMDB = "nm0000001"
private const val VALID_IMDB = "tt0000001"
private const val VALID_TVDB = "100"
private const val VALID_TMDB = "200"
private const val BLANK = ""

private const val TICKS_WITH_A_REMAINDER = 50_230_001L
private const val NANOS_FOR_TICKS_WITH_A_REMAINDER = 5_023_000_100L

private const val SMALL_PAGE = 2
private const val SECOND_PAGE_START = 2
private const val THIRD_PAGE_START = 4
private const val PAGED_TOTAL = 5
private const val SHORT_PAGE_TOTAL = 10

private val json = JsonMapper()

private fun usableConnection(url: String): StoredConnection =
	StoredConnection.Usable(JellyfinConnection(URI(url), assertNotNull(JellyfinApiKey.parseOrNull(API_KEY))))

private fun mappingBody(file: File): JsonNode = json.readTree(file.readText()).path("response").path("jsonBody")

private fun mappingsDirectory(): File = File(checkNotNull(JellyfinItemsTest::class.java.getResource("/$FIXTURES/mappings")).toURI())

private fun recordedLibraryId(name: String): String =
	mappingBody(mappingsDirectory().resolve(LIBRARIES_FIXTURE)).single { it.path("Name").asString() == name }.path("ItemId").asString()

private fun recordedItemIds(libraryId: String): Map<String, String> {
	val fixture = mappingsDirectory().listFiles().orEmpty().single { it.name.startsWith("$ITEMS_FIXTURE_PREFIX$libraryId-") }
	return mappingBody(fixture).path("Items").associate { it.path("Name").asString() to it.path("Id").asString() }
}

private fun movie(id: String, vararg fields: Pair<String, Any?>): Map<String, Any?> =
	mapOf("Id" to id, "Name" to id, "Type" to MOVIE_TYPE, *fields)

private fun episode(id: String, vararg fields: Pair<String, Any?>): Map<String, Any?> =
	mapOf("Id" to id, "Name" to id, "Type" to EPISODE_TYPE, "SeriesId" to STUB_SHOW, "LocationType" to ON_DISK, *fields)

private fun page(items: List<Map<String, Any?>>, total: Int = items.size): String =
	json.writeValueAsString(mapOf("Items" to items, "TotalRecordCount" to total))

@ExtendWith(OutputCaptureExtension::class)
class JellyfinItemsTest {

	@RegisterExtension
	private val wireMock: WireMockExtension = WireMockExtension.newInstance()
		.options(wireMockConfig().dynamicPort().usingFilesUnderClasspath(FIXTURES))
		.build()

	private fun mediaServer(pageSize: PageSize = JELLYFIN_PAGE_SIZE) =
		JellyfinMediaServer({ usableConnection(wireMock.baseUrl()) }, pageSize = pageSize)

	private fun recordedItems(library: String): List<ServerItem> = mediaServer().items(ServerLibraryId(recordedLibraryId(library))).toList()

	private fun stubItems(body: String) {
		wireMock.stubFor(get(urlPathEqualTo(ITEMS_PATH)).willReturn(jsonResponse(body)))
	}

	private fun stubPage(startIndex: Int, limit: Int, body: String) {
		wireMock.stubFor(
			get(urlPathEqualTo(ITEMS_PATH))
				.withQueryParam("StartIndex", equalTo(startIndex.toString()))
				.withQueryParam("Limit", equalTo(limit.toString()))
				.willReturn(jsonResponse(body)),
		)
	}

	private fun jsonResponse(body: String) =
		aResponse().withHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE).withBody(body)

	private fun stubbedItems(pageSize: PageSize = JELLYFIN_PAGE_SIZE): List<ServerItem> =
		mediaServer(pageSize).items(ServerLibraryId(STUB_LIBRARY)).toList()

	private fun itemsRequests(): Int = wireMock.findAll(getRequestedFor(urlPathEqualTo(ITEMS_PATH))).size

	@Test
	fun `maps a movie's IDs, year, runtime, and file name`() {
		val movies = recordedLibraryId(RECORDED_MOVIES)
		val expected = ServerItem.Movie(
			id = ServerItemId(recordedItemIds(movies).getValue(RECORDED_MOVIE)),
			title = RECORDED_MOVIE,
			externalIds = ExternalIds(imdb = ImdbId.parseOrNull(RECORDED_MOVIE_IMDB), tmdb = TmdbId.parseOrNull(RECORDED_MOVIE_TMDB)),
			fileName = FileName.fromPathOrNull(RECORDED_MOVIE_FILE),
			year = RECORDED_MOVIE_YEAR,
			edition = null,
			runtime = RECORDED_RUNTIME_MILLIS.milliseconds,
		)

		assertEquals(expected, recordedItems(RECORDED_MOVIES).single { it.title == RECORDED_MOVIE })
	}

	@Test
	fun `maps a show's TVDb ID, year, and folder name`() {
		val shows = recordedLibraryId(RECORDED_SHOWS)
		val expected = ServerItem.Show(
			id = ServerItemId(recordedItemIds(shows).getValue(RECORDED_SHOW)),
			title = RECORDED_SHOW,
			externalIds = ExternalIds(tvdb = TvdbId.parseOrNull(RECORDED_SHOW_TVDB)),
			fileName = FileName.fromPathOrNull(RECORDED_SHOW_FOLDER),
			year = RECORDED_SHOW_YEAR,
		)

		assertEquals(expected, recordedItems(RECORDED_SHOWS).single { it.title == RECORDED_SHOW })
	}

	@Test
	fun `maps an episode's show, season, and episode numbers`() {
		val ids = recordedItemIds(recordedLibraryId(RECORDED_SHOWS))
		val expected = ServerItem.Episode(
			id = ServerItemId(ids.getValue(RECORDED_EPISODE)),
			title = RECORDED_EPISODE,
			externalIds = ExternalIds(tvdb = TvdbId.parseOrNull(RECORDED_EPISODE_TVDB)),
			fileName = FileName.fromPathOrNull(RECORDED_EPISODE_FILE),
			showId = ServerItemId(ids.getValue(RECORDED_SHOW)),
			season = RECORDED_EPISODE_SEASON,
			episode = RECORDED_EPISODE_NUMBER,
			episodeEnd = null,
			runtime = RECORDED_RUNTIME_MILLIS.milliseconds,
		)

		assertEquals(expected, recordedItems(RECORDED_SHOWS).single { it.title == RECORDED_EPISODE })
	}

	@Test
	fun `keeps a special in season 0`() {
		val special = recordedItems(RECORDED_SHOWS).single { it.title == RECORDED_SPECIAL }

		assertEquals(SPECIALS_SEASON, (special as ServerItem.Episode).season)
	}

	@Test
	fun `maps a multi-episode file's episode end`() {
		val double = recordedItems(RECORDED_SHOWS).single { it.title == RECORDED_DOUBLE_EPISODE } as ServerItem.Episode

		assertEquals(DOUBLE_EPISODE_START to DOUBLE_EPISODE_END, double.episode to double.episodeEnd)
	}

	@Test
	fun `excludes missing episodes`() {
		stubItems(page(listOf(episode("on-disk"), episode("missing", "LocationType" to MISSING))))

		assertEquals(listOf("on-disk"), stubbedItems().map { it.id.value })
	}

	@Test
	fun `treats a malformed provider ID as missing and logs a warning with the item ID`(output: CapturedOutput) {
		stubItems(page(listOf(movie("malformed-imdb", "ProviderIds" to mapOf("Imdb" to MALFORMED_IMDB, "Tmdb" to VALID_TMDB)))))

		assertEquals(ExternalIds(tmdb = TmdbId.parseOrNull(VALID_TMDB)), stubbedItems().single().externalIds)
		assertContains(output.out, "malformed-imdb")
	}

	@Test
	fun `treats a blank provider ID as missing without a warning`(output: CapturedOutput) {
		stubItems(page(listOf(movie("blank-imdb", "ProviderIds" to mapOf("Imdb" to BLANK, "Tmdb" to VALID_TMDB)))))

		assertEquals(ExternalIds(tmdb = TmdbId.parseOrNull(VALID_TMDB)), stubbedItems().single().externalIds)
		assertFalse("blank-imdb" in output.out)
	}

	@Test
	fun `matches provider ID keys case-insensitively`() {
		stubItems(page(listOf(movie("shouty", "ProviderIds" to mapOf("IMDB" to VALID_IMDB, "tvdb" to VALID_TVDB, "TmDb" to VALID_TMDB)))))
		val expected = ExternalIds(ImdbId.parseOrNull(VALID_IMDB), TvdbId.parseOrNull(VALID_TVDB), TmdbId.parseOrNull(VALID_TMDB))

		assertEquals(expected, stubbedItems().single().externalIds)
	}

	@Test
	fun `keeps an item whose provider ID value is null`() {
		stubItems(page(listOf(movie("null-imdb", "ProviderIds" to mapOf("Imdb" to null, "Tmdb" to VALID_TMDB)))))

		assertEquals(ExternalIds(tmdb = TmdbId.parseOrNull(VALID_TMDB)), stubbedItems().single().externalIds)
	}

	@Test
	fun `skips an episode with no show and logs its ID`(output: CapturedOutput) {
		stubItems(page(listOf(episode("orphan", "SeriesId" to null), episode("kept"))))

		assertEquals(listOf("kept"), stubbedItems().map { it.id.value })
		assertContains(output.out, "orphan")
	}

	@Test
	fun `pages across more than one page without duplicates`() {
		stubPage(0, SMALL_PAGE, page(listOf(movie("a"), movie("b")), PAGED_TOTAL))
		stubPage(SECOND_PAGE_START, SMALL_PAGE, page(listOf(movie("b"), movie("c")), PAGED_TOTAL))
		stubPage(THIRD_PAGE_START, SMALL_PAGE, page(listOf(movie("d")), PAGED_TOTAL))

		assertEquals(listOf("a", "b", "c", "d"), stubbedItems(PageSize(SMALL_PAGE)).map { it.id.value })
	}

	@Test
	fun `stops after a short page even when TotalRecordCount says more`() {
		stubPage(0, SMALL_PAGE, page(listOf(movie("only")), SHORT_PAGE_TOTAL))

		stubbedItems(PageSize(SMALL_PAGE))

		assertEquals(1, itemsRequests())
	}

	@Test
	fun `stops once StartIndex reaches TotalRecordCount`() {
		stubPage(0, SMALL_PAGE, page(listOf(movie("a"), movie("b")), SMALL_PAGE))

		stubbedItems(PageSize(SMALL_PAGE))

		assertEquals(1, itemsRequests())
	}

	@Test
	fun `fetches nothing until iterated`() {
		stubPage(0, 1, page(listOf(movie("first")), SMALL_PAGE))
		stubPage(1, 1, page(listOf(movie("second")), SMALL_PAGE))

		val items = mediaServer(PageSize(1)).items(ServerLibraryId(STUB_LIBRARY))
		assertEquals(0, itemsRequests())

		items.first()
		assertEquals(1, itemsRequests())
	}

	@Test
	fun `converts ticks to the exact Duration`() {
		stubItems(page(listOf(movie("precise", "RunTimeTicks" to TICKS_WITH_A_REMAINDER))))

		assertEquals(NANOS_FOR_TICKS_WITH_A_REMAINDER.nanoseconds, (stubbedItems().single() as ServerItem.Movie).runtime)
	}
}
