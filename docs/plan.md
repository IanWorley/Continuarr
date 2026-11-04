# Continuarr — Plan

Continuarr keeps watch history in sync between Plex and Jellyfin. It records a unified,
permanent history of everything watched on either server and syncs watched flags, resume
positions, and unwatches between them.

## Goals

- Unified watch history across Plex and Jellyfin, kept forever.
- Two-way sync of watched flag, resume position, and unwatch.
- Multiple users: Plex Home users mapped to Jellyfin users by the admin.
- Only paired libraries sync; libraries that exist on one server are left alone.
- Safe by default: nothing is written to either server until the admin reviews and approves.

## Non-goals (v1)

- Webhooks (polling only)
- Emby or other servers
- Per-user logins (admin only)
- Admin password recovery
- Trakt integration
- Notifications
- A permanent sync ignore list

## Stack

| Layer | Choice |
|---|---|
| Backend | Kotlin, Spring Boot 4, Spring Modulith |
| Security | Spring Security (Kotlin DSL), Spring Security Crypto |
| Database | Postgres |
| Migrations | Liquibase (SQL-formatted changelogs) |
| Testing | JUnit, Testcontainers (Postgres), WireMock (Plex/Jellyfin), `@ApplicationModuleTest` |
| API contract | springdoc OpenAPI → `openapi-typescript` |
| Frontend | Vite, React, TypeScript, TanStack Query, Router, Table, Tailwind CSS |
| Deploy | Docker Compose (app + Postgres); Spring Boot serves the built SPA |

Not using: TanStack Start (no SSR needed), TanStack Form (forms are small; add if they grow).

## Architecture

Spring Modulith modules, one top-level package each. Boundaries are enforced by an
`ApplicationModules.verify()` test.

```
plex, jellyfin ──implement──▶ server (MediaServer interface, shared types)
       │
       │ ObservedPlayback (server-agnostic)
       ▼
   matching ──▶ history ──WatchEventRecorded──▶ sync ──uses──▶ server
                                                  │
                                    web (reads history / sync / matching)
```

| Module | Responsibility |
|---|---|
| `server` | `MediaServer` interface and shared types (`ServerKind`, `Duration`-based positions) |
| `plex` | Plex client and adapter, including Plex Home token switching |
| `jellyfin` | Jellyfin client and adapter |
| `matching` | External-ID and path matching, suggestions, unmatched queue |
| `history` | Append-only watch events and history queries |
| `sync` | State resolution, sync mode, echo suppression, write planning and execution |
| `people` | People, server accounts, merging |
| `web` | REST API, security, serving the SPA |

