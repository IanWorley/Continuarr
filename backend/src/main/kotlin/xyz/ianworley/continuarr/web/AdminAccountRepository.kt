package xyz.ianworley.continuarr.web

import org.springframework.jdbc.core.simple.JdbcClient
import org.springframework.stereotype.Repository

data class AdminAccount(val username: String, val passwordHash: String)

// The single admin row created by first-run setup; see 0002-admin-account.sql.
@Repository
class AdminAccountRepository(private val jdbcClient: JdbcClient) {

	fun exists(): Boolean = jdbcClient
		.sql("select exists(select 1 from admin_account)")
		.query(Boolean::class.javaObjectType)
		.single()

	fun findByUsername(username: String): AdminAccount? = jdbcClient
		.sql("select username, password_hash from admin_account where username = :username")
		.param("username", username)
		.query { rs, _ -> AdminAccount(rs.getString("username"), rs.getString("password_hash")) }
		.optional()
		.orElse(null)

	/** Throws [org.springframework.dao.DuplicateKeyException] if an admin already exists. */
	fun create(account: AdminAccount) {
		jdbcClient
			.sql("insert into admin_account (username, password_hash) values (:username, :passwordHash)")
			.param("username", account.username)
			.param("passwordHash", account.passwordHash)
			.update()
	}
}
