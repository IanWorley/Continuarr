# Server connections and directory imports

Save Plex and Jellyfin servers, import their users, and refresh them on one shared schedule.

## Sub-features

- `connections.jellyfin`: save a URL/API key and import all returned users.
- `connections.plex`: authorize the server owner and import users without a Home PIN.
- `connections.schedule`: save the shared interval and enabled state.
- `connections.refresh`: refresh directories and preserve existing pairings.

## How to get to it (user POV)

Open `/` or choose **Connections & sync**. Open **Users** to inspect the imported directories.

## Driving it with T3 preview

Preconditions: signed in to the fixture app. Real Plex verification separately requires authorized owner OAuth.

- In the Jellyfin card, fill **Server URL** with `http://127.0.0.1:43124/jellyfin` and **API key** with `fixture-jellyfin-token`. Click **Connect and import users**. Require the saved **Fixture Jellyfin** card.
- Open **Users**. Require Alex and Other in the Jellyfin directory. Read `/api/v1/media/jellyfin/directory`; require both users, their saved details, and a successful server timestamp. Reload and verify they remain.
- On Connections & sync, set **Import interval in minutes** to `120`, toggle **Import automatically** off, and click **Save schedule**. Require **User import schedule saved.** Reload and compare `/api/v1/media/state`'s `directoryPolling` to the visible controls. New pairings must not acquire automatic watched sync.
- Click **Refresh all users now**. Require **User directories refreshed.**, updated server timestamps, and unchanged pairing IDs. For both-provider verification, first save a real authorized Plex server; the seeded legacy Plex profile is not a saved owner connection.
- For Plex, use the card's sign-in action, complete owner OAuth, choose **Find Plex servers**, select an owned server and advertised address, then **Save server and import users**. Require the owner and returned Home/shared users on Users, with unavailable users visibly distinguished and no Home PIN form. Keep this check read-only.

## Gotchas

The fixture covers Jellyfin and watched operations for a seeded Plex profile, not real Plex OAuth. Refreshing users does not enable watched sync. Import failures must retain the last good directory. Service tests cover revision races and overlapping watched sync; a fast manual refresh alone does not prove these cases. The global schedule is the only schedule in the database.
