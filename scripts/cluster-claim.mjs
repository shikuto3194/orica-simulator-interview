#!/usr/bin/env node
/**
 * cluster-claim — engine lane cluster の機械ロック。choice C の本体。
 *
 * 指定 lane に割り当てられた open cluster のうち、cluster-<id> lock が空いている
 * 先頭 1 件を atomic に acquire し、その cluster の {id, scope} を stdout に JSON 出力する。
 * wrapper はこの id/scope を LLM prompt に注入し、LLM はその cluster だけを触る。
 * これにより両 lane が同じ cluster を触ることを wrapper 側で機械的に防ぐ
 * (LLM の lock 規律に依存しない)。
 *
 * lock は supervisor-lock.mjs の汎用 lane lock を再利用 (lane="cluster-<id>")。
 * lock 名に colon は使えない (Windows ADS 破損) ため id は colon-free 必須。
 *
 * Usage:
 *   node scripts/cluster-claim.mjs claim --lane claude --token <uuid> [--ttl <min>]
 *     → 取得成功: stdout に {"clusterId":"...","scope":"...","lockLane":"cluster-..."} / exit 0
 *     → 取得可能 cluster 無し: stdout に {} / exit 3
 *   node scripts/cluster-claim.mjs release --lock-lane cluster-<id> --token <uuid>
 *
 * 注: claim した token は wrapper が保持し、run 終了後に同 token で release する。
 *     ttl + heartbeat は wrapper が refresh しないため、ttl は run 上限 (240min) に合わせる。
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");
const REGISTRY =
  process.env.ORICA_CLUSTER_REGISTRY ||
  join(ROOT, "autorun-queue", "cluster-registry.json");
const LOCK_SCRIPT = join(SCRIPT_DIR, "supervisor-lock.mjs");

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
};

// 日本語を含むテキスト引数用。Windows の argv 受け渡しは呼び出し元シェル/コンソールの
// コードページ依存で、spawnSync 経由の CJK 文字が途中で文字化け・打ち切りされることがある
// (2026-08-05 観測、P3-145 cluster の doneDefinition/guardrails が primary tree で毎回同じ
// 位置で切れて再現。writeAsciiJson が既に手当てしている子→親の stdout 方向とは逆の、
// 親→子の argv 方向で同種の問題が未対策だった)。`--flag-b64` があれば base64 decode して使う
// (呼び出し元は Buffer.from(text,"utf8").toString("base64") で渡す、ASCII のみなので
// コードページに左右されない)。無ければ従来どおり生の `--flag` にフォールバックする。
const optTextFlag = (flag) => {
  const b64 = opt(`${flag}-b64`);
  if (b64 !== undefined) return Buffer.from(b64, "base64").toString("utf8");
  return opt(flag);
};

// PowerShell 側の stdout デコードは Windows のコードページ依存 (CP932/UTF-8 が混在しうる)
// で、node の UTF-8 出力にある日本語文字が文字化けして ConvertFrom-Json が
// "After parsing a value an unexpected character was encountered: l" 等で失敗する
// (2026-06-22 観測、cluster-claude-explore の scope に日本語があると毎回発火)。
// JSON 仕様で非 ASCII は \uXXXX エスケープ可能なので、stdout 出力は純 ASCII に
// 揃える。ConvertFrom-Json (および JSON.parse) は \uXXXX を正しく元の Unicode に
// 戻すので意味は無損失。
function writeAsciiJson(obj) {
  const raw = JSON.stringify(obj);
  const ascii = raw.replace(
    /[-￿]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")
  );
  process.stdout.write(ascii);
}

// LLM worker (Codex/Claude) が探索的に `--help` を叩くことがある。exit 2 を返すと
// 環境によっては親プロセス (Codex CLI など) が session-fatal と解釈しうるので、
// usage を stdout に出して exit 0 で返す。
// NOTE: precondition / evidence の選択肢は **allowlist から生成**する。手書きで列挙すると
// キー追加のたびに腐る (実際 soul-core-exclusion 追加時に stale 化した)。そのため
// --help の処理は両 allowlist の宣言より後ろ (下部) に置いてある。
function buildUsage() {
  return [
    "Usage:",
    "  node scripts/cluster-claim.mjs claim --lane <lane> --token <uuid> [--ttl <min>]",
    "  node scripts/cluster-claim.mjs release --lock-lane cluster-<id> --token <uuid>",
    "  node scripts/cluster-claim.mjs list-locked --exclude-lane <lane>",
    "  node scripts/cluster-claim.mjs done --id <cluster-id> [--commit <sha>] [--note <text>]",
    "  node scripts/cluster-claim.mjs propose --id <cluster-id> --lane <lane> --scope <text> [--queue-ref <text> | --queue-refs <json-array>] [--note <text>] [--precondition <kind>] [--done-definition <text>] [--guardrails <text>] [--evidence <key>] [--source <text>]",
    "  node scripts/cluster-claim.mjs annotate --id <cluster-id> [--scope <text>] [--done-definition <text>] [--guardrails <text>] [--evidence <key>] [--precondition <kind>] [--source <text>]",
    `    precondition: ${Object.keys(PRECONDITIONS).join(" | ")} (充足するまで claim させない)`,
    `    evidence: ${Object.keys(EVIDENCE_COMMANDS).join(" | ")} (claim 時に実行し出力を prompt へ注入)`,
    "  node scripts/cluster-claim.mjs audit [--apply]",
  ].join("\n");
}

/**
 * cluster.precondition — 「登録はするが、条件が揃うまで claim させない」ための機械ゲート。
 *
 * status:"open" のまま claim 対象から外すので、未充足の cluster は「存在しない」のと
 * 同じ扱いになり、既存の「claim 失敗 → 探索モード fallback」がそのまま働く。
 * status を open 以外にする方式は done 遷移 / audit --apply が open 前提のため採らない。
 * また手動で status を戻す運用は忘却で永久 park 化するので、条件は必ず機械判定にする。
 *
 * 各 predicate は「充足なら null、未充足なら理由文字列」を返す。
 */
