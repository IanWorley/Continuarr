package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import com.fasterxml.jackson.annotation.JsonProperty
import com.fasterxml.jackson.annotation.JsonSetter
import com.fasterxml.jackson.annotation.Nulls
import org.slf4j.LoggerFactory
import xyz.ianworley.continuarr.mediaproviders.ExternalIds
import xyz.ianworley.continuarr.mediaproviders.FileName
import xyz.ianworley.continuarr.mediaproviders.ImdbId
import xyz.ianworley.continuarr.mediaproviders.ServerItem
import xyz.ianworley.continuarr.mediaproviders.ServerItemId
import xyz.ianworley.continuarr.mediaproviders.ServerLibraryId
import xyz.ianworley.continuarr.mediaproviders.TmdbId
import xyz.ianworley.continuarr.mediaproviders.TvdbId
import java.util.Locale
import kotlin.time.Duration
import kotlin.time.Duration.Companion.nanoseconds

private const val ITEMS_PATH = "/Items"
private const val NANOS_PER_TICK = 100L
private const val EPISODE_TYPE = "Episode"

// A missing episode is one Jellyfin knows from metadata but has no file for.
private const val VIRTUAL_LOCATION_TYPE = "Virtual"

// Jellyfin 12 has no sort by item ID and ignores `SortBy=Id`. DateCreated goes first because a title edit moves
// SortName but not DateCreated, and SortName breaks ties. Neither key holds still: a library scan can move
// DateCreated when a file's timestamps change.
private const val ITEMS_SORT = "SortBy=DateCreated,SortName&SortOrder=Ascending"

private val log = LoggerFactory.getLogger(JellyfinMediaServer::class.java)

data class ItemDto(
	@JsonProperty("Id") val id: String,
	@JsonProperty("Name") val name: String? = null,
	@JsonProperty("Type") val type: String? = null,
	@JsonProperty("Path") val path: String? = null,
	@JsonProperty("ProviderIds") @JsonSetter(contentNulls = Nulls.SKIP) val providerIds: Map<String, String>? = null,
	@JsonProperty("ProductionYear") val productionYear: Int? = null,
	@JsonProperty("RunTimeTicks") val runTimeTicks: Long? = null,
	@JsonProperty("SeriesId") val seriesId: String? = null,
	@JsonProperty("ParentIndexNumber") val parentIndexNumber: Int? = null,
	@JsonProperty("IndexNumber") val indexNumber: Int? = null,
	@JsonProperty("IndexNumberEnd") val indexNumberEnd: Int? = null,
	@JsonProperty("LocationType") val locationType: String? = null,
)

private val PROVIDER_IDS: Map<String, (ExternalIds, String) -> ExternalIds?> = mapOf(
	"imdb" to { ids, raw -> ImdbId.parseOrNull(raw)?.let { ids.copy(imdb = it) } },
	"tvdb" to { ids, raw -> TvdbId.parseOrNull(raw)?.let { ids.copy(tvdb = it) } },
	"tmdb" to { ids, raw -> TmdbId.parseOrNull(raw)?.let { ids.copy(tmdb = it) } },
)

private val ITEM_MAPPERS: Map<String, ItemDto.(title: String) -> ServerItem?> = mapOf(
	"Movie" to ItemDto::toMovie,
	"Series" to ItemDto::toShow,
	EPISODE_TYPE to ItemDto::toEpisodeOrNull,
)

private val ITEMS_FILTER = "Recursive=true&IncludeItemTypes=${ITEM_MAPPERS.keys.joinToString(",")}" +
	"&Fields=ProviderIds,Path&IsMissing=false"

private fun itemsPath(library: ServerLibraryId, startIndex: Int, limit: Int): String =
	"$ITEMS_PATH?ParentId=${library.value}&$ITEMS_FILTER&$ITEMS_SORT&StartIndex=$startIndex&Limit=$limit"

/** Every movie, show, and episode under [library] that Continuarr can represent, fetched a page at a time. */
fun libraryItems(library: ServerLibraryId, pageSize: PageSize, fetchPage: (path: String) -> ItemsPageDto<ItemDto>): Sequence<ServerItem> =
	pagedItems(pageSize, ItemDto::id) { startIndex, limit -> fetchPage(itemsPath(library, startIndex, limit)) }
		.mapNotNull { it.toServerItemOrNull() }

private fun ItemDto.toServerItemOrNull(): ServerItem? {
	if (type == EPISODE_TYPE && locationType == VIRTUAL_LOCATION_TYPE) return null
	val itemType = type ?: return skipped("it has no type")
	val mapper = ITEM_MAPPERS[itemType] ?: return skipped("its type $itemType wasn't requested")
	val title = name ?: return skipped("it has no name")
	return mapper(title)
}

private fun ItemDto.toMovie(title: String): ServerItem.Movie = ServerItem.Movie(
	id = ServerItemId(id),
	title = title,
	externalIds = externalIds(),
	fileName = path?.let(FileName::fromPathOrNull),
	year = productionYear,
	edition = null,
	runtime = runTimeTicks?.let(::ticksToDuration),
)

private fun ItemDto.toShow(title: String): ServerItem.Show = ServerItem.Show(
	id = ServerItemId(id),
	title = title,
	externalIds = externalIds(),
	fileName = path?.let(FileName::fromPathOrNull),
	year = productionYear,
)

private fun ItemDto.toEpisodeOrNull(title: String): ServerItem.Episode? {
	val showId = seriesId ?: return skipped("it's an episode with no show")
	return ServerItem.Episode(
		id = ServerItemId(id),
		title = title,
		externalIds = externalIds(),
		fileName = path?.let(FileName::fromPathOrNull),
		showId = ServerItemId(showId),
		season = parentIndexNumber,
		episode = indexNumber,
		episodeEnd = indexNumberEnd,
		runtime = runTimeTicks?.let(::ticksToDuration),
	)
}

private fun ItemDto.externalIds(): ExternalIds = providerIds.orEmpty().entries.fold(ExternalIds()) { ids, (key, raw) ->
	val fill = PROVIDER_IDS[key.lowercase(Locale.ROOT)]
	if (fill == null || raw.isBlank()) {
		ids
	} else {
		fill(ids, raw) ?: ids.also { log.warn("Ignoring malformed {} ID on Jellyfin item {}", key, id) }
	}
}

private fun ticksToDuration(ticks: Long): Duration = (ticks * NANOS_PER_TICK).nanoseconds

private fun ItemDto.skipped(reason: String): Nothing? {
	log.warn("Skipping Jellyfin item {} because {}", id, reason)
	return null
}
