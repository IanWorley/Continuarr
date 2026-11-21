# Media servers page

The Media servers page shows one card per configured server. A server with nothing saved has no card until the admin picks it from `Add server`, which lists only the types without a card and goes away once both have one. `Reload` loads what is saved again. When a card has unsaved edits, it first asks `Discard unsaved changes to <servers>?`. The Plex card shows whether Plex is linked, and `Unlink` forgets the saved connection after an inline confirm. Linking through plex.tv, `Re-link`, and the server picker are shown but disabled until that backend exists. Each card ends in a dimmed `Sync` zone, tagged `Later`, that nothing in responds to.

## Sub-features

- `page-empty` shows `No media servers yet.` when nothing is saved, and `Add server` offers Jellyfin and Plex.
- `page-add` adds a card, moves focus to its heading, and drops that type from `Add server`.
- `page-reload` loads again without asking when nothing is unsaved.
- `page-reload-confirm` asks `Discard unsaved changes to Jellyfin?`. `Cancel` keeps the edits, and `Discard changes` puts back what is saved.
- `plex-linked` shows `Linked`, with `Seeded from CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN.` or `Linked through plex.tv.`
- `plex-expired` shows `Re-link needed`, the `Your Plex link expired.` banner, and a disabled `Re-link with plex.tv`.
- `plex-unlink` asks `Unlink Plex?`, then shows `Unlinked.` and `Not linked`, and `GET /api/v1/plex/connection` returns nothing saved.
- `card-later-zone` is a disabled group named `Sync Later` whose switch is `aria-disabled` and out of the tab order.

## How to get to it (user POV)

- Sign in. Home opens Settings, on the Media servers page.

## Driving it with control.sh

Preconditions:

- Export a made-up `CONTINUARR_PLEX_URL` and `CONTINUARR_PLEX_TOKEN` for both `launch` and `drive`, so Plex starts linked.
- `control.sh drive first-run-setup` passed earlier in this launch, and nothing else is saved.

- **Journey.** Run `control.sh drive media-servers`. It runs at 1440 by 900, then at 390 by 844.
- **Seeded.** Step `01-desktop-plex-seeded` shows only the Plex card. Step `02-desktop-add-server-open` shows `Add server` offering only Jellyfin. Step `03-desktop-both-cards` adds it.
- **Reload.** Step `04-desktop-reload-asks` types a URL and presses `Reload`. Step `05-desktop-reload-discarded` discards the edit.
- **Plex states.** The journey changes the Plex row with `psql` to reach states a fresh database can't, and the step names say so. Step `06` sets the source to plex.tv. Step `07` clears the token, which shows the expired link.
- **Unlink.** Steps `08-desktop-unlink-asks` and `09-desktop-unlinked`. `GET` then returns `{"url":null,"source":null,"tokenState":"NONE"}`.
- **Empty.** Step `10-desktop-empty` reloads the browser, so the unsaved Jellyfin card and the unlinked Plex card are gone.
- **Phone.** Steps `11-phone-empty` and `12-phone-both-cards`, with 44px toolbar buttons.
- **Side effect.** `media-servers.json` holds the `GET` bodies, the `Sync` zone's state, and the status of an `Unlink` without a session. No response and no line of `backend.log` holds the token.

## Gotchas

- Run it on a launch of its own. It unlinks Plex, so `plex-connection` can't follow it in the same launch.
- An unlinked seed comes back on the next start while the variables are set.
- Cards are regions named `Jellyfin` and `Plex`. Scope locators to them, because both cards have a `Server` row and buttons with the same names.
