package xyz.ianworley.continuarr.web

import org.slf4j.LoggerFactory
import org.springframework.boot.context.event.ApplicationReadyEvent
import org.springframework.context.event.EventListener
import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.HexFormat

// Hex-encoded, so the printed token is twice this many characters.
private const val SETUP_TOKEN_BYTES = 16

private val log = LoggerFactory.getLogger(SetupToken::class.java)

/**
 * Proves whoever runs first-run setup can read the server logs, so a stranger who reaches
 * the port first can't claim the admin account. Kept in memory only: each restart before
 * setup prints a new token.
 */
@Component
class SetupToken(private val adminAccounts: AdminAccountRepository) {

	internal val value: String = HexFormat.of().formatHex(ByteArray(SETUP_TOKEN_BYTES).also(SecureRandom()::nextBytes))

	fun matches(candidate: String): Boolean = MessageDigest.isEqual(value.toByteArray(), candidate.toByteArray())

	@EventListener(ApplicationReadyEvent::class)
	fun logIfSetupPending() {
		if (!adminAccounts.exists()) {
			log.warn("No admin account yet. Create one with POST {} using setup token {}", SETUP_PATH, value)
		}
	}
}
