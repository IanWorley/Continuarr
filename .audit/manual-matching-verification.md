# Manual matching verification

Verified 2026-09-26 with isolated local Plex/Jellyfin HTTP fixtures and PostgreSQL. Real media accounts were not used.

- Created and signed into a fresh test owner through the browser, connected fixture Jellyfin, and paired it with fixture Plex.
- Followed the homepage link to `/matches`. Both libraries showed Expedition episodes, different server paths, and watched state.
- Selected season 2 on both sides. Only New horizons appeared. Returned to season 1.
- Saved Plex 3 to Jellyfin j3, which have no metadata IDs. Watched sets stayed Plex [1,3] and Jellyfin [j2].
- Reloaded the page and selected the pairing. The saved match persisted and both items were reserved.
- Preview showed three writes, including the manually paired episode. Sync produced Plex [1,3,2] and Jellyfin [j2,j1,j3]. A repeated sync produced zero writes. Other episodes stayed unwatched.
- Saved a second pair, canceled its removal, then confirmed removal. Only the second pair disappeared and its items became selectable again. Watched states stayed unchanged.
- Authenticated HTTP requests rejected a conflicting pair with 409 and a movie-to-episode pair with 400. An unauthenticated library request returned 401.
- `bun test`: 110 passed, 0 failed. Includes persistence, uniqueness, pairing isolation, manual precedence, stale reservation, null provider metadata, and correction.
- `bun run typecheck`, `bun run check`, `bun run db:check`, `bun run build`, and `git diff --check` passed.

Test app: http://100.67.34.53:3001/matches or http://127.0.0.1:3001/matches on the host.
Test owner: continuarr-test / Continuarr-local-test-2026!
Fixture port: 43124. Fixture terminal session: 3232. App terminal session: 68205.
Both remain running for inspection. The fixture database is temporary and separate from other installations.
