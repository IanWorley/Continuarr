package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

sealed interface StoredConnection {
	data object NotConfigured : StoredConnection

	/** A row exists but can't be used; [reason] tells the admin what to fix and holds no secret. */
	class Unusable(val reason: String, val cause: Throwable? = null) : StoredConnection

	class Usable(val connection: JellyfinConnection) : StoredConnection
}
