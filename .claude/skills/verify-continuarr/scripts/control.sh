#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"

STATE_HOME="${CONTINUARR_VERIFY_HOME:-$HOME/.local/state/continuarr-verify}"
RUN_DIR="$STATE_HOME/run"
TOOLS_DIR="$STATE_HOME/tools"
EVIDENCE_ROOT="$STATE_HOME/evidence"

BACKEND_PORT=8080
FRONTEND_PORT=5173
BACKEND_URL="http://localhost:$BACKEND_PORT"
FRONTEND_URL="http://localhost:$FRONTEND_PORT"

PLAYWRIGHT_CORE_VERSION=1.64.1
BACKEND_COLD_START_TIMEOUT_SECONDS=600
FRONTEND_READY_TIMEOUT_SECONDS=120
STOP_TIMEOUT_SECONDS=30
PROBE_TIMEOUT_SECONDS=5
CONTAINER_REAP_TIMEOUT_SECONDS=30

die() { echo "control.sh: $*" >&2; exit 1; }
port_owner() { lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true; }
is_alive() { [[ -n "$1" ]] && kill -0 "$1" 2>/dev/null; }
read_state() { cat "$RUN_DIR/$1" 2>/dev/null || true; }
started_at() { ps -o lstart= -p "$1" 2>/dev/null || true; }
record_pid() { echo "$2" >"$RUN_DIR/$1.pid"; started_at "$2" >"$RUN_DIR/$1.started"; }
# A PID only counts as ours while its start time matches the launch, so a reused PID is never killed.
is_ours() {
	local pid
	pid="$(read_state "$1.pid")"
	is_alive "$pid" && [[ "$(started_at "$pid")" == "$(read_state "$1.started")" ]]
}

wait_for() {
	local timeout="$1" pid="$2" what="$3"
	shift 3
	local deadline=$((SECONDS + timeout))
	until "$@" >/dev/null 2>&1; do
		is_alive "$pid" || die "$what exited before it was ready; see its log in $(read_state evidence-dir)"
		((SECONDS < deadline)) || die "$what was not ready after ${timeout}s"
		sleep 2
	done
}

backend_ready() {
	curl -sf --max-time "$PROBE_TIMEOUT_SECONDS" "$BACKEND_URL/actuator/health" | grep -q '"status":"UP"' &&
		curl -sf --max-time "$PROBE_TIMEOUT_SECONDS" "$BACKEND_URL/api/setup" | grep -q '"required"'
}

frontend_ready() {
	curl -sf --max-time "$PROBE_TIMEOUT_SECONDS" "$FRONTEND_URL/" | grep -q 'id="root"' &&
		curl -sf --max-time "$PROBE_TIMEOUT_SECONDS" "$FRONTEND_URL/api/setup" | grep -q '"required"'
}

# Each start reads the encryption key settings afresh, so a restart can drop or change the key.
# CONTINUARR_VERIFY_ENCRYPTION_KEY sets CONTINUARR_ENCRYPTION_KEY. Unset, the backend creates its own key in the
# run's data directory, as a fresh install does. CONTINUARR_VERIFY_DATA_DIR= (empty) starts with no data directory,
# so without a key every save of a secret answers 503. No key is ever printed.
start_backend() {
	local task="$1" evidence_dir
	shift
	evidence_dir="$(read_state evidence-dir)"
	(cd "$REPO_ROOT/backend" || exit 1
		env "$@" \
			CONTINUARR_ENCRYPTION_KEY="${CONTINUARR_VERIFY_ENCRYPTION_KEY-}" \
			CONTINUARR_DATA_DIR="${CONTINUARR_VERIFY_DATA_DIR-$RUN_DIR/data}" \
			nohup ./gradlew "$task" --console=plain >>"$evidence_dir/backend.log" 2>&1 &
		echo $! >"$RUN_DIR/backend-gradle.pid")
	record_pid backend-gradle "$(read_state backend-gradle.pid)"
	wait_for "$BACKEND_COLD_START_TIMEOUT_SECONDS" "$(read_state backend-gradle.pid)" backend backend_ready
	record_pid backend-app "$(port_owner "$BACKEND_PORT")"
}

containers_connected_to() {
	local port
	for port in $(lsof -nP -a -p "$1" -iTCP -sTCP:ESTABLISHED 2>/dev/null | awk 'NR > 1 {
		split($9, ends, "->"); n = split(ends[2], hp, ":"); host = substr(ends[2], 1, length(ends[2]) - length(hp[n]) - 1)
		if (host == "127.0.0.1" || host == "[::1]") print hp[n]
	}' | sort -u); do
		docker ps --filter label=org.testcontainers=true --format '{{.ID}} {{.Ports}}' | awk -v mapping=":$port->" 'index($0, mapping) { print $1 }'
	done | sort -u
}

