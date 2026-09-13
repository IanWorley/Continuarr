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

Open <http://localhost:3000>. On a new installation, create the installation-owner account, then sign in to access the application.

The API is available at <http://localhost:3000/api/v1/health>.

## Installation-owner authentication

Continuarr has one administrator, separate from Plex and Jellyfin identities. The first setup at `/sign-in` claims the installation; complete it before exposing a new installation to other users. Once the owner exists, bootstrap is permanently closed. There is no registration, invitation, or additional account flow.

Passwords must contain 12–128 characters and are salted and hashed with Node's maintained `crypto.scrypt` implementation (N=131072, r=8, p=1). SQLite stores the owner and server-managed sessions. Each sign-in creates a random 256-bit token; only its SHA-256 hash is stored. Sessions survive server restarts, expire after seven days without sliding renewal, and are revoked immediately on sign-out. The cookie is HttpOnly, SameSite=Strict, and Secure when the request URL uses HTTPS. Use HTTPS for deployments exposed beyond a trusted local network. Proxies must preserve the public request origin so same-origin checks succeed.

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
