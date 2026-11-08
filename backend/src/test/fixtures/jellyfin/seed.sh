#!/usr/bin/env bash
set -euo pipefail

usage() {
	echo "usage: $0" >&2
	echo "Deletes the seed server's volumes, generates media, sets the server up, and checks every seed case." >&2
	exit 2
}
[ "$#" -eq 0 ] || usage

# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

# compose.yaml binds the server to loopback, and every run deletes it, so this password isn't a secret.
readonly ADMIN_USER=admin
readonly SEED_PASSWORD=seed-password
readonly USER_A=user-a
readonly USER_B=user-b
readonly DISABLED_USER=user-disabled
readonly CLIENT_AUTH='MediaBrowser Client="continuarr-seed", Device="seed", DeviceId="continuarr-seed", Version="1.0"'

readonly FFMPEG=/usr/lib/jellyfin-ffmpeg/ffmpeg
readonly CLIP_SECONDS=5
readonly CLIP_FRAME_RATE=1
readonly CLIP_QUALITY=45
readonly AUDIO_BITRATE=32k

readonly STATE_MOVIE="Matched Movie"
readonly RESUME_SECONDS=2
readonly TICKS_PER_SECOND=10000000

readonly PLAYING_CLIENT=seed-playing
readonly PLAYING_EPISODE="Normal Episode"
readonly PLAYING_SECONDS=1
readonly PAUSED_CLIENT=seed-paused
readonly PAUSED_MOVIE="Unmatched Movie"
readonly PAUSED_SECONDS=3

readonly POLL_SECONDS=1
readonly SCAN_TIMEOUT_SECONDS=120

jellyfin_url() {
	echo "http://$(compose port jellyfin "$JELLYFIN_CONTAINER_PORT")"
}

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

generate_media() {
	find "$FIXTURES_DIR/media" -type f ! -name '*.nfo' -delete
	local kind size file
	tail -n +2 "$FIXTURES_DIR/media.tsv" | while IFS=$'\t' read -r kind size file; do
		mkdir -p "$FIXTURES_DIR/media/$(dirname "$file")"
		local input=(-f lavfi -i "sine=duration=$CLIP_SECONDS")
		local encode=(-c:a libmp3lame -b:a "$AUDIO_BITRATE")
		if [ "$kind" = video ]; then
			input=(-f lavfi -i "testsrc2=size=$size:rate=$CLIP_FRAME_RATE:duration=$CLIP_SECONDS" "${input[@]}")
			encode=(-c:v libx264 -crf "$CLIP_QUALITY" -pix_fmt yuv420p -c:a aac -b:a "$AUDIO_BITRATE" -shortest)
		fi
		compose run --rm --no-deps --user "$(id -u):$(id -g)" -v "$FIXTURES_DIR/media:/out" \
			--entrypoint "$FFMPEG" jellyfin -nostdin -hide_banner -loglevel error \
			"${input[@]}" "${encode[@]}" -y "/out/$file" </dev/null
	done
}

complete_wizard() {
	curl -fsS -X POST -H 'Content-Type: application/json' \
		-d '{"UICulture": "en-US", "MetadataCountryCode": "US", "PreferredMetadataLanguage": "en"}' "$JELLYFIN_URL/Startup/Configuration"
	curl -fsS "$JELLYFIN_URL/Startup/User" >/dev/null
	curl -fsS -X POST -H 'Content-Type: application/json' \
		-d "$(jq -n --arg name "$ADMIN_USER" --arg password "$SEED_PASSWORD" '{Name: $name, Password: $password}')" "$JELLYFIN_URL/Startup/User"
	curl -fsS -X POST -H 'Content-Type: application/json' -d '{"EnableRemoteAccess": false}' "$JELLYFIN_URL/Startup/RemoteAccess"
	curl -fsS -X POST "$JELLYFIN_URL/Startup/Complete"
}

sign_in_as_admin() {
	local client_auth="$1"
	curl -fsS -X POST -H "Authorization: $client_auth" -H 'Content-Type: application/json' \
		-d "$(jq -n --arg name "$ADMIN_USER" --arg password "$SEED_PASSWORD" '{Username: $name, Pw: $password}')" \
		"$JELLYFIN_URL/Users/AuthenticateByName" | jq -r .AccessToken
}

create_api_key() {
	local token
	token="$(sign_in_as_admin "$CLIENT_AUTH")"
	curl -fsS -X POST -H "$(token_header "$token")" "$JELLYFIN_URL/Auth/Keys?app=Continuarr"
	curl -fsS -H "$(token_header "$token")" "$JELLYFIN_URL/Auth/Keys" | jq -r '.Items[0].AccessToken'
}

