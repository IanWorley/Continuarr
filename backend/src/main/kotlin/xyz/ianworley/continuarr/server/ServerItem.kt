package xyz.ianworley.continuarr.server

import kotlin.time.Duration

sealed interface ServerItem {
	val id: ServerItemId
	val title: String
	val externalIds: ExternalIds
	val fileName: FileName?

	data class Movie(
		override val id: ServerItemId,
		override val title: String,
		override val externalIds: ExternalIds,
		override val fileName: FileName?,
		val year: Int?,
		val edition: String?,
		val runtime: Duration?,
	) : ServerItem

	data class Show(
		override val id: ServerItemId,
		override val title: String,
		override val externalIds: ExternalIds,
		override val fileName: FileName?,
		val year: Int?,
	) : ServerItem

	/** [season] and [episode] are null when the server hasn't identified the file. */
	data class Episode(
		override val id: ServerItemId,
		override val title: String,
		override val externalIds: ExternalIds,
		override val fileName: FileName?,
		val showId: ServerItemId,
		val season: Int?,
		val episode: Int?,
		/** Last episode in a multi-episode file, or null for a single episode. */
		val episodeEnd: Int?,
		val runtime: Duration?,
	) : ServerItem
}
