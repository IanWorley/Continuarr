# Manual media matching

Match media items when their provider metadata cannot establish the same movie or episode.

## Sub-features

- `matching.browse`: choose a pairing and browse both libraries.
- `matching.save`: save a same-kind match and retain it after reload.
- `matching.remove`: confirm removal of a match created by this verification run.

## How to get to it (user POV)

Open `/matches` or choose **Manual matching**. Select the fixture pairing in **Pairing**.

## Driving it with T3 preview

Preconditions: the fixture Alex pairing exists. Capture initial saved matches and fixture-state.

- Select the pairing. Require two library browsers and **Choose a pair**. Use each browser's kind/show/season/search controls to locate fixture episodes.
- Select **First contact (3)** in Plex and **First contact (j3)** in Jellyfin using their radio accessible names. Require the selected-pair summary and enabled **Save manual match**.
- Click **Save manual match**. Require the match under saved matches. Reload, reselect the pairing if needed, and verify `/api/v1/media/pairings/<pairing-id>/library` returns the saved IDs in `matches`.
- Return to Users and preview. Require this formerly unmatched episode to be included in the plan. Saving a manual match alone must leave fixture-state unchanged.
- For removal coverage, remove only the match created by this run, using its confirmation control. Reload and verify its absence from `matches`.

## Gotchas

A movie cannot be paired with an episode. Saving a match does not write watched status. Do not remove pre-existing user matches. Snapshot before selecting controls because library browsers repeat labels; scope actions to the Plex or Jellyfin browser.