save_secrets() {
	local key="$1"
	mkdir -p "$(dirname "$SECRETS_FILE")"
	curl -fsS -H "$(token_header "$key")" "$JELLYFIN_URL/System/Info" |
		jq --arg apiKey "$key" '{apiKey: $apiKey, serverId: .Id, serverName: .ServerName, localAddress: .LocalAddress}' >"$SECRETS_FILE"
}

uri() {
	jq -rn --arg value "$1" '$value | @uri'
}

add_library() {
	local query
	query="name=$(uri "$1")&collectionType=$2"
	shift 2
	local root
	for root in "$@"; do
		query="$query&paths=$(uri "$root")"
	done
	# Empty fetcher lists turn off every internet metadata and image source, so only the .nfo files count.
	api POST "/Library/VirtualFolders?$query" "$(jq -n '{LibraryOptions: {
		EnableRealtimeMonitor: false,
		EnableInternetProviders: false,
		EnableChapterImageExtraction: false,
		ExtractChapterImagesDuringLibraryScan: false,
		EnableTrickplayImageExtraction: false,
		ExtractTrickplayImagesDuringLibraryScan: false,
		TypeOptions: ["Movie", "Series", "Season", "Episode", "MusicArtist", "MusicAlbum", "Audio"]
			| map({Type: ., MetadataFetchers: [], ImageFetchers: []})
	}}')"
}

# Jellyfin 12 starts its own scan when a library gets a folder, so wait for a scan that ends after this trigger.
scan_libraries() {
	local task previous_end waited=0
	task="$(api GET /ScheduledTasks | jq -r '.[] | select(.Key == "RefreshLibrary") | .Id')"
	previous_end="$(api GET "/ScheduledTasks/$task" | jq -r '.LastExecutionResult.EndTimeUtc // ""')"
	api POST "/ScheduledTasks/Running/$task"
	until api GET "/ScheduledTasks/$task" | jq -e --arg previous "$previous_end" \
		'.State == "Idle" and .LastExecutionResult.Status == "Completed" and .LastExecutionResult.EndTimeUtc != $previous' >/dev/null; do
		if [ "$waited" -ge "$SCAN_TIMEOUT_SECONDS" ]; then
			echo "Library scan didn't finish in ${SCAN_TIMEOUT_SECONDS}s" >&2
			exit 1
		fi
		sleep "$POLL_SECONDS"
		waited=$((waited + POLL_SECONDS))
	done
}

create_user() {
	api POST /Users/New "$(jq -n --arg name "$1" --arg password "$SEED_PASSWORD" '{Name: $name, Password: $password}')" | jq -r .Id
}

user_id() {
	api GET /Users | jq -r --arg name "$1" '.[] | select(.Name == $name) | .Id'
}

item_id() {
	local type="$1" name="$2"
	api GET "/Items?Recursive=true&IncludeItemTypes=$type&searchTerm=$(uri "$name")" |
		jq -r --arg name "$name" '.Items[] | select(.Name == $name) | .Id'
}

seed_user_state() {
	local user_a user_b disabled policy movie
	user_a="$(create_user "$USER_A")"
	user_b="$(create_user "$USER_B")"
	disabled="$(create_user "$DISABLED_USER")"
	policy="$(api GET "/Users/$disabled" | jq '.Policy | .IsDisabled = true')"
	api POST "/Users/$disabled/Policy" "$policy"
	movie="$(item_id Movie "$STATE_MOVIE")"
	api POST "/UserPlayedItems/$movie?userId=$user_a" >/dev/null
	api POST "/UserItems/$movie/UserData?userId=$user_b" \
		"$(jq -n --argjson ticks $((RESUME_SECONDS * TICKS_PER_SECOND)) '{PlaybackPositionTicks: $ticks}')" >/dev/null
}

# A playback report is enough for Jellyfin to list a session as playing, so nothing streams the clip.
start_admin_playback() {
	local client="$1" item="$2" seconds="$3" paused="$4" token
	token="$(sign_in_as_admin "MediaBrowser Client=\"$client\", Device=\"seed\", DeviceId=\"$client\", Version=\"1.0\"")"
	curl -fsS -X POST -H "$(token_header "$token")" -H 'Content-Type: application/json' \
		-d "$(jq -n --arg item "$item" --argjson ticks $((seconds * TICKS_PER_SECOND)) --argjson paused "$paused" \
			'{ItemId: $item, PositionTicks: $ticks, IsPaused: $paused, PlayMethod: "DirectPlay"}')" "$JELLYFIN_URL/Sessions/Playing"
}

