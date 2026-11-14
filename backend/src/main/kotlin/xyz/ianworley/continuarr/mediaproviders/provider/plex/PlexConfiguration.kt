package xyz.ianworley.continuarr.mediaproviders.provider.plex

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(PlexSeedProperties::class)
class PlexConfiguration {

	@Bean
	fun plexConnectionStore(repository: PlexConnectionRepository): PlexConnectionStore = PlexConnectionStore(repository)

	@Bean
	fun plexEnvironmentSeed(properties: PlexSeedProperties, store: PlexConnectionStore): PlexEnvironmentSeed =
		PlexEnvironmentSeed(properties, store)
}
