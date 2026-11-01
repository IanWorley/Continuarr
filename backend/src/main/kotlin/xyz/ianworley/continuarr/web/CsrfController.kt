package xyz.ianworley.continuarr.web

import org.springframework.http.HttpStatus
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController

const val CSRF_PATH = "/api/csrf"

// csrf.spa() defers the token, so the XSRF-TOKEN cookie is only written once something reads
// it. Clients call this before their first POST (setup or login).
@RestController
class CsrfController {

	@GetMapping(CSRF_PATH)
	@ResponseStatus(HttpStatus.NO_CONTENT)
	fun csrf(token: CsrfToken) {
		token.token
	}
}
