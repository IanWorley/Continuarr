package xyz.ianworley.continuarr.mediaproviders

import org.springframework.modulith.ApplicationModule
import org.springframework.modulith.PackageInfo

// Other modules see only this package: MediaServer and the shared model. Inside, calls flow
// controller → service → provider → this package.
@PackageInfo
@ApplicationModule(allowedDependencies = [])
private class MediaProvidersModule
