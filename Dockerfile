# Builds the frontend, packages it into the Spring Boot jar, and runs the jar.
# Alpine images ship busybox wget, which the Compose healthcheck uses.
ARG JAVA_VERSION=25
# Keep in step with frontend/.nvmrc.
ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-alpine AS frontend
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
# The build generates API types from the backend's committed spec.
COPY backend/openapi.json ../backend/openapi.json
COPY frontend ./
RUN npm run build

FROM eclipse-temurin:${JAVA_VERSION}-jdk-alpine AS build
WORKDIR /workspace/backend
COPY backend/gradlew backend/settings.gradle.kts backend/build.gradle.kts ./
COPY backend/gradle gradle
COPY backend/src src
# bootJar packages ../frontend/dist, so mirror the repo layout.
COPY --from=frontend /workspace/frontend/dist ../frontend/dist
# Tests need Docker for Testcontainers, so they run outside the image build.
RUN --mount=type=cache,target=/root/.gradle ./gradlew bootJar --no-daemon

FROM eclipse-temurin:${JAVA_VERSION}-jre-alpine
# The app user must own /data before a volume mounts there, or Docker gives the new volume to root.
RUN addgroup -S continuarr && adduser -S continuarr -G continuarr \
	&& mkdir -m 700 /data && chown continuarr:continuarr /data
ENV CONTINUARR_DATA_DIR=/data
USER continuarr
WORKDIR /app
COPY --from=build /workspace/backend/build/libs/*.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
