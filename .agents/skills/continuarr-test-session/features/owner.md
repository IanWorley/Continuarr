# Installation owner

Create the single Continuarr owner and use the same account to return to the application. This login is separate from Plex OAuth and Jellyfin credentials.

## Sub-features

- `owner.setup`: create the installation owner once.
- `owner.login`: sign in and retain the session across reloads.
- `owner.logout`: sign out and return to the protected sign-in screen.

## How to get to it (user POV)

Open `/sign-in` or an authenticated route while signed out. Use **Sign out** in the navigation to end the session.

## Driving it with T3 preview

Preconditions: Doctor reports `configured:false` for setup. Use only the isolated fixture.

- Open `/sign-in` and snapshot. Require **Make yourself at home**.
- Fill **Username** with `continuarr-test` and **Password** with `Continuarr-local-test-2026!`. Click **Create owner and sign in**.
- Require `/`, the **Continuarr** heading, and **Sign out**. Reload and read `/api/v1/admin/session`; require `authenticated:true`.
- Click **Sign out**. Require `/sign-in` and **Welcome back**. Sign in with the same credentials and verify the session again.

## Gotchas

There is no additional-user registration. A configured owner is not a setup failure when resuming a known run. Never reset an existing owner. API login does not establish the browser's session unless its cookie belongs to that browser.
