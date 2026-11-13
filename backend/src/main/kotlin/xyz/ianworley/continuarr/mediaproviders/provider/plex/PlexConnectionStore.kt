package xyz.ianworley.continuarr.mediaproviders.provider.plex

import xyz.ianworley.continuarr.mediaproviders.provider.secrets.EncryptionKeyProperties
import xyz.ianworley.continuarr.mediaproviders.provider.secrets.SecretCipher
import java.net.URI

private const val SINGLE_ROW_ID: Short = 1

enum class PlexSeedResult {
	SAVED,

	/** A connection linked through plex.tv is saved, and the seed never replaces it. */
	KEPT_PLEX_TV_LINK,

	/** CONTINUARR_ENCRYPTION_KEY isn't set, so the token can't be stored. */
	ENCRYPTION_KEY_MISSING,
}

class PlexConnectionStore(private val repository: PlexConnectionRepository, encryptionKey: EncryptionKeyProperties) {

	private val cipher: SecretCipher? = encryptionKey.secretKey?.let(::SecretCipher)

	fun find(): PlexConnectionRow? = repository.findById(SINGLE_ROW_ID)

	/** Null without CONTINUARR_ENCRYPTION_KEY, or when [row]'s token doesn't decrypt, as when it was saved under another key. */
	fun tokenOrNull(row: PlexConnectionRow): PlexToken? = cipher?.decrypt(row.tokenCiphertext)?.let(PlexToken::parseOrNull)

	fun seed(url: URI, token: PlexToken): PlexSeedResult {
		if (find()?.source == PlexConnectionSource.PLEX_TV) return PlexSeedResult.KEPT_PLEX_TV_LINK
		val ciphertext = cipher?.encrypt(token.plaintext()) ?: return PlexSeedResult.ENCRYPTION_KEY_MISSING
		repository.save(PlexConnectionRow(SINGLE_ROW_ID, url.toString(), ciphertext, PlexConnectionSource.ENVIRONMENT))
		return PlexSeedResult.SAVED
	}
}
