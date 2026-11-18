import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import console from "node:console";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { waitForApiReady } from "./update-policy.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const [origin, portText = "4310", originListText = origin] = process.argv.slice(2);
function parseOrigins(value) {
  if (typeof value !== "string") throw new Error("At least one HTTPS origin is required.");
  const origins = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (origins.length === 0) throw new Error("At least one HTTPS origin is required.");
  for (const allowedOrigin of origins) {
    const parsed = new URL(allowedOrigin);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== allowedOrigin ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes("*")
    ) {
      throw new Error("Expected exact HTTPS origins without paths or wildcards.");
    }
  }
  return origins;
}
const allowedOrigins = parseOrigins(originListText);
if (!allowedOrigins.includes(origin))
  throw new Error("The primary origin must be included in the allowed origin list.");
const port = Number(portText);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error("Invalid local API port.");
}
process.loadEnvFile(resolve(root, "apps/playground-web/.env"));
Object.assign(process.env, {
  NODE_ENV: "production",
  HOST: "127.0.0.1",
  PORT: String(port),
  ALLOWED_ORIGINS: allowedOrigins.join(","),
  API_BEHIND_LOOPBACK_PROXY: "1",
  INTERVIEW_MODE: "true",
});
const log = resolve(root, "logs/pc-api/scheduled-api.log");
mkdirSync(resolve(root, "logs/pc-api"), { recursive: true });
function writeLog(chunk, encoding, callback) {
  if (existsSync(log) && statSync(log).size > 5 * 1024 * 1024) {
    renameSync(log, `${log}.previous`);
  }
  appendFileSync(
    log,
    chunk,
    typeof encoding === "string" ? encoding : undefined
  );
  const done = typeof encoding === "function" ? encoding : callback;
  done?.();
  return true;
}
process.stdout.write = writeLog;
process.stderr.write = writeLog;
const logMessage = (message) =>
  console.log(`[${new Date().toISOString()}] ${message}`);
let child;
let stopping = false;
async function stop() {
  const running = child;
  child = undefined;
  if (!running || running.exitCode !== null || running.signalCode !== null)
    return;
  if (running.connected) running.send({ type: "shutdown" });
  for (
    let i = 0;
    i < 280 && running.exitCode === null && running.signalCode === null;
    i++
  )
    await delay(100);
  if (running.exitCode === null && running.signalCode === null) {
    running.kill();
    await new Promise((done) => running.once("exit", done));
  }
}
async function start(release) {
  child = spawn(process.execPath, [resolve(release.directory, "server.mjs")], {
    env: { ...process.env, ORICA_API_REVISION: release.revision },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.on("data", (data) => process.stdout.write(data));
  child.stderr.on("data", (data) => process.stderr.write(data));
  let spawnError;
  child.on("error", (error) => {
    spawnError = error;
  });
  await waitForApiReady(`http://127.0.0.1:${port}`, release.revision, () => {
    if (spawnError) throw spawnError;
    return child.exitCode === null && child.signalCode === null;
  });
  logMessage(`API ready ${release.revision} (pid ${child.pid})`);
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    stopping = true;
    void stop().finally(() => process.exit(0));
  });

let current;
try {
  current = JSON.parse(
    await readFile(resolve(root, "artifacts/pc-api/current.json"), "utf8")
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  if (existsSync(resolve(root, "artifacts/pc-api/release/server.mjs"))) {
    current = {
      revision: "legacy",
      directory: resolve(root, "artifacts/pc-api/release"),
    };
  }
}
if (!current) {
  throw new Error("No prepared interview API release is installed.");
}
if (current) await start(current);
logMessage(`Interview API pinned to ${current.revision}; automatic updates are disabled`);
while (!stopping) {
  try {
    if (!child || child.exitCode !== null || child.signalCode !== null)
      await start(current);
  } catch (error) {
    logMessage(`Pinned interview API restart failed: ${error.message}`);
  }
  await delay(60_000);
}
