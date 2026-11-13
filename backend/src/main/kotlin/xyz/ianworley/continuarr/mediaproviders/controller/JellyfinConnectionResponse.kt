package xyz.ianworley.continuarr.mediaproviders.controller

import xyz.ianworley.continuarr.mediaproviders.service.JellyfinApiKeyState

/**
 * [url] is null until the admin saves a connection, and [name] until they name it. The API key itself is never
 * returned, only [apiKeyState].
 */
data class JellyfinConnectionResponse(val name: String?, val url: String?, val apiKeyState: JellyfinApiKeyState)
