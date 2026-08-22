# Continuarr

A minimal Bun application with:

- TanStack Start for the React application and server routing
- TanStack Query for SSR-aware data fetching and caching
- Elysia for the API
- Eden Treaty for end-to-end type-safe API calls
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
bun test              # Run tests once
bun run test:watch    # Run tests in watch mode
bun run build
```

## Continuous integration

GitHub Actions runs the Biome checks, type checks, tests, and production build for pull requests and pushes to `main`. The autofix workflow applies Biome fixes to pull requests through [autofix.ci](https://autofix.ci); install the autofix.ci GitHub App on the repository to allow it to update pull requests.

[Renovate](https://docs.renovatebot.com/getting-started/installing-onboarding/) manages dependency updates. Install the Renovate GitHub App on the repository to enable it. Minor, patch, pin, digest, and lock-file maintenance updates are automatically squash-merged after CI passes; major updates require review.

Application routes live in `src/routes`. The Elysia API contract is defined in `src/api.ts`, and `src/routes/api.$.ts` connects it to TanStack Start while exposing the isomorphic Eden client. The focused API and Eden integration tests live in `src/api.test.ts`.