const PRECONDITIONS = {
  // engine-drain の停止条件 (fidelity violations 合計 0) に到達するまで claim させない。
  // ledger は update-snapshot.mjs (`pnpm snapshot --measure`) が維持する。
  "fidelity-total-zero": () => {
    // ORICA_CLUSTER_REGISTRY と同じ理由で差し替え可能にする (隔離テスト用)。
    const ledgerPath =
      process.env.ORICA_FIDELITY_LEDGER || join(ROOT, "fidelity-baseline.json");
    let ledger;
    try {
      ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
    } catch (e) {
      // ledger が読めないなら「未充足」に倒す (誤って早期着手させない)。
      return `fidelity-baseline.json 読込失敗 (${e.message})`;
    }
    const total = ledger?.current?.total;
    if (typeof total !== "number") return "ledger に current.total が無い";
    if (total > 0) return `fidelity violations 残 ${total} 件 (0 で解禁)`;
    return null;
  },
};

/**
 * cluster.evidence — worker に「探せ」と言わず**証拠を渡す**ための仕組み。
 *
 * registry に候補一覧を静的に貼る方式は採らない: 並行レーンが rules-core を編集すると
 * 行番号がすぐズレて陳腐化する (2026-08-03 実測で 357→378 等)。代わりに
 * **claim 時に再実行して最新の出力を prompt へ載せる**。
 *
 * registry に書けるのは下記 allowlist のキーだけ (precondition と同じ思想)。
 * registry は複数レーンが書き換えるファイルなので、任意コマンド文字列は許さない。
 */
const EVIDENCE_COMMANDS = {
  // guard-audit ループ: 登録済み probe の未分類候補一覧。
  "ssot-candidates": [join(SCRIPT_DIR, "ssot-candidate-scan.mjs")],
  // card-data 語彙ギャップ: 《ソウルコア》以外 → effectKind:"normal_only" の欠落一覧。
  "soul-core-exclusion": [join(SCRIPT_DIR, "soul-core-exclusion-scan.mjs")],
  // engine ループ: 既存 primitive で書ける stub の READY 一覧。
  "stub-readiness": [
    join(SCRIPT_DIR, "stub-readiness.mjs"),
    "--ready",
    "--top",
    "20",
  ],
  // effect-debug loop: replay/ticket-backed failure cluster summary.
  "effect-debug-ticket": [
    join(SCRIPT_DIR, "effect-debug-triage.mjs"),
    "--evidence",
  ],
};

