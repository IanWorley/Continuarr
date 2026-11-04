package xyz.ianworley.continuarr.server

data class ServerAccount(
	val id: ServerAccountId,
	val name: String,
	val disabled: Boolean,
)
