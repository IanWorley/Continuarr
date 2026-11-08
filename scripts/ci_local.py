#!/usr/bin/env python3
"""Run the checks in .github/workflows on this machine, in CI's order, stopping at the first failure.

Usage: python3 scripts/ci_local.py [backend|frontend] [--agent | --manual] [--model MODEL] [--effort EFFORT]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ElementTree
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, NamedTuple

Job = Literal["backend", "frontend"]
Result = Literal["pass", "fail", "not run"]

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = REPO_ROOT / "backend"
FRONTEND_DIR = REPO_ROOT / "frontend"
LOG_DIR = REPO_ROOT / "build" / "ci-local"

# Gradle needs JDK 17+ to start. The build's toolchain then provides the JDK 25 that CI installs.
MIN_GRADLE_JAVA = 17
# Group 1 is the full version and group 2 the major. JDK 8 and older report "1.8.0_402", major 8.
JAVA_VERSION_PATTERN = re.compile(r'version "((?:1\.)?(\d+)[^"]*)"')
FRONTEND_CHECK_SCRIPT = "check"
JUNIT_RESULTS = BACKEND_DIR / "build" / "test-results" / "test"
# Vitest's summary line, such as "Tests  1 failed | 126 passed | 1 skipped (128)".
VITEST_SUMMARY_PATTERN = re.compile(r"^\s*Tests\s+(.*)\((\d+)\)\s*$", re.MULTILINE)
VITEST_PASSED_PATTERN = re.compile(r"(\d+) passed")
ANSI_ESCAPE_PATTERN = re.compile(r"\x1b\[[0-9;]*m")
PASS_MARK = "✅"
FAIL_MARK = "❌"
DETEKT_REPORTS = BACKEND_DIR / "build" / "reports" / "detekt"
# Reruns the configured lint script with machine-readable output, only after it fails.
OXLINT_JSON_COMMAND = "npm run --silent lint -- --format=json"
WRAPPER_PROPERTIES = BACKEND_DIR / "gradle" / "wrapper" / "gradle-wrapper.properties"
WRAPPER_JAR = BACKEND_DIR / "gradle" / "wrapper" / "gradle-wrapper.jar"
# Fixed here, not read from the repo, so a PR can't point the check at a checksum it controls.
WRAPPER_CHECKSUM_URL = "https://services.gradle.org/distributions/gradle-{version}-wrapper.jar.sha256"
GRADLE_VERSION_PATTERN = re.compile(r"^distributionUrl=.*/gradle-([0-9A-Za-z.+-]+?)-(?:bin|all)\.zip$", re.MULTILINE)
NETWORK_TIMEOUT_SECONDS = 10
GH_TIMEOUT_SECONDS = 5
FILL_IN = "<fill in: {}>"


class Harness(NamedTuple):
    env: str
    name: str
    effort_env: str | None = None


# Checked in order. Each env var is one the harness sets for the commands its agent runs.
AGENT_HARNESSES = (
    Harness("CLAUDECODE", "Claude Code", "CLAUDE_EFFORT"),
    Harness("CODEX_THREAD_ID", "Codex"),
    Harness("CURSOR_AGENT", "Cursor"),
)
# Apps that host a harness, named in front of it, as in "T3 Code (Claude Code)".
HOSTS = (("T3CODE_BASE_URL", "T3 Code"),)
# A cross-tool convention whose value names the agent, used when no harness above matches.
GENERIC_AGENT_ENV = "AI_AGENT"


class Agent(NamedTuple):
    harness: str | None
    model: str | None
    effort: str | None


class Counts(NamedTuple):
    passed: int
    total: int


def written_since(paths: list[Path], since: float | None) -> list[Path]:
    # A failed Gradle task leaves the reports of tasks that never ran from an earlier build.
    return [path for path in sorted(paths) if since is None or path.stat().st_mtime >= since]


def junit_counts(_log: Path, since: float | None) -> Counts | None:
    suites = [ElementTree.parse(path).getroot() for path in written_since(list(JUNIT_RESULTS.glob("*.xml")), since)]
    if not suites:
        return None
    total = sum(int(suite.get("tests", 0)) for suite in suites)
    not_passed = sum(int(suite.get(key, 0)) for suite in suites for key in ("failures", "errors", "skipped"))
    return Counts(total - not_passed, total)


def vitest_counts(log: Path, _since: float | None) -> Counts | None:
    match = VITEST_SUMMARY_PATTERN.search(ANSI_ESCAPE_PATTERN.sub("", log.read_text()))
    if match is None:
        return None
    passed = VITEST_PASSED_PATTERN.search(match.group(1))
    return Counts(int(passed.group(1)) if passed else 0, int(match.group(2)))


def detekt_findings(since: float) -> Counter[str]:
    reports = written_since(list(DETEKT_REPORTS.glob("*.xml")), since)
    return Counter(error.get("source", "").rsplit(".", 1)[-1]
                   for report in reports for error in ElementTree.parse(report).iter("error"))


def oxlint_findings(_since: float) -> Counter[str]:
    output = subprocess.run(OXLINT_JSON_COMMAND, shell=True, cwd=FRONTEND_DIR, env=step_env(),
                            capture_output=True, text=True).stdout
    try:
        diagnostics = json.loads(output)["diagnostics"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return Counter()
    # Some diagnostics, such as an unused disable directive, have no rule code.
    return Counter(diagnostic.get("code") or diagnostic.get("message", "unknown") for diagnostic in diagnostics)


class Lint(NamedTuple):
    tool: str
    findings: Callable[[float], Counter[str]]


@dataclass(frozen=True)
class Step:
    job: Job
    name: str
    command: str
    cwd: Path
    # Globs under cwd that must each match a path for the step to pass.
    artifacts: tuple[str, ...] = ()
    # Reads the suite's test counts after a test step. Skipped tests count in the total, not as passed.
    counts: Callable[[Path, float | None], Counts | None] | None = None
    # Counts the rules that failed, read after a lint step fails.
    lint: Lint | None = None

    @property
    def log(self) -> Path:
        return LOG_DIR / (re.sub(r"\W+", "-", f"{self.job} {self.name}".lower()).strip("-") + ".log")


BACKEND_STEPS = (
    Step("backend", "Lint (detekt)", "./gradlew detektMain detektTest", BACKEND_DIR,
         ("build/reports/detekt/main.*", "build/reports/detekt/test.*"), lint=Lint("detekt", detekt_findings)),
    Step("backend", "Test", "./gradlew test", BACKEND_DIR,
         ("build/classes/kotlin/main", "build/reports/tests/test/index.html", "build/test-results/test/*.xml"),
         junit_counts),
)

# CI runs `npm ci` and then `npm run check`. The steps after install are the parts of `check`,
# split so each gets its own result. check_frontend_steps() fails when package.json drifts from them.
FRONTEND_STEPS = (
    Step("frontend", "Install", "npm ci", FRONTEND_DIR, ("node_modules",)),
    Step("frontend", "Typecheck", "npm run typecheck", FRONTEND_DIR, ("src/api/schema.d.ts",)),
    Step("frontend", "Lint (oxlint)", "npm run lint", FRONTEND_DIR, lint=Lint("oxlint", oxlint_findings)),
    Step("frontend", "Test", "npm test", FRONTEND_DIR, counts=vitest_counts),
    Step("frontend", "Build", "vite build", FRONTEND_DIR, ("dist/index.html", "dist/assets/*")),
)

STEPS: dict[Job, tuple[Step, ...]] = {"backend": BACKEND_STEPS, "frontend": FRONTEND_STEPS}


def major_version(text: str) -> int:
    return int(text.strip().lstrip("v").split(".")[0])


def check_java() -> str | None:
    java_home = os.environ.get("JAVA_HOME")
    java = str(Path(java_home) / "bin" / "java") if java_home else shutil.which("java")
    if java is None or not Path(java).exists():
        return f"backend needs JDK {MIN_GRADLE_JAVA}+ to start Gradle, and no java was found on JAVA_HOME or PATH."
    output = subprocess.run([java, "-version"], capture_output=True, text=True).stderr
    match = JAVA_VERSION_PATTERN.search(output)
    if match is None or int(match.group(2)) < MIN_GRADLE_JAVA:
        found = match.group(1) if match else "an unknown version"
        return f"backend needs JDK {MIN_GRADLE_JAVA}+ to start Gradle, but {java} is {found}."
    return None


def check_gradle_wrapper() -> str | None:
    # CI's gradle/actions/setup-gradle validates the wrapper jar before any Gradle task runs.
    match = GRADLE_VERSION_PATTERN.search(WRAPPER_PROPERTIES.read_text())
    if match is None:
        return f"{WRAPPER_PROPERTIES.relative_to(REPO_ROOT)} has no distributionUrl with a Gradle version."
    url = WRAPPER_CHECKSUM_URL.format(version=match.group(1))
    try:
        with urllib.request.urlopen(url, timeout=NETWORK_TIMEOUT_SECONDS) as response:
            expected = response.read().decode().strip()
    except (urllib.error.URLError, TimeoutError) as error:
        return f"couldn't fetch {url} to validate the Gradle wrapper jar as CI does: {error}"
    actual = hashlib.sha256(WRAPPER_JAR.read_bytes()).hexdigest()
    if actual != expected:
        return f"{WRAPPER_JAR.relative_to(REPO_ROOT)} has SHA-256 {actual}, but {url} lists {expected}."
    return None


def check_docker() -> str | None:
    if shutil.which("docker") is None:
        return "backend tests need Docker for Testcontainers, and docker is not on PATH."
    if subprocess.run(["docker", "info"], capture_output=True).returncode != 0:
        return "backend tests need Docker for Testcontainers, and `docker info` failed. Start Docker."
    return None


def check_node() -> str | None:
    pinned = (FRONTEND_DIR / ".nvmrc").read_text().strip()
    node = shutil.which("node")
    if node is None:
        return f"frontend needs Node {pinned} from frontend/.nvmrc, and node is not on PATH."
    found = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
    if major_version(found) != major_version(pinned):
        return f"frontend/.nvmrc pins Node {pinned}, but {node} is {found}. Switch Node, for example with `nvm use` in frontend/."
    return None


def check_frontend_steps() -> str | None:
    scripts = json.loads((FRONTEND_DIR / "package.json").read_text())["scripts"]
    expected = " && ".join(step.command for step in FRONTEND_STEPS[1:])
    if scripts.get(FRONTEND_CHECK_SCRIPT) != expected:
        return (f"frontend/package.json `{FRONTEND_CHECK_SCRIPT}` is {scripts.get(FRONTEND_CHECK_SCRIPT)!r}, "
                f"but scripts/ci_local.py runs {expected!r}. Update FRONTEND_STEPS to match.")
    return None


PREREQUISITES = {"backend": (check_java, check_gradle_wrapper, check_docker), "frontend": (check_node, check_frontend_steps)}


def step_env() -> dict[str, str]:
    # npm adds node_modules/.bin to PATH for its scripts, and `vite build` comes from inside `check`.
    return {**os.environ, "PATH": f"{FRONTEND_DIR / 'node_modules' / '.bin'}{os.pathsep}{os.environ['PATH']}"}


def run(step: Step) -> bool:
    with step.log.open("w") as log, subprocess.Popen(
        step.command, shell=True, cwd=step.cwd, env=step_env(),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace",
    ) as process:
        assert process.stdout is not None
        for line in process.stdout:
            sys.stdout.write(line)
            log.write(line)
    return process.returncode == 0


def report_artifacts(step: Step) -> bool:
    found_all = True
    for pattern in step.artifacts:
        matches = sorted(step.cwd.glob(pattern))
        if not matches:
            print(f"    MISSING artifact: {step.cwd / pattern}")
            found_all = False
        elif len(matches) == 1:
            print(f"    artifact: {matches[0]}")
        else:
            print(f"    artifact: {step.cwd / pattern} ({len(matches)} files)")
    return found_all


def detect_harness() -> tuple[str | None, str | None]:
    """Returns the harness name and its effort level, from env vars the harness sets."""
    harness = next((harness for harness in AGENT_HARNESSES if os.environ.get(harness.env)), None)
    if harness is not None:
        name, effort = harness.name, os.environ.get(harness.effort_env) if harness.effort_env else None
    elif os.environ.get(GENERIC_AGENT_ENV):
        name, effort = os.environ[GENERIC_AGENT_ENV], None
    else:
        return None, None
    host = next((label for variable, label in HOSTS if os.environ.get(variable)), None)
    return (f"{host} ({name})" if host else name), effort


def resolve_agent(args: argparse.Namespace) -> Agent | None:
    harness, effort = detect_harness()
    if args.manual or (harness is None and not args.agent):
        return None
    return Agent(harness, args.model, args.effort or effort)


def acting_user() -> tuple[str, str]:
    """Returns the person the agent acts for, and where each part came from."""
    login = name = None
    sources: list[str] = []
    if shutil.which("gh"):
        try:
            gh = subprocess.run(["gh", "api", "user", "--jq", '.login + "\\t" + (.name // "")'],
                                capture_output=True, text=True, timeout=GH_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            gh = None
        if gh is not None and gh.returncode == 0:
            gh_login, _, gh_name = gh.stdout.strip().partition("\t")
            login, name = gh_login or None, gh_name or None
            sources.append("gh api user")
    if name is None and shutil.which("git"):
        name = subprocess.run(["git", "config", "user.name"], capture_output=True, text=True,
                              cwd=REPO_ROOT).stdout.strip() or None
        if name:
            sources.append("git config user.name")
    if login is None and os.environ.get("GITHUB_ACTOR"):
        login = os.environ["GITHUB_ACTOR"]
        sources.append("GITHUB_ACTOR")
    if name and login:
        user = f"{name} (@{login})"
    else:
        user = name or (f"@{login}" if login else FILL_IN.format("your GitHub user"))
    return user, ", ".join(sources) or "nothing detected"


def attribution(agent: Agent, user: str) -> str:
    model = agent.model or FILL_IN.format("model")
    harness = agent.harness or FILL_IN.format("harness")
    effort = agent.effort or FILL_IN.format("effort")
    return f"This was written by an AI agent on behalf of {user}. Model: {model} · Harness: {harness} · Effort: {effort}"


def print_paste_block(results: dict[Step, Result], counts: dict[Job, Counts],
                      lint_failures: dict[str, Counter[str]], agent: Agent | None, user: str | None) -> None:
    # Deterministic for the same results and environment, so it can be pasted into a PR as is.
    print("\n--- Paste everything below into the PR body ---")
    print("\n| Suite | Tests passed | Result |\n|-------|--------------|--------|")
    for job in dict.fromkeys(step.job for step in results):
        job_counts = counts.get(job)
        tests = f"{job_counts.passed}/{job_counts.total}" if job_counts else "not run"
        # A suite passes only when its whole CI job does.
        passed = all(result == "pass" for step, result in results.items() if step.job == job)
        print(f"| {job.capitalize()} | {tests} | {PASS_MARK if passed else FAIL_MARK} |")
    for tool, findings in lint_failures.items():
        rules = sorted(findings.items(), key=lambda rule: (-rule[1], rule[0]))
        print(f"\n{tool}: " + (", ".join(f"{rule} ×{count}" for rule, count in rules) or "failed with no rule findings"))
    if agent is None:
        print("\nRun by: manual")
    else:
        print(f"\nRun by: agent in {agent.harness or FILL_IN.format('harness')}")
        print(f"\n{attribution(agent, user or FILL_IN.format('your GitHub user'))}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("job", nargs="?", choices=list(STEPS), help="run only this CI job (default: both)")
    run_by = parser.add_mutually_exclusive_group()
    run_by.add_argument("--agent", action="store_true", help="mark the run as an agent's, whatever the env says")
    run_by.add_argument("--manual", action="store_true", help="mark the run as a person's, whatever the env says")
    parser.add_argument("--model", help="the agent's model, for the attribution line")
    parser.add_argument("--effort", help="the agent's effort level, overriding the one the harness sets")
    args = parser.parse_args()
    jobs: list[Job] = [args.job] if args.job else list(STEPS)

    agent = resolve_agent(args)
    user = None
    if agent is None:
        print("Run by: manual", flush=True)
    else:
        user, sources = acting_user()
        print(f"Run by: agent in {agent.harness or FILL_IN.format('harness')}, on behalf of {user} (from {sources})",
              flush=True)

    problems = [p for job in jobs for check in PREREQUISITES[job] if (p := check()) is not None]
    if problems:
        print("Prerequisites not met:", *(f"  - {p}" for p in problems), sep="\n", file=sys.stderr)
        return 1

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[Step, Result] = {step: "not run" for job in jobs for step in STEPS[job]}
    counts: dict[Job, Counts] = {}
    lint_failures: dict[str, Counter[str]] = {}
    for step in results:
        print(f"\n==> {step.job} {step.name}: {step.command}", flush=True)
        started, started_at = time.monotonic(), time.time()
        passed = run(step)
        print(f"    log: {step.log}")
        # Report artifacts after a failure too, since a failed step's reports explain it.
        passed = report_artifacts(step) and passed
        if step.counts is not None:
            step_counts = step.counts(step.log, None if passed else started_at)
            if step_counts is not None:
                counts[step.job] = step_counts
                print(f"    tests: {step_counts.passed}/{step_counts.total} passed")
            elif passed:
                print("    MISSING test counts")
                passed = False
        if step.lint is not None and not passed:
            lint_failures[step.lint.tool] = step.lint.findings(started_at)
        results[step] = "pass" if passed else "fail"
        print(f"<== {step.job} {step.name}: {results[step]} in {time.monotonic() - started:.1f}s", flush=True)
        if not passed:
            break

    print_paste_block(results, counts, lint_failures, agent, user)
    return 0 if all(result == "pass" for result in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