const EVIDENCE_MAX_CHARS = 12000;

/**
 * evidence コマンドを実行して stdout を返す。**fail-open**: 未指定・未知キー・実行失敗の
 * いずれでも null を返し、claim 自体は成功させる (証拠が取れないことは claim を止める
 * 理由にならない。worker は従来どおり自分で探せる)。
 */
function collectEvidence(cluster) {
  const key = cluster.evidence;
  if (!key) return null;
  const argv = EVIDENCE_COMMANDS[key];
  if (!argv) {
    console.error(`[cluster-claim] 未知の evidence key: ${key} (skip)`);
    return null;
  }
  const result = spawnSync(process.execPath, argv, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ORICA_CLUSTER_ID: cluster.id },
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  if (result.error || typeof result.stdout !== "string") {
    console.error(
      `[cluster-claim] evidence "${key}" 実行失敗: ${result.error?.message ?? "no stdout"} (skip)`
    );
    return null;
  }
  const out = result.stdout.trim();
  if (!out) return null;
  return out.length > EVIDENCE_MAX_CHARS
    ? out.slice(0, EVIDENCE_MAX_CHARS) +
        `\n...(${out.length - EVIDENCE_MAX_CHARS} 文字省略。全文は該当コマンドを再実行すること)`
    : out;
}

/** 未充足なら理由文字列、充足 or precondition 未指定なら null。 */
function preconditionUnmetReason(cluster) {
  const kind = cluster.precondition;
  if (!kind) return null;
  const predicate = PRECONDITIONS[kind];
  if (!predicate) return `未知の precondition "${kind}"`;
  return predicate();
}

// allowlist 2 つの宣言後に評価する必要があるため、ここで --help を処理する。
if (cmd === "--help" || cmd === "-h" || cmd === "help" || cmd === undefined) {
  process.stdout.write(buildUsage() + "\n");
  process.exit(0);
}

