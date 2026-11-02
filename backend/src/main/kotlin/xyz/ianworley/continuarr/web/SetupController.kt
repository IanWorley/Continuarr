package xyz.ianworley.continuarr.web

import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

const val SETUP_PATH = "/api/setup"

private const val MIN_PASSWORD_LENGTH = 8

// bcrypt ignores everything past 72 bytes, so Spring Security refuses longer passwords.
private const val MAX_PASSWORD_BYTES = 72

data class SetupRequest(val token: String, val username: String, val password: String)

// First-run setup: creates the single admin, once, for whoever holds the logged setup token.
@RestController
class SetupController(
	private val users: UserRepository,
	private val setupToken: SetupToken,
	private val passwordEncoder: PasswordEncoder,
) {

	@PostMapping(SETUP_PATH)
	fun setUp(@RequestBody request: SetupRequest): ResponseEntity<Void> {
		if (users.count() > 0) return status(HttpStatus.CONFLICT)
		if (!setupToken.matches(request.token)) return status(HttpStatus.FORBIDDEN)

		val username = request.username.trim()
		val passwordBytes = request.password.toByteArray().size
		if (username.isEmpty() || request.password.length < MIN_PASSWORD_LENGTH || passwordBytes > MAX_PASSWORD_BYTES) {
			return status(HttpStatus.BAD_REQUEST)
		}

		return try {
			users.save(User(username, passwordEncoder.encode(request.password)!!))
			status(HttpStatus.NO_CONTENT)
		} catch (_: DataIntegrityViolationException) {
			// Another setup request won the race to app_user's single row.
			status(HttpStatus.CONFLICT)
		}
	}

	private fun status(status: HttpStatus): ResponseEntity<Void> = ResponseEntity.status(status).build()
}
