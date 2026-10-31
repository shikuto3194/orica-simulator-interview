import {
  existsSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  readdirSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { sharedServiceBusy } from "./service-priority.mjs";
import {
  profile,
  bootstrapProfileHash,
  jstDay,
  nextJstDay,
  validateProfile,
} from "./resources.mjs";
import {
  readJson,
  atomicJson,
  sharedFile,
  transaction,
  timestamp,
  hash,
} from "./shared.mjs";

const dimensions = ["wallMs", "cpuMs", "gpuMs", "monitorMs", "outputBytes"];
const zero = () => Object.fromEntries(dimensions.map((key) => [key, 0]));
const claimedOutput = (entry) =>
  entry.claimedOutputBytes === undefined ? 0 : entry.claimedOutputBytes;
function amounts(value) {
  if (
    !value ||
    dimensions.some(
      (key) => !Number.isSafeInteger(value[key]) || value[key] < 0
    ) ||
    Object.keys(value).some((key) => !dimensions.includes(key))
  )
    throw new Error("invalid budget amounts");
  return value;
}

function validateHistory(ledger, now) {
  if (
    !ledger.days ||
    typeof ledger.days !== "object" ||
    Array.isArray(ledger.days) ||
    !Array.isArray(ledger.reservations)
  )
    throw new Error("invalid budget history");
  timestamp(ledger.lastClock, now);
  for (const [day, usage] of Object.entries(ledger.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > jstDay(now))
      throw new Error("invalid budget day");
    amounts(usage);
  }
  const ids = new Set();
  const reconstructed = {};
  for (const entry of ledger.reservations) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      ids.has(entry.id) ||
      !["active", "finished"].includes(entry.status) ||
      !ledger.days[entry.day] ||
      typeof entry.owner !== "string" ||
      entry.owner.length === 0
    )
      throw new Error("invalid reservation");
    ids.add(entry.id);
    amounts(entry.reserved);
    if (
      !Number.isSafeInteger(claimedOutput(entry)) ||
      claimedOutput(entry) < 0 ||
      claimedOutput(entry) > entry.reserved.outputBytes
    )
      throw new Error("invalid output claim");
    timestamp(entry.startedAt, now);
    if (entry.day !== jstDay(entry.startedAt))
      throw new Error("invalid reservation day for start timestamp");
    let accounted = entry.reserved;
    if (entry.status === "finished") {
      timestamp(entry.finishedAt, now);
      if (
        entry.finishedAt < entry.startedAt ||
        !["completed", "failed"].includes(entry.outcome)
      )
        throw new Error("invalid finished reservation");
      amounts(entry.measured);
      if (
        dimensions.some((key) => entry.measured[key] > entry.reserved[key]) ||
        entry.measured.outputBytes < claimedOutput(entry)
      )
        throw new Error("invalid measured reservation");
      if (entry.outcome === "completed") accounted = entry.measured;
    }
    const total = reconstructed[entry.day] ?? zero();
    for (const key of dimensions) {
      total[key] += accounted[key];
      if (!Number.isSafeInteger(total[key]))
        throw new Error("budget total overflow");
    }
    reconstructed[entry.day] = total;
  }
  if (
    JSON.stringify(Object.entries(reconstructed).sort()) !==
    JSON.stringify(Object.entries(ledger.days).sort())
  )
    throw new Error("budget history and totals disagree");
  return ledger;
}

function validateBootstrap(ledger, now) {
  if (
    ledger.schemaVersion !== 1 ||
    ledger.profileHash !== bootstrapProfileHash ||
    ledger.migration
  )
    throw new Error("unrecognized bootstrap ledger/profile");
  return validateHistory(ledger, now);
}

function hasMigrationArchive(directory) {
  return (
    existsSync(directory) &&
    readdirSync(directory).some((name) => /^bootstrap-usage-/i.test(name))
  );
}

function validateMigrationBinding(migration, now) {
  if (
    !migration ||
    migration.fromProfileHash !== bootstrapProfileHash ||
    migration.toProfileHash !== validateProfile(profile) ||
    !/^[0-9a-f]{64}$/.test(migration.source?.sha256) ||
    migration.source.path !== `bootstrap-usage-${migration.source.sha256}.json`
  )
    throw new Error("invalid budget migration binding");
  timestamp(migration.migratedAt, now);
}