function lockCmd(action, lockLane, token, extra = []) {
  const result = spawnSync(
    process.execPath,
    [LOCK_SCRIPT, action, "--lane", lockLane, "--token", token, ...extra],
    { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  return result.status ?? 2;
}

if (cmd === "claim") {
  const lane = opt("--lane");
  const token = opt("--token");
  const ttl = opt("--ttl", "240");
  if (!lane || !token) {
    console.error("[cluster-claim] claim requires --lane and --token");
    process.exit(2);
  }

  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    console.error(`[cluster-claim] registry 読込失敗: ${e.message}`);
    process.exit(2);
  }

  const candidates = (registry.clusters || [])
    .filter((c) => c.status === "open" && (c.lane === lane || c.lane === "any"))
    .sort((a, b) => {
      const aExplore = /(^|-)explore$/.test(a.id) ? 1 : 0;
      const bExplore = /(^|-)explore$/.test(b.id) ? 1 : 0;
      return aExplore - bExplore;
    });

  for (const c of candidates) {
    if (/[:\\/]/.test(c.id)) {
      // colon/slash を含む id は Windows lock path を壊す。skip して警告。
      console.error(`[cluster-claim] skip 不正 id (colon/slash): ${c.id}`);
      continue;
    }
    // precondition 未充足は claim 対象から外す。理由を必ず stderr に残す
    // (黙って候補が減ると「なぜ explore に落ちたか」が追えなくなる)。
    const unmet = preconditionUnmetReason(c);
    if (unmet) {
      console.error(
        `[cluster-claim] skip (precondition "${c.precondition}" 未充足): ${c.id} — ${unmet}`
      );
      continue;
    }
    const lockLane = `cluster-${c.id}`;
    const code = lockCmd("acquire", lockLane, token, [
      "--ttl",
      ttl,
      "--label",
      `lane=${lane}`,
    ]);
    if (code === 0) {
      // TOCTOU 再検証: candidates は関数冒頭の registry スナップショットから作った。
      // lockCmd (子プロセス spawn) の間に別プロセスが `done`/`propose` で registry を
      // 書き換えていれば、このスナップショットは古い。取得できた lock を返す前に registry を
      // 再読込し、対象 cluster が今もまだ status:"open" か確認する。2026-07-20 観測: registry
      // 上ではすでに done 済みの cluster が assigned cluster として渡ってくる stale claim
      // (project_stale_cluster_claim_post_rebase_commit_sha)。stale なら取得した lock を
      // 即座に手放し、次候補へフォールバックする。
      let stillOpen = false;
      try {
        const fresh = JSON.parse(readFileSync(REGISTRY, "utf8"));
        const freshTarget = (fresh.clusters || []).find((x) => x.id === c.id);
        stillOpen = !!freshTarget && freshTarget.status === "open";
      } catch (e) {
        // 再読込自体が失敗したら保守的に stale 扱いし、次候補へ (registry 破損時に
        // 完了済み cluster を握り続けるより安全)。
        console.error(
          `[cluster-claim] re-check 読込失敗 (${c.id}): ${e.message}`
        );
      }
      if (!stillOpen) {
        console.error(
          `[cluster-claim] skip stale candidate (registry status changed during claim): ${c.id}`
        );
        lockCmd("release", lockLane, token);
        continue;
      }
      // 「成果・ガードレール・完了の定義・証拠」を prompt へ渡すための拡張フィールド。
      // 未設定の cluster は従来どおり空文字なので wrapper 側の後方互換が保たれる。
      writeAsciiJson({
        clusterId: c.id,
        scope: c.scope || "",
        ownerLane: c.lane || "",
        source: c.source || "",
        lockLane,
        doneDefinition: c.doneDefinition || "",
        guardrails: c.guardrails || "",
        evidence: collectEvidence(c) || "",
      });
      process.exit(0);
    }
    // code 1 = 別 lane が保持中 → 次 cluster。code 2 = エラー → 次へ (保守的)。
  }

  process.stdout.write("{}");
  process.exit(3);
}

if (cmd === "list-locked") {
  // 他 lane が active hold している cluster を列挙する。wrapper が prompt に
  // off-limits リストとして注入し、fallback explore mode でも触らせない。
  const excludeLane = opt("--exclude-lane"); // 自分の lane
  if (!excludeLane) {
    console.error("[cluster-claim] list-locked requires --exclude-lane");
    process.exit(2);
  }

  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    console.error(`[cluster-claim] registry 読込失敗: ${e.message}`);
    process.exit(2);
  }

  const locked = [];
  for (const c of registry.clusters || []) {
    if (c.lane === excludeLane) continue; // 自分の lane は対象外
    if (c.status !== "open") continue;
    if (/[:\\/]/.test(c.id)) continue;
    const lockLane = `cluster-${c.id}`;
    // status コマンドで保持状態を取得。stdout に "held" を含めば active。
    const result = spawnSync(
      process.execPath,
      [LOCK_SCRIPT, "status", "--lane", lockLane],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
    const out = (result.stdout || "") + (result.stderr || "");
    // "held by" = active hold。"STALE" = 期限切れ。"free" = 解放済み。
    // STALE / free は触ってよい (他 lane も次 claim で取れない or 取得可能)。
    if (/held by/.test(out) && !/STALE/.test(out)) {
      locked.push({
        clusterId: c.id,
        scope: c.scope || "",
        ownerLane: c.lane,
        queueRefs: c.queueRefs || [],
      });
    }
  }

  writeAsciiJson(locked);
  process.exit(0);
}

if (cmd === "release") {
  const lockLane = opt("--lock-lane");
  const token = opt("--token");
  if (!lockLane || !token) {
    console.error("[cluster-claim] release requires --lock-lane and --token");
    process.exit(2);
  }
  const code = lockCmd("release", lockLane, token);
  process.exit(code === 0 ? 0 : 2);
}

// propose — 探索 cluster が見つけた候補を、次 run が先に claim できる具体
// cluster として registry に昇格する。claude-explore / codex-explore は永続
// 探索枠なので、探索結果をここへ固定しないと次 run も同じ探索からやり直して
// no-op を量産する。claim は non-explore cluster を explore より優先するため、
// 追加された cluster は次回の実行対象になる。
if (cmd === "propose") {
  const id = opt("--id");
  const lane = opt("--lane");
  const scope = optTextFlag("--scope") ?? "";
  const queueRef = optTextFlag("--queue-ref") ?? "";
  const queueRefsJson = optTextFlag("--queue-refs");
  let queueRefs = queueRef ? [queueRef] : [];
  if (queueRefsJson !== undefined) {
    try {
      const parsed = JSON.parse(queueRefsJson);
      if (
        !Array.isArray(parsed) ||
        parsed.some((value) => typeof value !== "string" || value.length === 0)
      ) {
        throw new Error("must be a string array with no empty values");
      }
      queueRefs = [...new Set(parsed)];
    } catch (error) {
      console.error(
        `[cluster-claim] invalid --queue-refs JSON: ${error.message}`
      );
      process.exit(2);
    }
  }
  const note = optTextFlag("--note") ?? "";
  const precondition = opt("--precondition", "");
  const doneDefinition = optTextFlag("--done-definition") ?? "";
  const guardrails = optTextFlag("--guardrails") ?? "";
  const evidence = opt("--evidence", "");
  const source = optTextFlag("--source") ?? "";
  if (!id || !lane || !scope) {
    console.error("[cluster-claim] propose requires --id, --lane and --scope");
    process.exit(2);
  }
  if (precondition && !PRECONDITIONS[precondition]) {
    console.error(
      `[cluster-claim] invalid precondition: ${precondition} (有効: ${Object.keys(PRECONDITIONS).join(", ")})`
    );
    process.exit(2);
  }
  if (evidence && !EVIDENCE_COMMANDS[evidence]) {
    console.error(
      `[cluster-claim] invalid evidence: ${evidence} (有効: ${Object.keys(EVIDENCE_COMMANDS).join(", ")})`
    );
    process.exit(2);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || /[:\\/]/.test(id)) {
    console.error(`[cluster-claim] invalid cluster id: ${id}`);
    process.exit(2);
  }
  if (!["claude", "codex", "any"].includes(lane)) {
    console.error(`[cluster-claim] invalid lane: ${lane}`);
    process.exit(2);
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    console.error(`[cluster-claim] registry 読込失敗: ${e.message}`);
    process.exit(2);
  }
  const existing = (registry.clusters || []).find((c) => c.id === id);
  const today = new Date().toISOString().slice(0, 10);
  if (existing) {
    const existingRefs = Array.isArray(existing.queueRefs)
      ? existing.queueRefs
      : [];
    const mergedRefs = [...new Set([...existingRefs, ...queueRefs])];
    const evidenceChanged = mergedRefs.length !== existingRefs.length;
    const wasDone = existing.status === "done";
    const priorResolution = wasDone
      ? {
          resolvedAt: existing.resolvedAt ?? null,
          resolvedCommit: existing.resolvedCommit ?? null,
        }
      : null;
    if (!evidenceChanged && !wasDone) {
      writeAsciiJson({ id, status: "already-exists" });
      process.exit(0);
    }
    existing.queueRefs = mergedRefs;
    existing.scope = scope;
    if (note) existing.proposedNote = note;
    if (wasDone) {
      existing.status = "open";
      existing.reopenedFrom = priorResolution;
      delete existing.resolvedAt;
      delete existing.resolvedCommit;
      delete existing.resolvedNote;
    }
    registry.updated = today;
    const tmp = REGISTRY + ".tmp";
    writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf8");
    renameSync(tmp, REGISTRY);
    writeAsciiJson({
      id,
      status: wasDone
        ? "reopened"
        : existing.status === "open"
          ? "evidence-updated"
          : existing.status,
      queueRefCount: mergedRefs.length,
    });
    process.exit(0);
  }
  const cluster = {
    id,
    lane,
    status: "open",
    scope,
    queueRefs: queueRefs.length > 0 ? queueRefs : ["explore-promoted"],
    proposedAt: today,
  };
  if (precondition) cluster.precondition = precondition;
  if (doneDefinition) cluster.doneDefinition = doneDefinition;
  if (guardrails) cluster.guardrails = guardrails;
  if (evidence) cluster.evidence = evidence;
  if (source) cluster.source = source;
  if (note) cluster.proposedNote = note;
  registry.clusters = registry.clusters || [];
  registry.clusters.push(cluster);
  registry.updated = today;
  const tmp = REGISTRY + ".tmp";
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf8");
  renameSync(tmp, REGISTRY);
  writeAsciiJson({ id, status: "proposed", lane });
  process.exit(0);
}

// annotate — 既存 open cluster に doneDefinition / guardrails / evidence / precondition を
// 後付けする。propose は already-exists で何もしないため、既存 cluster の拡張用に分ける。
// registry は複数レーンが書き換えるので手編集ではなくこのコマンドを使う。
if (cmd === "annotate") {
  const id = opt("--id");
  if (!id) {
    console.error("[cluster-claim] annotate requires --id");
    process.exit(2);
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    console.error(`[cluster-claim] registry 読込失敗: ${e.message}`);
    process.exit(2);
  }
  const target = (registry.clusters || []).find((c) => c.id === id);
  if (!target) {
    console.error(`[cluster-claim] cluster ${id} が見つからない`);
    process.exit(3);
  }
  if (target.status !== "open") {
    console.error(
      `[cluster-claim] cluster ${id} status は ${target.status}, open のみ annotate 可`
    );
    process.exit(3);
  }
  // scope も更新可能にする。誤った着手指示を registry に残したまま worker に渡すと、
  // 実在しない不具合を「直し」に行かせてしまう (2026-08-03 に BSES01-T01 の誤検出を
  // scope に書いてしまった実例)。
  const fields = {
    scope: optTextFlag("--scope"),
    doneDefinition: optTextFlag("--done-definition"),
    guardrails: optTextFlag("--guardrails"),
    evidence: opt("--evidence"),
    precondition: opt("--precondition"),
    source: optTextFlag("--source"),
  };
  if (fields.evidence && !EVIDENCE_COMMANDS[fields.evidence]) {
    console.error(
      `[cluster-claim] invalid evidence: ${fields.evidence} (有効: ${Object.keys(EVIDENCE_COMMANDS).join(", ")})`
    );
    process.exit(2);
  }
  if (fields.precondition && !PRECONDITIONS[fields.precondition]) {
    console.error(
      `[cluster-claim] invalid precondition: ${fields.precondition} (有効: ${Object.keys(PRECONDITIONS).join(", ")})`
    );
    process.exit(2);
  }
  const applied = [];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    target[key] = value;
    applied.push(key);
  }
  if (applied.length === 0) {
    console.error("[cluster-claim] annotate: 更新するフィールドが無い");
    process.exit(2);
  }
  registry.updated = new Date().toISOString().slice(0, 10);
  const tmp = REGISTRY + ".tmp";
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf8");
  renameSync(tmp, REGISTRY);
  writeAsciiJson({ id, status: "annotated", fields: applied });
  process.exit(0);
}

