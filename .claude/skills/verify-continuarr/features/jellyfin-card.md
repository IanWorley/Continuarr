# Jellyfin card

The Media servers page has a Jellyfin card for the server URL and API key. The key field is an empty password box and never shows the saved key. When a key is saved, the field shows dots as placeholder text only, and leaving it empty keeps that key. Save sends only what changed. Under the key, the card says `A key is saved`, `No key saved yet`, or that the saved key can't be read, from the server's `apiKeyState`. Save checks both fields first, with the same rules as the server. It focuses the first bad field and keeps what the admin typed. A `400` puts the card's own message on each field the server names. A `503` turns Save off until the admin reloads settings. Any other failure keeps the entries and offers `Try again`. The pill always shows what is saved, never the result of the last try.

## Sub-features

- `card-first-run` shows `Not configured`, `No key saved yet`, and `Nothing saved yet.` before any save.
- `card-checks` names what to fix in each field, focuses the first one, and sends nothing.
- `card-save` saves with the keyboard, clears the key field, and shows `Saved. Continuarr uses this from now on.`
- `card-stored` shows the saved URL and `A key is saved` after a reload, with the key field empty.
- `card-keep-key` changes the URL on the same server with the key field empty, and the saved key still answers `MATCH`.
- `card-new-host` asks `Send the saved key to <host>?` before an empty key field would send the saved key to a different server. `Cancel` sends nothing.
- `card-unsaved` shows `Unsaved changes` and `Saved: <old URL>` while the URL differs from what is saved.
- `card-save-failed` keeps the entries and shows `Couldn't save your settings.` when the save fails.
- `card-load-failed` shows `Couldn't load settings.` and the `Unknown` pill, and `Retry` loads again.
- `card-no-encryption-key` shows `Continuarr can't store the API key yet.` and turns Save off after a `503`.
- `card-layout` uses 36px controls with labels in a 128px column on desktop, and 44px controls with labels above the fields at 720px and below.

## How to get to it (user POV)

- Sign in. Home opens Settings, on the Media servers page.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch, and nothing is saved yet.

- **Journey.** Run `control.sh drive jellyfin-card`. It runs at 1440 by 900, then at 390 by 844.
- **First run.** Step `01-desktop-first-run` shows the empty card. Fields and Save are 36px, and the label column is 128px wide.
- **Checks.** Step `02-desktop-key-required-keyboard` types a URL and presses Enter with no key. Focus moves to the key field. Step `03-desktop-two-fields-wrong` shows both field messages and `Fix 2 fields`.
- **Save.** Step `04-desktop-saved-keyboard` saves with Tab and Enter. `GET` then returns the URL with `"apiKeyState":"STORED"`.
- **Stored.** Step `05-desktop-stored-after-reload` reloads and shows `A key is saved` with dots as the placeholder and an empty key field.
- **Keep the key.** Step `06-desktop-same-server-kept-key` saves a new port and path with the key field empty. `GET` shows the new URL with `STORED`, and the match endpoint answers `MATCH`.
- **New host.** Step `07-desktop-new-host-prompt` shows the prompt for a different server. `Cancel` changes nothing on the server. Step `08-desktop-new-host-saved` saves after `Send saved key`, and the saved key still answers `MATCH`.
- **Unsaved.** Step `09-desktop-unsaved-changes` edits the URL and shows `Saved: <old URL>`.
- **Failures.** Steps `10-desktop-save-failed-stubbed-500` and `11-desktop-load-failed-stubbed-500` answer the request with a `500` from the browser's network layer, because a live server can't be made to fail on demand. `Retry` then loads the real settings.
- **Phone.** Step `12-phone-stored` checks 44px controls, labels above fields, and a full-width Save. Step `13-phone-url-wrong` shows a field message.
- **Side effect.** `jellyfin-card.json` holds the measured sizes, the `GET` after the first save, and the `GET` and match result after each kept-key save. No response and no line of `backend.log` holds the key.
- **No encryption key.** Run `cleanup`, then `CONTINUARR_VERIFY_ENCRYPTION_KEY= control.sh launch`, `control.sh drive first-run-setup`, and `control.sh drive jellyfin-card-no-encryption-key`. Steps `01-desktop-503` and `02-phone-503` show the banner with Save off. Step `03-phone-after-reload-settings` turns Save back on. `jellyfin-card-no-encryption-key.json` shows nothing was stored.

## Gotchas

- `jellyfin-card` needs nothing saved yet. Run it before `jellyfin-connection` in a launch, or relaunch.
- The card's region is named `Jellyfin`. Scope locators to it, because the header search field also sits on the page.
- The saved key is never shown, so after a save the key field is empty by design.
