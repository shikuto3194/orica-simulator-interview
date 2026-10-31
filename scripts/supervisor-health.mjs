import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { readWindowsProcesses } from "./harness/recover-gate-lease.mjs";
import { LEASE_WAIT_EXIT, leaseFailureExit } from "./harness/gate-lease.mjs";
import { sanitizeOutput } from "./telegram-secret-sanitize.mjs";
import { inspectIntegrationCheckout } from "./full-run-checkouts.mjs";

const normalize = (s) =>
  String(s || "")
    .replaceAll("\\", "/")
    .toLowerCase();
function json(file) {
  try {
    if (statSync(file).size > 2 * 1024 * 1024)
      throw new Error("JSON exceeds monitoring limit");
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("Expected JSON object metadata");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function recent(dir, limit = 48) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => ({
        file: join(dir, name),
        time: statSync(join(dir, name)).mtimeMs,
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, limit)
      .map(({ file, time }) => ({ ...json(file), file, fileTime: time }));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
function descendants(rows, roots) {
  const ids = new Set(roots);
  for (let changed = true; changed; ) {
    changed = false;
    for (const row of rows)
      if (ids.has(row.parentPid) && !ids.has(row.pid)) {
        ids.add(row.pid);
        changed = true;
      }
  }
  return ids;
}
function validationKind(command) {
  if (/(?:run-gates|codex-finish-check|pre-push)\.mjs/.test(command))
    return "gate_runner";
  if (/vitest|tinypool/.test(command)) return "vitest";
  if (/scripts[\\/].*fuzz|pnpm.*\bfuzz\b/.test(command)) return "fuzz";
  if (
    /scripts[\\/](?:test-|check-)|\b(?:tsc|eslint|prettier|playwright)\b/.test(
      command
    )
  )
    return "regression_or_style";
  return null;
}
function processArgs(command) {
  return (String(command || "").match(/"[^"]*"|'[^']*'|[^\s]+/g) || []).map(
    (word) =>
      (word.startsWith('"') && word.endsWith('"')) ||
      (word.startsWith("'") && word.endsWith("'"))
        ? word.slice(1, -1)
        : word
  );
}
function powershellScript(args) {
  const valueOptions = [
    "-executionpolicy",
    "-workingdirectory",
    "-inputformat",
    "-outputformat",
    "-configurationname",
    "-custompipename",
    "-ep",
    "-wd",
  ];
  for (let i = 1; i < args.length; i++) {
    const option = args[i].toLowerCase();
    if (
      option === "-ec" ||
      (option.startsWith("-") &&
        option.length > 1 &&
        ["-command", "-commandwithargs", "-encodedcommand"].some((full) =>
          full.startsWith(option)
        ))
    )
      return null;
    if (
      option.startsWith("-") &&
      option.length > 1 &&
      "-file".startsWith(option)
    )
      return args[i + 1] || null;
    if (valueOptions.includes(option)) {
      i++;
      continue;
    }
    if (option.startsWith("-")) continue;
    return args[i];
  }
  return null;
}
function actualValidation(row) {
  if (!/^node(?:\.exe)?$/i.test(row.name || "")) return null;
  const args = processArgs(row.commandLine);
  if (["-e", "--eval", "-p", "--print"].includes(args[1])) return null;
  const entry = normalize(args[1]);
  // Package launchers prepare/spawn commands. Their actual test children are
  // inspected through the same descendant census, without parsing npm flags.
  if (/(?:^|\/)(?:npx-cli\.js|npm-cli\.js|pnpm\.cjs)$/.test(entry)) return null;
  // Browser MCP services remain alive while Codex reads/reviews; they are not tests.
  if (/(?:^|\/)@playwright\/mcp\/cli\.js$/.test(entry)) return null;
  return validationKind(row.commandLine || "");
}
function ownsProcess(row, started, matches) {
  if (!row) return false;
  if (typeof row.commandLine !== "string") return null;
  if (!matches(row)) return false;
  const born = Date.parse(row.processStartedAt),
    began = typeof started === "number" ? started : Date.parse(started);
  if (!Number.isFinite(born) || !Number.isFinite(began)) return null;
  return born <= began + 2000;
}
export function collectSupervisorHealth({
  repo = process.cwd(),
  now = Date.now(),
  processes,
  readProcesses = readWindowsProcesses,
  previous = null,
} = {}) {
  repo = resolve(repo);
  const alerts = [],
    add = (code, reason, severity = "warning") =>
      alerts.push({
        code,
        reason: sanitizeOutput(String(reason)).text,
        severity,
      });
  const safe = (read, fallback, code) => {
    try {
      return read();
    } catch (e) {
      add(code, e.message, "unknown");
      return fallback;
    }
  };
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))
    ),
    GIT_OPTIONAL_LOCKS: "0",
  };
  // One read-only observation often verifies the same historical SHA ancestry
  // more than once. Retain successes only within this observation, never across
  // polling ticks or in any mutation/publication guard.
  const gitReads = new Map();
  const git = (root, ...args) => {
    const key = JSON.stringify([root, ...args]);
    if (gitReads.has(key)) return gitReads.get(key);
    const result = execFileSync("git", ["-C", root, ...args], {
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trimEnd();
    gitReads.set(key, result);
    return result;
  };
  function worktreeProgress(root) {
    const records = git(
        root,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all"
      ).split("\0"),
      changes = [];
    for (let i = 0; i < records.length; i++) {
      if (!records[i]) continue;
      const code = records[i].slice(0, 2),
        path = records[i].slice(3),
        file = resolve(root, path);
      if (!path || !normalize(file).startsWith(normalize(root) + "/"))
        throw Error("Invalid dirty source path");
      if (/[RC]/.test(code)) i++;
      let entry;
      try {
        const s = statSync(file);
        entry = [path, s.mtimeMs, s.size];
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        entry = [path, null, null];
      }
      changes.push(entry);
      if (changes.length > 256)
        throw Error("Dirty source monitoring limit exceeded");
    }
    const sourceTimes = changes
      .map((entry) => entry[1])
      .filter((time) => time !== null);
    return {
      dirtyFiles: changes.length,
      sourceUpdatedAt: sourceTimes.length
        ? new Date(Math.max(...sourceTimes)).toISOString()
        : null,
      worktreeProgress: createHash("sha256")
        .update(JSON.stringify(changes))
        .digest("hex"),
    };
  }
  const age = (at) =>
    Number.isFinite(Date.parse(at))
      ? Math.max(0, (now - Date.parse(at)) / 60000)
      : null;
  const runner = safe(
    () => json(join(repo, "logs/codex-supervisor-state.json")),
    null,
    "worker_state_unreadable"
  );
  if (!runner)
    add("worker_state_missing", "No current runner summary", "unknown");
  const rows =
    processes ?? safe(readProcesses, null, "process_census_unavailable");
  const census = Array.isArray(rows) ? rows : [];
  const metrics = safe(
    () => recent(join(repo, "logs/supervisor-runs")),
    [],
    "metrics_unreadable"
  );
  const metric =
    metrics.find(
      (r) =>
        runner &&
        r.startedAt === runner.startedAt &&
        (!runner.runId || r.runId === runner.runId)
    ) || null;
  if (runner && !metric)
    add(
      "current_metrics_missing",
      "Current metrics could not be bound to runner startedAt",
      "unknown"
    );
  const workdir =
    metric?.workdir ||
    runner?.workdir ||
    join(repo, "../orica-wt/engine-drain");
  const inLane = (command, option) => {
    const args = processArgs(command),
      index = args.findIndex((arg) => arg.toLowerCase() === option);
    const path = index >= 0 ? args[index + 1] : null;
    return (
      typeof path === "string" &&
      normalize(resolve(path)) === normalize(resolve(workdir))
    );
  };
  const workerProcesses = census.filter((p) => {
    const args = processArgs(p.commandLine),
      labelIndex = args.indexOf("--label");
    return (
      /^node(?:\.exe)?$/i.test(p.name || "") &&
      /(?:^|[\\/])worker-codex-stream\.mjs$/.test(args[1] || "") &&
      args[labelIndex + 1] === (runner?.label || "supervisor") &&
      labelIndex > 0 &&
      inLane(p.commandLine, "--workdir")
    );
  });
  if (workerProcesses.length > 1)
    add(
      "duplicate_workers",
      "Multiple primary workers use the same full-run lane",
      "error"
    );
  let workerIdentityUnknown = false;
  if (runner?.status === "running" && rows) {
    const owner = runner.runnerPid
      ? census.find((p) => p.pid === runner.runnerPid)
      : null;
    workerIdentityUnknown = runner.runnerPid
      ? owner && typeof owner.commandLine !== "string"
      : !workerProcesses.length &&
        census.some(
          (p) =>
            /^node(?:\.exe)?$/i.test(p.name) &&
            typeof p.commandLine !== "string"
        );
    if (workerIdentityUnknown)
      add(
        "worker_identity_unavailable",
        "Worker exists but its command identity could not be inspected",
        "unknown"
      );
    else if (
      runner.runnerPid &&
      (!workerProcesses.some((p) => p.pid === runner.runnerPid) ||
        (Number.isFinite(Date.parse(owner?.processStartedAt)) &&
          Date.parse(owner.processStartedAt) >
            Date.parse(runner.startedAt) + 2000))
    )
      add(
        "worker_identity_mismatch",
        "Runner PID does not match the current process identity",
        "error"
      );
  }
  const autoProcesses = census.filter((p) => {
    const script = powershellScript(processArgs(p.commandLine));
    return (
      /^(?:pwsh|powershell)(?:\.exe)?$/i.test(p.name || "") &&
      /(?:^|[\\/])auto-merge\.ps1$/i.test(script || "") &&
      inLane(p.commandLine, "-worktree")
    );
  });
  const related = descendants(
    census,
    [...workerProcesses, ...autoProcesses].map((p) => p.pid)
  );
  const codexProcesses = census.filter(
    (p) => related.has(p.pid) && /^codex(?:\.exe)?$/i.test(p.name)
  );
  const validators = census
    .filter((p) => related.has(p.pid) && actualValidation(p))
    .map((p) => ({
      pid: p.pid,
      parentPid: p.parentPid,
      kind: actualValidation(p),
    }));
  const tickets = safe(
    () => recent(join(repo, "logs/supervisor-integrations")),
    [],
    "integration_history_unreadable"
  );
  let currentTicketIdentity = false;
  const ticket = runner?.integrationRequest
    ? safe(
        () => {
          const file = resolve(runner.integrationRequest);
          if (
            normalize(resolve(file, "..")) !==
            normalize(join(repo, "logs/supervisor-integrations"))
          )
            throw Error("Invalid integration request location");
          const bound = json(file);
          if (!bound || normalize(bound.workdir) !== normalize(workdir))
            throw Error("Integration ticket does not match worker lane");
          currentTicketIdentity =
            typeof bound.file === "string" &&
            normalize(resolve(bound.file)) === normalize(file) &&
            /^[a-f0-9-]{36}$/.test(bound.runId || "") &&
            normalize(file) ===
              normalize(
                join(
                  repo,
                  "logs/supervisor-integrations",
                  bound.runId + ".json"
                )
              );
          // Use the same freshly read record for current and historical checks.
          const current = { ...bound, file };
          const index = tickets.findIndex(
            (r) => normalize(r.file) === normalize(file)
          );
          if (index < 0) tickets.push(current);
          else tickets[index] = current;
          return current;
        },
        null,
        "integration_binding_invalid"
      )
    : tickets.find(
        (r) =>
          normalize(r.workdir) === normalize(workdir) &&
          Date.parse(
            r.startedAt ||
              r.requestedAt ||
              r.finishedAt ||
              new Date(r.fileTime).toISOString()
          ) >= Date.parse(runner?.startedAt)
      ) || null;
  const attempts = safe(
    () => recent(join(repo, "logs/auto-merge-runs")),
    [],
    "merge_history_unreadable"
  );
  const laneAttempts = attempts.filter(
    (r) => normalize(r.workdir) === normalize(workdir)
  );
  const laneTickets = tickets.filter(
    (r) => normalize(r.workdir) === normalize(workdir)
  );
  const publicationChecks = new Map();
  const samePublicationSource = (ticket, attempt) =>
    /^[a-f0-9]{40}$/.test(ticket.head || "") &&
    ticket.head === (attempt.sourceHead || attempt.head) &&
    typeof ticket.branch === "string" &&
    ticket.branch.length > 0 &&
    ticket.branch === attempt.branch &&
    normalize(ticket.workdir) === normalize(attempt.workdir);
  function observedBefore(record, observedAt) {
    const start = Date.parse(record.startedAt || record.requestedAt);
    const end = Date.parse(
      record.status === "running" ? record.updatedAt : record.finishedAt
    );
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end >= start &&
      ["requestedAt", "startedAt", "phaseStartedAt", "updatedAt", "finishedAt"]
        .filter((key) => record[key] !== undefined && record[key] !== null)
        .every(
          (key) =>
            Number.isFinite(Date.parse(record[key])) &&
            Date.parse(record[key]) <= observedAt
        )
    );
  }
  function resolvedByPublication(attempt) {
    return laneTickets.some(
      (ticket) =>
        published(ticket) &&
        ticket.resolution?.kind === "included_in_remote" &&
        samePublicationSource(ticket, attempt) &&
        observedBefore(attempt, Date.parse(ticket.resolution.observedAt))
    );
  }
  function publicationResourceWait(attempt) {
    if (
      attempt.exitCode !== LEASE_WAIT_EXIT ||
      !/^[a-f0-9]{32}$/.test(attempt.id || "")
    )
      return false;
    return laneTickets.some((ticket) => {
      if (
        ticket.workerExitCode !== 0 ||
        !samePublicationSource(ticket, attempt) ||
        attempt.sourceHead !== ticket.head ||
        normalize(ticket.repo) !== normalize(repo) ||
        normalize(attempt.repo) !== normalize(repo)
      )
        return false;
      // A retry replaces attemptId. Retain the terminal history binding so an
      // older wait does not become a failure again while its retry is running.
      return (
        Array.isArray(ticket.attempts) &&
        ticket.attempts.some((history) => {
          const requested = Date.parse(ticket.requestedAt);
          const started = Date.parse(history.startedAt);
          const finished = Date.parse(history.finishedAt);
          return (
            history.id === attempt.id &&
            history.status === "waiting" &&
            history.exitCode === LEASE_WAIT_EXIT &&
            Number.isFinite(requested) &&
            Number.isFinite(started) &&
            Number.isFinite(finished) &&
            requested <= started &&
            started <= Date.parse(attempt.startedAt) &&
            observedBefore(attempt, finished)
          );
        })
      );
    });
  }
  const activeAttempt =
    laneAttempts.find(
      (r) =>
        r.status === "running" &&
        !resolvedByPublication(r) &&
        Date.parse(r.startedAt) >= Date.parse(runner?.startedAt)
    ) || null;
  const attemptOwnership = (r) =>
    rows === null
      ? null
      : ownsProcess(
          census.find((p) => p.pid === r.pid),
          r.startedAt,
          (p) => autoProcesses.some((a) => a.pid === p.pid)
        );
  for (const old of laneAttempts.filter(
    (r) =>
      r.status === "running" && r !== activeAttempt && !resolvedByPublication(r)
  )) {
    const ownership = attemptOwnership(old);
    add(
      "previous_attempt_unfinished",
      "An older auto-merge attempt is still marked running; inspect its owner and durable history",
      ownership === false ? "error" : ownership === null ? "unknown" : "warning"
    );
  }
  const activeOwnership = activeAttempt
    ? attemptOwnership(activeAttempt)
    : null;
  function published(r) {
    if (publicationChecks.has(r)) return publicationChecks.get(r);
    const hash = (value) => /^[a-f0-9]{40}$/.test(value || "");
    let valid =
      r.status === "completed" &&
      hash(r.head) &&
      Number.isFinite(Date.parse(r.finishedAt));
    const modern = [
      "publicationVerified",
      "publishedHead",
      "validatedTree",
    ].some((key) => Object.hasOwn(r, key));
    if (valid && r.resolution?.kind === "included_in_remote") {
      valid =
        laneTickets.includes(r) &&
        r.resolution.head === r.head &&
        r.resolution.remoteHead === r.remoteHead &&
        hash(r.remoteHead) &&
        r.resolution.observedAt === r.finishedAt;
      if (valid) {
        try {
          git(repo, "merge-base", "--is-ancestor", r.head, r.remoteHead);
        } catch {
          valid = false;
        }
      }
    } else if (valid && modern) {
      const isAutoMerge = laneAttempts.includes(r);
      const needsTree =
        laneTickets.includes(r) || Object.hasOwn(r, "validatedTree");
      valid =
        r.publicationVerified === true &&
        hash(r.publishedHead) &&
        hash(r.remoteHead) &&
        (!isAutoMerge || hash(r.sourceHead)) &&
        (!needsTree || hash(r.validatedTree));
      if (valid) {
        try {
          // Read retained objects only: monitoring must never fetch or mutate.
          const tree = git(repo, "rev-parse", r.publishedHead + "^{tree}");
          git(repo, "merge-base", "--is-ancestor", r.head, r.publishedHead);
          git(
            repo,
            "merge-base",
            "--is-ancestor",
            r.publishedHead,
            r.remoteHead
          );
          if (r.sourceHead !== undefined && r.sourceHead !== null) {
            if (!hash(r.sourceHead)) throw Error("Invalid source head");
            git(
              repo,
              "merge-base",
              "--is-ancestor",
              r.sourceHead,
              r.publishedHead
            );
          }
          if (isAutoMerge && r.head !== r.publishedHead)
            throw Error("Auto-merge published head mismatch");
          if (needsTree && r.validatedTree !== tree)
            throw Error("Published tree mismatch");
        } catch {
          valid = false;
        }
      }
    } else if (valid) valid = r.head === r.remoteHead;
    publicationChecks.set(r, valid);
    return valid;
  }
  if (
    [...laneTickets, ...laneAttempts].some(
      (r) => r.status === "completed" && !published(r)
    )
  )
    add(
      "invalid_success_record",
      "Completed integration lacks matching exact heads or a valid completion time",
      "unknown"
    );
  const successful =
    [...laneTickets, ...laneAttempts]
      .filter((r) => !r.resolution && published(r))
      .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0] ||
    null;
  const reconciled =
    laneTickets
      .filter(
        (r) => r.resolution?.kind === "included_in_remote" && published(r)
      )
      .sort(
        (a, b) =>
          Date.parse(b.resolution.observedAt) -
          Date.parse(a.resolution.observedAt)
      )[0] || null;
  const currentOutcome = safe(
    () => {
      if (
        !currentTicketIdentity ||
        !ticket ||
        ticket.schemaVersion !== 1 ||
        normalize(ticket.repo) !== normalize(repo) ||
        ticket.exitCode !== 0 ||
        (ticket.resolution
          ? ticket.resolution.kind !== "included_in_remote"
          : ticket.publicationVerified !== true) ||
        normalize(resolve(runner.integrationRequest)) !==
          normalize(ticket.file) ||
        !(Date.parse(ticket.requestedAt) >= Date.parse(runner.startedAt)) ||
        !(Date.parse(ticket.finishedAt) >= Date.parse(ticket.requestedAt)) ||
        ticket.branch !== git(workdir, "symbolic-ref", "--short", "HEAD") ||
        !published(ticket)
      )
        return null;
      return {
        kind: ticket.resolution ? "included_in_remote" : "published",
        head: ticket.head,
        publishedHead: ticket.resolution
          ? null
          : ticket.publishedHead || ticket.head,
        remoteHead: ticket.remoteHead,
        finishedAt: ticket.finishedAt,
      };
    },
    null,
    "current_publication_unreadable"
  );
  const failed =
    [...laneTickets, ...laneAttempts]
      .filter(
        (r) =>
          r.status === "failed" &&
          !resolvedByPublication(r) &&
          !publicationResourceWait(r)
      )
      .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))[0] ||
    null;
  if (
    failed &&
    (!successful ||
      Date.parse(failed.finishedAt) > Date.parse(successful.finishedAt))
  )
    add(
      "integration_failed",
      failed.error || "Last integration failed",
      "error"
    );
  if (
    laneTickets.some(
      (r) =>
        r.file !== ticket?.file &&
        ["requested", "running", "waiting"].includes(r.status)
    )
  )
    add(
      "previous_integration_unfinished",
      "An older integration is still pending; current worker activity does not resolve it"
    );
  const main = safe(
    () => {
      const target = inspectIntegrationCheckout(repo);
      return {
        worktree: target.integrationWorktree,
        ref: target.integrationRef,
        configured: target.configured,
        ready: target.configured && target.ready,
        reason: target.configured ? target.reason : "configuration-missing",
        head: git(repo, "rev-parse", "refs/heads/main"),
        originHeadCached: git(repo, "rev-parse", "refs/remotes/origin/main"),
        branch: git(
          target.integrationWorktree,
          "symbolic-ref",
          "--short",
          "HEAD"
        ),
        dirtyFiles: git(target.integrationWorktree, "status", "--porcelain")
          .split(/\r?\n/)
          .filter(Boolean).length,
        lastRefUpdate: git(
          repo,
          "reflog",
          "show",
          "-1",
          "--date=iso-strict",
          "--format=%H %gD %gs",
          "main"
        ),
      };
    },
    null,
    "main_inspection_failed"
  );
  const lane = safe(
    () => ({
      head: git(workdir, "rev-parse", "HEAD"),
      ...worktreeProgress(workdir),
      unpublishedCommits: Number(
        git(workdir, "rev-list", "--count", "main..HEAD")
      ),
    }),
    null,
    "lane_inspection_failed"
  );
  if (!main?.ready)
    add(
      "integration_checkout_unavailable",
      "The registered main integration checkout is unavailable; preserve all other checkouts"
    );
  const locks = [];
  for (const laneName of ["supervisor", "card-impl", "merge"]) {
    const file = join(
      process.env.ORICA_SUPERVISOR_LOCK_DIR || resolve(repo, "../orica-wt"),
      `orica-supervisor${laneName === "supervisor" ? "" : "." + laneName}.lock.json`
    );
    safe(
      () => {
        const lock = json(file);
        if (!lock) {
          locks.push({ lane: laneName, status: "free" });
          return;
        }
        if (
          typeof lock.token !== "string" ||
          lock.token.length < 8 ||
          !Number.isFinite(lock.ttlMin) ||
          lock.ttlMin <= 0
        )
          throw new Error("Invalid lock metadata");
        const ageMinutes = (now - statSync(file).mtimeMs) / 60000;
        const owners = census.filter(
          (p) =>
            typeof p.commandLine === "string" &&
            p.commandLine.includes(lock.token)
        );
        const owner =
          owners[0]?.pid || (laneName === "merge" ? activeAttempt?.pid : null);
        const ownerAlive =
          rows === null
            ? null
            : owner
              ? census.some((p) => p.pid === owner)
              : null;
        locks.push({
          lane: laneName,
          status: "held",
          ageMinutes,
          ttlMinutes: lock.ttlMin,
          ownerPid: owner,
          ownerAlive,
        });
        if (ownerAlive === null)
          add(
            "lock_owner_unknown",
            `${laneName} lock owner could not be identified`,
            "unknown"
          );
        if (ageMinutes > (laneName === "merge" ? lock.ttlMin : 20))
          add(
            "lock_heartbeat_stale",
            `${laneName} heartbeat is ${ageMinutes.toFixed(1)} minutes old`
          );
        if (ownerAlive === false)
          add(
            "lock_owner_missing",
            `${laneName} owner process is absent`,
            "error"
          );
      },
      null,
      "lock_inspection_failed"
    );
  }
  let validation = { status: "unknown" };
  safe(
    () => {
      const common = git(
        repo,
        "rev-parse",
        "--path-format=absolute",
        "--git-common-dir"
      );
      const file = join(
        tmpdir(),
        "orica-validation-" +
          createHash("sha256").update(common.toLowerCase()).digest("hex") +
          ".lock"
      );
      const lease = json(file);
      if (!lease) {
        validation = { status: "free" };
        return;
      }
      validation = { status: "unknown" };
      if (
        !Number.isInteger(lease.pid) ||
        lease.pid <= 0 ||
        !Number.isFinite(lease.started) ||
        typeof lease.root !== "string"
      )
        throw new Error("Invalid validation lease metadata");
      if (
        normalize(
          git(
            lease.root,
            "rev-parse",
            "--path-format=absolute",
            "--git-common-dir"
          )
        ) !== normalize(common)
      )
        throw new Error("Validation lease belongs to another repository");
      const alive =
        rows === null
          ? null
          : ownsProcess(
              census.find((p) => p.pid === lease.pid),
              lease.started,
              (p) => Boolean(actualValidation(p))
            );
      validation = {
        status: alive === false ? "orphaned" : "held",
        ownerPid: lease.pid,
        ownerAlive: alive,
        root: lease.root,
        elapsedMinutes: (now - lease.started) / 60000,
        belongsToCurrentWorker: related.has(lease.pid),
      };
      if (alive === false)
        add(
          "validation_owner_missing",
          "Validation lease owner is absent; use the existing guarded recovery procedure",
          "error"
        );
      if (alive === null)
        add(
          "validation_identity_unavailable",
          "Validation owner identity could not be inspected",
          "unknown"
        );
      if (validation.elapsedMinutes > 30)
        add(
          "long_validation",
          "Validation exceeded 30 minutes; compare output progress before diagnosing a stall",
          "info"
        );
      const dir = join(lease.root, "logs/harness/output");
      const output = (existsSync(dir) ? readdirSync(dir) : [])
        .filter((s) => s.endsWith(".log") && s.includes(`-${lease.pid}-`))
        .map((s) => ({ file: join(dir, s), stat: statSync(join(dir, s)) }))
        .filter((entry) => entry.stat.birthtimeMs >= lease.started - 1000)
        .sort((a, b) => b.stat.birthtimeMs - a.stat.birthtimeMs)[0];
      if (output)
        validation.output = {
          file: output.file,
          bytes: output.stat.size,
          modifiedAt: output.stat.mtime.toISOString(),
        };
    },
    null,
    "validation_inspection_failed"
  );
  // Read bounded per-run metadata, never the mutable latest receipt or log text.
  // This is observation only; gate reuse and verifier acceptance keep their own checks.
  const gateRun = safe(
    () => {
      const runs = recent(join(workdir, "logs/harness/runs"))
        .filter(
          (r) =>
            normalize(r.root) === normalize(workdir) &&
            r.startedAt >= Date.parse(runner?.startedAt) &&
            (r.completionGate === true ||
              (r.status === "failed" &&
                r.file.endsWith("-blocked.json") &&
                ["finish", "full", "push", "merge", "ci"].includes(
                  r.profile
                ))) &&
            !(
              r.status === "passed" &&
              Array.isArray(r.gates) &&
              r.gates.length === 0
            )
        )
        .sort((a, b) => b.startedAt - a.startedAt);
      const r = runs[0];
      if (!r) return null;
      if (
        r.schemaVersion !== 2 ||
        !Number.isFinite(r.startedAt) ||
        !["running", "passed", "failed"].includes(r.status) ||
        !Array.isArray(r.gates)
      )
        throw Error("Invalid completion gate metadata");
      const output = r.outputLog || r.gates.at(-1)?.outputLog;
      let outputProgress = null;
      if (output) {
        if (
          normalize(resolve(output, "..")) !==
          normalize(join(workdir, "logs/harness/output"))
        )
          throw Error("Invalid gate output location");
        const s = statSync(output);
        outputProgress = {
          file: output,
          bytes: s.size,
          modifiedAt: s.mtime.toISOString(),
        };
      }
      return {
        file: r.file,
        profile: r.profile,
        status: r.status,
        failureCode: r.failureCode || null,
        publicationWait:
          r.status === "failed" &&
          r.file.endsWith("-blocked.json") &&
          ["merge", "push"].includes(r.profile) &&
          leaseFailureExit({ code: r.failureCode }) === LEASE_WAIT_EXIT &&
          r.gates.length === 0 &&
          r.requestedAt === r.startedAt &&
          Number.isFinite(r.finishedAt) &&
          r.finishedAt >= r.startedAt &&
          r.leaseWaitMs === r.finishedAt - r.startedAt &&
          r.durationMs === 0 &&
          laneAttempts.some(
            (attempt) =>
              attempt.status === "failed" &&
              publicationResourceWait(attempt) &&
              Date.parse(attempt.startedAt) <= r.startedAt &&
              r.finishedAt <= Date.parse(attempt.finishedAt)
          ),
        startedAt: new Date(r.startedAt).toISOString(),
        finishedAt: Number.isFinite(r.finishedAt)
          ? new Date(r.finishedAt).toISOString()
          : null,
        currentGate: r.currentGate || null,
        passedGates: r.gates.filter((g) => g.status === "passed").length,
        failedGates: r.gates
          .filter((g) => g.status === "failed")
          .map((g) => g.id),
        output: outputProgress,
      };
    },
    null,
    "gate_progress_unreadable"
  );
  const review = safe(
    () => {
      const context = json(join(workdir, ".verifier-context.json"));
      if (
        !context ||
        Date.parse(context.generatedAt) < Date.parse(runner?.startedAt)
      )
        return null;
      if (
        context.schemaVersion !== 1 ||
        !/^[a-f0-9]{40}$/.test(context.headTree || "") ||
        !Number.isFinite(Date.parse(context.generatedAt))
      )
        throw Error("Invalid verifier context metadata");
      const afterGate =
        gateRun?.status === "passed" &&
        gateRun.finishedAt &&
        Date.parse(context.generatedAt) >= Date.parse(gateRun.finishedAt);
      const sourceChanged =
        (lane?.sourceUpdatedAt &&
          Date.parse(lane.sourceUpdatedAt) > Date.parse(context.generatedAt)) ||
        (() => {
          // Diff also lists frozen untracked files as deleted from the index.
          // Only an absent worktree path is a deletion after the frozen tree;
          // a deletion already included in that tree remains reviewable.
          const paths = git(
            workdir,
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--name-only",
            "--diff-filter=D",
            "-z",
            context.headTree,
            "--"
          )
            .split("\0")
            .filter(Boolean);
          if (paths.length > 256)
            throw Error("Frozen source monitoring limit exceeded");
          return paths.some((path) => {
            const file = resolve(workdir, path);
            if (!normalize(file).startsWith(normalize(workdir) + "/"))
              throw Error("Invalid frozen source path");
            try {
              lstatSync(file);
              return false;
            } catch (error) {
              if (error.code !== "ENOENT") throw error;
              return true;
            }
          });
        })();
      const evidence = json(join(workdir, ".verifier-result.json"));
      const recorded =
        evidence?.headTree === context.headTree &&
        evidence.refuted === 0 &&
        Date.parse(evidence.verifiedAt) >= Date.parse(context.generatedAt);
      return {
        status:
          !afterGate || sourceChanged
            ? "outdated"
            : recorded
              ? "evidence_recorded"
              : "waiting",
        headTree: context.headTree,
        generatedAt: context.generatedAt,
        verifiedAt: recorded ? evidence.verifiedAt : null,
      };
    },
    null,
    "review_progress_unreadable"
  );
  validation.gateRun = gateRun;
  if (gateRun?.status === "failed" && !gateRun.publicationWait)
    add(
      "worker_validation_failed",
      "Latest completion gate failed: " +
        (gateRun.failedGates.join(", ") ||
          "runner failed before completing a gate"),
      "error"
    );
  let phase = "unknown",
    reason = "Evidence is incomplete";
  if (activeAttempt || ticket?.status === "running" || autoProcesses.length) {
    phase = "integrating";
    reason =
      activeAttempt?.phase || "Parent or foreground integration is active";
    const expectedPid = activeAttempt?.pid;
    if (
      rows &&
      ((expectedPid && activeOwnership === false) ||
        (!expectedPid && !autoProcesses.length))
    ) {
      phase = "integration_orphaned";
      add(
        "integration_process_missing",
        "Integration says running but its process is absent",
        "error"
      );
    }
    if (activeAttempt && activeOwnership === null) {
      phase = "integration_identity_unknown";
      add(
        "integration_identity_unavailable",
        "Auto-merge process identity could not be verified",
        "unknown"
      );
    }
  } else if (ticket?.status === "waiting") {
    phase = "publication_pending";
    reason =
      "Worker finished; frozen candidate awaits publication recovery before the next worker";
    if (age(ticket.requestedAt) > 30)
      add(
        "publication_wait_overdue",
        "Frozen publication has waited more than 30 minutes"
      );
  } else if (ticket?.status === "requested") {
    phase = "handoff_wait";
    reason = "Integration requested; parent awaits worker exit";
    if (age(ticket.requestedAt) > 10)
      add(
        "handoff_overdue",
        "Integration request has waited more than 10 minutes"
      );
  } else if (workerProcesses.length && codexProcesses.length) {
    const validating =
      validators.length ||
      (validation.status === "held" && validation.belongsToCurrentWorker);
    phase = validating ? "worker_validating" : "awaiting_worker";
    reason = validating
      ? "Worker validation is active; integration has not been requested"
      : "Worker is preparing, repairing or reviewing uncommitted work before integration";
    if (
      validation.status === "held" &&
      !validation.belongsToCurrentWorker &&
      validators.some((v) => v.kind === "gate_runner")
    ) {
      phase = "validation_wait";
      reason = "Worker validation awaits another live validation lease owner";
    }
    if (
      !validating &&
      gateRun?.status === "failed" &&
      !gateRun.publicationWait
    ) {
      phase = "worker_validation_failed";
      reason =
        "Worker must repair the failed completion gate before review and integration";
    } else if (!validating && review?.status === "waiting") {
      phase = "review_wait";
      reason =
        "Final gate passed; the frozen tree awaits independent verifier evidence";
    } else if (!validating && review?.status === "evidence_recorded") {
      phase = "awaiting_commit";
      reason =
        "Verifier evidence is recorded; commit and integration still require their exact-tree checks";
    }
  } else if (currentOutcome && rows && !workerProcesses.length) {
    phase = "idle";
    reason =
      currentOutcome.kind === "published"
        ? "Current integration completed with verified publication; no worker is active"
        : "Current integration was reconciled as included in remote; no worker is active";
  } else if (runner?.status === "running" && rows && !workerIdentityUnknown)
    add(
      "worker_process_missing",
      "Summary says running but runner or Codex is absent",
      "error"
    );
  else if (["completed", "worker_completed"].includes(runner?.status)) {
    phase = "idle";
    reason = "Worker finished; inspect published and pending work separately";
  }
  const workEvents = (runner?.recentEvents || []).filter((e) =>
    /item\.completed: file_change/.test(e.text || "")
  );
  const lastWorkAt = workEvents.at(-1)?.at || null;
  const pendingWork =
    (lane?.dirtyFiles || 0) > 0 || (lane?.unpublishedCommits || 0) > 0;
  if (
    ["completed", "worker_completed"].includes(runner?.status) &&
    pendingWork &&
    !activeAttempt &&
    !autoProcesses.length &&
    !["requested", "running"].includes(ticket?.status)
  )
    add(
      "unintegrated_completion",
      "Worker finished with unpublished lane work and no pending integration",
      "error"
    );
  const progressToken = JSON.stringify([
    metric?.runId,
    lane?.head,
    lane?.unpublishedCommits,
    lane?.worktreeProgress,
    activeAttempt?.updatedAt,
    ticket?.updatedAt || ticket?.finishedAt,
    validation.ownerPid,
    validation.output?.bytes,
    gateRun?.file,
    gateRun?.status,
    gateRun?.currentGate,
    gateRun?.passedGates,
    gateRun?.output?.bytes,
    review?.headTree,
    review?.status,
    review?.verifiedAt,
    successful?.head,
    main?.head,
  ]);
  const progressUnchangedSince =
    previous?.progressToken === progressToken
      ? previous.progressUnchangedSince || previous.observedAtUTC
      : new Date(now).toISOString();
  const stalled = age(progressUnchangedSince) > 20;
  const outputStalled =
    gateRun?.status === "running" && age(gateRun.output?.modifiedAt) > 20;
  const reviewLong = phase === "review_wait" && age(review.generatedAt) > 20;
  if (outputStalled)
    add(
      "validation_output_unchanged",
      "Current gate output has not changed for more than 20 minutes; inspect validation progress"
    );
  if (reviewLong)
    add(
      "review_wait_long",
      "Frozen tree has awaited independent verifier evidence for more than 20 minutes"
    );
  if (pendingWork && successful && age(successful.finishedAt) > 120) {
    const inProgress = [
      "worker_validating",
      "validation_wait",
      "review_wait",
      "integrating",
    ].includes(phase);
    const active = inProgress && !stalled && !outputStalled && !reviewLong;
    add(
      active ? "integration_age_context" : "integration_progress_overdue",
      `Unpublished work remains ${age(successful.finishedAt).toFixed(0)} minutes after the last successful merge; current phase=${phase}`,
      active ? "info" : "warning"
    );
  }
  if (stalled && (pendingWork || metric?.status === "running"))
    add(
      "progress_unchanged",
      "No source change, gate output growth, review evidence or integration progress since the previous observation"
    );
  return {
    schemaVersion: 1,
    observedAtUTC: new Date(now).toISOString(),
    health: alerts.some((a) => a.severity === "error")
      ? "attention"
      : alerts.some((a) => a.severity === "unknown")
        ? "unknown"
        : alerts.some((a) => a.severity === "warning")
          ? "watch"
          : "observed",
    runId: metric?.runId || null,
    threadId: runner?.threadId || null,
    model: runner?.model || null,
    reasoningEffort: runner?.reasoningEffort || null,
    workerStatus: runner?.status || "unknown",
    workerStartedAt: runner?.startedAt || null,
    workerUpdatedAt: runner?.updatedAt || null,
    integration: {
      phase,
      reason,
      ticketId: ticket?.runId || null,
      ticketStatus: ticket?.status || "unknown",
      currentOutcome,
      attemptId: activeAttempt?.id || null,
      lastSuccess: successful
        ? {
            head: successful.publishedHead || successful.head,
            finishedAt: successful.finishedAt,
            file: successful.file,
          }
        : null,
      lastReconciliation: reconciled
        ? {
            head: reconciled.head,
            remoteHead: reconciled.remoteHead,
            observedAt: reconciled.resolution.observedAt,
            file: reconciled.file,
          }
        : null,
      lastFailure: failed
        ? {
            head: failed.head,
            finishedAt: failed.finishedAt,
            error: sanitizeOutput(String(failed.error || "")).text,
            file: failed.file,
          }
        : null,
    },
    processes: {
      censusAvailable: Array.isArray(rows),
      runnerPids: workerProcesses.map((p) => p.pid),
      codexPids: codexProcesses.map((p) => p.pid),
      integrationPids: [
        ...new Set([
          ...autoProcesses
            .filter(
              (p) =>
                !activeAttempt ||
                p.pid !== activeAttempt.pid ||
                activeOwnership === true
            )
            .map((p) => p.pid),
          ...(activeAttempt && activeOwnership === true
            ? [activeAttempt.pid]
            : []),
        ]),
      ],
      validators,
    },
    locks,
    validation,
    review,
    main,
    lane,
    progress: {
      lastWorkAt,
      startPending: Array.isArray(metric?.before?.pending)
        ? metric.before.pending.length
        : null,
      endPending: Array.isArray(metric?.after?.pending)
        ? metric.after.pending.length
        : null,
    },
    progressToken,
    progressUnchangedSince,
    alerts,
    readOnly: true,
    activeHarnessReceiptRead: false,
  };
}
