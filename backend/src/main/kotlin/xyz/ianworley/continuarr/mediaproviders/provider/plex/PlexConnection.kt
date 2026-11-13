package xyz.ianworley.continuarr.mediaproviders.provider.plex

// Plex reads the token from the X-Plex-Token header, so it must be visible ASCII.
private val TOKEN_CHARACTERS = '!'..'~'

enum class PlexConnectionSource {
	/** Seeded at startup from CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN, for local development. */
	ENVIRONMENT,

	/** Linked by the admin signing in through plex.tv. A startup seed never overwrites it. */
	PLEX_TV,
}

/** Keeps the token out of logs: [toString] hides it, and only [plaintext] reads it. */
class PlexToken private constructor(private val value: String) {

	/** For the store to save. */
	fun plaintext(): String = value

	override fun toString(): String = "PlexToken(hidden)"

	companion object {
		/** Returns null unless [raw] is non-empty visible ASCII. Does not trim. */
		fun parseOrNull(raw: String): PlexToken? = if (raw.isNotEmpty() && raw.all { it in TOKEN_CHARACTERS }) PlexToken(raw) else null
	}
}
