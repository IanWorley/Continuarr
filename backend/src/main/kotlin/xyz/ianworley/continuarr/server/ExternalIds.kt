package xyz.ianworley.continuarr.server

private val IMDB_ID_PATTERN = Regex("tt[0-9]+")
private val NUMERIC_ID_PATTERN = Regex("[0-9]+")

// Each init block repeats its factory's check because Jackson calls the private constructor directly.

@JvmInline
value class ImdbId private constructor(val value: String) {
	init {
		require(IMDB_ID_PATTERN.matches(value)) { "Malformed IMDb ID: $value" }
	}

	companion object {
		/** Returns null unless [raw] is exactly `tt` plus digits. Does not trim. */
		fun parseOrNull(raw: String): ImdbId? = if (IMDB_ID_PATTERN.matches(raw)) ImdbId(raw) else null
	}
}

@JvmInline
value class TvdbId private constructor(val value: String) {
	init {
		require(NUMERIC_ID_PATTERN.matches(value)) { "Malformed TVDb ID: $value" }
	}

	companion object {
		/** Returns null unless [raw] is only digits. Does not trim. */
		fun parseOrNull(raw: String): TvdbId? = if (NUMERIC_ID_PATTERN.matches(raw)) TvdbId(raw) else null
	}
}

@JvmInline
value class TmdbId private constructor(val value: String) {
	init {
		require(NUMERIC_ID_PATTERN.matches(value)) { "Malformed TMDb ID: $value" }
	}

	companion object {
		/** Returns null unless [raw] is only digits. Does not trim. */
		fun parseOrNull(raw: String): TmdbId? = if (NUMERIC_ID_PATTERN.matches(raw)) TmdbId(raw) else null
	}
}

data class ExternalIds(
	val imdb: ImdbId? = null,
	val tvdb: TvdbId? = null,
	val tmdb: TmdbId? = null,
)
