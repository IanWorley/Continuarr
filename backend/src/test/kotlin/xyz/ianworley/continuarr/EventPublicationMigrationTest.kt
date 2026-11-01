package xyz.ianworley.continuarr

import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.context.annotation.Import
import org.springframework.jdbc.core.simple.JdbcClient
import kotlin.test.Test
import kotlin.test.assertEquals

private const val EVENT_PUBLICATION_TABLE = "event_publication"

// The columns Spring Modulith 2.1's JPA and JDBC registries read and write.
private val EXPECTED_COLUMNS = setOf(
	"id",
	"listener_id",
	"event_type",
	"serialized_event",
	"publication_date",
	"completion_date",
	"status",
	"completion_attempts",
	"last_resubmission_date",
)

@SpringBootTest
@Import(TestcontainersConfiguration::class)
class EventPublicationMigrationTest(@Autowired private val jdbcClient: JdbcClient) {

	@Test
	fun `liquibase creates the event_publication table with Modulith's columns`() {
		val columns = jdbcClient
			.sql("select column_name from information_schema.columns where table_name = :table")
			.param("table", EVENT_PUBLICATION_TABLE)
			.query(String::class.java)
			.set()

		assertEquals(EXPECTED_COLUMNS, columns)
	}
}
