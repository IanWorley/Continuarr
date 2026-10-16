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
- Save `GET http://127.0.0.1:43124/fixture-state`; a fresh fixture has watched Plex `1`, `3`, `6` and Jellyfin `j2`, plus `plexPositions {"2":754000}`, `jellyfinPositions {"j4":754000,"j6":600000,"j7":1234000}`, and empty `jellyfinPlayedDates`. Click **Preview changes** on that pairing. Under **Current preview**, require **5 proposed updates (3 watched, 2 positions)**. **Arrival** shows **Mark watched on Jellyfin (9/1/2026)**. **The Martian** shows **Resume at 12:34 on Jellyfin** and **Mark watched on Plex and resume at 12:34**. **Aurora** shows **Mark watched on Jellyfin (9/1/2026) and resume at 10:00**. **Polar night** shows **Resume at 20:34 on Plex**. Aurora matches by series ID and episode number, but the UI shows only the title and action. The skip-reason panel shows **Matched pairs** `4 pairs`, **Unmatched items** `6 items`, **Episodes without a series ID** `6 episodes`, **Ambiguous or conflicting metadata** `2 items`, **Episodes that cannot match by number** `2 episodes`, and **Resume position conflicts** `1 pairs`. Read fixture-state again and require identical values.
- Click **Sync now**. Require a **Completed** run reading **5 of 5 planned updates applied**. Fixture-state must add Plex `2` and Jellyfin `j1` and `j6` to the initial IDs. Require `plexPositions` to equal `{"2":754000,"7":1234000}` and `jellyfinPositions` to include `"j2":754000` and `"j6":600000`. Marking an item watched clears its resume position, as on the real servers, so sync writes each marked item's position back. Aurora's positions conflict, so `j6` keeps its own 10:00 and nothing is copied. `jellyfinPlayedDates` gains `j1` and `j6`.
- Run sync again. Require **0 of 0 planned updates applied**, one position conflict (Aurora), the first run under **Earlier available runs**, and unchanged fixture-state. The **Sync automatically every hour** checkbox stays off unless explicitly selected.
- For an unavailable Jellyfin user on a fresh fixture, run the Connections disconnect step. Require **Preview changes** and **Sync now** disabled with **Sync is unavailable because one of these users is missing or no longer grants access. Refresh the server connections to check again.** A same-origin `POST /api/v1/media/pairings/<pairing-id>/preview` returns `400` **This Jellyfin user is missing, disabled, or awaiting refresh.** A same-origin `POST /api/v1/media/pairings/<pairing-id>/run` returns `200` with `status:"failed"`, and the card shows **Needs attention**. Fixture-state stays unchanged.
- For a migrated installation, require the existing pairing's preview/sync controls to stay enabled before the first successful directory import. Exercise preview and fixture-only sync. After an import marks that user missing or disabled, require the unavailable behavior above. Run the service regression tests for deterministic failed-import and automatic-sync coverage.

## Gotchas

Fresh fixtures do not represent migrated Jellyfin profiles. Do not claim upgrade coverage from a new connection. The fixture's first preview count is valid before any sync or manual match. Pairing a profile already used by another pairing must not be allowed. The UI hides paired profiles from both selects and shows **No unpaired users are available on both services. Connect or refresh your servers to import more users.** once none remain, so test rejection with a same-origin `POST /api/v1/media/pairings` and require `409` **Each profile can belong to only one pairing. This prevents merging different users' histories.** For an unavailable Jellyfin user, preview is rejected, while a sync run records a failed run that shows as **Needs attention**. Sync merges watched flags and resume positions, not play counts or ratings. Jellyfin receives the Plex last-viewed date as the played date, which appears in `jellyfinPlayedDates`.
