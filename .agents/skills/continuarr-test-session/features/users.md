# User pairing and watched sync

Pair the same person across providers and merge watched flags and resume positions. Directory imports and watched sync have separate schedules.

## Sub-features

- `users.pair`: create a manual one-to-one pairing.
- `users.preview`: compare libraries without writes.
- `users.sync`: merge watched flags and resume positions, then repeat without duplicate changes.
- `users.legacy`: retain existing migrated pairing access before a successful import.

## How to get to it (user POV)

Open `/users` or choose **Users**. The pairing form and existing pairing cards are on this page.

## Driving it with T3 preview

Preconditions: import Fixture Jellyfin through Connections & sync. Use fixture accounts only for watched writes.

- In **Plex user**, select **Alex (Home) · Fixture Plex**. In **Jellyfin user**, select **Alex · Fixture Jellyfin**. Click **Create pairing**. Require a pairing card and a matching entry in `/api/v1/media/state`. Reload and require the same pairing ID.
- Save `GET http://127.0.0.1:43124/fixture-state`; a fresh fixture has watched Plex `1`, `3`, `6` and Jellyfin `j2`, plus `plexPositions {"2":754000}`, `jellyfinPositions {"j4":754000}`, and empty `jellyfinPlayedDates`. Click **Preview changes** on that pairing. Under **Current preview**, require **3 proposed watched updates**: **Arrival** and **Aurora** with **Mark watched in Jellyfin**, **The Martian** with **Mark watched in Plex**. Aurora matches by series ID and episode number, but the UI shows only the title and action. The skip-reason panel shows **Matched pairs** `4 pairs`, **Unmatched items** `6 items`, **Episodes without a series ID** `6 episodes`, **Ambiguous or conflicting metadata** `2 items`, and **Episodes that cannot match by number** `2 episodes`. Read fixture-state again and require identical values.
- Click **Sync watched status now**. Require a **Completed** run reading **3 of 3 planned watched updates applied**. Fixture-state must add Plex `2` and Jellyfin `j1` and `j6` to the initial IDs, with positions and played dates unchanged.
- Run sync again. Require **0 of 0 planned watched updates applied**, the first run under **Earlier available runs**, and unchanged fixture-state. The **Sync automatically every hour** checkbox stays off unless explicitly selected.
- For an unavailable Jellyfin user on a fresh fixture, run the Connections disconnect step. Require **Preview changes** and **Sync watched status now** disabled with **Sync is unavailable because one of these users is missing or no longer grants access. Refresh the server connections to check again.** A same-origin `POST /api/v1/media/pairings/<pairing-id>/preview` returns `400` **This Jellyfin user is missing, disabled, or awaiting refresh.** A same-origin `POST /api/v1/media/pairings/<pairing-id>/run` returns `200` with `status:"failed"`, and the card shows **Needs attention**. Fixture-state stays unchanged.
- For a migrated installation, require the existing pairing's preview/sync controls to stay enabled before the first successful directory import. Exercise preview and fixture-only sync. After an import marks that user missing or disabled, require the unavailable behavior above. Run the service regression tests for deterministic failed-import and automatic-sync coverage.

## Gotchas

Fresh fixtures do not represent migrated Jellyfin profiles. Do not claim upgrade coverage from a new connection. The fixture's first preview count is valid before any sync or manual match. Pairing a profile already used by another pairing must not be allowed. The UI hides paired profiles from both selects and shows **No unpaired users are available on both services. Connect or refresh your servers to import more users.** once none remain, so test rejection with a same-origin `POST /api/v1/media/pairings` and require `409` **Each profile can belong to only one pairing. This prevents merging different users' histories.** For an unavailable Jellyfin user, preview is rejected, while a sync run records a failed run that shows as **Needs attention**. Watched sync merges flags, not play counts, timestamps, ratings, or positions.
