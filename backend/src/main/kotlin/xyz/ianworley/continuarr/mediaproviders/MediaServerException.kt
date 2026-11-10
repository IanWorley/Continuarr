package xyz.ianworley.continuarr.mediaproviders

sealed class MediaServerException(message: String, cause: Throwable? = null) : RuntimeException(message, cause) {
	class Unreachable(message: String, cause: Throwable? = null) : MediaServerException(message, cause)

	class Unauthorized(message: String, cause: Throwable? = null) : MediaServerException(message, cause)

	class UnexpectedResponse(message: String, cause: Throwable? = null) : MediaServerException(message, cause)
}
