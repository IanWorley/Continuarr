package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import xyz.ianworley.continuarr.mediaproviders.MediaServer

@Configuration(proxyBeanMethods = false)
class JellyfinConfiguration {

	@Bean
	fun jellyfinConnectionStore(repository: JellyfinConnectionRepository): JellyfinConnectionStore = JellyfinConnectionStore(repository)

	@Bean
	fun jellyfinMediaServer(store: JellyfinConnectionStore): MediaServer = JellyfinMediaServer(store::load)
}
