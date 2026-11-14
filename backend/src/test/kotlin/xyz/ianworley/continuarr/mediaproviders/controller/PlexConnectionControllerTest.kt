package xyz.ianworley.continuarr.mediaproviders.controller

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user
import org.springframework.test.json.JsonCompareMode
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import xyz.ianworley.continuarr.TestcontainersConfiguration
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionStore
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexToken
import xyz.ianworley.continuarr.security.deleteWithCsrf
import java.net.URI
import java.util.concurrent.CyclicBarrier
import kotlin.concurrent.thread
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

private const val ADMIN_USERNAME = "admin"
private const val URL = "http://plex:32400"
private const val TOKEN = "plexControllerToken789"
private const val NOTHING_SAVED_JSON = """{"url": null, "source": null, "tokenState": "NONE"}"""
private const val CONCURRENT_UNLINKS = 2
private const val UNLINK_RACE_ROUNDS = 10
private const val HTTP_NO_CONTENT = 204
private const val SEEDED_JSON = """{"url": "$URL", "source": "ENVIRONMENT", "tokenState": "STORED"}"""

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class PlexConnectionControllerTest(
	@Autowired private val mockMvc: MockMvc,
	@Autowired private val store: PlexConnectionStore,
	@Autowired private val jdbcClient: JdbcClient,
) {

	@BeforeTest
	fun startWithNothingSaved() {
		jdbcClient.sql("DELETE FROM plex_connection").update()
	}

	@Test
	fun `GET before a seed returns null URL and source and no token`() {
		mockMvc.get(PLEX_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { status { isOk() } }
			.andExpect { content { json(NOTHING_SAVED_JSON, JsonCompareMode.STRICT) } }
	}

	@Test
	fun `GET returns the seeded URL, source, and token state without the token`() {
		store.seed(URI(URL), assertNotNull(PlexToken.parseOrNull(TOKEN)))

		val body = mockMvc.get(PLEX_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { status { isOk() } }
			.andExpect { content { json(SEEDED_JSON, JsonCompareMode.STRICT) } }
			.andReturn().response.contentAsString
		assertFalse(body.contains(TOKEN))
	}

	@Test
	fun `GET needs a login`() {
		mockMvc.get(PLEX_CONNECTION_PATH).andExpect { status { isUnauthorized() } }
	}

	@Test
	fun `DELETE unlinks, so GET returns nothing saved`() {
		store.seed(URI(URL), assertNotNull(PlexToken.parseOrNull(TOKEN)))

		mockMvc.deleteWithCsrf(PLEX_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }.andExpect { status { isNoContent() } }
		mockMvc.get(PLEX_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { content { json(NOTHING_SAVED_JSON, JsonCompareMode.STRICT) } }
	}

	@Test
	fun `DELETE with nothing saved still answers 204`() {
		mockMvc.deleteWithCsrf(PLEX_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }.andExpect { status { isNoContent() } }
	}

	@Test
	fun `DELETE needs a login`() {
		store.seed(URI(URL), assertNotNull(PlexToken.parseOrNull(TOKEN)))

		mockMvc.deleteWithCsrf(PLEX_CONNECTION_PATH).andExpect { status { isUnauthorized() } }
		mockMvc.get(PLEX_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { content { json(SEEDED_JSON, JsonCompareMode.STRICT) } }
	}

	@Test
	fun `two DELETEs at once both answer 204`() {
		repeat(UNLINK_RACE_ROUNDS) {
			store.seed(URI(URL), assertNotNull(PlexToken.parseOrNull(TOKEN)))
			val barrier = CyclicBarrier(CONCURRENT_UNLINKS)
			val statuses = IntArray(CONCURRENT_UNLINKS)
			List(CONCURRENT_UNLINKS) { index ->
				thread {
					barrier.await()
					statuses[index] = mockMvc.deleteWithCsrf(PLEX_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
						.andReturn().response.status
				}
			}.forEach { it.join() }
			assertEquals(List(CONCURRENT_UNLINKS) { HTTP_NO_CONTENT }, statuses.toList())
		}
	}
}
