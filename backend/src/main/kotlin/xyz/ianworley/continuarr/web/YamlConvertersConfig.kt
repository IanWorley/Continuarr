package xyz.ianworley.continuarr.web

import org.springframework.boot.http.converter.autoconfigure.ServerHttpMessageConvertersCustomizer
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.MediaType

@Configuration
class YamlConvertersConfig {

	// springdoc puts Jackson's YAML module on the classpath, so Spring MVC would read YAML request bodies.
	// SnakeYAML's parse errors quote the line they reject, such as a password, and Spring logs them.
	@Bean
	fun yamlConvertersRemover() = ServerHttpMessageConvertersCustomizer { builder ->
		builder.configureMessageConvertersList { converters ->
			converters.removeIf { MediaType.APPLICATION_YAML in it.supportedMediaTypes }
		}
	}
}
