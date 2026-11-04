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
private val SEED_DIR = Path.of("src", "test", "fixtures", "jellyfin")
private val PLACEHOLDERS = SEED_DIR.resolve("placeholders.json")
private val SEED_SECRETS = SEED_DIR.resolve(".seed").resolve("secrets.json")

private const val RERECORD_HINT = "Re-record with src/test/fixtures/jellyfin/record.sh, which scrubs these values."

private class PlaceholderField(val name: String, val pattern: Regex, val placeholderKey: String)

private val PLACEHOLDER_FIELDS = listOf(
	PlaceholderField("API key", Regex("""(?i)(?:api_?key|token)\W{1,4}([0-9a-f]{32})"""), "apiKey"),
	PlaceholderField("ServerId", Regex(""""ServerId"\s*:\s*"([^"]*)""""), "serverId"),
	PlaceholderField("ServerName", Regex(""""ServerName"\s*:\s*"([^"]*)""""), "serverName"),
	PlaceholderField("LocalAddress", Regex(""""LocalAddress"\s*:\s*"([^"]*)""""), "localAddress"),
)

// Written apart from record.sh's pattern, so a private range the scrub misses still fails here.
private val PRIVATE_IPV4 =
	Regex("""\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2})\b""")

private fun readStrings(json: Path): Map<String, String> = JsonMapper().readValue(json.readText())

class JellyfinFixtureSecretsTest {

	private val fixtures: Map<Path, String> = Files.walk(FIXTURES_DIR).use { paths ->
		paths.filter { it.isRegularFile() }.toList().associateWith { it.readText() }
	}

	@Test
	fun `fixtures contain no value from the local seed server`() {
		assumeTrue(SEED_SECRETS.exists(), "No local seed server to compare against")
		val secrets = readStrings(SEED_SECRETS).filterValues { it.isNotEmpty() }

		val leaks = fixtures.flatMap { (file, text) ->
			secrets.filterValues { it in text }.keys.map { "$file contains the seed server's $it" }
		}

		assertEquals(emptyList(), leaks, RERECORD_HINT)
	}

	@Test
	fun `fixtures hold placeholders where Jellyfin returns the API key and server identity`() {
		val placeholders = readStrings(PLACEHOLDERS)

		val leaks = fixtures.flatMap { (file, text) ->
			PLACEHOLDER_FIELDS.flatMap { field ->
				field.pattern.findAll(text)
					.filter { it.groupValues[1] != placeholders.getValue(field.placeholderKey) }
					.map { "$file has a real ${field.name}" }
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
