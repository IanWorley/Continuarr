package xyz.ianworley.continuarr.jellyfin

import org.junit.jupiter.api.Assumptions.assumeTrue
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.readValue
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.isRegularFile
import kotlin.io.path.readText
import kotlin.test.Test
import kotlin.test.assertEquals

// Relative to backend/, Gradle's working directory for tests.
private val FIXTURES_DIR = Path.of("src", "test", "resources", "wiremock", "jellyfin")
private val SEED_SECRETS = Path.of("src", "test", "fixtures", "jellyfin", ".seed", "secrets.json")

private const val RERECORD_HINT = "Re-record with src/test/fixtures/jellyfin/record.sh, which scrubs these values."

/** A place Jellyfin returns a value that identifies a server, and the placeholder record.sh writes there. */
private class PlaceholderField(val name: String, val pattern: Regex, val placeholder: String)

private val PLACEHOLDER_FIELDS = listOf(
	PlaceholderField("API key", Regex("""(?i)(?:api_?key|token)\W{1,4}([0-9a-f]{32})"""), "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
	PlaceholderField("ServerId", Regex(""""ServerId"\s*:\s*"([^"]*)""""), "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
	PlaceholderField("ServerName", Regex(""""ServerName"\s*:\s*"([^"]*)""""), "Seed Server"),
	PlaceholderField("LocalAddress", Regex(""""LocalAddress"\s*:\s*"([^"]*)""""), "http://192.0.2.1:8096"),
)

// 10/8, 172.16/12, and 192.168/16.
private val PRIVATE_IPV4 =
	Regex("""\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})\b""")

class JellyfinFixtureSecretsTest {

	private val fixtures: Map<Path, String> = Files.walk(FIXTURES_DIR).use { paths ->
		paths.filter { it.isRegularFile() }.toList().associateWith { it.readText() }
	}

	// Only a machine that ran seed.sh knows the real values, so CI skips this check.
	@Test
	fun `fixtures contain no value from the local seed server`() {
		assumeTrue(SEED_SECRETS.exists(), "No local seed server to compare against")
		val secrets = JsonMapper().readValue<Map<String, String>>(SEED_SECRETS.readText()).filterValues { it.isNotEmpty() }

		val leaks = fixtures.flatMap { (file, text) ->
			secrets.filterValues { it in text }.keys.map { "$file contains the seed server's $it" }
		}

		assertEquals(emptyList(), leaks, RERECORD_HINT)
	}

	@Test
	fun `fixtures hold placeholders where Jellyfin returns the API key and server identity`() {
		val leaks = fixtures.flatMap { (file, text) ->
			PLACEHOLDER_FIELDS.flatMap { field ->
				field.pattern.findAll(text).filter { it.groupValues[1] != field.placeholder }.map { "$file has a real ${field.name}" }
			}
		}

		assertEquals(emptyList(), leaks, RERECORD_HINT)
	}

	@Test
	fun `fixtures contain no private network address`() {
		val leaks = fixtures.flatMap { (file, text) -> PRIVATE_IPV4.findAll(text).map { "$file contains ${it.value}" } }

		assertEquals(emptyList(), leaks, RERECORD_HINT)
	}
}
