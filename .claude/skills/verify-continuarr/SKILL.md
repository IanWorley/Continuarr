---
name: verify-continuarr
description: Launch Continuarr locally (Spring Boot on a Testcontainers Postgres plus the Vite dev server), drive its admin web UI in Chrome through Playwright journeys, and capture screenshots, ARIA snapshots, and API side effects as proof. Use to prove a frontend or backend change works in the real app, to reproduce a UI or auth bug, or before you claim a user-facing behavior works.
---

# Verify Continuarr

The user-facing surface is the admin web UI at `http://localhost:5173`. Vite serves it and forwards `/api` to the backend on port `8080`. The REST API is the second surface, driven with `curl`. Run every command from the repo root. `control.sh` below means `.claude/skills/verify-continuarr/scripts/control.sh`.

## Before a PR

Run `python3 scripts/ci_local.py` from the repo root first. It runs the lint, test, and build steps from `.github/workflows`, which this skill does not. Then launch, drive the journeys your change touches, and clean up.

## Launch

```sh
.claude/skills/verify-continuarr/scripts/control.sh launch
```

It needs Docker running, a JDK 17+ for Gradle, Node and npm, `curl`, `lsof`, and Google Chrome. It runs `npm ci` in `frontend/`, starts `./gradlew bootTestRun`, and starts `npm run dev`. `frontend/.nvmrc` pins the Node that CI uses. An older npm can reject the lock file, so a failed `npm ci` stops the launch before anything starts and prints the Node version next to the pin. Each launch gets a new, empty Postgres, and Liquibase migrates it at startup. Like a fresh install, a launch sets no `CONTINUARR_ENCRYPTION_KEY`, so the backend creates its own key in the run's data directory and saving a secret works. To set a key instead, export `CONTINUARR_VERIFY_ENCRYPTION_KEY`. To start with no key at all, so a save answers 503, set `CONTINUARR_VERIFY_ENCRYPTION_KEY=` (empty). Cleanup deletes the data directory with the run state.

The instance is ready when the command prints `Ready: http://localhost:5173`. By then actuator health reports `UP` and `GET /api/setup` answers through both ports. A fresh launch has no admin. Run `control.sh token` to print its setup token. The first launch on a machine compiles the backend and pulls Postgres, so it can take minutes. Later launches take seconds.

Only one instance runs per machine, because the Vite proxy targets port `8080`. Launch refuses when port `8080` or `5173` is in use, or when an earlier or concurrent run holds the run directory. Never drive an instance that this skill did not launch.

## Restart

```sh
CONTINUARR_VERIFY_RESTARTABLE=1 .claude/skills/verify-continuarr/scripts/control.sh launch
.claude/skills/verify-continuarr/scripts/control.sh restart
```

`restart` kills the backend and starts it again with `./gradlew bootRun` on the same Postgres and data directory, so saved data survives. It kills rather than stops, because a graceful shutdown closes the Postgres container with the Spring context. It needs a launch with `CONTINUARR_VERIFY_RESTARTABLE=1`, which turns off Testcontainers' reaper so Postgres outlives the backend. A restart reads `CONTINUARR_VERIFY_ENCRYPTION_KEY` afresh, so it can change or drop the key. The restarted backend appends to the same `backend.log`.

## Doctor

```sh
.claude/skills/verify-continuarr/scripts/control.sh doctor
```

Run it first whenever something looks off. It changes nothing. It checks that the recorded processes own both ports, that health and the `/api` proxy answer, and that the instance runs this checkout at the current `HEAD`. It also prints the setup status and the Node version against `frontend/.nvmrc`. A `FAIL` line names the broken check. The frontend reloads source edits by itself. The backend does not, so run `cleanup` and `launch` after a backend edit.

## Drive

[`features/README.md`](features/README.md) maps each feature to its recipe. Read it, then drive the feature your change touches:

```sh
.claude/skills/verify-continuarr/scripts/control.sh drive first-run-setup
.claude/skills/verify-continuarr/scripts/control.sh drive sign-in
```

A journey is a Playwright script in `scripts/journeys/` that drives Chrome by ARIA role and label. It fails with a non-zero exit at the first assertion that does not hold. `drive` runs `doctor` first and installs `playwright-core` into the tools directory on first use. To cover a new path, add `scripts/journeys/<feature>.mjs` that calls `runJourney` from `scripts/journey.mjs`, then add a feature file for it.

## Evidence

Each launch writes to `~/.local/state/continuarr-verify/evidence/<run-id>/`. Set `CONTINUARR_VERIFY_HOME` to move the root. The directory holds `backend.log`, `frontend.log`, `npm-ci.log`, and one directory per journey attempt, named `<journey>-<HHMMSS>` in UTC, so a rerun never mixes with an earlier attempt:

- `NN-<step>.png` is a full-page screenshot.
- `NN-<step>.aria.yaml` is the ARIA snapshot, with the page URL on its first line.
- `<observation>.json` is a side effect read back through a second path, such as the API.
- `NN-failed.*` captures the page where a journey stopped.

A proof drives the real user path in the browser, not an API shortcut or a test-only endpoint. It captures each action and the state that follows, not only the final screen. It reads the side effect back through a second view, such as `GET /api/setup` or a protected endpoint's status code. Name the run ID and the journey when you cite evidence.

## Cleanup

```sh
.claude/skills/verify-continuarr/scripts/control.sh cleanup
```

Run it after every launch, including a failed one. It stops the four processes that `launch` recorded, by PID, and skips any PID whose start time no longer matches, so a reused PID is never killed. It waits for Testcontainers' reaper to remove the containers this run recorded, and after 30 seconds it removes them by ID itself. It records only Testcontainers-labelled containers that the backend reached on localhost. Then it deletes the run state. The evidence and the tools directories stay. The Gradle daemon keeps running, because other builds share it.

## Helpers

| Command | Does |
|---|---|
| `control.sh launch` | Starts the backend and frontend, waits until both are usable |
| `control.sh doctor` | Read-only health and ownership check, non-zero on failure |
| `control.sh token` | Prints the current setup token from the backend log |
| `control.sh restart` | Restarts the backend on the same database, for a launch with `CONTINUARR_VERIFY_RESTARTABLE=1` |
| `control.sh drive <journey>` | Runs `scripts/journeys/<journey>.mjs` and writes its evidence |
| `control.sh cleanup` | Stops what `launch` started, keeps the evidence |
