# Chosen design

Use design B's separate Plex accounts, Plex profiles, Jellyfin profiles and explicit pairings. The independent judge preferred B for identity verification and conflict handling. Graft design A's persisted sync run summaries and direct HTTP adapters. Avoid persisting media catalogs.

One profile can belong to one pairing. This prevents indirect merging between family members through a shared profile. Relinking the same external identity updates its credentials while retaining the stable encryption identity and pairing.

Preview reads both complete inventories. Run reads them again and applies current watched-state union. The UI explicitly states this, so no preview fingerprint is needed. Neither action ever clears watched state. Match direct external movie/episode IDs only, and skip duplicate or conflicting matches.

An installation runs as one Node server process. Manual and hourly automatic sync share one coordinator. Automatic sync is opt-in. Cross-process leases are deferred with an explicit deployment limitation. A restart marks unfinished runs failed; a fresh scan recovers completed writes without blindly replaying them.

Pending OAuth and profile selection attempts live in bounded expiring memory. Account and per-profile server tokens are encrypted in SQLite. Selection completion validates the chosen resource URL and machine identity. Passwords and Home PINs are never persisted.

Verification uses actual local HTTP provider fixtures, migrated SQLite, API requests through authentication, a running browser UI, type/lint checks and production build. Live Plex/Jellyfin credentials have not been supplied, so fixture verification must not be presented as a live account test.
