# Header search

The signed-in header holds a search field. It searches nothing yet, so typing in it sends no request. On desktop the field sits next to the Continuarr name. On phones a search button in the header opens it as a full-width row under the header, and the page moves down to make room.

## Sub-features

- `desktop-field` shows a 36px field, 300px wide above 1100px and 220px wide at 1100px and below, with no clear button inside it.
- `phone-open` opens a 56px row under the header from the 44px `Search` button, focuses the field, and moves the page and its toolbar down by the row's height.
- `phone-close` closes the row on Escape, on `Close search`, on the `Search` button again, on a click outside the header, or when the drawer opens. Escape and `Close search` return focus to the `Search` button.
- `no-request` sends nothing while the admin types or presses Enter.

## How to get to it (user POV)

- Sign in at `http://localhost:5173/login`.
- On desktop, click the `Search` field in the header.
- On a phone, choose the `Search` button at the right of the header.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch.

- **Desktop.** Run `control.sh drive header-search`. It signs in at 1440 by 900, types into the field, and presses Enter. Step `01-desktop-search-typed` shows the field with text and no clear button. At 1100 wide the field is 220px.
- **Phone.** At 390 by 844, step `02-phone-home` shows the `Search` button. Step `03-phone-search-open` shows the row with focus in the field, the heading 56px lower, and the toolbar's sticky offset at 112px. Step `04-phone-search-typed` shows one X.
- **Close.** Escape closes the row in step `05-phone-search-escape`. `Close search`, a click on the heading, and `Open navigation` each close it too, and the heading moves back up. Step `06-phone-drawer-over-search` shows the drawer with the row closed.
- **Side effect.** `search-state.json` holds the measured sizes, the heading's position with the row open and closed, the toolbar's sticky offset, and every `/api` request the page made during the journey, which must be none.

## Gotchas

- The phone `Search` button and the field share the name `Search`. Locate the button by role `button` with an exact name, and the field by role `searchbox`.
- On desktop the `Search` button is hidden, and on phones the field is hidden until the row opens.
