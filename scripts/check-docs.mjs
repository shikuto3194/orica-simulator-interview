#!/usr/bin/env node
/**
 * docs:lint — Markdown documentation size / shape checker.
 *
 * Verifies that documentation files stay within the size budgets defined in
 * CLAUDE.md "ドキュメント管理" section, and that entry-point files do not
 * accumulate completion logs / implementation details (regex blacklist).
 *
 * Categories and thresholds (Phase 8 反映後):
 *   entry      ≤ 11 KB / 160 lines / 300 chars per line
 *   issue      ≤ 12 KB / 180 lines / 500 chars per line  (parent: top-level or <ID>/index.md)
 *   issue-sub  ≤ 20 KB / 250 lines / 500 chars per line  (<ID>/<sub>.md)
 *   reference  ≤ 18 KB / 250 lines / 500 chars per line  (size 主基準)
 *   history    ≤ 32 KB / 500 lines / 800 chars per line
 *   archive    ≤ 40 KB / 700 lines / 1000 chars per line  (warn のみ)
 *
 * 閾値は dry-run + 9 件個別判断を経て決定 (2026-05-01)。reference は「1 概念ファイル」
 * を 220-250 行で書く実態を尊重し、size を主基準に。entry は逃がし先分離より「11KB 内」
 * を選択 (毎セッション読まれる内容を分散させると AI 認知コストが増えるため)。
 *
 * 検出機能:
 *   - サイズ / 行数 / 1 行文字数違反 (entry / issue / issue-sub / reference / history は fail、archive は warn)
 *   - entry の禁止パターン (実装詳細・完了ログの混入を fail で阻止)
 *   - 02_detailed-todo.md の Current Snapshot 12 行 / 2KB、Active Board 20 行
 *   - broken-link: 現役文書のrepo内ファイル/ディレクトリ参照 (fragment/外部URL/凍結履歴は対象外)
 *   - issue staleness: active issue のうち最終コミット日が STALE_DAYS (28 日) 以上前のものを warn
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import verificationState from "./harness/verification-state.cjs";
import { inspectDocumentLinks, frozenDocument } from "./doc-links.mjs";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  ".codex-temp",
  ".codex-remote-attachments",
  "dist",
  "build",
  ".turbo",
  ".vite",
  "coverage",
  "playwright-report",
  "test-results",
  "debug-screenshots",
  "artifacts",
  "logs",
  "tmp",
  "external-qa",
  "external-qa-official",
]);

const RULE_DESCRIPTION_HINT =
  /(追記しない|記載しない|書かない|含めない|蓄積しない|混入しない|転記しない|残さない|禁止|正源は|スコープ外|別ファイル|履歴は|完了履歴は|サブファイル|含まれない)/;

const ENTRY_FILES = new Set([
  "README.md",
  "CLAUDE.md",
  "AGENTS.md",
  "manual/README.md",
  "manual/ai-reference/README.md",
  "manual/ai-reference/30_plan/02_detailed-todo.md",
  "manual/ai-reference/30_plan/03_completed-milestones.md",
  "issues/00_index.md",
]);

const EXCLUDE_FILES = new Set(["manual/deep-research-report.md"]);

const EXCLUDE_GLOB_RES = [/\/archive\/2026-04-25-extracted-from-[^/]+\.md$/];

const THRESHOLDS = {
  entry: { bytes: 11_000, lines: 160, lineChars: 300 },
  issue: { bytes: 12_000, lines: 180, lineChars: 500 },
  "issue-sub": { bytes: 20_000, lines: 250, lineChars: 500 },
  reference: { bytes: 18_000, lines: 250, lineChars: 500 },
  history: { bytes: 32_000, lines: 500, lineChars: 800 },
  archive: { bytes: 40_000, lines: 700, lineChars: 1_000 },
};

const FAILING_KINDS = new Set([
  "entry",
  "issue",
  "issue-sub",
  "reference",
  "history",
]);

const STALE_DAYS = 28;

// 予防的 split 警告: kind 別閾値の 90% に到達したら warn する (archive 除く)。
// 上限超過は checkFile() が fail として検出するので、ここでは「上限未満かつ 90% 以上」のみを対象。
const NEAR_LIMIT_RATIO = 0.9;

const ENTRY_FORBIDDEN_REGEXES = [
  /実装詳細/,
  /主要変更/,
  /設計判断/,
  /Playwright\s*(GUI\s*)?検証/,
  /tsc\s+--noEmit\s+通過/,
  /\d+\s*tests?\s*全通過/i,
  /テスト\s*\d+\s*件追加/,
  /(?:実装|対応|移行|統合|修正)完了(?:\s*\(20\d{2}-\d{2}-\d{2}\))?/,
  /Phase\s*[A-Za-z0-9\-+?.〜]+?\s*(?:完了|対応完了)/,
  /\s\/\s20\d{2}-\d{2}-\d{2}\s*\(/,
];

function toPosix(p) {
  return p.split(sep).join("/");
}

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      yield full;
    }
  }
}

export function classify(relPosix) {
  if (EXCLUDE_FILES.has(relPosix)) return null;
  for (const re of EXCLUDE_GLOB_RES) {
    if (re.test("/" + relPosix)) return null;
  }
  if (ENTRY_FILES.has(relPosix)) return "entry";

  // archive (most specific path-based rule)
  if (
    relPosix.startsWith("issues/archive/") ||
    relPosix.includes("/30_plan/archive/")
  ) {
    return "archive";
  }
  if (/(?:^|\/)README\.md$/.test(relPosix)) return "entry";

  // history (filename-based)
  const base = relPosix.split("/").pop() ?? "";
  if (
    /^03_completed-milestones-phase-.+\.md$/.test(base) ||
    /^history-.+\.md$/.test(base)
  ) {
    return "history";
  }

  // issue (issues/*.md and issues/*/*.md, except 00_index and stubs)
  if (relPosix.startsWith("issues/")) {
    if (relPosix === "issues/00_index.md") return "entry";
    // Stubs: top-level files that are now redirected to subdirectories.
    // We detect stubs heuristically by file content (≤ 30 lines and contains
    // "移行済み" or "archive へ移動" marker). Done in checkFile.
    const parts = relPosix.split("/");
    if (parts.length === 2) return "issue"; // issues/<name>.md (top-level parent)
    if (parts.length >= 3 && parts[2] !== "index.md") return "issue-sub";
    return "issue"; // issues/<id>/index.md (parent)
  }

  // reference: manual/ai-reference/{00_meta,10_rules,20_design,25_gui,28_policy}/**/*.md
  if (
    /^manual\/ai-reference\/(00_meta|10_rules|20_design|25_gui|28_policy|30_plan)\//.test(
      relPosix
    )
  ) {
    return "reference";
  }

  return null;
}