seed_sessions() {
	local episode movie
	episode="$(item_id Episode "$PLAYING_EPISODE")"
	movie="$(item_id Movie "$PAUSED_MOVIE")"
	start_admin_playback "$PLAYING_CLIENT" "$episode" "$PLAYING_SECONDS" false
	start_admin_playback "$PAUSED_CLIENT" "$movie" "$PAUSED_SECONDS" true
}

check_seed_cases() {
	local state failures=0
	state="$(jq -n \
		--argjson folders "$(api GET /Library/VirtualFolders)" \
		--argjson items "$(api GET '/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&Fields=ProviderIds,Path,MediaSources')" \
		--argjson users "$(api GET /Users)" \
		--argjson played "$(api GET "/Items?userId=$(user_id "$USER_A")&Recursive=true&IncludeItemTypes=Movie&Filters=IsPlayed")" \
		--argjson resume "$(api GET "/UserItems/Resume?userId=$(user_id "$USER_B")&IncludeItemTypes=Movie")" \
		--argjson sessions "$(api GET /Sessions)" \
		'{folders: $folders, items: $items.Items, users: $users, played: $played.Items, resume: $resume.Items, sessions: $sessions}')"

	check() {
		if jq -e "$2" <<<"$state" >/dev/null; then
			echo "ok    $1"
		else
			echo "FAIL  $1"
			failures=$((failures + 1))
		fi
	}
	check "Movie with IMDb and TMDb IDs" \
		'any(.items[]; .Name == "Matched Movie" and .ProviderIds.Imdb != null and .ProviderIds.Tmdb != null)'
	check "Movie with two editions (theatrical and director's cut)" \
		'[.items[] | select(.Name == "Two Editions") | .MediaSources[]] | length > 1'
	check "Movie with two versions of one edition (1080p and 4K)" \
		'[.items[] | select(.Name == "Two Versions") | .MediaSources[].MediaStreams[] | select(.Type == "Video") | .Height] | unique | length > 1'
	check "Movie with no external IDs" \
		'any(.items[]; .Name == "Unmatched Movie" and .ProviderIds == {})'
	check "Show with TVDb ID and a normal episode" \
		'any(.items[]; .Name == "Seed Show" and .ProviderIds.Tvdb != null) and any(.items[]; .Name == "Normal Episode" and .ProviderIds.Tvdb != null)'
	check "Special (season 0)" \
		'any(.items[]; .Type == "Episode" and .ParentIndexNumber == 0)'
	check "Multi-episode file (S01E02-E03)" \
		'any(.items[]; .Type == "Episode" and .IndexNumberEnd != null and .IndexNumberEnd > .IndexNumber)'
	check "Episode with a TVDb ID that disagrees with the show + S/E" \
		'[.items[] | select(.Name == "Conflicting Id Episode" or .Name == "Normal Episode")]
			| (map(.Name) | unique | length > 1) and (map(.ProviderIds.Tvdb) | unique | length == 1) and .[0].ProviderIds.Tvdb != null'
	check "One library with two root locations" \
		'any(.folders[]; (.Locations | length) > 1)'
	check "A music library" \
		'any(.folders[]; .CollectionType == "music")'
	check "User A: one played movie" \
		'.played | length == 1'
	check "User B: one movie in progress" \
		'[.resume[] | select(.UserData.PlaybackPositionTicks > 0)] | length == 1'
	check "A disabled user" \
		'any(.users[]; .Policy.IsDisabled)'
	check "Admin is playing an episode" \
		"any(.sessions[]; .Client == \"$PLAYING_CLIENT\" and .NowPlayingItem.Name == \"$PLAYING_EPISODE\" and .PlayState.IsPaused == false)"
	check "Admin has paused a movie" \
		"any(.sessions[]; .Client == \"$PAUSED_CLIENT\" and .NowPlayingItem.Name == \"$PAUSED_MOVIE\" and .PlayState.IsPaused
			and .PlayState.PositionTicks == $((PAUSED_SECONDS * TICKS_PER_SECOND)))"
	check "A session with nothing playing" \
		'any(.sessions[]; .NowPlayingItem == null)'

	if [ "$failures" -gt 0 ]; then
		echo "$failures seed case(s) missing" >&2
		exit 1
	fi
}

compose down --volumes --remove-orphans
generate_media
compose up --detach --wait jellyfin
JELLYFIN_URL="$(jellyfin_url)"
readonly JELLYFIN_URL
complete_wizard
save_secrets "$(create_api_key)"
add_library Movies movies /media/movies /media/movies-more
add_library Shows tvshows /media/shows
add_library Music music /media/music
scan_libraries
seed_user_state
seed_sessions
check_seed_cases
echo "Seed server ready at $JELLYFIN_URL"