function initialMigrationTarget(original, migration) {
  return {
    ...original,
    schemaVersion: 2,
    profileHash: validateProfile(profile),
    lastClock: migration.migratedAt,
    migration,
  };
}

function migrationTargetHash(target) {
  // Match atomicJson's original bytes, including key order and trailing LF.
  return hash(JSON.stringify(target, null, 2) + "\n");
}

function validateReservationRequest(request) {
  const {
    wallMs,
    threads = 1,
    monitor = false,
    outputBytes = 0,
    owner,
  } = request;
  if (
    !Number.isSafeInteger(wallMs) ||
    wallMs <= 0 ||
    wallMs > profile.offline.chunkMs ||
    !Number.isInteger(threads) ||
    threads < 1 ||
    threads > profile.compute.threads ||
    typeof monitor !== "boolean" ||
    typeof owner !== "string" ||
    !owner ||
    !Number.isSafeInteger(outputBytes) ||
    outputBytes < 0 ||
    request.gpu === true
  )
    throw new Error("invalid/unsupported resource reservation");
  if (monitor && wallMs > profile.offline.monitorTickMs)
    throw new Error("monitor tick exceeds budget");
  return { wallMs, threads, monitor, outputBytes, owner };
}

function validateCheckpointAdvance(previous, next) {
  const metadata = (ledger) =>
    JSON.stringify({
      ...ledger,
      days: undefined,
      reservations: undefined,
      lastClock: undefined,
    });
  const old = previous.reservations,
    current = next.reservations;
  if (
    metadata(previous) !== metadata(next) ||
    next.lastClock < previous.lastClock
  )
    throw new Error("budget checkpoint metadata or clock changed");
  if (current.length === old.length + 1) {
    const added = current.at(-1);
    validateReservationRequest({
      wallMs: added.reserved.wallMs,
      threads: added.threads,
      monitor: added.monitor,
      outputBytes: added.reserved.outputBytes,
      owner: added.owner,
    });
    if (
      old.some((entry) => entry.status === "active") ||
      JSON.stringify(current.slice(0, old.length)) !== JSON.stringify(old) ||
      added.status !== "active" ||
      claimedOutput(added) !== 0 ||
      added.startedAt !== next.lastClock ||
      !Number.isInteger(added.threads) ||
      added.threads < 1 ||
      added.threads > profile.compute.threads ||
      typeof added.monitor !== "boolean" ||
      added.reserved.wallMs <= 0 ||
      added.reserved.wallMs > profile.offline.chunkMs ||
      added.startedAt + added.reserved.wallMs > nextJstDay(added.startedAt) ||
      added.reserved.cpuMs !== added.reserved.wallMs * added.threads ||
      added.reserved.gpuMs !== 0 ||
      added.reserved.monitorMs !==
        (added.monitor ? added.reserved.wallMs : 0) ||
      dimensions.some((key) => next.days[added.day][key] > profile.offline[key])
    )
      throw new Error("budget checkpoint reservation append changed history");
    return;
  }
  const index = old.findIndex((entry) => entry.status === "active");
  if (
    current.length !== old.length ||
    index < 0 ||
    old.filter((entry) => entry.status === "active").length !== 1
  )
    throw new Error("budget checkpoint history rollback or invalid transition");
  const before = old[index],
    after = current[index];
  if (after.status === "active") {
    const withoutClaim = (entry) =>
      JSON.stringify({ ...entry, claimedOutputBytes: undefined });
    if (
      withoutClaim(before) !== withoutClaim(after) ||
      claimedOutput(after) <= claimedOutput(before) ||
      next.lastClock >= before.startedAt + before.reserved.wallMs ||
      JSON.stringify(previous.days) !== JSON.stringify(next.days) ||
      old.some(
        (entry, i) =>
          i !== index && JSON.stringify(entry) !== JSON.stringify(current[i])
      )
    )
      throw new Error("budget checkpoint output claim changed history");
    return;
  }
  const identity = (entry) =>
    JSON.stringify({
      ...entry,
      status: undefined,
      finishedAt: undefined,
      outcome: undefined,
      measured: undefined,
    });
  if (
    after.status !== "finished" ||
    identity(before) !== identity(after) ||
    after.finishedAt !== next.lastClock ||
    after.measured.wallMs > after.finishedAt - before.startedAt ||
    after.measured.monitorMs !== (before.monitor ? after.measured.wallMs : 0) ||
    old.some(
      (entry, i) =>
        i !== index && JSON.stringify(entry) !== JSON.stringify(current[i])
    )
  )
    throw new Error("budget checkpoint completion changed history");
}

