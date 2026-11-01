# Alpine images ship busybox wget, which the Compose healthcheck uses.
ARG JAVA_VERSION=25

FROM eclipse-temurin:${JAVA_VERSION}-jdk-alpine AS build
WORKDIR /workspace
COPY gradlew settings.gradle.kts build.gradle.kts ./
COPY gradle gradle
COPY src src
# Tests need Docker for Testcontainers, so they run outside the image build.
RUN --mount=type=cache,target=/root/.gradle ./gradlew bootJar --no-daemon

FROM eclipse-temurin:${JAVA_VERSION}-jre-alpine
RUN addgroup -S continuarr && adduser -S continuarr -G continuarr
USER continuarr
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
