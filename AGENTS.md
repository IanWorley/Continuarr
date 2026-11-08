# Agent notes for Continuarr

Read this before you change the repo. It lists what the docs and failing checks don't tell you up front.

## Find the commands

- [Setup in `docs/plan.md`](docs/plan.md#setup) lists the prerequisites and the commands to build, run, and test.
- `.github/workflows/backend.yml` and `.github/workflows/frontend.yml` are the exact checks a PR must pass. `python3 scripts/ci_local.py` runs the same steps on your machine, prints where each step's logs and reports are, and stops at the first failure. Pass `backend` or `frontend` to run one job.
- Before you claim a user-facing change works, follow `.claude/skills/verify-continuarr/SKILL.md` to launch the real app, drive it, and keep the evidence. It works in any agent, not only Claude Code. Only one instance runs per machine, so launch refuses when port 8080 or 5173 is in use.

## Gotchas

- Backend tests need Docker running. Testcontainers starts Postgres for `./gradlew test` and `./gradlew bootTestRun`.
- `backend/openapi.json` is committed, and the frontend generates its API types from it. After you change the API, `OpenApiSpecTest` fails. Review the spec change, run `cp build/openapi.json openapi.json` in `backend/`, then run `npm ci && npm run typecheck` in `frontend/`.
- `./gradlew bootJar` packages `frontend/dist` and fails without it. Run `npm ci && npm run build` in `frontend/` first. `test` and `bootTestRun` don't need Node.
- List each new changeset from `backend/src/main/resources/db/changelog/changes/` in `db.changelog-master.yaml`, or Liquibase never runs it. Never edit a merged changeset. Add a new one. Liquibase rejects a changed checksum, so the app fails to start on the database a `docker compose up` install keeps. CI can't catch this, because tests start a fresh Postgres every run.
- The Spring Security Kotlin DSL has no `spa()`. In `SecurityConfig.kt`, keep `http.csrf { it.spa() }` as its own call outside the `http { }` block.
- Each top-level package under `xyz.ianworley.continuarr` is a Spring Modulith module. Other modules may use only the types in a module's top-level package. Its subpackages are internal. A module can also limit which modules it may use, with `@ApplicationModule(allowedDependencies = [...])` on the `@PackageInfo` class in its top-level package, as in `jellyfin/JellyfinModule.kt`. Add a module to that list before you use its types. `ModularityTest` fails on a violation. The planned modules are in [Architecture in `docs/plan.md`](docs/plan.md#architecture).

## Commit

Write commit messages and PR titles as Conventional Commits. Scope them `backend` or `frontend` when the change stays in one, as in `feat(backend): ...`.

## Open a PR

- Verify in two parts. Run `python3 scripts/ci_local.py` for the lint, test, and build steps CI runs. For a user-facing change, then run the verify-continuarr skill to drive the real app. Neither covers the other.
- Paste the table the script prints at the end into the PR description under `## Verification`. It has one row per CI step:

  | Step | Command | Result |
  |------|---------|--------|
  | Backend lint (detekt) | `./gradlew detektMain detektTest` | pass |
  | Frontend test | `npm test` | pass |
