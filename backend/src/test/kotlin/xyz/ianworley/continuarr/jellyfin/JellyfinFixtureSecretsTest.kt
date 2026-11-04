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
// record.sh sets the variable to check staged mappings before they replace the committed ones.
private const val FIXTURES_DIR_VARIABLE = "JELLYFIN_FIXTURES_DIR"
private val FIXTURES_DIR = System.getenv(FIXTURES_DIR_VARIABLE)?.let { Path.of(it) }
	?: Path.of("src", "test", "resources", "wiremock", "jellyfin")
private val SEED_DIR = Path.of("src", "test", "fixtures", "jellyfin")
private val PLACEHOLDERS = SEED_DIR.resolve("placeholders.json")
private val SEED_SECRETS = SEED_DIR.resolve(".seed").resolve("secrets.json")

private const val RERECORD_HINT = "Re-record with src/test/fixtures/jellyfin/record.sh, which scrubs these values."

// Keyed like placeholders.json.
private val IDENTITY_PROPERTIES = mapOf("ServerId" to "serverId", "ServerName" to "serverName", "LocalAddress" to "localAddress")
private val KEY_PROPERTY = Regex("""(?i)api_?key|token|authorization""")
private val HEX_KEY = Regex("""(?i)[0-9a-f]{32}""")
private val KEY_IN_TEXT = Regex("""(?i)(?:api_?key|token)\W{1,4}([0-9a-f]{32})""")

// Written apart from record.sh's pattern, so a private range the scrub misses still fails here.
private val PRIVATE_ADDRESS = Regex(
	"""(?i)\b(?:10(?:\.\d{1,3}){3}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|192\.168(?:\.\d{1,3}){2}""" +
		"""|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])(?:\.\d{1,3}){2})\b""" +
		"""|\b(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):[0-9a-f:]*:[0-9a-f]{0,4}""",
)

/** A string in a fixture, with the property names that lead to it from the root. */
private class FixtureString(val path: List<String>, val value: String)

// A string body can hold JSON. It stays as text and gains its parsed value, so both get checked.
private fun withEmbeddedJson(json: Any?): Any? = when (json) {
	is Map<*, *> -> json.mapValues { withEmbeddedJson(it.value) }
	is List<*> -> json.map(::withEmbeddedJson)
	is String -> embeddedJson(json)?.let { listOf(json, withEmbeddedJson(it)) } ?: json
	else -> json
}

private fun embeddedJson(text: String): Any? = text.trimStart().takeIf { it.startsWith("{") || it.startsWith("[") }
	?.let { runCatching { JsonMapper().readValue<Any>(it) }.getOrNull() }

private fun strings(json: Any?, path: List<String> = emptyList()): Sequence<FixtureString> = when (json) {
	is Map<*, *> -> json.asSequence().flatMap { (key, value) -> strings(value, path + key.toString()) }
	is List<*> -> json.asSequence().flatMap { strings(it, path) }
	is String -> sequenceOf(FixtureString(path, json))
	else -> emptySequence()
}

// A value under a key-named property is a key wherever it sits, as in a header matcher. Elsewhere,
// such as a URL or a string body, it counts only right after a key name.
private fun apiKeys(string: FixtureString): Sequence<String> =
	if (string.path.any { KEY_PROPERTY.containsMatchIn(it) }) {
		HEX_KEY.findAll(string.value).map { it.value }
	} else {
		KEY_IN_TEXT.findAll(string.value).map { it.groupValues[1] }
	}

// System info is the only Jellyfin object with a LocalAddress, and its plain Id is the server ID.
private fun serverInfoIds(json: Any?): Sequence<Any?> = when (json) {
	is Map<*, *> -> json.values.asSequence().flatMap(::serverInfoIds) +
		if ("LocalAddress" in json) sequenceOf(json["Id"]) else emptySequence()
	is List<*> -> json.asSequence().flatMap(::serverInfoIds)
	else -> emptySequence()
}

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
			val json = withEmbeddedJson(JsonMapper().readValue<Any>(text))
			val strings = strings(json).toList()
			val keyLeaks = strings.flatMap(::apiKeys)
				.filter { it != placeholders.getValue("apiKey") }
				.map { "$file has a real API key" }
			val identityLeaks = strings
				.filter { (it.path.lastOrNull() ?: "") in IDENTITY_PROPERTIES }
				.filter { it.value != placeholders.getValue(IDENTITY_PROPERTIES.getValue(it.path.last())) }
				.map { "$file has a real ${it.path.last()}" }
			val serverIdLeaks = serverInfoIds(json)
				.filter { it != placeholders.getValue("serverId") }
				.map { "$file has a real server Id in its system info" }
			keyLeaks + identityLeaks + serverIdLeaks
		}

		assertEquals(emptyList(), leaks, RERECORD_HINT)
	}

	@Test
	fun `fixtures contain no private network address`() {
		val leaks = fixtures.flatMap { (file, text) -> PRIVATE_ADDRESS.findAll(text).map { "$file contains ${it.value}" } }

		assertEquals(emptyList(), leaks, RERECORD_HINT)
	}
}