async function isStub(content) {
  // A stub file is small and contains a redirection marker.
  if (content.length > 1500) return false;
  return /移行済み|archive へ移動|サブディレクトリへ分割/.test(content);
}

function findCurrentSnapshotBlock(text) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## Current Snapshot")) {
      start = i;
    } else if (start >= 0 && /^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;
  const block = lines.slice(start, end);
  return {
    headingIndex: start,
    bodyLines: block.slice(1).filter((l) => l.length > 0),
    rawBytes: Buffer.byteLength(block.join("\n"), "utf8"),
    lineCount: block.length - 1,
  };
}

function findActiveBoardTable(text) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("## Active Board")) {
      start = i;
    } else if (start >= 0 && /^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (start < 0) return null;
  let dataRows = 0;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i];
    if (/^\|[-:\s|]+\|$/.test(line)) continue;
    if (/^\|.+\|$/.test(line) && !/^\|\s*#/.test(line)) {
      // skip header row (heuristic: row containing column headers)
      if (/^\|\s*Pri\s*\|/.test(line)) continue;
      dataRows++;
    }
  }
  return { dataRows };
}

async function checkFile(absPath, relPosix, kind) {
  const violations = [];
  const content = await readFile(absPath, "utf8");
  const { size } = await stat(absPath);

  // Stubs are exempt from issue size checks.
  if (kind === "issue" && (await isStub(content))) {
    return [];
  }

  const lines = content.split(/\r?\n/);
  const lineCount = lines.length;
  const maxLine = lines.reduce(
    (acc, l, i) => (l.length > acc.len ? { len: l.length, no: i + 1 } : acc),
    { len: 0, no: 0 }
  );

  const t = THRESHOLDS[kind];
  if (size > t.bytes) {
    violations.push(
      `size: ${size} bytes (limit ${t.bytes}, +${size - t.bytes})`
    );
  }
  if (lineCount > t.lines) {
    violations.push(
      `lines: ${lineCount} (limit ${t.lines}, +${lineCount - t.lines})`
    );
  }
  if (maxLine.len > t.lineChars) {
    violations.push(
      `longest line: ${maxLine.len} chars at L${maxLine.no} (limit ${t.lineChars})`
    );
  }

  if (kind === "entry") {
    for (const re of ENTRY_FORBIDDEN_REGEXES) {
      // Walk all matches; exempt lines that read like rule descriptions
      // (e.g., "実装詳細を追記しない" — discussing the rule rather than logging it).
      const globalRe = new RegExp(
        re.source,
        re.flags.includes("g") ? re.flags : re.flags + "g"
      );
      let m;
      while ((m = globalRe.exec(content)) !== null) {
        const lineStart = content.lastIndexOf("\n", m.index) + 1;
        const lineEndIdx = content.indexOf("\n", m.index);
        const lineEnd = lineEndIdx === -1 ? content.length : lineEndIdx;
        const line = content.slice(lineStart, lineEnd);
        if (RULE_DESCRIPTION_HINT.test(line)) continue;
        const lineNo = content.slice(0, m.index).split(/\r?\n/).length;
        violations.push(
          `forbidden pattern ${re} matched at L${lineNo}: ${JSON.stringify(
            m[0]?.slice(0, 80) ?? ""
          )}`
        );
        break; // one violation per pattern is enough
      }
    }
  }

  for (const v of findBrokenTables(content)) {
    violations.push(v);
  }

  if (relPosix === "manual/ai-reference/30_plan/02_detailed-todo.md") {
    const snap = findCurrentSnapshotBlock(content);
    if (snap) {
      if (snap.lineCount > 12) {
        violations.push(`Current Snapshot: ${snap.lineCount} lines (limit 12)`);
      }
      if (snap.rawBytes > 2_000) {
        violations.push(
          `Current Snapshot: ${snap.rawBytes} bytes (limit 2,000)`
        );
      }
    }
    const board = findActiveBoardTable(content);
    if (board && board.dataRows > 20) {
      violations.push(`Active Board: ${board.dataRows} data rows (limit 20)`);
    }
  }

  return violations;
}

