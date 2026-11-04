package xyz.ianworley.continuarr.jellyfin

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

@PackageInfo
@ApplicationModule(allowedDependencies = ["server"])
private class JellyfinModule
