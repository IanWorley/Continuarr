package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import xyz.ianworley.continuarr.mediaproviders.MediaServer
import xyz.ianworley.continuarr.mediaproviders.provider.secrets.EncryptionKeyProperties

@Configuration(proxyBeanMethods = false)
class JellyfinConfiguration {

	@Bean
	fun jellyfinConnectionStore(repository: JellyfinConnectionRepository, encryptionKey: EncryptionKeyProperties): JellyfinConnectionStore =
		JellyfinConnectionStore(repository, encryptionKey)

	@Bean
	fun jellyfinMediaServer(store: JellyfinConnectionStore): MediaServer = JellyfinMediaServer(store::load)
}
