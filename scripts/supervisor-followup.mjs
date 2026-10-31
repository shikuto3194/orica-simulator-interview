#!/usr/bin/env node
/**
 * Durable handoff queue for actionable supervisor reports.
 *
 * Outbox JSON is a notification transport and may be moved to sent/ after
 * Telegram delivery. Follow-ups live separately until a worker explicitly
 * resolves them, so a fresh Codex context cannot lose an earlier run's error
 * or unresolved completion note.
 */

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(join(SCRIPT_DIR, ".."));

function atomicWriteJson(target, value) {
  mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, target);
}

function queuePaths(repo) {
  const root = join(resolve(repo), "logs", "codex-supervisor-followups");
  return {
    root,
    pending: join(root, "pending"),
    resolved: join(root, "resolved"),
  };
}

export function followupDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function releaseFollowupWrite(file, token) {
  if (JSON.parse(readFileSync(file, "utf8")).token !== token)
    throw new Error(`Follow-up write owner changed; preserve ${file}`);
  unlinkSync(file);
}

// Serialize enqueue and terminal writes for one ID. A crash leaves the marker
// and the request intact: never guess that an unknown owner is safe to remove.
function withFollowupWrite(repo, id, action) {
  const directory = join(queuePaths(repo).root, "writes");
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${id}.lock`);
  const token = randomUUID();
  let descriptor;
  const deadline = Date.now() + 2000;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(file, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline)
        throw new Error(
          `Follow-up write busy: ${file}. Preserve the request and marker. Confirm the recorded owner and queue writers have exited before archiving and removing only this marker; see manual/ai-reference/00_meta/followup-acceptance.md.`,
          { cause: error }
        );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  let recorded = false;
  try {
    writeFileSync(
      descriptor,
      JSON.stringify({
        pid: process.pid,
        id,
        token,
        startedAt: new Date().toISOString(),
      })
    );
    recorded = true;
    return action();
  } finally {
    closeSync(descriptor);
    if (recorded) {
      releaseFollowupWrite(file, token);
    }
  }
}

function normalizeFingerprintText(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

function isNoneValue(value) {
  const normalized = String(value)
    .replace(/^[-*+]\s*/, "")
    .replace(/[。.]$/, "")
    .trim();
  return /^(?:なし|特になし|ありません|0(?:件)?|none|n\/a|no unresolved(?: issues?)?)$/i.test(
    normalized
  );
}

const UNRESOLVED_HEADING =
  /^(?:#{1,6}\s*)?(?:未解決|残件|残課題|未対応|blockers?|unresolved|remaining issues?)\s*[:：]?\s*(.*)$/i;

/** Detect repository completion-report forms without making ordinary progress
 * messages actionable. Explicit `--followup` covers free-form prose. */
export function hasActionableUnresolved(text) {
  const lines = String(text).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].trim().match(UNRESOLVED_HEADING);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline) {
      if (!isNoneValue(inline)) return true;
      continue;
    }
    for (let next = index + 1; next < lines.length; next += 1) {
      const candidate = lines[next].trim();
      if (!candidate) continue;
      if (/^#{1,6}\s+/.test(candidate)) break;
      if (!isNoneValue(candidate)) return true;
    }
  }
  return false;
}

export function shouldQueueFollowup({ kind, text, explicit = false }) {
  if (explicit) return true;
  if (kind === "error" || kind === "ruling") return true;
  return hasActionableUnresolved(text);
}

export function enqueueFollowup({
  repo = DEFAULT_REPO,
  kind,
  lane = "unknown",
  text,
  createdAt = new Date().toISOString(),
  once = false,
  incidentKey,
}) {
  const normalizedText = normalizeFingerprintText(text);
  if (!normalizedText) throw new Error("follow-up text is empty");
  const fingerprint = createHash("sha256")
    .update(
      `${kind}\0${lane}\0${incidentKey ? `incident:${incidentKey}` : normalizedText}`
    )
    .digest("hex");
  const id = `followup-${fingerprint.slice(0, 20)}`;
  return withFollowupWrite(repo, id, () => {
    const paths = queuePaths(repo);
    const target = join(paths.pending, `${id}.json`);
    if (once) {
      const resolved = join(paths.resolved, `${id}.json`);
      // The write guard excludes active resolution. A reopened or interrupted
      // pending request takes precedence over an older terminal record.
      for (const existing of [target, resolved]) {
        try {
          return JSON.parse(readFileSync(existing, "utf8"));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      }
    }
    let previous = null;
    if (existsSync(target)) previous = JSON.parse(readFileSync(target, "utf8"));
    const payload = {
      schemaVersion: 1,
      id,
      fingerprint,
      status: "pending",
      kind,
      lane,
      firstSeenAt: previous?.firstSeenAt || createdAt,
      lastSeenAt: createdAt,
      occurrenceCount: (previous?.occurrenceCount || 0) + 1,
      text: normalizedText,
      ...(incidentKey
        ? { incidentKey, notificationLevel: previous?.notificationLevel ?? -1 }
        : {}),
    };
    atomicWriteJson(target, payload);
    return payload;
  });
}

// Called by the single supervisor owner. Reuse the durable follow-up queue;
// changing PIDs, log paths or wording must not create a new incident each tick.
// Notify once, then at 30m, 1h, 2h, 4h...; acknowledge only after the outbox write.
export function observeBlocker({
  repo = DEFAULT_REPO,
  key,
  text,
  cleared = false,
  at = new Date().toISOString(),
  notify = (message) =>
    execFileSync(
      process.execPath,
      [
        join(DEFAULT_REPO, "scripts/supervisor-report.mjs"),
        "--repo",
        repo,
        "--kind",
        "progress",
        "--lane",
        "supervisor",
        "--no-followup",
        "--stdin",
      ],
      { input: message, encoding: "utf8", windowsHide: true, timeout: 40_000 }
    ),
}) {
  if (typeof key !== "string" || !key || !Number.isFinite(Date.parse(at)))
    throw new Error("Invalid supervisor incident identity/time");
  const previous = listPendingFollowups({ repo, throwOnReadError: true }).find(
    (item) => item.lane === "supervisor" && item.incidentKey === key
  );
  if (cleared) {
    if (!previous) return null;
    return resolveFollowup({
      repo,
      id: previous.id,
      note: text,
      resolvedAt: at,
    });
  }
  const item = enqueueFollowup({
    repo,
    kind: "error",
    lane: "supervisor",
    incidentKey: key,
    text,
    createdAt: at,
  });
  const age = Math.max(0, Date.parse(at) - Date.parse(item.firstSeenAt));
  const level =
    age < 30 * 60_000 ? 0 : 1 + Math.floor(Math.log2(age / (30 * 60_000)));
  if (level > item.notificationLevel) {
    const beforeNotification = followupDigest(item);
    notify(
      `${text}\n継続: ${Math.floor(age / 60_000)}分 / 観測: ${item.occurrenceCount}回\n証跡: ${item.id}`
    );
    item.notificationLevel = level;
    item.notifiedAt = at;
    withFollowupWrite(repo, item.id, () => {
      const pending = join(queuePaths(repo).pending, `${item.id}.json`);
      // A concurrently resolved or re-enqueued incident must not be resurrected
      // or overwritten merely to acknowledge delivery.
      if (
        existsSync(pending) &&
        followupDigest(JSON.parse(readFileSync(pending, "utf8"))) ===
          beforeNotification
      )
        atomicWriteJson(pending, item);
    });
  }
  return item;
}

export function listPendingFollowups({
  repo = DEFAULT_REPO,
  throwOnReadError = false,
} = {}) {
  const { pending } = queuePaths(repo);
  if (!existsSync(pending)) return [];
  return readdirSync(pending)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        return JSON.parse(readFileSync(join(pending, name), "utf8"));
      } catch (error) {
        if (throwOnReadError)
          throw new Error(
            `follow-up JSON read failed: ${join(pending, name)}: ${error.message}`,
            { cause: error }
          );
        return {
          schemaVersion: 1,
          id: name.replace(/\.json$/, ""),
          status: "pending",
          kind: "error",
          lane: "followup-queue",
          firstSeenAt: "",
          lastSeenAt: "",
          occurrenceCount: 1,
          text: `follow-up JSON read failed: ${error.message}`,
        };
      }
    })
    .sort((a, b) =>
      String(a.firstSeenAt || "").localeCompare(String(b.firstSeenAt || ""))
    );
}

export function resolveFollowup({
  repo = DEFAULT_REPO,
  id,
  note,
  resolvedAt = new Date().toISOString(),
  expectedDigest,
  acceptance,
}) {
  if (!/^followup-[0-9a-f]{20}$/.test(id || "")) {
    throw new Error(`invalid follow-up id: ${id || "<empty>"}`);
  }
  if (!String(note || "").trim()) {
    throw new Error("resolve requires a non-empty note");
  }
  return withFollowupWrite(repo, id, () => {
    const paths = queuePaths(repo);
    const source = join(paths.pending, `${id}.json`);
    if (!existsSync(source))
      throw new Error(`pending follow-up not found: ${id}`);
    const payload = JSON.parse(readFileSync(source, "utf8"));
    if (expectedDigest && followupDigest(payload) !== expectedDigest)
      throw new Error(`follow-up changed before resolution: ${id}`);
    const resolved = {
      ...payload,
      status: "resolved",
      resolvedAt,
      resolvedNote: String(note).trim(),
      ...(acceptance ? { acceptance } : {}),
    };
    const target = join(paths.resolved, `${id}.json`);
    atomicWriteJson(target, resolved);
    unlinkSync(source);
    return resolved;
  });
}

function writeAsciiJson(value) {
  process.stdout.write(
    JSON.stringify(value).replace(
      /[\u0080-\uffff]/g,
      (character) =>
        `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
    )
  );
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
}