launch() {
	mkdir -p "$STATE_HOME"
	mkdir "$RUN_DIR" 2>/dev/null || die "an instance is already recorded in $RUN_DIR; run doctor, or cleanup first"
	refuse() { rm -rf "$RUN_DIR"; die "$@"; }
	local tool
	for tool in lsof curl docker node npm; do
		command -v "$tool" >/dev/null || refuse "$tool is not on PATH; launch needs it"
	done
	local port
	for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
		[[ -z "$(port_owner "$port")" ]] || refuse "port $port is in use by pid $(port_owner "$port"); this run will not drive an instance it did not start"
	done
	docker info >/dev/null 2>&1 || refuse "Docker is not running; bootTestRun needs it for Postgres"

	local run_id evidence_dir
	run_id="$(date -u +%Y%m%dT%H%M%SZ)"
	evidence_dir="$EVIDENCE_ROOT/$run_id"
	mkdir -p "$evidence_dir"
	echo "$run_id" >"$RUN_DIR/run-id"
	echo "$evidence_dir" >"$RUN_DIR/evidence-dir"
	echo "$REPO_ROOT" >"$RUN_DIR/repo-root"
	git -C "$REPO_ROOT" rev-parse HEAD >"$RUN_DIR/revision"

	# Install before the backend starts, so a Node or npm too old for the lock file fails with nothing running.
	echo "Installing frontend dependencies (log: $evidence_dir/npm-ci.log)"
	(cd "$REPO_ROOT/frontend" && npm ci >"$evidence_dir/npm-ci.log" 2>&1) ||
		refuse "npm ci failed with node $(node --version 2>/dev/null || echo unknown), and frontend/.nvmrc pins $(cat "$REPO_ROOT/frontend/.nvmrc"); see $evidence_dir/npm-ci.log"

	echo "Starting the backend (log: $evidence_dir/backend.log)"
	if [[ -n "${CONTINUARR_VERIFY_RESTARTABLE:-}" ]]; then
		# Testcontainers' reaper would remove Postgres when the backend stops, so restart needs it off.
		# Cleanup then removes the container by ID.
		touch "$RUN_DIR/restartable"
		start_backend bootTestRun TESTCONTAINERS_RYUK_DISABLED=true
	else
		start_backend bootTestRun
	fi
	containers_connected_to "$(read_state backend-app.pid)" >"$RUN_DIR/containers"

	echo "Starting the frontend (log: $evidence_dir/frontend.log)"
	(cd "$REPO_ROOT/frontend" || exit 1
		nohup npm run dev -- --port "$FRONTEND_PORT" --strictPort >"$evidence_dir/frontend.log" 2>&1 &
		echo $! >"$RUN_DIR/frontend-npm.pid")
	record_pid frontend-npm "$(read_state frontend-npm.pid)"
	wait_for "$FRONTEND_READY_TIMEOUT_SECONDS" "$(read_state frontend-npm.pid)" frontend frontend_ready
	record_pid frontend-app "$(port_owner "$FRONTEND_PORT")"

	echo "Ready: $FRONTEND_URL (run $run_id, evidence in $evidence_dir)"
}

doctor() {
	[[ -d "$RUN_DIR" ]] || die "no instance recorded; run launch"
	local failures=0
	check() {
		if "${@:2}" >/dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1"; failures=$((failures + 1)); fi
	}
	owns_port() { [[ "$(port_owner "$2")" == "$(read_state "$1.pid")" ]] && is_ours "$1"; }
	same_checkout() { [[ "$(read_state repo-root)" == "$REPO_ROOT" ]]; }
	same_revision() { [[ "$(read_state revision)" == "$(git -C "$REPO_ROOT" rev-parse HEAD)" ]]; }

	echo "run $(read_state run-id), evidence in $(read_state evidence-dir)"
	check "backend pid $(read_state backend-app.pid) owns port $BACKEND_PORT" owns_port backend-app "$BACKEND_PORT"
	check "frontend pid $(read_state frontend-app.pid) owns port $FRONTEND_PORT" owns_port frontend-app "$FRONTEND_PORT"
	check "backend health is UP and /api/setup answers" backend_ready
	check "frontend serves the SPA and proxies /api" frontend_ready
	check "launched from this checkout ($REPO_ROOT)" same_checkout
	check "HEAD is the launched revision $(read_state revision)" same_revision
	echo "info  setup status: $(curl -sf --max-time "$PROBE_TIMEOUT_SECONDS" "$FRONTEND_URL/api/setup" || echo unreachable)"
	echo "info  node $(node --version), frontend/.nvmrc pins $(cat "$REPO_ROOT/frontend/.nvmrc")"
	((failures == 0)) || die "$failures check(s) failed"
}

token() {
	local evidence_dir
	evidence_dir="$(read_state evidence-dir)"
	[[ -n "$evidence_dir" ]] || die "no instance recorded; run launch"
	grep -o 'using setup token [0-9a-f]*' "$evidence_dir/backend.log" | tail -n 1 | awk '{ print $4 }' | grep . ||
		die "no setup token in the backend log; an admin already exists"
}

