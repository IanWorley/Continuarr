package xyz.ianworley.continuarr.web

import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RestController

const val SESSION_PATH = "/api/session"

// Without a session, SecurityConfig answers 401 before this runs, and the SPA sends the visitor to login.
@RestController
class SessionController {

	@GetMapping(SESSION_PATH)
	fun session(authentication: Authentication): Session = Session(authentication.name)
}
