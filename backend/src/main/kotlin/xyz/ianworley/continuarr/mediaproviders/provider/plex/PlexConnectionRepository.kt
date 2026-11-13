package xyz.ianworley.continuarr.mediaproviders.provider.plex

import jakarta.persistence.Entity
import jakarta.persistence.EnumType
import jakarta.persistence.Enumerated
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UpdateTimestamp
import org.springframework.data.repository.Repository
import java.time.Instant

// The single saved Plex connection. See 0004-plex-connection.sql.
@Entity
@Table(name = "plex_connection")
class PlexConnectionRow(
	@Id val id: Short,
	val url: String,
	val tokenCiphertext: ByteArray,
	@Enumerated(EnumType.STRING) val source: PlexConnectionSource,
	@UpdateTimestamp val updatedAt: Instant? = null,
)

interface PlexConnectionRepository : Repository<PlexConnectionRow, Short> {

	fun findById(id: Short): PlexConnectionRow?

	fun save(row: PlexConnectionRow): PlexConnectionRow
}
