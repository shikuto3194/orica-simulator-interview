import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  documentLinks,
  frozenDocument,
  inspectDocumentLinks,
} from "./doc-links.mjs";
import {
  checkoutEnvironment,
  inspectCheckoutContext,
} from "./harness/checkout-context.mjs";

export async function testDocLinks() {
  const root = mkdtempSync(join(tmpdir(), "orica-doc-links-"));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      env: checkoutEnvironment(),
      encoding: "utf8",
      stdio: "pipe",
      windowsHide: true,
    });
  const put = (path, text = "content\n") =>
    writeFileSync(join(root, path), text);
  try {
    git("init", "-b", "main");
    git("config", "user.name", "docs test");
    git("config", "user.email", "docs@example.invalid");
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "manual"));
    put("src/live.ts");
    put("src/deleted.ts");
    put("manual/file (1).md");
    put("manual/details.md");
    put("README.md", "# fixture\n");
    git("add", ".");
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "fixture");
    unlinkSync(join(root, "src/deleted.ts"));
    git("add", "-u");
    put(".gitignore", "artifacts/\nsrc/deleted.ts\n");
    const inspect = (content, rel = "manual/details.md") =>
      inspectDocumentLinks(root, [{ rel, content }]);
    const good = [
      "[source](../src/live.ts)",
      "[root](/src/live.ts#L1)",
      "[directory](../src/)",
      '[space](<file (1).md> "title")',
      "[encoded](file%20%281%29.md)",
      "[title](details.md 'title')",
      "[query](details.md?raw=1#arbitrary-fragment)",
      "[external](https://example.invalid/no-network)",
      "[anchor](#not-checked)",
      "[generated](../artifacts/not-created.json)",
      "![image](not-an-image.png)",
      '[label][ref]\n\n[ref]: ../src/live.ts "title"',
      "[short]\n\n[short]: details.md",
      "[same][]\n\n[same]: details.md",
      "`[literal](missing.ts)`",
      "`first\n[x](missing.ts)\nlast`",
      "> ```md\n> [x](missing.ts)\n> ```",
      "~~~md\n[example](missing.ts)\n~~~",
      "````md\n```\n[example](missing.ts)\n```\n````",
      "<!-- [comment](missing.ts) -->",
      "\\[escaped](missing.ts)",
    ];
    for (const source of good)
      assert.equal((await inspect(source)).violations.size, 0, source);
    for (const source of [
      "[bad](../src/missing.ts)",
      "[bad](missing.md)",
      "[bad](/src/deleted.ts)",
      "[bad](../../../outside.md)",
      "[bad](%zz.md)",
      '[bad](<missing file.ts> "title")',
      "[bad][ref]\n\n[ref]: missing.ts",
    ]) {
      assert.equal((await inspect(source)).violations.size, 1, source);
    }
    const ignored = await inspect(
      "[generated](../artifacts/missing.md) [deleted](../src/deleted.ts)"
    );
    assert.deepEqual(ignored.ignoredTargets, ["artifacts/missing.md"]);
    assert.match(ignored.violations.get("manual/details.md")[0], /deleted\.ts/);
    assert.equal(
      (await documentLinks("[balanced](path(1).ts) [escaped](path\\(2\\).ts)"))
        .length,
      2
    );
    assert.equal(
      (await documentLinks("~~~\n[x](bad.ts)\n~~~\n[x](good.ts)"))[0].line,
      4
    );
    for (const path of [
      "manual/ai-reference/20_design/archive/old.md",
      "manual/_legacy/old.md",
      "issues/archive/P1/index.md",
      "issues/P1/history-2026-01.md",
    ]) {
      assert.equal(frozenDocument(path), true, path);
      assert.equal(
        (await inspect("[old](missing.ts)", path)).violations.size,
        0
      );
    }
    const gitFailure = () => {
      throw Object.assign(new Error("Git unavailable"), { status: 128 });
    };
    await assert.rejects(
      inspectDocumentLinks(root, [], gitFailure),
      /Git unavailable/
    );
    await assert.rejects(
      inspectDocumentLinks(
        root,
        [{ rel: "README.md", content: "[bad](artifacts/missing.ts)" }],
        (_cmd, args) =>
          ["ls-files", "ls-tree"].includes(args[0])
            ? "README.md\0"
            : gitFailure()
      ),
      /Git unavailable/
    );
    assert.equal(
      (await documentLinks(String.raw`\\[x](missing.ts)`))[0].target,
      "missing.ts"
    );
    assert.equal(
      (await documentLinks("[x](file(a(b)).ts)"))[0].target,
      "file(a(b)).ts"
    );
    assert.equal(
      (await documentLinks("[a [nested] label](missing.ts)"))[0].target,
      "missing.ts"
    );
    git("add", ".gitignore");
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "delete and ignore");
    assert.equal(
      (await inspect("[deleted](../src/deleted.ts)")).violations.size,
      1,
      "committed deletion cannot be hidden by ignore"
    );
    for (const source of [
      "A lone ` marker.\n\n[bad](missing.ts)\n\nAnother ` marker.",
      "\\` [bad](missing.ts) \\`",
      "> ```md\n> sample\n\n[bad](missing.ts)",
    ])
      assert.equal((await documentLinks(source)).length, 1, source);
    assert.equal((await documentLinks("    [code](missing.ts)")).length, 0);
    assert.equal(
      (await documentLinks("![image][ref]\n\n[ref]: missing.png")).length,
      0
    );
    assert.equal((await documentLinks("[unused]: missing.ts")).length, 0);
    assert.equal((await documentLinks("[x](a&amp;b.ts)"))[0].target, "a&b.ts");
    assert.equal((await documentLinks("[unknown][none]")).length, 0);
    assert.equal(
      (await documentLinks("[x][ref]\n\n[ref]: first.ts\n[ref]: second.ts"))[0]
        .target,
      "first.ts"
    );
    const oldDir = process.env.GIT_DIR;
    process.env.GIT_DIR = join(root, "foreign-do-not-use");
    try {
      assert.equal(
        (await inspect("[source](../src/live.ts)")).violations.size,
        0
      );
      const context = inspectCheckoutContext(root);
      assert.equal(context.branch, "main");
      assert.match(context.head, /^[a-f0-9]{40}$/);
      assert.equal(context.ahead, null);
      assert.match(context.issues.join(" "), /no upstream/);
    } finally {
      if (oldDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = oldDir;
    }
    git("branch", "upstream");
    git("branch", "--set-upstream-to=upstream", "main");
    assert.equal(inspectCheckoutContext(root).behind, 0);
    git("switch", "upstream");
    put("ahead.txt");
    git("add", "ahead.txt");
    git("-c", "core.hooksPath=/dev/null", "commit", "-m", "advance local ref");
    git("switch", "main");
    const behind = inspectCheckoutContext(root);
    assert.equal(behind.behind, 1);
    assert.match(behind.issues.join(" "), /docs may differ/);
    git("switch", "--detach");
    assert.match(inspectCheckoutContext(root).issues.join(" "), /detached/);
    assert.match(
      inspectCheckoutContext(root, gitFailure).issues.join(" "),
      /unavailable/
    );
    console.log("doc links / checkout context regression passed");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await testDocLinks();
