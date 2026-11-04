package xyz.ianworley.continuarr.server

private const val SEPARATOR = '/'
private const val WINDOWS_SEPARATOR = '\\'

/** A non-empty, `/`-separated path below a library root, with no leading `/`. */
@JvmInline
value class RelativePath private constructor(val value: String) {
	companion object {
		/**
		 * Strips the longest root that contains [absolutePath], comparing case-sensitively.
		 * Returns null when no root matches or when the path is a root itself.
		 * The adapter logs the miss with the item ID.
		 */
		fun relativizeOrNull(absolutePath: String, roots: List<String>): RelativePath? {
			val path = absolutePath.replace(WINDOWS_SEPARATOR, SEPARATOR)
			// A blank root would strip to the empty prefix and match every path.
			val root = roots
				.filterNot { it.isBlank() }
				.map { it.replace(WINDOWS_SEPARATOR, SEPARATOR).trimEnd(SEPARATOR) }
				.filter { path.startsWith(it + SEPARATOR) }
				.maxByOrNull { it.length }
				?: return null
			val remainder = path.substring(root.length).trimStart(SEPARATOR)
			return if (remainder.isEmpty()) null else RelativePath(remainder)
		}
	}
}
