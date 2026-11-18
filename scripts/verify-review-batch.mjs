import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function changedReviewRecords(current, previous) {
  if (
    current?.schemaVersion !== 1 ||
    !Array.isArray(current.records) ||
    previous.some(
      (registry) =>
        registry?.schemaVersion !== 1 || !Array.isArray(registry.records)
    )
  )
    throw new Error("Invalid review registry");
  return current.records.filter((record) =>
    previous.some(
      (registry) =>
        !registry.records.some(
          (old) => JSON.stringify(old) === JSON.stringify(record)
        )
    )
  );
}

export function reviewBatchTests(records, reports) {
  const confirmed = reports.flatMap(
    (report) =>
      report.confirmedAuditReviews ?? report.confirmedSemanticReviews ?? []
  );
  const refs = new Set();
  for (const record of records) {
    if (
      record.schemaVersion !== 3 ||
      !confirmed.some(
        (finding) =>
          finding.reviewResolution?.status === "confirmed_correct" &&
          JSON.stringify(finding.reviewResolution.record) ===
            JSON.stringify(record)
      )
    )
      throw new Error(
        `Review is not currently confirmed: ${record.cardNo} ${record.kind}`
      );
    for (const ref of record.testRefs) refs.add(ref.path);
  }
  return [...refs].sort();
}

export function verifyReviewBatch(root, bases) {
  const registryPath = "scripts/fidelity-review-resolutions.json";
  const current = JSON.parse(readFileSync(resolve(root, registryPath), "utf8"));
  const previous = bases.map((base) =>
    JSON.parse(
      execFileSync("git", ["-C", root, "show", `${base}:${registryPath}`], {
        encoding: "utf8",
      })
    )
  );
  const changed = changedReviewRecords(current, previous);
  const reports = ["cards-coverage.mjs", "cards-fidelity-audit.mjs"].map(
    (script) =>
      JSON.parse(
        execFileSync(
          process.execPath,
          [resolve(root, "scripts", script), "--json"],
          {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 32 * 1024 * 1024,
            windowsHide: true,
          }
        )
      )
  );
  const tests = reviewBatchTests(changed, reports);
  const vitest = tests.filter((file) => file.endsWith(".test.ts"));
  const commands = tests
    .filter((file) => !vitest.includes(file))
    .map((file) => [file]);
  if (vitest.length)
    commands.push(["scripts/vitest-with-jest-aliases.mjs", ...vitest]);
  for (const args of commands) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error || result.status !== 0)
      throw new Error(`Review regression failed: ${args.join(" ")}`);
  }
  console.log(
    `[review-batch] ${changed.length} changed confirmations; ${tests.length} distinct regression files passed`
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const args = process.argv.slice(2),
      bases = [];
    for (let i = 0; i < args.length; i += 2) {
      if (args[i] !== "--base" || !args[i + 1] || args[i + 1].startsWith("-"))
        throw new Error("Expected --base GIT_REF");
      bases.push(args[i + 1]);
    }
    verifyReviewBatch(process.cwd(), bases.length ? bases : ["HEAD"]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
