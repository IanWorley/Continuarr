# Jellyfin connection

The signed-in admin opens `Settings` in the shell's header and lands on `/settings`, which shows the saved Jellyfin server URL and whether an API key is stored, never the key. Saving sends a new URL and key together. A rejected URL or key shows its message under that field and marks only that field invalid. After a save the page shows the URL the server stored, `Stored` for the key, and an empty key field.

## Sub-features

- `jellyfin-nothing-saved` shows `Nothing saved yet.` and an empty `Server URL` on a fresh launch.
- `jellyfin-invalid-url` shows the URL message under `Server URL` and marks only that field invalid when the server answers `400`.
- `jellyfin-saved` shows `Connection saved.`, the saved URL, and `Stored` in the `Saved connection` region.
- `jellyfin-read-back` returns `{"url": ...}` from the API with no key.
- `jellyfin-after-reload` keeps the saved URL in the field and leaves the key empty.

## How to get to it (user POV)

- Sign in, then choose `Settings` in the header.
- Open `http://localhost:5173/settings` with a session.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch.
- Nothing has saved a Jellyfin connection in this launch.

- **Open.** Run `control.sh drive jellyfin-connection`. It signs in and chooses `Settings`. Step `01-nothing-saved` is at `/settings` and shows `Nothing saved yet.`.
- **Reject.** It saves `ftp://jellyfin.local` with a valid dummy key. Step `02-invalid-url-rejected` shows a message under `Server URL` and none under `API key`. `rejected-save.json` holds `"status": 400` and `"invalidFields": ["URL"]`.
- **Save.** It saves `http://jellyfin.local:8096` with a dummy key. Step `03-saved` shows `Connection saved.`, the URL, and `Stored`, with an empty `API key`.
- **Side effect.** `connection-read-back.json` holds `{"url": "http://jellyfin.local:8096"}` read from `GET /api/v1/jellyfin/connection` with the browser's session, and no key.
- **Reload.** Step `04-after-reload` shows the saved URL in `Server URL` and an empty `API key`.

## Gotchas

- A second run in the same launch fails at `01-nothing-saved`, because the first run's connection is still saved. Run `cleanup` and `launch` to start over.
- The save never contacts Jellyfin, so the dummy URL and key save fine with no Jellyfin running.
- A `503` with `CONTINUARR_ENCRYPTION_KEY isn't set` means the instance was launched without the key. `control.sh launch` sets one for every launch.
