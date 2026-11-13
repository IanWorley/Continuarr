package xyz.ianworley.continuarr.mediaproviders.provider.plex

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import xyz.ianworley.continuarr.mediaproviders.provider.secrets.EncryptionKeyProperties

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(PlexSeedProperties::class)
class PlexConfiguration {

	@Bean
	fun plexConnectionStore(repository: PlexConnectionRepository, encryptionKey: EncryptionKeyProperties): PlexConnectionStore =
		PlexConnectionStore(repository, encryptionKey)

	@Bean
	fun plexEnvironmentSeed(properties: PlexSeedProperties, store: PlexConnectionStore): PlexEnvironmentSeed =
		PlexEnvironmentSeed(properties, store)
}