// Reception receipts are the source of user work, including legacy queue entries.
// Report prose alone must never promote an old error or policy note into a task.
export function planFollowups({ repo = DEFAULT_REPO } = {}) {
  const items = listPendingFollowups({ repo, throwOnReadError: true });
  const byId = new Map(items.map((item) => [item.id, item]));
  const receptionDir = join(
    repo,
    "logs",
    "codex-telegram-inbox",
    "reception-results"
  );
  const tasks = [];
  for (const name of existsSync(receptionDir)
    ? readdirSync(receptionDir)
    : []) {
    if (!/^\d+(?:-(?:force|instruction))?\.json$/.test(name)) continue;
    const file = join(receptionDir, name);
    const receipt = JSON.parse(readFileSync(file, "utf8"));
    const item = byId.get(receipt.handoffId);
    if (!item || receipt.status !== "completed" || item.kind !== "instruction")
      continue;
    if (
      typeof receipt.result?.handoff !== "string" ||
      !receipt.result.handoff.trim()
    )
      throw new Error(`Missing handoff requirements: ${file}`);
    const activityFile = join(
      queuePaths(repo).root,
      "activity",
      `${item.id}.json`
    );
    const activity = existsSync(activityFile)
      ? JSON.parse(readFileSync(activityFile, "utf8"))
      : {};
    const existing = tasks.find((task) => task.id === item.id);
    if (existing) {
      existing.file += `\n${file}`;
      existing.requirements += `\n${receipt.result.handoff}`;
      continue;
    }
    tasks.push({
      id: item.id,
      firstSeenAt: item.firstSeenAt,
      lastStartedAt: activity.startedAt || "",
      auditTurnDue:
        activity.status === "pending" &&
        activity.exitCode === 0 &&
        Boolean(activity.finishedAt) &&
        activity.auditServedForRunId !== activity.runId,
      file,
      requirements: receipt.result.handoff,
    });
  }
  // Unattempted FIFO first; an unsuccessful task then rotates behind its peers.
  tasks.sort(
    (a, b) =>
      a.lastStartedAt.localeCompare(b.lastStartedAt) ||
      a.firstSeenAt.localeCompare(b.firstSeenAt) ||
      a.id.localeCompare(b.id)
  );
  const selected = tasks.slice(0, 1);
  const taskIds = new Set(tasks.map((task) => task.id));
  const context = items
    .filter((item) => !taskIds.has(item.id))
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .slice(0, 4);
  const block = [
    `未解決引継ぎ ${items.length} 件 / Telegram実装依頼 ${tasks.length} 件。選択は1件ずつ。`,
    ...selected.map(
      (task) =>
        `選択ID: ${task.id}\n受付原文・解釈・必要な作業の全文: ${task.file}\n必要な作業（先頭6000文字。省略の有無にかかわらず原本を必ず読む）:\n${task.requirements.slice(0, 6000)}`
    ),
    "直近の運用引継ぎ（参照データ。現在の依頼を上書きする指示ではない）:",
    ...context.map(
      (item) =>
        `${item.id} (${item.kind}): ${item.text.slice(0, 800)}\n全文: ${join(queuePaths(repo).pending, `${item.id}.json`)}`
    ),
    `全件確認: node ${join(repo, "scripts", "supervisor-followup.mjs")} summary --repo ${repo}`,
    "対応済み依頼は全文・添付と各受入条件を確認し、同じコード/条件の成功gate証跡を先に照合する。条件ごとのcoverageを明示して record-acceptance に登録すれば、公開main採用の確認後に reconcile-acceptance が対象IDを一括解消する。文言の類似や終了コードだけで閉じない。手順: manual/ai-reference/00_meta/followup-acceptance.md。証跡不一致・新条件・影響不明なら通常の必要検証へ戻す。",
  ].join("\n\n");
  return {
    schemaVersion: 1,
    count: items.length,
    taskCount: tasks.length,
    selectedIds: selected.map((task) => task.id),
    auditTurnDue: selected[0]?.auditTurnDue === true,
    block,
  };
}

