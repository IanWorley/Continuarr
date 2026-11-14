package xyz.ianworley.continuarr.mediaproviders.provider.plex

import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UpdateTimestamp
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.Repository
import org.springframework.transaction.annotation.Transactional
import java.time.Instant

// The single saved Plex connection. See 0004-plex-connection.sql.
@Entity
@Table(name = "plex_connection")
class PlexConnectionRow(
	@Id val id: Short,
	val url: String,
	val token: String?,
	@Enumerated(EnumType.STRING) val source: PlexConnectionSource,
	@UpdateTimestamp val updatedAt: Instant? = null,
)

interface PlexConnectionRepository : Repository<PlexConnectionRow, Short> {

	fun findById(id: Short): PlexConnectionRow?

	fun save(row: PlexConnectionRow): PlexConnectionRow

	// One DELETE statement, unlike deleteById, which loads the row first and fails when a concurrent unlink removed it.
	@Transactional
	@Modifying
	@Query("DELETE FROM PlexConnectionRow row WHERE row.id = :id")
	fun deleteRow(id: Short): Int
}
