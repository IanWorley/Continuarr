# Continuarr

Sync watched movies and episodes between a Plex profile and a Jellyfin user, including managed and PIN-protected Plex Home profiles. Continuarr merges watched status in both directions. It never marks an item unwatched.

Built with:

- TanStack Start for the React application and server routing
- TanStack Query for SSR-aware data fetching and caching
- Elysia for the API
- Eden Treaty for end-to-end type-safe API calls
- Drizzle ORM with node-postgres connection pooling for the Vite/Node server and integration tests
- Tailwind CSS for styling

## Run locally

```bash
bun install
cp .env.example .env
docker compose up -d --wait postgres
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>. On a new installation, create the installation-owner account, then sign in to access the application.

The API is available at <http://localhost:3000/api/v1/health>.

## Connect your media accounts

1. Sign in to Continuarr and choose **Link Plex account**. Authorize Continuarr in the Plex tab, then return to the dashboard. Continuarr checks for approval until the login expires.
2. Select the linked Plex account and the owner or a Plex Home profile. Enter the profile PIN when required. Choose an accessible Plex server and connection address, then save the profile. Repeat for each family member.
3. Enter the Jellyfin server URL and that person's Jellyfin username and password. Include a reverse proxy path, such as `https://media.example/jellyfin`, when your server uses one. Continuarr saves the returned user token and discards the password.
4. Pair the saved Plex profile with the saved Jellyfin user. Each profile can belong to one pairing, so a shared profile cannot accidentally merge two people's histories.
5. Preview the pairing, then run sync. A run reads both libraries again and applies the current watched-state union. Check the run result for completed updates and skipped items.
6. Optionally enable hourly sync for each pairing. Keep the Continuarr server running. Automatic sync is off by default.

To replace expired credentials, repeat the relevant login and profile connection. Continuarr recognizes the same server and user identities and updates their credentials without changing the pairing. An expired Plex selection must be started again. Restarting Continuarr cancels pending login and profile selections.

### What sync transfers

Movies and individual episodes match by an exact shared IMDb, TMDb, or TVDb identifier of the same media type. Continuarr skips missing identifiers, duplicate matches, and conflicting identifiers. It does not guess from a title, filename, or episode number. Libraries without shared episode identifiers may have unmatched episodes; inspect the preview counts before enabling automatic sync.

For a matched item, watched on either service means watched on both. Continuarr does not copy historical watch timestamps, play counts, ratings, or playback positions. The providers' mark-watched APIs may record the sync as a new play. Marking an item unwatched on one service does not clear the other service and the next sync can mark it watched again.

Both library scans must finish before any writes begin. A failed write stops the run and preserves its progress in the run history. Run sync again after fixing the connection; the next attempt reads current state and skips items already watched. An interrupted run is reported as failed after restart. The dashboard shows the latest 50 run records.

### Deployment

Run one Continuarr server process per database. Manual and automatic sync share a coordinator inside that process; multiple processes or replicas are not supported. The hourly scheduler starts when the server receives its first request and continues while the process runs. Avoid serverless deployments that suspend idle processes. Use a reverse proxy timeout long enough for full library scans and sync writes.

Both servers must be reachable from the Continuarr host. Private LAN URLs are supported. Redirects are rejected when sending credentials; use the final server address. Plex server choices come from the selected profile's accessible resources and are checked against the selected server identity. No Plex Home profile uses the owner's token as a fallback.

### Verify the integration

```bash
bun test src/backend/media
bun run typecheck
bun run check
bun run db:check
bun run build
```

For a repeatable browser check, run `bun scripts/media-fixture.ts` and follow its printed startup instructions. It starts an isolated PostgreSQL container with a seeded Plex Home profile and two local media-server fixtures. Connect the fixture Jellyfin user in the dashboard, create a pairing, and confirm that preview shows two updates and a repeated sync shows zero.

Provider tests run local HTTP fixtures for authentication, profile selection, paginated inventories, and watched updates. Service tests use migrated PostgreSQL and exercise encrypted persistence, pairing constraints, API authentication, retries, and automatic sync. These tests do not sign in to a real Plex or Jellyfin account.

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

`src/backend/secrets/storage.server.ts` provides the configured secret-storage boundary. Encrypt a `Secret` using the stable, unique connection ID before writing its returned string to PostgreSQL, and pass that same record ID when decrypting. Values use versioned AES-256-GCM with a fresh nonce and authenticated connection identity. Decryption returns a redacted `Secret`; call `reveal()` only when passing credentials to the media server, never in API responses or logs. Plex account tokens, selected Plex profile server tokens, and Jellyfin user tokens are encrypted in the connection tables. Passwords and Plex Home PINs are used only for authentication and are not saved.

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

## Continuous integration

GitHub Actions runs the Biome checks, type checks, unit and Testcontainers integration tests, and production build for pull requests and pushes to `main`. The autofix workflow applies Biome fixes to pull requests through [autofix.ci](https://autofix.ci); install the autofix.ci GitHub App on the repository to allow it to update pull requests.

[Renovate](https://docs.renovatebot.com/getting-started/installing-onboarding/) manages dependency updates. Install the Renovate GitHub App on the repository to enable it. Minor, patch, pin, digest, and lock-file maintenance updates are automatically squash-merged after CI passes; major updates require review.

Pull requests are automatically labeled by contributor trust and effective review size. See [CONTRIBUTING.md](CONTRIBUTING.md) for the vouch, recheck, and sizing rules.

Application routes live in `src/routes`. The Elysia API contract is defined in `src/backend/api.ts`, and `src/routes/api.$.ts` connects it to TanStack Start while exposing the isomorphic Eden client. The focused API and Eden integration tests live in `src/backend/api.test.ts`.
