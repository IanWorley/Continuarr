package xyz.ianworley.continuarr.mediaproviders.service

import org.springframework.stereotype.Service
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionSource
import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionStore

enum class PlexTokenState {
	NONE,
	STORED,
}

data class SavedPlexConnection(val url: String?, val source: PlexConnectionSource?, val tokenState: PlexTokenState)

/** The admin's Plex connection. The token never leaves this module in plaintext. */
@Service
class PlexConnectionSettings(private val store: PlexConnectionStore) {

	fun saved(): SavedPlexConnection {
		val row = store.find() ?: return SavedPlexConnection(null, null, PlexTokenState.NONE)
		val tokenState = if (store.tokenOrNull(row) != null) PlexTokenState.STORED else PlexTokenState.NONE
		return SavedPlexConnection(row.url, row.source, tokenState)
	}

	/** Forgets the URL and token. A seeded connection comes back on the next start while its env vars are set. */
	fun unlink() {
		store.delete()
	}
}
