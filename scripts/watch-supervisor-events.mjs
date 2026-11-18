#!/usr/bin/env node
/**
 * Watch summarized Codex worker events from logs/codex-supervisor-state.json.
 *
 * This intentionally reads the runner-maintained summary state instead of raw
 * Codex JSONL, so it is safe for lightweight live monitoring while the worker
 * is running.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { collectSupervisorHealth } from "./supervisor-health.mjs";
import { sharedRepositoryRoot } from "./full-run-checkouts.mjs";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);

function argValue(name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

function defaultHub() {
  try {
    return sharedRepositoryRoot(process.cwd());
  } catch {
    // Keep the original cwd as the observation root when Git itself is unreadable.
    // collectSupervisorHealth reports the missing state/Git data as unknown.
    return process.cwd();
  }
}

const hub =
  args.includes("--repo") || args.includes("--state")
    ? argValue("--repo", process.cwd())
    : defaultHub();
const stateFile = resolve(
  argValue("--state", join(hub, "logs/codex-supervisor-state.json"))
);
const intervalMs = Number.parseInt(argValue("--interval-ms", "1000"), 10);
const tailCount = Number.parseInt(argValue("--tail", "12"), 10);
const finalChars = Number.parseInt(argValue("--final-chars", "500"), 10);
const once = args.includes("--once");
const exitOnFinish = args.includes("--exit-on-finish");
const noColor = args.includes("--no-color") || process.env.NO_COLOR;

function color(code, text) {
  if (noColor) return text;
  return `\u001b[${code}m${text}\u001b[0m`;
}

function timestamp(iso) {
  if (!iso) return "--:--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString("ja-JP", { hour12: false });
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile, "utf8"));
  } catch (error) {
    return { error };
  }
}

function statusLine(state) {
  const status = state.status || "unknown";
  const statusColor =
    status === "running"
      ? "36"
      : status === "completed"
        ? "32"
        : status === "failed" || status === "lock_lost" || status === "stale"
          ? "31"
          : "33";
  const parts = [
    "[worker-history]",
    color(statusColor, `[${status}]`),
    `label=${state.label || "?"}`,
    `thread=${state.threadId || "-"}`,
    `started=${timestamp(state.startedAt)}`,
    `updated=${timestamp(state.updatedAt)}`,
  ];
  if (state.exitCode !== null && state.exitCode !== undefined) {
    parts.push(`exit=${state.exitCode}`);
  }
  return parts.join(" ");
}

function eventKey(event) {
  return `${event?.at || ""}\u0000${event?.text || ""}`;
}

function eventLine(event) {
  return `${color("90", timestamp(event.at))} ${event.text}`;
}

function truncate(text, max) {
  if (!text || text.length <= max) return text || "";
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

const seenEvents = new Set();
let lastStatusKey = "";
let lastFinalText = "";
let missingNotified = false;

function render(state, initial = false) {
  if (state.error) {
    if (!missingNotified) {
      console.log(
        `${color("33", "[waiting]")} ${stateFile} を読めません: ${state.error.message}`
      );
      missingNotified = true;
    }
    return false;
  }
  missingNotified = false;

  const currentStatusKey = JSON.stringify({
    status: state.status,
    threadId: state.threadId,
    exitCode: state.exitCode,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
  });
  if (currentStatusKey !== lastStatusKey) {
    console.log(statusLine(state));
    lastStatusKey = currentStatusKey;
  }

  const events = Array.isArray(state.recentEvents) ? state.recentEvents : [];
  const visibleEvents = initial ? events.slice(-tailCount) : events;
  for (const event of visibleEvents) {
    const key = eventKey(event);
    if (seenEvents.has(key)) continue;
    seenEvents.add(key);
    console.log(eventLine(event));
  }

  const finalText = typeof state.finalText === "string" ? state.finalText : "";
  if (finalText && finalText !== lastFinalText) {
    lastFinalText = finalText;
    console.log(
      `${color("35", "[finalText]")} ${truncate(finalText.replace(/\s+/g, " "), finalChars)}`
    );
  }

  return (
    state.status === "completed" ||
    state.status === "worker_completed" ||
    state.status === "publication_pending" ||
    state.status === "failed" ||
    state.status === "lock_lost" ||
    state.status === "stale"
  );
}

async function main() {
  if (once || args.includes("--json")) {
    const previousFile = argValue("--previous", null);
    const snapshot = collectSupervisorHealth({
      repo: argValue("--repo", dirname(dirname(stateFile))),
      previous: previousFile
        ? JSON.parse(readFileSync(previousFile, "utf8"))
        : null,
    });
    if (args.includes("--json")) {
      console.log(JSON.stringify(snapshot, null, 2));
      if (["attention", "unknown"].includes(snapshot.health))
        process.exitCode = 1;
      return;
    }
    console.log(
      "[supervisor-health] " +
        snapshot.health +
        ": integration=" +
        snapshot.integration.phase +
        "; " +
        snapshot.integration.reason
    );
    console.log(
      "[supervisor-health] run=" +
        (snapshot.runId || "unknown") +
        "; last successful merge=" +
        (snapshot.integration.lastSuccess?.head || "unknown") +
        " at " +
        (snapshot.integration.lastSuccess?.finishedAt || "unknown")
    );
    console.log(
      `[supervisor-health] worker-history=${snapshot.workerStatus}; current-publication=${snapshot.integration.currentOutcome?.kind || snapshot.integration.ticketStatus}`
    );
    console.log(
      "[supervisor-health] runner=" +
        (snapshot.processes.runnerPids.join(",") || "none") +
        "; codex=" +
        (snapshot.processes.codexPids.join(",") || "none") +
        "; integration=" +
        (snapshot.processes.integrationPids.join(",") || "none") +
        "; validation=" +
        snapshot.validation.status
    );
    if (snapshot.validation.gateRun) {
      const gate = snapshot.validation.gateRun;
      console.log(
        `[supervisor-health] gate=${gate.status}; current=${gate.currentGate || "none"}; passed=${gate.passedGates}; failed=${gate.failedGates.join(",") || "none"}; outputBytes=${gate.output?.bytes ?? "unknown"}`
      );
    }
    if (snapshot.review)
      console.log(
        `[supervisor-health] review=${snapshot.review.status}; tree=${snapshot.review.headTree}`
      );
    for (const alert of snapshot.alerts)
      console.log(
        "[supervisor-health] " +
          alert.severity +
          ": " +
          alert.code +
          ": " +
          alert.reason
      );
  }
  console.log(
    `${color("36", "[watch-supervisor-events]")} ${stateFile} を監視します`
  );
  const finished = render(readState(), true);
  if (once || (finished && exitOnFinish)) return;

  while (true) {
    await sleep(Math.max(250, Number.isFinite(intervalMs) ? intervalMs : 1000));
    const finished = render(readState(), false);
    if (finished && exitOnFinish) return;
  }
}

main().catch((error) => {
  console.error(`[watch-supervisor-events] ${error.stack || error.message}`);
  process.exit(1);
});
