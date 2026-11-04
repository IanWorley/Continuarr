package xyz.ianworley.continuarr.web

import org.junit.jupiter.api.extension.ExtendWith
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EnumSource
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.logging.LogLevel
import org.springframework.boot.logging.LoggingSystem
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.system.CapturedOutput
import org.springframework.boot.test.system.OutputCaptureExtension
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.test.web.servlet.MockMvc
import org.springframework.web.servlet.mvc.method.annotation.RequestResponseBodyMethodProcessor
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.ContinuarrApplication
import xyz.ianworley.continuarr.TestcontainersConfiguration
import kotlin.test.assertContains
import kotlin.test.assertFalse

private const val WRONG_TOKEN = "0123456789abcdef0123456789abcdef"
private const val USERNAME = "admin"
private const val PASSWORD = "correct-horse-battery"
private const val SPRING_LOGGER = "org.springframework"
private val APP_LOGGER = ContinuarrApplication::class.java.packageName

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
@ExtendWith(OutputCaptureExtension::class)
class SetupRequestLoggingTest(
	@Autowired private val mockMvc: MockMvc,
	@Autowired private val jsonMapper: JsonMapper,
	@Autowired private val loggingSystem: LoggingSystem,
) {

	@ParameterizedTest
	@EnumSource(LogLevel::class, names = ["DEBUG", "TRACE"])
	fun `setup logs neither the token nor the password from a well-formed body`(level: LogLevel, output: CapturedOutput) {
		withLogLevel(level, SPRING_LOGGER, APP_LOGGER) {
			mockMvc.postWithCsrf(SETUP_PATH) {
				contentType = MediaType.APPLICATION_JSON
				content = jsonMapper.writeValueAsString(SetupRequest(WRONG_TOKEN, USERNAME, PASSWORD))
			}
		}

		assertContains(output.all, RequestResponseBodyMethodProcessor::class.java.simpleName, message = "Spring did not log the request body")
		assertFalse(WRONG_TOKEN in output.all, "The token reached the log")
		assertFalse(PASSWORD in output.all, "The password reached the log")
	}

	private fun withLogLevel(level: LogLevel, vararg loggers: String, block: () -> Unit) {
		val previous = loggers.associateWith { loggingSystem.getLoggerConfiguration(it)?.configuredLevel }
		loggers.forEach { loggingSystem.setLogLevel(it, level) }
		try {
			block()
		} finally {
			previous.forEach { (logger, previousLevel) -> loggingSystem.setLogLevel(logger, previousLevel) }
		}
	}
}
