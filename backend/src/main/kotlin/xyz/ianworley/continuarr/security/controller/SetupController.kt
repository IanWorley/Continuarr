package xyz.ianworley.continuarr.security.controller

import io.swagger.v3.oas.annotations.responses.ApiResponse
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import xyz.ianworley.continuarr.security.service.SetupResult
import xyz.ianworley.continuarr.security.service.SetupService

const val SETUP_PATH = "/api/setup"

// Anyone may ask whether setup is still needed, so the SPA can choose between setup and login.
@RestController
class SetupController(private val setup: SetupService) {

	@GetMapping(SETUP_PATH)
	fun setupStatus(): SetupStatus = SetupStatus(required = setup.setupRequired())

	@PostMapping(SETUP_PATH)
	// Answers with bare status codes, which springdoc can't infer from ResponseEntity<Void>.
	@ApiResponse(responseCode = "204", description = "Admin created")
	@ApiResponse(responseCode = "400", description = "Blank username or password length out of range")
	@ApiResponse(responseCode = "403", description = "Wrong setup token")
	@ApiResponse(responseCode = "409", description = "An admin already exists")
	fun setUp(@RequestBody request: SetupRequest): ResponseEntity<Void> {
		val status = when (setup.createAdmin(request.token, request.username, request.password)) {
			SetupResult.Created -> HttpStatus.NO_CONTENT
			SetupResult.Invalid -> HttpStatus.BAD_REQUEST
			SetupResult.WrongToken -> HttpStatus.FORBIDDEN
			SetupResult.AlreadySetUp -> HttpStatus.CONFLICT
		}
		return ResponseEntity.status(status).build()
	}
}
