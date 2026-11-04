package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import xyz.ianworley.continuarr.server.MediaServer

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(JellyfinProperties::class, EncryptionKeyProperties::class)
class JellyfinConfiguration {

	@Bean
	fun jellyfinMediaServer(properties: JellyfinProperties): MediaServer = JellyfinMediaServer(properties)
}
