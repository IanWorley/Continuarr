package xyz.ianworley.continuarr.mediaproviders.service

import org.springframework.stereotype.Service
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionSource
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionStore

/** Whether a Plex token is saved. The token itself is never reported. */
enum class PlexTokenState {
	NONE,
	STORED,
}

/** [url] and [source] are null until a connection is saved, though a saved one can come with [PlexTokenState.NONE]. */
data class SavedPlexConnection(val url: String?, val source: PlexConnectionSource?, val tokenState: PlexTokenState)

/** The admin's Plex connection. The token never leaves this module in plaintext. */
@Service
class PlexConnectionSettings(private val store: PlexConnectionStore) {

	/** The URL and source come back even when no token is saved, so the admin sees what to link again. */
	fun saved(): SavedPlexConnection {
		val row = store.find() ?: return SavedPlexConnection(null, null, PlexTokenState.NONE)
		val tokenState = if (store.tokenOrNull(row) != null) PlexTokenState.STORED else PlexTokenState.NONE
		return SavedPlexConnection(row.url, row.source, tokenState)
	}
}