function retainedCheckpoints(directory, now) {
  if (!existsSync(directory)) return [];
  let previous;
  return readdirSync(directory)
    .filter((name) => /^budget-checkpoint-/i.test(name))
    .sort()
    .map((name, index) => {
      const match = /^budget-checkpoint-(\d{16})-([0-9a-f]{64})\.json$/.exec(
        name
      );
      if (!match || Number(match[1]) !== index + 1)
        throw new Error("invalid budget checkpoint sequence");
      const bytes = readFileSync(sharedFile(directory, name));
      if (hash(bytes) !== match[2])
        throw new Error("budget checkpoint archive changed");
      const ledger = JSON.parse(bytes.toString("utf8"));
      if (
        ledger.schemaVersion !== 2 ||
        ledger.profileHash !== validateProfile(profile)
      )
        throw new Error("invalid retained budget checkpoint profile");
      validateHistory(ledger, now);
      if (previous) validateCheckpointAdvance(previous, ledger);
      previous = ledger;
      return { sequence: index + 1, path: name, targetHash: match[2] };
    });
}

function validateLedgerCheckpoint(
  directory,
  ledger,
  now,
  allowPending = false
) {
  const checkpoint = readJson(sharedFile(directory, "budget-initialized.json"));
  const latest = retainedCheckpoints(directory, now).at(-1);
  if (
    checkpoint.schemaVersion !== 2 ||
    !["pending", "completed"].includes(checkpoint.status) ||
    checkpoint.targetHash !== migrationTargetHash(ledger) ||
    !latest ||
    latest.sequence !== checkpoint.sequence ||
    latest.path !== checkpoint.path ||
    latest.targetHash !== checkpoint.targetHash
  )
    throw new Error(
      "budget ledger checkpoint mismatch; history rollback refused"
    );
  timestamp(checkpoint.writtenAt, now);
  if (checkpoint.writtenAt !== ledger.lastClock)
    throw new Error("budget ledger checkpoint clock mismatch");
  if (checkpoint.status !== "completed" && !allowPending)
    throw new Error("budget ledger write pending; explicit repair required");
  return checkpoint;
}

function writeLedger(directory, ledger) {
  const marker = sharedFile(directory, "budget-initialized.json");
  const bytes = JSON.stringify(ledger, null, 2) + "\n";
  const targetHash = hash(bytes);
  const latest = retainedCheckpoints(directory, ledger.lastClock).at(-1);
  const sequence =
    latest?.targetHash === targetHash
      ? latest.sequence
      : (latest?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence))
    throw new Error("budget checkpoint sequence overflow");
  const path = `budget-checkpoint-${String(sequence).padStart(16, "0")}-${targetHash}.json`;
  if (latest?.targetHash !== targetHash) {
    const fd = openSync(sharedFile(directory, path), "wx");
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }
  const checkpoint = {
    schemaVersion: 2,
    status: "pending",
    targetHash,
    sequence,
    path,
    writtenAt: ledger.lastClock,
  };
  // Persist the new anchor first. A crash cannot make an older ledger appear
  // current. Only an exact persisted target can complete an interrupted write.
  atomicJson(marker, checkpoint);
  atomicJson(sharedFile(directory, "usage.json"), ledger);
  atomicJson(marker, { ...checkpoint, status: "completed" });
}

