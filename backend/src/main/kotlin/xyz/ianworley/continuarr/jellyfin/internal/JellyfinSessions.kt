package xyz.ianworley.continuarr.jellyfin.internal

import com.fasterxml.jackson.annotation.JsonProperty
import xyz.ianworley.continuarr.server.ActiveSession
import xyz.ianworley.continuarr.server.ServerAccountId
import xyz.ianworley.continuarr.server.ServerItemId
import xyz.ianworley.continuarr.server.ServerSessionId
import kotlin.time.Duration.Companion.nanoseconds

internal const val SESSIONS_PATH = "/Sessions"

private const val NANOS_PER_TICK = 100

data class SessionDto(
	@JsonProperty("Id") val id: String,
	@JsonProperty("UserId") val userId: String,
	@JsonProperty("Client") val client: String,
	@JsonProperty("PlayState") val playState: PlayStateDto,
	@JsonProperty("NowPlayingItem") val nowPlayingItem: NowPlayingItemDto? = null,
)

data class NowPlayingItemDto(@JsonProperty("Id") val id: String)

data class PlayStateDto(
	@JsonProperty("IsPaused") val isPaused: Boolean,
	@JsonProperty("PositionTicks") val positionTicks: Long? = null,
)

fun SessionDto.toActiveSessionOrNull(): ActiveSession? {
	val item = nowPlayingItem ?: return null
	val ticks = playState.positionTicks?.takeIf { it >= 0 } ?: return null
	return ActiveSession(
		id = ServerSessionId(id),
		accountId = ServerAccountId(userId),
		itemId = ServerItemId(item.id),
		position = ticks.nanoseconds * NANOS_PER_TICK,
		paused = playState.isPaused,
		clientName = client,
	)
}
