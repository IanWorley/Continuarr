# Jellyfin users verification

## Environment

- Base commit after requested fetch/rebase: `7172000`, merged PRs #118 and #119.
- Isolated fixture terminal session: `1205`, HTTP port `43123`, PostgreSQL port `55453`.
- App terminal session: `56969`, port `3011`.
- Browser URL: `http://100.67.34.53:3011`.
- Temporary owner: `continuarr-test`, password `Continuarr-local-test-2026!`.
- Keep both sessions running. Stopping the fixture removes its temporary database.

## Observed before implementation

Owner bootstrap and UI sign-in succeeded. Health returned `status: ok` and setup was initially unconfigured.

The real Plex authorization page displayed successful sign-in. Continuarr's poll returned `status: linked`; reloading showed the real account, Home users, a shared user, and NAS server/address options. No real watched-history writes were performed.

A legacy Jellyfin profile named `fixture-legacy-jellyfin` was seeded using the old schema with its token encrypted under that profile ID. This will verify additive backfill and ID preservation through the new users page.

## Observed after implementation

The additive migration applied successfully. The background scheduler imported Alex and Other. Alex retained `fixture-legacy-jellyfin`. Direct database verification confirmed the old credential still decrypts under that profile ID and the new ciphertext decrypts under the server ID. The ciphertexts differ.

The real Plex profile is visible as saved on its NAS server. Watched-sync verification used only the local Alex fixture pairing.

On `/users`, the owner created the Alex fixture pairing, saved a 120-minute import interval, and reloaded. The pairing and interval persisted. Manual refresh succeeded. Disabling automatic import persisted after reload. The test restored hourly imports afterward. Expanding the user details displayed the fixture's complete returned JSON.

On home, the fixture preview reported two watched updates. Sync applied two; repeating sync applied zero. The fixture state confirmed Plex watched IDs 1 and 2 and Jellyfin watched IDs j1 and j2. The fixture also has unrelated episode data, which remained unmatched.

The manual matching page loaded both fixture libraries using the preserved pairing and migrated server credentials.

The fixture's live UserDto contains only ID/name. Rich UserDto preservation, missing users, failed refresh retention, key rotation races, and polling after service recreation are covered by automated tests.

## Automated validation

- `bun test`: 126 passed, 0 failed across 13 files.
- `bun run typecheck`: passed.
- `bun run check`: passed, 77 files checked.
- `bun run db:check`: passed.
- `bun run build`: client and server builds passed.
- `git diff --check`: passed.

The final provider test verifies retained configuration, provider IDs, activity dates, and nullable policy/server identity. Tests also exercise the legacy credential repair command against an isolated HTTP fixture and PostgreSQL database.

The mobile users page was inspected at 390 CSS pixels. Document content width was 375 pixels, with no horizontal overflow. Test polling is restored to 60 minutes and enabled.

Raw validation output remains at `/tmp/continuarr-jellyfin-design/validation.log`. The running fixture uses a minimal UserDto, so richer fields are verified through HTTP provider tests rather than claimed from the browser.
