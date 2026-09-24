# Completion plan

- [x] Read Poteto Mode principles.
- [x] Phase A: Frame. Existing media functionality is scaffolding. Done means account linking, explicit Plex/Home-to-Jellyfin pairing, watched-state union preview and execution, durable encrypted credentials, and repeatable verification.
- [x] Phase B: Design the workflow. Compare independent designs, select contracts, establish baseline checks.
- [x] Phase C: Run the loop.
- [x] Implement provider authentication and profile/server discovery.
- [x] Implement persistence, matching, execution and run records.
- [x] Implement account and pairing UI.
- [x] Verify provider HTTP contracts, identity isolation, pagination, repeated sync and failure handling.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back. Run checks/build, drive actual UI, record live-provider limits.

Throughput checkpoint: provider adapters and UI can be implemented independently once contracts are chosen; one owner per file set. Root owns database, orchestration, integration and final verification. No production credentials have been supplied. Local provider fixtures will prove request/response paths; real account validation requires authenticated access.

Architect: Ground, Sketch, Agree (default proceed), Implement, Scrap (only if design fails).
Arena: Frame, Fan out, Cross-judge, Pick, Graft, Verify.

Delivery remains a local working-tree change. No commit, pull request, deployment, or real media-library writes were requested or performed. Live authenticated Plex Home and Jellyfin validation remains outside the verified evidence.
