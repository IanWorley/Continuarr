package xyz.ianworley.continuarr.web

import org.springframework.boot.http.converter.autoconfigure.ServerHttpMessageConvertersCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import tools.jackson.databind.json.JsonMapper

@Configuration
class RedactingJsonConfig {

	// Takes Spring MVC's JSON slot, so the converter keeps its place behind the String and Resource
	// converters. Runs after Boot's own JSON customizer, which is @Order(0), so this one wins.
	@Bean
	@Order(Ordered.LOWEST_PRECEDENCE)
	fun redactingJsonConverterCustomizer(jsonMapper: JsonMapper) = ServerHttpMessageConvertersCustomizer {
		it.withJsonConverter(RedactingJsonHttpMessageConverter(jsonMapper))
	}
}
