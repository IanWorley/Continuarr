# Run Continuarr with Docker

Run one Continuarr container and PostgreSQL 18 with `compose.self-hosted.yaml`. The image uses Bun 1.4.3 and runs as UID and GID 1000. PostgreSQL has no published host port. The app listens on localhost by default.

## Install and claim the owner account

1. Copy the environment example and generate a database password.

	```sh
	cp .env.self-hosted.example .env.self-hosted
	openssl rand -hex 32
	```

2. Set `POSTGRES_PASSWORD` to the generated value in `.env.self-hosted`. Use URL-safe characters because Compose includes this password in `DATABASE_URL`. Keep `COMPOSE_PROJECT_NAME` unchanged after installation so Compose finds the same volumes. Choose a unique stable name for each installation when running several installations on one host. Set `PUBLIC_ORIGIN` to the single browser-facing HTTP or HTTPS origin, including the port when needed. It must have no credentials, path, query, or fragment.

3. Build the image, start PostgreSQL, and apply migrations before starting the app.

	```sh
	docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml build app
	docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml up -d --wait postgres
	docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml run --rm --no-deps app bun run db:migrate
	docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml up -d app
	```

4. Open `PUBLIC_ORIGIN` and create the installation-owner account before allowing other users access. Sign in and connect Plex through its authorization and server-grant flow. Connect Jellyfin with a key from **Dashboard → API Keys**.

`app-data` stores the credential key at `/data/credential-encryption.key`, with owner-only mode `600`. `postgres18-data` stores PostgreSQL under `/var/lib/postgresql`. Both named volumes survive restarts and container replacement. Preserve both volumes and the Compose project name. Do not use `docker compose down -v` on an installation you want to keep.

The health endpoint is `/api/v1/health`. `bun run start` also runs the production build directly with `HOST`, `PORT`, `PUBLIC_ORIGIN`, `DATABASE_URL`, and `DATA_DIRECTORY` supplied in the environment. Apply `bun run db:migrate` before starting it. Migrations are explicit and do not run on every container start.

## Connect media servers and an HTTPS proxy

Plex and Jellyfin URLs must be reachable from inside the app container. `localhost` in a server URL means the app container itself. Use a reachable LAN address, DNS name, or a shared Docker network. Include a Jellyfin proxy path if needed. Plex authorization also needs outbound access to Plex services. No Docker socket or host media mount is required.

For an HTTPS proxy, set `PUBLIC_ORIGIN=https://continuarr.example.com`. Keep the browser's `Origin` header unchanged. Continuarr uses the configured origin for same-origin checks, redirects, and Secure session cookies; forwarding headers do not select that origin.

For a proxy on the Docker host, forward to `127.0.0.1:3000`. This Nginx location permits a 15-minute sync request. Raise the timeout when a larger library takes longer.

```nginx
location / {
	proxy_pass http://127.0.0.1:3000;
	proxy_set_header Host $host;
	proxy_http_version 1.1;
	proxy_read_timeout 900s;
	proxy_send_timeout 900s;
}
```

If the proxy runs in a container, join it to the app's Docker network and forward to `app:3000`. Use `APP_BIND_ADDRESS` only when you need a different host binding. Exposing a new installation beyond localhost requires an HTTPS proxy and an owner account.

Run one app process per database. Its in-process scheduler starts on the first application request, including a health request. Keep the process running; suspend-on-idle and serverless hosting stop scheduled work. A restart stops active requests. Interrupted syncs are recorded as failed when the app restarts; run sync again after checking the connection.

## Restart without migrations

```sh
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml restart app
```

The same volumes retain the owner, sessions, connections, pairings, and credential key. Pending Plex login and server selections are cancelled. A restart does not apply migrations.

## Back up the database and credential data together

Stop the app before taking the backups. Leave PostgreSQL running for `pg_dump`. Back up the entire `/data` directory, including the key, alongside the database and `.env.self-hosted`. Store these files securely.

