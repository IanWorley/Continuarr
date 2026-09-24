# PostgreSQL verification

2026-09-24. The user selected a fresh PostgreSQL database. Existing SQLite data and migration files remain untouched; the active migration directory is now `drizzle/postgres`.

- `bun test`: 99 passed, 0 failed. Integration tests use real PostgreSQL containers and a fresh migrated database per test.
- `bun run test:pr-size`: 16 passed, 0 failed.
- `bun run check`, `bun run typecheck`, `bun run db:check`, `bun run build`, `git diff --check`, and `docker compose config --quiet`: passed.
- `bun run db:migrate` succeeded against the running isolated PostgreSQL fixture and preserved existing fixture records.
- Browser created an installation owner, connected a Jellyfin fixture user, paired it with a seeded Plex Home profile, previewed two updates and applied both.
- PostgreSQL contained one owner, one session, one pairing, the saved run, and an encrypted Jellyfin token.
- After stopping and restarting the application against the same PostgreSQL database, the browser session, profiles, pairing and run history survived. A repeat sync applied zero updates.
- With hourly sync enabled and the isolated fixture pairing made due, the live timer produced a third completed run with zero updates.
- Static search found no remaining SQLite imports in application code, tests, or scripts. Historical SQLite migrations are preserved separately.

Foundational Thinking shaped the bigint epoch columns and separate credential directory. Prove It Works required real PostgreSQL behavior checks and a browser restart check. Provider authentication and watched-state rules remain unchanged from the preceding feature work. Live media accounts were not used.

Repeat the browser scenario with `bun scripts/media-fixture.ts`. Normal setup is documented in README.md.

Independent PostgreSQL review by GPT-6 Luna found no blockers in async authentication, persistence, scheduler coordination, timestamp precision, schema constraints, test isolation, or credential storage. The completion checklist is now updated.

## PR review follow-up

Accepted three findings on PR #112: skip Plex server resources without usable access, use Jellyfin's MediaBrowser Authorization token parameter, and let requests continue when scheduler initialization fails. Provider tests passed with inaccessible Plex resources and strict Jellyfin authorization fixtures. Type checking, lint, build, and diff checks passed. With PostgreSQL unreachable, two live health requests returned success and each scheduler attempt logged a sanitized retry message.

Skipped removal of the SQLite migration artifacts because the migration deliberately preserves the earlier SQLite history. They are outside the active PostgreSQL migration directory.
