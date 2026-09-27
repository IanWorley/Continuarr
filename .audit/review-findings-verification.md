# Review findings verification

The follow-up fixes serialize watched runs and successful directory reconciliation through the existing queue. Migrated Jellyfin users with retained credentials remain eligible until a successful import establishes presence. The Users controls consume the same eligibility result as the backend. A forward migration removes unused per-server polling fields.

## Regression evidence

Five focused service cases failed before the fix: both import/run overlap orders, legacy preview, legacy manual sync, and legacy automatic sync. They pass after the fix. The migration cases also check that successful imports marking users missing or disabled revoke eligibility.

Independent service reproduction before:

```json
{"claimed":true,"directoryReads":1,"importsCommitted":0,"refreshFailure":"A sync is already running. Wait for it to finish."}
```

After releasing the held watched run and awaiting the queued import:

```json
{"claimed":true,"directoryReads":1,"importsCommitted":1,"refreshFailure":""}
```

Legacy preview previously returned `This Jellyfin user is missing, disabled, or awaiting refresh.` It now completes with retained legacy credentials.

## Checks

- `bun test`: 130 passed, 0 failed, 440 assertions.
- `bun run typecheck`, Biome on changed TypeScript files, `bun run db:check`, `git diff --check`, and `bun run build` passed.
- Isolated PostgreSQL upgrade from 0004 to 0005 retained the shared schedule and server credentials while removing obsolete polling columns.
- The updated `.agents/skills/continuarr-test-session/SKILL.md` was executed through owner setup/login, Jellyfin import, shared schedule persistence, pairing, preview without writes, and fixture sync with 2 then 0 writes.
- A prepared post-backfill fixture profile remained visibly unverified while its UI preview/sync controls were enabled and preview succeeded.

Local browser evidence and logs are in `/tmp/continuarr-verify-20260926`. The disposable app and fixture were stopped after verification; evidence remains. Real Plex OAuth and manual matching were not rerun for these fixes. Existing retained sessions were not stopped.