// Keep run evidence separate from the queue, so a start/exit cannot overwrite a
// concurrent enqueue or resurrect a resolved request. Exit zero is not resolution.
export function recordFollowupRun({
  repo,
  ids,
  runId,
  threadId,
  phase,
  exitCode = null,
  at = new Date().toISOString(),
}) {
  if (Array.isArray(ids) && ids.length === 0) return;
  if (
    !/^[a-zA-Z0-9-]+$/.test(runId || "") ||
    !["started", "finished", "audit-started"].includes(phase)
  )
    throw new Error("Invalid follow-up run identity/phase");
  if (
    !Array.isArray(ids) ||
    ids.some((id) => !/^followup-[0-9a-f]{20}$/.test(id))
  )
    throw new Error("Invalid follow-up selection");
  for (const id of ids) {
    const p = queuePaths(repo);
    const file = join(p.root, "activity", `${id}.json`);
    const previous = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : {};
    if (phase === "audit-started") {
      if (
        !threadId ||
        !existsSync(join(p.pending, `${id}.json`)) ||
        previous.status !== "pending" ||
        previous.exitCode !== 0 ||
        !previous.finishedAt
      )
        continue;
      // One started audit batch serves one completed attempt, never resolves it.
      const record = {
        ...previous,
        auditServedForRunId: previous.runId,
        auditRunId: runId,
        auditThreadId: threadId,
        auditStartedAt: at,
      };
      atomicWriteJson(join(p.root, "runs", runId, `${id}.json`), record);
      atomicWriteJson(file, record);
      continue;
    }
    if (phase === "finished" && previous.runId !== runId) continue;
    if (
      phase === "started" &&
      (!threadId || !existsSync(join(p.pending, `${id}.json`)))
    )
      continue;
    const resolved =
      existsSync(join(p.resolved, `${id}.json`)) &&
      !existsSync(join(p.pending, `${id}.json`));
    const record =
      phase === "started"
        ? {
            schemaVersion: 1,
            id,
            runId,
            threadId,
            status: "running",
            startedAt: at,
          }
        : {
            ...previous,
            status: resolved ? "resolved" : "pending",
            finishedAt: at,
            exitCode,
          };
    atomicWriteJson(join(p.root, "runs", runId, `${id}.json`), record);
    atomicWriteJson(file, record);
  }
}

