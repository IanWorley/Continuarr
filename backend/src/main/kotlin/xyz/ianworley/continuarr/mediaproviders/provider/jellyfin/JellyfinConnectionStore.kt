package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import org.springframework.dao.DataAccessException
import org.springframework.transaction.TransactionException
import java.net.URI

private const val SINGLE_ROW_ID: Short = 1

private const val UNREADABLE_REASON =
	"The saved Jellyfin API key doesn't decrypt; set CONTINUARR_ENCRYPTION_KEY to the key it was saved with, " +
		"or save the connection again"
private const val DATABASE_FAILURE_REASON = "Can't read the saved Jellyfin connection from the database"

class JellyfinConnectionStore(private val repository: JellyfinConnectionRepository, encryptionKey: EncryptionKeyProperties) {

	private val cipher: ApiKeyCipher? = encryptionKey.secretKey?.let(::ApiKeyCipher)

	/**
	 * Returns false and saves nothing when CONTINUARR_ENCRYPTION_KEY isn't set.
	 * Two first saves at once both insert, and one fails on the primary key. One admin saves this, so that's accepted.
	 */
	fun save(url: URI, apiKey: JellyfinApiKey): Boolean {
		val cipher = cipher ?: return false
		repository.save(JellyfinConnectionRow(SINGLE_ROW_ID, url.toString(), cipher.encrypt(apiKey)))
		return true
	}

	fun find(): JellyfinConnectionRow? = repository.findById(SINGLE_ROW_ID)

	/** Never throws, so the adapter keeps to MediaServer's rule of throwing only MediaServerException. */
	fun load(): StoredConnection {
		val row = try {
			find()
		} catch (e: DataAccessException) {
			return StoredConnection.Unusable(DATABASE_FAILURE_REASON, e)
		} catch (e: TransactionException) {
			// An unreachable database fails when the repository opens its transaction, before any query runs.
			return StoredConnection.Unusable(DATABASE_FAILURE_REASON, e)
		} ?: return StoredConnection.NotConfigured
		val baseUrl = parseBaseUrlOrNull(row.url)
		val apiKey = cipher?.decrypt(row.apiKeyCiphertext)?.let(JellyfinApiKey::parseOrNull)
		return if (baseUrl == null || apiKey == null) {
			StoredConnection.Unusable(UNREADABLE_REASON)
		} else {
			StoredConnection.Usable(JellyfinConnection(baseUrl, apiKey))
		}
	}
}
