package xyz.ianworley.continuarr

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class ContinuarrApplication

fun main(args: Array<String>) {
	runApplication<ContinuarrApplication>(*args)
}
