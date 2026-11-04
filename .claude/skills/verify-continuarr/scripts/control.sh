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
CONTAINER_REAP_TIMEOUT_SECONDS=30

die() { echo "control.sh: $*" >&2; exit 1; }
port_owner() { lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -n 1 || true; }
is_alive() { [[ -n "$1" ]] && kill -0 "$1" 2>/dev/null; }
read_state() { cat "$RUN_DIR/$1" 2>/dev/null || true; }

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
	curl -sf "$BACKEND_URL/actuator/health" | grep -q '"status":"UP"' &&
		curl -sf "$BACKEND_URL/api/setup" | grep -q '"required"'
}

frontend_ready() {
	curl -sf "$FRONTEND_URL/" | grep -q 'id="root"' &&
		curl -sf "$FRONTEND_URL/api/setup" | grep -q '"required"'
}

containers_connected_to() {
	local port
	for port in $(lsof -nP -a -p "$1" -iTCP -sTCP:ESTABLISHED 2>/dev/null | awk 'NR > 1 { split($9, ends, "->"); n = split(ends[2], hp, ":"); print hp[n] }' | sort -u); do
		docker ps --format '{{.ID}} {{.Ports}}' | awk -v mapping=":$port->" 'index($0, mapping) { print $1 }'
	done | sort -u
}

launch() {
	[[ -d "$RUN_DIR" ]] && die "an instance is already recorded in $RUN_DIR; run doctor, or cleanup first"
	local port
	for port in "$BACKEND_PORT" "$FRONTEND_PORT"; do
		[[ -z "$(port_owner "$port")" ]] || die "port $port is in use by pid $(port_owner "$port"); this run will not drive an instance it did not start"
	done
	docker info >/dev/null 2>&1 || die "Docker is not running; bootTestRun needs it for Postgres"

	local run_id evidence_dir
	run_id="$(date -u +%Y%m%dT%H%M%SZ)"
	evidence_dir="$EVIDENCE_ROOT/$run_id"
	mkdir -p "$RUN_DIR" "$evidence_dir"
	echo "$run_id" >"$RUN_DIR/run-id"
	echo "$evidence_dir" >"$RUN_DIR/evidence-dir"
	echo "$REPO_ROOT" >"$RUN_DIR/repo-root"
	git -C "$REPO_ROOT" rev-parse HEAD >"$RUN_DIR/revision"

	echo "Starting the backend (log: $evidence_dir/backend.log)"
	(cd "$REPO_ROOT/backend" || exit 1
		nohup ./gradlew bootTestRun --console=plain >"$evidence_dir/backend.log" 2>&1 &
		echo $! >"$RUN_DIR/backend-gradle.pid")
	wait_for "$BACKEND_COLD_START_TIMEOUT_SECONDS" "$(read_state backend-gradle.pid)" backend backend_ready
	port_owner "$BACKEND_PORT" >"$RUN_DIR/backend-app.pid"
	containers_connected_to "$(read_state backend-app.pid)" >"$RUN_DIR/containers"

	echo "Installing frontend dependencies (log: $evidence_dir/npm-ci.log)"
	(cd "$REPO_ROOT/frontend" && npm ci >"$evidence_dir/npm-ci.log" 2>&1) || die "npm ci failed; see $evidence_dir/npm-ci.log"

	echo "Starting the frontend (log: $evidence_dir/frontend.log)"
	(cd "$REPO_ROOT/frontend" || exit 1
		nohup npm run dev -- --port "$FRONTEND_PORT" --strictPort >"$evidence_dir/frontend.log" 2>&1 &
		echo $! >"$RUN_DIR/frontend-npm.pid")
	wait_for "$FRONTEND_READY_TIMEOUT_SECONDS" "$(read_state frontend-npm.pid)" frontend frontend_ready
	port_owner "$FRONTEND_PORT" >"$RUN_DIR/frontend-app.pid"

	echo "Ready: $FRONTEND_URL (run $run_id, evidence in $evidence_dir)"
}

doctor() {
	[[ -d "$RUN_DIR" ]] || die "no instance recorded; run launch"
	local failures=0
	check() {
		if "${@:2}" >/dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1"; failures=$((failures + 1)); fi
	}
	owns_port() { [[ "$(port_owner "$2")" == "$(read_state "$1")" ]] && is_alive "$(read_state "$1")"; }
	same_checkout() { [[ "$(read_state repo-root)" == "$REPO_ROOT" ]]; }
	same_revision() { [[ "$(read_state revision)" == "$(git -C "$REPO_ROOT" rev-parse HEAD)" ]]; }

	echo "run $(read_state run-id), evidence in $(read_state evidence-dir)"
	check "backend pid $(read_state backend-app.pid) owns port $BACKEND_PORT" owns_port backend-app.pid "$BACKEND_PORT"
	check "frontend pid $(read_state frontend-app.pid) owns port $FRONTEND_PORT" owns_port frontend-app.pid "$FRONTEND_PORT"
	check "backend health is UP and /api/setup answers" backend_ready
	check "frontend serves the SPA and proxies /api" frontend_ready
	check "launched from this checkout ($REPO_ROOT)" same_checkout
	check "HEAD is the launched revision $(read_state revision)" same_revision
	echo "info  setup status: $(curl -sf "$FRONTEND_URL/api/setup" || echo unreachable)"
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

drive() {
	local journey="${1:-}"
	local script="$SCRIPT_DIR/journeys/$journey.mjs"
	[[ -n "$journey" && -f "$script" ]] || die "usage: control.sh drive <journey>; journeys: $(ls "$SCRIPT_DIR/journeys" | sed 's/\.mjs$//' | tr '\n' ' ')"
	doctor >/dev/null
	ensure_playwright
	CONTINUARR_VERIFY_TOOLS="$TOOLS_DIR" \
		CONTINUARR_VERIFY_RUN_DIR="$RUN_DIR" \
		CONTINUARR_VERIFY_EVIDENCE="$(read_state evidence-dir)/$journey" \
		CONTINUARR_FRONTEND_URL="$FRONTEND_URL" \
		CONTINUARR_BACKEND_URL="$BACKEND_URL" \
		CONTINUARR_SETUP_TOKEN="$(token 2>/dev/null || true)" \
		node "$script"
}

stop_pid() {
	local pid="$1"
	is_alive "$pid" || return 0
	kill "$pid" 2>/dev/null || true
	local deadline=$((SECONDS + STOP_TIMEOUT_SECONDS))
	while is_alive "$pid" && ((SECONDS < deadline)); do sleep 1; done
	is_alive "$pid" && kill -9 "$pid" 2>/dev/null || true
}

cleanup() {
	[[ -d "$RUN_DIR" ]] || { echo "nothing to clean up"; return; }
	local evidence_dir pidfile id
	evidence_dir="$(read_state evidence-dir)"
	for pidfile in frontend-app.pid frontend-npm.pid backend-app.pid backend-gradle.pid; do
		stop_pid "$(read_state "$pidfile")"
	done
	# Testcontainers' reaper removes them once the app exits; force only the ones this run recorded.
	local deadline=$((SECONDS + CONTAINER_REAP_TIMEOUT_SECONDS))
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
	drive) drive "${2:-}" ;;
	cleanup) cleanup ;;
	*) die "usage: control.sh launch | doctor | token | drive <journey> | cleanup" ;;
esac
