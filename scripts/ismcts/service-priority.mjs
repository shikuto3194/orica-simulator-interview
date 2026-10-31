// Trusted service lifetime bridge. HTTP authentication and cancellation remain
// the service caller's responsibility; this module exposes no network route.
import { randomUUID } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  closeSync,
  renameSync,
} from "node:fs";
import {
  hash,
  programPaths,
  sharedFile,
  transaction,
  timestamp,
} from "./shared.mjs";

const markerName = "service-priority-head.json";
const initializedName = "service-priority-initialized.json";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const prefix = "service-priority-checkpoint-";
// Bound validation work and file sizes. Exhaustion requires explicit maintenance;
// neither a stale lifetime nor an old checkpoint is silently discarded.
const maxHistory = 4096,
  maxActive = 5,
  maxBytes = 16384;

function bytes(file) {
  const value = readFileSync(file);
  if (value.length > maxBytes)
    throw new Error("service priority record too large");
  return value;
}

export function sharedServiceState(directory, now = Date.now()) {
  timestamp(now, now);
  const markerFile = sharedFile(directory, markerName);
  const initializedFile = sharedFile(directory, initializedName);
  const files = existsSync(directory)
    ? readdirSync(directory)
        .filter((name) => name.startsWith(prefix))
        .sort()
    : [];
  if (!existsSync(markerFile)) {
    if (files.length || existsSync(initializedFile))
      throw new Error("service priority head missing");
    return { sequence: 0, head: null, active: [], at: 0, initialized: false };
  }
  if (files.length === 0 || files.length > maxHistory)
    throw new Error("service priority history missing or exhausted");
  const marker = JSON.parse(bytes(markerFile));
  const initialized = JSON.parse(bytes(initializedFile));
  if (
    Object.keys(initialized).sort().join() !==
      "firstHead,head,schemaVersion,sequence,status" ||
    initialized.schemaVersion !== 2 ||
    !/^[0-9a-f]{64}$/.test(initialized.firstHead) ||
    initialized.status !== "completed"
  )
    throw new Error("invalid service priority initialization");
  const ended = new Set();
  let previous = { sequence: 0, head: null, active: [], at: 0 };
  for (const [index, name] of files.entries()) {
    const match =
      /^service-priority-checkpoint-(\d{8})-([0-9a-f]{64})\.json$/.exec(name);
    if (!match || Number(match[1]) !== index + 1)
      throw new Error("service priority history sequence changed");
    const raw = bytes(sharedFile(directory, name));
    if (hash(raw) !== match[2])
      throw new Error("service priority archive changed");
    const value = JSON.parse(raw);
    timestamp(value.at, now);
    if (
      Object.keys(value).sort().join() !==
        "active,at,owner,previous,sequence" ||
      value.sequence !== index + 1 ||
      value.previous !== previous.head ||
      value.at < previous.at ||
      typeof value.owner !== "string" ||
      !uuid.test(value.owner) ||
      !Array.isArray(value.active) ||
      value.active.length > maxActive ||
      value.active.some(
        (owner) => typeof owner !== "string" || !uuid.test(owner)
      ) ||
      new Set(value.active).size !== value.active.length
    )
      throw new Error("invalid service priority checkpoint");
    const wasActive = previous.active.includes(value.owner);
    if (ended.has(value.owner))
      throw new Error("service priority owner reused");
    const expected = wasActive
      ? previous.active.filter((owner) => owner !== value.owner)
      : [...previous.active, value.owner];
    if (JSON.stringify(expected) !== JSON.stringify(value.active))
      throw new Error("service priority lifetime transition changed");
    if (value.sequence + value.active.length > maxHistory)
      throw new Error("service priority closing capacity missing");
    if (index === 0 && initialized.firstHead !== match[2])
      throw new Error("service priority initial archive changed");
    if (wasActive) ended.add(value.owner);
    previous = {
      sequence: value.sequence,
      head: match[2],
      active: value.active,
      at: value.at,
    };
  }
  if (
    initialized.sequence !== previous.sequence ||
    initialized.head !== previous.head ||
    Object.keys(marker).sort().join() !== "head,schemaVersion,sequence" ||
    marker.schemaVersion !== 1 ||
    marker.sequence !== previous.sequence ||
    marker.head !== previous.head
  )
    throw new Error("service priority head rollback or interrupted write");
  if (now < previous.at) throw new Error("service priority clock reversed");
  return { ...previous, firstHead: initialized.firstHead, initialized: true };
}

export function sharedServiceBusy(directory) {
  return sharedServiceState(directory).active.length !== 0;
}

function advance(directory, state, owner, active, now) {
  if (state.sequence >= maxHistory)
    throw new Error("service priority history exhausted");
  const sequence = state.sequence + 1;
  const raw = Buffer.from(
    JSON.stringify({ sequence, previous: state.head, at: now, owner, active }) +
      "\n"
  );
  const head = hash(raw);
  const anchor = {
    schemaVersion: 2,
    firstHead: state.firstHead ?? head,
    sequence,
    head,
    status: "pending",
  };
  // The independent current anchor moves first. Losing a trailing archive and
  // restoring an older head cannot turn the unreleased lifetime into idle.
  // Every interrupted phase remains a refusal; no reader completes a write.
  writeReference(directory, initializedName, anchor);
  const file = sharedFile(
    directory,
    `${prefix}${String(sequence).padStart(8, "0")}-${head}.json`
  );
  // Write once and sync before advancing the reference. A crash in between is
  // detected on the next read; readers never adopt an unreferenced checkpoint.
  const fd = openSync(file, "wx");
  try {
    writeFileSync(fd, raw);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  writeReference(directory, markerName, {
    schemaVersion: 1,
    sequence,
    head,
  });
  writeReference(directory, initializedName, {
    ...anchor,
    status: "completed",
  });
}

function writeReference(directory, name, value) {
  const temp = sharedFile(directory, `${name}.${randomUUID()}.tmp`);
  const fd = openSync(temp, "wx");
  try {
    writeFileSync(fd, JSON.stringify(value) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, sharedFile(directory, name));
}

export function beginServicePriority(directory) {
  return transaction(directory, () => {
    const now = Date.now(),
      state = sharedServiceState(directory, now);
    if (state.active.length >= maxActive)
      throw new Error("service priority admission full");
    if (state.sequence + state.active.length + 2 > maxHistory)
      throw new Error("service priority history exhausted");
    const owner = randomUUID();
    advance(directory, state, owner, [...state.active, owner], now);
    return owner;
  });
}

export function endServicePriority(directory, owner) {
  if (typeof owner !== "string" || !uuid.test(owner))
    throw new Error("invalid service priority owner");
  return transaction(directory, () => {
    const now = Date.now(),
      state = sharedServiceState(directory, now);
    if (!state.active.includes(owner))
      throw new Error("service priority ownership mismatch");
    advance(
      directory,
      state,
      owner,
      state.active.filter((value) => value !== owner),
      now
    );
  });
}

export async function withIsmctsServicePriority(worktree, handler) {
  if (typeof handler !== "function") throw new Error("invalid service handler");
  const directory = programPaths(worktree).shared;
  const owner = beginServicePriority(directory);
  try {
    return await handler();
  } finally {
    endServicePriority(directory, owner);
  }
}
