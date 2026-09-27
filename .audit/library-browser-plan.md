# Manual library matching

User narrowed scope to a separate manual matching page. Automatic matching design is deferred for collaboration.

- [x] `how` over the affected subsystem.
- [x] `architect` for parallel design exploration. Skipped further exploration after user explicitly requested a simple manual-first page and deferred algorithm architecture.
- [x] Write the throughput checkpoint as four todo items.
  - Blocking first steps: traced provider scans, strict matching, service snapshots, auth, and database constraints.
  - Independent workstreams: one implementation owner; parent owns runtime verification and .audit files.
  - Shared mutable state: implementation files have one writer; tests use isolated PostgreSQL.
  - Smallest safe decomposition: provider, persistence, API, and page contracts stay with one owner to avoid drift.
- [x] Delegate code-writing to a subagent using the configured feature model.
- [x] Verify on the matching surface. Browser flow and 110 tests passed.
- [x] Prepare one coherent feature commit. No rebase needed.
- [x] If the design is contested, `interrogate` before shipping. Not contested; user selected manual-first scope.
- [ ] Run Opening a PR.

Data shape: ManualMatch stores pairingId, plexItemId, jellyfinItemId, with one-to-one uniqueness per pairing. MediaItem retains optional server-reported display metadata. No new automatic algorithm.

Acceptance checks
- Separate authenticated page accessible from homepage.
- Browse both libraries with show/season filters, filenames, and watched state.
- Select one item on each provider and save a manual pairing without a provider write.
- Reload and see the saved pair; conflicting and cross-kind selections rejected.
- Existing watched-status preview/run honors manual pairs without reusing reserved items.
- Repeated sync makes no updates; missing metadata remains explicitly unavailable.
