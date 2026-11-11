# Jellyfin connection

The admin saves the Jellyfin server URL and API key with `PUT /api/v1/jellyfin/connection`. A bad URL or key answers `400` and names the fields without echoing them. Without `CONTINUARR_ENCRYPTION_KEY` a save answers `503` and stores nothing. `GET` returns the saved URL and `apiKeyState`, never the key. `apiKeyState` is `NONE` before a save, `STORED` when the saved key decrypts, and `UNREADABLE` when it doesn't, such as after the encryption key changed.

## Sub-features

- `jellyfin-nothing-saved` answers `{"url": null, "apiKeyState": "NONE"}` on a fresh launch.
- `jellyfin-save-rejected` answers `400` with `{"invalidFields": ["URL", "API_KEY"]}` and stores nothing.
- `jellyfin-save` answers `204`. The next `GET` returns the URL with `"apiKeyState": "STORED"`.
- `jellyfin-key-hidden` keeps the key out of every response and out of the backend log.
- `jellyfin-no-encryption-key` answers `503` when the server has no encryption key.

## How to get to it (user POV)

- Sign in, then call `/api/v1/jellyfin/connection` with the session cookie, as the settings page does. A `PUT` also needs the CSRF header.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch.

- **Journey.** Run `control.sh drive jellyfin-connection`. It signs in through the UI, in step `01-signed-in`, then calls the API with the browser's session.
- **Nothing saved.** The first `GET` returns `{"url": null, "apiKeyState": "NONE"}`.
- **Rejected.** A `PUT` with an `ftp://` URL and a key with spaces answers `400` with both fields named, and the next `GET` is unchanged.
- **Saved.** A `PUT` with a valid URL and a random 32-character key answers `204`. The next `GET` returns the URL with `"apiKeyState": "STORED"`.
- **Key hidden.** No response and no line of `backend.log` contains the key. The journey makes a new key for each run and never writes it to the evidence.
- **Side effect.** `jellyfin-connection.json` holds the `GET` before and after, the rejected response, and the save's status.
- **No encryption key.** Run `cleanup`, then `CONTINUARR_VERIFY_ENCRYPTION_KEY= control.sh launch` and `control.sh drive first-run-setup`. Sign in with `curl` as in [access control](./access-control.md), then send the `PUT` with a valid URL and key. It answers `503`, and `GET` still returns `"apiKeyState": "NONE"`.

## Gotchas

- Each launch starts with an empty database, so `UNREADABLE` can't be reached live. The backend tests cover it by saving under one encryption key and reading under another.
- The journey sends its requests through the Vite proxy on `5173`, so they carry the browser's session and CSRF cookies.
