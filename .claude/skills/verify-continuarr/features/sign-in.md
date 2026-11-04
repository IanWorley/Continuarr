# Sign in

The admin signs in at `/login` with the username and password from first-run setup. A wrong password shows an error and keeps the visitor on `/login`. A correct one opens the signed-in shell at `/`, which shows the username and a `Sign out` button, and the session cookie then authenticates API calls. Signing out ends the session and returns to `/login`. Without a session, `/` sends the visitor to `/login`.

## Sub-features

- `sign-in-page` shows the `Sign in` form once an admin exists.
- `sign-in-rejected` shows `Wrong username or password` for bad credentials.
- `sign-in-success` opens the shell at `/` and starts an authenticated session.
- `sign-out` ends the session and moves to `/login`.
- `shell-needs-session` sends `/` to `/login` when the visitor has no session.

## How to get to it (user POV)

- Open `http://localhost:5173/login`.
- Create the admin on `/setup`, which moves to `/login`.
- Open `http://localhost:5173/` without a session.
- Choose `Sign out` in the shell's header.

## Driving it with control.sh

Preconditions:

- `control.sh drive first-run-setup` passed earlier in this launch.
- `control.sh doctor` prints `setup status: {"required":false}`.

- **Signed out.** Before the page loads, the journey requests `/v3/api-docs` on the backend with the browser's cookies and expects `401`.
- **Open.** Run `control.sh drive sign-in`. Step `01-login-page` is at `/login` with the heading `Sign in`.
- **Reject.** Fill `Username` and a wrong `Password`, then choose `Sign in`. Step `02-bad-credentials-rejected` shows `Wrong username or password` and stays at `/login`.
- **Sign in.** Fill the right password and choose `Sign in`. Step `03-signed-in` is at `/`, and its banner shows the username and the `Sign out` button.
- **Sign out.** Choose `Sign out`. Step `04-signed-out` is at `/login` with the heading `Sign in`.
- **Side effect.** `session-probe.json` holds `"before": 401, "signedIn": 200, "signedOut": 401`. The session authenticated a protected endpoint, and signing out ended it.
- **Session required.** Open `/` again. Step `05-home-needs-session` is at `/login`.

## Gotchas

- The URL changes to `/` before the shell checks the session, so for a moment `/` still shows the login form. The URL alone does not prove sign-in. Wait for the `Sign out` button.
- Without an admin, `/login` sends the visitor to `/setup`. A `sign-in` run on a fresh launch fails with `No admin recorded for this run`.
- Cookies ignore the port, so the session from `5173` also authenticates requests to `8080`. The probe depends on that.