/**
 * Markdown 表の列数不整合を検出する。
 *
 * 表は連続する `| ... |` 行のブロックとして検出し、各行のセル数 (pipe count - 1)
 * が一致しない場合に違反を返す。コードブロック内は除外。fb1b372 README で発生した
 * 「区切り行は 3 列、データ行は 2 列」のような破損を捕まえるのが目的。
 */
function findBrokenTables(text) {
  const sanitized = stripCodeBlocks(text);
  const lines = sanitized.split(/\r?\n/);
  const violations = [];
  let block = null;
  const finish = () => {
    if (!block) return;
    const counts = block.rows.map((r) => r.cells);
    const expected = counts[0];
    const mismatchLines = [];
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] !== expected) {
        mismatchLines.push(
          `L${block.rows[i].lineNo} (${counts[i]} cells vs expected ${expected})`
        );
      }
    }
    if (mismatchLines.length > 0) {
      violations.push(
        `broken markdown table starting at L${block.rows[0].lineNo}: ${mismatchLines.join(", ")}`
      );
    }
    block = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line.startsWith("|") && line.endsWith("|") && line.length >= 3) {
      // セル数 = pipe 個数 - 1 (両端の | を引く)
      let pipes = 0;
      for (let j = 0; j < line.length; j++) {
        // エスケープされた \| はカウントしない
        if (line[j] === "|" && (j === 0 || line[j - 1] !== "\\")) pipes++;
      }
      const cells = pipes - 1;
      if (cells < 1) {
        finish();
        continue;
      }
      if (!block) block = { rows: [] };
      block.rows.push({ lineNo: i + 1, cells });
    } else {
      finish();
    }
  }
  finish();
  return violations;
}

function stripCodeBlocks(text) {
  // コードブロック内の文字を空白に置換し、行数・文字位置は維持する
  return text
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
}

