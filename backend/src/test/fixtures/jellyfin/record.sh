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
readonly STAGING_ROOT="$FIXTURES_DIR/.seed/staging"
readonly STAGING_DIR="$STAGING_ROOT/mappings"
readonly RECORDING_FILE="$FIXTURES_DIR/.seed/recording.json"
readonly REQUESTS_FILE="$FIXTURES_DIR/requests.txt"
readonly WIREMOCK_CONTAINER_PORT=8080
readonly RECORD_TARGET="http://jellyfin:$JELLYFIN_CONTAINER_PORT"
readonly LEAK_TEST=xyz.ianworley.continuarr.mediaproviders.provider.jellyfin.JellyfinFixtureSecretsTest
readonly PLACEHOLDERS_FILE="$FIXTURES_DIR/placeholders.json"
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

# Writes only into the staging folder. The committed fixtures change after the staged ones pass the checks.
write_mappings() {
	local secrets mapping name
	secrets="$(jq -c --slurpfile placeholders "$PLACEHOLDERS_FILE" \
		'[to_entries[] | select(.value != "") | {real: .value, placeholder: $placeholders[0][.key]}]' "$SECRETS_FILE")"
	rm -rf "$STAGING_ROOT"
	mkdir -p "$STAGING_DIR"
	jq -c --argjson secrets "$secrets" --arg private_ipv4 "$PRIVATE_IPV4" --arg documentation_ipv4 "$DOCUMENTATION_IPV4" -f "$FIXTURES_DIR/normalize.jq" |
		while IFS= read -r mapping; do
			# WireMock records a URL with a query as urlPath plus queryParameters, so the name uses both.
			name="$(jq -r '.request
				| [.method, (.url // .urlPath), (.queryParameters // {} | to_entries[] | .key, (.value | .. | strings))]
				| join(" ") | ascii_downcase | gsub("[^a-z0-9]+"; "-") | gsub("^-|-$"; "")' <<<"$mapping")"
			if [ -e "$STAGING_DIR/$name.json" ]; then
				echo "Two requests map to $name.json; make the URLs in requests.txt differ by more than punctuation" >&2
				exit 1
			fi
			jq . <<<"$mapping" >"$STAGING_DIR/$name.json"
		done
}

check_staged_mappings() {
	if [ -z "$(find "$STAGING_DIR" -name '*.json')" ]; then
		echo "The recording has no mappings; add a request to requests.txt" >&2
		exit 1
	fi
	(cd "$BACKEND_DIR" && JELLYFIN_FIXTURES_DIR="$STAGING_ROOT" ./gradlew test --tests "$LEAK_TEST" --rerun)
}

"$FIXTURES_DIR/seed.sh"
trap 'compose --profile record rm --stop --force wiremock >/dev/null 2>&1' EXIT
compose --profile record up --detach --wait wiremock
# A redirect, not $(...), because Bash 3.2 drops set -e inside command substitution and a failed request would pass.
record "http://$(compose port wiremock "$WIREMOCK_CONTAINER_PORT")" >"$RECORDING_FILE"
write_mappings <"$RECORDING_FILE"
check_staged_mappings
rm -rf "$MAPPINGS_DIR"
mv "$STAGING_DIR" "$MAPPINGS_DIR"
echo "Recorded $(find "$MAPPINGS_DIR" -name '*.json' | wc -l | tr -d ' ') mapping(s) into $MAPPINGS_DIR"