function validateMigration(directory, ledger, now) {
  const migration = ledger.migration;
  if (migration === null) {
    if (
      existsSync(sharedFile(directory, "budget-migration-status.json")) ||
      hasMigrationArchive(directory)
    )
      throw new Error("budget migration provenance missing");
    return;
  }
  validateMigrationBinding(migration, now);
  const bytes = readFileSync(sharedFile(directory, migration.source.path));
  if (hash(bytes) !== migration.source.sha256)
    throw new Error("budget migration archive hash mismatch");
  const original = validateBootstrap(JSON.parse(bytes.toString("utf8")), now);
  if (
    original.reservations.some((entry) => entry.status === "active") ||
    original.lastClock > migration.migratedAt ||
    ledger.lastClock < migration.migratedAt ||
    JSON.stringify(
      ledger.reservations.slice(0, original.reservations.length)
    ) !== JSON.stringify(original.reservations)
  )
    throw new Error("budget migration history changed or owner unreconciled");
  const status = readJson(
    sharedFile(directory, "budget-migration-status.json")
  );
  timestamp(status.completedAt, now);
  if (
    status.schemaVersion !== 1 ||
    status.status !== "completed" ||
    status.blockedJournal === true ||
    status.completedAt < migration.migratedAt ||
    !/^[0-9a-f]{64}$/.test(status.targetHash) ||
    JSON.stringify(status.migration) !== JSON.stringify(migration)
  )
    throw new Error("budget migration repair_required");
  // Later reservations legitimately change usage.json. Bind the journal to
  // the initial transition reconstructed from the retained source instead.
  if (
    status.targetHash !==
    migrationTargetHash(initialMigrationTarget(original, migration))
  )
    throw new Error("budget migration initial target hash mismatch");
  if (retainedCheckpoints(directory, now)[0]?.targetHash !== status.targetHash)
    throw new Error("budget migration initial checkpoint mismatch");
}

function readLedger(directory, now) {
  const file = sharedFile(directory, "usage.json");
  if (!existsSync(file)) {
    if (
      existsSync(sharedFile(directory, "budget-initialized.json")) ||
      existsSync(sharedFile(directory, "budget-migration-status.json")) ||
      hasMigrationArchive(directory) ||
      retainedCheckpoints(directory, now).length > 0
    )
      throw new Error("budget ledger missing after initialization");
    return {
      schemaVersion: 2,
      profileHash: validateProfile(profile),
      migration: null,
      days: {},
      reservations: [],
      lastClock: now,
    };
  }
  const ledger = readJson(file);
  if (ledger.schemaVersion === 1 && ledger.profileHash === bootstrapProfileHash)
    throw new Error(
      "budget migration_required; preserve and migrate bootstrap history"
    );
  if (
    ledger.schemaVersion !== 2 ||
    ledger.profileHash !== validateProfile(profile)
  )
    throw new Error("invalid budget ledger");
  validateHistory(ledger, now);
  validateMigration(directory, ledger, now);
  validateLedgerCheckpoint(directory, ledger, now);
  return ledger;
}

