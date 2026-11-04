package xyz.ianworley.continuarr.jellyfin.internal

import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.jdbc.core.simple.JdbcClient
import xyz.ianworley.continuarr.server.MediaServer

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(EncryptionKeyProperties::class)
class JellyfinConfiguration {

	@Bean
	fun jellyfinConnectionStore(jdbcClient: JdbcClient, encryptionKey: EncryptionKeyProperties): JellyfinConnectionStore =
		JellyfinConnectionStore(jdbcClient, encryptionKey)

	@Bean
	fun jellyfinMediaServer(store: JellyfinConnectionStore): MediaServer = JellyfinMediaServer(store::load)
}
