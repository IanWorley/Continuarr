# Continuarr

A minimal Bun application with:

- TanStack Start for the React application and server routing
- TanStack Query for SSR-aware data fetching and caching
- Elysia for the API
- Eden Treaty for end-to-end type-safe API calls
- Drizzle ORM with better-sqlite3 for the Vite/Node server; tests use Bun's native SQLite driver
- Tailwind CSS for styling

## Run locally

```bash
bun install
cp .env.example .env
bun run db:migrate
bun run dev
```

Open <http://localhost:3000>. On first launch, paste the setup code from the server logs and choose an administrator username and password. Setup signs you in automatically.

The API is available at <http://localhost:3000/api/v1/health>.

## Administrator authentication

Continuarr has one administrator, separate from Plex and Jellyfin identities. Before an owner exists, the server prints a random first-time setup code on startup. Paste it into `/sign-in`; the code is never put in a URL. Restarting before setup replaces the code. Creating the owner permanently closes bootstrap and invalidates the code. Once configured, startup logs say “Administrator configured; sign in to continue.” Keep access to server logs limited to people who may configure the installation.

Passwords contain 12–128 characters and are salted and hashed with Node's `crypto.scrypt`. Sessions are stored in SQLite with hashed random tokens and survive restarts. Each device can sign in separately. Sessions expire seven days after sign-in without sliding renewal; sign-out revokes only the current session. Password recovery is outside the current scope.

Application pages and APIs require a session, except health and initial setup/sign-in. Static assets remain available to render sign-in. Unauthenticated pages redirect to `/sign-in`; APIs return 401. Session cookies are HttpOnly, SameSite=Strict, and Secure over HTTPS. Proxies must preserve the public request origin, and mutating requests require a matching `Origin` header. Use HTTPS when accessing outside a trusted home network.

Authentication endpoints under `/api/v1/admin` are `GET /setup`, `POST /bootstrap`, `POST /sign-in`, `GET /session`, and `POST /sign-out`. Bootstrap takes JSON `{ "username": "…", "password": "…", "setupCode": "…" }`; sign-in takes username and password and returns the session cookie. Bootstrap API clients must call sign-in after creating the owner, as the UI does.

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

No manual key setup is required. On first startup, Continuarr generates a random 32-byte encryption key and saves it as `credential-encryption.key` beside the SQLite database (by default, `./data/credential-encryption.key`). Later starts reuse that file. With an in-memory database, the key still lives in `./data`. The file is created with owner-only permissions on POSIX systems; an invalid or unreadable saved key stops startup instead of being replaced. On POSIX, saved keys must be regular files owned by the service user with no group or other permissions; symbolic links are rejected.

Persist the database directory across container replacements and back up the key securely along with the database. Losing or replacing the key makes existing credentials unreadable. If the key file is lost, restore it before restarting; an absent file is treated as a new installation.

`CREDENTIAL_ENCRYPTION_KEY` remains an optional override for deployments that manage their own secrets. A nonempty override must be a base64-encoded 32-byte key and takes precedence over the file without changing it. Existing deployments using this variable should keep their current value, or save that exact value without a trailing newline in the key file before removing the override. On POSIX, ensure the file is owned by the service user and set its permissions to `600`. Never commit a key or expose it through a `VITE_` variable.

`src/backend/secrets/storage.server.ts` provides the configured secret-storage boundary. Encrypt a `Secret` using the stable, unique connection ID before writing its returned string to SQLite, and pass that same record ID when decrypting. Values use versioned AES-256-GCM with a fresh nonce and authenticated connection identity. Decryption returns a redacted `Secret`; call `reveal()` only when passing credentials to the media server, never in API responses or logs. Connection tables and persistence integration follow separately.

## Database

SQLite is configured through `DATABASE_URL` and defaults to `./data/continuarr.db`. Copy `.env.example` to `.env` when you need to override it. Drizzle schemas live in `src/db/schema.ts`, the connection factory lives in `src/db/database.ts`, and generated migrations are committed under `drizzle`.

Apply the committed migrations before using a new local database:

```bash
bun run db:migrate
```

`src/db/schema.container.test.ts` starts a pinned SQLite container, copies every generated SQL migration into it, applies the scripts in order, and verifies the migrated schema with a write/read round trip. Docker must be running for this integration test.

## Continuous integration

GitHub Actions runs the Biome checks, type checks, unit and Testcontainers integration tests, and production build for pull requests and pushes to `main`. The autofix workflow applies Biome fixes to pull requests through [autofix.ci](https://autofix.ci); install the autofix.ci GitHub App on the repository to allow it to update pull requests.

[Renovate](https://docs.renovatebot.com/getting-started/installing-onboarding/) manages dependency updates. Install the Renovate GitHub App on the repository to enable it. Minor, patch, pin, digest, and lock-file maintenance updates are automatically squash-merged after CI passes; major updates require review.

Pull requests are automatically labeled by contributor trust and effective review size. See [CONTRIBUTING.md](CONTRIBUTING.md) for the vouch, recheck, and sizing rules.

Application routes live in `src/routes`. The Elysia API contract is defined in `src/backend/api.ts`, and `src/routes/api.$.ts` connects it to TanStack Start while exposing the isomorphic Eden client. The focused API and Eden integration tests live in `src/backend/api.test.ts`.