// Explicit command only. Active reservations (including dead/unreconciled
// owners) are never ignored. An interrupted transition is retried from the
// retained original; no usage reset or automatic profile-hash rewriting.
export function migrateBudget(directory, now = Date.now()) {
  return transaction(directory, () => {
    const file = sharedFile(directory, "usage.json");
    const statusFile = sharedFile(directory, "budget-migration-status.json");
    try {
      if (!existsSync(file)) {
        readLedger(directory, now); // missing-after-init is still an error
        return {
          status: "not_initialized",
          profileHash: validateProfile(profile),
        };
      }
      const bytes = readFileSync(file),
        current = JSON.parse(bytes.toString("utf8"));
      if (current.schemaVersion === 2) {
        if (current.profileHash !== validateProfile(profile))
          throw new Error("invalid budget ledger");
        validateHistory(current, now);
        // The ledger write may have succeeded before the completion journal.
        // Resume only the exact original transition, before any new job ran.
        if (current.migration && existsSync(statusFile)) {
          const status = readJson(statusFile);
          if (
            status.schemaVersion !== 1 ||
            !["pending", "completed", "repair_required"].includes(
              status.status
            ) ||
            status.blockedJournal === true
          )
            throw new Error("invalid budget migration journal requires repair");
          if (status.status !== "completed") {
            if (
              status.targetHash !== hash(bytes) ||
              JSON.stringify(status.migration) !==
                JSON.stringify(current.migration)
            )
              throw new Error("interrupted budget migration target changed");
            atomicJson(statusFile, {
              ...status,
              status: "completed",
              completedAt: now,
            });
          }
        }
        validateMigration(directory, current, now);
        const checkpoint = validateLedgerCheckpoint(
          directory,
          current,
          now,
          true
        );
        if (checkpoint.status === "pending")
          atomicJson(sharedFile(directory, "budget-initialized.json"), {
            ...checkpoint,
            status: "completed",
          });
        readLedger(directory, now);
        return { status: "already_current", profileHash: current.profileHash };
      }
      const original = validateBootstrap(current, now);
      if (original.reservations.some((entry) => entry.status === "active"))
        throw new Error("owned_job_or_unreconciled_orphan; migration refused");
      const hadJournal = existsSync(statusFile);
      const previous = hadJournal ? readJson(statusFile) : null;
      if (hadJournal) {
        // A schema 1 file after a completed transition is a rollback, never a
        // new migration. Keep this guard after a failed rollback retry too.
        if (
          previous?.status === "completed" ||
          previous?.completedAt !== undefined
        )
          throw new Error("completed budget migration rollback refused");
        if (
          previous?.schemaVersion !== 1 ||
          previous.blockedJournal === true ||
          !["pending", "repair_required"].includes(previous.status)
        )
          throw new Error("invalid budget migration journal");
        if (previous.migration !== undefined) {
          validateMigrationBinding(previous.migration, now);
          if (
            !/^[0-9a-f]{64}$/.test(previous.targetHash) ||
            previous.migration.source.sha256 !== hash(bytes) ||
            previous.migration.migratedAt < original.lastClock
          )
            throw new Error("interrupted budget migration source changed");
        } else if (
          previous.status !== "repair_required" ||
          previous.targetHash !== undefined
        )
          throw new Error("budget migration journal binding missing");
      }
      // An archive with no transition binding is interrupted/corrupt history,
      // not an empty migration. Never select a new source around its journal.
      if (!previous?.migration && hasMigrationArchive(directory))
        throw new Error("retained migration archive requires journal binding");
      const source = {
        path: `bootstrap-usage-${hash(bytes)}.json`,
        sha256: hash(bytes),
      };
      const archive = sharedFile(directory, source.path);
      if (previous?.migration && !existsSync(archive))
        throw new Error("interrupted budget migration archive missing");
      if (existsSync(archive)) {
        if (!readFileSync(archive).equals(bytes))
          throw new Error("migration archive already differs");
      } else {
        const fd = openSync(archive, "wx");
        try {
          writeFileSync(fd, bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
      const migration = previous?.migration ?? {
        fromProfileHash: bootstrapProfileHash,
        toProfileHash: validateProfile(profile),
        source,
        migratedAt: now,
      };
      const next = initialMigrationTarget(original, migration);
      const targetHash = migrationTargetHash(next);
      if (previous?.migration && previous.targetHash !== targetHash)
        throw new Error("interrupted budget migration target changed");
      const latest = retainedCheckpoints(directory, now).at(-1);
      if (latest && latest.targetHash !== targetHash)
        throw new Error("budget migration checkpoint rollback refused");
      const marker = sharedFile(directory, "budget-initialized.json");
      if (existsSync(marker)) {
        const checkpoint = readJson(marker);
        // A genuine bootstrap writer used only the schema1 marker. On retry,
        // a schema2 anchor must still identify the same initial target; later
        // usage cannot be replaced by restoring a bootstrap file/journal.
        if (checkpoint.schemaVersion === 2) {
          validateLedgerCheckpoint(directory, next, now, true);
        } else if (
          checkpoint.schemaVersion !== 1 ||
          Object.keys(checkpoint).length !== 1
        )
          throw new Error("invalid bootstrap initialization checkpoint");
      }
      atomicJson(statusFile, {
        ...previous,
        schemaVersion: 1,
        status: "pending",
        migration,
        targetHash,
      });
      writeLedger(directory, next);
      atomicJson(statusFile, {
        ...previous,
        schemaVersion: 1,
        status: "completed",
        migration,
        targetHash,
        completedAt: now,
      });
      readLedger(directory, now);
      return {
        status: "migrated",
        migration,
        used: budgetStatus(directory, now).used,
      };
    } catch (error) {
      const hadJournal = existsSync(statusFile);
      const previous = hadJournal ? readJson(statusFile) : {};
      atomicJson(statusFile, {
        ...previous,
        schemaVersion: 1,
        status: "repair_required",
        // Retrying the command cannot legitimize an unknown journal version
        // or state merely because this failure diagnostic normalizes status.
        blockedJournal:
          previous?.blockedJournal === true ||
          (hadJournal &&
            (previous?.schemaVersion !== 1 ||
              !["pending", "completed", "repair_required"].includes(
                previous?.status
              ))),
        failedAt: now,
        reason: error.message,
      });
      throw error;
    }
  });
}

// Shared by the future autonomous runner: reserve a shorter final chunk now,
// then call again at the next JST day. No LLM tick or manual daily reset needed.
function nextChunkRequest(request, now) {
  if (
    !Number.isSafeInteger(request?.wallMs) ||
    request.wallMs <= 0 ||
    request.wallMs > profile.offline.chunkMs
  )
    throw new Error("invalid chunk duration");
  return {
    ...request,
    wallMs: Math.min(request.wallMs, nextJstDay(now) - now),
  };
}

export function reserveNextChunk(directory, request, now = Date.now()) {
  return reserveBudget(directory, nextChunkRequest(request, now), now);
}

export function previewNextChunk(directory, request, now = Date.now()) {
  return previewBudgetReservation(
    directory,
    nextChunkRequest(request, now),
    now
  );
}

export function budgetStatus(directory, now = Date.now()) {
  const ledger = readLedger(directory, now);
  const used = ledger.days[jstDay(now)] ?? zero();
  return {
    schemaVersion: 1,
    day: jstDay(now),
    used,
    remaining: Object.fromEntries(
      dimensions.map((key) => [
        key,
        Math.max(0, profile.offline[key] - used[key]),
      ])
    ),
    active: ledger.reservations.filter((entry) => entry.status === "active"),
  };
}

function reservationAdmission(directory, ledger, request, now) {
  const { wallMs, threads, monitor, outputBytes } = request;
  if (sharedServiceBusy(directory))
    return { status: "deferred_load", reason: "service_priority" };
  if (ledger.reservations.some((entry) => entry.status === "active"))
    return {
      status: "deferred_load",
      reason: "owned_job_or_unreconciled_orphan",
    };
  // A chunk cannot span the JST boundary. No restart/worktree creates a new
  // daily allowance, and a crashed owner keeps its pessimistic reservation.
  if (now + wallMs > nextJstDay(now))
    return { status: "deferred_budget", reason: "jst_boundary" };
  const reserved = {
    wallMs,
    cpuMs: wallMs * threads,
    gpuMs: 0,
    monitorMs: monitor ? wallMs : 0,
    outputBytes,
  };
  const day = jstDay(now),
    used = ledger.days[day] ?? zero();
  if (
    dimensions.some((key) => used[key] + reserved[key] > profile.offline[key])
  )
    return { status: "deferred_budget", reason: "daily_limit" };
  return { status: "available", day, used, reserved };
}

// A negative preview is conservative and read-only. An available result is
// never a reservation or permission to create work: admission is checked again
// under the existing transaction after any intervening capacity scan.
export function previewBudgetReservation(directory, request, now = Date.now()) {
  const intake = validateReservationRequest(request);
  const lock = sharedFile(directory, "transaction.lock");
  const checkLock = () => {
    if (existsSync(lock)) {
      const error = new Error(
        "EEXIST: budget transaction in progress; explicit repair or retry required"
      );
      error.code = "EEXIST";
      throw error;
    }
  };
  checkLock();
  const ledger = readLedger(directory, now);
  checkLock();
  const { status, reason } = reservationAdmission(
    directory,
    ledger,
    intake,
    now
  );
  return reason === undefined ? { status } : { status, reason };
}

export function reserveBudget(directory, request, now = Date.now()) {
  const intake = validateReservationRequest(request);
  const preview = previewBudgetReservation(directory, intake, now);
  if (preview.status !== "available") return preview;
  return transaction(directory, () => {
    const ledger = readLedger(directory, now);
    const admission = reservationAdmission(directory, ledger, intake, now);
    if (admission.status !== "available") return admission;
    const { day, used, reserved } = admission;
    const { threads, monitor, owner } = intake;
    ledger.days[day] = Object.fromEntries(
      dimensions.map((key) => [key, used[key] + reserved[key]])
    );
    const entry = {
      id: randomUUID(),
      owner,
      day,
      startedAt: now,
      status: "active",
      reserved,
      threads,
      monitor,
    };
    ledger.reservations.push(entry);
    ledger.lastClock = now;
    writeLedger(directory, ledger);
    return { ...entry, status: "reserved" };
  });
}

// Trusted lower seam used only by the managed synchronous writer. Hold the
// existing shared transaction through the write: completion, another worktree
// and another writer cannot return/reuse this claim while I/O is in progress.
// Persist before I/O and never roll it back on callback failure or timeout.
export function withOutputClaim(
  directory,
  id,
  owner,
  byteLength,
  write,
  now = Date.now()
) {
  const started = performance.now();
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength <= 0 ||
    typeof write !== "function"
  )
    throw new Error("invalid output claim request");
  return transaction(directory, () => {
    const ledger = readLedger(directory, now);
    const entry = ledger.reservations.find((value) => value.id === id);
    if (!entry || entry.status !== "active" || entry.owner !== owner)
      throw new Error("budget ownership mismatch");
    const checkDeadline = () => {
      if (
        now + Math.ceil(performance.now() - started) >=
        entry.startedAt + entry.reserved.wallMs
      )
        throw new Error("output deadline elapsed; reservation retained");
    };
    checkDeadline();
    const total = claimedOutput(entry) + byteLength;
    if (!Number.isSafeInteger(total) || total > entry.reserved.outputBytes)
      throw new Error("output exceeds reserved byte allowance");
    entry.claimedOutputBytes = total;
    ledger.lastClock = now;
    writeLedger(directory, ledger);
    checkDeadline();
    const result = write(checkDeadline);
    if (result && typeof result.then === "function")
      throw new Error("managed output callback must be synchronous");
    checkDeadline();
    return result;
  });
}

// Only a fully accounted, non-orphaned owned tree can return unused budget.
// Abnormal exits retain the full reservation even when their sample looks low.
export function finishBudget(directory, id, owner, measured, now = Date.now()) {
  return transaction(directory, () => {
    const ledger = readLedger(directory, now);
    const entry = ledger.reservations.find((value) => value.id === id);
    if (!entry || entry.status !== "active" || entry.owner !== owner)
      throw new Error("budget ownership mismatch");
    timestamp(entry.startedAt, now);
    if (
      !measured ||
      !["completed", "failed"].includes(measured.status) ||
      measured.treeExited !== true ||
      measured.accountingComplete !== true
    )
      throw new Error("unreconciled process tree; reservation retained");
    amounts(measured.usage);
    if (
      dimensions.some((key) => measured.usage[key] > entry.reserved[key]) ||
      measured.usage.outputBytes < claimedOutput(entry) ||
      measured.usage.wallMs > now - entry.startedAt ||
      measured.usage.monitorMs !== (entry.monitor ? measured.usage.wallMs : 0)
    )
      throw new Error("resource usage exceeds reservation or elapsed time");
    if (measured.status === "completed") {
      const day = ledger.days[entry.day];
      for (const key of dimensions)
        day[key] -= entry.reserved[key] - measured.usage[key];
    }
    entry.status = "finished";
    entry.finishedAt = now;
    entry.outcome = measured.status;
    entry.measured = measured.usage;
    ledger.lastClock = now;
    writeLedger(directory, ledger);
    return entry;
  });
}
