package xyz.ianworley.continuarr.server

import kotlin.test.Test
import kotlin.test.assertEquals

private const val WELL_FORMED_IMDB_ID = "tt0133093"
private const val WELL_FORMED_NUMERIC_ID = "81189"

private val MALFORMED_IMDB_IDS = listOf(
	"",
	"tt",
	"0133093",
	"TT0133093",
	"ttabc",
	" tt0133093",
	"tt0133093 ",
	"tt-0133093",
	"tt١٢٣",
)

private val MALFORMED_NUMERIC_IDS = listOf(
	"",
	"abc",
	"81189a",
	" 81189",
	"81189 ",
	"-81189",
	"+81189",
	"١٢٣",
)

class ExternalIdsTest {

	@Test
	fun `ImdbId accepts tt followed by digits`() {
		assertEquals(WELL_FORMED_IMDB_ID, ImdbId.parseOrNull(WELL_FORMED_IMDB_ID)?.value)
	}

	@Test
	fun `ImdbId rejects malformed input`() {
		assertEquals(emptyList(), MALFORMED_IMDB_IDS.filter { ImdbId.parseOrNull(it) != null })
	}

	@Test
	fun `TvdbId accepts digits`() {
		assertEquals(WELL_FORMED_NUMERIC_ID, TvdbId.parseOrNull(WELL_FORMED_NUMERIC_ID)?.value)
	}

	@Test
	fun `TvdbId rejects malformed input`() {
		assertEquals(emptyList(), MALFORMED_NUMERIC_IDS.filter { TvdbId.parseOrNull(it) != null })
	}

	@Test
	fun `TmdbId accepts digits`() {
		assertEquals(WELL_FORMED_NUMERIC_ID, TmdbId.parseOrNull(WELL_FORMED_NUMERIC_ID)?.value)
	}

	@Test
	fun `TmdbId rejects malformed input`() {
		assertEquals(emptyList(), MALFORMED_NUMERIC_IDS.filter { TmdbId.parseOrNull(it) != null })
	}
}
