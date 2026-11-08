#!/usr/bin/env python3
"""Run the checks in .github/workflows on this machine, in CI's order, stopping at the first failure.

Usage: python3 scripts/ci_local.py [backend|frontend]
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ElementTree
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


class Counts(NamedTuple):
    passed: int
    total: int


def junit_counts(_log: Path) -> Counts | None:
    suites = [ElementTree.parse(path).getroot() for path in sorted(JUNIT_RESULTS.glob("*.xml"))]
    if not suites:
        return None
    total = sum(int(suite.get("tests", 0)) for suite in suites)
    not_passed = sum(int(suite.get(key, 0)) for suite in suites for key in ("failures", "errors", "skipped"))
    return Counts(total - not_passed, total)


def vitest_counts(log: Path) -> Counts | None:
    match = VITEST_SUMMARY_PATTERN.search(ANSI_ESCAPE_PATTERN.sub("", log.read_text()))
    if match is None:
        return None
    passed = VITEST_PASSED_PATTERN.search(match.group(1))
    return Counts(int(passed.group(1)) if passed else 0, int(match.group(2)))


@dataclass(frozen=True)
class Step:
    job: Job
    name: str
    command: str
    cwd: Path
    # Globs under cwd that must each match a path for the step to pass.
    artifacts: tuple[str, ...] = ()
    # Reads the suite's test counts after a test step. Skipped tests count in the total, not as passed.
    counts: Callable[[Path], Counts | None] | None = None

    @property
    def log(self) -> Path:
        return LOG_DIR / (re.sub(r"\W+", "-", f"{self.job} {self.name}".lower()).strip("-") + ".log")


BACKEND_STEPS = (
    Step("backend", "Lint (detekt)", "./gradlew detektMain detektTest", BACKEND_DIR,
         ("build/reports/detekt/main.*", "build/reports/detekt/test.*")),
    Step("backend", "Test", "./gradlew test", BACKEND_DIR,
         ("build/classes/kotlin/main", "build/reports/tests/test/index.html", "build/test-results/test/*.xml"),
         junit_counts),
)

# CI runs `npm ci` and then `npm run check`. The steps after install are the parts of `check`,
# split so each gets its own result. check_frontend_steps() fails when package.json drifts from them.
FRONTEND_STEPS = (
    Step("frontend", "Install", "npm ci", FRONTEND_DIR, ("node_modules",)),
    Step("frontend", "Typecheck", "npm run typecheck", FRONTEND_DIR, ("src/api/schema.d.ts",)),
    Step("frontend", "Lint (oxlint)", "npm run lint", FRONTEND_DIR),
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


PREREQUISITES = {"backend": (check_java, check_docker), "frontend": (check_node, check_frontend_steps)}


def run(step: Step) -> bool:
    # npm adds node_modules/.bin to PATH for its scripts, and `vite build` comes from inside `check`.
    env = {**os.environ, "PATH": f"{FRONTEND_DIR / 'node_modules' / '.bin'}{os.pathsep}{os.environ['PATH']}"}
    with step.log.open("w") as log, subprocess.Popen(
        step.command, shell=True, cwd=step.cwd, env=env,
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


def print_table(results: dict[Step, Result], counts: dict[Job, Counts]) -> None:
    # Deterministic so it can be pasted into a PR as is. A suite passes only when its whole CI job does.
    print("\n| Suite | Tests passed | Result |\n|-------|--------------|--------|")
    for job in dict.fromkeys(step.job for step in results):
        job_counts = counts.get(job)
        tests = f"{job_counts.passed}/{job_counts.total}" if job_counts else "not run"
        passed = all(result == "pass" for step, result in results.items() if step.job == job)
        print(f"| {job.capitalize()} | {tests} | {PASS_MARK if passed else FAIL_MARK} |")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("job", nargs="?", choices=list(STEPS), help="run only this CI job (default: both)")
    only: Job | None = parser.parse_args().job
    jobs: list[Job] = [only] if only else list(STEPS)

    problems = [p for job in jobs for check in PREREQUISITES[job] if (p := check()) is not None]
    if problems:
        print("Prerequisites not met:", *(f"  - {p}" for p in problems), sep="\n", file=sys.stderr)
        return 1

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    results: dict[Step, Result] = {step: "not run" for job in jobs for step in STEPS[job]}
    counts: dict[Job, Counts] = {}
    for step in results:
        print(f"\n==> {step.job} {step.name}: {step.command}", flush=True)
        started = time.monotonic()
        passed = run(step)
        print(f"    log: {step.log}")
        # Report artifacts after a failure too, since a failed step's reports explain it.
        passed = report_artifacts(step) and passed
        if step.counts is not None:
            step_counts = step.counts(step.log)
            if step_counts is None:
                print("    MISSING test counts")
                passed = False
            else:
                counts[step.job] = step_counts
                print(f"    tests: {step_counts.passed}/{step_counts.total} passed")
        results[step] = "pass" if passed else "fail"
        print(f"<== {step.job} {step.name}: {results[step]} in {time.monotonic() - started:.1f}s", flush=True)
        if not passed:
            break

    print_table(results, counts)
    return 0 if all(result == "pass" for result in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
