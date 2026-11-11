package xyz.ianworley.continuarr.mediaproviders.service

import org.springframework.stereotype.Service
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinApiKey
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinConnectionStore
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.parseBaseUrlOrNull

/** A field of a Jellyfin connection that failed validation. The value itself is never reported. */
enum class JellyfinField {
	URL,
	API_KEY,
}

/** Whether the saved API key decrypts under the current CONTINUARR_ENCRYPTION_KEY. The key itself is never reported. */
enum class JellyfinApiKeyState {
	NONE,
	STORED,
	UNREADABLE,
}

/** [url] is null exactly when [apiKeyState] is [JellyfinApiKeyState.NONE], since every save stores both. */
data class SavedJellyfinConnection(val url: String?, val apiKeyState: JellyfinApiKeyState)

sealed interface JellyfinSaveResult {
	data object Saved : JellyfinSaveResult

	data class Invalid(val fields: Set<JellyfinField>) : JellyfinSaveResult

	data object EncryptionKeyMissing : JellyfinSaveResult
}

/**
 * The admin's Jellyfin connection. The adapter reads the saved row on every call, so a save takes effect on
 * the next call without a restart. The API key never leaves this module in plaintext.
 */
@Service
class JellyfinConnectionSettings(private val store: JellyfinConnectionStore) {

	/** The URL comes back even when the key won't decrypt, so the admin sees what to save again. */
	fun saved(): SavedJellyfinConnection {
		val row = store.find() ?: return SavedJellyfinConnection(null, JellyfinApiKeyState.NONE)
		val apiKeyState = if (store.apiKeyDecrypts(row)) JellyfinApiKeyState.STORED else JellyfinApiKeyState.UNREADABLE
		return SavedJellyfinConnection(row.url, apiKeyState)
	}

	/** Replaces the whole connection. The key is required on every save, so a new URL never gets the old key. */
	fun save(url: String, apiKey: String): JellyfinSaveResult {
		val baseUrl = parseBaseUrlOrNull(url)
		val key = JellyfinApiKey.parseOrNull(apiKey)
		if (baseUrl == null || key == null) {
			return JellyfinSaveResult.Invalid(
				setOfNotNull(JellyfinField.URL.takeIf { baseUrl == null }, JellyfinField.API_KEY.takeIf { key == null }),
			)
		}
		return if (store.save(baseUrl, key)) JellyfinSaveResult.Saved else JellyfinSaveResult.EncryptionKeyMissing
	}
}
