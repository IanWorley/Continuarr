package xyz.ianworley.continuarr.security.controller

import io.swagger.v3.oas.annotations.Parameter
import org.springframework.http.HttpStatus
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

const val CSRF_PATH = "/api/csrf"

// Reading the token writes the XSRF-TOKEN cookie when the request has none.
@RestController
class CsrfController {

	@GetMapping(CSRF_PATH)
	@ResponseStatus(HttpStatus.NO_CONTENT)
	// Resolved by Spring Security, not sent by the client, so it stays out of the OpenAPI spec.
	fun csrf(@Parameter(hidden = true) token: CsrfToken) {
		token.token
	}
}
