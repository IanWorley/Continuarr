# Working synthesis contract

Base A: retain provider-specific tables, add Plex servers and one directory polling singleton. Graft B explicit enabled flag and durable due claim. Reject generic table migration, automatic pairing sync enablement, and combined watched-sync cadence. Keep watched sync opt-in hourly.

UI/API contract to coordinate implementation (backend may propose simpler equivalent before edits):
- POST /plex/select body {accountId}: selectPlexServer -> {id, servers:[{id,name,connections:string[]}]} owned servers only; NO userId/Home PIN.
- POST /plex/connect body unchanged {selectionId,serverId,url}: connectPlex saves server, imports users, returns {id,importedCount}.
- Remove old GET /plex/:id/users from UI; directory users read from state, no Home switch API anywhere in production path.
- GET /state adds plexServers [{id,accountId,externalId,name,url,lastAttemptAt,lastSuccessAt,lastError}], directoryPolling {enabled,intervalMinutes,nextAttemptAt,lastAttemptAt}; plexProfiles adds presence ('present'|'missing'|'unverified'), accessStatus ('available'|'unavailable') and connectionId. Existing profiles allowed legacy access until adopted; no token leak.
- GET /jellyfin/directory unchanged summary, remove per-server polling from UI.
- POST /directory/polling {enabled,intervalMinutes}: configureDirectoryPolling
- POST /directory/refresh: refreshDirectories -> {results:[{kind:'plex'|'jellyfin',id,result:{kind:'updated'|'superseded'|'failed',importedCount?,message?}}]}
- Existing Jellyfin per-server refresh retained. No need new per-server Plex refresh UI, global button sufficient.

Connections retains current two cards, Plex owner OAuth+server selection only, saved server statuses. One user-import settings panel below cards. Users lists both saved directories and pairing/sync controls, unavailable/missing profiles excluded from new pairs and guarded backend. Existing profile/pairing IDs persist. Legacy profile tokens remain functional until verified owner adoption; no destructive migration or silent reauthorization assumptions.

No real watched writes during verification; live read-only grants checked, fixture covers writes.

## Synthesis decision

Compared provider-specific storage against a unified connection/profile schema. Chose provider-specific storage, also preferred by the independent reviewer, because it preserves existing keys and relationships with an additive migration and keeps credential ownership explicit. Grafted an enabled flag and durable singleton due claim. Rejected automatic watched sync on pairing, combining watched cadence with imports, and replacing all profile tables.

The reviewer suggested disabling legacy credentials until reconnect. We retain working legacy per-profile credentials until adoption to avoid disrupting existing pairings; these never become evidence of server ownership. Fresh owner connection replaces them using owner-authorized per-user grants. The reviewer also requested scoped write verification; fixture tests must prove token isolation and writes, while real Plex validation remains read-only. No claim of live production writes is made.

## Grounding and evidence

# No-Home-PIN feasibility

Read-only live probe, 2026-09-26, owner credentials already authorized in the isolated Continuarr session. Secrets never logged. No watched writes, Home switches, or PIN attempts were performed.

- Owner account is marked protected in Home listing but has its own OAuth credential.
- Two Home members also have accepted grants for the owned server.
- Both grant tokens returned HTTP 200 for library sections and a movie sample. One sample contains watched metadata; the other lacks watched metadata, normal for an unwatched sample.
- Third shared user grant returned HTTP 200 for library sections; no movie section in sample probe.
- No claim of a production write test: existing user-scoped scrobble implementation/fixture validates write protocol; live check only establishes granted user-scoped reads.
- Python PlexAPI MyPlexUser.get_token uses the same owner-authorized /api/servers/{machineId}/shared_servers API. Source https://github.com/pkkid/python-plexapi/blob/master/plexapi/myplex.py, retrieved in this task.

Conclusion: server-specific user grants support this installation's PIN-free directory/read workflow. Do not treat Home membership as excluding a grant. Do not use owner token for another user's data. Missing/revoked grants must mark sync unavailable, without requesting a PIN. Watched status union is current product scope, not timestamp/play-count event history.
