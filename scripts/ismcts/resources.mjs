import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { hash } from "./shared.mjs";

export const PROFILE_PATH = fileURLToPath(
  new URL("resource-profile.json", import.meta.url)
);
export const profile = JSON.parse(readFileSync(PROFILE_PATH, "utf8"));
// Retained exact bootstrap profile for explicit, history-preserving migration.
// It is never an execution override or a second budget allowance.
export const bootstrapProfile = JSON.parse(
  readFileSync(
    new URL("resource-profile-bootstrap.json", import.meta.url),
    "utf8"
  )
);
export const bootstrapProfileHash = hash(JSON.stringify(bootstrapProfile));

export function validateProfile(value) {
  // Preserve the exact approved profile. Callers may request a smaller budget;
  // profile overrides and GPU enabling before I6 acceptance are rejected.
  if (value?.schemaVersion !== 2 || value.id !== "pc-shared")
    throw new Error("invalid resource profile");
  function compare(candidate, approved, prefix = "") {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      Object.keys(candidate).sort().join() !==
        Object.keys(approved).sort().join()
    )
      throw new Error(`invalid resource keys: ${prefix}`);
    for (const [key, ceiling] of Object.entries(approved)) {
      const item = candidate[key],
        path = `${prefix}.${key}`;
      if (typeof ceiling === "object") compare(item, ceiling, path);
      else if (typeof ceiling === "number") {
        if (!Number.isFinite(item) || item <= 0 || item !== ceiling)
          throw new Error(`resource profile mismatch: ${path}`);
      } else if (item !== ceiling)
        throw new Error(`resource profile mismatch: ${path}`);
    }
  }
  compare(value, profile);
  return hash(JSON.stringify(value));
}

export function jstDay(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("invalid clock");
  return new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
}

export function nextJstDay(ms) {
  return Date.parse(`${jstDay(ms)}T00:00:00+09:00`) + 86400000;
}

