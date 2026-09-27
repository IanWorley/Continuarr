# Shared navigation

- [x] `how` over the affected subsystem. Root beforeLoad guards app pages; the sign-in page is public; /plex redirects home. Navigation belongs to the root layout, outside route content.
- [x] `architect` for parallel design exploration. Skipped panels for this small two-destination UI per the user's proportional-ceremony instruction. Compare a top bar with mobile disclosure against a permanent sidebar; use the top bar because two destinations do not justify reserved sidebar width.
- [x] Write the throughput checkpoint as four todo items.
  - Blocking first steps: trace routing/auth and identify shared destinations.
  - Independent workstreams: implementation agent owns navigation and three route files; parent owns browser checks, audit, and delivery.
  - Shared mutable state: one source writer; reuse this task's isolated test app.
  - Smallest safe decomposition: one shared component backed by a typed destination registry.
- [x] Delegate code-writing to a subagent using the configured feature model.
- [x] Verify on the matching surface.
- [x] Rebase into small, ordered commits. No rebase needed; add a conventional follow-up commit to the existing PR.
- [x] If the design is contested, `interrogate` before shipping. Skip unless a contested design appears.
- [x] Run Opening a PR. Update existing PR #119.

Acceptance: desktop navigation and active page; mobile menu open/close, route selection and Escape; shared sign-out; hidden on sign-in; reload and browser history; visible keyboard focus and no horizontal overflow.

Verification passed in the running isolated app: desktop current-page tabs and both routes, 320px mobile layout without overflow, Enter/Tab/Escape and focus return, menu close on selection, shared sign-out from matching, sign-in without navigation, return sign-in, browser Back, and direct reload. Typecheck, Biome, and production build passed. No comments or suppressions were added.
