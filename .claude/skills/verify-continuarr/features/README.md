# Continuarr verification map

This directory is the maintained source for verifying Continuarr's user-facing behavior. Read this index before you drive the app, then use the matching feature file as the recipe.

## Baseline preconditions

- `control.sh launch` started the instance in this checkout, and `control.sh doctor` passes.
- Each launch starts with an empty database: no admin, no session.
- The UI is at `http://localhost:5173`. The backend is at `http://localhost:8080`.

## Driving conventions

- Drive the UI through `control.sh drive <journey>`. Journeys locate elements by ARIA role and label, never by CSS class or position.
- Drive the API with `curl` against port `8080`. A state-changing request needs the CSRF cookie and header, as shown in [access control](./access-control.md).
- Journeys in one launch build on each other. `first-run-setup` creates the admin that `sign-in` uses. To run `first-run-setup` again, run `cleanup` and `launch`.

## Proof and skip reporting

- UI proof is the journey's numbered screenshots and ARIA snapshots, plus its JSON side-effect observations.
- API proof is the `curl` command with its status code and body.
- Name the run ID, the journey or command, and the entry point with every artifact.
- Report a path you could not reach with the command you ran and the precondition it lacked. Never report it as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph about the user-visible behavior. Four H2 sections follow, in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control.sh`, and `Gotchas`. Keep implementation details out. Name only user paths, stable handles, required state, commands, and observable proof.

## Features

- [First-run setup](./first-run-setup.md) covers the setup redirect, token and password errors, admin creation, and the closed setup page.
- [Sign in](./sign-in.md) covers the login page, rejected credentials, the signed-in shell, sign-out, and the redirect from `/` without a session.
- [App shell](./app-shell.md) covers the signed-in header, the icon rail, the navigation drawer, and the phone layout.
- [Header search](./header-search.md) covers the header search field, the phone search row, and its close paths.
- [Access control](./access-control.md) covers which endpoints answer without a session, and the CSRF requirement on state-changing calls.
- [Jellyfin connection](./jellyfin-connection.md) covers saving the Jellyfin URL and API key through the API, its validation, and reading back the URL and the key's state without the key.
- [Jellyfin card](./jellyfin-card.md) covers the Media servers page's Jellyfin card: the key state, the field checks, saving, and the failure states at desktop and phone widths.
- [Plex connection](./plex-connection.md) covers seeding the Plex connection from env vars and reading it back through the API without the token.
- [Media servers page](./media-servers.md) covers Add server, Reload and its discard prompt, the Plex card's states and Unlink, and the dimmed Sync zone on each card.
