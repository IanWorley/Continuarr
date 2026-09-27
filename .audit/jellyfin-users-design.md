# Jellyfin user directory

## Problem and existing flow

The branch is rebased onto main `7172000`, including Plex/shared-user API-key work in #118 and navigation/manual matching in #119. Plex OAuth remains in `PlexConnect`. Jellyfin currently lists users but saves only the chosen profile and discards UserDto fields other than ID/name. Credentials are copied across profiles. Pairings and manual matches depend on those stable profile IDs.

## Usage

Connect a Jellyfin server on `/users` with its URL and API key. One submission imports every returned user. Inspect a user's details and pair them with a saved Plex profile on that same page. Refresh manually or configure automatic import, enabled hourly by default. Home retains Plex connection and watched-sync controls. Manual matching retains its existing pairing references.

Proposed service calls hide credential ownership and reconciliation:

```ts
await media.importJellyfin({ kind: "new", url, apiKey });
const directory = await media.jellyfinDirectory();
await media.configureJellyfinPolling(serverId, true, 60);
await media.refreshJellyfinUsers(serverId);
await media.addPairing({ plexProfileId, jellyfinProfileId });
```

These operations hide credential ownership, refresh reconciliation, and polling persistence.

## Shape

`jellyfin_servers` owns the encrypted key, URL, external identity, persisted poll configuration, revision, and refresh status. Existing profiles gain a server reference and full JSONB UserDto data. The provider validates known identity/availability fields while preserving the returned JSON. It fetches one authenticated server identity and unfiltered user directory.

The repository commits each successful snapshot atomically, retaining profile IDs and marking absent users missing. Failures preserve the last successful directory. Revision checks prevent a refresh that used old credentials from overwriting a replacement. Missing or disabled users cannot form new pairings or run watched sync. Metadata is returned through the users page's query, not added to the home page's frequent polling payload.

The existing minute timer runs due directory imports independently from watched-history sync. The interval and attempt/success/error state live in Continuarr PostgreSQL. A failure waits for the configured interval unless the owner requests a manual retry.

Backfill decrypts credentials under original profile IDs before re-encrypting under the new server record ID. It preserves all original IDs and legacy columns. Conflicting old credentials must be reported rather than guessed. No destructive migration is authorized.

## Synthesis decision

Two independent candidates were compared. GPT 6.0 Astra proposed normalized server ownership. GPT 6.0 Sol proposed a directory table retaining profile-owned credential copies. GPT 6.0 Luna independently judged both against workflow, reference preservation, migration/concurrency, interface size, and polling isolation.

The normalized server model won. It provides one authority for keys and configuration, including servers with zero users. Retaining profile-owned keys would require every refresh/rotation to coordinate multiple copies. From the other candidate, adopt explicit enable/disable configuration, named interval bounds, and strict response validation. Use `/Users` once because it already returns UserDto records; avoid per-user requests without evidence that more information is available there.

## Tradeoffs and risks

- Additive schema plus application credential backfill is more work than retaining duplicated keys, but removes permanent credential synchronization.
- The scheduler checks due imports once a minute while the process runs. Long-running work can delay a tick. Existing single-process deployment remains required.
- “All information” means the complete UserDto returned by Jellyfin, including policy and configuration. It does not imply importing sessions or playback history.
- Old password-login tokens or inconsistent historical keys can require operator replacement. Preserve existing data and identify affected records safely.

## Implementation and verification

One code owner handles the coupled schema, provider, repository, service, UI, fixture, and focused tests. Parent handles design review and live verification. Test stable IDs, full metadata, persistence after service recreation, scheduling boundaries, empty/missing users, failed refresh retention, key rotation races, and existing watched-sync/manual-matching behavior.

An isolated app is available on port 3011, with a separate PostgreSQL fixture. Real Plex authorization and fixture-based Jellyfin checks are separate evidence.
