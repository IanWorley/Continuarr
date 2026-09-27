# Bound manual-matching library rendering

Plan
- [x] Reproduce on the running browser surface.
- [x] Trace root cause: LibraryPicker maps every filtered item with empty default filters.
- [x] Implement local per-picker pagination, named page size 25, filter resets, clamping after inventory shrink, and selection/scroll reset on page changes.
- [x] Verify original large-library reproduction plus paging, search beyond page one, filter reset, empty results, shrink, and normal saving.
- [x] Review, check, commit, and update PR #119.

Throughput: parent owns runtime/evidence and delivery; one implementation agent owns matches.tsx. No shared source writes. No architecture panel for the explicit local pagination change.

Before: browser response substituted 2,000 synthetic episodes on each provider using a temporary fetch wrapper. Provider data and server state were unchanged. DOM inspection returned {"perSide":[2000,2000],"radios":4000}. This proves the unbounded rendering; no latency claim is made.

The browser wrapper changes only successful /pairings/:id/library GET responses. Synthetic IDs start with test-plex- and test-jellyfin-. Do not save synthetic selections. Reload the page to remove the wrapper before verifying real fixture saves.

After: the same browser inventory returned {"perSide":[25,25],"radios":50}. Next on Plex displayed 26–50 while Jellyfin stayed 1–25. Page navigation cleared the selected radio and reset list scrollTop to 0. Searching for Test episode 2000 found that item beyond the first page. A nonexistent search showed 0–0 of 0. Changing season from a later page reset to 1–25 of 100. Refreshing from 2,000 items to seven clamped both pickers to 1–7 with both navigation buttons disabled.

After a full reload removed the browser response wrapper, saved fixture pair 4/j4 successfully. Watched state remained Plex [1,3,2], Jellyfin [j2,j1,j3]. All 110 tests, typecheck, Biome, build, and diff whitespace checks passed. No new comments/suppressions.
