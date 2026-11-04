# Agent notes for Continuarr

Read this before you change the repo. It lists what the docs and failing checks don't tell you up front.

## Find the commands

- [Setup in `docs/plan.md`](docs/plan.md#setup) lists the prerequisites and the commands to build, run, and test.
- `.github/workflows/backend.yml` and `.github/workflows/frontend.yml` are the exact checks a PR must pass. Run the ones for the paths you touched.

## Gotchas

- Backend tests need Docker running. Testcontainers starts Postgres for `./gradlew test` and `./gradlew bootTestRun`.
- When a backend test fails, Gradle's console shows only the exception type and line. Read the message in `backend/build/reports/tests/test/index.html`.
- `backend/openapi.json` is committed, and the frontend generates its API types from it. After you change the API, `OpenApiSpecTest` fails. Review the spec change, run `cp build/openapi.json openapi.json` in `backend/`, then run `npm run typecheck` in `frontend/`.
- `./gradlew bootJar` packages `frontend/dist` and fails without it. Run `npm ci && npm run build` in `frontend/` first. `test` and `bootTestRun` don't need Node.
- The Spring Security Kotlin DSL has no `spa()`. In `SecurityConfig.kt`, keep `http.csrf { it.spa() }` as its own call outside the `http { }` block.
- Each top-level package under `xyz.ianworley.continuarr` is a Spring Modulith module. Other modules may use only the types in a module's top-level package. Its subpackages are internal. `ModularityTest` fails on a violation. The planned modules are in [Architecture in `docs/plan.md`](docs/plan.md#architecture).

## Commit

Write commit messages and PR titles as Conventional Commits. Scope them `backend` or `frontend` when the change stays in one, as in `feat(backend): ...`.
