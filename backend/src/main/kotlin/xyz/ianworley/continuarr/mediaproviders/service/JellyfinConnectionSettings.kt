package xyz.ianworley.continuarr.mediaproviders.service

import org.springframework.stereotype.Service
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.ApiKeyChange
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinApiKey
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinConnectionStore
import xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.parseBaseUrlOrNull
import java.net.URI

private const val HTTPS = "https"

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

/** How a submitted API key compares with the saved one. Neither key is ever reported. */
enum class JellyfinApiKeyMatch {
	MATCH,
	MISMATCH,
	NONE,
	UNREADABLE,
}

/** [url] is null exactly when [apiKeyState] is [JellyfinApiKeyState.NONE], since the first save stores both. */
data class SavedJellyfinConnection(val url: String?, val apiKeyState: JellyfinApiKeyState)

/** The fields a patch sends. A null field keeps what is saved. */
class JellyfinConnectionPatch(val url: String?, val apiKey: String?) {
	override fun toString(): String = "JellyfinConnectionPatch(hidden)"
}

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
		val apiKeyState = if (store.apiKeyOrNull(row) != null) JellyfinApiKeyState.STORED else JellyfinApiKeyState.UNREADABLE
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
		return saved(store.save(baseUrl, ApiKeyChange.Replace(key)))
	}

	/**
	 * Changes only the fields [patch] sends, so a new URL keeps the saved key. The first save needs a
	 * URL and a key. Moving the URL from https to http needs a new key, so the saved one never travels unencrypted.
	 */
	fun patch(patch: JellyfinConnectionPatch): JellyfinSaveResult {
		val current = store.find()
		val url = if (patch.url != null) parseBaseUrlOrNull(patch.url) else current?.let { parseBaseUrlOrNull(it.url) }
		val apiKey = when {
			patch.apiKey != null -> JellyfinApiKey.parseOrNull(patch.apiKey)?.let(ApiKeyChange::Replace)
			current == null || downgradesToHttp(current.url, url) -> null
			else -> ApiKeyChange.Keep(current)
		}
		if (url == null || apiKey == null) {
			return JellyfinSaveResult.Invalid(
				setOfNotNull(JellyfinField.URL.takeIf { url == null }, JellyfinField.API_KEY.takeIf { apiKey == null }),
			)
		}
		return saved(store.save(url, apiKey))
	}

	/** Null when [apiKey] isn't a valid key, which can't match a saved one, since every save checks the key. */
	fun matchApiKeyOrNull(apiKey: String): JellyfinApiKeyMatch? {
		val candidate = JellyfinApiKey.parseOrNull(apiKey) ?: return null
		val row = store.find() ?: return JellyfinApiKeyMatch.NONE
		val saved = store.apiKeyOrNull(row) ?: return JellyfinApiKeyMatch.UNREADABLE
		return if (saved.matches(candidate)) JellyfinApiKeyMatch.MATCH else JellyfinApiKeyMatch.MISMATCH
	}

	private fun saved(stored: Boolean): JellyfinSaveResult =
		if (stored) JellyfinSaveResult.Saved else JellyfinSaveResult.EncryptionKeyMissing
}

private fun downgradesToHttp(currentUrl: String, newUrl: URI?): Boolean =
	newUrl != null && currentUrl.startsWith("$HTTPS:", ignoreCase = true) && !newUrl.scheme.equals(HTTPS, ignoreCase = true)

