# Jellyfin connection

The signed-in admin opens `Settings` in the shell's header and lands on `/settings`, which shows the saved Jellyfin server URL and whether an API key is stored, never the key. Saving sends a new URL and key together. A rejected URL or key shows its message under that field and marks only that field invalid. After a save the page shows the URL the server stored, `Stored` for the key, and an empty key field.

The page calls `PUT /api/v1/jellyfin/connection` to save and `GET` on the same path to read the saved URL back. `GET` never returns the key. A bad URL or key answers `400` and names the field without echoing its value. Saving needs `CONTINUARR_ENCRYPTION_KEY`, because the key is stored encrypted. Without it the save answers `503`. Saving doesn't contact Jellyfin. [Configuration in `docs/plan.md`](../../../../docs/plan.md#configuration) is the source for these rules.

## Sub-features

- `jellyfin-nothing-saved` shows `Nothing saved yet.` and an empty `Server URL` on a fresh launch.
- `jellyfin-invalid-url` shows the URL message under `Server URL` and marks only that field invalid when the server answers `400`.
- `jellyfin-saved` shows `Connection saved.`, the saved URL, and `Stored` in the `Saved connection` region.
- `jellyfin-read-back` returns `{"url": ...}` from the API with no key.
- `jellyfin-after-reload` keeps the saved URL in the field and leaves the key empty.
- `jellyfin-needs-session` answers `401` to `GET` without a session.
- `jellyfin-empty` answers `{"url":null}` before a save.
- `jellyfin-csrf` rejects a `PUT` without the CSRF header with `403`.
- `jellyfin-invalid` answers `400` with `invalidFields`, such as `["URL"]` or `["API_KEY"]`.

## How to get to it (user POV)

- Sign in, then choose `Settings` in the header.
- Open `http://localhost:5173/settings` with a session.
- Call the backend on `http://localhost:8080` with `curl`, as a script or an API client would.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch, so `$RUN_DIR/admin-credentials.json` holds the admin.
- Nothing has saved a Jellyfin connection in this launch.

- **Open.** Run `control.sh drive jellyfin-connection`. It signs in and chooses `Settings`. Step `01-nothing-saved` is at `/settings` and shows `Nothing saved yet.`.
- **Reject.** It saves `ftp://jellyfin.local` with a valid dummy key. Step `02-invalid-url-rejected` shows a message under `Server URL` and none under `API key`. `rejected-save.json` holds `"status": 400` and `"invalidFields": ["URL"]`.
- **Save.** It saves `http://jellyfin.local:8096` with a dummy key. Step `03-saved` shows `Connection saved.`, the URL, and `Stored`, with an empty `API key`.
- **Side effect.** `connection-read-back.json` holds `{"url": "http://jellyfin.local:8096"}` read from `GET /api/v1/jellyfin/connection` with the browser's session, and no key.
- **Reload.** Step `04-after-reload` shows the saved URL in `Server URL` and an empty `API key`.

## Driving the API with curl

Run these from a scratch directory on a fresh launch, before the journey saves anything. `RUN_DIR` is `~/.local/state/continuarr-verify/run`, or `$CONTINUARR_VERIFY_HOME/run`.

- **Session required.** Run `curl -s -w ' %{http_code}\n' http://localhost:8080/api/v1/jellyfin/connection`. It prints ` 401`.
- **Sign in.** Fetch the CSRF token with `curl -s -o /dev/null -c cookies.txt http://localhost:8080/api/csrf`. Then run `curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -c cookies.txt -H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)" --data-urlencode "username=$(node -p "require('$RUN_DIR/admin-credentials.json').username")" --data-urlencode "password=$(node -p "require('$RUN_DIR/admin-credentials.json').password")" http://localhost:8080/api/login`. It prints `204`. Signing in replaces the CSRF cookie in `cookies.txt`, so the steps below read the token afresh each time. A token read before sign-in answers `403`.
- **Empty.** Run `curl -s -w ' %{http_code}\n' -b cookies.txt http://localhost:8080/api/v1/jellyfin/connection`. It prints `{"url":null} 200`.
- **CSRF.** Run `curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X PUT -H 'Content-Type: application/json' -d '{"url":"http://localhost:8096","apiKey":"k"}' http://localhost:8080/api/v1/jellyfin/connection`. It prints `403`.
- **Invalid.** Send the same `PUT` with `-H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)"` and `-w ' %{http_code}\n'` instead of `-o /dev/null`, and the body `{"url":"not a url","apiKey":"k"}`. It prints `{"invalidFields":["URL"]} 400`. The body `{"url":"http://localhost:8096","apiKey":""}` prints `{"invalidFields":["API_KEY"]} 400`.

## Gotchas

- A second journey run in the same launch fails at `01-nothing-saved`, because the first run's connection is still saved. Run `cleanup` and `launch` to start over.
- Use a placeholder API key, never a real one. The save never contacts Jellyfin, so the dummy URL and key save fine with no Jellyfin running.
- `control.sh launch` sets a new random `CONTINUARR_ENCRYPTION_KEY` for every launch and never writes it down. So a launched instance can't answer the `503` for a missing key. The frontend tests cover that message.
- Without a saved connection, the backend log has a `Jellyfin connection check failed: Jellyfin connection not configured` warning at startup. That is expected on every launch.
- Keep `cookies.txt` in the scratch directory and delete it afterward. It holds a session cookie once you sign in.
