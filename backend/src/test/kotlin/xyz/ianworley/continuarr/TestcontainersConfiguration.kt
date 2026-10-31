package xyz.ianworley.continuarr

import org.springframework.boot.test.context.TestConfiguration
import org.springframework.boot.testcontainers.service.connection.ServiceConnection
import org.springframework.context.annotation.Bean
import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName

// Pinned so tests and local dev don't drift when a new Postgres major ships.
private const val POSTGRES_IMAGE = "postgres:18-alpine"

@TestConfiguration(proxyBeanMethods = false)
class TestcontainersConfiguration {

	@Bean
	@ServiceConnection
	fun postgresContainer(): PostgreSQLContainer = PostgreSQLContainer(DockerImageName.parse(POSTGRES_IMAGE))
}
