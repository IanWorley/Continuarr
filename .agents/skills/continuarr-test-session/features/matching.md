# Manual media matching

Match media items when their provider metadata cannot establish the same movie or episode.

## Sub-features

- `matching.browse`: choose a pairing and browse both libraries.
- `matching.save`: save a same-kind match and retain it after reload.
- `matching.remove`: confirm removal of a match created by this verification run.

## How to get to it (user POV)

Open `/matches` or choose **Manual matching**. Select **Alex (Home) / Alex (Fixture Plex)** in **Person pairing**.

## Driving it with T3 preview

Preconditions: the fixture Alex pairing exists. The fixture does not seed one, so create it on Users first. Capture initial saved matches and fixture-state.

- In **Person pairing**, select **Alex (Home) / Alex (Fixture Plex)**. Require **Choose a pair**, the **Plex** and **Jellyfin** library browsers, and **Saved matches (n)** equal to the captured baseline, which is `0` on a fresh fixture. Each browser has its own **Content**, **Show**, **Season**, and **Search title or path** controls for locating fixture episodes.
- Select **First contact (3)** in Plex and **First contact (j3)** in Jellyfin using their radio accessible names. Require **Selected pair: First contact / First contact** and enabled **Save manual match**.
- Click **Save manual match**. Require **Manual match saved. Watched status has not changed.**, **Saved matches (n)** at the baseline plus one, and both radios disabled. Reload, then reselect the pairing because the select resets, and verify `/api/v1/media/pairings/<pairing-id>/library` returns `{plexItemId:"3", jellyfinItemId:"j3"}` in `matches`.
- Return to Users and preview. Require **First contact** with **Mark watched in Jellyfin** in the plan and one more matched pair than before. Saving a manual match alone must leave fixture-state unchanged.
- For removal coverage, click **Remove match** on the match created by this run, then **Confirm removal**. Require **Saved matches (n)** back at the baseline. Reload and verify its absence from `matches`.

## Gotchas

A movie cannot be paired with an episode. Saving a match does not write watched status. Do not remove pre-existing user matches. Snapshot before selecting controls because library browsers repeat labels; scope actions to the Plex or Jellyfin browser. Library lists scroll inside their own container, so `preview_click` on an off-screen radio fails. Scroll the target into view with `preview_evaluate` first, as described in the skill's Drive section.
