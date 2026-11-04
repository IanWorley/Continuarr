# Sign in

The admin signs in at `/login` with the username and password from first-run setup. A wrong password shows an error and keeps the visitor on `/login`. A correct one moves to `/`, and the session cookie then authenticates API calls.

## Sub-features

- `sign-in-page` shows the `Sign in` form once an admin exists.
- `sign-in-rejected` shows `Wrong username or password` for bad credentials.
- `sign-in-success` moves to `/` and starts an authenticated session.

## How to get to it (user POV)

- Open `http://localhost:5173/login`.
- Create the admin on `/setup`, which moves to `/login`.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch.
- `control.sh doctor` prints `setup status: {"required":false}`.

- **Signed out.** Before the page loads, the journey requests `/v3/api-docs` on the backend with the browser's cookies and expects `401`.
- **Open.** Run `control.sh drive sign-in`. Step `01-login-page` is at `/login` with the heading `Sign in`.
- **Reject.** Fill `Username` and a wrong `Password`, then choose `Sign in`. Step `02-bad-credentials-rejected` shows `Wrong username or password` and stays at `/login`.
- **Sign in.** Fill the right password and choose `Sign in`. Step `03-signed-in` is at `/` and shows `Continuarr`.
- **Side effect.** `session-probe.json` holds `"before": 401, "after": 200`. The browser's session now authenticates a protected endpoint.

## Gotchas

- `/` shows the `Continuarr` placeholder whether or not the visitor is signed in, until the logged-in shell lands (#9). The URL alone does not prove sign-in. Use the session probe.
- Without an admin, `/login` sends the visitor to `/setup`. A `sign-in` run on a fresh launch fails with `No admin recorded for this run`.
- Cookies ignore the port, so the session from `5173` also authenticates requests to `8080`. The probe depends on that.
