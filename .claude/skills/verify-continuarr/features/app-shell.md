# App shell

Once signed in, every page sits in one frame. A fixed header holds the menu button, the Continuarr name, the [search field](./header-search.md), the admin's username, and `Sign out`. From tablet width up, an icon rail runs down the left edge. The menu button opens a labelled drawer of the same destinations below the header, with the page behind it dimmed and locked. Only Settings has a page so far. The other destinations show as coming later. Home opens Settings, on the Media servers page.

## Sub-features

- `home-opens-settings` sends `/` to `/settings/media-servers`, where the rail marks Settings as the current page.
- `drawer-open` opens the drawer, focuses its first link, and makes the page and the other header controls unreachable.
- `drawer-focus-trap` keeps Tab on the menu button and the drawer's links.
- `drawer-close` closes the drawer on Escape, on a click outside it, on the menu button, or on choosing a destination, and focus returns to the menu button.
- `phone-layout` hides the rail below 721px and turns `Sign out` into a 44px icon button.

## How to get to it (user POV)

- Sign in at `http://localhost:5173/login`.
- Choose `Open navigation` at the left of the header.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch.

- **Home.** Run `control.sh drive app-shell`. It signs in at 1440 by 900. Step `01-desktop-home` is at `/settings/media-servers` with the heading `Media servers`, and `Sign out` is 36px tall.
- **Rail.** Step `02-desktop-rail-tip` hovers Settings in the rail and shows its label.
- **Open.** Step `03-desktop-drawer-open` shows the drawer with the page dimmed. Focus is on `Settings`, the page is inert, and the root element doesn't scroll.
- **Trap and Escape.** Tab moves to `Close navigation`, then back to `Settings`. Escape closes the drawer and focuses `Open navigation`, in step `04-desktop-drawer-escape`.
- **Scrim and destination.** A click right of the drawer closes it. Choosing `Settings` in the drawer closes it and stays on the page.
- **Phone.** At 390 by 844, step `05-phone-home` has no rail, and `Sign out` is a 44px square. Step `06-phone-drawer-open` shows the drawer.
- **Side effect.** `shell-state.json` holds the root class, the page's `inert` state, and the computed overflow before and after opening, the Tab order, and the measured `Sign out` sizes.

## Gotchas

- The drawer's `Main menu` navigation and the rail's `Main` navigation both hold a `Settings` link. Scope a locator to one of them.
- The rail is hidden on phones, so a rail locator there finds no visible element.
