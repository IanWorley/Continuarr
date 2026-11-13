package xyz.ianworley.continuarr.mediaproviders.controller

import xyz.ianworley.continuarr.mediaproviders.provider.plex.PlexConnectionSource
import xyz.ianworley.continuarr.mediaproviders.service.PlexTokenState

/** [url] and [source] are null until a connection is saved. The token itself is never returned, only [tokenState]. */
data class PlexConnectionResponse(val url: String?, val source: PlexConnectionSource?, val tokenState: PlexTokenState)