// done — 担当 cluster を実装完了として閉じる。registry の status を open → done に
// 遷移し、resolvedAt / resolvedCommit / resolvedNote を記録する。 LLM (worker) が
// 完遂判定したときに wrapper から呼ぶか、LLM 自身が tool 経由で呼ぶ。
// これが無いと registry は永久 open で同じ cluster が再 claim され続け、
// claim 失敗 fallback (探索モード) が永遠に発火しない (2026-06-20 障害原因)。
if (cmd === "done") {
  const id = opt("--id");
  const commit = opt("--commit", "manual");
  const note = opt("--note", "");
  if (!id) {
    console.error("[cluster-claim] done requires --id");
    process.exit(2);
  }
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    console.error(`[cluster-claim] registry 読込失敗: ${e.message}`);
    process.exit(2);
  }
  const target = (registry.clusters || []).find((c) => c.id === id);
  if (!target) {
    console.error(`[cluster-claim] cluster id 不在: ${id}`);
    process.exit(2);
  }
  if (target.status === "done") {
    writeAsciiJson({ id, status: "already-done" });
    process.exit(0);
  }
  if (target.status !== "open") {
    console.error(
      `[cluster-claim] cluster ${id} status は ${target.status}, open のみ done に遷移可`
    );
    process.exit(2);
  }
  target.status = "done";
  target.resolvedAt = new Date().toISOString().slice(0, 10);
  target.resolvedCommit = commit;
  if (note) target.resolvedNote = note;
  registry.updated = target.resolvedAt;
  const tmp = REGISTRY + ".tmp";
  writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf8");
  renameSync(tmp, REGISTRY);
  writeAsciiJson({ id, status: "done", resolvedAt: target.resolvedAt });
  process.exit(0);
}

