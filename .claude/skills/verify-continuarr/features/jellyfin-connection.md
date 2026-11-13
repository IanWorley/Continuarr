# Jellyfin connection

The signed-in admin saves the Jellyfin server's URL and API key with `PUT /api/v1/jellyfin/connection` and reads back the saved URL and `apiKeyState` with `GET` on the same path. `PATCH` changes only the fields it sends, so a new URL keeps the saved key. `GET` never returns the key. `apiKeyState` is `STORED` once a key is saved and `NONE` otherwise, including a saved URL whose key a database upgrade cleared. A bad URL or key answers `400` and names the field without echoing its value. Saving doesn't contact Jellyfin. `POST /api/v1/jellyfin/connection/api-key/match` takes `{"apiKey": "..."}` and answers `{"result": ...}` with `MATCH`, `MISMATCH`, or `NONE` when no key is saved. It never returns either key. [Configuration in `docs/plan.md`](../../../../docs/plan.md#configuration) is the source for these rules.

## Sub-features

- `jellyfin-needs-session` answers `401` to `GET` without a session.
- `jellyfin-empty` answers `{"url":null,"apiKeyState":"NONE"}` before a save.
- `jellyfin-csrf` rejects a `PUT` without the CSRF header with `403`.
- `jellyfin-invalid` answers `400` with `invalidFields`, such as `["URL"]` or `["API_KEY"]`.
- `jellyfin-saved` answers `204` to a valid `PUT`, and `GET` then returns the URL with `"apiKeyState":"STORED"` and no key.
- `jellyfin-patch` answers `204` to a `PATCH` that sends only `url`, and the saved key still answers `MATCH`. A first `PATCH` without `url` and `apiKey`, or one that moves the URL from `https` to `http` without `apiKey`, answers `400` naming the missing field.
- `jellyfin-key-hidden` keeps the key out of every response and out of the backend log.
- `jellyfin-match` answers `NONE` before a save, `MATCH` for the saved key, and `MISMATCH` for another valid key.
- `jellyfin-match-invalid` answers `400` with no body to an invalid key or a body that doesn't parse.
- `jellyfin-key-cleared` answers `NONE` to a match, `GET` reports the URL with `"apiKeyState":"NONE"`, and a `PATCH` of only `url` answers `400` naming `API_KEY`, once the saved key is gone but the URL stays.

## How to get to it (user POV)

- There is no UI for it yet. Call the backend on `http://localhost:8080` with `curl`, as a script or an API client would.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch, so `$RUN_DIR/admin-credentials.json` holds the admin.

- **Journey.** Run `control.sh drive jellyfin-connection`. It signs in through the UI, then calls the API with the browser's session. It checks `jellyfin-empty`, `jellyfin-invalid`, `jellyfin-saved`, `jellyfin-patch`, `jellyfin-key-hidden`, every `jellyfin-match` case, and the `401` and `403` refusals of a match. It writes `jellyfin-connection.json`, `jellyfin-connection-patch.json`, and `jellyfin-api-key-match.json`. It ends by clearing the saved key in this run's Postgres container with `docker exec ... psql` and checks `jellyfin-key-cleared`, so drive it last in a launch.

To drive the same paths by hand, run these from a scratch directory. `RUN_DIR` is `~/.local/state/continuarr-verify/run`, or `$CONTINUARR_VERIFY_HOME/run`.

- **Session required.** Run `curl -s -w ' %{http_code}\n' http://localhost:8080/api/v1/jellyfin/connection`. It prints ` 401`.
- **Sign in.** Fetch the CSRF token with `curl -s -o /dev/null -c cookies.txt http://localhost:8080/api/csrf`. Then run `curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -c cookies.txt -H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)" --data-urlencode "username=$(node -p "require('$RUN_DIR/admin-credentials.json').username")" --data-urlencode "password=$(node -p "require('$RUN_DIR/admin-credentials.json').password")" http://localhost:8080/api/login`. It prints `204`. Signing in replaces the CSRF cookie in `cookies.txt`, so the steps below read the token afresh each time. A token read before sign-in answers `403`.
- **Empty.** Run `curl -s -w ' %{http_code}\n' -b cookies.txt http://localhost:8080/api/v1/jellyfin/connection`. It prints `{"url":null,"apiKeyState":"NONE"} 200`.
- **CSRF.** Run `curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -X PUT -H 'Content-Type: application/json' -d '{"url":"http://localhost:8096","apiKey":"k"}' http://localhost:8080/api/v1/jellyfin/connection`. It prints `403`.
- **Invalid.** Send the same `PUT` with `-H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)"` and `-w ' %{http_code}\n'` instead of `-o /dev/null`, and the body `{"url":"not a url","apiKey":"k"}`. It prints `{"invalidFields":["URL"]} 400`. The body `{"url":"http://localhost:8096","apiKey":""}` prints `{"invalidFields":["API_KEY"]} 400`.
- **Save.** Send the CSRF `PUT` with the body `{"url":"http://localhost:8096","apiKey":"verify-placeholder-key"}`. It prints ` 204`.
- **Side effect.** Run the **Empty** `GET` again. It prints `{"url":"http://localhost:8096","apiKeyState":"STORED"} 200`, with no key in the body.

## Gotchas

- Use a placeholder API key, never a real one. Nothing checks it against a Jellyfin server.
- Only a database upgrade leaves a URL without a key, and each launch starts with an empty database, so the journey reaches `jellyfin-key-cleared` by clearing the key with `psql`.
- The journey makes a new API key for each run and never writes it to the evidence.
- Without a saved connection, the backend log has a `Jellyfin connection check failed: Jellyfin connection not configured` warning at startup. That is expected on every launch.
- Keep `cookies.txt` in the scratch directory and delete it afterward. It holds a session cookie once you sign in.
