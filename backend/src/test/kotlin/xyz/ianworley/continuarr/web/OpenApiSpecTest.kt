package xyz.ianworley.continuarr.web

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import tools.jackson.databind.json.JsonMapper
import xyz.ianworley.continuarr.TestcontainersConfiguration
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.exists
import kotlin.io.path.readText
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertTrue

private const val API_DOCS_PATH = "/v3/api-docs"
private const val ADMIN_USERNAME = "admin"

// Relative to backend/, Gradle's working directory for tests. The frontend generates its API
// types from the committed spec, so it must match what the backend actually serves.
private val COMMITTED_SPEC = Path.of("openapi.json")
private val GENERATED_SPEC = Path.of("build", "openapi.json")

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class OpenApiSpecTest(
	@Autowired private val mockMvc: MockMvc,
	@Autowired private val jsonMapper: JsonMapper,
) {

	@Test
	fun `the committed OpenAPI spec matches the API`() {
		val served = mockMvc.get(API_DOCS_PATH) { with(user(ADMIN_USERNAME)) }
			.andExpect { status { isOk() } }
			.andReturn().response.contentAsString
		val servedSpec = jsonMapper.readTree(served)

		// Always written, so updating the committed spec is a copy.
		Files.createDirectories(GENERATED_SPEC.parent)
		GENERATED_SPEC.writeText(jsonMapper.writerWithDefaultPrettyPrinter().writeValueAsString(servedSpec) + "\n")

		val committedSpec = if (COMMITTED_SPEC.exists()) jsonMapper.readTree(COMMITTED_SPEC.readText()) else null
		assertTrue(
			committedSpec == servedSpec,
			"backend/$COMMITTED_SPEC is out of date with the API. Review the change, then from backend/ run " +
				"`cp $GENERATED_SPEC $COMMITTED_SPEC` and `npm run typecheck` in frontend/.",
		)
	}
}
