---
name: continuarr-test-session
description: Verify the user's requested Continuarr change or feature in the running app. Set up an isolated environment, create a test owner, and sign in as needed, then exercise the requested behavior and report evidence. Use when asked to test the ask, verify a change, or check that a feature works.
---

# Test the requested Continuarr behavior

Test the user's original request in the running app. Setup and login are prerequisites, not the completion criteria. Run commands from the repository root.

## Define what must work

Read the current request and relevant conversation context. Identify the requested behavior, the action that triggers it, and the observable expected result. Inspect the relevant implementation or diff to locate the workflow, but derive the expected behavior from the user's request.

Turn the request into a short set of concrete acceptance checks. Ask for clarification only when the expected behavior cannot be inferred. Keep the checks focused on the ask rather than running an unrelated tour of the app.

## Start the test environment

1. Check `git status --short` and read the local startup instructions in `README.md`. Check that Bun and Docker are available and that `docker info` succeeds. If a prerequisite is missing, report it instead of changing the machine's configuration.
2. Run `bun install --frozen-lockfile` to install the committed dependencies.
3. Start the existing fixture runner in a persistent terminal:

   ```bash
   bun scripts/media-fixture.ts
   ```

   Wait for `Fixture running at ...` and its application startup command. The runner creates an isolated PostgreSQL container, applies migrations, and seeds a Plex profile. It leaves the installation owner unconfigured. Keep this process running for the entire test session.

4. In another persistent terminal, run the printed startup command with `--strictPort` appended. Copy its actual `DATABASE_URL` and `CREDENTIAL_ENCRYPTION_KEY` values, since the database port changes between runs. Keep these values in the process environment, without writing them to `.env`.
5. Record the app URL and both terminal session identifiers. Use the URL printed by Vite consistently, including the same hostname. Wait for `GET /api/v1/health` to succeed, then verify that `GET /api/v1/admin/setup` returns `{"configured":false}`.

The default app port is `3000`. The fixture server uses `43123`. If the app port is occupied, choose a free port and append `--port <port>` to the startup command. If the fixture port is occupied, identify the process and reuse it only if it belongs to this task and its state is suitable. Otherwise report the conflict. Do not kill unrelated processes.

This environment has seeded media data but no owner account. If the feature specifically needs an empty media library or real provider authentication, inspect `scripts/media-fixture.ts` and establish the required test data before claiming that the fixture covers it.

## Create the owner and sign in

Use these credentials only in the isolated local fixture environment:

- Username: `continuarr-test`
- Password: `Continuarr-local-test-2026!`

Continuarr supports one installation owner, separate from Plex and Jellyfin accounts. It has no additional-user registration flow.

1. Use the available browser automation. In T3 Code, call `preview_status` first and `preview_open` if no automation-capable preview is attached. Use snapshots to locate form fields and buttons.
2. Open `<app-url>/sign-in` and verify that the heading says **Set up Continuarr**.
3. Fill **Username** and **Password**, then click **Create owner and sign in**. This action creates the owner and signs in automatically.
4. Verify that the browser reaches `/`, shows the **Continuarr** heading and **Sign out** button, and displays no authentication error. Reload the page to confirm that the session persists.
5. If the ask concerns returning-user login, click **Sign out**. Open `/sign-in`, confirm **Sign in to Continuarr**, and sign in with the same credentials. Otherwise continue directly to the requested feature.

If setup reports `configured: true`, confirm which database the app is using. Reuse the known test owner only when resuming this task's environment. For a genuinely fresh session, start a new isolated fixture environment. Never reset an existing owner, truncate tables, delete data, or remove Docker volumes to make bootstrap available without the user's permission.

If browser automation is unavailable, report that login through the UI remains unverified. API authentication alone does not establish a session in the user's browser. For API checks, bootstrap and sign-in accept JSON `{ "username": "…", "password": "…" }`. Mutations require an `Origin` header matching the app origin, and subsequent authenticated requests require the returned session cookie. `GET /api/v1/admin/session` returns `{"authenticated":true}` for a valid session.

## Test the requested feature

For each acceptance check, prepare the required data, perform the user's action through the app, and compare the observed result with the expected result. Capture relevant browser snapshots or screenshots. Check persisted state or API results when the visible UI alone cannot prove the behavior.

Cover error paths or boundary cases when they are part of the ask. Successful startup, login, a passing build, or an unrelated sync check does not prove that the requested feature works.

If a check fails, record the reproduction steps, expected result, actual result, and relevant errors. When implementing a change is already authorized, fix the failure and rerun the affected check. For a testing-only request, report the finding without changing application code. If a dependency blocks a check, mark it blocked rather than passed.

Only stop after setup when the user explicitly asks for setup alone.

For media pairing or sync checks, use the existing local fixtures:

- Jellyfin URL: `http://127.0.0.1:43123/jellyfin`
- Jellyfin username: `alex`
- Jellyfin password: `fixture-password`
- Seeded Plex profile: `Alex (Home)` on `Fixture Plex`

When the ask involves pairing or sync, connect the fixture Jellyfin account and pair it with the seeded Plex profile. On a fresh fixture, preview should show two updates. Run sync, then repeat it and expect zero updates. Inspect `http://127.0.0.1:43123/fixture-state` to confirm that Plex contains watched IDs `1` and `2`, and Jellyfin contains `j1` and `j2`. These fixtures do not exercise real Plex sign-in.

## Report the result

Lead with whether the requested behavior passed, failed, or remains blocked. List each acceptance check with its expected result, observed result, and evidence. State any unverified behavior explicitly.

Include the app URL and local test-owner credentials when handing off the running session. Identify the running terminal sessions so the user or a later agent can resume it. Leave them running when the user wants to test features.

The fixture database is temporary. Stopping the fixture runner also stops its database container. Obtain permission before discarding a session's data, and never use a broad Docker cleanup command.