// audit — registry の open cluster のうち queueRefs から完成検出できるものを
// 列挙し、--apply で done 化する。stale open は Claude/Codex lane の無限 no-op
// ループの原因 (2026-06-20 障害)。 lane wrapper の claim 直前に --apply で
// 呼ぶことで自動清掃される。
// 完成検出ヒューリスティック (queueRefs パターン別):
//   - "autorun-queue/needs-dsl.audit.jsonl (cardNo <PREFIX>-*)" →
//       needs-dsl.audit.jsonl で <PREFIX>- 始まり行が全て resolved なら完成
//   - "autorun-queue/needs-dsl.audit.jsonl:<CARDNO>" →
//       needs-dsl.audit.jsonl で <CARDNO> の open 行が無ければ完成
//   - "issues/<ID>" → 手動判定のみ (本コマンドはスキップ)
//   - "feat/<branch> branch HEAD" → branch 進行型 (本コマンドはスキップ)
//   - "engine-drain-runbook §..." → 探索 cluster (永続 open のため対象外)
if (cmd === "audit") {
  const apply = args.includes("--apply");
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
  } catch (e) {
    console.error(`[cluster-claim] registry 読込失敗: ${e.message}`);
    process.exit(2);
  }
  const auditQueuePath = join(ROOT, "autorun-queue", "needs-dsl.audit.jsonl");
  let auditRows = [];
  try {
    auditRows = readFileSync(auditQueuePath, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    // ファイル無くても続行 (audit-* cluster の検出が無いだけ)
  }
  const stale = [];
  const patternAudit = /needs-dsl\.audit\.jsonl \(cardNo ([A-Z0-9]+)-\*\)/;
  const exactAuditPrefix = "needs-dsl.audit.jsonl:";
  for (const c of registry.clusters || []) {
    if (c.status !== "open") continue;
    let detected = false;
    let reason = "";
    for (const ref of c.queueRefs || []) {
      const m = patternAudit.exec(ref);
      if (m) {
        const prefix = m[1] + "-";
        const related = auditRows.filter((r) =>
          (r.cardNo || "").startsWith(prefix)
        );
        if (related.length === 0) continue;
        const allResolved = related.every((r) => r.status === "resolved");
        if (allResolved) {
          detected = true;
          reason = `needs-dsl.audit.jsonl ${prefix}* 全 ${related.length} 件 resolved`;
        }
        break;
      }
      const exactIndex = ref.indexOf(exactAuditPrefix);
      if (exactIndex >= 0) {
        const cardNo = ref.slice(exactIndex + exactAuditPrefix.length).trim();
        if (!cardNo) continue;
        const related = auditRows.filter((r) => r.cardNo === cardNo);
        if (related.length === 0) continue;
        const hasOpen = related.some((r) => r.status === "open");
        if (!hasOpen) {
          detected = true;
          reason = `needs-dsl.audit.jsonl ${cardNo} open 行なし`;
        }
        break;
      }
    }
    if (detected) stale.push({ id: c.id, lane: c.lane, reason });
  }
  if (apply && stale.length > 0) {
    for (const s of stale) {
      const target = registry.clusters.find((c) => c.id === s.id);
      if (!target || target.status !== "open") continue;
      target.status = "done";
      target.resolvedAt = new Date().toISOString().slice(0, 10);
      target.resolvedCommit = "audit-auto";
      target.resolvedNote = s.reason;
    }
    registry.updated = new Date().toISOString().slice(0, 10);
    const tmp = REGISTRY + ".tmp";
    writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf8");
    renameSync(tmp, REGISTRY);
  }
  writeAsciiJson({ stale, applied: apply && stale.length > 0 });
  process.exit(0);
}

console.error("[cluster-claim] usage: claim|release|done|propose|audit");
process.exit(2);
