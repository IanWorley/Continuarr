package xyz.ianworley.continuarr.web

import xyz.ianworley.continuarr.jellyfin.JellyfinField

data class JellyfinConnectionProblem(val invalidFields: List<JellyfinField>)
