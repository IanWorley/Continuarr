package xyz.ianworley.continuarr

import org.springframework.modulith.core.ApplicationModules
import kotlin.test.Test

// Static analysis only: no Spring context or database needed.
class ModularityTest {

	@Test
	fun `modules only depend on each other's public API`() {
		ApplicationModules.of(ContinuarrApplication::class.java).verify()
	}
}
