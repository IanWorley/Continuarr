---
name: continuarr-test-session
description: Verify Continuarr through its browser UI and authenticated API in an isolated Plex/Jellyfin fixture environment. Use to test requested features, reproduce regressions, and capture persisted results.
---

# Verify Continuarr

Run from the repository root. Derive acceptance checks from the user's request, then read the matching entries in [the feature map](features/README.md). Setup and login are prerequisites, not proof of the requested feature.

## Launch

1. Read `README.md` and `git status --short`. Check `bun --version` and `docker info`. Run `bun install --frozen-lockfile`. Report missing prerequisites rather than changing the machine's configuration.
2. Choose unused fixture and app ports. Defaults are `43123` and `3000`; this recipe uses `43124` and `3012` to coexist with another session. Check with `lsof -nP -iTCP:43124 -iTCP:3012 -sTCP:LISTEN`. Change the ports if occupied, never kill the existing process.
3. Create an evidence directory outside the temporary database and record the revision:

   ```bash
   VERIFY_EVIDENCE="/tmp/continuarr-verify-$(date +%Y%m%d-%H%M%S)"
   mkdir -p "$VERIFY_EVIDENCE"
   git rev-parse HEAD > "$VERIFY_EVIDENCE/revision.txt"
   git diff --stat > "$VERIFY_EVIDENCE/working-tree.txt"
   ```

4. Start the fixture in a persistent terminal:

   ```bash
   FIXTURE_PORT=43124 bun scripts/media-fixture.ts
   ```

   Wait for `Fixture running at ...` and its printed startup command. It creates a temporary PostgreSQL container, migrates it, and seeds `Alex (Home)` on `Fixture Plex`. The installation owner does not yet exist.
5. Run the printed app command in a second persistent terminal, retaining its actual `DATABASE_URL` and `CREDENTIAL_ENCRYPTION_KEY`. Append `--port 3012 --strictPort`. Use the printed `--host 127.0.0.1` when the browser can reach loopback. For a remote collaborative browser, use `--host 0.0.0.0` and the reachable network URL printed by Vite. Do not put credentials in `.env` or evidence.
6. Record both terminal session IDs, the chosen ports, browser URL, and owned container ID in the evidence notes. Wait for Vite's ready message and run Doctor. Keep one Continuarr process per database.

Use the same reachable browser origin throughout the run. Cookies are shared across ports on one hostname, so separate ports do not isolate browser sessions. Use separate browser contexts or distinct reachable hostnames when two instances must remain signed in. Do not switch to localhost unless the collaborative browser can reach it. The fixture's `127.0.0.1` server URL is resolved by the Continuarr backend, so it remains correct even when the browser uses a network address.

## Doctor

Run this read-only check first when the instance looks wrong:

```bash
curl -fsS http://127.0.0.1:3012/api/v1/health
curl -fsS http://127.0.0.1:3012/api/v1/admin/setup
curl -fsS http://127.0.0.1:43124/fixture-state
lsof -nP -iTCP:3012 -iTCP:43124 -sTCP:LISTEN
```

Require health `{"application":"Continuarr","status":"ok"}` and listeners belonging to the recorded sessions. A fresh database returns `{"configured":false}`. Compare the checkout revision and working diff with the evidence notes. After browser sign-in, read `/api/v1/admin/session` using same-origin browser `fetch`; require `{"authenticated":true}`. Do not print cookies.

A configured owner on an allegedly fresh run means the wrong database or a reused session. Investigate. Never reset the owner or truncate tables to make setup available.

## Drive

Use T3 Code's collaborative preview when available. Call `preview_status`, then `preview_open` if needed. Open a separate tab for a separate fixture run. Use `preview_snapshot` before interaction, `preview_type` with `clear:true` for labelled inputs and `preview_click` for buttons. For native selects, focus the select and use `preview_press` keys, or set its DOM value and dispatch a bubbling `change` event through `preview_evaluate`. Discover tool schemas in the current session; do not guess argument shapes. Prefer roles and accessible names from snapshots.

If T3 preview tools are absent, use the available browser automation. If `preview_open` reports that automation is unavailable, document that limitation before using another browser. API-only verification does not prove the UI.

Read the relevant recipe:

- [Owner setup and login](features/owner.md).
- [Server connections and directory imports](features/connections.md).
- [User pairing and watched sync](features/users.md).
- [Manual media matching](features/matching.md).

API checks supplement browser actions. Mutations require an `Origin` header matching the app origin and the owner session cookie. Browser same-origin `fetch` supplies both. Read `/api/v1/media/state` for saved pairings, schedules, and runs, and `/api/v1/media/jellyfin/directory` for server and directory results. Do not use internal setters or test-only endpoints as the action being proved.

## Evidence

Save action notes, semantic snapshots, screenshots, and redacted API results under `$VERIFY_EVIDENCE`. Use `preview_snapshot` with `save:true`, then copy its returned screenshot path into that directory. Capture the initiating action and the resulting state, not just a final screen. Reload after a save and compare an authenticated API read to the UI.

For watched sync, save `/fixture-state` before preview, after preview, and after each run. Preview must leave watched IDs unchanged. The fixture mocks only external media-server HTTP boundaries; the browser, routes, repository, encryption, migrations, and PostgreSQL are real. Never exercise watched writes against real Plex/Jellyfin users. Real owner OAuth is a separate read-only check and requires an authorized account.

For timing and migration regressions, supplement the user path with:

```bash
bun test src/backend/media/service.test.ts
bun test src/db/schema.container.test.ts
```

The service suite deterministically covers both import/sync overlap orders and migrated Jellyfin access before the first successful import. These checks do not replace browser proof that the user's controls are enabled and usable.

Record expected result, actual result, evidence path, and pass/fail/blocked for each acceptance check. A passing build or unrelated feature is not evidence for the requested behavior.

## Cleanup

For a disposable run created solely to prove this skill, stop the app terminal first, then send SIGINT to the fixture terminal using their recorded session IDs. The fixture stops its own PostgreSQL container. Confirm the two owned ports no longer listen and that the owned container is stopped. Never kill by process name or run broad Docker cleanup commands.

Leave pre-existing sessions untouched. If the user wants the new session for further testing, leave both terminals running and report their IDs, browser URL, and test-owner credentials. Obtain permission before discarding a session that the user is retaining or whose data is not disposable.

After cleanup, confirm the evidence files still exist. Do not delete the evidence directory.

## Helpers

`scripts/media-fixture.ts` is the existing fixture runner, invoked with `FIXTURE_PORT=43124 bun scripts/media-fixture.ts`. `FIXTURE_PORT` controls its HTTP port; PostgreSQL gets a separate dynamically assigned port. This skill adds no alternate server launcher.

Use `/maintain-verification-skill` when routes, controls, or fixture behavior change. Update the feature map from code and live observations.
