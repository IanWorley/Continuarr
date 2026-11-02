package xyz.ianworley.continuarr.web

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.TestcontainersConfiguration
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

private const val ADMIN_USERNAME = "admin"
private const val ADMIN_PASSWORD = "correct-horse-battery"
private const val SECOND_USERNAME = "intruder"
private const val TOO_SHORT_PASSWORD = "short"
private const val WRONG_TOKEN = "not-the-setup-token"

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class SetupControllerTest(
	@Autowired private val mockMvc: MockMvc,
	@Autowired private val users: UserRepository,
	@Autowired private val setupToken: SetupToken,
	@Autowired private val jsonMapper: JsonMapper,
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

	private fun setUp(request: SetupRequest): ResultActionsDsl = mockMvc.postWithCsrf(SETUP_PATH) {
		contentType = MediaType.APPLICATION_JSON
		content = jsonMapper.writeValueAsString(request)
	}
}
