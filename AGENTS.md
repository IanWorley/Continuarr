# Agent notes for Continuarr

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
- Each top-level package under `xyz.ianworley.continuarr` is a Spring Modulith module. Other modules may use only the types in a module's top-level package. Its subpackages are internal. A module can also limit which modules it may use, with `@ApplicationModule(allowedDependencies = [...])` on the `@PackageInfo` class in its top-level package, as in `mediaproviders/MediaProvidersModule.kt`. Add a module to that list before you use its types. `ModularityTest` fails on a violation. The planned modules are in [Architecture in `docs/plan.md`](docs/plan.md#architecture).

## Commit

Write commit messages and PR titles as Conventional Commits. Scope them `backend` or `frontend` when the change stays in one, as in `feat(backend): ...`.

## Pull requests

- Never make a PR unless the developer explicitly asks you to do so.
- Conventional commit titles, plain language: `fix(frontend): setup page no longer flashes on reload`.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- `scripts/ci_local.py` prints that attribution line. Pass `--model` and `--effort` for what it can't detect, replace any `<fill in: ...>` it leaves, and never guess a value.
- UI changes need before/after images. Motion or timing needs a short video.
- Upload PR evidence to GitHub. Never commit PR-only screenshots or assets such as `.github/pr-assets/`.
- One request is one PR. Split it only when the maintainer asks. Outside contributions follow the stricter one problem per PR rule.
- When babysitting: call `watch_pull_request` and end your turn. T3 Code wakes you on checks, comments, or conflicts. Do not poll or sleep. Verify each bot finding against the source, fix real ones, dismiss false positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.

## Open a PR

- Branch from `main`, keep the PR small, and link the issue it closes when one fits. `.github/pull_request_template.md` lays out the body.
- Run `python3 scripts/ci_local.py`, then paste everything it prints after `--- Paste everything below into the PR body ---` verbatim under `## Verification`. Don't write or edit it by hand. The table has one row per test suite. Skipped tests count in the total but not as passed. ✅ means every CI step in that suite's job passed. A failed lint step adds a line with each failed rule and its count, such as `detekt: MagicNumber ×3, LongMethod ×1`:

  | Suite | Tests passed | Result |
  |-------|--------------|--------|
  | Backend | 127/128 | ✅ |

- For a user-facing change, run the verify-continuarr skill too, and cite its run ID.
- Before you open the PR, attack it with `/interrogate` and `/blast-radius`, and fix the real findings.
- In the PR body, also show a planted failure for any new check, and list the known gaps.
- Agents never merge a PR or push to `main`.

## Documentation

Most code changes do not need an internal documentation change. Agents can read the code.

- `docs/internals/` is for architectural decisions and their reasons, constraints that span components, and implementation traps that are hard to discover from the source. Before adding a paragraph, ask what a maintainer would get wrong without it. If reading the relevant code answers the question, leave it out.
- Do not document every feature, enumerate fields or methods, narrate control flow, maintain file catalogs, or append PR summaries. Types, tests, and code already record the implementation.
- A local reason the code can't show goes in a short nearby code comment. Use an internal doc when the reasoning crosses boundaries or needs context the code cannot carry well. Link to the relevant source instead of copying it.
- When a documented decision or constraint changes, rewrite or remove the affected text. Do not append another account of the new behavior. A new internal page needs a distinct, durable reason to exist.
- `docs/user/` helps users accomplish tasks. Give each major feature a concise section explaining what it does, how to start, and anything unintuitive. A settings path is useful; descriptions of visible buttons, icons, layouts, animations, or every UI state are not. Before adding text, ask what task or decision it helps the user with.
- Keep user docs in the shipped product's voice, without implementation details or contributor tooling. Update the relevant feature section when how to use it changes. A UI tweak does not need a documentation entry, and a new control does not need its own page.
- `docs/operations/` holds maintainer setup, release, and debugging procedures. Keep instructions for operating an installed Continuarr server in the user guides.

## Plans and work artifacts

- Do not commit implementation plans, research notes, or agent scratch files. Keep temporary working material outside the worktree.
- Track active maintainer work in the GitHub issue or project item that owns it.
- A merged PR is the implementation record. Close or update its tracking item when the work lands; do not preserve a second checklist in the repository.
