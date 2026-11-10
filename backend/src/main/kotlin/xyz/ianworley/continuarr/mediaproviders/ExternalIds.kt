package xyz.ianworley.continuarr.mediaproviders

private val IMDB_ID_PATTERN = Regex("tt[0-9]+")
private val NUMERIC_ID_PATTERN = Regex("[0-9]+")
private val CANONICAL_NUMERIC_ID_PATTERN = Regex("[1-9][0-9]*")
private const val LEADING_ZERO = '0'

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
		require(CANONICAL_NUMERIC_ID_PATTERN.matches(value)) { "Malformed TVDb ID: $value" }
	}

	companion object {
		/** Returns null unless [raw] is only digits and not all zeros. Strips leading zeros. Does not trim. */
		fun parseOrNull(raw: String): TvdbId? = canonicalNumericIdOrNull(raw)?.let(::TvdbId)
	}
}

@JvmInline
value class TmdbId private constructor(val value: String) {
	init {
		require(CANONICAL_NUMERIC_ID_PATTERN.matches(value)) { "Malformed TMDb ID: $value" }
	}

	companion object {
		/** Returns null unless [raw] is only digits and not all zeros. Strips leading zeros. Does not trim. */
		fun parseOrNull(raw: String): TmdbId? = canonicalNumericIdOrNull(raw)?.let(::TmdbId)
	}
}

// Without stripping, "007" and "7" would be two different IDs for the same title.
private fun canonicalNumericIdOrNull(raw: String): String? =
	raw.takeIf { NUMERIC_ID_PATTERN.matches(it) }?.trimStart(LEADING_ZERO)?.takeIf { it.isNotEmpty() }

data class ExternalIds(
	val imdb: ImdbId? = null,
	val tvdb: TvdbId? = null,
	val tmdb: TmdbId? = null,
)
