package xyz.ianworley.continuarr.mediaproviders

data class ServerAccount(
	val id: ServerAccountId,
	val name: String,
	val disabled: Boolean,
)
