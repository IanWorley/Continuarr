package xyz.ianworley.continuarr

import org.springframework.boot.fromApplication
import org.springframework.boot.with

// Entry point for `./gradlew bootTestRun`: the real app plus a Testcontainers Postgres.
fun main(args: Array<String>) {
	fromApplication<ContinuarrApplication>().with(TestcontainersConfiguration::class).run(*args)
}
