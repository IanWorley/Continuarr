package xyz.ianworley.continuarr.mediaproviders

/**
 * Read-only access to one media server. Every call can throw [MediaServerException].
 * The sequences fetch pages lazily, so they can also throw while being iterated.
 */
interface MediaServer {
	val kind: ServerKind

	fun accounts(): List<ServerAccount>

	fun libraries(): List<ServerLibrary>

	fun items(library: ServerLibraryId): Sequence<ServerItem>

	fun userStates(account: ServerAccountId, library: ServerLibraryId): Sequence<UserItemState>

	fun activeSessions(): List<ActiveSession>
}

enum class ServerKind {
	PLEX,
	JELLYFIN,
}