```sh
mkdir -m 700 continuarr-backup
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml stop app
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml exec -T postgres pg_dump -U continuarr -d continuarr --format=custom > continuarr-backup/continuarr.dump
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml exec -T postgres pg_restore --list < continuarr-backup/continuarr.dump
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml run -T --rm --no-deps --entrypoint tar app -C /data -czf - . > continuarr-backup/app-data.tar.gz
cp .env.self-hosted continuarr-backup/environment
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml up -d app
```

Confirm every backup command succeeds. The dump includes Drizzle's migration history, owner, sessions, settings, and media connections. It does not export other PostgreSQL databases or cluster-wide roles.

## Restore into empty volumes

Keep the app stopped. Restore the saved environment and select an unused `COMPOSE_PROJECT_NAME` for the restored installation. Use empty PostgreSQL and app-data volumes. Do not start the app or migrate an empty database before restoring the dump.

```sh
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml up -d --wait postgres
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml exec -T postgres pg_restore -U continuarr -d continuarr --exit-on-error --single-transaction < continuarr-backup/continuarr.dump
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml run -T --rm --no-deps --user 0:0 --entrypoint sh app -c 'tar -C /data -xzf - && chown -R 1000:1000 /data && { test ! -f /data/credential-encryption.key || chmod 600 /data/credential-encryption.key; }' < continuarr-backup/app-data.tar.gz
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml run --rm --no-deps app bun run db:migrate
docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml up -d app
```

Verify sign-in and saved media connections before accepting new writes. Keep the backups and original volumes until verification succeeds. Bind-mounted data directories also require ownership by UID 1000 and a key with mode `600`. Startup checks this ownership instead of changing restored files.

If a deployment uses `CREDENTIAL_ENCRYPTION_KEY`, add its original base64 value to `.env.self-hosted` before the first app start. The override takes precedence over the saved file. Keep that same value through backup and restore.

To migrate an override into the file, first stop the app and back up the environment and `/data`. Write the exact original base64 value without a trailing newline to `/data/credential-encryption.key`. Set its owner to UID and GID 1000 and mode to `600`. Remove the override only after confirming the file contains that same value. Do not generate a replacement key.

If the key is lost, restore the original file or original override before starting the app. An absent key creates a new one on startup. Without the original key or a backup, stored credentials cannot be decrypted; you must authorize the media connections again.

## Upgrade the application

1. Stop the app and take the paired backups above. Keep the app stopped after the backups.
2. Update the checkout to the selected version and rebuild the image.

	```sh
	docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml build app
	```

3. With PostgreSQL running and the app stopped, apply migrations from the new image and replace the app container.

	```sh
	docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml run --rm --no-deps app bun run db:migrate
	docker compose --env-file .env.self-hosted -f compose.self-hosted.yaml up -d --no-build --force-recreate app
	```

4. Confirm sign-in, saved connections, and sync before allowing regular writes. Preserve the existing project name, PostgreSQL volume, and app-data volume. An older app image may be incompatible with a newer schema; use the paired backup for rollback.

For a PostgreSQL 17 installation, follow the separate [PostgreSQL major-version upgrade guide](../README.md#upgrade-from-postgresql-17). Adapt its Compose commands to this file and your deployment environment.

## Verify the deployment package

```sh
docker build -t continuarr:local .
bun run test:deployment
```

The script uses unique disposable Compose projects, random credentials, and available local ports. It checks PostgreSQL 18, Bun 1.4.3, fresh migrations, authentication, assets, restart and replacement persistence, key ownership and permissions, encrypted credentials, HTTPS origin handling, and an upgrade from all but the last migration. It prints JSON results without credentials and removes only its own disposable volumes. Set `CONTINUARR_IMAGE` to verify another locally built image. Set `KEEP_DEPLOYMENT=1` to retain fixtures for inspection; the output names their projects and a private environment file for subsequent Compose commands.
