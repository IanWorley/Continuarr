package xyz.ianworley.continuarr.server

// Opaque and unvalidated: only the MediaServer that supplied an ID knows its format.

@JvmInline
value class ServerAccountId(val value: String)

@JvmInline
value class ServerLibraryId(val value: String)

@JvmInline
value class ServerItemId(val value: String)

@JvmInline
value class ServerSessionId(val value: String)
