package xyz.ianworley.continuarr.mediaproviders

import kotlin.time.Duration

data class ActiveSession(
	val id: ServerSessionId,
	val accountId: ServerAccountId,
	val itemId: ServerItemId,
	val position: Duration,
	val paused: Boolean,
	val clientName: String,
)
