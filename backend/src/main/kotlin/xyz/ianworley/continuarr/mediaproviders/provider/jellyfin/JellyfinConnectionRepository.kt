package xyz.ianworley.continuarr.mediaproviders.provider.jellyfin

import jakarta.persistence.Entity
import jakarta.persistence.Id
import jakarta.persistence.Table
import org.hibernate.annotations.UpdateTimestamp
import org.springframework.data.repository.Repository
import java.time.Instant

// The single saved Jellyfin connection. See 0003-jellyfin-connection.sql.
@Entity
@Table(name = "jellyfin_connection")
class JellyfinConnectionRow(
	@Id val id: Short,
	val url: String,
	val apiKeyCiphertext: ByteArray,
	@UpdateTimestamp val updatedAt: Instant? = null,
)

interface JellyfinConnectionRepository : Repository<JellyfinConnectionRow, Short> {

	fun findById(id: Short): JellyfinConnectionRow?

	fun save(row: JellyfinConnectionRow): JellyfinConnectionRow
}
