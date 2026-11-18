import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { EOL, tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath, URL } from "node:url";

const scripts = fileURLToPath(new URL(".", import.meta.url));
const registration = join(scripts, "register-watchdog-task.ps1");
const logHelper = join(scripts, "lib/supervisor-run-log.ps1");
const control = join(tmpdir(), "orica-pinned main");
const wrapper = readFileSync(
  join(scripts, "run-supervisor-iteration.ps1"),
  "utf8"
);
assert.match(
  wrapper,
  /New-SupervisorRunLog -LogDir \$LogDir -RunProcessId \$PID/
);
assert.match(wrapper, /\$env:ORICA_SUPERVISOR_RUN_LOG = \$Log/);
assert.doesNotMatch(
  wrapper,
  /\$Log = Join-Path \$LogDir "supervisor-run\.log"/
);

function runtimeChecks() {
  const pwsh = spawnSync(
    "pwsh",
    ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 15_000,
    }
  );
  if (pwsh.error?.code === "ENOENT") {
    console.log(
      "supervisor environment: source contracts passed; SKIP PowerShell runtime (pwsh unavailable)"
    );
    return;
  }
  assert.equal(pwsh.status, 0, pwsh.stderr);
  const withoutPath = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => name.toUpperCase() !== "PATH"
    )
  );
  const importedWithoutPwsh = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "await import(" +
        JSON.stringify(import.meta.url) +
        "); console.log('environment-import-continued')",
    ],
    {
      env: { ...withoutPath, PATH: join(tmpdir(), "orica-no-executables") },
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    }
  );
  assert.equal(importedWithoutPwsh.status, 0, importedWithoutPwsh.stderr);
  assert.match(importedWithoutPwsh.stdout, /SKIP PowerShell runtime/);
  assert.match(importedWithoutPwsh.stdout, /environment-import-continued/);
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  function run(lines) {
    const result = spawnSync(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-Command", lines.join("\n")],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
      }
    );
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const line = result.stdout
      .split(/\r?\n/)
      .find((item) => item.startsWith("RESULT_JSON="));
    assert.ok(line, result.stdout);
    return JSON.parse(line.slice("RESULT_JSON=".length));
  }

  // Run the production checkout-to-resume environment block. The resume path
  // must receive the same data roots that the later worker inherits.
  const publicationEnvironment = wrapper.slice(
    wrapper.indexOf("  $ClusterRegistry = Join-Path $Worktree"),
    wrapper.indexOf("  # Recover confirmed dead validation owners")
  );
  assert.ok(publicationEnvironment.includes("$env:ORICA_CLUSTER_REGISTRY"));
  assert.ok(
    wrapper.indexOf(publicationEnvironment) <
      wrapper.indexOf('supervisor-integration.mjs" resume')
  );
  const publicationRoots = run([
    "$Worktree = " + quote(control),
    "$Repo = " + quote(join(tmpdir(), "orica-hub")),
    publicationEnvironment,
    "'RESULT_JSON=' + (@{registry=$env:ORICA_CLUSTER_REGISTRY;debug=$env:ORICA_EFFECT_DEBUG_HUB_ROOT;hub=$env:ORICA_SUPERVISOR_HUB_REPO} | ConvertTo-Json -Compress)",
  ]);
  assert.equal(
    publicationRoots.registry,
    join(control, "autorun-queue", "cluster-registry.json")
  );
  assert.equal(publicationRoots.debug, join(tmpdir(), "orica-hub"));
  assert.equal(publicationRoots.hub, publicationRoots.debug);

  // Every scheduler operation is mocked, including failure cases. No actual task
  // is created, changed, stopped, or deleted.
  function registrationCase({
    exists = true,
    failUpdate = false,
    failResolve = false,
  } = {}) {
    return run([
      "$ErrorActionPreference='Stop'",
      "$script:updates=0; $script:creates=0; $script:deletes=0; $script:stops=0",
      "$script:action=$null; $script:settings=$null; $script:trigger=$null",
      "function node { $global:LASTEXITCODE=" +
        (failResolve ? 1 : 0) +
        "; " +
        quote(JSON.stringify({ integrationWorktree: control })) +
        " }",
      "function Test-Path { return $true }",
      "function Write-Host {}",
      "function schtasks { $script:deletes++; throw 'task deletion forbidden' }",
      "function Stop-ScheduledTask { $script:stops++; throw 'task stop forbidden' }",
      "function New-ScheduledTaskAction { param($Execute,$Argument,$WorkingDirectory) return [pscustomobject]@{Execute=$Execute;Argument=$Argument;WorkingDirectory=$WorkingDirectory} }",
      "function New-ScheduledTaskTrigger { param([switch]$Once,$At,$RepetitionInterval) return [pscustomobject]@{IntervalMinutes=$RepetitionInterval.TotalMinutes} }",
      "function New-ScheduledTaskSettingsSet { param([switch]$AllowStartIfOnBatteries,[switch]$DontStopIfGoingOnBatteries,[switch]$StartWhenAvailable,$ExecutionTimeLimit,$MultipleInstances) return [pscustomobject]@{Enabled=$true;ExecutionTimeLimit=$ExecutionTimeLimit.TotalMinutes;MultipleInstances=$MultipleInstances} }",
      "function Get-ScheduledTask { param($TaskName,$ErrorAction) " +
        (exists
          ? "return [pscustomobject]@{State='Running';Settings=[pscustomobject]@{Enabled=$false}}"
          : "return $null") +
        " }",
      "function Set-ScheduledTask { param($TaskName,$Action,$Trigger,$Settings,$ErrorAction) $script:updates++; $script:action=$Action; $script:settings=$Settings; $script:trigger=$Trigger; " +
        (failUpdate ? "throw 'simulated update failure'" : "") +
        " }",
      "function Register-ScheduledTask { param($TaskName,$Action,$Trigger,$Settings,$User,$Description) $script:creates++; $script:action=$Action; $script:settings=$Settings; $script:trigger=$Trigger }",
      "$caught=$null",
      "try { . " +
        quote(registration) +
        " } catch { $caught=$_.Exception.Message }",
      "'RESULT_JSON=' + (@{updates=$updates;creates=$creates;deletes=$deletes;stops=$stops;action=$action;settings=$settings;trigger=$trigger;error=$caught} | ConvertTo-Json -Depth 5 -Compress)",
    ]);
  }
  const updated = registrationCase();
  assert.equal(updated.updates, 1, updated.error);
  assert.equal(updated.creates, 0);
  assert.equal(updated.deletes, 0);
  assert.equal(updated.stops, 0);
  assert.equal(updated.settings.Enabled, false, "preserve disabled state");
  assert.equal(updated.settings.MultipleInstances, "IgnoreNew");
  assert.equal(updated.settings.ExecutionTimeLimit, 5);
  assert.equal(updated.trigger.IntervalMinutes, 30);
  assert.equal(updated.action.WorkingDirectory, control);
  assert.match(
    updated.action.Argument,
    /pinned main.*watchdog-stale-processes\.mjs/
  );
  assert.match(updated.action.Argument, /pinned main.*run-hidden\.vbs/);
  assert.equal(updated.error, null);
  const created = registrationCase({ exists: false });
  assert.equal(created.creates, 1);
  assert.equal(created.updates, 0);
  assert.equal(created.settings.Enabled, true);
  for (const args of [{ failUpdate: true }, { failResolve: true }]) {
    const failed = registrationCase(args);
    assert.ok(failed.error);
    assert.equal(failed.creates, 0);
    assert.equal(failed.deletes, 0);
    assert.equal(failed.stops, 0);
  }

  const temp = mkdtempSync(join(tmpdir(), "orica-run-log-"));
  assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep));
  try {
    const logs = join(temp, "logs");
    const runs = join(logs, "supervisor-runs");
    mkdirSync(runs, { recursive: true });
    const legacy = join(logs, "supervisor-run.log");
    const active = join(runs, "active.log");
    writeFileSync(legacy, "historical evidence\n");
    writeFileSync(active, "running worker evidence\n");
    const paths = run([
      "$ErrorActionPreference='Stop'",
      ". " + quote(logHelper),
      "$first=New-SupervisorRunLog -LogDir " +
        quote(logs) +
        " -RunProcessId 123",
      "$second=New-SupervisorRunLog -LogDir " +
        quote(logs) +
        " -RunProcessId 123",
      "'RESULT_JSON=' + (@($first,$second) | ConvertTo-Json -Compress)",
    ]);
    assert.notEqual(paths[0], paths[1]);
    for (const path of paths) {
      assert.equal(resolve(path, ".."), resolve(runs));
      assert.equal(readFileSync(path, "utf8"), "");
    }

    // Execute the production initialization and native worker/log boundary, not
    // a property-only assertion. All executable fixtures stay in this owned
    // directory; no package manager or actual supervisor is launched.
    const initialization = wrapper.slice(
      wrapper.indexOf('$ErrorActionPreference = "Stop"'),
      wrapper.indexOf("Get-ChildItem Env:GIT_*")
    );
    const boundaries = [
      ...wrapper.matchAll(
        /^  +& \$node "\$Control\\scripts\\worker-codex-stream\.mjs" @workerArgs \*>> \$Log 2>&1\r?\n  +\$code = \$LASTEXITCODE/gm
      ),
    ];
    assert.equal(boundaries.length, 1, "normal worker boundary");
    const exit = wrapper.match(/^exit \$code\s*$/m)?.[0];
    assert.ok(exit, "wrapper propagates the saved worker exit code");
    const fixtureScripts = join(temp, "scripts");
    mkdirSync(fixtureScripts);
    const message = "空・幻想符 日本語 😀 🚀";
    const payload = (stream, run) => JSON.stringify({ stream, run, message });
    writeFileSync(
      join(fixtureScripts, "worker-codex-stream.mjs"),
      [
        'import { readFileSync, writeSync } from "node:fs";',
        `const message = ${JSON.stringify(message)};`,
        "const [mode, run, code] = process.argv.slice(2);",
        'if (mode === "capture") { writeSync(1, JSON.stringify({ message })); }',
        'else if (mode === "stdin") { writeSync(1, readFileSync(0)); }',
        'else { for (const [fd, stream] of [[1,"stdout"],[2,"stderr"]]) writeSync(fd, JSON.stringify({ stream, run, message }) + "\\n"); }',
        "process.exitCode = Number(code || 0);",
      ].join("\n")
    );
    const fixtureWorker = quote(
      join(fixtureScripts, "worker-codex-stream.mjs")
    );
    for (const [boundaryIndex, boundary] of boundaries.entries()) {
      const log = paths[boundaryIndex];
      const prefix = `existing ${message}${EOL}`;
      writeFileSync(log, prefix);
      let expected = prefix;
      for (const [runId, status] of [
        ["first", 0],
        ["second", 7],
      ]) {
        const script = join(temp, `native-${boundaryIndex}-${runId}.ps1`);
        writeFileSync(
          script,
          [
            // Reproduce the scheduled Windows code page even when the test's
            // parent shell already happens to use UTF-8.
            "[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(932)",
            "$OutputEncoding = [System.Text.Encoding]::ASCII",
            initialization,
            "$Control = " + quote(temp),
            "$node = " + quote(process.execPath),
            "$Log = " + quote(log),
            "$workerArgs = @('log', " +
              quote(runId) +
              ", " +
              quote(String(status)) +
              ")",
            // Keep the production pipe/exit boundary, but use the fixture's
            // native path: Node on POSIX does not resolve Windows backslashes.
            boundary[0].replace(
              '"$Control\\scripts\\worker-codex-stream.mjs"',
              fixtureWorker
            ),
            "$captured = & $node " + fixtureWorker + " capture 2>> $Log",
            "$captured | Add-Content -LiteralPath $Log",
            quote(message) +
              " | & $node " +
              fixtureWorker +
              " stdin *>> $Log 2>&1",
            quote(`append ${message}`) + " | Add-Content -LiteralPath $Log",
            exit,
          ].join("\n")
        );
        const result = spawnSync(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", script],
          {
            cwd: temp,
            encoding: "utf8",
            windowsHide: true,
            timeout: 20_000,
          }
        );
        assert.equal(
          result.status,
          status,
          result.stderr || result.error?.message
        );
        // Separate native pipes can be drained in either order. Require both
        // exact byte payloads once, while preserving every previous log byte.
        const actual = readFileSync(log);
        const candidates = [
          ["stdout", "stderr"],
          ["stderr", "stdout"],
        ].map(
          (streams) =>
            expected +
            [
              ...streams.map((stream) => payload(stream, runId)),
              JSON.stringify({ message }),
              message,
              `append ${message}`,
              "",
            ].join(EOL)
        );
        assert.ok(
          candidates.some((candidate) =>
            actual.equals(Buffer.from(candidate, "utf8"))
          ),
          `PowerShell ${pwsh.stdout.trim()}: boundary ${boundaryIndex}, ${runId}, UTF-8 bytes and append preservation`
        );
        expected = actual.toString("utf8");
      }
    }

    // The integration runner starts another hidden PowerShell with piped
    // handles. It does not inherit the wrapper's console encoding. Execute the
    // real inner Invoke-Gate too, and check its raw log before outer decoding.
    const mergeSource = readFileSync(join(scripts, "auto-merge.ps1"), "utf8");
    const mergeInitialization = mergeSource.slice(
      mergeSource.indexOf('$ErrorActionPreference = "Stop"'),
      mergeSource.indexOf("Get-ChildItem Env:GIT_*")
    );
    const invokeGate = mergeSource.match(
      /^function Invoke-Gate \{[\s\S]*?^\}/m
    )?.[0];
    assert.ok(invokeGate, "production native gate pipeline");
    const bridgeControl = join(temp, "integration-wrapper");
    mkdirSync(join(bridgeControl, "scripts"), { recursive: true });
    const rawLog = join(temp, "integration.log");
    const outerLog = join(temp, "integration-wrapper.log");
    const prefix = `retained ${message}${EOL}`;
    writeFileSync(rawLog, prefix);
    writeFileSync(outerLog, prefix);
    writeFileSync(
      join(bridgeControl, "scripts/worker-codex-stream.mjs"),
      [
        'import { spawnSync } from "node:child_process";',
        'import { appendFileSync, writeSync } from "node:fs";',
        'const result = spawnSync("pwsh", ["-NoProfile", "-File", process.argv[2]], { cwd: process.cwd(), env: process.env, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], timeout: 20000 });',
        `for (const bytes of [result.stdout, result.stderr]) { if (bytes?.length) { appendFileSync(${JSON.stringify(rawLog)}, bytes); writeSync(1, bytes); } }`,
        "process.exitCode = result.status ?? 1;",
      ].join("\n")
    );
    let expectedNested = prefix;
    for (const [runId, nativeCode, expectedCode] of [
      ["nested-first", 0, 0],
      ["nested-second", 7, 1],
    ]) {
      const inner = join(temp, `${runId}-inner.ps1`);
      writeFileSync(
        inner,
        [
          "[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(932)",
          "$OutputEncoding = [System.Text.Encoding]::ASCII",
          mergeInitialization,
          invokeGate,
          "$node = " + quote(process.execPath),
          "$ok = Invoke-Gate -Cmd { & $node " +
            fixtureWorker +
            " log " +
            quote(runId) +
            " " +
            quote(String(nativeCode)) +
            " }",
          // auto-merge maps a failed native gate to exit 1.
          "if ($ok) { exit 0 }; exit 1",
        ].join("\n")
      );
      const outer = join(temp, `${runId}-outer.ps1`);
      writeFileSync(
        outer,
        [
          "[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(932)",
          "$OutputEncoding = [System.Text.Encoding]::ASCII",
          initialization,
          "$Control = " + quote(bridgeControl),
          "$node = " + quote(process.execPath),
          "$Log = " + quote(outerLog),
          "$workerArgs = @(" + quote(inner) + ")",
          boundaries[0][0].replace(
            '"$Control\\scripts\\worker-codex-stream.mjs"',
            quote(join(bridgeControl, "scripts", "worker-codex-stream.mjs"))
          ),
          exit,
        ].join("\n")
      );
      const result = spawnSync(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-File", outer],
        {
          cwd: temp,
          encoding: "utf8",
          windowsHide: true,
          timeout: 30000,
        }
      );
      assert.equal(
        result.status,
        expectedCode,
        result.stderr || result.error?.message
      );
      const raw = readFileSync(rawLog);
      const candidates = [
        ["stdout", "stderr"],
        ["stderr", "stdout"],
      ].map(
        (streams) =>
          expectedNested +
          [...streams.map((stream) => payload(stream, runId)), ""].join(EOL)
      );
      assert.ok(
        candidates.some((candidate) =>
          raw.equals(Buffer.from(candidate, "utf8"))
        ),
        `PowerShell ${pwsh.stdout.trim()}: nested integration UTF-8 bytes, ${runId}`
      );
      assert.deepEqual(
        readFileSync(outerLog),
        raw,
        "outer run log preserves inner integration bytes"
      );
      expectedNested = raw.toString("utf8");
    }
    assert.equal(readFileSync(legacy, "utf8"), "historical evidence\n");
    assert.equal(readFileSync(active, "utf8"), "running worker evidence\n");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  console.log(
    `supervisor environment: passed (PowerShell ${pwsh.stdout.trim()}, native UTF-8 stdout/stderr/JSON/stdin, exit 0/7, append and multiple runs, nested integration bytes and native 7 to gate 1, unique logs and evidence preservation)`
  );
}
runtimeChecks();
