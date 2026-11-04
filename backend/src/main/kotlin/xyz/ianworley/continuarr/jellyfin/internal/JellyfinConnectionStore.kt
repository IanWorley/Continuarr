package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.dao.DataAccessException
import org.springframework.jdbc.core.simple.JdbcClient
import xyz.ianworley.continuarr.jellyfin.JellyfinSaveResult
import java.net.URI

private const val SINGLE_ROW_ID = 1

private const val UNREADABLE_REASON =
	"The saved Jellyfin API key doesn't decrypt; set CONTINUARR_ENCRYPTION_KEY to the key it was saved with, " +
		"or save the connection again"
private const val DATABASE_FAILURE_REASON = "Can't read the saved Jellyfin connection from the database"

/** The `jellyfin_connection` row as stored, before the key is decrypted. */
class JellyfinConnectionRow(val url: String, val apiKeyCiphertext: ByteArray)

/** Reads and writes `jellyfin_connection`'s single row, encrypting the key with CONTINUARR_ENCRYPTION_KEY. */
class JellyfinConnectionStore(private val jdbcClient: JdbcClient, encryptionKey: EncryptionKeyProperties) {

	private val cipher: ApiKeyCipher? = encryptionKey.secretKey?.let(::ApiKeyCipher)

	/** Replaces the single row in one upsert, so racing saves can't leave two rows or a mix of both. */
	fun save(url: URI, apiKey: JellyfinApiKey): JellyfinSaveResult {
		val cipher = cipher ?: return JellyfinSaveResult.EncryptionKeyMissing
		jdbcClient
			.sql(
				"""
				INSERT INTO jellyfin_connection (id, url, api_key_ciphertext) VALUES (:id, :url, :ciphertext)
				ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, api_key_ciphertext = EXCLUDED.api_key_ciphertext, updated_at = now()
				""",
			)
			.param("id", SINGLE_ROW_ID)
			.param("url", url.toString())
			.param("ciphertext", cipher.encrypt(apiKey))
			.update()
		return JellyfinSaveResult.Saved
	}

	fun find(): JellyfinConnectionRow? = jdbcClient
		.sql("SELECT url, api_key_ciphertext FROM jellyfin_connection")
		.query { rs, _ -> JellyfinConnectionRow(rs.getString("url"), rs.getBytes("api_key_ciphertext")) }
		.optional()
		.orElse(null)

	/** Never throws, so the adapter keeps to MediaServer's rule of throwing only MediaServerException. */
	fun load(): StoredConnection {
		val row = try {
			find()
		} catch (e: DataAccessException) {
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
