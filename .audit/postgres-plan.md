# PostgreSQL migration plan

- [x] Frame. User requested a fresh PostgreSQL database. Preserve existing SQLite files and migration history.
- [x] Design. Use node-postgres Pool, Drizzle PostgreSQL schema, async repositories and callers, independent DATA_DIRECTORY, and a real PostgreSQL test harness.
- [x] Convert authentication and settings repositories and all callers.
- [x] Convert media repository, service, singleton initialization and scheduler.
- [x] Replace database tests and fixtures with PostgreSQL-backed behavior checks.
- [x] Update setup, credential-key tests and documentation.
- [x] Verify tests, build and a running app against PostgreSQL.
- [x] Record evidence and audit completion.

Throughput checkpoint: root owns database schema/config/harness, secrets, fixtures, documentation and final integration. Auth worker owns admin/shared and their tests, api.ts, start.ts and orphan auth service callers. Media worker owns media repository/service/runtime/controller and service tests plus async type references in dashboard. Database-test worker owns only src/db/*.test.ts. Workers never edit each other's files.

The behavior contract remains watched-state union, explicit per-user pairing, encrypted tokens, persistent owner sessions and opt-in hourly sync. The async guard must fail closed, and epoch milliseconds must remain exact bigint values. Single application process remains the supported deployment model.
