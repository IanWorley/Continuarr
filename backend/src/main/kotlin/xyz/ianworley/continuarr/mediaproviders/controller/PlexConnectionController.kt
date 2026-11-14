package xyz.ianworley.continuarr.mediaproviders.controller

import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.responses.ApiResponse
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.ResponseStatus
import org.springframework.web.bind.annotation.RestController
import xyz.ianworley.continuarr.mediaproviders.service.PlexConnectionSettings

const val PLEX_CONNECTION_PATH = "/api/v1/plex/connection"

@RestController
class PlexConnectionController(private val settings: PlexConnectionSettings) {

	@GetMapping(PLEX_CONNECTION_PATH)
	fun plexConnection(): PlexConnectionResponse {
		val saved = settings.saved()
		return PlexConnectionResponse(saved.url, saved.source, saved.tokenState)
	}

	@DeleteMapping(PLEX_CONNECTION_PATH)
	@ResponseStatus(HttpStatus.NO_CONTENT)
	@ApiResponse(responseCode = "204", description = "Unlinked, or nothing was saved", content = [Content()])
	fun unlink() {
		settings.unlink()
	}
}
