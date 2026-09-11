import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SIZE_THRESHOLDS = [
  { maximumExclusive: 10, label: "size:XS" },
  { maximumExclusive: 30, label: "size:S" },
  { maximumExclusive: 100, label: "size:M" },
  { maximumExclusive: 500, label: "size:L" },
  { maximumExclusive: 1_000, label: "size:XL" },
];

const TEST_DIRECTORY_NAMES = new Set(["__tests__", "test", "tests"]);
const TEST_FILE_MARKERS = [".test.", ".spec."];

export function isTestPath(path) {
  const normalizedPath = path.replaceAll("\\", "/");
  const pathSegments = normalizedPath.split("/");
  const fileName = pathSegments.at(-1) ?? "";

  return (
    pathSegments.some((segment) => TEST_DIRECTORY_NAMES.has(segment)) ||
    TEST_FILE_MARKERS.some((marker) => fileName.includes(marker))
  );
}

export function resolveSizeLabel(changedLines) {
  const threshold = SIZE_THRESHOLDS.find(
    ({ maximumExclusive }) => changedLines < maximumExclusive,
  );

  return threshold?.label ?? "size:XXL";
}

export function summarizeNumstat(numstat) {
  let productionLines = 0;
  let testLines = 0;
  const records = numstat.split("\0");

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    const firstSeparator = record.indexOf("\t");
    const secondSeparator = record.indexOf("\t", firstSeparator + 1);
    if (firstSeparator === -1 || secondSeparator === -1) {
      throw new Error(`Unexpected git numstat record: ${JSON.stringify(record)}`);
    }

    const additionsText = record.slice(0, firstSeparator);
    const deletionsText = record.slice(firstSeparator + 1, secondSeparator);
    let path = record.slice(secondSeparator + 1);
    if (!path) {
      const renamedPath = records[index + 2];
      if (!records[index + 1] || !renamedPath) {
        throw new Error(`Incomplete git numstat rename: ${JSON.stringify(record)}`);
      }
      path = renamedPath;
      index += 2;
    }
    const additions = additionsText === "-" ? 0 : Number.parseInt(additionsText, 10);
    const deletions = deletionsText === "-" ? 0 : Number.parseInt(deletionsText, 10);
    const changedLines = additions + deletions;

    if (!Number.isFinite(changedLines)) {
      throw new Error(`Unexpected git numstat counts: ${JSON.stringify(record)}`);
    }

    if (isTestPath(path)) {
      testLines += changedLines;
    } else {
      productionLines += changedLines;
    }
  }

  const effectiveLines = productionLines === 0 ? testLines : productionLines;

  return {
    effectiveLines,
    label: resolveSizeLabel(effectiveLines),
    productionLines,
    testLines,
  };
}

export function calculatePullRequestSize(baseSha, headSha, repository = process.cwd()) {
  const numstat = execFileSync(
    "git",
    [
      "diff",
      "--numstat",
      "-z",
      "--ignore-all-space",
      "--ignore-blank-lines",
      `${baseSha}...${headSha}`,
    ],
    { cwd: repository, encoding: "utf8" },
  );

  return summarizeNumstat(numstat);
}

const isCommandLineEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCommandLineEntryPoint) {
  const [, , baseSha, headSha] = process.argv;
  if (!baseSha || !headSha) {
    throw new Error("Usage: node .github/scripts/pr-size.mjs <base-sha> <head-sha>");
  }

  process.stdout.write(JSON.stringify(calculatePullRequestSize(baseSha, headSha)));
}
