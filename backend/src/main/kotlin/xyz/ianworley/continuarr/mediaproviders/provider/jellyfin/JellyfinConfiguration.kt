package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import xyz.ianworley.continuarr.server.MediaServer

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(EncryptionKeyProperties::class)
class JellyfinConfiguration {

	@Bean
	fun jellyfinConnectionStore(repository: JellyfinConnectionRepository, encryptionKey: EncryptionKeyProperties): JellyfinConnectionStore =
		JellyfinConnectionStore(repository, encryptionKey)

	@Bean
	fun jellyfinMediaServer(store: JellyfinConnectionStore): MediaServer = JellyfinMediaServer(store::load)
}
