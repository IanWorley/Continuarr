# First-run setup

A new install has no admin. Every page sends the visitor to `/setup`, where the setup token from the server log and a username and password create the single admin. After that, `/setup` sends visitors to `/login`.

## Sub-features

- `setup-redirect` sends `/` and `/login` to `/setup` while no admin exists.
- `setup-wrong-token` rejects a token that does not match the logged one.
- `setup-password-mismatch` rejects a confirmation that differs from the password, before anything is sent.
- `setup-create` creates the admin and moves to `/login`.
- `setup-closed` sends `/setup` to `/login` once an admin exists.

## How to get to it (user POV)

- Open any page of a fresh install, such as `http://localhost:5173/`.
- Open `http://localhost:5173/setup` directly.
- Send `POST /api/setup` from a terminal, as the [frontend README](../../../../frontend/README.md#run-it-locally) shows.

## Driving it with control.sh

Preconditions:

- The launch is fresh. `control.sh doctor` prints `setup status: {"required":true}`.
- `control.sh token` prints a 32-character hex token.

- **Redirect.** Open `/`. Run `control.sh drive first-run-setup`. Step `01-redirected-to-setup` is at `/setup` with the heading `Set up Continuarr`.
- **Wrong token.** Fill `Setup token` with a wrong value and the other fields validly, then choose `Create admin`. Step `02-wrong-token-rejected` shows `That setup token doesn't match.`, and the `Setup token` textbox is `[invalid]`.
- **Mismatch.** Fill the real token and a different `Confirm password`. Step `03-password-mismatch-caught` shows `The passwords don't match.`
- **Create.** Fix the confirmation and choose `Create admin`. Step `04-admin-created` is at `/login` with the heading `Sign in`.
- **Side effect.** `setup-status-after.json` holds `{"required": false}`, read from `GET /api/setup` on the backend.
- **Closed.** Open `/setup` again. Step `05-setup-page-closed` is at `/login`.

## Gotchas

- The setup token changes on every launch. `control.sh token` reads the current one. It fails once an admin exists, because the backend logs no token then.
- The journey stores the admin's random password in the run state for `sign-in`. The ARIA snapshots show it in plain text. It belongs to a throwaway database, so never point a journey at a real install.
- A wrong token and a missing CSRF header both answer `403` on the API path. Check the CSRF header before you report a token bug.
