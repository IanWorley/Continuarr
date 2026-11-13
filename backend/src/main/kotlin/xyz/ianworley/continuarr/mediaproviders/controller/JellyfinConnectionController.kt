package xyz.ianworley.continuarr.mediaproviders.controller

import io.swagger.v3.oas.annotations.media.Content
import io.swagger.v3.oas.annotations.media.Schema
import io.swagger.v3.oas.annotations.responses.ApiResponse
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.PutMapping
import org.springframework.web.bind.annotation.RestController
import tools.jackson.core.JacksonException
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.mediaproviders.service.JellyfinConnectionSettings
import xyz.ianworley.continuarr.mediaproviders.service.JellyfinSaveResult
import java.io.InputStream
import io.swagger.v3.oas.annotations.parameters.RequestBody as SwaggerRequestBody

const val JELLYFIN_CONNECTION_PATH = "/api/v1/jellyfin/connection"
const val JELLYFIN_API_KEY_MATCH_PATH = "$JELLYFIN_CONNECTION_PATH/api-key/match"

@RestController
class JellyfinConnectionController(private val settings: JellyfinConnectionSettings, private val jsonMapper: JsonMapper) {

	@GetMapping(JELLYFIN_CONNECTION_PATH)
	fun connection(): JellyfinConnectionResponse {
		val saved = settings.saved()
		return JellyfinConnectionResponse(saved.url, saved.apiKeyState)
	}

	@PutMapping(JELLYFIN_CONNECTION_PATH, consumes = [MediaType.APPLICATION_JSON_VALUE])
	@SwaggerRequestBody(
		required = true,
		content = [Content(mediaType = MediaType.APPLICATION_JSON_VALUE, schema = Schema(implementation = JellyfinConnectionRequest::class))],
	)
	// springdoc gives every listed response the ResponseEntity's body type unless it names its own content,
	// so the bodiless 204 and 503 name an empty one.
	@ApiResponse(responseCode = "204", description = "Saved; the next Jellyfin call uses it", content = [Content()])
	@ApiResponse(
		responseCode = "400",
		description = "Names the invalid fields without echoing their values",
		content = [Content(schema = Schema(implementation = JellyfinConnectionProblem::class))],
	)
	@ApiResponse(
		responseCode = "503",
		description = "CONTINUARR_ENCRYPTION_KEY isn't set, so the API key can't be stored",
		content = [Content()],
	)
	// Parses the body here instead of through @RequestBody. Jackson's parse error quotes the bad token, which
	// can be an unquoted API key, and Spring logs a failed argument at DEBUG wherever it's resolved.
	fun save(body: InputStream): ResponseEntity<JellyfinConnectionProblem> {
		val request = readOrNull(body, JellyfinConnectionRequest::class.java) ?: return ResponseEntity.badRequest().build()
		return when (val result = settings.save(request.url, request.apiKey)) {
			JellyfinSaveResult.Saved -> ResponseEntity.noContent().build()
			is JellyfinSaveResult.Invalid -> ResponseEntity.badRequest().body(JellyfinConnectionProblem(result.fields.sorted()))
			JellyfinSaveResult.EncryptionKeyMissing -> ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build()
		}
	}

	@PostMapping(JELLYFIN_API_KEY_MATCH_PATH, consumes = [MediaType.APPLICATION_JSON_VALUE])
	@SwaggerRequestBody(
		required = true,
		content = [Content(mediaType = MediaType.APPLICATION_JSON_VALUE, schema = Schema(implementation = JellyfinApiKeyMatchRequest::class))],
	)
	@ApiResponse(responseCode = "200", description = "How the key compares with the saved one; neither key is returned")
	@ApiResponse(
		responseCode = "400",
		description = "The body doesn't parse, or the API key isn't valid; the value isn't echoed",
		content = [Content()],
	)
	// Reads the body itself for the same reason as save.
	fun matchApiKey(body: InputStream): ResponseEntity<JellyfinApiKeyMatchResponse> {
		val request = readOrNull(body, JellyfinApiKeyMatchRequest::class.java) ?: return ResponseEntity.badRequest().build()
		val result = settings.matchApiKeyOrNull(request.apiKey) ?: return ResponseEntity.badRequest().build()
		return ResponseEntity.ok(JellyfinApiKeyMatchResponse(result))
	}

	/** Null when the body doesn't parse, or is the JSON literal `null`, which Jackson reads as null. */
	private fun <T> readOrNull(body: InputStream, type: Class<T>): T? = try {
		jsonMapper.readValue(body, type)
	} catch (_: JacksonException) {
		null
	}
}
