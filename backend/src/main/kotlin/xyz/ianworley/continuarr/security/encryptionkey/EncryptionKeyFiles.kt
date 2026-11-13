package xyz.ianworley.continuarr.security.encryptionkey

import org.springframework.core.env.Environment
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.nio.file.FileAlreadyExistsException
import java.nio.file.FileSystems
import java.nio.file.Files
import java.nio.file.NoSuchFileException
import java.nio.file.Path
import java.nio.file.StandardOpenOption
import java.nio.file.attribute.FileAttribute
import java.nio.file.attribute.PosixFilePermissions
import java.security.SecureRandom
import java.util.HexFormat

internal const val ENCRYPTION_KEY_PROPERTY = "continuarr.encryption-key"
private const val DATA_DIR_PROPERTY = "continuarr.data-dir"

// Same format CONTINUARR_ENCRYPTION_KEY takes: an AES-256 key as 64 hex characters.
private const val KEY_BYTES = 32
private const val HEX_DIGITS_PER_BYTE = 2
private const val KEY_HEX_LENGTH = KEY_BYTES * HEX_DIGITS_PER_BYTE

private const val COMMITTED_FILE_NAME = "encryption.key"
private const val PENDING_FILE_NAME = "encryption.key.pending"
private const val TEMP_FILE_SUFFIX = ".tmp"
private const val POSIX_VIEW = "posix"
private const val OWNER_ONLY_FILE = "rw-------"
private const val OWNER_ONLY_DIR = "rwx------"

/**
 * The generated key in `CONTINUARR_DATA_DIR`. A new key is pending until startup confirms that no saved
 * secret predates it, and only then is it committed. Files are only ever created, never overwritten, so
 * concurrent first starts all end up on the key that was created first.
 */
internal class EncryptionKeyFiles(private val dataDir: Path) {

	val committed: Path = dataDir.resolve(COMMITTED_FILE_NAME)
	private val pending: Path = dataDir.resolve(PENDING_FILE_NAME)

	/** The committed key, or else the pending one, created if it doesn't exist yet. */
	fun loadOrCreate(): String {
		readOrNull(committed)?.let { return it }
		val pendingKey = readOrNull(pending) ?: createPending()
		// Another start may have committed the pending key, and deleted it, while this one read or created one.
		return readOrNull(committed) ?: checkNotNull(pendingKey) { "$pending disappeared while Continuarr was reading it" }
	}

	/** The pending key, unless it has already been committed or there is none. */
	fun pendingOrNull(): String? = if (Files.exists(committed)) null else readOrNull(pending)

	/** Makes [key], the pending key, the committed one. Returns false when another key got committed first. */
	fun commit(key: String): Boolean {
		val committedKey = try {
			Files.createLink(committed, pending)
			key
		} catch (_: FileAlreadyExistsException) {
			readOrNull(committed)
		} catch (_: NoSuchFileException) {
			// Another start committed this same pending key and deleted the pending file first.
			readOrNull(committed)
		}
		Files.deleteIfExists(pending)
		return committedKey == key
	}

	/** Creates the pending key unless another start already has. Null when that one is gone again. */
	private fun createPending(): String? {
		val temp = try {
			Files.createDirectories(dataDir, *ownerOnly(OWNER_ONLY_DIR))
			Files.createTempFile(dataDir, PENDING_FILE_NAME, TEMP_FILE_SUFFIX, *ownerOnly(OWNER_ONLY_FILE))
		} catch (e: IOException) {
			throw cantCreateKey(e)
		}
		try {
			val key = newKey()
			FileChannel.open(temp, StandardOpenOption.WRITE).use { channel ->
				channel.write(ByteBuffer.wrap(key.toByteArray(Charsets.US_ASCII)))
				channel.force(true)
			}
			// A hard link appears complete and never replaces an existing file, unlike a rename.
			Files.createLink(pending, temp)
			return key
		} catch (_: FileAlreadyExistsException) {
			return readOrNull(pending)
		} catch (e: IOException) {
			throw cantCreateKey(e)
		} finally {
			Files.deleteIfExists(temp)
		}
	}

	private fun cantCreateKey(cause: IOException) = IllegalStateException(
		"Can't create an encryption key in $dataDir (${cause.javaClass.simpleName}). Make CONTINUARR_DATA_DIR a " +
			"directory that the user running Continuarr can write, on a filesystem with hard links, or set " +
			"CONTINUARR_ENCRYPTION_KEY.",
		cause,
	)

	private fun readOrNull(file: Path): String? {
		val key = try {
			Files.readString(file, Charsets.US_ASCII).trim()
		} catch (_: NoSuchFileException) {
			return null
		}
		check(key.length == KEY_HEX_LENGTH && key.all { HexFormat.isHexDigit(it.code) }) {
			"$file doesn't hold a $KEY_HEX_LENGTH-character hex key. Restore it from a backup, or set CONTINUARR_ENCRYPTION_KEY."
		}
		return key
	}

	companion object {
		/** Null when `CONTINUARR_DATA_DIR` isn't set, which leaves the key to `CONTINUARR_ENCRYPTION_KEY` alone. */
		fun from(environment: Environment): EncryptionKeyFiles? =
			environment.getProperty(DATA_DIR_PROPERTY)?.takeIf { it.isNotBlank() }?.let { EncryptionKeyFiles(Path.of(it)) }
	}
}

private fun newKey(): String = HexFormat.of().formatHex(ByteArray(KEY_BYTES).also(SecureRandom()::nextBytes))

private fun ownerOnly(permissions: String): Array<FileAttribute<*>> =
	if (POSIX_VIEW in FileSystems.getDefault().supportedFileAttributeViews()) {
		arrayOf(PosixFilePermissions.asFileAttribute(PosixFilePermissions.fromString(permissions)))
	} else {
		emptyArray()
	}