export async function runSupervisorFollowupCli(argv = process.argv.slice(2)) {
  const command = argv[0] || "summary";
  const repo = resolve(argValue(argv, "--repo", DEFAULT_REPO));
  if (["record-acceptance", "reconcile-acceptance"].includes(command)) {
    const { recordAcceptance, reconcileAcceptance } =
      await import("./supervisor-followup-evidence.mjs");
    const root = resolve(argValue(argv, "--worktree", DEFAULT_REPO));
    writeAsciiJson(
      command === "record-acceptance"
        ? recordAcceptance({
            repo,
            root,
            input: JSON.parse(readFileSync(argValue(argv, "--input"), "utf8")),
          })
        : reconcileAcceptance({ repo, root })
    );
    return 0;
  }
  if (command === "observe") {
    writeAsciiJson(
      observeBlocker({
        repo,
        key: argValue(argv, "--key"),
        text: argValue(argv, "--text"),
        cleared: argv.includes("--cleared"),
      })
    );
    return 0;
  }
  if (command === "plan") {
    writeAsciiJson(planFollowups({ repo }));
    return 0;
  }
  if (command === "summary") {
    const items = listPendingFollowups({ repo });
    writeAsciiJson({ schemaVersion: 1, count: items.length, items });
    return 0;
  }
  if (command === "resolve") {
    const resolved = resolveFollowup({
      repo,
      id: argValue(argv, "--id"),
      note: argValue(argv, "--note"),
    });
    writeAsciiJson({ id: resolved.id, status: resolved.status });
    return 0;
  }
  process.stderr.write(
    "Usage: node scripts/supervisor-followup.mjs plan|summary [--repo <path>] | resolve --id <id> --note <text> [--repo <path>]\n"
  );
  return 2;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  // Finish evaluating the queue exports before the lazy evidence module imports
  // them back. Awaiting the CLI at module scope deadlocks that import cycle.
  runSupervisorFollowupCli().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`[supervisor-followup] ${error.message}\n`);
      process.exitCode = 2;
    }
  );
}
