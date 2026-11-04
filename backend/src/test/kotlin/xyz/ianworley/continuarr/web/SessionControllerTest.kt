package xyz.ianworley.continuarr.web

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import xyz.ianworley.continuarr.TestcontainersConfiguration
import kotlin.test.Test

private const val ADMIN_USERNAME = "admin"
private const val USERNAME_JSON_PATH = "$.username"

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class SessionControllerTest(@Autowired private val mockMvc: MockMvc) {

	@Test
	fun `the session names the signed-in admin`() {
		mockMvc.get(SESSION_PATH) { with(user(ADMIN_USERNAME)) }.andExpect {
			status { isOk() }
			jsonPath(USERNAME_JSON_PATH) { value(ADMIN_USERNAME) }
		}
	}

	@Test
	fun `a visitor without a session gets 401`() {
		mockMvc.get(SESSION_PATH).andExpect { status { isUnauthorized() } }
	}
}
