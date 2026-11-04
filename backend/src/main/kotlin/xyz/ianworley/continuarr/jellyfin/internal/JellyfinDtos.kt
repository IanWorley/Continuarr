package xyz.ianworley.continuarr.jellyfin.internal

import com.fasterxml.jackson.annotation.JsonProperty
import xyz.ianworley.continuarr.server.LibraryKind
import xyz.ianworley.continuarr.server.ServerAccount
import xyz.ianworley.continuarr.server.ServerAccountId
import xyz.ianworley.continuarr.server.ServerLibrary
import xyz.ianworley.continuarr.server.ServerLibraryId

// Each DTO holds only the fields Continuarr reads; Jackson 3 ignores the rest.

data class UserDto(
	@JsonProperty("Id") val id: String,
	@JsonProperty("Name") val name: String,
	@JsonProperty("Policy") val policy: UserPolicyDto,
)

data class UserPolicyDto(@JsonProperty("IsDisabled") val isDisabled: Boolean)

data class VirtualFolderDto(
	@JsonProperty("ItemId") val itemId: String,
	@JsonProperty("Name") val name: String,
	/** Absent for a mixed library. */
	@JsonProperty("CollectionType") val collectionType: String? = null,
)

data class SystemInfoDto(
	@JsonProperty("ServerName") val serverName: String,
	@JsonProperty("Version") val version: String,
)

private val LIBRARY_KINDS = mapOf(
	"movies" to LibraryKind.MOVIES,
	"tvshows" to LibraryKind.SHOWS,
)

fun UserDto.toServerAccount(): ServerAccount = ServerAccount(ServerAccountId(id), name, policy.isDisabled)

/** Null for a library Continuarr doesn't sync, such as music or a mixed library. */
fun VirtualFolderDto.toServerLibraryOrNull(): ServerLibrary? =
	collectionType?.let(LIBRARY_KINDS::get)?.let { ServerLibrary(ServerLibraryId(itemId), name, it) }
