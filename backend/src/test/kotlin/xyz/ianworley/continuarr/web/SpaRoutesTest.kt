package xyz.ianworley.continuarr.web

import org.hamcrest.Matchers.containsString
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc
import org.springframework.context.annotation.Import
import org.springframework.http.MediaType
import org.springframework.security.test.context.support.WithMockUser
import org.springframework.test.web.servlet.MockMvc
import org.springframework.test.web.servlet.get
import xyz.ianworley.continuarr.TestcontainersConfiguration
import java.net.URI
import kotlin.test.Test

// Matches the title in src/test/resources/static/index.html.
private const val SPA_MARKER = "Continuarr test SPA"

private const val DEEP_LINK = "/people/123"
private const val MISSING_ASSET = "/assets/missing.js"
private const val UNKNOWN_API_PATH = "/api/v1/unknown"
private const val API_DOCS_PATH = "/v3/api-docs"

// "/v3/api-docs" with the "v" percent-encoded; Spring MVC decodes it to the same endpoint.
private const val ENCODED_API_DOCS_PATH = "/%763/api-docs"

@SpringBootTest
@AutoConfigureMockMvc
@Import(TestcontainersConfiguration::class)
class SpaRoutesTest(@Autowired private val mockMvc: MockMvc) {

	@Test
	fun `a deep link serves index html without login`() {
		mockMvc.get(DEEP_LINK).andExpect {
			status { isOk() }
			content { contentTypeCompatibleWith(MediaType.TEXT_HTML) }
			content { string(containsString(SPA_MARKER)) }
		}
	}

	@Test
	fun `a missing asset gets 404 instead of index html`() {
		mockMvc.get(MISSING_ASSET).andExpect { status { isNotFound() } }
	}

	@Test
	@WithMockUser
	fun `an unknown API path gets 404 instead of index html`() {
		mockMvc.get(UNKNOWN_API_PATH).andExpect { status { isNotFound() } }
	}

	@Test
	fun `the OpenAPI spec still requires login`() {
		mockMvc.get(API_DOCS_PATH).andExpect { status { isUnauthorized() } }
	}

	@Test
	fun `an encoded server path still requires login`() {
		mockMvc.get(URI(ENCODED_API_DOCS_PATH)).andExpect { status { isUnauthorized() } }
	}
}
