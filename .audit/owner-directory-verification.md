# Owner directory verification

The isolated app used port 3011 and the existing fixture PostgreSQL database. Applied migrations 0003 and 0004 without removing profiles or pairings. Both existing pairing IDs stayed unchanged, and automatic watched sync remained off.

## Browser and live reads

- Reused the owner's previously completed Plex OAuth authorization. Find Plex servers offered the owned server. Saving its advertised address succeeded and imported the owner, two Home members, and one shared user. No Home PIN field, input, or Home switch was used.
- Users displayed those four Plex identities plus the separate existing local fixture profile, along with both imported Jellyfin fixture users. Existing pairings remained visible.
- Changed global import interval to 30 minutes, saved, reloaded, and confirmed PostgreSQL retained 30. Disabled automatic imports, saved, and confirmed the UI state. Refresh all users now still updated both Plex and Jellyfin server timestamps and reported success. Restored enabled hourly imports.
- The initial due scheduled import also advanced both servers' timestamps and persisted the next shared due time.
- The local fixture pairing preview returned zero updates, two matched pairs, six unmatched items, and zero ambiguous items. Running that fixture pairing completed with zero updates. No real Plex watched write was performed.
- Connections and Users were checked at 390 CSS pixels without horizontal overflow. Matching connection cards and shared settings remained usable.

## Feasibility limits

Live verification established owner-authorized per-user server grants and library reads. User-specific scrobble writes are tested through fixtures, not real accounts. The product merges watched flags, not historical event timestamps or play counts.

## Review

Compared two architecture candidates and selected provider-specific storage. A separate backend review identified legacy owner adoption and shared-user name regressions; both were sent for correction. Parent review additionally identified stale reconnect, missing legacy adoption, and nullable credential cases. These cases are covered by focused tests before completion.

## Final validation

- Full test suite: 125 passed, 0 failed.
- Typecheck, Biome across 79 files, Drizzle migration check, production build, and diff check passed.
- Tests retain library pagination, duplicate/incomplete inventory, server identity/library access, credential redirect rejection, and scoped watched writes. Removed Home-switch behavior tests were replaced with owner/grant import tests.
- Added cases prove unavailable users have no credential, missing legacy users cannot bypass adoption guards, a true owner can adopt an unverified candidate, optional shared-name enrichment survives, and stale reauthorization/reconnect results cannot win.
- Restarted app cleanly; hourly enabled schedule and server/user data persisted. The local sessions were retained for follow-up checks.
- Final desktop screenshot was captured in local browser evidence; the machine-specific path is omitted from this committed report.
