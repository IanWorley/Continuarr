package xyz.ianworley.continuarr.security.user

import jakarta.persistence.Entity
import jakarta.persistence.GeneratedValue
import jakarta.persistence.GenerationType
import jakarta.persistence.Id
import jakarta.persistence.Table

// A login account; v1 has exactly one, the admin. See 0002-app-user.sql.
@Entity
@Table(name = "app_user")
class User(
	var username: String,
	var passwordHash: String,
	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	var id: Long? = null,
)
