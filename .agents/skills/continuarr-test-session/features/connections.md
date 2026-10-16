# Server connections and directory imports

Save Plex and Jellyfin servers, import their users, and refresh them on one shared schedule.

## Sub-features

- `connections.jellyfin`: save a URL/API key and import all returned users.
- `connections.plex`: authorize the server owner and import users without a Home PIN.
- `connections.schedule`: save the shared interval and enabled state.
- `connections.refresh`: refresh directories and preserve existing pairings.
- `connections.single`: allow one Plex and one Jellyfin server; a saved server turns the form into a key replacement.
- `connections.disconnect`: remove a saved server and its key while keeping users, pairings, matches, and history.

## How to get to it (user POV)

Open `/` or choose **Connections & sync**. Open **Users** to inspect the imported directories.

## Driving it with T3 preview

Preconditions: signed in to the fixture app. Real Plex verification separately requires authorized owner OAuth.

- In the Jellyfin card, fill **Server URL** with `http://127.0.0.1:43124/jellyfin` and **API key** with `fixture-jellyfin-token`. Click **Connect and import users**. Require **Jellyfin users imported. Open Users to pair people.** and a **Fixture Jellyfin** heading under **Saved servers**. The form stays visible with the URL prefilled, an empty **API key**, the button renamed **Replace key and import users**, and **Continuarr connects one Jellyfin server. To switch servers, disconnect Fixture Jellyfin first.**
- Open **Users**. Require **Imported Jellyfin users (2)** listing Alex and Other. Read `/api/v1/media/jellyfin/directory`; require both users, their saved details, and a successful server timestamp. Reload and verify they remain.
- On Connections & sync, set **Import interval in minutes** to `120`, toggle **Import automatically** off, and click **Save schedule**. Require **User import schedule saved.** and **Automatic imports are off. You can still refresh manually.** Reload and compare `/api/v1/media/state`'s `directoryPolling` to the visible controls. New pairings must not acquire automatic watched sync.
- Click **Refresh all users now**. Require **User directories refreshed.**, updated server timestamps, and unchanged pairing IDs. A partial failure shows **Refresh finished with N failed server imports. Check the server cards for details.** instead. On the fixture, `plexServers` stays `[]`. For both-provider verification, first save a real authorized Plex server; the seeded legacy Plex profile is not a saved owner connection.
- Run disconnect last, after the Users and matching recipes, because it makes the fixture pairing unavailable. On the **Fixture Jellyfin** card, click **Disconnect**. Require the **Disconnect Fixture Jellyfin?** confirmation with **Confirm disconnect** and **Cancel**. Click **Cancel** and require the server to remain. Click **Disconnect**, then **Confirm disconnect**. Require **Fixture Jellyfin disconnected. Mappings and history are preserved. After reconnecting, enable automatic sync again to resume.**, no **Saved servers**, and an empty form with **Connect and import users**. `/api/v1/media/jellyfin/directory` returns `servers: []` and both users with `presence:"missing"` and their pairing IDs kept. The Users recipe covers the unavailable pairing this leaves. Reconnect with the same URL and key; require the same user and pairing IDs, `presence:"present"`, and automatic sync still off.
- For Plex, click **Sign in to Plex**, follow **Continue to Plex ↗**, complete owner OAuth, choose **Find Plex servers**, select an owned server and advertised address, then **Save server and import users**. Require the owner and returned Home/shared users on Users, with unavailable users visibly distinguished and no Home PIN form. Keep this check read-only.

## Gotchas

The fixture covers Jellyfin and watched operations for a seeded Plex profile, not real Plex OAuth. Its seeded account makes the Plex card show **Signed in as Fixture parent** and **Find Plex servers** before any sign-in. That is not owner OAuth; do not click **Find Plex servers** on the fixture because it calls plex.tv with a fake token. Refreshing users does not enable watched sync. Import failures must retain the last good directory. Service tests cover revision races and overlapping watched sync; a fast manual refresh alone does not prove these cases. The global schedule is the only schedule in the database. Once a Jellyfin server is saved, the UI only offers key replacement, so a second server is unreachable from the form; the server rejects a new Jellyfin or a different Plex server with `409`. Disconnect and import both return `409` **A sync is already running. Wait for it to finish.** while a sync run is in progress.
