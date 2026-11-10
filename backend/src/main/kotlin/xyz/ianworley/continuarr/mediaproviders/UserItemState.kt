package xyz.ianworley.continuarr.mediaproviders

import java.time.Instant
import kotlin.time.Duration

data class UserItemState(
	val itemId: ServerItemId,
	val played: Boolean,
	val resumePosition: Duration,
	val playCount: Int,
	val lastPlayedAt: Instant?,
)
