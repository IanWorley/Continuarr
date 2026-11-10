package xyz.ianworley.continuarr.mediaproviders.controller

import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.logging.LogLevel
import org.springframework.boot.logging.LoggingSystem
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user
import org.springframework.test.json.JsonCompareMode
import org.springframework.test.web.servlet.MockHttpServletRequestDsl
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.put
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.TEST_ENCRYPTION_KEY_PROPERTY
import xyz.ianworley.continuarr.TestcontainersConfiguration
import xyz.ianworley.continuarr.security.putWithCsrf
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse

private const val ADMIN_USERNAME = "admin"
private const val URL = "http://jellyfin:8096"
private const val API_KEY = "0123456789abcdef0123456789abcdef"
private const val URL_PASSWORD = "url-password"
private const val INVALID_URL = "http://user:$URL_PASSWORD@jellyfin:8096"
private const val INVALID_API_KEY = "has a space"
private const val UNQUOTED_API_KEY = "unquotedSentinelKey123"
private const val UNQUOTED_KEY_BODY = """{"url": "$URL", "apiKey": $UNQUOTED_API_KEY}"""
private const val SPRING_WEB_LOGGER = "org.springframework.web"
private const val JSON_NULL_BODY = "null"

private const val NO_URL_JSON = """{"url": null}"""
private const val SAVED_URL_JSON = """{"url": "$URL"}"""
private const val BOTH_FIELDS_INVALID_JSON = """{"invalidFields": ["URL", "API_KEY"]}"""

// TRACE is Spring's most verbose level, so nothing it logs at DEBUG can be missed.
private fun withSpringWebTraceLogging(request: () -> Unit) {
	val logging = LoggingSystem.get(JellyfinConnectionControllerTest::class.java.classLoader)
	logging.setLogLevel(SPRING_WEB_LOGGER, LogLevel.TRACE)
	try {
		request()
	} finally {
		logging.setLogLevel(SPRING_WEB_LOGGER, null)
	}
}

private fun MockHttpServletRequestDsl.jsonBody(url: String, apiKey: String) {
	contentType = MediaType.APPLICATION_JSON
	content = JsonMapper().writeValueAsString(mapOf("url" to url, "apiKey" to apiKey))
}

@SpringBootTest(properties = [TEST_ENCRYPTION_KEY_PROPERTY])
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
@ExtendWith(OutputCaptureExtension::class)
class JellyfinConnectionControllerTest(
	@Autowired private val mockMvc: MockMvc,
	@Autowired private val jdbcClient: JdbcClient,
) {

	@BeforeTest
	fun startWithNothingSaved() {
		jdbcClient.sql("DELETE FROM jellyfin_connection").update()
	}

	@Test
	fun `GET before a save returns a null URL`() {
		mockMvc.get(JELLYFIN_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { status { isOk() } }
			.andExpect { content { json(NO_URL_JSON, JsonCompareMode.STRICT) } }
	}

	@Test
	fun `PUT saves the connection, and GET returns its URL without the API key`() {
		val saved = mockMvc.saveConnection(URL, API_KEY).andExpect { status { isNoContent() } }.andReturn()

		val read = mockMvc.get(JELLYFIN_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { content { json(SAVED_URL_JSON, JsonCompareMode.STRICT) } }
			.andReturn()
		assertFalse(saved.response.contentAsString.contains(API_KEY))
		assertFalse(read.response.contentAsString.contains(API_KEY))
	}

	@Test
	fun `PUT with invalid values answers 400 naming the fields without echoing their values`() {
		val response = mockMvc.saveConnection(INVALID_URL, INVALID_API_KEY)
			.andExpect { status { isBadRequest() } }
			.andExpect { content { json(BOTH_FIELDS_INVALID_JSON, JsonCompareMode.STRICT) } }
			.andReturn().response.contentAsString

		assertFalse(response.contains(URL_PASSWORD))
		assertFalse(response.contains(INVALID_API_KEY))
	}

	@Test
	fun `an unreadable body answers 400 and keeps an unquoted API key out of the log at every level`(output: CapturedOutput) {
		withSpringWebTraceLogging {
			mockMvc.putWithCsrf(JELLYFIN_CONNECTION_PATH) {
				with(user(ADMIN_USERNAME))
				contentType = MediaType.APPLICATION_JSON
				content = UNQUOTED_KEY_BODY
			}.andExpect { status { isBadRequest() } }
		}

		assertFalse(output.all.contains(UNQUOTED_API_KEY))
	}

	@Test
	fun `a JSON null body answers 400`() {
		mockMvc.putWithCsrf(JELLYFIN_CONNECTION_PATH) {
			with(user(ADMIN_USERNAME))
			contentType = MediaType.APPLICATION_JSON
			content = JSON_NULL_BODY
		}.andExpect { status { isBadRequest() } }
	}

	@Test
	fun `a saved API key stays out of the log at every level`(output: CapturedOutput) {
		withSpringWebTraceLogging {
			mockMvc.saveConnection(URL, API_KEY).andExpect { status { isNoContent() } }
		}

		assertFalse(output.all.contains(API_KEY))
	}

	@Test
	fun `GET needs a login`() {
		mockMvc.get(JELLYFIN_CONNECTION_PATH).andExpect { status { isUnauthorized() } }
	}

	@Test
	fun `PUT needs a login`() {
		mockMvc.putWithCsrf(JELLYFIN_CONNECTION_PATH) { jsonBody(URL, API_KEY) }.andExpect { status { isUnauthorized() } }
	}

	@Test
	fun `PUT needs a CSRF token`() {
		mockMvc.put(JELLYFIN_CONNECTION_PATH) {
			with(user(ADMIN_USERNAME))
			jsonBody(URL, API_KEY)
		}.andExpect { status { isForbidden() } }
	}

	private fun MockMvc.saveConnection(url: String, apiKey: String): ResultActionsDsl = putWithCsrf(JELLYFIN_CONNECTION_PATH) {
		with(user(ADMIN_USERNAME))
		jsonBody(url, apiKey)
	}
}

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class JellyfinConnectionControllerWithoutEncryptionKeyTest(@Autowired private val mockMvc: MockMvc) {

	@Test
	fun `PUT answers 503 and stores nothing without an encryption key`() {
		mockMvc.putWithCsrf(JELLYFIN_CONNECTION_PATH) {
			with(user(ADMIN_USERNAME))
			jsonBody(URL, API_KEY)
		}.andExpect { status { isServiceUnavailable() } }

		mockMvc.get(JELLYFIN_CONNECTION_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { content { json(NO_URL_JSON, JsonCompareMode.STRICT) } }
	}
}
