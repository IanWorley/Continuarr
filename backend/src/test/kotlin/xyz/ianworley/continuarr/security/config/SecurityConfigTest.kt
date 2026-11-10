package xyz.ianworley.continuarr.web

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user
import org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated
import org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.unauthenticated
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.post
import xyz.ianworley.continuarr.TestcontainersConfiguration
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertNull

private const val ADMIN_USERNAME = "admin"
private const val ADMIN_PASSWORD = "correct-horse-battery"
private const val WRONG_PASSWORD = "wrong-password"

// Any versioned API route; nothing needs to be mapped there for security to answer first.
private const val PROTECTED_PATH = "/api/v1/anything"

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class SecurityConfigTest(
	@Autowired private val mockMvc: MockMvc,
	@Autowired private val users: UserRepository,
	@Autowired private val passwordEncoder: PasswordEncoder,
) {

	@BeforeTest
	fun createAdmin() {
		users.deleteAll()
		users.save(User(ADMIN_USERNAME, passwordEncoder.encode(ADMIN_PASSWORD)!!))
	}

	@Test
	fun `the health endpoint is public`() {
		mockMvc.get("/actuator/health").andExpect { status { isOk() } }
	}

	@Test
	fun `unauthenticated requests get 401 instead of a redirect`() {
		mockMvc.get(PROTECTED_PATH).andExpect { status { isUnauthorized() } }
	}

	@Test
	fun `an anonymous 401 creates no session`() {
		val request = mockMvc.get(PROTECTED_PATH).andExpect { status { isUnauthorized() } }.andReturn().request
		assertNull(request.getSession(false))
	}

	@Test
	fun `the CSRF cookie is readable by JavaScript`() {
		mockMvc.get(CSRF_PATH).andExpect {
			status { isNoContent() }
			cookie { httpOnly(CSRF_COOKIE, false) }
		}
	}

	@Test
	fun `the admin logs in with the right password`() {
		mockMvc.logIn(ADMIN_USERNAME, ADMIN_PASSWORD).andExpect {
			status { isNoContent() }
			match(authenticated().withUsername(ADMIN_USERNAME))
		}
	}

	@Test
	fun `a wrong password gets 401`() {
		mockMvc.logIn(ADMIN_USERNAME, WRONG_PASSWORD).andExpect {
			status { isUnauthorized() }
			match(unauthenticated())
		}
	}

	@Test
	fun `login without a CSRF token is rejected`() {
		mockMvc.post(LOGIN_PATH).andExpect { status { isForbidden() } }
	}

	@Test
	fun `logout answers 204 instead of a redirect`() {
		mockMvc.postWithCsrf(LOGOUT_PATH) { with(user(ADMIN_USERNAME)) }.andExpect { status { isNoContent() } }
	}
}
