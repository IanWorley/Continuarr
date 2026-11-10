package xyz.ianworley.continuarr.mediaproviders.controller

import xyz.ianworley.continuarr.mediaproviders.service.JellyfinField

data class JellyfinConnectionProblem(val invalidFields: List<JellyfinField>)
