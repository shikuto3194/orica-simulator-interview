import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { URL } from "node:url";
import { mkdirSync } from "node:fs";
import {
  beginServicePriority,
  endServicePriority,
  sharedServiceBusy,
  sharedServiceState,
} from "./service-priority.mjs";
import { reserveBudget, budgetStatus } from "./budget.mjs";
import { runReservedWindowsJob } from "./windows-budget-admission.mjs";
import { runWindowsResourceLoop } from "./windows-resource-loop.mjs";
import { hash } from "./shared.mjs";

export async function testServicePriority() {
  const root = mkdtempSync(join(tmpdir(), "orica-service-priority-"));
  let completed = 0,
    serial = 0;
  const dir = () => join(root, String(++serial));
  const check = async (name, fn) => {
    await fn();
    console.log(`service-priority ok ${++completed} - ${name}`);
  };
  const request = () => ({
    wallMs: 1000,
    threads: 1,
    owner: randomUUID(),
    outputBytes: 0,
  });
  const module = join(root, "idle.mjs");
  writeFileSync(module, "setInterval(()=>{},1000);\n");
  const job = () => ({
    module,
    cwd: root,
    args: [],
    threads: 1,
    wallMs: 60000,
    outputBytes: 4096,
  });
  const head = (d) => join(d, "service-priority-head.json");
  try {
    await check(
      "absent bridge is idle and registration blocks reservation without a local callback",
      () => {
        const d = dir();
        assert.equal(sharedServiceBusy(d), false);
        const owner = beginServicePriority(d);
        assert.equal(sharedServiceBusy(d), true);
        assert.deepEqual(reserveBudget(d, request()), {
          status: "deferred_load",
          reason: "service_priority",
        });
        assert.equal(existsSync(join(d, "usage.json")), false);
        endServicePriority(d, owner);
        assert.equal(reserveBudget(d, request()).status, "reserved");
      }
    );
    await check(
      "multiple lifetimes cannot release each other or be released twice",
      () => {
        const d = dir(),
          a = beginServicePriority(d),
          b = beginServicePriority(d);
        assert.throws(() => endServicePriority(d, randomUUID()), /ownership/);
        endServicePriority(d, a);
        assert.equal(sharedServiceBusy(d), true);
        assert.throws(() => endServicePriority(d, a), /ownership/);
        endServicePriority(d, b);
        assert.equal(sharedServiceBusy(d), false);
        assert.equal(sharedServiceState(d).sequence, 4);
      }
    );
    await check(
      "bounded concurrent admission preserves all existing lifetimes",
      () => {
        const d = dir(),
          owners = Array.from({ length: 5 }, () => beginServicePriority(d));
        const before = readFileSync(head(d));
        assert.throws(() => beginServicePriority(d), /full/);
        assert.deepEqual(readFileSync(head(d)), before);
        for (const owner of owners) endServicePriority(d, owner);
        assert.equal(sharedServiceBusy(d), false);
        // A retained near-full history must leave room to close the final lease.
        // Build valid archived lifetimes directly in a private fixture; no runtime
        // threshold or public callback override changes the production bound.
        const near = dir();
        mkdirSync(near);
        let previous = null,
          firstHead,
          owner;
        const at = Date.now();
        for (let sequence = 1; sequence <= 4094; sequence++) {
          if (sequence % 2) owner = randomUUID();
          const raw = Buffer.from(
            JSON.stringify({
              sequence,
              previous,
              at,
              owner,
              active: sequence % 2 ? [owner] : [],
            }) + "\n"
          );
          previous = hash(raw);
          writeFileSync(
            join(
              near,
              `service-priority-checkpoint-${String(sequence).padStart(8, "0")}-${previous}.json`
            ),
            raw
          );
          if (sequence === 1) firstHead = previous;
        }
        writeFileSync(
          join(near, "service-priority-initialized.json"),
          JSON.stringify({
            schemaVersion: 2,
            firstHead,
            sequence: 4094,
            head: previous,
            status: "completed",
          })
        );
        writeFileSync(
          head(near),
          JSON.stringify({ schemaVersion: 1, sequence: 4094, head: previous })
        );
        const last = beginServicePriority(near);
        assert.throws(() => beginServicePriority(near), /exhausted/);
        endServicePriority(near, last);
        assert.equal(sharedServiceBusy(near), false);
        assert.throws(() => beginServicePriority(near), /exhausted/);
      }
    );
    await check(
      "unreleased lifetime remains busy after an actual registering process exits",
      async () => {
        const d = dir();
        beginServicePriority(d);
        const fresh = await import(
          `./service-priority.mjs?private-restart=${serial}`
        );
        assert.equal(
          fresh.sharedServiceState(d, Date.now() + 86400000).active.length,
          1
        );
        assert.equal(fresh.sharedServiceBusy(d), true);
        assert.equal(reserveBudget(d, request()).reason, "service_priority");
        const other = dir();
        const owner = execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            "const {beginServicePriority}=await import(process.argv[1]); console.log(beginServicePriority(process.argv[2]));",
            new URL("./service-priority.mjs", import.meta.url).href,
            other,
          ],
          { windowsHide: true, encoding: "utf8" }
        ).trim();
        assert.equal(sharedServiceBusy(other), true);
        assert.equal(
          reserveBudget(other, request()).reason,
          "service_priority"
        );
        endServicePriority(other, owner);
        assert.equal(sharedServiceBusy(other), false);
      }
    );
    await check(
      "missing head, archive and rollback refuse idle rather than resetting history",
      () => {
        for (const mutation of [
          "head",
          "archive",
          "rollback",
          "head-and-archives",
        ]) {
          const d = dir(),
            owner = beginServicePriority(d),
            old = readFileSync(head(d));
          endServicePriority(d, owner);
          if (mutation === "head")
            renameSync(head(d), join(d, "saved-head.json"));
          if (mutation === "archive") {
            const file = readdirSync(d).find((name) =>
              name.startsWith("service-priority-checkpoint-00000002")
            );
            renameSync(join(d, file), join(d, "saved-archive.json"));
          }
          if (mutation === "rollback") writeFileSync(head(d), old);
          if (mutation === "head-and-archives") {
            for (const name of readdirSync(d).filter(
              (name) =>
                name === "service-priority-head.json" ||
                name.startsWith("service-priority-checkpoint-")
            ))
              renameSync(join(d, name), join(d, `saved-${name}`));
          }
          assert.throws(() => sharedServiceBusy(d));
          assert.throws(() => reserveBudget(d, request()));
        }
      }
    );
    await check(
      "paired tail loss and old idle head cannot erase an unreleased owner",
      async () => {
        const d = dir(),
          first = beginServicePriority(d);
        endServicePriority(d, first);
        const idleHead = readFileSync(head(d));
        const live = beginServicePriority(d);
        assert.equal(sharedServiceBusy(d), true);
        const tail = readdirSync(d).find((name) =>
          name.startsWith("service-priority-checkpoint-00000003-")
        );
        renameSync(join(d, tail), join(d, `saved-${tail}`));
        writeFileSync(head(d), idleHead);
        const fresh = await import(
          `./service-priority.mjs?private-paired-loss=${serial}`
        );
        assert.throws(() => fresh.sharedServiceBusy(d), /rollback/);
        assert.throws(() => reserveBudget(d, request()), /rollback/);
        assert.equal(existsSync(join(d, "usage.json")), false);
        assert.throws(() => endServicePriority(d, live), /rollback/);
      }
    );
    await check(
      "pending, missing, changed or restored earlier current anchor cannot be read as idle",
      () => {
        for (const mutation of [
          "pending-before-archive",
          "pending-after-head",
          "missing",
          "old-anchor-and-head",
          "first-head",
          "unknown-status",
        ]) {
          const d = dir(),
            first = beginServicePriority(d);
          endServicePriority(d, first);
          const anchorPath = join(d, "service-priority-initialized.json"),
            oldAnchor = readFileSync(anchorPath),
            oldHead = readFileSync(head(d));
          beginServicePriority(d);
          const anchor = JSON.parse(readFileSync(anchorPath));
          if (mutation.startsWith("pending-")) {
            anchor.status = "pending";
            if (mutation === "pending-before-archive") {
              const tail = readdirSync(d).find((name) =>
                name.startsWith("service-priority-checkpoint-00000003-")
              );
              renameSync(join(d, tail), join(d, `saved-${tail}`));
              writeFileSync(head(d), oldHead);
            }
          }
          if (mutation === "first-head") anchor.firstHead = "0".repeat(64);
          if (mutation === "unknown-status") anchor.status = "idle";
          writeFileSync(anchorPath, JSON.stringify(anchor));
          if (mutation === "missing")
            renameSync(anchorPath, join(d, "saved-anchor.json"));
          if (mutation === "old-anchor-and-head") {
            writeFileSync(anchorPath, oldAnchor);
            writeFileSync(head(d), oldHead);
          }
          assert.throws(() => sharedServiceBusy(d));
          assert.throws(() => reserveBudget(d, request()));
          assert.equal(existsSync(join(d, "usage.json")), false);
        }
      }
    );
    await check(
      "changed archive bytes, forged lifetime transitions and clock reversal are rejected",
      () => {
        for (const mutation of ["bytes", "transition", "clock"]) {
          const d = dir();
          beginServicePriority(d);
          const file = readdirSync(d).find((name) =>
            name.startsWith("service-priority-checkpoint-")
          );
          if (mutation === "clock") {
            assert.throws(() => sharedServiceState(d, 0));
            continue;
          }
          const value = JSON.parse(readFileSync(join(d, file)));
          value.active = [];
          const raw = Buffer.from(JSON.stringify(value) + "\n");
          writeFileSync(join(d, file), raw);
          if (mutation === "transition") {
            const digest = hash(raw);
            renameSync(
              join(d, file),
              join(d, `service-priority-checkpoint-00000001-${digest}.json`)
            );
            writeFileSync(
              head(d),
              JSON.stringify({ schemaVersion: 1, sequence: 1, head: digest })
            );
          }
          assert.throws(() => sharedServiceBusy(d));
        }
      }
    );
    await check(
      "shared service acquisition during storage recheck vetoes generation and retains reservation",
      async () => {
        const d = dir();
        let scans = 0,
          generated = 0;
        const result = await runReservedWindowsJob(
          d,
          job(),
          { serviceBusy: false },
          async () => {
            generated++;
          },
          () => {
            if (++scans === 2) beginServicePriority(d);
          }
        );
        assert.equal(result.reason, "service_priority_before_creation");
        assert.equal(generated, 0);
        assert.equal(budgetStatus(d).active[0].id, result.reservation.id);
      }
    );
    await check(
      "scheduler observes later shared acquisition and yields with full reservation held",
      async () => {
        const d = dir();
        let finished = 0,
          closed = 0;
        const result = await runReservedWindowsJob(
          d,
          job(),
          { serviceBusy: false },
          async (_, callbacks) => {
            assert.equal(callbacks.serviceBusy(), false);
            beginServicePriority(d);
            return runWindowsResourceLoop(
              {
                resourceWatchdog: true,
                async start(busy) {
                  assert.equal(busy, true);
                  return {
                    status: "stopped",
                    decision: { action: "stop", reason: "service_priority" },
                  };
                },
                async finish() {
                  finished++;
                  return { accountingComplete: false };
                },
                async close() {
                  closed++;
                },
              },
              callbacks
            );
          },
          () => {}
        );
        assert.equal(result.execution.reason, "service_priority");
        assert.equal(finished, 1);
        assert.equal(closed, 0);
        assert.equal(budgetStatus(d).active[0].id, result.reservation.id);
      }
    );
    await check(
      "shared acquisition during asynchronous start reaches the final reader and retains the reservation",
      async () => {
        const d = dir();
        let resumed = 0,
          finished = 0;
        const result = await runReservedWindowsJob(
          d,
          job(),
          { serviceBusy: false },
          async (_, callbacks) =>
            runWindowsResourceLoop(
              {
                resourceWatchdog: true,
                async start(initialBusy, finalReader) {
                  assert.equal(initialBusy, false);
                  await Promise.resolve();
                  beginServicePriority(d);
                  if (!finalReader()) resumed++;
                  return {
                    status: "stopped",
                    decision: { action: "stop", reason: "service_priority" },
                  };
                },
                async finish() {
                  finished++;
                  return { accountingComplete: false };
                },
                close: () => assert.fail("valid stop must drain"),
              },
              callbacks
            ),
          () => {}
        );
        assert.equal(resumed, 0);
        assert.equal(finished, 1);
        assert.equal(result.execution.reason, "service_priority");
        assert.equal(budgetStatus(d).active[0].id, result.reservation.id);
        assert.equal(sharedServiceBusy(d), true);
      }
    );
    await check(
      "corrupt shared priority during a scheduler tick closes the owned controller",
      async () => {
        const d = dir();
        let closed = 0;
        await assert.rejects(
          () =>
            runReservedWindowsJob(
              d,
              job(),
              { serviceBusy: false },
              async (_, callbacks) => {
                beginServicePriority(d);
                writeFileSync(head(d), "{}");
                return runWindowsResourceLoop(
                  {
                    resourceWatchdog: true,
                    start: () => assert.fail("untrusted state cannot start"),
                    close: () => {
                      closed++;
                    },
                  },
                  callbacks
                );
              },
              () => {}
            ),
          /reservation retained/
        );
        assert.equal(closed, 1);
        assert.equal(budgetStatus(d).active.length, 1);
      }
    );
    return {
      completed,
      provesProductionService: false,
      provesRuntimeAcceptance: false,
    };
  } finally {
    assert.ok(relative(tmpdir(), root).startsWith("orica-service-priority-"));
    rmSync(root, { recursive: true, force: true });
  }
}
