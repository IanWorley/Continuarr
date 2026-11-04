# Continuarr frontend

The admin UI: React, TypeScript, Vite, TanStack Router and Query, and Tailwind CSS v4. [`docs/plan.md`](../docs/plan.md) covers the stack, the API, and the security model. This file covers the details you need to work on the frontend.

## Use the Node version in `.nvmrc`

`.nvmrc` pins the Node major version, and CI reads the same file. Run `nvm use` in `frontend/` to switch to it. On an older Node, `npm ci` only warns about `engines` and keeps going, but that Node is not what CI tests.

## Run it locally

Before you start, install the tools in the plan's [Prerequisites](../docs/plan.md#prerequisites) and start Docker.

1. Start the backend from `backend/`:

	```sh
	./gradlew bootTestRun
	```

	Testcontainers starts an empty Postgres in Docker on each run. While no admin exists, the backend logs a new setup token on each start:

	```
	No admin account yet. Create one with POST /api/setup using setup token 3f9c0b1e8d2a4c6f7e5b9a1d0c3e2f4a
	```

2. In another terminal, create the admin. Replace `<setup-token>` with the token from the log, and `<password>` with a password of at least 8 characters:

	```sh
	curl -s -c cookies.txt http://localhost:8080/api/csrf
	curl -s -b cookies.txt -w '%{http_code}\n' \
		-H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)" \
		-H 'Content-Type: application/json' \
		-d '{"token": "<setup-token>", "username": "admin", "password": "<password>"}' \
		http://localhost:8080/api/setup
	```

	The first request gets the `XSRF-TOKEN` cookie, and the second sends it back in the `X-XSRF-TOKEN` header (see [Security](../docs/plan.md#security)). The second request prints `204` when it creates the admin. It prints `403` for a wrong setup token, `409` when an admin already exists, and `400` for a blank username or a password of the wrong length. The `/setup` page (#96) replaces these commands once it lands.

3. Install the dependencies and start the dev server from `frontend/`:

	```sh
	npm ci
	npm run dev
	```

	Vite serves the app at http://localhost:5173 and forwards `/api` to the backend on port 8080.

4. Open http://localhost:5173/login and sign in as the admin. The app then shows `/`, a placeholder until the logged-in shell lands (#9).

Stopping the backend deletes its database, so repeat step 2 after each restart.

## Run the checks CI runs

```sh
npm ci
npm run check
```

`npm run check` runs `typecheck`, `lint` (oxlint), `test` (Vitest), and the Vite build, in that order, and stops at the first failure. [`.github/workflows/frontend.yml`](../.github/workflows/frontend.yml) is the source of truth for what CI runs.

## API types come from the backend's spec

The `dev`, `typecheck`, and `build` scripts first run `generate:api`, which writes `src/api/schema.d.ts` from `../backend/openapi.json`. The file is generated, so git ignores it. When a backend change alters the API, the frontend typecheck fails wherever the code no longer matches.

## TypeScript allows only erasable syntax

`tsconfig.app.json` turns on `erasableSyntaxOnly`, so every TypeScript construct must disappear when the types are stripped. Enums and constructor parameter properties such as `constructor(readonly x: T)` fail with `TS1294`. Use a union of string literals in place of an enum, and declare fields in the class body.

## Style with the theme tokens

Tailwind CSS v4 runs through `@tailwindcss/vite`, with no Tailwind config file. `src/index.css` holds the theme. The `@theme` block defines the colour tokens, so `--color-ink-900` gives classes like `bg-ink-900` and `text-ink-900`. The `@utility` blocks define custom utilities such as `brand-glow`. Use the tokens instead of raw colour values. If the palette needs a new colour, add a token to `@theme`.
