import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  calculatePullRequestSize,
  isTestPath,
  resolveSizeLabel,
  summarizeNumstat,
} from "./pr-size.mjs";

describe("resolveSizeLabel", () => {
  const boundaryCases = [
    [0, "size:XS"],
    [9, "size:XS"],
    [10, "size:S"],
    [200, "size:S"],
    [201, "size:M"],
    [400, "size:M"],
    [401, "size:L"],
    [800, "size:L"],
    [801, "size:XL"],
    [1_500, "size:XL"],
    [1_501, "size:XXL"],
  ];

  for (const [changedLines, expectedLabel] of boundaryCases) {
    test(`${changedLines} lines is ${expectedLabel}`, () => {
      assert.equal(resolveSizeLabel(changedLines), expectedLabel);
    });
  }
});

describe("isTestPath", () => {
  test("recognizes supported test files and directories", () => {
    assert.equal(isTestPath("src/api.test.ts"), true);
    assert.equal(isTestPath("src/api.spec.tsx"), true);
    assert.equal(isTestPath("src/__tests__/api.ts"), true);
    assert.equal(isTestPath("src/test/api.ts"), true);
    assert.equal(isTestPath("src/tests/api.ts"), true);
    assert.equal(isTestPath("src/testing/api.ts"), false);
    assert.equal(isTestPath("src/api.ts"), false);
  });
});

describe("summarizeNumstat", () => {
  test("excludes tests when production files changed", () => {
    const result = summarizeNumstat(
      ["25\t5\tsrc/api.ts", "5\t5\tsrc/api.test.ts", ""].join("\0"),
    );

    assert.deepEqual(result, {
      effectiveLines: 30,
      label: "size:S",
      productionLines: 30,
      testLines: 10,
    });
  });

  test("sizes a test-only change using its test lines", () => {
    const result = summarizeNumstat("20\t10\tsrc/api.spec.ts\0");

    assert.deepEqual(result, {
      effectiveLines: 30,
      label: "size:S",
      productionLines: 0,
      testLines: 30,
    });
  });

  test("handles Git's null-delimited rename format", () => {
    const result = summarizeNumstat("0\t0\t\0src/old.ts\0src/new.ts\0");

    assert.deepEqual(result, {
      effectiveLines: 0,
      label: "size:XS",
      productionLines: 0,
      testLines: 0,
    });
  });
});

describe("calculatePullRequestSize", () => {
  test("ignores whitespace and blank lines in the merge-base diff", () => {
    const repository = mkdtempSync(join(tmpdir(), "continuarr-pr-size-"));
    const git = (...arguments_) =>
      execFileSync("git", arguments_, { cwd: repository, encoding: "utf8" }).trim();

    try {
      git("init", "--quiet");
      git("config", "user.email", "pr-size-test@example.com");
      git("config", "user.name", "PR Size Test");
      writeFileSync(join(repository, "app.ts"), "const value = 1;\n");
      writeFileSync(join(repository, "app.test.ts"), "assert(value);\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "base");
      const baseSha = git("rev-parse", "HEAD");

      writeFileSync(join(repository, "app.ts"), "const   value=1;\n\n");
      writeFileSync(join(repository, "app.test.ts"), "assert(value);\nassert(otherValue);\n");
      git("add", ".");
      git("commit", "--quiet", "-m", "head");
      const headSha = git("rev-parse", "HEAD");

      assert.deepEqual(calculatePullRequestSize(baseSha, headSha, repository), {
        effectiveLines: 1,
        label: "size:XS",
        productionLines: 0,
        testLines: 1,
      });
    } finally {
      rmSync(repository, { force: true, recursive: true });
    }
  });
});
