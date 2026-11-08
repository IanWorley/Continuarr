# Jellyfin connection

The signed-in admin saves the Jellyfin server's URL and API key with `PUT /api/v1/jellyfin/connection` and reads the saved URL back with `GET` on the same path. `GET` never returns the key. A bad URL or key answers `400` and names the field without echoing its value. Saving needs `CONTINUARR_ENCRYPTION_KEY`, because the key is stored encrypted. Without it the save answers `503`. Saving doesn't contact Jellyfin. [Configuration in `docs/plan.md`](../../../../docs/plan.md#configuration) is the source for these rules.

## Sub-features

- `jellyfin-needs-session` answers `401` to `GET` without a session.
- `jellyfin-empty` answers `{"url":null}` before a save.
- `jellyfin-csrf` rejects a `PUT` without the CSRF header with `403`.
- `jellyfin-invalid` answers `400` with `invalidFields`, such as `["URL"]` or `["API_KEY"]`.
- `jellyfin-no-encryption-key` answers `503` to a valid `PUT` when the launch has no `CONTINUARR_ENCRYPTION_KEY`.
- `jellyfin-saved` answers `204` to a valid `PUT`, and `GET` then returns the URL and no key.

## How to get to it (user POV)

- There is no UI for it yet. Call the backend on `http://localhost:8080` with `curl`, as a script or an API client would.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch, so `$RUN_DIR/admin-credentials.json` holds the admin.
- For `jellyfin-saved`, launch with a key: `CONTINUARR_ENCRYPTION_KEY=$(openssl rand -hex 32) control.sh launch`. A plain `control.sh launch` has no key, so it covers `jellyfin-no-encryption-key` instead.

Run these from a scratch directory. `RUN_DIR` is `~/.local/state/continuarr-verify/run`, or `$CONTINUARR_VERIFY_HOME/run`.

- **Session required.** Run `curl -s -w ' %{http_code}\n' http://localhost:8080/api/v1/jellyfin/connection`. It prints ` 401`.
- **Sign in.** Fetch the CSRF token with `curl -s -o /dev/null -c cookies.txt http://localhost:8080/api/csrf`. Then run `curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -c cookies.txt -H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)" --data-urlencode "username=$(node -p "require('$RUN_DIR/admin-credentials.json').username")" --data-urlencode "password=$(node -p "require('$RUN_DIR/admin-credentials.json').password")" http://localhost:8080/api/login`. It prints `204`. Signing in replaces the CSRF cookie in `cookies.txt`, so the steps below read the token afresh each time. A token read before sign-in answers `403`.
- **Empty.** Run `curl -s -w ' %{http_code}\n' -b cookies.txt http://localhost:8080/api/v1/jellyfin/connection`. It prints `{"url":null} 200`.
- **CSRF.** Run `curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X PUT -H 'Content-Type: application/json' -d '{"url":"http://localhost:8096","apiKey":"k"}' http://localhost:8080/api/v1/jellyfin/connection`. It prints `403`.
- **Invalid.** Send the same `PUT` with `-H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)"` and `-w ' %{http_code}\n'` instead of `-o /dev/null`, and the body `{"url":"not a url","apiKey":"k"}`. It prints `{"invalidFields":["URL"]} 400`. The body `{"url":"http://localhost:8096","apiKey":""}` prints `{"invalidFields":["API_KEY"]} 400`.
- **Save.** Send the CSRF `PUT` with the body `{"url":"http://localhost:8096","apiKey":"verify-placeholder-key"}`. With a key in the launch it prints ` 204`. Without one it prints ` 503`, and nothing is saved.
- **Side effect.** Run the **Empty** `GET` again. After a `204` it prints `{"url":"http://localhost:8096"} 200`, with no key in the body. After a `503` it still prints `{"url":null} 200`.

## Gotchas

- Use a placeholder API key, never a real one. Nothing checks it against a Jellyfin server.
- Never write the encryption key down. Generate it inline at launch, as above. Each launch starts with an empty database, so a new key loses nothing.
- Without a saved connection, the backend log has a `Jellyfin connection check failed: Jellyfin connection not configured` warning at startup. That is expected on every launch.
- Keep `cookies.txt` in the scratch directory and delete it afterward. It holds a session cookie once you sign in.
