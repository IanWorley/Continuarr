package xyz.ianworley.continuarr.security.controller

import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

const val AUTH_PATH = "/api/v1/auth"

// Without a session, SecurityConfig answers 401 before this runs, and the SPA sends the visitor to login.
@RestController
class SessionController {

	@GetMapping(AUTH_PATH)
	fun session(authentication: Authentication): Session = Session(authentication.name)
}
