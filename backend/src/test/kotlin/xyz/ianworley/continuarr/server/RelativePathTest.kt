package xyz.ianworley.continuarr.server

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val TV_ROOT = "/media/tv"
private const val EPISODE_PATH = "Show/S01E01.mkv"

class RelativePathTest {

	@Test
	fun `strips the matching root`() {
		val relative = RelativePath.relativizeOrNull("$TV_ROOT/$EPISODE_PATH", listOf(TV_ROOT))

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `picks the longest matching root`() {
		val relative = RelativePath.relativizeOrNull("$TV_ROOT/$EPISODE_PATH", listOf("/media", TV_ROOT, "/"))

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `rejects a sibling folder sharing a prefix`() {
		assertNull(RelativePath.relativizeOrNull("/media/tv-kids/show.mkv", listOf(TV_ROOT)))
	}

	@Test
	fun `normalizes Windows separators`() {
		val relative = RelativePath.relativizeOrNull("D:\\Media\\TV\\Show\\S01E01.mkv", listOf("D:\\Media\\TV"))

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `strips trailing slashes from roots`() {
		val relative = RelativePath.relativizeOrNull("$TV_ROOT/$EPISODE_PATH", listOf("$TV_ROOT//"))

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `compares case-sensitively`() {
		assertNull(RelativePath.relativizeOrNull("/Media/TV/$EPISODE_PATH", listOf(TV_ROOT)))
	}

	@Test
	fun `returns null when no root matches`() {
		assertNull(RelativePath.relativizeOrNull("/srv/movies/Movie.mkv", listOf(TV_ROOT)))
	}

	@Test
	fun `returns null when the path is the root itself`() {
		assertNull(RelativePath.relativizeOrNull("$TV_ROOT/", listOf(TV_ROOT)))
	}

	@Test
	fun `ignores blank roots`() {
		assertNull(RelativePath.relativizeOrNull("/srv/movies/Movie.mkv", listOf(TV_ROOT, "")))
	}
}
