package xyz.ianworley.continuarr.mediaproviders.service

import org.springframework.stereotype.Service
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionSource
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionStore

/** Whether the saved Plex token decrypts under the current CONTINUARR_ENCRYPTION_KEY. The token itself is never reported. */
enum class PlexTokenState {
	NONE,
	STORED,
	UNREADABLE,
}

/** [url] and [source] are null exactly when [tokenState] is [PlexTokenState.NONE], since every save stores all three. */
data class SavedPlexConnection(val url: String?, val source: PlexConnectionSource?, val tokenState: PlexTokenState)

/** The admin's Plex connection. The token never leaves this module in plaintext. */
@Service
class PlexConnectionSettings(private val store: PlexConnectionStore) {

	/** The URL and source come back even when the token won't decrypt, so the admin sees what to link again. */
	fun saved(): SavedPlexConnection {
		val row = store.find() ?: return SavedPlexConnection(null, null, PlexTokenState.NONE)
		val tokenState = if (store.tokenOrNull(row) != null) PlexTokenState.STORED else PlexTokenState.UNREADABLE
		return SavedPlexConnection(row.url, row.source, tokenState)
	}
}
