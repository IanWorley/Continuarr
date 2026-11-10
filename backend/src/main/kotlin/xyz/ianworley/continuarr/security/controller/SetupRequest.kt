package xyz.ianworley.continuarr.web

// Spring MVC logs the bound request body at DEBUG and TRACE, so toString must not print the token or password.
data class SetupRequest(val token: String, val username: String, val password: String) {
	override fun toString(): String = "SetupRequest(hidden)"
}
