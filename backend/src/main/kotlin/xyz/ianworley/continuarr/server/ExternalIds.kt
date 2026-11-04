package xyz.ianworley.continuarr.server

private val IMDB_ID_PATTERN = Regex("tt[0-9]+")
private val NUMERIC_ID_PATTERN = Regex("[0-9]+")

@JvmInline
value class ImdbId private constructor(val value: String) {
	companion object {
		/** Returns null unless [raw] is exactly `tt` plus digits. Does not trim. */
		fun parseOrNull(raw: String): ImdbId? = if (IMDB_ID_PATTERN.matches(raw)) ImdbId(raw) else null
	}
}

@JvmInline
value class TvdbId private constructor(val value: String) {
	companion object {
		/** Returns null unless [raw] is only digits. Does not trim. */
		fun parseOrNull(raw: String): TvdbId? = if (NUMERIC_ID_PATTERN.matches(raw)) TvdbId(raw) else null
	}
}

@JvmInline
value class TmdbId private constructor(val value: String) {
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
