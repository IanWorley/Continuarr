package xyz.ianworley.continuarr.mediaproviders

private const val SEPARATOR = '/'
private const val WINDOWS_SEPARATOR = '\\'
private val SEPARATORS = charArrayOf(SEPARATOR, WINDOWS_SEPARATOR)

/** The last segment of a server-reported path: the file for a movie or episode, the folder for a show. */
@JvmInline
value class FileName private constructor(val value: String) {
	// Repeats the factory's guarantees because Jackson calls the private constructor directly.
	init {
		require(value.isNotBlank() && value.none { it in SEPARATORS }) { "Not a file name: $value" }
	}

	companion object {
		/**
		 * Takes the last segment after `/` or `\`, ignoring trailing separators, so drive letters and
		 * mount roots never matter. Returns null when no segment is left. Case-sensitive.
		 */
		fun fromPathOrNull(path: String): FileName? =
			path.trimEnd(*SEPARATORS).split(*SEPARATORS).last().takeIf { it.isNotBlank() }?.let(::FileName)
	}
}
