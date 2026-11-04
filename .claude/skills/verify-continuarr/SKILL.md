---
name: verify-continuarr
description: Launch Continuarr locally (Spring Boot on a Testcontainers Postgres plus the Vite dev server), drive its admin web UI in Chrome through Playwright journeys, and capture screenshots, ARIA snapshots, and API side effects as proof. Use to prove a frontend or backend change works in the real app, to reproduce a UI or auth bug, or before you claim a user-facing behavior works.
---

# Verify Continuarr

The user-facing surface is the admin web UI at `http://localhost:5173`. Vite serves it and forwards `/api` to the backend on port `8080`. The REST API is the second surface, driven with `curl`. Run every command from the repo root. `control.sh` below means `.claude/skills/verify-continuarr/scripts/control.sh`.

## Launch

```sh
.claude/skills/verify-continuarr/scripts/control.sh launch
```

It needs Docker running, a JDK 17+ for Gradle, Node and npm, and Google Chrome. It starts `./gradlew bootTestRun`, runs `npm ci` in `frontend/`, and starts `npm run dev`. Each launch gets a new, empty Postgres, and Liquibase migrates it at startup.

The instance is ready when the command prints `Ready: http://localhost:5173`. By then actuator health reports `UP` and `GET /api/setup` answers through both ports. A fresh launch has no admin. Run `control.sh token` to print its setup token. The first launch on a machine compiles the backend and pulls Postgres, so it can take minutes. Later launches take seconds.

Only one instance runs per machine, because the Vite proxy targets port `8080`. Launch refuses when port `8080` or `5173` is in use, or when an earlier or concurrent run holds the run directory. Never drive an instance that this skill did not launch.

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

Each launch writes to `~/.local/state/continuarr-verify/evidence/<run-id>/`. Set `CONTINUARR_VERIFY_HOME` to move the root. The directory holds `backend.log`, `frontend.log`, `npm-ci.log`, and one directory per journey:

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
| `control.sh drive <journey>` | Runs `scripts/journeys/<journey>.mjs` and writes its evidence |
| `control.sh cleanup` | Stops what `launch` started, keeps the evidence |
