package xyz.ianworley.continuarr.web

import io.swagger.v3.oas.annotations.responses.ApiResponse
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController

const val SETUP_PATH = "/api/setup"

private const val MIN_PASSWORD_LENGTH = 8

// bcrypt ignores everything past 72 bytes, so Spring Security refuses longer passwords.
private const val MAX_PASSWORD_BYTES = 72

// First-run setup: creates the single admin, once, for whoever holds the logged setup token.
// Anyone may ask whether setup is still needed, so the SPA can choose between setup and login.
@RestController
class SetupController(
	private val users: UserRepository,
	private val setupToken: SetupToken,
	private val passwordEncoder: PasswordEncoder,
) {

	@GetMapping(SETUP_PATH)
	fun setupStatus(): SetupStatus = SetupStatus(required = !adminExists())

	@PostMapping(SETUP_PATH)
	// Answers with bare status codes, which springdoc can't infer from ResponseEntity<Void>.
	@ApiResponse(responseCode = "204", description = "Admin created")
	@ApiResponse(responseCode = "400", description = "Blank username or password length out of range")
	@ApiResponse(responseCode = "403", description = "Wrong setup token")
	@ApiResponse(responseCode = "409", description = "An admin already exists")
	fun setUp(@RequestBody request: SetupRequest): ResponseEntity<Void> {
		if (adminExists()) return status(HttpStatus.CONFLICT)
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

	private fun adminExists(): Boolean = users.count() > 0

	private fun status(status: HttpStatus): ResponseEntity<Void> = ResponseEntity.status(status).build()
}
