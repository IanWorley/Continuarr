# Jellyfin seed server and fixtures

`seed.sh` starts a disposable Jellyfin that holds every case the Jellyfin client tests need. `record.sh` records WireMock fixtures from that server into [`src/test/resources/wiremock/jellyfin/mappings/`](../../resources/wiremock/jellyfin/mappings). Tests replay the fixtures offline, so `./gradlew test` never starts Jellyfin.

## Jellyfin 12.0 is the minimum supported version

`compose.yaml` pins `jellyfin/jellyfin:12.0.20260908-012347`, the 12.0 release build. Every fixture comes from that version. The recorder is `wiremock/wiremock:3.13.2`, so replay the mappings with WireMock 3.

## Before you start

Install Docker, `curl`, `jq`, and any JDK 17 or later for Gradle, then start Docker. You don't need ffmpeg, because `seed.sh` uses the copy inside the Jellyfin image. The scripts also run on the Bash 3.2 that macOS ships.

Run the commands below from this folder. Both servers bind to loopback only. Jellyfin uses port 8097 and the recorder uses port 8098, so a Jellyfin of your own on port 8096 keeps running.

## Start the seed server

```sh
./seed.sh
```

The script deletes the seed server's volumes and generates the clips listed in `media.tsv`. It completes the startup wizard and creates the API key, users, libraries, and user state. Then it prints `ok` or `FAIL` for each case in [Seed cases](#seed-cases), and it exits with an error if any case fails.

When it finishes, open `http://127.0.0.1:8097` and sign in as `admin` with the password `seed-password`. The server resets on every run, so that password isn't a secret. The server's real API key, server ID, server name, and local address go to `.seed/secrets.json`, which Git ignores.

To stop the server and delete its data, run `docker compose down --volumes`.

## Record the fixtures

```sh
./record.sh
```

The script runs `seed.sh` first, so every recording starts from the same server state. Then it does these steps:

1. It sends each path in `requests.txt` through the WireMock recorder with the API key.
2. It writes one file per request, named from the method, path, and query, such as `get-system-info.json` or `get-items-recursive-true.json`. It replaces the old mappings only after every request succeeds, so a failed run leaves them alone.
3. It keeps the method and URL to match on, and the status, `Content-Type`, and body to return. The recorder doesn't save request headers, so matching ignores `Authorization` and no fixture holds the key. The script drops `Date` and timing headers, so a re-record changes a file only when Jellyfin's answer changes.
4. It replaces the seed server's real API key, server ID, server name, and local address with the values in `placeholders.json`. It replaces any other private IPv4 address with `192.0.2.1`, an address reserved for documentation.
5. It runs `JellyfinFixtureSecretsTest`.

To record another endpoint, add its path to `requests.txt` and run `./record.sh`. The script sends each path as written and skips blank lines and lines that start with `#`. User IDs change on every seed, so a path that needs one needs a lookup in `record.sh` first.

## Re-record after a Jellyfin upgrade

Change the `jellyfin` image tag in `compose.yaml`, then run `./record.sh`. Review the diff of the mappings for API changes before you commit them.

## Check the fixtures for secrets

`JellyfinFixtureSecretsTest` runs with `./gradlew test`. It reads each fixture as JSON, and a string body that holds JSON gets the same checks as `jsonBody`. It fails when a fixture holds one of these:

- An API key that isn't the placeholder in `placeholders.json`. The test counts a 32-character hex value as a key when it sits under a property whose name contains `apikey`, `api_key`, `token`, or `authorization`, such as a header matcher. It also counts one that follows `api_key` or `token` inside a string, such as a URL.
- A `ServerId`, `ServerName`, or `LocalAddress` that isn't its value in `placeholders.json`. The `Id` of the system info object, the one with `LocalAddress`, must be the server ID placeholder too.
- A private IPv4 address in 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, or 100.64.0.0/10, or a private IPv6 address in fc00::/7 or fe80::/10. The scrub replaces only 10.0.0.0/8, 172.16.0.0/12, and 192.168.0.0/16, so a recording that holds any other private address fails here until the scrub covers it.
- Any value from `.seed/secrets.json`. Only a machine that ran `seed.sh` has that file, so CI skips this check.

## Seed cases

Every movie and episode has an `.nfo` file with its title and provider IDs. Every library has its internet metadata and image fetchers turned off, so Jellyfin reads metadata only from those files. The IDs are made up. Each clip is 5 seconds of the ffmpeg test pattern.

| Case | Seed item | Why later phases need it |
|---|---|---|
| Movie with IMDb and TMDb IDs | `Matched Movie (2001)`, IMDb `tt0900001`, TMDb `900001` | Happy path for ID matching |
| Movie with two editions | `Two Editions (2002)`, files ending in `- Theatrical` and `- Director's Cut` | Edition rule, #14 |
| Movie with two versions of one edition | `Two Versions (2003)`, files ending in `- 1080p` (1920x1080) and `- 2160p` (3840x2160) | Versions compared with editions, #14 |
| Movie with no external IDs | `Unmatched Movie (2004)`, in the second root of the Movies library | Unmatched queue |
| Show with a TVDb ID and a normal episode | `Seed Show (2010)`, TVDb `900100`, and its S01E01 "Normal Episode", TVDb `900201` | Episode matching |
| Special | S00E01 "Special" | Season-0 handling |
| Multi-episode file | `Seed Show (2010) S01E02-E03.mkv` | Multi-episode rule |
| Episode with a TVDb ID that disagrees with the show and S/E | S01E04 "Conflicting Id Episode", TVDb `900201`, the ID of S01E01 | Conflicting IDs rule |
| One library with two root locations | Movies, with roots `/media/movies` and `/media/movies-more` | Relative-path helper, #15 |
| A music library | Music, with `Seed Artist/Seed Album/01 - Seed Track.mp3` and no `.nfo` | Skipped by `libraries()` |
| User A has one played movie | `user-a` has played `Matched Movie` | User state |
| User B has one movie in progress | `user-b` is 2 seconds into `Matched Movie` | Resume position |
| A disabled user | `user-disabled` | Account mapping |

The `admin` user is also on the server. The users `user-a`, `user-b`, and `user-disabled` use the same password as `admin`.
