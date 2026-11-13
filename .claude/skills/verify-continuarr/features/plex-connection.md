# Plex connection

For local development, `CONTINUARR_PLEX_URL` and `CONTINUARR_PLEX_TOKEN` seed the Plex connection when the backend starts. The signed-in admin reads it back with `GET /api/v1/plex/connection`, which returns `url`, `source`, and `tokenState`, never the token. `source` is `ENVIRONMENT` for a seed. `PLEX_TV` is reserved for a plex.tv sign-in, which a seed never overwrites. `tokenState` is `STORED` once a token is saved and `NONE` otherwise, including a saved URL whose token a database upgrade cleared. [Configuration in `docs/plan.md`](../../../../docs/plan.md#configuration) is the source for these rules.

## Sub-features

- `plex-needs-session` answers `401` to `GET` without a session.
- `plex-empty` answers `{"url":null,"source":null,"tokenState":"NONE"}` on a launch without `CONTINUARR_PLEX_*`.
- `plex-seeded` answers `{"url":"<CONTINUARR_PLEX_URL>","source":"ENVIRONMENT","tokenState":"STORED"}` on a launch with both variables.
- `plex-token-cleared` answers `"tokenState":"NONE"` with the URL and source once the saved token is gone.
- `plex-invalid-seed` fails startup when only one variable is set or a value is malformed. The backend log names the variable and never its value.
- `plex-token-hidden` keeps the token out of every response and out of the backend log.

## How to get to it (user POV)

- There is no UI for it yet. Set the variables in the shell that runs `control.sh launch`, then call the backend with `curl`, as a script would.

## Driving it with control.sh

Preconditions:

- Export the same `CONTINUARR_PLEX_URL` and `CONTINUARR_PLEX_TOKEN` for `launch` and `drive`, so the journey knows what was seeded and which token must not leak. Leave both unset for `plex-empty`.
- `control.sh drive first-run-setup` passed earlier in this launch.

- **Journey.** Run `control.sh drive plex-connection`. It checks the `401`, signs in through the UI, and checks the `GET` body the launch's variables call for. On a seeded launch it then clears the saved token with `docker exec ... psql` and checks `plex-token-cleared`, so drive it last. It checks that the token is in no response and not in `backend.log`, and writes `plex-connection.json`.
- **Invalid seed.** Run `CONTINUARR_PLEX_URL=http://plex.verify.local:32400 control.sh launch` with no token. Launch stops with "backend exited before it was ready". The run's `backend.log` holds `Set both CONTINUARR_PLEX_URL and CONTINUARR_PLEX_TOKEN, or neither`. Run `cleanup` afterward.
- **By hand.** Sign in as in [Jellyfin connection](./jellyfin-connection.md), then run `curl -s -w ' %{http_code}\n' -b cookies.txt http://localhost:8080/api/v1/plex/connection`.

## Gotchas

- Use a made-up token, never a real one. Nothing contacts Plex or plex.tv yet.
- Each launch starts with an empty database, so a seeded launch always reaches `STORED` and never meets a `PLEX_TV` row. The backend tests cover the seed leaving a plex.tv link alone.