export function resourceMachine(initial = {}) {
  let last = null;
  let cpuHigh = null,
    cpuLow = null,
    ramReady = null,
    gpuHigh = null,
    gpuReady = null;
  let stopped = initial.stopped === true;
  let running = initial.running === true;
  return {
    update(sample, now) {
      if (!Number.isSafeInteger(now) || (last !== null && now <= last))
        throw new Error("non-monotonic resource clock");
      const keys = ["cpuPercent", "freeRamGiB", "treeRssGiB"];
      if (sample?.gpuEnabled === true)
        keys.push("gpuPercent", "freeVramGiB", "aiVramGiB", "gpuCelsius");
      const valid =
        sample &&
        keys.every((key) => Number.isFinite(sample[key]) && sample[key] >= 0) &&
        sample.cpuPercent <= 100 &&
        (sample.gpuEnabled !== true || sample.gpuPercent <= 100);
      // Sustained windows need continuous samples. A missing/late point cannot
      // claim ten seconds of high load or thirty seconds of safe recovery.
      if (
        last === null ||
        now - last > profile.compute.sampleMs * 1.5 ||
        !valid
      )
        cpuHigh = cpuLow = ramReady = gpuHigh = gpuReady = null;
      last = now;
      // A known hard RSS breach must terminate even if unrelated telemetry is
      // missing or the requested GPU execution is rejected. Do not preserve a
      // recovery window across the hard breach.
      if (
        Number.isFinite(sample?.treeRssGiB) &&
        sample.treeRssGiB >= profile.ram.hardGiB
      ) {
        cpuHigh = cpuLow = ramReady = gpuHigh = gpuReady = null;
        stopped = true;
        return { action: "terminate", reason: "ram_hard" };
      }
      if (!valid) {
        stopped = true;
        return { action: "stop", reason: "measurement_missing" };
      }
      if (sample.gpuEnabled === true) {
        // Rejected execution is not a diagnostic sample. It cannot bridge any
        // sustained window, including CPU/RAM recovery hidden by this return.
        cpuHigh = cpuLow = ramReady = gpuHigh = gpuReady = null;
        stopped = true;
        return { action: "stop", reason: "gpu_not_accepted" };
      }
      cpuHigh =
        sample.cpuPercent >= profile.cpu.stopPercent ? (cpuHigh ?? now) : null;
      cpuLow =
        sample.cpuPercent < profile.cpu.resumeBelowPercent
          ? (cpuLow ?? now)
          : null;
      ramReady =
        sample.freeRamGiB >= profile.ram.startFreeGiB
          ? (ramReady ?? now)
          : null;
      // GPU thresholds are checked as a dry resource diagnostic while disabled.
      const gpu = sample.gpu;
      if (gpu) {
        if (
          ![gpu.percent, gpu.freeGiB, gpu.aiGiB, gpu.celsius].every(
            (value) => Number.isFinite(value) && value >= 0
          ) ||
          gpu.percent > 100
        ) {
          cpuHigh = cpuLow = ramReady = gpuHigh = gpuReady = null;
          stopped = true;
          return { action: "stop", reason: "gpu_measurement_missing" };
        }
        gpuHigh =
          gpu.percent >= profile.gpu.stopPercent ? (gpuHigh ?? now) : null;
        gpuReady =
          gpu.percent <= profile.gpu.startPercent &&
          gpu.freeGiB >= profile.gpu.startFreeGiB &&
          gpu.aiGiB < profile.gpu.vramGiB &&
          gpu.celsius < profile.gpu.resumeBelowCelsius
            ? (gpuReady ?? now)
            : null;
      } else gpuHigh = gpuReady = null;
      const reason =
        sample.freeRamGiB < profile.ram.stopFreeGiB
          ? "ram_free"
          : sample.treeRssGiB >= profile.ram.softGiB
            ? "ram_soft"
            : cpuHigh !== null && now - cpuHigh >= profile.cpu.stopMs
              ? "cpu_load"
              : null;
      if (reason) {
        stopped = true;
        return { action: "stop", reason };
      }
      const gpuDiagnostic = gpu
        ? {
            stop:
              gpu.freeGiB < profile.gpu.stopFreeGiB ||
              gpu.aiGiB >= profile.gpu.vramGiB ||
              gpu.celsius >= profile.gpu.stopCelsius ||
              (gpuHigh !== null && now - gpuHigh >= profile.gpu.stopMs),
            resume: gpuReady !== null && now - gpuReady >= profile.gpu.resumeMs,
          }
        : null;
      if (stopped) {
        if (
          cpuLow !== null &&
          now - cpuLow >= profile.cpu.resumeMs &&
          ramReady !== null &&
          now - ramReady >= profile.ram.resumeMs &&
          sample.treeRssGiB < profile.ram.softGiB
        ) {
          stopped = false;
          running = true;
          return { action: "resume", reason: "load_recovered", gpuDiagnostic };
        }
        return { action: "wait", reason: "deferred_load", gpuDiagnostic };
      }
      if (!running && sample.freeRamGiB < profile.ram.startFreeGiB) {
        stopped = true;
        return { action: "wait", reason: "deferred_load", gpuDiagnostic };
      }
      running = true;
      return { action: "run", reason: "within_profile", gpuDiagnostic };
    },
  };
}

export function resourceScope(root) {
  return resolve(root, "scripts/ismcts/resource-profile.json");
}

export function checkResourceDocument(root) {
  const doc = readFileSync(
    resolve(root, "manual/ai-reference/30_plan/ismcts-full-run/resources.md"),
    "utf8"
  );
  const section = doc.match(
    /<!-- ismcts-profile:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- ismcts-profile:end -->/
  );
  if (
    !section ||
    JSON.stringify(JSON.parse(section[1])) !== JSON.stringify(profile)
  )
    throw new Error("resources.md and machine profile differ");
  return validateProfile(profile);
}
