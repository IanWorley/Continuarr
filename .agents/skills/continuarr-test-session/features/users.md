# User pairing and watched sync

Pair the same person across providers and merge watched flags. Directory imports and watched sync have separate schedules.

## Sub-features

- `users.pair`: create a manual one-to-one pairing.
- `users.preview`: compare libraries without writes.
- `users.sync`: merge watched flags and repeat without duplicate changes.
- `users.legacy`: retain existing migrated pairing access before a successful import.

## How to get to it (user POV)

Open `/users` or choose **Users**. The pairing form and existing pairing cards are on this page.

## Driving it with T3 preview

Preconditions: import Fixture Jellyfin through Connections & sync. Use fixture accounts only for watched writes.

- In **Plex user**, select **Alex (Home) · Fixture Plex**. In **Jellyfin user**, select **Alex · Fixture Jellyfin**. Click **Create pairing**. Require a pairing card and a matching entry in `/api/v1/media/state`. Reload and require the same pairing ID.
- Save `GET http://127.0.0.1:43124/fixture-state`. Click **Preview changes** on that pairing. Require two watched updates on a fresh fixture. Read fixture-state again and require identical values.
- Click **Sync watched status now**. Require a completed run with two applied updates. Fixture-state must include Plex IDs `1` and `2` and Jellyfin IDs `j1` and `j2`. Preserve other initial watched IDs when comparing.
- Run sync again. Require zero updates and unchanged fixture-state. The **Sync automatically every hour** checkbox stays off unless explicitly selected.
- For a migrated installation, require the existing pairing's preview/sync controls to stay enabled before the first successful directory import. Exercise preview and fixture-only sync. After an import marks that user missing or disabled, require disabled controls and rejected sync access. Run the service regression tests for deterministic failed-import and automatic-sync coverage.

## Gotchas

Fresh fixtures do not represent migrated Jellyfin profiles. Do not claim upgrade coverage from a new connection. The fixture's first preview count is valid before any sync or manual match. Pairing a profile already used by another pairing must not be allowed. Watched sync merges flags, not play counts, timestamps, ratings, or positions.
