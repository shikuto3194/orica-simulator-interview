#!/usr/bin/env node
/**
 * issue-cluster-sync — active issue の `cluster:` 宣言を cluster-registry へ冪等に同期する。
 *
 * 背景 (2026-08-03): issue ファイルは「既知の問題」の正源だが、**worker の着手経路に
 * 一切乗っていなかった**。実測で active issue 19 件中 9 件が registry / queue のどこからも
 * 参照されず到達不能で、その中に P3-122 (両 lane の auto-merge ブロッカー) / P3-134 /
 * P3-137 のような High/Medium が含まれていた。issue を書いただけで誰も拾わない状態が
 * 構造的に作れてしまうのが原因。
 *
 * 設計方針: **一律自動登録はしない。** active issue の約半分は「参照カード出現待ち」
 * (P3-87)・「継続的」(P3-04)・「根治完了」(P2-11) など着手可能な作業単位ではなく、
 * 全部 cluster にするとレーンが「着手できない」と気づくためだけに iteration を溶かす。
 * 代わりに issue 側で**着手可能かを明示宣言**させ、宣言されたものだけを同期する。
 * 宣言漏れは `pnpm docs:lint` が fail させる (check-docs.mjs の issue-cluster-declaration)。
 *
 * 宣言フォーマット (issue のメタデータ行):
 *   cluster: <cluster-id>        → registry に無ければ propose する
 *   cluster: none — <理由>       → 着手可能な作業単位ではない。理由必須
 *
 * `状態:` を直接パースして自動判定する方式は採らない。実値が
 * 「根治完了（phase1-6 完了）。God Function 消滅…残:」のような散文で、フィールド自体が
 * 欠落している issue もあるため ([[project_needs_dsl_status_grep_gotcha]] と同型の罠)。
 *
 * Usage:
 *   node scripts/issue-cluster-sync.mjs           # 差分を表示するだけ (dry-run)
 *   node scripts/issue-cluster-sync.mjs --apply   # 不足 cluster を propose する
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import process from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const ISSUES_DIR = join(ROOT, "issues");
const REGISTRY = join(ROOT, "autorun-queue", "cluster-registry.json");

/** `cluster:` 宣言行。`none` は理由必須。 */
const CLUSTER_DECL_RE = /^cluster:\s*(.+)$/m;

/**
 * 任意メタデータ。cluster に「完了の定義」「ガードレール」を持たせるための宣言。
 *
 * 省略しても sync は動くが、その cluster は汎用 scope だけで worker に渡ることになる
 * (手動登録した cluster との品質差)。issue の「検証要件」「次のアクション」節に
 * 具体的な完了条件が書けているなら、その要約をここに書く。
 * 既存 cluster に対しては cluster-claim annotate で後付け更新する (冪等)。
 */
const DONE_DEF_RE = /^done-definition:\s*(.+)$/m;
const GUARDRAILS_RE = /^guardrails:\s*(.+)$/m;

export function parseOptionalClusterFields(text) {
  const done = DONE_DEF_RE.exec(text ?? "");
  const guard = GUARDRAILS_RE.exec(text ?? "");
  return {
    doneDefinition: done ? done[1].trim() : "",
    guardrails: guard ? guard[1].trim() : "",
  };
}

/**
 * active issue の「代表ファイル」を列挙する。
 * - `issues/<ID>_<slug>.md` (単一ファイル型)
 * - `issues/<ID>/index.md`  (ディレクトリ型の親)
 * archive とサブファイルは対象外 (宣言は親が持つ)。
 */
export function listActiveIssueFiles(issuesDir = ISSUES_DIR) {
  const out = [];
  for (const entry of readdirSync(issuesDir, { withFileTypes: true })) {
    if (entry.name === "archive") continue;
    const abs = join(issuesDir, entry.name);
    if (entry.isDirectory()) {
      const idx = join(abs, "index.md");
      try {
        if (statSync(idx).isFile()) out.push({ id: entry.name, abs: idx });
      } catch {
        // index.md が無いディレクトリは親不在。docs:lint 側の関心事なのでここでは無視。
      }
    } else if (entry.name.endsWith(".md") && entry.name !== "00_index.md") {
      out.push({ id: entry.name.split("_")[0], abs });
    }
  }
  return out;
}

/**
 * `cluster:` 宣言をパースする。
 * @returns {{kind:"cluster", id:string} | {kind:"none", reason:string} | null}
 *          null = 宣言が無い (docs:lint が fail させる)
 */
export function parseClusterDeclaration(text) {
  const m = CLUSTER_DECL_RE.exec(text ?? "");
  if (!m) return null;
  const raw = m[1].trim();
  const noneMatch = /^none\b[\s—:-]*(.*)$/i.exec(raw);
  if (noneMatch) return { kind: "none", reason: noneMatch[1].trim() };
  // cluster id は cluster-claim.mjs と同じ制約 (colon/slash 不可)。
  const id = raw.split(/\s/)[0];
  return { kind: "cluster", id };
}

// 日本語を含むテキストは spawnSync 経由の argv で Windows のコードページ依存の
// 文字化け/打ち切りを起こしうる (2026-08-05、P3-145 cluster の doneDefinition/guardrails
// が primary tree で毎回同じ位置で切れて再現。cluster-claim.mjs 側の `--flag-b64` 対応と対)。
// base64 は ASCII のみなのでコードページに左右されない。
function b64Flag(flag, value) {
  return value
    ? [`${flag}-b64`, Buffer.from(value, "utf8").toString("base64")]
    : [];
}