ensure_playwright() {
	[[ -f "$TOOLS_DIR/node_modules/playwright-core/package.json" ]] &&
		grep -q "\"version\": \"$PLAYWRIGHT_CORE_VERSION\"" "$TOOLS_DIR/node_modules/playwright-core/package.json" && return
	mkdir -p "$TOOLS_DIR"
	npm install --prefix "$TOOLS_DIR" --no-audit --no-fund "playwright-core@$PLAYWRIGHT_CORE_VERSION" >/dev/null
}

# bootTestRun always starts a new Postgres, so the restarted backend runs bootRun against the one from launch.
restart() {
	[[ -f "$RUN_DIR/restartable" ]] || die "this launch would lose its database on a restart; launch with CONTINUARR_VERIFY_RESTARTABLE=1"
	local id port
	id="$(read_state containers | head -n 1)"
	[[ -n "$id" ]] || die "no Postgres container recorded for this launch"
	# A graceful stop closes the Spring context, which stops the Postgres container bean with it.
	if is_ours backend-app; then
		kill -9 "$(read_state backend-app.pid)"
		while is_ours backend-app; do sleep 1; done
	fi
	stop_process backend-gradle
	port="$(docker port "$id" 5432/tcp | head -n 1 | awk -F: '{ print $NF }')"
	container_env() { docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" | sed -n "s/^$1=//p"; }
	echo "Restarting the backend on the same database (log: $(read_state evidence-dir)/backend.log)"
	echo "--- control.sh restart $(date -u +%Y-%m-%dT%H:%M:%SZ) ---" >>"$(read_state evidence-dir)/backend.log"
	start_backend bootRun \
		SPRING_DATASOURCE_URL="jdbc:postgresql://localhost:$port/$(container_env POSTGRES_DB)" \
		SPRING_DATASOURCE_USERNAME="$(container_env POSTGRES_USER)" \
		SPRING_DATASOURCE_PASSWORD="$(container_env POSTGRES_PASSWORD)"
	echo "Ready: $FRONTEND_URL (run $(read_state run-id), restarted)"
}

drive() {
	local journey="${1:-}"
	local script="$SCRIPT_DIR/journeys/$journey.mjs"
	[[ -n "$journey" && -f "$script" ]] || die "usage: control.sh drive <journey>; journeys: $(ls "$SCRIPT_DIR/journeys" | sed 's/\.mjs$//' | tr '\n' ' ')"
	doctor >/dev/null
	ensure_playwright
	CONTINUARR_VERIFY_TOOLS="$TOOLS_DIR" \
		CONTINUARR_VERIFY_RUN_DIR="$RUN_DIR" \
		CONTINUARR_VERIFY_EVIDENCE="$(read_state evidence-dir)/$journey-$(date -u +%H%M%S)" \
		CONTINUARR_FRONTEND_URL="$FRONTEND_URL" \
		CONTINUARR_BACKEND_URL="$BACKEND_URL" \
		CONTINUARR_SETUP_TOKEN="$(token 2>/dev/null || true)" \
		node "$script"
}

stop_process() {
	is_ours "$1" || return 0
	local pid
	pid="$(read_state "$1.pid")"
	kill "$pid" 2>/dev/null || true
	local deadline=$((SECONDS + STOP_TIMEOUT_SECONDS))
	while is_ours "$1" && ((SECONDS < deadline)); do sleep 1; done
	is_ours "$1" && kill -9 "$pid" 2>/dev/null || true
}

cleanup() {
	[[ -d "$RUN_DIR" ]] || { echo "nothing to clean up"; return; }
	local evidence_dir process id
	evidence_dir="$(read_state evidence-dir)"
	for process in frontend-app frontend-npm backend-app backend-gradle; do
		stop_process "$process"
	done
	# Testcontainers' reaper removes them once the app exits; force only the ones this run recorded.
	# A restartable launch has no reaper, so there is nothing to wait for.
	local deadline=$((SECONDS + CONTAINER_REAP_TIMEOUT_SECONDS))
	[[ -f "$RUN_DIR/restartable" ]] && deadline=$SECONDS
	for id in $(read_state containers); do
		while [[ -n "$(docker ps -q --filter "id=$id")" ]] && ((SECONDS < deadline)); do sleep 1; done
		[[ -z "$(docker ps -q --filter "id=$id")" ]] || docker rm -f "$id" >/dev/null
	done
	rm -rf "$RUN_DIR"
	echo "Stopped. Evidence kept in $evidence_dir"
}

case "${1:-}" in
	launch) launch ;;
	doctor) doctor ;;
	token) token ;;
	restart) restart ;;
	drive) drive "${2:-}" ;;
	cleanup) cleanup ;;
	*) die "usage: control.sh launch | doctor | token | restart | drive <journey> | cleanup" ;;
esac
