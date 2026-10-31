package xyz.ianworley.continuarr

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import kotlin.test.Test
import kotlin.test.assertTrue

@SpringBootTest
@Import(TestcontainersConfiguration::class)
class PostgresConnectionTest(@Autowired private val jdbcClient: JdbcClient) {

	@Test
	fun `datasource connects to the Testcontainers Postgres`() {
		val version = jdbcClient.sql("select version()").query(String::class.java).single()

		assertTrue(version.startsWith("PostgreSQL"), "Expected a PostgreSQL server but got: $version")
	}
}
