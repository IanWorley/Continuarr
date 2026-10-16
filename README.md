# Continuarr

Sync watched movies and episodes for paired Plex and Jellyfin users. Continuarr merges watched status and resume positions in both directions. It never marks an item unwatched.

Built with:

- TanStack Start for the React application and server routing
- TanStack Query for SSR-aware data fetching and caching
- Elysia for the API
- Eden Treaty for end-to-end type-safe API calls
- Drizzle ORM with node-postgres connection pooling for the Vite/Node server and integration tests
- Tailwind CSS for styling

## Run locally

If you already use the PostgreSQL 17 Compose service, [upgrade your database](#upgrade-from-postgresql-17) before running these commands. PostgreSQL 18 uses a new volume and does not import your existing data automatically.

```bash
bun install
cp .env.example .env
docker compose up -d --wait postgres
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>. On a new installation, create the installation-owner account, then sign in to access the application.

The API is available at <http://localhost:3000/api/v1/health>.

## Self-host with Docker

Use the separate [self-hosting guide](docs/self-hosting.md) to build and run the production image with PostgreSQL 18. It covers first setup, HTTPS proxies, upgrades, and paired database and credential-key backups. `compose.yaml` remains the local development database service.

## Connect your media accounts

1. Sign in to Continuarr and choose **Sign in to Plex**. Authorize Continuarr in the Plex tab, then return to the dashboard. Continuarr checks for approval until the login expires.
2. Sign in as the Plex server owner, choose **Find Plex servers**, then choose an owned server and a reachable connection address. **Save server and import users** saves the connection and imports the owner, Home users, and users with accepted server grants. No Plex Home PIN is requested. Other users use their own server grant tokens, including Home members with a grant. A listed user without a grant remains visible but cannot sync watched status.
3. Continuarr requires Jellyfin 10.9 or later. On **Connections & sync**, enter the Jellyfin server URL and a key from Jellyfin Dashboard → API Keys. Continuarr verifies the server and imports every user returned by Jellyfin, including their complete UserDto details. Include a reverse proxy path in the URL when your server uses one. The key is encrypted in PostgreSQL and never returned by the API.
4. On **Users**, review both directories and pair the same person across Plex and Jellyfin. Each user can belong to one pairing. Missing users, disabled Jellyfin users, and Plex users without watched access stay visible but cannot start a new pairing or sync.
5. On **Users**, preview the pairing, then run sync. A run reads both libraries again and applies watched status and resume positions. Check the run result for completed updates and skipped items.
6. On **Connections & sync**, configure **Automatic user imports** for both services. One PostgreSQL setting controls the interval and enabled state, defaulting to every 60 minutes. **Refresh all users now** imports both directories immediately. Successful imports preserve user and pairing IDs; failures keep the last successful list. Watched sync remains separate and can be enabled hourly for each pairing.

Continuarr connects one Plex server and one Jellyfin server. To switch servers, disconnect the saved one on **Connections & sync**, then connect the new one. If an earlier version saved more than one server for a service, that page asks you to disconnect the extras. A disconnect keeps users, pairings, manual matches, and sync history, and pauses automatic sync for that server's pairings.

To replace expired Plex credentials, repeat the Plex login and server connection. An expired server selection must be started again. Restarting Continuarr cancels pending login and server selections. Previously saved Plex profiles and pairings remain usable; saving their server through the owner flow adopts their existing IDs and enables automatic user imports.

### Repair conflicting legacy Jellyfin keys

The first start after the directory migration groups existing Jellyfin profiles by server ID. It decrypts each profile's old key under that profile's ID and moves the shared key to a server record. If profiles for one server have different keys or URLs, the media service refuses to start and logs the affected profile IDs and leaves every row intact. Resolve which server URL and API key are correct, stop Continuarr, and run `bun scripts/repair-jellyfin-legacy.ts` with `JELLYFIN_SERVER_ID`, `JELLYFIN_URL`, and `JELLYFIN_API_KEY` supplied through your secret environment. The script verifies the key against Jellyfin and confirms the server identity before replacing credentials on those legacy profiles. It does not print the key. Restart Continuarr to complete the backfill. Keep the same `DATABASE_URL` and credential encryption key during repair.

### What sync transfers

Continuarr pairs items in this order. The first rule that finds one safe counterpart wins.

1. A saved manual match.
2. An exact shared IMDb, TMDb, or TVDb ID of the same media type, for movies and individual episodes. Conflicting IDs block the match.
3. For episodes, a shared IMDb, TMDb, or TVDb series ID plus the same season and episode number. The two shows must share at least one series ID and conflict on none. Episodes with conflicting episode IDs never match this way.

Everything else stays manual. Specials (season 0), absolute numbering, multi-episode files, and episodes without numbers never match by number. When the other server has the same show, preview reports them as ambiguous. Two candidates with the same series and numbers are also ambiguous. Continuarr never guesses from a title or filename.

Preview and each run summary break skipped episodes down by reason. An episode whose show has no series ID can match only by an episode ID. An episode whose show has a series ID but no counterpart with the same numbers is reported as missing an episode ID. Refresh the show's metadata on that server or add a manual match.

Resume positions follow the server that played the item most recently. For each matched pair, Continuarr compares the last-played times and copies the position from the later server to the other one. If either time is missing, or the two times are within one minute, Continuarr copies neither position and preview reports a position conflict. Continuarr ignores differences of 5 seconds or less between two positions. An item with no position never counts as matching one, however short. It never writes a zero position. Both servers clear an item's resume position when they mark it watched. Continuarr writes a position back to the item it marks watched: the newer position when it copies one, otherwise the item's own. So marking an item watched never clears its position, and with a position conflict neither position is copied.

Continuarr saves what each run saw and intended for every matched pair it updates. Its own writes move the servers' last-played times, Plex's to the time of the write. While neither item's watched state or position has changed since, the next run continues from that saved intent instead of those times. So a run that stops partway finishes the remaining updates, and a resolved pair stays resolved. Once a pair's updates all land, only that exact end state counts as unchanged. If you later finish, rewatch, or move either item, Continuarr plans from the current state again.

### Match content manually

Choose **Manual matching** in the navigation bar, then choose a person pairing. On smaller screens, open the navigation menu first. Browse each library by show and season, or switch to movies. Select one item on each side and choose **Save manual match**. File paths, metadata IDs, and watched states help you compare the items. Missing file paths appear as unavailable.

Each item can have one manual counterpart within that person pairing. Matches persist across restarts. To correct a choice, choose **Remove match**, confirm removal, and select another counterpart. Saving or removing a match does not change watched status. Return to Users to preview and run sync, or let an enabled scheduled sync use the saved matches. Unavailable manual matches are skipped, and their remaining items are excluded from metadata matching until you remove the saved match.

Use the **Shows** tab to match an entire show once. Select a show on each side and choose **Save show match**. Regular episodes then match by season and episode number, even when the shows have missing or different provider IDs. Episode-level manual matches take priority, followed by exact episode metadata IDs. Specials, absolute numbering, multi-episode files, duplicate coordinates, and conflicting episode IDs still need an episode-level match. The Episodes tab shows automatic show matches and episodes that need a manual choice.

Each show can have one counterpart per person pairing. Saving a show match does not change watched status. Choose **Remove show match** and confirm to return its episodes to metadata matching without changing watched status. If either show becomes unavailable, sync skips and counts the saved show match; remaining episodes use metadata matching until both shows are available again.

### Watched-state behavior

For a matched item, watched on either service means watched on both. When sync marks an item watched in Jellyfin, Jellyfin receives the Plex last-viewed date as the played date, unless that would move Jellyfin's date earlier. Jellyfin's date is read again just before the write. Plex has no API for a dated watched write, so Plex records the sync time. Continuarr does not copy play counts or ratings. The providers' mark-watched APIs may record the sync as a new play. Marking an item unwatched on one service does not clear the other service and the next sync can mark it watched again.

Automatic sync runs at most once an hour, so a copied position can lag live playback by up to an hour. A player that is still playing the item can overwrite a position that sync wrote. Before each position or watched write, Continuarr reads the item again. If its position moved since the scan, for example because someone kept watching during the run, Continuarr skips that write and counts it in the run summary. It does not mark that item watched either, because marking would clear the newer position. After marking an item watched, it reads the item once more and writes the kept position back, unless playback moved the item during the mark. The next sync compares the newer playback.

Both library scans must finish before any writes begin. A failed write stops the run and preserves its progress in the run history. Run sync again after fixing the connection; the next attempt reads current state and skips updates that are already applied. An interrupted run is reported as failed after restart. The dashboard shows the latest 50 run records.

### Deployment

Run one Continuarr server process per database. Manual and automatic sync share a coordinator inside that process; multiple processes or replicas are not supported. The hourly scheduler starts when the server receives its first request and continues while the process runs. Avoid serverless deployments that suspend idle processes. Use a reverse proxy timeout long enough for full library scans and sync writes.

Both servers must be reachable from the Continuarr host. Private LAN URLs are supported. Redirects are rejected when sending credentials; use the final server address. Plex server choices come from the authorized owner's owned resources and are checked against the selected server identity. Another user's watched operations always use that user's grant token, never the owner's token as a fallback.

### Verify the integration

```bash
bun test src/backend/media
bun run typecheck
bun run check
bun run db:check
bun run build
```

For a repeatable browser check, run `bun scripts/media-fixture.ts` and follow its printed startup instructions. It starts an isolated PostgreSQL container with a seeded Plex Home profile and two local media-server fixtures. Import the fixture Jellyfin server on Connections & sync, open Users, create a pairing, and confirm that preview shows five updates (three watched, two resume positions) and one position conflict. A repeated sync shows zero updates. One fixture show matches its regular episodes by series ID and number and reports its special as ambiguous. The other has no series ID, so its episodes stay unmatched until you match them manually.

Provider tests run local HTTP fixtures for authentication, owner server selection, grant-based directories, paginated inventories, watched updates, and resume positions. Service tests use migrated PostgreSQL and exercise encrypted persistence, pairing constraints, API authentication, retries, and automatic sync. These tests do not sign in to a real Plex or Jellyfin account.

## Installation-owner authentication

Continuarr has one administrator, separate from Plex and Jellyfin identities. The first setup at `/sign-in` claims the installation; complete it before exposing a new installation to other users. Once the owner exists, bootstrap is permanently closed. There is no registration, invitation, or additional account flow.

Passwords must contain 12–128 characters and are salted and hashed with Node's maintained `crypto.scrypt` implementation (N=131072, r=8, p=1). PostgreSQL stores the owner and server-managed sessions. Each sign-in creates a random 256-bit token; only its SHA-256 hash is stored. Sessions survive server restarts, expire after seven days without sliding renewal, and are revoked immediately on sign-out. The cookie is HttpOnly, SameSite=Strict, and Secure when the request URL uses HTTPS. Use HTTPS for deployments exposed beyond a trusted local network. Proxies must preserve the public request origin so same-origin checks succeed.

All application routes and APIs require a session except `GET /api/v1/health` and the setup/sign-in flow (`GET /sign-in`, `GET /api/v1/admin/setup`, `POST /api/v1/admin/bootstrap`, `POST /api/v1/admin/sign-in`). Static application assets remain available to render sign-in. Unauthenticated APIs return 401; page requests redirect to sign-in. Mutating requests require an `Origin` header matching the request URL, including API clients. Credentials are JSON `{ "username": "…", "password": "…" }`; keep the returned cookie for subsequent requests. Use `GET /api/v1/admin/session` to check authentication and `POST /api/v1/admin/sign-out` to revoke the current session.

## Useful commands

```bash
bun run format        # Apply formatting
bun run format:check  # Check formatting
bun run lint          # Check lint rules
bun run lint:fix      # Apply safe lint fixes
bun run check         # Check formatting and lint rules
bun run check:fix     # Apply formatting and safe lint fixes
bun run typecheck     # Check TypeScript types
bun run test:pr-size  # Test PR size label classification
bun run db:generate   # Generate a migration after schema changes
bun run db:check      # Validate migration history
bun run db:migrate    # Apply pending migrations
bun run db:push       # Push schema changes during local prototyping
bun run db:studio     # Open Drizzle Studio
bun test              # Run all tests; Docker is required
bun run test:containers # Run only Testcontainers schema tests
bun run test:watch    # Run tests in watch mode
bun run build
```

## Credential encryption

No manual key setup is required. On first startup, Continuarr generates a random 32-byte encryption key and saves it as `credential-encryption.key` in `DATA_DIRECTORY` (by default, `./data/credential-encryption.key`). Later starts reuse that file. This directory is independent of the PostgreSQL connection URL. The file is created with owner-only permissions on POSIX systems; an invalid or unreadable saved key stops startup instead of being replaced. On POSIX, saved keys must be regular files owned by the service user with no group or other permissions; symbolic links are rejected.

Persist `DATA_DIRECTORY` across application container replacements and back up the key securely alongside PostgreSQL backups. Losing or replacing the key makes existing credentials unreadable. If the key file is lost, restore it before restarting; an absent file is treated as a new installation.

`CREDENTIAL_ENCRYPTION_KEY` remains an optional override for deployments that manage their own secrets. A nonempty override must be a base64-encoded 32-byte key and takes precedence over the file without changing it. Existing deployments using this variable should keep their current value, or save that exact value without a trailing newline in the key file before removing the override. On POSIX, ensure the file is owned by the service user and set its permissions to `600`. Never commit a key or expose it through a `VITE_` variable.

`src/backend/secrets/storage.server.ts` provides the configured secret-storage boundary. Encrypt a `Secret` using the stable, unique connection ID before writing its returned string to PostgreSQL, and pass that same record ID when decrypting. Values use versioned AES-256-GCM with a fresh nonce and authenticated connection identity. Decryption returns a redacted `Secret`; call `reveal()` only when passing credentials to the media server, never in API responses or logs. Plex account tokens, selected Plex profile server tokens, and Jellyfin API keys are encrypted in the connection tables. Jellyfin server rows own current API keys; existing profile ciphertext remains only to support additive migration and repair. Plex Home PINs are used only for authentication and are not saved.

## Database

PostgreSQL is configured through `DATABASE_URL`. The default is `postgresql://continuarr:continuarr@localhost:5432/continuarr`, matching the local `compose.yaml`. The Compose credentials are for local development. Use your managed database's URL and credentials for a deployment. PostgreSQL listens only on localhost in the supplied Compose setup; its named volume persists data across container restarts.

Drizzle schemas live in `src/db/schema.ts`, and the pool factory lives in `src/db/database.ts`. PostgreSQL migration history lives in `drizzle/postgres`. The older SQLite migrations remain under `drizzle` as historical artifacts and are not applied to PostgreSQL. This change starts a fresh PostgreSQL database; it does not import accounts or pairings from SQLite or modify existing SQLite files.

Apply the committed PostgreSQL migrations before starting the application:

```bash
docker compose up -d --wait postgres
bun run db:migrate
```

Each integration-test file starts an isolated PostgreSQL container. Each test receives a fresh database with the real migrations applied. Tests cover persistent sessions, owner and pairing constraints, timestamp updates, encrypted tokens, and repeatable sync. Docker must be running for `bun test`; tests do not use the configured application database.

`DATA_DIRECTORY` controls the application credential-key location. Keep the same key across application restarts. `DATABASE_URL` accepts only `postgres:` or `postgresql:` URLs. The server uses one connection pool with up to ten connections and awaits database operations throughout authentication and sync.

### Upgrade from PostgreSQL 17

Follow these steps **before updating your checkout** from PostgreSQL 17 to 18. Keep the same Compose project name and working directory throughout. These commands use the default local database and credentials. Adapt them if you customized the service.

1. Stop the Continuarr application and any other database writers. Leave PostgreSQL 17 running. Save its Compose configuration outside the checkout so you can restart it if needed:

   ```bash
   upgrade_backup_dir="$(mktemp -d "$PWD/../continuarr-postgres17.XXXXXX")"
   cp compose.yaml "$upgrade_backup_dir/compose.postgres17.yaml"
   printf 'Keep this backup directory: %s\n' "$upgrade_backup_dir"
   ```

2. Export the database, including Drizzle's migration history. Run the remaining commands in the same shell:

   ```bash
   docker compose exec -T postgres pg_dump -U continuarr -d continuarr --format=custom > "$upgrade_backup_dir/continuarr.dump"
   docker compose exec -T postgres pg_restore --list < "$upgrade_backup_dir/continuarr.dump"
   ```

   Both commands must succeed. This exports the application database, not cluster-wide roles or other databases. Export those separately if you added them.

3. Stop PostgreSQL 17, then update your checkout to the PostgreSQL 18 version:

   ```bash
   docker compose stop postgres
   ```

4. Start PostgreSQL 18 and restore into its fresh database **before starting the application or running migrations**:

   ```bash
   docker compose up -d --wait postgres
   docker compose exec -T postgres pg_restore -U continuarr -d continuarr --exit-on-error --single-transaction < "$upgrade_backup_dir/continuarr.dump"
   bun run db:migrate
   ```

   The new `postgres18-data` volume mounts at `/var/lib/postgresql`; PostgreSQL stores its data under `18/docker`. The old `postgres-data` volume remains intact. Do not use `docker compose down -v` or delete either volume during the upgrade.

5. Start Continuarr with your existing `.env` and credential key. Verify that you can sign in and that your accounts and pairings are present before allowing normal writes. Keep the dump and PostgreSQL 17 volume until you have verified the upgrade.

If the restore fails, keep the application stopped. To restart PostgreSQL 17, first stop the PostgreSQL 18 service, then restore the saved Compose configuration to `compose.yaml` and run `docker compose up -d --wait postgres`. PostgreSQL 17 uses the original `postgres-data` volume. Do not switch back after accepting writes on PostgreSQL 18 without a plan to preserve those new writes.

## Continuous integration

GitHub Actions runs the Biome checks, type checks, unit and Testcontainers integration tests, and production build for pull requests and pushes to `main`. The autofix workflow applies Biome fixes to pull requests through [autofix.ci](https://autofix.ci); install the autofix.ci GitHub App on the repository to allow it to update pull requests.

[Renovate](https://docs.renovatebot.com/getting-started/installing-onboarding/) manages dependency updates. Install the Renovate GitHub App on the repository to enable it. Minor, patch, pin, digest, and lock-file maintenance updates are automatically squash-merged after CI passes; major updates require review.

Pull requests are automatically labeled by contributor trust and effective review size. See [CONTRIBUTING.md](CONTRIBUTING.md) for the vouch, recheck, and sizing rules.

Application routes live in `src/routes`. The Elysia API contract is defined in `src/backend/api.ts`, and `src/routes/api.$.ts` connects it to TanStack Start while exposing the isomorphic Eden client. The focused API and Eden integration tests live in `src/backend/api.test.ts`.
