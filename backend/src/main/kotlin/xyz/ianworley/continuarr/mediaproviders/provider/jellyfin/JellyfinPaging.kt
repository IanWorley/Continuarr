package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import com.fasterxml.jackson.annotation.JsonProperty

private const val DEFAULT_PAGE_SIZE = 500

val JELLYFIN_PAGE_SIZE = PageSize(DEFAULT_PAGE_SIZE)

@JvmInline
value class PageSize(val value: Int) {
	init {
		require(value > 0) { "Page size must be positive: $value" }
	}
}

data class ItemsPageDto<T>(
	@JsonProperty("Items") val items: List<T>,
	@JsonProperty("TotalRecordCount") val totalRecordCount: Int,
)

/**
 * Every item of an offset-paged query, each ID once. Lazy: a page is fetched only when iteration reaches it,
 * and each iteration starts over from the first page. Stops after a short page or once the next start index
 * reaches `TotalRecordCount`, counting the raw page so a repeated ID never ends the scan early.
 *
 * Offset paging shifts when an item is added, removed, or moves in the sort order mid-scan. The ID check drops a
 * repeated item, but a skipped one, which can be an item that never changed, waits for the next scan.
 */
fun <T> pagedItems(pageSize: PageSize, idOf: (T) -> String, fetchPage: (startIndex: Int, limit: Int) -> ItemsPageDto<T>): Sequence<T> =
	sequence {
		val seen = HashSet<String>()
		var startIndex = 0
		do {
			val page = fetchPage(startIndex, pageSize.value)
			page.items.forEach { if (seen.add(idOf(it))) yield(it) }
			startIndex += page.items.size
		} while (page.items.size >= pageSize.value && startIndex < page.totalRecordCount)
	}