function loadRegistryIds() {
  try {
    const reg = JSON.parse(readFileSync(REGISTRY, "utf8"));
    return new Map((reg.clusters || []).map((c) => [c.id, c.status]));
  } catch (e) {
    console.error(`[issue-cluster-sync] registry 読込失敗: ${e.message}`);
    process.exit(2);
  }
}

function main() {
  const apply = process.argv.includes("--apply");
  const registry = loadRegistryIds();
  const files = listActiveIssueFiles();

  const missingDecl = [];
  const toPropose = [];
  const alreadyOpen = [];
  const doneButDeclared = [];
  let noneCount = 0;

  for (const { id, abs } of files) {
    const text = readFileSync(abs, "utf8");
    const decl = parseClusterDeclaration(text);
    if (!decl) {
      missingDecl.push(id);
      continue;
    }
    if (decl.kind === "none") {
      noneCount++;
      continue;
    }
    const status = registry.get(decl.id);
    const fields = parseOptionalClusterFields(text);
    if (status === undefined)
      toPropose.push({ issueId: id, clusterId: decl.id, abs, ...fields });
    else if (status === "open")
      alreadyOpen.push({ issueId: id, clusterId: decl.id, ...fields });
    else doneButDeclared.push({ issueId: id, clusterId: decl.id, status });
  }

  console.log(`active issue: ${files.length}`);
  console.log(
    `  cluster 宣言あり(着手可能): ${toPropose.length + alreadyOpen.length}`
  );
  console.log(`  cluster: none (着手可能な作業単位でない): ${noneCount}`);
  console.log(
    `  宣言なし: ${missingDecl.length}${missingDecl.length ? " — " + missingDecl.join(", ") : ""}`
  );

  for (const d of doneButDeclared) {
    // registry 上 done なのに issue が open のまま cluster を宣言している = 状態の食い違い。
    // 自動で再 open にはしない (done 判定は worker の完遂報告に基づくため)。
    console.warn(
      `  WARN: ${d.issueId} が宣言する cluster ${d.clusterId} は registry 上 ${d.status}。issue 側の状態更新漏れの可能性`
    );
  }

  // 既に open な cluster に対して doneDefinition / guardrails を後付け同期する。
  // issue 側で定義を追記したときに registry へ反映されないと、worker には汎用 scope しか
  // 渡らないまま (手動登録 cluster との品質差が残る)。annotate は冪等。
  const toAnnotate = alreadyOpen.filter(
    (a) => a.doneDefinition || a.guardrails
  );
  if (apply) {
    for (const a of toAnnotate) {
      const args = [
        join(SCRIPT_DIR, "cluster-claim.mjs"),
        "annotate",
        "--id",
        a.clusterId,
        ...b64Flag("--done-definition", a.doneDefinition),
        ...b64Flag("--guardrails", a.guardrails),
      ];
      const res = spawnSync(process.execPath, args, {
        cwd: ROOT,
        encoding: "utf8",
      });
      if (res.status !== 0)
        console.error(
          `  annotate FAILED: ${a.clusterId} — ${(res.stderr || "").trim() || `exit ${res.status}`}`
        );
    }
    if (toAnnotate.length > 0)
      console.log(`doneDefinition/guardrails 同期: ${toAnnotate.length} 件`);
  } else if (toAnnotate.length > 0) {
    console.log(
      `\n--apply で ${toAnnotate.length} 件の doneDefinition/guardrails を同期します。`
    );
  }

  if (toPropose.length === 0) {
    console.log("registry に不足している cluster はありません。");
    return 0;
  }

  console.log(`\n未登録 cluster ${toPropose.length} 件:`);
  for (const t of toPropose) console.log(`  ${t.clusterId}  (${t.issueId})`);

  if (!apply) {
    console.log("\n--apply で propose します (dry-run)。");
    return 0;
  }

  // scope / doneDefinition / guardrails は issue 本文から機械抽出できないため、
  // 最小限の scope (issue への参照) で propose する。中身は issue を読ませる。
  // queue-ref に issue パスを入れることで worker が正源へ辿れる。
  for (const t of toPropose) {
    const rel = t.abs.slice(ROOT.length + 1).replaceAll("\\", "/");
    const res = spawnSync(
      process.execPath,
      [
        join(SCRIPT_DIR, "cluster-claim.mjs"),
        "propose",
        "--id",
        t.clusterId,
        "--lane",
        "claude",
        ...b64Flag(
          "--scope",
          `${t.issueId}: ${rel} の「残タスク」節を正源として着手する。issue 本文を必ず読み、着手前に残タスクのどれを今 iteration で閉じるかを決める`
        ),
        "--queue-ref",
        rel,
        ...b64Flag(
          "--note",
          "issue-cluster-sync による自動登録 (issue の cluster: 宣言由来)"
        ),
        ...b64Flag("--done-definition", t.doneDefinition),
        ...b64Flag("--guardrails", t.guardrails),
      ],
      { cwd: ROOT, encoding: "utf8" }
    );
    if (res.status === 0) console.log(`  proposed: ${t.clusterId}`);
    else
      console.error(
        `  FAILED: ${t.clusterId} — ${(res.stderr || "").trim() || `exit ${res.status}`}`
      );
  }
  return 0;
}

if (process.argv[1] && process.argv[1].endsWith("issue-cluster-sync.mjs")) {
  process.exit(main());
}
