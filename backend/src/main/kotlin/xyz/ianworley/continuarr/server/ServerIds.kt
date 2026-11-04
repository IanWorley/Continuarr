package xyz.ianworley.continuarr.server

/** Opaque, and meaningful only to the [MediaServer] that supplied it. */
@JvmInline
value class ServerAccountId(val value: String)

/** Opaque, and meaningful only to the [MediaServer] that supplied it. */
@JvmInline
value class ServerLibraryId(val value: String)

/** Opaque, and meaningful only to the [MediaServer] that supplied it. */
@JvmInline
value class ServerItemId(val value: String)

/** Opaque, and meaningful only to the [MediaServer] that supplied it. */
@JvmInline
value class ServerSessionId(val value: String)
