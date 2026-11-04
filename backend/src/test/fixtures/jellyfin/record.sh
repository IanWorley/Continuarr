#!/usr/bin/env bash
set -euo pipefail

usage() {
	echo "usage: $0" >&2
	echo "Reseeds the server, records every request in requests.txt through WireMock, scrubs the fixtures, and runs the leak test." >&2
	exit 2
}
[ "$#" -eq 0 ] || usage

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

BACKEND_DIR="$(cd "$FIXTURES_DIR/../../../.." && pwd)"
readonly BACKEND_DIR
readonly MAPPINGS_DIR="$BACKEND_DIR/src/test/resources/wiremock/jellyfin/mappings"
readonly REQUESTS_FILE="$FIXTURES_DIR/requests.txt"
readonly WIREMOCK_CONTAINER_PORT=8080
# The recorder reaches the seed server over the Compose network.
readonly RECORD_TARGET="http://jellyfin:$JELLYFIN_CONTAINER_PORT"
readonly LEAK_TEST=xyz.ianworley.continuarr.jellyfin.JellyfinFixtureSecretsTest

# Replace the seed server's real values, keyed like .seed/secrets.json. JellyfinFixtureSecretsTest expects the same values.
readonly PLACEHOLDERS='{
	"apiKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	"serverId": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
	"serverName": "Seed Server",
	"localAddress": "http://192.0.2.1:8096"
}'
# 10/8, 172.16/12, and 192.168/16 become 192.0.2.1, an address reserved for documentation.
readonly PRIVATE_IPV4='\b(10(\.[0-9]{1,3}){3}|172\.(1[6-9]|2[0-9]|3[01])(\.[0-9]{1,3}){2}|192\.168(\.[0-9]{1,3}){2})\b'
readonly DOCUMENTATION_IPV4=192.0.2.1

record() {
	local wiremock="$1" auth line
	auth="$(token_header "$(jq -r .apiKey "$SECRETS_FILE")")"
	curl -fsS -X POST -H 'Content-Type: application/json' \
		-d "$(jq -n --arg target "$RECORD_TARGET" '{targetBaseUrl: $target, persist: false}')" "$wiremock/__admin/recordings/start" >/dev/null
	while IFS= read -r line || [ -n "$line" ]; do
		case "$line" in '' | '#'*) continue ;; esac
		curl -fsS -H "$auth" "$wiremock$line" >/dev/null
	done <"$REQUESTS_FILE"
	curl -fsS -X POST "$wiremock/__admin/recordings/stop"
}

write_mappings() {
	local secrets mapping name
	secrets="$(jq -c --argjson placeholders "$PLACEHOLDERS" \
		'[to_entries[] | select(.value != "") | {real: .value, placeholder: $placeholders[.key]}]' "$SECRETS_FILE")"
	rm -rf "$MAPPINGS_DIR"
	mkdir -p "$MAPPINGS_DIR"
	jq -c --argjson secrets "$secrets" --arg private_ipv4 "$PRIVATE_IPV4" --arg documentation_ipv4 "$DOCUMENTATION_IPV4" -f "$FIXTURES_DIR/normalize.jq" |
		while IFS= read -r mapping; do
			name="$(jq -r '"\(.request.method) \(.request.url)" | ascii_downcase | gsub("[^a-z0-9]+"; "-") | gsub("^-|-$"; "")' <<<"$mapping")"
			if [ -e "$MAPPINGS_DIR/$name.json" ]; then
				echo "Two requests map to $name.json; make the URLs in requests.txt differ by more than punctuation" >&2
				exit 1
			fi
			jq . <<<"$mapping" >"$MAPPINGS_DIR/$name.json"
		done
}

"$FIXTURES_DIR/seed.sh"
trap 'compose --profile record rm --stop --force wiremock >/dev/null 2>&1' EXIT
compose --profile record up --detach --wait wiremock
record "http://$(compose port wiremock "$WIREMOCK_CONTAINER_PORT")" | write_mappings
echo "Recorded $(find "$MAPPINGS_DIR" -name '*.json' | wc -l | tr -d ' ') mapping(s) into $MAPPINGS_DIR"
(cd "$BACKEND_DIR" && ./gradlew test --tests "$LEAK_TEST" --rerun)
