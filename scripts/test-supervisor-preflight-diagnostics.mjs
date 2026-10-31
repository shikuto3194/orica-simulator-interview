import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const helper = join(root, "scripts/lib/full-run-checkout-preflight.ps1");
const temp = mkdtempSync(join(tmpdir(), "orica-supervisor-preflight-"));
if (
  !resolve(temp).startsWith(
    resolve(tmpdir()) + (process.platform === "win32" ? "\\" : "/")
  )
)
  throw new Error("Unexpected fixture root");

const fixture = join(temp, "mock-preflight.mjs");
const driver = join(temp, "driver.ps1");
writeFileSync(
  fixture,
  [
    'if (process.env.PREFLIGHT_FAILURE === "1") {',
    '  process.stderr.write("[full-run-checkouts] Worker Git operation in progress: MERGE_HEAD 競合\\n");',
    "  process.exit(2);",
    "}",
    'process.stderr.write("[full-run-checkouts] optional warning\\n");',
    "process.stdout.write('{\"ready\":true}\\n');",
    "",
  ].join("\n"),
  "utf8"
);
const ps = [
  ". '" + helper.replaceAll("'", "''") + "'",
  "try {",
  "  $result = Invoke-FullRunCheckoutPreflight -Node '" +
    process.execPath.replaceAll("'", "''") +
    "' -Script '" +
    fixture.replaceAll("'", "''") +
    "' -Repo 'C:\\fixture\\repo'",
  "  if ($env:PREFLIGHT_FAILURE -eq '1') { throw 'Expected the preflight to fail' }",
  '  if ($result.Trim() -ne \'{"ready":true}\') { throw "Unexpected successful output: $result" }',
  "  if ($env:PREFLIGHT_FAILURE -eq '0' -and $result.Contains('optional warning')) { throw 'Successful stderr must not contaminate JSON output' }",
  "  Write-Output 'success output preserved'",
  "} catch {",
  "  $message = $_.Exception.Message",
  "  if ($env:PREFLIGHT_FAILURE -eq '1' -and $message.Contains('exit 2') -and $message.Contains('Worker Git operation in progress: MERGE_HEAD 競合')) {",
  "    Write-Output 'failure diagnostic preserved'",
  "    exit 0",
  "  }",
  "  Write-Error $message",
  "  exit 1",
  "}",
  "",
].join("\n");
writeFileSync(driver, ps, "utf8");

try {
  for (const failure of ["0", "1"]) {
    const result = spawnSync(
      "pwsh",
      ["-NoLogo", "-NoProfile", "-File", driver],
      {
        encoding: "utf8",
        env: { ...process.env, PREFLIGHT_FAILURE: failure },
        timeout: 10_000,
      }
    );
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(
      result.stdout,
      failure === "1"
        ? /failure diagnostic preserved/
        : /success output preserved/
    );
  }
  console.log(
    "[test-supervisor-preflight-diagnostics] passed: preserves JSON success output and actionable failure stderr"
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
