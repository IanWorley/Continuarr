package xyz.ianworley.continuarr.web

import jakarta.servlet.http.HttpServletRequest
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.io.ClassPathResource
import org.springframework.http.HttpMethod
import org.springframework.http.server.PathContainer
import org.springframework.http.server.RequestPath
import org.springframework.security.web.util.matcher.RequestMatcher
import org.springframework.web.servlet.function.RequestPredicate
import org.springframework.web.servlet.function.router

const val SPA_INDEX_PATH = "/index.html"

// Vite's default assetsDir, where the build puts its hashed JS and CSS.
const val SPA_ASSETS_PATH = "/assets/**"

// Spring Boot serves classpath:/static; the frontend build is packaged there (see build.gradle.kts).
private const val SPA_INDEX_RESOURCE = "static/index.html"

// First path segments the server owns, so the SPA never routes there. Anything else is public, so
// a new server path outside these must be added here: REST belongs under /api, and "v3" is
// springdoc's /v3/api-docs.
private val SERVER_SEGMENTS = setOf("api", "actuator", "error", "v3")

private const val FILE_EXTENSION_SEPARATOR = '.'

/**
 * Matches the SPA's client-side routes, like `/` or `/people/123`: GETs outside the server's own
 * paths whose last segment has no file extension, so a missing asset still gets a 404.
 */
object SpaRouteMatcher : RequestMatcher {
	override fun matches(request: HttpServletRequest): Boolean {
		if (request.method != HttpMethod.GET.name()) return false
		// Decoded, as Spring MVC matches them, so an encoded "/%763/..." can't slip past SERVER_SEGMENTS.
		val segments = RequestPath.parse(request.requestURI, request.contextPath).pathWithinApplication()
			.elements()
			.filterIsInstance<PathContainer.PathSegment>()
			.map { it.valueToMatch() }
			.filter { it.isNotEmpty() }
		return segments.firstOrNull() !in SERVER_SEGMENTS &&
			segments.lastOrNull()?.contains(FILE_EXTENSION_SEPARATOR) != true
	}
}

// Deep links load index.html, and the frontend's router takes it from there.
@Configuration
class SpaRoutes {

	@Bean
	fun spaRouter() = router {
		resource(RequestPredicate { SpaRouteMatcher.matches(it.servletRequest()) }, ClassPathResource(SPA_INDEX_RESOURCE))
	}
}
