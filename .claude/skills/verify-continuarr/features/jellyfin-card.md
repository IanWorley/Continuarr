# Jellyfin card

The Media servers page has a Jellyfin card for the server URL and API key. The key field is an empty password box and never shows the saved key. Under the key, the card says `A key is saved` or `No key saved yet`, from the server's `apiKeyState`. Save checks both fields first, with the same rules as the server. It focuses the first bad field and keeps what the admin typed. A `400` puts the card's own message on each field the server names. Any other failure keeps the entries and offers `Try again`. The pill always shows what is saved, never the result of the last try.

## Sub-features

- `card-first-run` shows `Not configured`, `No key saved yet`, and `Nothing saved yet.` before any save.
- `card-checks` names what to fix in each field, focuses the first one, and sends nothing.
- `card-save` saves with the keyboard, clears the key field, and shows `Saved. Continuarr uses this from now on.`
- `card-stored` shows the saved URL and `A key is saved` after a reload, with the key field empty.
- `card-unsaved` shows `Unsaved changes` and `Saved: <old URL>` while the URL differs from what is saved.
- `card-save-failed` keeps the entries and shows `Couldn't save your settings.` when the save fails.
- `card-load-failed` shows `Couldn't load settings.` and the `Unknown` pill, and `Retry` loads again.
- `card-layout` uses 36px controls with labels in a 128px column on desktop, and 44px controls with labels above the fields at 720px and below.

## How to get to it (user POV)

- Sign in. Home opens Settings, on the Media servers page. Before anything is saved, pick Jellyfin from `Add server`.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch, and nothing is saved yet.

- **Journey.** Run `control.sh drive jellyfin-card`. It runs at 1440 by 900, then at 390 by 844.
- **First run.** The journey adds the card from `Add server`. Step `01-desktop-first-run` shows the empty card. Fields and Save are 36px, and the label column is 128px wide.
- **Checks.** Step `02-desktop-key-required-keyboard` types a URL and presses Enter with no key. Focus moves to the key field. Step `03-desktop-two-fields-wrong` shows both field messages and `Fix 2 fields`.
- **Save.** Step `04-desktop-saved-keyboard` saves with Tab and Enter. `GET` then returns the URL with `"apiKeyState":"STORED"`.
- **Stored.** Step `05-desktop-stored-after-reload` reloads and shows `A key is saved` with the key field empty. Step `06-desktop-unsaved-changes` edits the URL.
- **Failures.** Steps `07-desktop-save-failed-stubbed-500` and `08-desktop-load-failed-stubbed-500` answer the request with a `500` from the browser's network layer, because a live server can't be made to fail on demand. `Retry` then loads the real settings.
- **Phone.** Step `09-phone-stored` checks 44px controls, labels above fields, and a full-width Save. Step `10-phone-url-wrong` shows a field message.
- **Side effect.** `jellyfin-card.json` holds the measured sizes and the `GET` after the save. No response and no line of `backend.log` holds the key.

## Gotchas

- `jellyfin-card` needs nothing saved yet. Run it before `jellyfin-connection` in a launch, or relaunch.
- The card's region is named `Jellyfin`. Scope locators to it, because the header search field also sits on the page.
- The saved key is never shown, so after a save the key field is empty by design.
