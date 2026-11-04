# Shared by seed.sh and record.sh. Source it; don't run it.

FIXTURES_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly FIXTURES_DIR
BACKEND_DIR="$(cd "$FIXTURES_DIR/../../../.." && pwd)"
readonly BACKEND_DIR
# Gitignored. seed.sh writes the values that identify its server; record.sh scrubs them and the leak test looks for them.
readonly SECRETS_FILE="$FIXTURES_DIR/.seed/secrets.json"
readonly JELLYFIN_CONTAINER_PORT=8096

compose() {
	docker compose --project-directory "$FIXTURES_DIR" "$@"
}

jellyfin_url() {
	echo "http://$(compose port jellyfin "$JELLYFIN_CONTAINER_PORT")"
}

# Jellyfin 12 accepts only the MediaBrowser scheme in the Authorization header.
token_header() {
	echo "Authorization: MediaBrowser Token=\"$1\""
}

# api <method> <endpoint> [json-body]: calls JELLYFIN_URL with the seed's API key and prints the response.
api() {
	local method="$1" endpoint="$2" body="${3:-}"
	local auth
	auth="$(token_header "$(jq -r .apiKey "$SECRETS_FILE")")"
	if [ -n "$body" ]; then
		curl -fsS -X "$method" -H "$auth" -H 'Content-Type: application/json' -d "$body" "$JELLYFIN_URL$endpoint"
	else
		curl -fsS -X "$method" -H "$auth" "$JELLYFIN_URL$endpoint"
	fi
}
