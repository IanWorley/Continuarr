package xyz.ianworley.continuarr.security

import jakarta.servlet.http.Cookie
import org.springframework.test.web.servlet.MockHttpServletRequestDsl
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.ResultActionsDsl
import org.springframework.test.web.servlet.get
import org.springframework.test.web.servlet.patch
import org.springframework.test.web.servlet.post
import org.springframework.test.web.servlet.put
import xyz.ianworley.continuarr.security.config.LOGIN_PATH
import xyz.ianworley.continuarr.security.controller.CSRF_PATH
import kotlin.test.assertNotNull

const val CSRF_COOKIE = "XSRF-TOKEN"
const val CSRF_HEADER = "X-XSRF-TOKEN"

// Spring Security's default form login parameter names.
private const val USERNAME_PARAM = "username"
private const val PASSWORD_PARAM = "password"

/**
 * POSTs the way the SPA will: fetch the XSRF-TOKEN cookie, then send it back as a header.
 * Tests avoid spring-security-test's csrf() because it swaps the app's cookie repository for
 * a session one, and that swap leaks into later tests sharing the Spring context.
 */
fun MockMvc.postWithCsrf(path: String, dsl: MockHttpServletRequestDsl.() -> Unit = {}): ResultActionsDsl {
	val xsrfCookie = xsrfCookie()
	return post(path) {
		sendCsrf(xsrfCookie)
		dsl()
	}
}

fun MockMvc.putWithCsrf(path: String, dsl: MockHttpServletRequestDsl.() -> Unit = {}): ResultActionsDsl {
	val xsrfCookie = xsrfCookie()
	return put(path) {
		sendCsrf(xsrfCookie)
		dsl()
	}
}

fun MockMvc.patchWithCsrf(path: String, dsl: MockHttpServletRequestDsl.() -> Unit = {}): ResultActionsDsl {
	val xsrfCookie = xsrfCookie()
	return patch(path) {
		sendCsrf(xsrfCookie)
		dsl()
	}
}

private fun MockMvc.xsrfCookie(): Cookie = assertNotNull(get(CSRF_PATH).andReturn().response.getCookie(CSRF_COOKIE))

private fun MockHttpServletRequestDsl.sendCsrf(xsrfCookie: Cookie) {
	cookie(xsrfCookie)
	header(CSRF_HEADER, xsrfCookie.value)
}

fun MockMvc.logIn(username: String, password: String): ResultActionsDsl = postWithCsrf(LOGIN_PATH) {
	param(USERNAME_PARAM, username)
	param(PASSWORD_PARAM, password)
}
