package xyz.ianworley.continuarr.mediaproviders.controller

/** Every field is optional. A missing or null field keeps what is saved. */
class JellyfinConnectionPatchRequest(val url: String? = null, val apiKey: String? = null) {
	override fun toString(): String = "JellyfinConnectionPatchRequest(hidden)"
}
