# Continuarr verification map

Start with [the session skill](../SKILL.md). Each recipe assumes a dedicated fixture database and the recorded browser origin. Port numbers below follow the skill's example; substitute the run's actual ports.

| Feature | Entry points | Proof |
| --- | --- | --- |
| [Owner](owner.md) | `/sign-in`, Sign out | Session survives reload; logout removes access |
| [Connections](connections.md) | `/`, Connections & sync | Saved servers, imported users, persisted shared schedule |
| [Users](users.md) | `/users`, Users | One-to-one pairing, preview without writes, repeatable watched sync |
| [Manual matching](matching.md) | `/matches`, Manual matching | Saved match survives reload and controls the preview |

Capture actions and results, with an API or fixture-state read for side effects. Do not mark a real Plex OAuth flow verified by the seeded Plex profile. Mark unreachable entry points blocked with the unmet precondition. The fixture starts with two automatic media matches and deliberately unmatched episodes for manual matching.
