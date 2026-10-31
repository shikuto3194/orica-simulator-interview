import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  unlinkSync,
  statfsSync,
} from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { reserveBudget, budgetStatus, finishBudget } from "./budget.mjs";
import { transaction, hash, programPaths } from "./shared.mjs";
import { policy } from "../artifact-storage.mjs";
import {
  writeManagedArtifact,
  writeReservedArtifact,
  maximumManagedPayloadBytes,
  assertManagedPayloadSize,
} from "./managed-output.mjs";

export function testManagedOutput() {
  const root = mkdtempSync(join(tmpdir(), "orica-managed-output-"));
  const clock = Date.parse("2026-10-10T10:00:00+09:00");
  let completed = 0,
    serial = 0;
  const check = (name, fn) => {
    fn();
    console.log(`ismcts-output ok ${++completed} - ${name}`);
  };
  const fixture = (outputBytes = 10, wallMs = 10000) => {
    const dir = join(root, String(++serial));
    const r = reserveBudget(
      dir,
      { wallMs, owner: "fixture-owner", outputBytes },
      clock
    );
    const started = performance.now();
    // Match the runtime's advancing clock. Reusing clock+100 after preparation
    // has advanced a persisted checkpoint is a genuine reversal, not a retry.
    const write = (
      name,
      bytes,
      admit = () => {},
      at = clock + 100 + Math.ceil(performance.now() - started)
    ) =>
      writeReservedArtifact(
        dir,
        r.id,
        r.owner,
        name,
        Buffer.from(bytes),
        admit,
        at
      );
    return {
      dir,
      r,
      write,
      active: () => budgetStatus(dir, clock + wallMs + 100).active[0],
    };
  };
  const finish = (f, outputBytes) =>
    finishBudget(
      f.dir,
      f.r.id,
      f.r.owner,
      {
        status: "completed",
        treeExited: true,
        accountingComplete: true,
        usage: {
          wallMs: 1000,
          cpuMs: 1000,
          gpuMs: 0,
          monitorMs: 0,
          outputBytes,
        },
      },
      clock + 1000
    );
  try {
    check(
      "exact persisted allowance spans multiple files and later writer instances",
      () => {
        const f = fixture();
        const first = f.write("first", "123456");
        assert.equal(first.sha256, hash(Buffer.from("123456")));
        assert.equal(first.byteLength, 6);
        assert.deepEqual(readFileSync(first.path), Buffer.from("123456"));
        f.write("second", "7890");
        assert.equal(f.active().claimedOutputBytes, 10);
        assert.throws(() => f.write("third", "!"), /allowance/);
        assert.equal(
          existsSync(
            join(f.dir, "managed-output", f.r.id, "artifact-third.bin")
          ),
          false
        );
        assert.equal(budgetStatus(f.dir, clock + 11000).used.outputBytes, 10);
      }
    );
    check("storage refusal keeps its claim and creates no payload file", () => {
      const f = fixture(6);
      assert.throws(
        () =>
          f.write("blocked", "1234", () => {
            throw new Error("ARTIFACT_STORAGE_LIMIT");
          }),
        /ARTIFACT_STORAGE_LIMIT/
      );
      assert.equal(f.active().claimedOutputBytes, 4);
      assert.equal(existsSync(join(f.dir, "managed-output")), false);
      assert.throws(() => f.write("retry", "123"), /allowance/);
      f.write("remaining", "12");
      assert.equal(f.active().claimedOutputBytes, 6);
    });
    check(
      "exclusive creation preserves the old artifact and failed claim",
      () => {
        const f = fixture(8),
          first = f.write("same", "1234");
        assert.throws(() => f.write("same", "5678"), /EEXIST/);
        assert.equal(readFileSync(first.path, "utf8"), "1234");
        assert.equal(f.active().claimedOutputBytes, 8);
        assert.throws(() => f.write("new", "!"), /allowance/);
      }
    );
    check(
      "caller bytes are copied before admission and callback results fail closed",
      () => {
        const f = fixture(),
          input = Buffer.from("old");
        const result = writeReservedArtifact(
          f.dir,
          f.r.id,
          f.r.owner,
          "snapshot",
          input,
          () => {
            input.fill(120);
          },
          clock + 100
        );
        assert.equal(readFileSync(result.path, "utf8"), "old");
        assert.equal(result.sha256, hash(Buffer.from("old")));
        assert.throws(
          () => f.write("promise", "x", () => Promise.resolve()),
          /admission result/
        );
        assert.equal(
          existsSync(
            join(f.dir, "managed-output", f.r.id, "artifact-promise.bin")
          ),
          false
        );
        assert.equal(f.active().claimedOutputBytes, 4);
      }
    );
    check(
      "foreign owner, finished reservation and expired deadline cannot write",
      () => {
        const f = fixture();
        assert.throws(
          () =>
            writeReservedArtifact(
              f.dir,
              f.r.id,
              "other",
              "foreign",
              Buffer.from("x"),
              () => {},
              clock + 100
            ),
          /ownership/
        );
        assert.throws(
          () => f.write("late", "x", () => {}, clock + 10000),
          /deadline/
        );
        assert.equal(f.active().claimedOutputBytes, undefined);
        finish(f, 0);
        assert.throws(
          () => f.write("finished", "x", () => {}, clock + 1200),
          /ownership/
        );
      }
    );
    check(
      "capacity delay consumes deadline after checkpoint but before opening file",
      () => {
        const f = fixture(10, 300);
        assert.throws(
          () =>
            f.write(
              "late",
              "123",
              () => {
                Atomics.wait(
                  new Int32Array(new SharedArrayBuffer(4)),
                  0,
                  0,
                  350
                );
              },
              clock + 10
            ),
          /deadline/
        );
        assert.equal(f.active().claimedOutputBytes, 3);
        assert.equal(existsSync(join(f.dir, "managed-output")), false);
      }
    );
    check(
      "malformed names, zero and oversize payloads fail before changing ledger",
      () => {
        const f = fixture();
        const before = readFileSync(join(f.dir, "usage.json"));
        for (const name of [
          "../escape",
          "a/b",
          "a\\b",
          "a:b",
          "tail.",
          "Upper",
          "",
          "x".repeat(81),
        ])
          assert.throws(() => f.write(name, "x"), /invalid/);
        assert.throws(() => f.write("empty", ""), /invalid/);
        assert.throws(
          () =>
            writeReservedArtifact(
              f.dir,
              f.r.id,
              f.r.owner,
              "text",
              "x",
              () => {},
              clock + 100
            ),
          /invalid/
        );
        for (const size of [
          0,
          -1,
          NaN,
          Infinity,
          0.5,
          maximumManagedPayloadBytes + 1,
        ])
          assert.throws(() => assertManagedPayloadSize(size), /invalid/);
        assertManagedPayloadSize(maximumManagedPayloadBytes);
        assert.deepEqual(readFileSync(join(f.dir, "usage.json")), before);
      }
    );
    check(
      "forged Buffer properties cannot change copied bytes or allocation size",
      () => {
        const f = fixture(),
          input = Buffer.from("abc");
        for (const key of ["length", "byteLength", "byteOffset", "buffer"])
          Object.defineProperty(input, key, {
            get() {
              throw new Error("untrusted Buffer property");
            },
          });
        const out = writeReservedArtifact(
          f.dir,
          f.r.id,
          f.r.owner,
          "intrinsic",
          input,
          () => {},
          clock + 100
        );
        assert.equal(readFileSync(out.path, "utf8"), "abc");
        assert.equal(f.active().claimedOutputBytes, 3);
      }
    );
    check(
      "junction path is rejected and Windows device-like names remain ordinary prefixed files",
      () => {
        const f = fixture();
        const target = join(root, "link-target");
        mkdirSync(target);
        const output = join(f.dir, "managed-output");
        symlinkSync(target, output, "junction");
        assert.throws(() => f.write("linked", "x"), /symlink|junction/);
        assert.equal(f.active().claimedOutputBytes, undefined);
        unlinkSync(output);
        const file = f.write("con", "x").path;
        assert.equal(readFileSync(file, "utf8"), "x");
      }
    );
    check(
      "shared lock prevents reentrant writer and budget completion during I/O",
      () => {
        const f = fixture();
        f.write("outer", "123", () => {
          assert.throws(() => f.write("inner", "x"), /EEXIST/);
          assert.throws(() => finish(f, 0), /EEXIST/);
        });
        assert.equal(f.active().claimedOutputBytes, 3);
        transaction(f.dir, () =>
          assert.throws(() => f.write("locked", "x"), /EEXIST/)
        );
      }
    );
    check(
      "partial write failure preserves bytes and quota with no success refund",
      () => {
        const f = fixture(),
          file = join(f.dir, "managed-output", f.r.id, "artifact-partial.bin");
        const original = fs.writeFileSync;
        try {
          fs.writeFileSync = (fd, data, ...args) => {
            if (typeof fd === "number" && Buffer.isBuffer(data)) {
              original(fd, data.subarray(0, 3), ...args);
              throw new Error("fixture I/O failure");
            }
            return original(fd, data, ...args);
          };
          syncBuiltinESMExports();
          assert.throws(() => f.write("partial", "123456"), /I\/O failure/);
        } finally {
          fs.writeFileSync = original;
          syncBuiltinESMExports();
        }
        assert.equal(readFileSync(file, "utf8"), "123");
        assert.equal(f.active().claimedOutputBytes, 6);
        assert.throws(() => finish(f, 3), /resource usage/);
        assert.equal(f.active().status, "active");
        assert.equal(budgetStatus(f.dir, clock + 1200).used.outputBytes, 10);
        assert.equal(
          reserveBudget(f.dir, { wallMs: 1000, owner: "retry" }, clock + 1200)
            .status,
          "deferred_load"
        );
        // A separate fully written fixture can settle its actual six bytes;
        // don't turn the partial file's three bytes into a fabricated measurement.
        const full = fixture();
        full.write("complete", "123456");
        finish(full, 6);
        assert.equal(budgetStatus(full.dir, clock + 1200).used.outputBytes, 6);
      }
    );
    check(
      "claim checkpoint rollback and null counters cannot reset usage",
      () => {
        const f = fixture(),
          ledger = join(f.dir, "usage.json"),
          old = readFileSync(ledger);
        f.write("first", "123");
        const current = readFileSync(ledger);
        writeFileSync(ledger, old);
        assert.throws(() => f.active(), /checkpoint/);
        writeFileSync(ledger, current);
        const bad = JSON.parse(current);
        bad.reservations[0].claimedOutputBytes = null;
        writeFileSync(ledger, JSON.stringify(bad));
        assert.throws(() => f.active(), /claim/);
        writeFileSync(ledger, current);
        assert.equal(f.active().claimedOutputBytes, 3);
      }
    );
    check(
      "new checkpoint sequence cannot lower claims, change owner or pass deadline",
      () => {
        for (const mutation of [
          (ledger) => {
            ledger.reservations[0].claimedOutputBytes = 1;
          },
          (ledger) => {
            ledger.reservations[0].claimedOutputBytes = 4;
            ledger.reservations[0].owner = "changed";
          },
          (ledger) => {
            ledger.reservations[0].claimedOutputBytes = 4;
            ledger.lastClock = clock + 10000;
          },
        ]) {
          const f = fixture();
          f.write("first", "123");
          const ledger = JSON.parse(readFileSync(join(f.dir, "usage.json"))),
            marker = JSON.parse(
              readFileSync(join(f.dir, "budget-initialized.json"))
            );
          mutation(ledger);
          const bytes = JSON.stringify(ledger, null, 2) + "\n",
            targetHash = hash(bytes),
            sequence = marker.sequence + 1;
          const path = `budget-checkpoint-${String(sequence).padStart(16, "0")}-${targetHash}.json`;
          writeFileSync(join(f.dir, path), bytes);
          writeFileSync(join(f.dir, "usage.json"), bytes);
          writeFileSync(
            join(f.dir, "budget-initialized.json"),
            JSON.stringify({
              ...marker,
              sequence,
              path,
              targetHash,
              writtenAt: ledger.lastClock,
            })
          );
          assert.throws(() => f.active(), /output claim changed history/);
        }
      }
    );
    check(
      "public writer resolves registered worktrees into one shared quota and real storage policy",
      () => {
        const repo = join(root, "repo"),
          lane = join(root, "lane");
        mkdirSync(repo);
        const git = (args) =>
          execFileSync("git", args, {
            cwd: repo,
            stdio: "pipe",
            windowsHide: true,
          });
        git(["init", "-b", "main"]);
        git([
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          "commit",
          "--allow-empty",
          "-m",
          "fixture",
        ]);
        git(["worktree", "add", "-b", "lane", lane]);
        mkdirSync(join(repo, "autorun-queue"));
        writeFileSync(
          join(repo, "autorun-queue/cluster-registry.json"),
          JSON.stringify({ clusters: [] })
        );
        const shared = programPaths(lane).shared;
        assert.equal(programPaths(repo).shared, shared);
        const r = reserveBudget(shared, {
          wallMs: 60000,
          owner: "public-fixture",
          outputBytes: 5,
        });
        const volume = statfsSync(lane);
        const freeBytes = Number(volume.bavail) * Number(volume.bsize);
        if (freeBytes - 5 >= policy.warningFreeGiB * 1024 ** 3) {
          const out = writeManagedArtifact(
            lane,
            r.id,
            r.owner,
            "lane",
            Buffer.from("123")
          );
          assert.equal(readFileSync(out.path, "utf8"), "123");
          assert.ok(out.path.startsWith(join(shared, "managed-output")));
          writeManagedArtifact(repo, r.id, r.owner, "main", Buffer.from("45"));
        } else {
          // Production capacity vetoes retain the shared claim and write no payload.
          for (const [worktree, name, bytes] of [
            [lane, "lane", "123"],
            [repo, "main", "45"],
          ]) {
            assert.throws(
              () =>
                writeManagedArtifact(
                  worktree,
                  r.id,
                  r.owner,
                  name,
                  Buffer.from(bytes)
                ),
              /ARTIFACT_STORAGE_LIMIT/
            );
            assert.equal(
              existsSync(
                join(shared, "managed-output", r.id, `artifact-${name}.bin`)
              ),
              false
            );
          }
        }
        assert.throws(
          () =>
            writeManagedArtifact(
              lane,
              r.id,
              r.owner,
              "overflow",
              Buffer.from("6")
            ),
          /allowance/
        );
        assert.equal(budgetStatus(shared).active[0].claimedOutputBytes, 5);
      }
    );
    return { completed, provesRuntimeAcceptance: false };
  } finally {
    assert.ok(relative(tmpdir(), root).startsWith("orica-managed-output-"));
    rmSync(root, { recursive: true, force: true });
  }
}
