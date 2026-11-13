package xyz.ianworley.continuarr.web

import io.swagger.v3.oas.models.media.Schema
import org.springdoc.core.customizers.OpenApiCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

private const val NULL_TYPE = "null"

@Configuration
class OpenApiConfig {

	// springdoc writes a nullable Kotlin enum as type ["string", "null"] with an enum that leaves out null. In
	// OpenAPI 3.1 the enum wins, so a validator would reject the null the API really returns.
	@Bean
	fun nullableEnumsAllowNull() = OpenApiCustomizer { openApi ->
		openApi.components?.schemas?.values?.flatMap { it.properties?.values.orEmpty() }?.forEach(::allowNullInEnum)
	}
}

private fun allowNullInEnum(property: Schema<*>) {
	@Suppress("UNCHECKED_CAST")
	val enum = property.enum as MutableList<Any?>? ?: return
	if (property.types?.contains(NULL_TYPE) == true && null !in enum) enum.add(null)
}
