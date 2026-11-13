package xyz.ianworley.continuarr.mediaproviders.controller

import org.springframework.web.bind.annotation.GetMapping
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
}
