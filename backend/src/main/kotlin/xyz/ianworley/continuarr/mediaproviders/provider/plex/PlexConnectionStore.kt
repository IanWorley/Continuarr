package xyz.ianworley.continuarr.mediaproviders.provider.plex

import java.net.URI

private const val SINGLE_ROW_ID: Short = 1

enum class PlexSeedResult {
	SAVED,

	/** A connection linked through plex.tv is saved, and the seed never replaces it. */
	KEPT_PLEX_TV_LINK,
}

class PlexConnectionStore(private val repository: PlexConnectionRepository) {

	fun find(): PlexConnectionRow? = repository.findById(SINGLE_ROW_ID)

	fun delete() {
		repository.deleteRow(SINGLE_ROW_ID)
	}

	fun tokenOrNull(row: PlexConnectionRow): PlexToken? = row.token?.let(PlexToken::parseOrNull)

	fun seed(url: URI, token: PlexToken): PlexSeedResult {
		if (find()?.source == PlexConnectionSource.PLEX_TV) return PlexSeedResult.KEPT_PLEX_TV_LINK
		repository.save(PlexConnectionRow(SINGLE_ROW_ID, url.toString(), token.plaintext(), PlexConnectionSource.ENVIRONMENT))
		return PlexSeedResult.SAVED
	}
}
