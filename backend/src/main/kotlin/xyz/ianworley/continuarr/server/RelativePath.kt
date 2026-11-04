package xyz.ianworley.continuarr.server

private const val SEPARATOR = '/'
private const val WINDOWS_SEPARATOR = '\\'

/**
 * A file path with its library root stripped: non-empty, `/`-separated, with no leading `/`.
 * Dot segments are kept as the server reported them.
 */
@JvmInline
value class RelativePath private constructor(val value: String) {
	// Repeats the factory's guarantees because Jackson calls the private constructor directly.
	init {
		require(value.isNotEmpty() && !value.startsWith(SEPARATOR) && WINDOWS_SEPARATOR !in value) {
			"Not a relative path: $value"
		}
	}

	companion object {
		/**
		 * Strips the longest root that contains [absolutePath], comparing case-sensitively.
		 * Returns null when no root matches or when the path is a root itself.
		 */
		fun relativizeOrNull(absolutePath: String, roots: List<String>): RelativePath? {
			val path = absolutePath.withForwardSlashes()
			val root = roots
				.filter { it.isNotBlank() }
				.map { it.withForwardSlashes().trimEnd(SEPARATOR) }
				.filter { path == it || path.startsWith(it + SEPARATOR) }
				.maxByOrNull { it.length }
				?: return null
			val remainder = path.substring(root.length).trimStart(SEPARATOR)
			return if (remainder.isEmpty()) null else RelativePath(remainder)
		}
	}
}

private fun String.withForwardSlashes(): String = replace(WINDOWS_SEPARATOR, SEPARATOR)