REST endpoints are versioned under `/api/v1/...`. Only the security endpoints stay unversioned at
`/api/...`: login, logout, first-run setup, and CSRF (see [Security](#security)).

Events are used only where async, retryable behavior is wanted — mainly `history → sync`,
via the Modulith Event Publication Registry. Calls inside the ingestion path are plain
method calls.

Raw server units are converted at the adapter boundary: Plex milliseconds and Jellyfin
ticks (100 ns) both become `kotlin.time.Duration`.

## Ingestion

| What | Interval | Purpose |
|---|---|---|
| Active sessions | `SESSION_POLL_INTERVAL` ≈ 15s | Live playback for all users |
| Incremental history | `HISTORY_POLL_INTERVAL` ≈ 15 min | Plays since last poll |
| Full reconciliation | nightly | Detect unwatches and metadata changes; re-match |

- Active sessions are tracked in `active_sessions` (survives restarts).
- A `watch_event` is written when playback stops, plus a checkpoint every
  `SESSION_CHECKPOINT_INTERVAL` ≈ 5 min in case a stop is missed.
- Unwatches are inferred from reconciliation diffs; their timestamp is approximate.
- Plex Home user tokens are cached and refreshed only on expiry — plex.tv is never called per poll.

## People

- Every discovered server account gets an auto-created person.
- The admin merges people (e.g. Plex "ian" + Jellyfin "ian"). Nothing is ever auto-mapped.
- Unmerged people still have history recorded; nothing syncs for them.

## Matching

Lookup order, stopping at the first match:

| Item | Primary | Fallback | Last resort |
|---|---|---|---|
| Movie | IMDb | — | TMDb |
| Show | TVDb | IMDb | TMDb |
| Episode | Episode's own TVDb ID | Show ID + season/episode | TMDb |

Rules:

- **Conflicting IDs** → unmatched queue. Never sync on a conflict.
- **Editions are separate movies.** Same edition (or none on both) matches; different editions
  don't; edition on one side only → unmatched queue.
- **Jellyfin editions come from the file name.** Jellyfin has no edition field. The edition is the
  `X` in `{edition-X}`, or else the label in `Title (Year) - Label`. A label that names only a
  quality, such as `1080p` or `2160p`, is not an edition.
- **A Jellyfin movie whose versions differ in edition** → unmatched queue. No edition counts as
  its own value. Marking or unmarking any version of a Jellyfin movie changes every version, so
  Jellyfin can't keep the editions apart. This check runs before ID and path auto-linking, so
  neither links the movie. The admin can still link it by hand, and a watch synced to it then
  marks every version watched on Jellyfin and clears their resume positions.
- **Multi-episode files** → not synced, listed in the queue.
- **Same relative file path** within a paired library → auto-link (strong guess). If IDs
  disagree, link anyway and flag "metadata disagrees".
- **Weaker guesses** (title + year, show + season/episode, runtime as tie-breaker) → suggestions
  with a confidence score; confirm/reject individually or in bulk.
- **Manual links always win.**
- Matching re-runs on every reconciliation pass.

Match sources: `id`, `path`, `suggested` (does not sync), `manual`.

## Conflict resolution

- **Ordering** uses Continuarr's observation time, not server clocks. Server timestamps are
  kept for display and used only for first-run backfill.
- **Clock skew warning** if a server's HTTP `Date` header differs by more than `MAX_CLOCK_SKEW` ≈ 30s.
- **Conflict window** (`CONFLICT_WINDOW` ≈ 2 × session poll interval): events closer than this
  can't be reliably ordered.

| Situation | Rule |
|---|---|
| Clearly ordered changes | Newest always wins (no minimum-resume threshold) |
| Two positions inside the window | Furthest progress wins |
| Watch vs. unwatch | Latest wins; inside the window, watched wins |
| Rewatch | Stays watched; resume position syncs alongside |
| First run | Union for watched; newest resume position wins |
| Resume position | Always absolute time, even if runtimes differ |

## Data model

| Table | Purpose |
|---|---|
| `users` | A Continuarr person |
| `app_user` | Login accounts; v1 has exactly one, the admin |
| `server_accounts` | Person ↔ Plex/Jellyfin account; encrypted Plex token/PIN |
| `library_pairs` | Plex library ↔ Jellyfin library |
| `media_items` | Thin canonical item: kind, IMDb/TVDb/TMDb IDs (union), edition, parent show, season/episode, display title |
| `server_items` | A Plex or Jellyfin item; link to `media_items` (nullable), runtime, relative path, match status, match source |
| `watch_events` | Append-only history: person, server item, type, start/end time, start/end position, `observed_at`, server timestamp, source |
| `watch_state` | Current state per (person, media item); a cache rebuildable from events |
| `active_sessions` | In-progress playback |
| `sync_writes` | Every planned or performed write; drives dry-run view, echo suppression, activity page |
| `event_publication` | Modulith Event Publication Registry (owned by a Liquibase changelog) |

- Events are never edited or deleted; history is kept forever.
- **Rollback** is a `correction` event authored by the admin, synced through the normal path.
  Bulk correction (e.g. a whole season for one person) is supported.
- Rich metadata (posters, descriptions) is fetched from the servers on demand, not stored.
- **Open, tied to the `ServerItem` shape in [#13](https://github.com/IanWorley/Continuarr/issues/13).**
  `server_items` holds one relative path, so a Jellyfin movie with several files doesn't fit it.

## Sync safety

Single sync mode setting:

| Mode | Records history | Plans writes | Performs writes |
|---|---|---|---|
| `OFF` | ✅ | ❌ | ❌ |
| `DRY_RUN` | ✅ | ✅ | ❌ |
| `LIVE` | ✅ | ✅ | ✅ |

- Fresh installs start in `DRY_RUN`.
- Global only; toggled in the admin UI, stored in the database.
- `CONTINUARR_MAX_SYNC_MODE` env var is a hard ceiling the UI can't exceed.
- **Auto-trip** to `DRY_RUN` when writes exceed `MAX_WRITES_PER_WINDOW` ≈ 100 per
  `WRITE_WINDOW` ≈ 5 min, or failures exceed a threshold. UI shows a banner with the reason;
  the admin re-enables `LIVE` manually.
- Writes approved on the plan page don't count toward the auto-trip limit.
- Switching back to `LIVE` discards stale planned writes and re-plans from `watch_state`.
- The plan page is review-only (all-or-nothing). Problems are fixed at the source: library
  pairing, people merging, match rejection, or correction events.
- Echo suppression: incoming events matching a recent `sync_writes` row are ignored.

### First-run flow

1. Install — `DRY_RUN`; polling and backfill begin recording history.
2. Map — pair libraries, merge people, confirm suggested matches.
3. Review — "Planned writes" grouped by person and server, expandable per item.
4. Go live — switch to `LIVE`; the approved plan executes.

## Security

- Single admin, created by first-run setup and stored as a `User` (table `app_user`) with a
  bcrypt hash. Until then, each start logs a one-time setup token; `POST /api/setup` with that
  token creates the admin, and only works while none exists. `GET /api/setup` reports whether
  that is still needed, so the SPA sends visitors to the setup page or the login page.
- Form login (`POST /api/login`) with session cookie, answered with status codes (204/401) instead
  of redirects. Unauthenticated requests get 401.
- SPA CSRF via `csrf.spa()` (Spring Security 7.0+): the SPA calls `GET /api/csrf` to get the
  `XSRF-TOKEN` cookie (the token is deferred, so nothing else writes it), then sends it back in the
  `X-XSRF-TOKEN` header. The Kotlin DSL has no `spa()` as of 7.1, so call `http.csrf { it.spa() }`
  outside the `http { }` block.
- Plex tokens and PINs encrypted with Spring Security Crypto; key from env var or Docker secret.
- Everything requires authentication except the Actuator health endpoint (Docker healthcheck),
  `GET /api/csrf`, `GET` and `POST /api/setup`, and the SPA itself: `index.html`, `/assets/**`, and client-side
  routes (GETs with no file extension outside `/api`, `/actuator`, `/error`, and springdoc's `/v3`).
  The SPA has to load before login to show the login and setup pages; all data comes from `/api`,
  which stays protected. A new server path outside those prefixes would be public, so REST stays
  under `/api`.
- Client-side routes like `/people/123` serve `index.html`; missing assets and unknown `/api` paths
  get 404.

## Frontend

| Page | Purpose |
|---|---|
| History | Timeline filterable by person, server, title (filters in type-safe URL search params) |
| People | Merge auto-created people; enter Plex Home PINs |
| Libraries | Pair Plex and Jellyfin libraries |
| Unmatched | Queue with suggestions, confirm/reject, bulk confirm, manual linking |
| Planned writes | Dry-run review grouped by person and server |
| Sync activity | Performed writes, sync mode, auto-trip banner |
| Corrections | Restore an item or set of items to an earlier state |

- TanStack Query for all API calls and polling; TanStack Router for routes; TanStack Table
  with server-side pagination.
- Tailwind CSS v4 (`@tailwindcss/vite`), dark-first, with the palette as theme tokens in
  `frontend/src/index.css`; no component library.
- API types generated from the OpenAPI spec — backend changes that break the frontend fail
  at compile time.

## Setup

[`frontend/README.md`](../frontend/README.md) walks through a local run, from a clone to signing in,
and covers the frontend's toolchain and checks.

### Prerequisites

- Any JDK 17+ to start Gradle, which downloads the JDK 25 toolchain the build pins
- Node.js (current LTS, pinned in `frontend/.nvmrc`) and npm
- Docker (Testcontainers, Compose)
- A Plex server (admin token) and a Jellyfin server (admin API key) to point at

### Repository layout

```
continuarr/
  backend/        Kotlin, Spring Boot, Gradle Kotlin DSL
  frontend/       Vite, React, TypeScript, TanStack
  docs/           Plan and design notes
  compose.yaml    App + Postgres
```

### Configuration

Server credentials and secrets come from env vars or Docker secrets. People, library pairs,
and matches live in the database and are edited in the admin UI.

| Variable | Purpose |
|---|---|
| `CONTINUARR_ENCRYPTION_KEY` | Key for encrypting Plex tokens and PINs |
| `CONTINUARR_MAX_SYNC_MODE` | Hard ceiling on sync mode (`OFF`, `DRY_RUN`, `LIVE`) |
| `CONTINUARR_PLEX_URL` / `CONTINUARR_PLEX_TOKEN` | Plex server and admin token |
| `CONTINUARR_JELLYFIN_URL` / `CONTINUARR_JELLYFIN_API_KEY` | Jellyfin server and API key |
| `SPRING_DATASOURCE_*` | Postgres connection (Compose only; Testcontainers handles dev and tests) |

### Local development

- `./gradlew bootTestRun` — runs the backend with Postgres started by Testcontainers.
- `./gradlew test` — tests against Testcontainers Postgres and WireMock.
- `npm run dev` in `frontend/` — Vite dev server; forwards `/api` to the backend on port 8080.
- `npm run check` in `frontend/` — the checks CI runs: typecheck, lint, test, and build.
- API types: `backend/openapi.json` is the committed spec (springdoc, behind login). `OpenApiSpecTest`
  fails when it no longer matches the API; copy `build/openapi.json` over it. The frontend's `dev`,
  `typecheck`, and `build` scripts generate `src/api/schema.d.ts` from it, so a breaking API change
  fails the frontend typecheck.
- `docker compose up` — runs the full app as it ships. The root `Dockerfile` builds the frontend in
  a Node stage and packages it into the jar.
- `./gradlew bootJar` packages `frontend/dist` as static resources, so run `npm run build` in
  `frontend/` first; it fails if there is no build. Gradle never runs Node, so `test` and
  `bootTestRun` don't need it (tests use a stand-in `index.html`).
- CI runs on every PR and push to `main`: `.github/workflows/backend.yml` runs `./gradlew test`;
  `.github/workflows/frontend.yml` runs `npm ci` and `npm run check`.

## Milestones and phases

A milestone is a usable state of the app. Phases are the demoable vertical slices inside a
milestone; each finishes before the next starts. Unknowns are verified in the phase that
first depends on them.

| Milestone | Phases | Outcome |
|---|---|---|
| M1 — Foundation | 0 | Empty app that builds, tests, runs, and requires login |
| M2 — Read-only tracker | 1–5 | Full watch history across both servers; never writes to either |
| M3 — Sync | 6–7 | Two-way sync, reviewed in `DRY_RUN` before going `LIVE` |
| M4 — Release | 8–9 | Corrections and a documented install others can run |

### M1 — Foundation

#### Phase 0 — Setup

**Goal:** an empty app that builds, tests, runs, and requires login.

- Gradle Kotlin DSL, Spring Boot 4, Spring Modulith, `ApplicationModules.verify()` test
- Liquibase with the first changelog (including `event_publication`)
- Testcontainers for tests and `bootTestRun`
- Spring Security: first-run admin setup, form login, SPA CSRF, health endpoint open
- springdoc OpenAPI → `openapi-typescript` generation
- Vite + React + TanStack Query/Router shell with a login page
- Spring Boot serves the built SPA; Compose file

**Verify:** unknown 5 (Spring Security SPA CSRF API).
**Done when:** `docker compose up` serves a login page and an empty authenticated shell.

### M2 — Read-only tracker

#### Phase 1 — Jellyfin adapter (read-only)

**Goal:** Continuarr can read everything it needs from Jellyfin.

- `server` module: `MediaServer` interface, `ServerKind`, `Duration`-based positions
- Jellyfin client: users, libraries, items (IDs, path, runtime), played state, sessions
- WireMock fixtures recorded from a real server

**Verify:** unknowns 1 (editions/versions) and 2 (file paths) on the Jellyfin side.
**Done when:** a test can list a real Jellyfin library's items with IDs, paths, and user state.

#### Phase 2 — Plex adapter (read-only)

**Goal:** same as Phase 1, for Plex.

- Plex client: users, libraries, items, `Guid` arrays, editions, played state, sessions
- Plex Home token switching via plex.tv, cached until expiry

**Verify:** unknowns 2 (file paths) and 3 (Home token switching, PINs) on the Plex side.
**Done when:** Continuarr can read state for every Plex Home user, including PIN-protected ones.

#### Phase 3 — People and libraries

**Goal:** the admin can set up who and what syncs.

- Auto-create a person per discovered account
- People merge UI, Plex Home PIN entry (encrypted)
- Library pairing UI

**Done when:** the admin can merge two people and pair two libraries.

#### Phase 4 — Matching

**Goal:** items on both servers are linked to canonical `media_items`.

- ID matching (IMDb/TVDb → TMDb), episode-level TVDb, edition rule, conflict rule
- Relative-path auto-linking with "metadata disagrees" flag
- Suggestions with confidence; unmatched queue UI with confirm/reject/bulk confirm/manual link
- Re-matching on reconciliation

**Done when:** a paired library is fully matched or accounted for in the queue.

#### Phase 5 — History

**Goal:** a complete, permanent watch history.

- Session polling, `active_sessions`, stop events and checkpoints
- Incremental history polling and nightly reconciliation (unwatch detection)
- First-run backfill from server timestamps
- History UI with TanStack Table and type-safe search params
- Clock skew warning

**Verify:** unknowns 4 (short resume positions) and 6 (precision for the conflict window).
**Done when:** watching something on either server shows up in history within one poll.

✅ **M2 complete: a useful read-only tracker that never writes to either server.**

### M3 — Sync

#### Phase 6 — Sync (`DRY_RUN`)

**Goal:** Continuarr shows exactly what it would write.

- `watch_state` resolution with the conflict rules
- `WatchEventRecorded` → sync via the Event Publication Registry
- Sync mode setting (starts `DRY_RUN`) and `CONTINUARR_MAX_SYNC_MODE` ceiling
- `sync_writes` and the planned writes UI

**Done when:** the planned writes page matches what the admin expects for real data.

#### Phase 7 — Sync (`LIVE`)

**Goal:** Continuarr writes to both servers safely.

- Write watched, unwatched, and resume position to Plex and Jellyfin
- Echo suppression
- Auto-trip to `DRY_RUN` on write bursts or failures; banner in UI
- Approved first-run writes exempt from the auto-trip limit
- Re-plan on returning to `LIVE`; sync activity UI

**Done when:** watching on one server updates the other, and a simulated burst trips to `DRY_RUN`.

### M4 — Release

#### Phase 8 — Corrections

**Goal:** the admin can undo mistakes.

- `correction` events, single and bulk (e.g. a season for one person)
- Corrections UI

**Done when:** restoring an item to an earlier state syncs to both servers.

#### Phase 9 — Ship

**Goal:** others can run it.

- Production Docker image
- Compose example and setup documentation

**Done when:** a fresh install following the docs reaches the first-run review page.

## Unknowns

| # | Unknown | Verified in | Finding |
|---|---|---|---|
| 1 | How Jellyfin exposes editions and alternate versions | Phase 1 | Jellyfin 12.0 merges the files named `Title (Year) - Label` in one folder into one movie, with one media source per file. No field names the edition. The label in the file name is the only place an edition name appears, and quality labels such as `2160p` appear there too. Jellyfin stores resume position and play count per version, but marking or unmarking any version changes every version, and marking one watched clears every version's resume position. Files named `Title (Year) {edition-X}` stay separate movies, but `Title (Year) - {edition-X}` merges like any other label. The Jellyfin edition rules in [Matching](#matching) come from this finding. A spot-check of a real library is still open in [#14](https://github.com/IanWorley/Continuarr/issues/14). |
| 2 | Whether both servers return file paths usable for relative-path matching | Phases 1–2 | On Jellyfin 12.0, yes. An `/Items` list query returns `Path` for movies, series, seasons, and episodes only when it asks for `Fields=Path`. Movies and episodes are files, and series and seasons are folders. Every path starts with one of the library's `Locations` from `/Library/VirtualFolders`. The seed server covers a movie in a library's second root, a season 0 special, and a multi-episode file. Each version of a merged movie has its own path in `MediaSources`, and the movie's `Path` is the primary version's file. Paths are the ones Jellyfin sees on its own file system, such as `/media/...` inside a container, so only relative paths compare across servers. The `RelativePath` helper from [#13](https://github.com/IanWorley/Continuarr/issues/13) strips a root from every path on the seed server, so the Matching rules don't change. A server path substitution is the exception. Jellyfin rewrites the paths it returns but not `Locations`, so path auto-linking skips those items, and only the other Matching rules can link them. A search of the 12.0 client bundle finds no setting for a substitution in Jellyfin 12's web client. The seed's configuration sets none, and no real server has been checked yet. If the spot-check of a real library in [#15](https://github.com/IanWorley/Continuarr/issues/15) finds one, the adapter can replace the substitution's `To` with its `From` at the start of each returned path, on whole path segments, and then strip a `Locations` root. Two jq scripts checked that fix on every seed path in seven substitution configurations, including one whose `From` sits below a library root. The Plex side is open for Phase 2. |
| 3 | Plex Home token switching, including PIN-protected users | Phase 2 | |
| 4 | Whether either server drops very short resume positions | Phase 5 | |
| 5 | The exact Spring Security SPA CSRF API for the version in use | Phase 0 — resolved, see [Security](#security) | |
| 6 | Whether server APIs report changes precisely enough for the conflict window | Phase 5 | |
