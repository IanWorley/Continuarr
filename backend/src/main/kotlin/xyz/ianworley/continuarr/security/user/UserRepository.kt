package xyz.ianworley.continuarr.security.user

import org.springframework.data.repository.CrudRepository

interface UserRepository : CrudRepository<User, Long> {

	fun findByUsername(username: String): User?
}
