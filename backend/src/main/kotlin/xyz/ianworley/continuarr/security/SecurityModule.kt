package xyz.ianworley.continuarr.security

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

// Exposes no types: nothing depends on security. It needs web only to let the SPA load before login.
@PackageInfo
@ApplicationModule(allowedDependencies = ["web"])
private class SecurityModule
