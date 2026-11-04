package xyz.ianworley.continuarr.server

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

// Adapters such as plex and jellyfin depend on server, never the reverse.
@PackageInfo
@ApplicationModule(allowedDependencies = [])
private class ServerModule
