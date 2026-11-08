package xyz.ianworley.continuarr.web

import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.logging.LogLevel
import org.springframework.boot.logging.LoggingSystem
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.get
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.ContinuarrApplication
import xyz.ianworley.continuarr.TestcontainersConfiguration
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull

private const val ADMIN_USERNAME = "admin"
private const val ADMIN_PASSWORD = "correct-horse-battery"
private const val SECOND_USERNAME = "intruder"
private const val TOO_SHORT_PASSWORD = "short"
private const val WRONG_TOKEN = "not-the-setup-token"
private const val PASSWORD_CANARY = "PasswordCanary"

// Jackson's parser rejects the first. It parses the second, then quotes the string when it can't map it to SetupRequest.
private const val UNQUOTED_PASSWORD_JSON = """{"token":"$WRONG_TOKEN","username":"$ADMIN_USERNAME","password":$PASSWORD_CANARY}"""
private const val BARE_PASSWORD_JSON = """"$PASSWORD_CANARY""""
private const val NULL_JSON = "null"
private const val SETUP_REQUIRED_JSON_PATH = "$.required"
private const val SPRING_LOGGERS = "org.springframework"

private val TRACED_LOGGERS = listOf(SPRING_LOGGERS, ContinuarrApplication::class.java.packageName)

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
@ExtendWith(OutputCaptureExtension::class)
class SetupControllerTest(
	@Autowired private val mockMvc: MockMvc,
	@Autowired private val users: UserRepository,
	@Autowired private val setupToken: SetupToken,
	@Autowired private val jsonMapper: JsonMapper,
	@Autowired private val loggingSystem: LoggingSystem,
) {

	@BeforeTest
	fun startWithoutAdmin() {
		users.deleteAll()
	}

	@Test
	fun `setup with the logged token creates an admin who can log in`() {
		setUp(SetupRequest(setupToken.value, ADMIN_USERNAME, ADMIN_PASSWORD)).andExpect { status { isNoContent() } }

		mockMvc.logIn(ADMIN_USERNAME, ADMIN_PASSWORD).andExpect { match(authenticated().withUsername(ADMIN_USERNAME)) }
	}

	@Test
	fun `setup with the wrong token is forbidden and creates nothing`() {
		setUp(SetupRequest(WRONG_TOKEN, ADMIN_USERNAME, ADMIN_PASSWORD)).andExpect { status { isForbidden() } }

		assertEquals(0, users.count())
	}

	@Test
	fun `setup is refused once an admin exists`() {
		setUp(SetupRequest(setupToken.value, ADMIN_USERNAME, ADMIN_PASSWORD))

		setUp(SetupRequest(setupToken.value, SECOND_USERNAME, ADMIN_PASSWORD)).andExpect { status { isConflict() } }
	}

	@Test
	fun `setup rejects a password shorter than the minimum`() {
		setUp(SetupRequest(setupToken.value, ADMIN_USERNAME, TOO_SHORT_PASSWORD)).andExpect { status { isBadRequest() } }
	}

	@ParameterizedTest
	@ValueSource(strings = [UNQUOTED_PASSWORD_JSON, BARE_PASSWORD_JSON])
	fun `setup rejects unreadable JSON without logging the password at any level`(json: String, output: CapturedOutput) {
		val configuredLevels = TRACED_LOGGERS.associateWith { loggingSystem.getLoggerConfiguration(it)?.configuredLevel }
		TRACED_LOGGERS.forEach { loggingSystem.setLogLevel(it, LogLevel.TRACE) }
		val rejection = try {
			postSetup(json).andExpect { status { isBadRequest() } }.andReturn().resolvedException
		} finally {
			configuredLevels.forEach { (name, level) -> loggingSystem.setLogLevel(name, level) }
		}

		assertContains(output.all, HttpMessageNotReadableException::class.java.name)
		assertFalse(PASSWORD_CANARY in output.all, "The password reached the log")
		assertFalse(
			PASSWORD_CANARY in assertNotNull(rejection).stackTraceToString(),
			"The password is in the stack trace a logger would print",
		)
	}

	@Test
	fun `setup rejects a JSON null body`() {
		postSetup(NULL_JSON).andExpect { status { isBadRequest() } }
	}

	@Test
	fun `setup is reported as required, without logging in, until an admin exists`() {
		mockMvc.get(SETUP_PATH).andExpect { jsonPath(SETUP_REQUIRED_JSON_PATH) { value(true) } }

		setUp(SetupRequest(setupToken.value, ADMIN_USERNAME, ADMIN_PASSWORD))

		mockMvc.get(SETUP_PATH).andExpect { jsonPath(SETUP_REQUIRED_JSON_PATH) { value(false) } }
	}

	private fun setUp(request: SetupRequest): ResultActionsDsl = postSetup(jsonMapper.writeValueAsString(request))

	private fun postSetup(json: String): ResultActionsDsl = mockMvc.postWithCsrf(SETUP_PATH) {
		contentType = MediaType.APPLICATION_JSON
		content = json
	}
}
