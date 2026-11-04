package xyz.ianworley.continuarr.jellyfin.internal

/** The saved Jellyfin connection as the adapter finds it on each call. */
sealed interface StoredConnection {
	data object NotConfigured : StoredConnection

	/** A row exists but can't be used; [reason] tells the admin what to fix and holds no secret. */
	class Unusable(val reason: String, val cause: Throwable? = null) : StoredConnection

	class Usable(val connection: JellyfinConnection) : StoredConnection
}
