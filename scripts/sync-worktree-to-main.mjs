#!/usr/bin/env node
/**
 * lane worktree を local main へ決定論的にキャッチアップさせる（LLM 起動前に wrapper が呼ぶ）。
 *
 * 根治対象:
 *   engine-drain / engine-claude の branch は run 冒頭に main を取り込む責務がある。だが従来は
 *   その取り込みを LLM（worker）にやらせており、生成系共有ファイル（fidelity-baseline.json /
 *   02_detailed-todo.md）の競合解決中に run がクラッシュ（usage limit 等）すると半端な乖離が残り、
 *   以後 auto-merge.ps1 が「main is not an ancestor」で永久 abort していた（2026-06-25、23 連続）。
 *
 * 本スクリプトは LLM とは独立な決定論ステップとして wrapper から呼ばれ、クラッシュ耐性を持つ:
 *   1. fidelity-baseline.json の custom merge driver(oledger) を共有 .git/config に冪等登録。
 *   2. dirty なら自動 stash（新規文脈なので leftover dirty は常に前 run のクラッシュ残骸）。
 *   3. `git merge --no-edit main`。
 *   4. 競合が「生成系 allowlist のみ」なら take-theirs(main) で解決し merge を完了。
 *      allowlist 外（=実コード競合）が残れば merge --abort し exit 3（wrapper が通常作業ではなく
 *      呼出側が診断・回復を判断する）。
 *
 * --preserve-work: dirty・競合・失敗時は変更を保全し、自動解消しない。
 * 終了コード: 0=同期完了 / 3=実コード競合 / 1=ハードエラー。
 * supervisor wrapper は全nonzeroを介入待ちとして報告し、workerを起動しない。
 *
 * usage: node sync-worktree-to-main.mjs --worktree <path> [--branch <name>] [--main main]
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectGitOperation } from "./primary-main.mjs";

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

const worktree = arg("--worktree", null);
const mainRef = arg("--main", "main");
const expectedBranch = arg("--branch", null);
const preserveWork = args.includes("--preserve-work");
if (!worktree) {
  if (isMain) {
    process.stderr.write("[sync-worktree] --worktree は必須\n");
    process.exit(1);
  }
}

// 生成系 / 簿記の共有ファイル。競合したら take-theirs(main) で解決してよい。
//   - fidelity-baseline.json: 通常は oledger driver が解決。driver 未適用(bootstrap)時の保険。
//   - 02_detailed-todo.md: 残量/着地行が churn。main 側を採れば他レーンの板更新を保全でき、
//     自レーンの生成行は次の snapshot --measure が再生成する。
const AUTO_RESOLVE_THEIRS = new Set([
  "fidelity-baseline.json",
  "manual/ai-reference/30_plan/02_detailed-todo.md",
]);

function git(gitArgs, opts = {}) {
  const env = { ...process.env, ...opts.env };
  for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key];
  return spawnSync("git", ["-C", worktree, ...gitArgs], {
    encoding: "utf8",
    ...opts,
    env,
  });
}

function log(msg) {
  process.stderr.write(`[sync-worktree] ${msg}\n`);
}

function requireGit(gitArgs) {
  const result = git(gitArgs);
  if (result.status !== 0) {
    log(
      `git ${gitArgs.join(" ")} 失敗 → 中断: ${String(result.stderr || result.stdout || result.error || result.status).trim()}`
    );
    process.exit(1);
  }
  return result;
}

function finishSync(message) {
  // A successful Git command alone does not establish the dispatch contract:
  // hooks can leave edits behind, and another process can move main meanwhile.
  const operation = inspectGitOperation(worktree);
  if (operation) {
    log(`同期後も Git operation が残る: ${operation}; recovery のため保全`);
    process.exit(1);
  }
  requireGit(["merge-base", "--is-ancestor", mainRef, "HEAD"]);
  const status = requireGit(["status", "--porcelain"]);
  if (status.stdout.trim()) {
    log("同期後の worktree が dirty; recovery のため変更を保全");
    process.exit(1);
  }
  log(message);
  reportCrashRescueStashes();
  process.exit(0);
}

// 未解決のクラッシュ救出 stash を検知し、次回 worker(LLM) へ引き継ぐ。
// 手順2で stash した dirty 残骸は自動では pop/resume されない。放置すると無期限に
// 積もる（2026-07-03 実測: 42件超が無点検のまま蓄積していた）。同期成功時に自ブランチ分の
// 未解決 stash を検知し stdout へ要約を出す（wrapper 側が prompt に注入して worker に
// 明示判断させる）。読み取り専用の git 呼び出しのみで、失敗しても run の成否には影響させない。
export function reportCrashRescueStashes() {
  try {
    const branch = (
      git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout || ""
    ).trim();
    if (!branch) return;
    const list = (git(["stash", "list"]).stdout || "")
      .split(/\r?\n/)
      .filter(Boolean);
    const marker = `On ${branch}: sync-worktree auto-rescue`;
    const mine = list.filter((line) => line.includes(marker));
    if (mine.length === 0) return;
    const topRef = mine[0].split(":")[0].trim();
    const stat = (git(["stash", "show", "--stat", topRef]).stdout || "").trim();
    const age = (
      git(["log", "-1", "--format=%ad", "--date=relative", topRef]).stdout || ""
    ).trim();
    process.stdout.write(
      `CRASH_RESCUE_STASH: 自ブランチ(${branch})の未解決stashが${mine.length}件あります。最新は ${topRef}（${age || "時刻不明"}）:\n` +
        `${stat}\n` +
        `→ このiteration内で明示判断すること: \`git stash show -p ${topRef}\` で中身確認 → 使えるなら pop/apply して活かす、` +
        `使えないなら理由を書いて \`git stash drop ${topRef}\` する。放置して終了しない。\n`
    );
  } catch (e) {
    log(`crash-rescue-stash 検知失敗（無視して続行): ${e.message}`);
  }
}

// --- 1. oledger merge driver を共有 .git/config に冪等登録 ---
// 全 worktree は同一 .git を共有するので 1 度の登録で全レーンに効く。scheduled-task の
// PATH 欠落に備え node / script は絶対パス（forward slash）で渡す（git は sh -c で実行）。
export function ledgerDriverScriptPath(scriptUrl = import.meta.url) {
  return join(
    dirname(fileURLToPath(scriptUrl)),
    "git-merge-ledger.mjs"
  ).replace(/\\/g, "/");
}

if (isMain) {
  // Fail before config/stash/merge if a checkout has been repurposed.
  if (expectedBranch) {
    const current = git(["symbolic-ref", "HEAD"]);
    const expected = expectedBranch.startsWith("refs/heads/")
      ? expectedBranch
      : `refs/heads/${expectedBranch}`;
    if (
      current.status !== 0 ||
      current.stdout.trim() !== expected ||
      expected === "refs/heads/main"
    ) {
      log(
        "worktree branch does not match the expected worker ref; preserving checkout"
      );
      process.exit(1);
    }
    if (mainRef !== "refs/heads/main") {
      log("pinned worker sync requires refs/heads/main");
      process.exit(1);
    }
    const operation = inspectGitOperation(worktree);
    if (operation) {
      log(
        `worker Git operation in progress: ${operation}; preserving checkout`
      );
      process.exit(1);
    }
  }
  const ledgerScript = ledgerDriverScriptPath();
  const nodeExe = process.execPath.replace(/\\/g, "/");
  if (!preserveWork)
    requireGit([
      "config",
      "merge.oledger.name",
      "fidelity-baseline ledger 3-way auto-merge",
    ]);
  if (!preserveWork)
    requireGit([
      "config",
      "merge.oledger.driver",
      `"${nodeExe}" "${ledgerScript}" %O %A %B`,
    ]);

  // --- 2. dirty なら自動 stash（前 run クラッシュ残骸の退避、復元可能）---
  const status = requireGit(["status", "--porcelain"]);
  if ((status.stdout || "").trim().length > 0) {
    if (preserveWork) {
      log("dirty lane preserved; no stash or synchronization");
      process.exit(1);
    }
    log("worktree dirty → 自動 stash（前 run のクラッシュ残骸を退避）");
    const stash = git([
      "stash",
      "push",
      "-u",
      "-m",
      "sync-worktree auto-rescue (pre-merge dirty)",
    ]);
    if ((stash.status ?? 1) !== 0) {
      log(`stash 失敗 → 中断: ${(stash.stderr || stash.stdout || "").trim()}`);
      process.exit(1);
    }
  }

  // --- 3. main を取り込む（ff or merge）---
  const merge = git([
    ...(preserveWork
      ? ["-c", "rerere.enabled=false", "-c", "merge.oledger.driver=false"]
      : []),
    "merge",
    "--no-edit",
    mainRef,
  ]);
  if ((merge.status ?? 1) === 0) {
    finishSync(
      `同期完了（${(merge.stdout || "").trim().split(/\r?\n/)[0] || "up to date"}）`
    );
  }

  // --- 4. 競合解決 ---
  const unmerged = (
    requireGit(["diff", "--name-only", "--diff-filter=U"]).stdout || ""
  )
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (unmerged.length === 0) {
    // A hook, invalid ref, or I/O error can reject a merge without conflicts.
    // Do not retry commit or call this success: preserve the exact failure and
    // any MERGE_HEAD/index for explicit intervention when preserve-work is used.
    log(
      `merge 失敗（未解決競合なし）→ recovery: ${String(merge.stderr || merge.stdout || merge.error || merge.status).trim()}`
    );
    reportCrashRescueStashes();
    process.exit(1);
  }

  if (preserveWork) {
    process.stdout.write(`SYNC_CONFLICT_FILES: ${unmerged.join(", ")}\n`);
    log("conflict preserved; do not resolve or overwrite other work");
    process.exit(3);
  }
  const outside = unmerged.filter((f) => !AUTO_RESOLVE_THEIRS.has(f));
  if (outside.length > 0) {
    const conflictSummary = outside.join(", ");
    log(
      `実コード競合あり → merge abort、wrapper で sync-recovery: ${conflictSummary}`
    );
    process.stdout.write(`SYNC_CONFLICT_FILES: ${conflictSummary}\n`);
    requireGit(["merge", "--abort"]);
    process.exit(3);
  }

  // allowlist のみ → take-theirs(main) で決定論解決。
  for (const f of unmerged) {
    requireGit(["checkout", "--theirs", "--", f]);
    requireGit(["add", "--", f]);
    log(`auto-resolve take-theirs: ${f}`);
  }
  const commit = git(["commit", "--no-edit"]);
  if ((commit.status ?? 1) !== 0) {
    log(
      `merge commit 失敗 → abort: ${(commit.stderr || commit.stdout || "").trim()}`
    );
    requireGit(["merge", "--abort"]);
    process.exit(1);
  }
  finishSync("同期完了（生成系 allowlist を take-theirs で自動解決）");
}
