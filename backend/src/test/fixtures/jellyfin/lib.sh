#!/usr/bin/env bash

FIXTURES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly FIXTURES_DIR
readonly SECRETS_FILE="$FIXTURES_DIR/.seed/secrets.json"
readonly JELLYFIN_CONTAINER_PORT=8096

compose() {
	docker compose --project-directory "$FIXTURES_DIR" "$@"
}

# Jellyfin 12 accepts only the MediaBrowser scheme in the Authorization header.
token_header() {
	echo "Authorization: MediaBrowser Token=\"$1\""
}
