package xyz.ianworley.continuarr.security.service

import org.springframework.dao.DataIntegrityViolationException
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.stereotype.Service
import xyz.ianworley.continuarr.security.user.User
import xyz.ianworley.continuarr.security.user.UserRepository

private const val MIN_PASSWORD_LENGTH = 8

// bcrypt ignores everything past 72 bytes, so Spring Security refuses longer passwords.
private const val MAX_PASSWORD_BYTES = 72

// Spring Security's encode returns null only for a null password, and this one isn't null.
private const val PASSWORD_HASH_MISSING = "The password encoder returned no hash"

sealed interface SetupResult {
	data object Created : SetupResult

	data object AlreadySetUp : SetupResult

	data object WrongToken : SetupResult

	/** A blank username, or a password outside the length bcrypt accepts. */
	data object Invalid : SetupResult
}

/** First-run setup: creates the single admin, once, for whoever holds the logged setup token. */
@Service
class SetupService(
	private val users: UserRepository,
	private val setupToken: SetupToken,
	private val passwordEncoder: PasswordEncoder,
) {

	fun setupRequired(): Boolean = users.count() == 0L

	fun createAdmin(token: String, username: String, password: String): SetupResult {
		if (!setupRequired()) return SetupResult.AlreadySetUp
		if (!setupToken.matches(token)) return SetupResult.WrongToken

		val trimmedUsername = username.trim()
		val passwordBytes = password.toByteArray().size
		if (trimmedUsername.isEmpty() || password.length < MIN_PASSWORD_LENGTH || passwordBytes > MAX_PASSWORD_BYTES) {
			return SetupResult.Invalid
		}

		return try {
			users.save(User(trimmedUsername, checkNotNull(passwordEncoder.encode(password)) { PASSWORD_HASH_MISSING }))
			SetupResult.Created
		} catch (_: DataIntegrityViolationException) {
			// Another setup request won the race to app_user's single row.
			SetupResult.AlreadySetUp
		}
	}
}