function extractIssueId(relPosix) {
  if (!relPosix.startsWith("issues/")) return null;
  if (relPosix.startsWith("issues/archive/")) return null;
  if (relPosix === "issues/00_index.md") return null;
  // issues/P3-16_xxx.md → P3-16 / issues/P3-14/index.md → P3-14
  const m = relPosix.match(/^issues\/(P\d+-\d+)/);
  return m ? m[1] : null;
}

function getLastCommitDate(absPath) {
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%cs", "--", absPath],
      {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }
    );
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

function daysBetween(isoDate, today) {
  const then = new Date(isoDate + "T00:00:00Z");
  const ms = today.getTime() - then.getTime();
  return Math.floor(ms / 86_400_000);
}

async function main() {
  const fails = [];
  const warns = [];

  // Pass 1: 全 .md を列挙し存在セットを作る
  const mdFiles = [];
  for await (const abs of walk(ROOT)) {
    const rel = toPosix(relative(ROOT, abs));
    mdFiles.push({ abs, rel });
  }

  const linkDocuments = await Promise.all(
    mdFiles
      .filter(({ rel }) => classify(rel) && !frozenDocument(rel))
      .map(async ({ abs, rel }) => ({
        rel,
        content: await readFile(abs, "utf8"),
      }))
  );
  const links = await inspectDocumentLinks(ROOT, linkDocuments);

  // Pass 2: 分類・サイズ検査・リンク検査・near-limit
  for (const { abs, rel } of mdFiles) {
    const kind = classify(rel);
    if (!kind) continue;
    const violations = await checkFile(abs, rel, kind);

    // Broken-link 検査は archive 以外で実施 (archive は凍結履歴)
    if (kind !== "archive") {
      const content = await readFile(abs, "utf8");
      violations.push(...(links.violations.get(rel) ?? []));

      // near-limit warn: 上限超過は checkFile() で fail 済みなので、
      // ここは「上限未満かつ 90% 以上」のみを予防的 split 候補として通知。
      const t = THRESHOLDS[kind];
      const { size: fsize } = await stat(abs);
      const lineCount = content.split(/\r?\n/).length;
      const nearHints = [];
      const sizeThreshold = t.bytes * NEAR_LIMIT_RATIO;
      const lineThreshold = t.lines * NEAR_LIMIT_RATIO;
      if (fsize >= sizeThreshold && fsize <= t.bytes) {
        nearHints.push(
          `size ${fsize}/${t.bytes} bytes (${Math.round((fsize / t.bytes) * 100)}%)`
        );
      }
      if (lineCount >= lineThreshold && lineCount <= t.lines) {
        nearHints.push(
          `lines ${lineCount}/${t.lines} (${Math.round((lineCount / t.lines) * 100)}%)`
        );
      }
      if (nearHints.length > 0) {
        warns.push(
          `\n[near-limit] ${rel}\n  - ${nearHints.join("\n  - ")}\n  - 予防的 split を検討 (kind=${kind})`
        );
      }
    }

    if (violations.length === 0) continue;
    const block = `\n[${kind}] ${rel}\n  - ${violations.join("\n  - ")}`;
    if (FAILING_KINDS.has(kind)) {
      fails.push(block);
    } else {
      warns.push(block);
    }
  }

  // Pass 3: active issue の鮮度検査 (warn のみ)
  const issueGroups = new Map(); // id → { date, rel }
  for (const { abs, rel } of mdFiles) {
    const id = extractIssueId(rel);
    if (!id) continue;
    const date = getLastCommitDate(abs);
    if (!date) continue;
    const cur = issueGroups.get(id);
    if (!cur || date > cur.date) {
      issueGroups.set(id, { date, rel });
    }
  }
  const today = new Date();
  const staleEntries = [...issueGroups.entries()]
    .map(([id, info]) => ({ id, ...info, days: daysBetween(info.date, today) }))
    .filter((e) => e.days >= STALE_DAYS)
    .sort((a, b) => b.days - a.days);
  for (const e of staleEntries) {
    warns.push(
      `\n[stale-issue] ${e.id}\n  - last update ${e.date} (${e.days} days ago, threshold ${STALE_DAYS}d)\n  - latest file: ${e.rel}`
    );
  }

  // Pass 4: active issue の `cluster:` 宣言検査 (fail)
  //
  // issue を書いただけで worker の着手経路に乗らない状態を構造的に作れなくする。
  // 2026-08-03 実測で active issue 19 件中 9 件が registry / queue のどこからも参照されず
  // 到達不能だった (P3-122 = 両 lane の auto-merge ブロッカーを含む)。
  // 宣言は「着手可能なら cluster id / そうでないなら none + 理由」の二択で、
  // どちらを選ぶかの判断を強制するのが目的 (自動登録はしない。理由は
  // issue-cluster-sync.mjs のヘッダ参照)。
  const { listActiveIssueFiles, parseClusterDeclaration } =
    await import("./issue-cluster-sync.mjs");
  const registryStatus = new Map();
  try {
    const reg = JSON.parse(
      await readFile(
        join(ROOT, "autorun-queue", "cluster-registry.json"),
        "utf8"
      )
    );
    for (const c of reg.clusters || []) registryStatus.set(c.id, c.status);
  } catch {
    // registry が読めない環境 (worktree 作成直後等) では status 整合検査だけ skip する。
    // 宣言の有無検査は registry 非依存なので継続する。
  }
  for (const { id, abs } of listActiveIssueFiles(join(ROOT, "issues"))) {
    const text = await readFile(abs, "utf8");
    const decl = parseClusterDeclaration(text);
    const rel = relative(ROOT, abs).split(sep).join("/");
    if (!decl) {
      fails.push(
        `\n[issue-cluster-declaration] ${rel}\n` +
          `  - active issue に \`cluster:\` 宣言が無い。worker の着手経路に乗らないまま放置される。\n` +
          `  - 着手可能なら \`cluster: <cluster-id>\`、そうでないなら \`cluster: none — <理由>\` を書く。`
      );
      continue;
    }
    if (decl.kind === "none" && decl.reason.length === 0) {
      fails.push(
        `\n[issue-cluster-declaration] ${rel}\n` +
          `  - \`cluster: none\` に理由が無い。なぜ着手可能な作業単位でないかを書く (例: 参照カード出現待ち / 継続的 / 根治完了)。`
      );
      continue;
    }
    // registry 上 done な cluster を active issue が宣言し続けている = 状態の食い違い。
    // 「issue は open のまま、作業は終わっている」状態が放置されると、次に読む人が
    // 残作業があると誤解する。`状態:` の散文をパースする代わりに、**registry の
    // status という機械的事実**で整合を見る (issue-cluster-sync.mjs ヘッダの方針と同じ)。
    if (decl.kind === "cluster") {
      const status = registryStatus.get(decl.id);
      if (status && status !== "open") {
        fails.push(
          `\n[issue-cluster-status] ${rel}\n` +
            `  - 宣言する cluster \`${decl.id}\` は registry 上 ${status} だが、issue は active のまま。\n` +
            `  - 作業が完了しているなら issue を archive へ移す。残作業があるなら新しい cluster id を宣言する。`
        );
      }
    }
    void id;
  }

  let reportWritten = false;
  try {
    verificationState.atomicJson(join(ROOT, "artifacts/docs-lint.json"), {
      checkedAt: new Date().toISOString(),
      files: mdFiles.length,
      failures: fails,
      warnings: warns,
      linkCoverage: {
        localFiles: true,
        fragments: false,
        externalUrls: false,
        frozenHistory: false,
        ignoredTargets: links.ignoredTargets,
      },
    });
    reportWritten = true;
  } catch (error) {
    console.warn(
      `docs:lint: report could not be saved (${error.code}); printing complete results`
    );
  }
  if (
    warns.length > 0 &&
    (!process.argv.includes("--summary") || !reportWritten)
  ) {
    console.log("Warnings (non-fatal):");
    for (const w of warns) console.log(w);
    console.log("");
  }
  if (warns.length > 0 && process.argv.includes("--summary") && reportWritten) {
    console.log(
      `docs:lint: ${warns.length} warnings; full details: artifacts/docs-lint.json`
    );
  }

  if (fails.length > 0) {
    console.error("Failures:");
    for (const f of fails) console.error(f);
    console.error("\ndocs:lint failed.");
    process.exit(1);
  }

  console.log(
    `docs:lint passed: 0 failures, ${warns.length} warning(s)${
      warns.length > 0 ? "" : " (clean)"
    }.`
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((err) => {
    console.error("docs:lint crashed:", err);
    process.exit(2);
  });
