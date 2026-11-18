import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  symlinkSync,
  unlinkSync,
  statfsSync,
} from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  assertStorageHeadroom,
  measureIsmctsNamespace,
  checkIsmctsStorageAdmission,
} from "./storage-admission.mjs";
import { programPaths } from "./shared.mjs";
import { profile } from "./resources.mjs";
import { policy } from "../artifact-storage.mjs";

export function testStorageAdmission() {
  const root = mkdtempSync(join(tmpdir(), "orica-storage-admission-"));
  const GiB = 1024 ** 3;
  let completed = 0;
  const check = (name, fn) => {
    fn();
    console.log(`ismcts-storage ok ${++completed} - ${name}`);
  };
  const healthy = () => ({ status: "ok", bytes: GiB, freeBytes: 300 * GiB });
  const put = (directory, file, value) => {
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, file), value);
  };
  try {
    check(
      "healthy capacity admits only valid daily output reservations",
      () => {
        assertStorageHeadroom(healthy(), 0, 0);
        assertStorageHeadroom(healthy(), GiB, profile.offline.outputBytes);
        assert.throws(() =>
          assertStorageHeadroom(healthy(), 0, profile.offline.outputBytes + 1)
        );
      }
    );
    check(
      "reserved output is included in namespace, global and free-space limits",
      () => {
        for (const [snapshot, current, output] of [
          [healthy(), 20 * GiB, 0],
          [healthy(), 19 * GiB, GiB],
          [{ ...healthy(), bytes: 149 * GiB }, 0, GiB],
          [{ ...healthy(), bytes: 200 * GiB }, 0, 0],
          [{ ...healthy(), freeBytes: 150 * GiB }, 0, 1],
          [{ ...healthy(), status: "warning" }, 0, 0],
          [{ ...healthy(), status: "blocked" }, 0, 0],
        ])
          assert.throws(
            () => assertStorageHeadroom(snapshot, current, output),
            /ARTIFACT_STORAGE_LIMIT/
          );
        assertStorageHeadroom({ ...healthy(), freeBytes: 150 * GiB }, 0, 0);
        assertStorageHeadroom(healthy(), 20 * GiB - 1, 0);
      }
    );
    check(
      "missing, non-finite, negative and overflowing measurements are refused",
      () => {
        for (const invalid of [
          null,
          undefined,
          NaN,
          Infinity,
          -1,
          0.5,
          Number.MAX_SAFE_INTEGER + 1,
        ]) {
          assert.throws(() => assertStorageHeadroom(healthy(), invalid, 0));
          assert.throws(() => assertStorageHeadroom(healthy(), 0, invalid));
          assert.throws(() =>
            assertStorageHeadroom({ ...healthy(), bytes: invalid }, 0, 0)
          );
          assert.throws(() =>
            assertStorageHeadroom({ ...healthy(), freeBytes: invalid }, 0, 0)
          );
        }
        assert.throws(() => assertStorageHeadroom(null, 0, 0));
        assert.throws(() =>
          assertStorageHeadroom(healthy(), Number.MAX_SAFE_INTEGER, 1)
        );
      }
    );
    check(
      "all registered artifact namespaces and shared history count logical bytes",
      () => {
        const first = join(root, "first"),
          second = join(root, "second"),
          shared = join(root, "shared");
        put(join(first, "artifacts/ismcts/run"), "replay", "12345");
        put(join(second, "artifacts/ismcts"), "model", "678");
        put(shared, "receipt", "9012");
        put(join(first, "artifacts/unrelated"), "preserved", "unrelated");
        assert.equal(
          measureIsmctsNamespace([first, second, first], shared),
          12
        );
        assert.equal(
          existsSync(join(first, "artifacts/unrelated/preserved")),
          true
        );
      }
    );
    check(
      "missing namespaces remain absent without resetting or creating storage",
      () => {
        const absent = join(root, "absent");
        assert.equal(
          measureIsmctsNamespace([absent], join(absent, "shared")),
          0
        );
        assert.equal(existsSync(absent), false);
      }
    );
    check("an expected directory replaced by a file fails closed", () => {
      const malformed = join(root, "malformed");
      put(join(malformed, "artifacts"), "ismcts", "file");
      assert.throws(
        () => measureIsmctsNamespace([malformed], join(root, "missing")),
        /directory/
      );
    });
    check(
      "linked namespace, linked child and dangling junction cannot hide bytes",
      () => {
        const target = join(root, "target"),
          linked = join(root, "linked"),
          namespace = join(linked, "artifacts/ismcts");
        mkdirSync(join(linked, "artifacts"), { recursive: true });
        mkdirSync(target);
        symlinkSync(target, namespace, "junction");
        assert.throws(
          () => measureIsmctsNamespace([linked], join(root, "missing")),
          /symlink|junction/
        );
        unlinkSync(namespace);
        mkdirSync(namespace);
        symlinkSync(target, join(namespace, "child"), "junction");
        assert.throws(
          () => measureIsmctsNamespace([linked], join(root, "missing")),
          /symlink|junction/
        );
        unlinkSync(join(namespace, "child"));
        symlinkSync(
          join(root, "absent-target"),
          join(namespace, "dangling"),
          "junction"
        );
        assert.throws(
          () => measureIsmctsNamespace([linked], join(root, "missing")),
          /symlink|junction/
        );
        unlinkSync(join(namespace, "dangling"));
      }
    );
    check(
      "production storage resolves worktrees, honors host capacity and refuses a broken registry",
      () => {
        const repo = join(root, "repo"),
          lane = join(root, "lane");
        const git = (args) =>
          execFileSync("git", args, {
            cwd: repo,
            stdio: "pipe",
            windowsHide: true,
          });
        mkdirSync(repo);
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
        put(
          join(repo, "autorun-queue"),
          "cluster-registry.json",
          JSON.stringify({ clusters: [] })
        );
        put(join(repo, "artifacts/ismcts"), "checkpoint", "123");
        put(join(lane, "artifacts/ismcts"), "replay", "45");
        const shared = programPaths(lane).shared;
        put(shared, "history.json", "{}");
        assert.equal(measureIsmctsNamespace([repo, lane], shared), 7);
        // This integration fixture uses the real host filesystem. Small CI/dev
        // volumes must exercise the production veto, not assume 150 GiB free.
        const volume = statfsSync(lane);
        const freeBytes = Number(volume.bavail) * Number(volume.bsize);
        if (freeBytes - 32 >= policy.warningFreeGiB * GiB)
          assert.equal(checkIsmctsStorageAdmission(lane, 32), undefined);
        else
          assert.throws(
            () => checkIsmctsStorageAdmission(lane, 32),
            /ARTIFACT_STORAGE_LIMIT/
          );
        writeFileSync(
          join(repo, "autorun-queue/cluster-registry.json"),
          "broken"
        );
        assert.throws(() => checkIsmctsStorageAdmission(lane, 32));
        assert.equal(existsSync(join(shared, "history.json")), true);
      }
    );
    return { completed };
  } finally {
    assert.ok(relative(tmpdir(), root).startsWith("orica-storage-admission-"));
    rmSync(root, { recursive: true, force: true });
  }
}
