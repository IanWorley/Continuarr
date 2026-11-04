#!/usr/bin/env bash
# Shared by seed.sh and record.sh. Source it; don't run it.

FIXTURES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly FIXTURES_DIR
# Gitignored. seed.sh writes the values that identify its server; record.sh scrubs them and the leak test looks for them.
readonly SECRETS_FILE="$FIXTURES_DIR/.seed/secrets.json"
readonly JELLYFIN_CONTAINER_PORT=8096

compose() {
	docker compose --project-directory "$FIXTURES_DIR" "$@"
}

# Jellyfin 12 accepts only the MediaBrowser scheme in the Authorization header.
token_header() {
	echo "Authorization: MediaBrowser Token=\"$1\""
}
