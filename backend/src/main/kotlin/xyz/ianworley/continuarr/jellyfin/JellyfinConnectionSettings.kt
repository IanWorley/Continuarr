package xyz.ianworley.continuarr.jellyfin

import org.springframework.stereotype.Service
import xyz.ianworley.continuarr.jellyfin.internal.JellyfinApiKey
import xyz.ianworley.continuarr.jellyfin.internal.JellyfinConnectionStore
import xyz.ianworley.continuarr.jellyfin.internal.parseBaseUrlOrNull

/** A field of a Jellyfin connection that failed validation. The value itself is never reported. */
enum class JellyfinField {
	URL,
	API_KEY,
}

sealed interface JellyfinSaveResult {
	data object Saved : JellyfinSaveResult

	/** Lists every invalid field at once. */
	data class Invalid(val fields: Set<JellyfinField>) : JellyfinSaveResult

	/** CONTINUARR_ENCRYPTION_KEY isn't set, so the API key can't be stored. */
	data object EncryptionKeyMissing : JellyfinSaveResult
}

/**
 * The admin's Jellyfin connection. The adapter reads the saved row on every call, so a save takes effect on
 * the next call without a restart. The API key never leaves this module in plaintext.
 */
@Service
class JellyfinConnectionSettings(private val store: JellyfinConnectionStore) {

	/** The saved server URL, or null before a save. Doesn't decrypt, so it answers even when the key won't. */
	fun savedUrl(): String? = store.find()?.url

	/** Replaces the whole connection. The key is required on every save, so a new URL never gets the old key. */
	fun save(url: String, apiKey: String): JellyfinSaveResult {
		val baseUrl = parseBaseUrlOrNull(url)
		val key = JellyfinApiKey.parseOrNull(apiKey)
		if (baseUrl == null || key == null) {
			return JellyfinSaveResult.Invalid(
				setOfNotNull(JellyfinField.URL.takeIf { baseUrl == null }, JellyfinField.API_KEY.takeIf { key == null }),
			)
		}
		return store.save(baseUrl, key)
	}
}
