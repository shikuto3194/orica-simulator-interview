import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { prepareRelease } from "../../../deploy/local-pc/update-api.mjs";
import { inspectStorage, policy } from "../../../scripts/artifact-storage.mjs";

function fixture(failBuild: boolean) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orica-api-build-")));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const path of [
    "apps/playground-web/server/fixture.txt",
    "apps/playground-web/shared/fixture.txt",
    "apps/playground-web/src/fixture.txt",
    "packages/rules-core/fixture.txt",
    "packages/card-data/fixture.txt",
    "package.json",
    "tsconfig.base.json",
  ])
    put(path, "{}");
  put("pnpm-lock.yaml", "fixture-lock\n");
  put(
    "scripts/build-api.mjs",
    `import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
writeFileSync("build-ready", "ready");
for (let tick = 0; !existsSync("continue-build"); tick++) {
  if (tick > 600) throw new Error("build fixture was not released");
  await setTimeout(25);
}
if (${failBuild}) throw new Error("fixture build failed");
mkdirSync("dist/api", { recursive: true });
writeFileSync("dist/api/server.mjs", "// isolated release fixture\\n");
`
  );
  put(
    "scripts/check-api-build.mjs",
    `import { readFileSync } from "node:fs";
import { resolve } from "node:path";
if (!readFileSync(resolve(process.argv[2], "server.mjs"), "utf8").includes("isolated release fixture"))
  throw new Error("invalid fixture output");
`
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
  git("init", "--quiet");
  // The runtime intentionally compares lockfile bytes. Match the archive and
  // installed lock on Windows too, regardless of the user's Git defaults.
  git("config", "core.autocrlf", "false");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "core.hooksPath=.no-hooks",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--quiet",
    "-m",
    "fixture"
  );
  const revision = git("rev-parse", "HEAD");
  put("node_modules/.pnpm/lock.yaml", "fixture-lock\n");
  put("node_modules/sentinel.txt", "shared root dependencies");
  put(
    "apps/playground-web/node_modules/sentinel.txt",
    "shared app dependencies"
  );
  put("apps/playground-web/.env", "fixture checkout stays untouched");
  put("autorun-queue/cluster-registry.json", '{"clusters":[]}');
  const previous = "b".repeat(40);
  put(`artifacts/pc-api/releases/${previous}/server.mjs`, "previous release");
  put("artifacts/pc-api/current.json", JSON.stringify({ revision: previous }));
  return { root, revision, previous, put };
}

describe("PC API build and artifact storage", () => {
  for (const failBuild of [false, true]) {
    it(
      failBuild
        ? "measures storage during a failed real build and preserves dependencies and the previous release"
        : "measures storage during a real build and publishes only the immutable release",
      async () => {
        const { root, revision, previous } = fixture(failBuild);
        const stage = join(root, ".codex-temp/pc-api-build", revision);
        const directory = join(root, "artifacts/pc-api/releases", revision);
        // Capture rejection immediately while the child is paused for inspection.
        const preparation = prepareRelease(root, revision).then(
          (release: { revision: string; directory: string }) => ({ release }),
          (error: Error) => ({ error })
        );
        try {
          await vi.waitFor(
            () => expect(existsSync(join(stage, "build-ready"))).toBe(true),
            { timeout: 10_000, interval: 25 }
          );
          for (const path of [
            "node_modules",
            "apps/playground-web/node_modules",
          ])
            expect(lstatSync(join(stage, path)).isSymbolicLink()).toBe(true);
          expect(existsSync(join(root, "artifacts/pc-api/build"))).toBe(false);
          const context = { hub: root, roots: [root], policy };
          // Test that live build links cannot break measurement. Free-space
          // admission belongs to the host's storage:check, not this fixture.
          expect(inspectStorage(context).logicalBytes).toBeGreaterThan(0);
          writeFileSync(join(stage, "continue-build"), "continue");
          const result = await preparation;
          if (failBuild) {
            expect("error" in result && result.error.message).toContain(
              "fixture build failed"
            );
            expect(existsSync(directory)).toBe(false);
          } else {
            expect(result).toEqual({ release: { revision, directory } });
            expect(
              JSON.parse(readFileSync(join(directory, "release.json"), "utf8"))
            ).toEqual({ revision });
            expect(
              readFileSync(join(directory, "server.mjs"), "utf8")
            ).toContain("isolated release fixture");
            expect(existsSync(join(directory, "node_modules"))).toBe(false);
            // An already-built revision is reused without another staging tree.
            expect(await prepareRelease(root, revision)).toEqual({
              revision,
              directory,
            });
          }
          expect(existsSync(stage)).toBe(false);
          expect(inspectStorage(context).logicalBytes).toBeGreaterThan(0);
          expect(
            readFileSync(join(root, "node_modules/sentinel.txt"), "utf8")
          ).toBe("shared root dependencies");
          expect(
            readFileSync(
              join(root, "apps/playground-web/node_modules/sentinel.txt"),
              "utf8"
            )
          ).toBe("shared app dependencies");
          expect(
            readFileSync(join(root, "apps/playground-web/.env"), "utf8")
          ).toBe("fixture checkout stays untouched");
          expect(
            readFileSync(
              join(root, "artifacts/pc-api/releases", previous, "server.mjs"),
              "utf8"
            )
          ).toBe("previous release");
          expect(
            JSON.parse(
              readFileSync(join(root, "artifacts/pc-api/current.json"), "utf8")
            )
          ).toEqual({ revision: previous });
        } finally {
          if (existsSync(stage))
            writeFileSync(join(stage, "continue-build"), "continue");
          await preparation;
          // root is a real, private OS-temp fixture; rm does not follow its links.
          rmSync(root, { recursive: true, force: true });
        }
      },
      30_000
    );
  }

  it("rejects a linked staging parent before deleting or writing outside the checkout", async () => {
    const { root, revision, put } = fixture(false);
    const outside = realpathSync(
      mkdtempSync(join(tmpdir(), "orica-build-outside-"))
    );
    try {
      const sentinel = join(outside, "pc-api-build", revision, "keep.txt");
      mkdirSync(dirname(sentinel), { recursive: true });
      writeFileSync(sentinel, "outside build must survive");
      symlinkSync(
        outside,
        join(root, ".codex-temp"),
        process.platform === "win32" ? "junction" : "dir"
      );
      await expect(prepareRelease(root, revision)).rejects.toThrow(
        "Linked build path"
      );
      expect(readFileSync(sentinel, "utf8")).toBe("outside build must survive");
      put("node_modules/after.txt", "checkout still writable");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
