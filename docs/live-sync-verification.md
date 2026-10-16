# Verify sync against real Plex and Jellyfin servers

Use this checklist to verify watched-state sync against real servers before treating v1 as complete. Fixture results from `.agents/skills/continuarr-test-session` do not count as real-server acceptance.

## Before you start

1. Use a Plex Media Server and a Jellyfin server that you are willing to modify. Every scenario changes watched status, so never run this against personal libraries.
2. Add at least three movies and one show with two or more episodes to both servers. Each test item needs the same IMDb, TMDb, or TVDb ID on both servers, no conflicting IDs, and no other item sharing that ID. Continuarr does not match by title and skips ambiguous items.
3. On Plex, add a Home user and a user with an accepted server grant. Create at least one Jellyfin user. Give the Plex grant user and the Jellyfin user access to the test libraries.
4. Write down each test item's watched state on both servers so you can restore it later. Then mark every test item unwatched on both servers. A directional scenario proves nothing if its destination already shows the item as watched.
5. Record the Plex Media Server version, the Jellyfin version, and the app revision from `git rev-parse HEAD`.
6. Follow [Run locally](../README.md#run-locally) with an empty database, then create the installation-owner account.

## Scenarios

The test items are movies A, B, and C and episodes A and B. Wait for each run to finish before you check its result.

1. **Import Plex users.** On **Connections & sync**, choose **Sign in to Plex** and authorize Continuarr. Choose **Find Plex servers**, select the server and address, and choose **Save server and import users**. **Users** lists the owner, the Home user, and the grant user.
2. **Connect Jellyfin.** Enter the server URL, including the reverse proxy path if you use one, and an API key. Choose **Connect and import users**. Expect "Jellyfin users imported. Open Users to pair people."
3. **Pair the users.** On **Users**, pair the Plex grant user with the Jellyfin user and choose **Create pairing**. Make every watched change and check below while signed in as these two users.
4. **Plex to Jellyfin.** On Plex, mark movie A and episode A watched. Choose **Preview changes**. It lists both items with "Mark watched in Jellyfin", and both are still unwatched in Jellyfin. Choose **Sync watched status now**. Both become watched in Jellyfin.
5. **Jellyfin to Plex.** In Jellyfin, mark movie B and episode B watched. Confirm that both are still unwatched on Plex. Sync. Both become watched on Plex.
6. **Unwatch does not propagate.** Mark movie A unwatched on Plex and movie B unwatched in Jellyfin. Sync. Neither unwatch clears the other server, and the sync marks both items watched again because watched on either side means watched on both.
7. **Repeat sync writes nothing.** Sync again. The run shows "0 of 0 planned watched updates applied" and neither server changes.
8. **Hourly sync.** Select **Sync automatically every hour** on the pairing. Mark movie C watched on Plex. Leave Continuarr running for more than an hour. A new run appears without a manual sync, and movie C is watched in Jellyfin. Clear **Sync automatically every hour** afterwards.
9. **Redirects are rejected.** Set up an address that redirects every path to the Jellyfin server. A redirect on the root path alone is not enough because Continuarr requests `System/Info` under the URL you enter. Connect Jellyfin with that address. Expect "The media server redirected this request. Enter the server's final URL." No new server is saved.

## Record the results

Comment on the verification issue with the server versions, the app revision, and each scenario's before and after watched state, run summary, and pass or fail result. Leave out server URLs, tokens, usernames, and server IDs. Open a follow-up issue for any provider behavior that differs from this checklist.

## Restore the servers

Stop Continuarr, then return each test item to the watched state you wrote down. This restores watched flags only. The providers may have recorded each sync as a new play.
