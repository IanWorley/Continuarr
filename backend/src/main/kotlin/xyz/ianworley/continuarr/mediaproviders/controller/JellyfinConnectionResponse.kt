package xyz.ianworley.continuarr.mediaproviders.controller

import xyz.ianworley.continuarr.mediaproviders.service.JellyfinApiKeyState

/** [url] is null until the admin saves a connection. The API key itself is never returned, only [apiKeyState]. */
data class JellyfinConnectionResponse(val url: String?, val apiKeyState: JellyfinApiKeyState)
