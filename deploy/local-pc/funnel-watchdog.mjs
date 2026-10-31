import { execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify, parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { resolve } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  appendFileSync,
  statSync,
} from "node:fs";
import process from "node:process";
import console from "node:console";
import {
  TARGET,
  localHealth,
  probePublic,
  probeAuthorities,
} from "./funnel-probe.mjs";
import {
  decide,
  recover,
  initialState,
  validateState,
} from "./funnel-policy.mjs";

const execute = promisify(execFile);
export async function tailscale(args) {
  const { stdout } = await execute(
    process.platform === "win32"
      ? "C:/Program Files/Tailscale/tailscale.exe"
      : "tailscale",
    args,
    {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }
  );
  return stdout;
}

export async function inspect(command = tailscale, health = localHealth) {
  const [funnel, raw, local] = await Promise.all([
    command(["funnel", "status", "--json"]).then(JSON.parse),
    command(["status", "--json"]).then(JSON.parse),
    health(),
  ]);
  // Avoid persisting peer addresses, account details, and node keys.
  const status = {
    BackendState: raw.BackendState,
    Self: { Online: raw.Self?.Online, DNSName: raw.Self?.DNSName },
    Health: raw.Health,
  };
  return { funnel, status, local };
}

export function loadState(directory) {
  try {
    return validateState(
      JSON.parse(readFileSync(resolve(directory, "state.json"), "utf8"))
    );
  } catch (error) {
    if (error.code === "ENOENT") return initialState();
    throw error;
  }
}
export function saveState(directory, state) {
  validateState(state);
  const path = resolve(directory, "state.json");
  writeFileSync(`${path}.tmp`, JSON.stringify(state), { flush: true });
  renameSync(`${path}.tmp`, path);
}
export function logReport(directory, report) {
  const path = resolve(directory, "events.jsonl");
  if (existsSync(path) && statSync(path).size > 5 * 1024 * 1024)
    renameSync(path, `${path}.previous`);
  appendFileSync(path, `${JSON.stringify(report)}\n`);
  writeFileSync(
    resolve(directory, "latest.json"),
    JSON.stringify(report, null, 2)
  );
}

// A localhost socket is an OS-owned lease: process death releases it without
// stale-file deletion or PID guessing. Bind failure always suppresses recovery.
export function acquireLease(port = 4311) {
  return new Promise((resolveLease, reject) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      resolveLease(() => new Promise((done) => server.close(done)))
    );
  });
}

export async function runOnce({
  directory,
  apply = false,
  check = false,
  now = () => Date.now(),
  inspectLocal = inspect,
  publicProbe = probePublic,
  authorityProbe = probeAuthorities,
  command = tailscale,
} = {}) {
  const startedAt = now();
  if (!check) mkdirSync(directory, { recursive: true });
  const previous = check ? initialState() : loadState(directory);
  const [local, publicResult] = await Promise.all([
    inspectLocal(),
    publicProbe(),
  ]);
  const authorities =
    publicResult.dns.length === 2 &&
    publicResult.dns.every((reply) => reply.status === "nxdomain")
      ? await authorityProbe()
      : null;
  const enabled = () => apply && !existsSync(resolve(directory, "disabled"));
  const snapshot = {
    ...local,
    public: publicResult,
    authorities,
    disabled: existsSync(resolve(directory, "disabled")),
  };
  const decision = decide(previous, snapshot, startedAt);
  const report = {
    at: new Date(startedAt).toISOString(),
    mode: apply ? "recover" : "observe",
    reason: decision.reason,
    action: decision.action,
    snapshot,
  };
  if (!check) {
    // The pre-recovery observation survives even if the following command fails.
    logReport(directory, report);
    saveState(directory, decision.state);
    if (enabled() && decision.action !== "none") {
      const result = await recover(
        decision,
        {
          inspect: inspectLocal,
          enabled,
          command,
          save: (state) => saveState(directory, state),
        },
        now()
      );
      report.reason = result.reason;
      report.recoveryAttempted = true;
      logReport(directory, report);
    }
  }
  return report;
}

export async function externalCheck({ publicProbe = probePublic } = {}) {
  const result = await publicProbe();
  const report = {
    at: new Date().toISOString(),
    hostname: TARGET.hostname,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Public API: ${result.ok ? "healthy / 復旧・正常" : "unhealthy / 要確認"}\n\n` +
        `Checked at ${report.at}. Local PC and Tailscale credentials are not used.\n\n` +
        `\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`
    );
  return result.ok;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      check: { type: "boolean" },
      recover: { type: "boolean" },
      external: { type: "boolean" },
      "state-dir": { type: "string" },
    },
  });
  const directory =
    values["state-dir"] ??
    resolve(
      fileURLToPath(new URL("../../", import.meta.url)),
      "logs/pc-api/funnel-watchdog"
    );
  if (
    !directory ||
    (values.check && values.recover) ||
    (values.external && args.length !== 1)
  )
    throw new Error(
      "Usage: funnel-watchdog.mjs [--check | --recover] [--state-dir PATH] | --external"
    );
  if (values.external) {
    if (!(await externalCheck())) process.exitCode = 1;
    return;
  }
  const check = values.check;
  const release = check ? null : await acquireLease();
  try {
    const result = await runOnce({
      directory: resolve(directory),
      apply: values.recover,
      check,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (!check)
      logReport(resolve(directory), {
        at: new Date().toISOString(),
        reason: "watchdog-error",
        error: error.code ?? error.message,
      });
    throw error;
  } finally {
    await release?.();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(`[funnel-watchdog] ${error.code ?? error.message}`);
    process.exitCode = 1;
  });
}
