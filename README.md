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
bun run dev
```

Open <http://localhost:3000>. The page calls the Elysia health endpoint through Eden Treaty and displays its status.

The API is available at <http://localhost:3000/api/health>.

## Useful commands

```bash
bun run format        # Apply formatting
bun run format:check  # Check formatting
bun run lint          # Check lint rules
bun run lint:fix      # Apply safe lint fixes
bun run check         # Check formatting and lint rules
bun run check:fix     # Apply formatting and safe lint fixes
bun run typecheck     # Check TypeScript types
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

Application routes live in `src/routes`. The Elysia API contract is defined in `src/api.ts`, and `src/routes/api.$.ts` connects it to TanStack Start while exposing the isomorphic Eden client. The focused API and Eden integration tests live in `src/api.test.ts`.
