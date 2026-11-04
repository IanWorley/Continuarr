package xyz.ianworley.continuarr.server

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

private const val MEDIA_ROOT = "/media"
private const val TV_ROOT = "/media/tv"
private const val FILESYSTEM_ROOT = "/"
private const val EPISODE_PATH = "Show/S01E01.mkv"
private const val SIBLING_FOLDER_PATH = "/media/tv-kids/show.mkv"
private const val DIFFERENT_CASE_PATH = "/Media/TV/Show/S01E01.mkv"
private const val UNRELATED_PATH = "/srv/movies/Movie.mkv"
private const val WINDOWS_ROOT = "D:\\Media\\TV"
private const val WINDOWS_EPISODE_PATH = "D:\\Media\\TV\\Show\\S01E01.mkv"

class RelativePathTest {

	@Test
	fun `strips the matching root`() {
		val relative = RelativePath.relativizeOrNull("$TV_ROOT/$EPISODE_PATH", listOf(TV_ROOT))

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `picks the longest matching root`() {
		val relative = RelativePath.relativizeOrNull(
			"$TV_ROOT/$EPISODE_PATH",
			listOf(MEDIA_ROOT, TV_ROOT, FILESYSTEM_ROOT),
		)

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `rejects a sibling folder sharing a prefix`() {
		assertNull(RelativePath.relativizeOrNull(SIBLING_FOLDER_PATH, listOf(TV_ROOT)))
	}

	@Test
	fun `normalizes Windows separators`() {
		val relative = RelativePath.relativizeOrNull(WINDOWS_EPISODE_PATH, listOf(WINDOWS_ROOT))

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `strips trailing slashes from roots`() {
		val relative = RelativePath.relativizeOrNull("$TV_ROOT/$EPISODE_PATH", listOf("$TV_ROOT//"))

		assertEquals(EPISODE_PATH, relative?.value)
	}

	@Test
	fun `compares case-sensitively`() {
		assertNull(RelativePath.relativizeOrNull(DIFFERENT_CASE_PATH, listOf(TV_ROOT)))
	}

	@Test
	fun `returns null when no root matches`() {
		assertNull(RelativePath.relativizeOrNull(UNRELATED_PATH, listOf(TV_ROOT)))
	}

	@Test
	fun `returns null when the path is the root itself`() {
		assertNull(RelativePath.relativizeOrNull("$TV_ROOT/", listOf(TV_ROOT)))
	}

	@Test
	fun `ignores blank roots`() {
		assertNull(RelativePath.relativizeOrNull(UNRELATED_PATH, listOf(TV_ROOT, "")))
	}
}
