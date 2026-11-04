# Access control

Everything on the backend requires a session except the health endpoint, `GET /api/csrf`, `GET` and `POST /api/setup`, and the SPA's pages and assets. A state-changing request also needs the CSRF token, sent back in the `X-XSRF-TOKEN` header. [Security in `docs/plan.md`](../../../../docs/plan.md#security) is the source for these rules.

## Sub-features

- `access-public` answers the public endpoints without a session.
- `access-protected` answers `401` to any other request without a session, including unknown `/api` paths.
- `access-csrf` rejects a `POST` without the CSRF header with `403`.

## How to get to it (user POV)

- Call the backend on `http://localhost:8080` with `curl`, as a script or an API client would.

## Driving it with control.sh

Preconditions:

- `control.sh doctor` passes. The rules hold with or without an admin, except the last step, which needs a fresh launch.

- **Health.** Run `curl -s -w ' %{http_code}\n' http://localhost:8080/actuator/health`. It prints `{"groups":["liveness","readiness"],"status":"UP"} 200`.
- **Setup status.** Run `curl -s -w ' %{http_code}\n' http://localhost:8080/api/setup`. It prints `{"required":true} 200` on a fresh launch.
- **Protected.** Run `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/v3/api-docs` and the same for `/api/v1/anything`. Both print `401`.
- **CSRF.** Run `curl -s -o /dev/null -w '%{http_code}\n' -H 'Content-Type: application/json' -d '{"token":"x","username":"a","password":"12345678"}' http://localhost:8080/api/setup`. It prints `403`.
- **CSRF accepted.** This step needs a fresh launch, because with an admin the endpoint answers `409` first. Fetch the token with `curl -s -c cookies.txt http://localhost:8080/api/csrf`. Then run `curl -s -o /dev/null -w '%{http_code}\n' -b cookies.txt -H "X-XSRF-TOKEN: $(awk '$6 == "XSRF-TOKEN" { print $7 }' cookies.txt)" -H 'Content-Type: application/json' -d "{\"token\":\"$(.claude/skills/verify-continuarr/scripts/control.sh token)\",\"username\":\" \",\"password\":\"12345678\"}" http://localhost:8080/api/setup`. It prints `400`. The real setup token gets past the token check and the blank username fails validation, so the `400` proves the request passed the CSRF check. A wrong token prints `403` and proves nothing.

## Gotchas

- Port `8080` under `bootTestRun` serves a stand-in `index.html` titled `Continuarr test SPA`, not the real frontend. Drive the UI on `5173`. Only `docker compose up` serves the built frontend from the backend.
- Keep `cookies.txt` in a scratch directory and delete it afterward. It holds a session cookie once you sign in with it.
