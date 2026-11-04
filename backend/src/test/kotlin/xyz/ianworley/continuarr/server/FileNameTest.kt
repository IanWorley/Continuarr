package xyz.ianworley.continuarr.server

import tools.jackson.module.kotlin.jacksonObjectMapper
import tools.jackson.module.kotlin.readValue
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertNull

private const val EPISODE_FILE = "S01E01.mkv"
private const val SHOW_FOLDER = "Breaking Bad"
private const val UNIX_EPISODE_PATH = "/media/tv/Show/S01E01.mkv"
private const val WINDOWS_EPISODE_PATH = "D:\\Media\\TV\\Show\\S01E01.mkv"
private const val SHOW_FOLDER_PATH = "/media/tv/Breaking Bad/"
private const val FILESYSTEM_ROOT = "/"
private const val PATH_JSON = "\"/media/tv/Show/S01E01.mkv\""

class FileNameTest {

	@Test
	fun `takes the last segment of a Unix path`() {
		assertEquals(EPISODE_FILE, FileName.fromPathOrNull(UNIX_EPISODE_PATH)?.value)
	}

	@Test
	fun `takes the last segment of a Windows path`() {
		assertEquals(EPISODE_FILE, FileName.fromPathOrNull(WINDOWS_EPISODE_PATH)?.value)
	}

	@Test
	fun `ignores trailing separators`() {
		assertEquals(SHOW_FOLDER, FileName.fromPathOrNull(SHOW_FOLDER_PATH)?.value)
	}

	@Test
	fun `returns null when no segment is left`() {
		assertNull(FileName.fromPathOrNull(FILESYSTEM_ROOT))
	}

	@Test
	fun `Jackson can't build a FileName that contains a separator`() {
		assertFails { jacksonObjectMapper().readValue<FileName>(PATH_JSON) }
	}
}
