package xyz.ianworley.continuarr.server

data class ServerLibrary(
	val id: ServerLibraryId,
	val name: String,
	val kind: LibraryKind,
)

enum class LibraryKind {
	MOVIES,
	SHOWS,
}
