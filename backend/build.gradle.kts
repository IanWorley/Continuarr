plugins {
	kotlin("jvm") version "2.3.21"
	kotlin("plugin.spring") version "2.3.21"
	kotlin("plugin.jpa") version "2.3.21"
	id("org.springframework.boot") version "4.1.2"
	id("io.spring.dependency-management") version "1.1.7"
	// 2.0.0-alpha.3 is the release built against Kotlin 2.3.21; detekt must match the compiler in use.
	id("dev.detekt") version "2.0.0-alpha.3"
}

group = "xyz.ianworley"
version = "0.0.1-SNAPSHOT"

java {
	toolchain {
		languageVersion = JavaLanguageVersion.of(25)
	}
}

repositories {
	mavenCentral()
}

extra["springModulithVersion"] = "2.1.1"

dependencies {
	implementation("org.springframework.boot:spring-boot-starter-actuator")
	implementation("org.springframework.boot:spring-boot-starter-data-jpa")
	implementation("org.springframework.boot:spring-boot-starter-liquibase")
	implementation("org.springframework.boot:spring-boot-starter-security")
	implementation("org.springframework.boot:spring-boot-starter-webmvc")
	implementation("org.jetbrains.kotlin:kotlin-reflect")
	implementation("org.springdoc:springdoc-openapi-starter-webmvc-api:3.2.0")
	implementation("org.springframework.modulith:spring-modulith-starter-core")
	implementation("tools.jackson.module:jackson-module-kotlin")
	// springdoc reads Kotlin nullability through Jackson 2, which marks non-null fields as required in the spec.
	runtimeOnly("com.fasterxml.jackson.module:jackson-module-kotlin")
	runtimeOnly("org.postgresql:postgresql")
	testImplementation("org.jetbrains.kotlin:kotlin-test-junit5")
	testImplementation("org.springframework.boot:spring-boot-starter-security-test")
	testImplementation("org.springframework.boot:spring-boot-starter-webmvc-test")
	testImplementation("org.springframework.boot:spring-boot-testcontainers")
	testImplementation("org.springframework.modulith:spring-modulith-starter-test")
	testImplementation("org.testcontainers:testcontainers-postgresql")
	testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

dependencyManagement {
	imports {
		mavenBom("org.springframework.modulith:spring-modulith-bom:${property("springModulithVersion")}")
	}
}

kotlin {
	compilerOptions {
		freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
	}
}

// Hibernate proxies entities, so they can't be Kotlin's default final classes.
allOpen {
	annotation("jakarta.persistence.Entity")
	annotation("jakarta.persistence.MappedSuperclass")
	annotation("jakarta.persistence.Embeddable")
}

detekt {
	config.setFrom("detekt.yml")
	buildUponDefaultConfig = false
}

tasks.withType<Test> {
	useJUnitPlatform()
	// OpenApiSpecTest compares against it, so editing it must rerun the tests.
	inputs.file("openapi.json")
}

// The jar ships the built frontend as static resources. Gradle doesn't run Node, so tests and
// bootTestRun stay Node-free: build frontend/ first (the Dockerfile does), then bootJar.
val frontendDist = layout.projectDirectory.dir("../frontend/dist")

tasks.bootJar {
	from(frontendDist) { into("BOOT-INF/classes/static") }
	doFirst {
		check(frontendDist.file("index.html").asFile.exists()) {
			"No frontend build in ${frontendDist.asFile}; run `npm ci && npm run build` in frontend/ first."
		}
	}
}
