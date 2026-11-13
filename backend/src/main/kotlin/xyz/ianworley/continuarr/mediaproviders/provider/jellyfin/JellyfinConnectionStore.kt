package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import org.springframework.dao.DataAccessException
import org.springframework.transaction.TransactionException
import java.net.URI

private const val SINGLE_ROW_ID: Short = 1

private const val NO_API_KEY_REASON = "No Jellyfin API key is saved; save the connection again with its key"
private const val DATABASE_FAILURE_REASON = "Can't read the saved Jellyfin connection from the database"

class JellyfinConnectionStore(private val repository: JellyfinConnectionRepository) {

	/** Two first saves at once both insert, and one fails on the primary key. One admin saves this, so that's accepted. */
	fun save(url: URI, apiKey: JellyfinApiKey) {
		repository.save(JellyfinConnectionRow(SINGLE_ROW_ID, url.toString(), apiKey.plaintext()))
	}

	fun find(): JellyfinConnectionRow? = repository.findById(SINGLE_ROW_ID)

	/** Null when [row] holds no key, as after 0005-plaintext-secrets cleared an encrypted one. */
	fun apiKeyOrNull(row: JellyfinConnectionRow): JellyfinApiKey? = row.apiKey?.let(JellyfinApiKey::parseOrNull)

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
		val apiKey = apiKeyOrNull(row)
		return if (baseUrl == null || apiKey == null) {
			StoredConnection.Unusable(NO_API_KEY_REASON)
		} else {
			StoredConnection.Usable(JellyfinConnection(baseUrl, apiKey))
		}
	}
}
