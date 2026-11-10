package xyz.ianworley.continuarr.server

import kotlin.time.Duration

data class ActiveSession(
	val id: ServerSessionId,
	val accountId: ServerAccountId,
	val itemId: ServerItemId,
	val position: Duration,
	val paused: Boolean,
	val clientName: String,
)
