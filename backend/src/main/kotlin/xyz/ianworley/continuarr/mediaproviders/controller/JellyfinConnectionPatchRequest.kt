package xyz.ianworley.continuarr.mediaproviders.controller

/** Every field is optional. A missing or null field keeps what is saved, and a blank [name] clears it. */
class JellyfinConnectionPatchRequest(val name: String? = null, val url: String? = null, val apiKey: String? = null) {
	override fun toString(): String = "JellyfinConnectionPatchRequest(hidden)"
}
