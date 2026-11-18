#!/usr/bin/env node
/**
 * cards:coverage — カード effects 変換カバレッジの機械集計。
 *
 * 「全カード完全実装」の measurable な残量と停止条件の正源。弾ごとの散文メモでは
 * 残量が測れないため、ALL_CARDS を実際に読み、textLines の効果マーカー有無と
 * effects 配列の有無から表裏それぞれを 3 分類して集計する。
 * backFace と nested effects も対象。ALL_CARDS 自体（デッキ構築プール）は変更しない。
 *
 * 分類:
 *   - done    : 効果テキストあり (needsEffects) かつ effects 配列が非空
 *   - todo    : 効果テキストあり (needsEffects) だが effects 未設定 → 変換対象
 *   - vanilla : 効果テキストなし → 変換不要 (バニラ / リマインダーのみ)
 *
 * done は従来の変換率指標を維持する。完全性は別の auditIssues で監査し、明示 stub /
 * 壊れた効果構造は violation、全文未帰属 / 空の実装は review として根拠を残す。
 * textRef は本文との構造的な対応であり、意味的な実装の証明とは扱わない。
 *
 * 注意2: vanilla 判定(EFFECT_MARKER 非一致)なのに effects が既に非空のカードは、
 * マーカー正規表現の見落とし濃厚(過去実例: BSTH01-C01「このカード/スピリットのコストは
 * 3としても扱う。」= 見出し無し単一行継続効果、issues/P3-16 residual-risks.md)。
 * vanilla/done のバケット分類・件数はそのまま(gate 契約を変えない)で、
 * vanillaWithEffectsCards として別枠監査表示する (gate 対象外、マーカー拡張はしない
 * 方針 = これ以上広げると過検知リスクが上がるため個別把握に留める)。
 *
 * Usage:
 *   node scripts/cards-coverage.mjs                # 集計表 + card-coverage.json 出力
 *   node scripts/cards-coverage.mjs --gate         # todo または violation が残れば exit 1
 *   node scripts/cards-coverage.mjs --set BSAZ03   # 指定弾の todo cardNo を全列挙
 *   node scripts/cards-coverage.mjs --json         # JSON のみ stdout (機械処理用)
 */

import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { applyReviewResolutions } from "./fidelity-review-state.mjs";
import { auditStateFingerprint } from "./audit-inputs.mjs";
import { findOracleTriggerKindIssues } from "./oracle-trigger-kind-detector.mjs";
import {
  CARD_EFFECT_MARKER as EFFECT_MARKER,
  STRUCTURED_CARRIER_SPECS,
  buildTextAccountabilityLedger,
  collectCardFaces,
  collectEffectContainers,
} from "./card-text-accountability-core.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SCRIPT_DIR, "..");

const args = process.argv.slice(2);
const GATE = args.includes("--gate");
const JSON_ONLY = args.includes("--json");
const SET_FILTER = (() => {
  const i = args.indexOf("--set");
  return i >= 0 ? args[i + 1] : null;
})();

// supervisor の PowerShell は Node stdout をコンソールコードページ経由で受け取る。
// card text を含む JSON をそのまま渡すと、CP932/UTF-8 が混在する環境で
// ConvertFrom-Json が壊れることがある。--json は機械連携専用なので ASCII に固定する。
function stringifyMachineJson(value) {
  return JSON.stringify(value, null, 2)
    .split("")
    .map((char) =>
      char.charCodeAt(0) <= 0x7f
        ? char
        : "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0")
    )
    .join("");
}

const log = (...m) => {
  if (!JSON_ONLY) console.log(...m);
};

// 効果テキストの存在を示すマーカー。■=効果行, 【】=キーワード/タイミング能力,
// フラッシュ/スタック=タイミング, 〔〕=制限/条件注記, 『』=単独タイミング見出し
// （Lv1-Lv2『◯◯時』のように■や【】を伴わず効果本文が続く形式）,
// Lv\d=角括弧なしのレベル見出し, メイン=作戦カードのメイン効果見出し。
// いずれも無ければバニラ扱い（ただし継続効果が見出し無しの単一行のみで
// 記述されるカードは既知の残存誤検出、詳細 issues/P3-16 residual-risks）。

function classify(card) {
  const lines = Array.isArray(card.textLines) ? card.textLines : [];
  const text = lines.join("\n");
  const needsEffects = EFFECT_MARKER.test(text);
  const effLen = knownContainers(card).reduce(
    (sum, container) => sum + container.effects.length,
    0
  );
  const hasEffects = effLen > 0;
  if (!needsEffects) return { status: "vanilla", effLen, markerLines: 0 };
  if (!hasEffects) return { status: "todo", effLen, markerLines: 0 };
  // 部分 stub の弱いシグナル: ■ 行数が effects 数を大きく上回る
  const markerLines = lines.filter((l) =>
    /■|フラッシュ|スタック/.test(l)
  ).length;
  return { status: "done", effLen, markerLines };
}

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// 不正な mechanic 構造も JSON レポートで返す。正しい定義の列挙は共通 SSOT のまま。
function knownContainers(face) {
  try {
    return collectEffectContainers(face);
  } catch {
    return collectEffectContainers({ ...face, grandwalkerData: undefined });
  }
}

/**
 * 変換済み件数とは別に、各面の構造と全文対応を監査する。
 * ledger の carrier / general_rule は帰属の根拠としてのみ使用する。その契約テストの
 * 検証は card-text-accountability-audit の責務であり、ここで完了の証明へ格上げしない。
 * baseline / override を渡さず、既知の未帰属本文も fullrun の原文確認対象へ渡す。
 */
export function collectCoverageFindings(cards) {
  const issues = [];
  for (const { cardNo, face, parentFace } of cards.flatMap(collectCardFaces)) {
    const lines = Array.isArray(face.textLines) ? face.textLines : [];
    const containers = knownContainers(face);
    const knownPaths = new Set(containers.map(({ path }) => path));
    const add = (kind, severity, effectPath, textRef, detail, extra = {}) => {
      const refs = Array.isArray(textRef) ? textRef : [];
      issues.push({
        cardNo,
        kind,
        severity,
        effectPath,
        textRef: refs,
        detail,
        evidence: {
          sourceLines: refs
            .filter(
              (index) =>
                Number.isInteger(index) && index >= 0 && index < lines.length
            )
            .map((index) => ({ index, text: lines[index] })),
          ...extra,
        },
      });
    };
    if (face.textLines !== undefined && !Array.isArray(face.textLines)) {
      add(
        "invalid_text_lines",
        "violation",
        "textLines",
        [],
        "textLines must be an array."
      );
    }
    for (const {
      kind,
      textRef,
      detail,
      ...evidence
    } of findOracleTriggerKindIssues(face))
      add(
        kind,
        "violation",
        "grandwalkerData.oracleTriggerKinds",
        textRef,
        detail,
        evidence
      );
    try {
      collectEffectContainers(face);
    } catch (error) {
      add(
        "invalid_mechanic_structure",
        "violation",
        "grandwalkerData.divineSkills",
        [],
        "The shared effect-container enumerator cannot inspect this mechanic structure.",
        { reason: String(error.message) }
      );
    }
    let entries = [];
    try {
      entries = buildTextAccountabilityLedger({
        cards: [
          {
            ...face,
            cardNo,
            textLines: lines,
            ...(parentFace !== undefined
              ? { __accountabilityParentFace: parentFace }
              : {}),
          },
        ],
        allCards: cards,
      }).entries.filter((entry) => entry.id.startsWith(`${cardNo}:textLines[`));
      // Keep the complete definition for carrier checks (e.g. stone rebirth
      // requires backFace). Only this face's findings belong to this iteration;
      // the outer collectCardFaces loop audits the back face separately once.
    } catch (error) {
      add(
        "text_accountability_unavailable",
        "review",
        "textLines",
        lines.map((_, index) => index),
        "Source attribution could not finish; inspect the source lines and malformed metadata.",
        { reason: String(error.message), semanticStatus: "not_assessed" }
      );
    }
    const nestedSourceRefs = new Set();
    const carrierEvidence = (refs) =>
      refs.flatMap((index) =>
        STRUCTURED_CARRIER_SPECS.flatMap((spec) => {
          try {
            return spec.matches(
              face,
              String(lines[index] ?? ""),
              parentFace,
              index,
              cards
            )
              ? [{ index, carrierPath: spec.carrierPath }]
              : [];
          } catch {
            return [];
          }
        })
      );
    const validateRefs = (effect, path, inheritedRefs) => {
      if (effect.textRef === undefined) {
        if (!inheritedRefs.length)
          add(
            "missing_text_ref",
            "review",
            path,
            [],
            "This effect has no source-line reference; implementation meaning requires source comparison."
          );
        return inheritedRefs;
      }
      if (!Array.isArray(effect.textRef)) {
        add(
          "invalid_text_ref",
          "violation",
          path,
          [],
          "textRef must be an array of source-line indices.",
          { actual: effect.textRef }
        );
        return inheritedRefs;
      }
      const invalidRefs = effect.textRef.filter(
        (index) =>
          !Number.isInteger(index) || index < 0 || index >= lines.length
      );
      for (const index of effect.textRef) {
        if (Number.isInteger(index) && index >= 0 && index < lines.length)
          nestedSourceRefs.add(index);
      }
      if (invalidRefs.length)
        add(
          "invalid_text_ref",
          "violation",
          path,
          effect.textRef,
          "textRef includes a non-integer or out-of-range source-line index.",
          { invalidRefs }
        );
      if (!effect.textRef.length && !inheritedRefs.length)
        add(
          "missing_text_ref",
          "review",
          path,
          [],
          "This effect has an empty source-line reference."
        );
      return effect.textRef.length ? effect.textRef : inheritedRefs;
    };
    const auditStep = (step, path, refs, kinds) => {
      if (!isObject(step)) {
        add(
          "invalid_effect_step",
          "violation",
          path,
          refs,
          "An effect step must be an object."
        );
        return;
      }
      if (
        !isObject(step.action) ||
        typeof step.action.kind !== "string" ||
        !step.action.kind.trim()
      ) {
        add(
          "invalid_effect_action",
          "violation",
          `${path}.action`,
          refs,
          "An effect step must carry an action with a nonempty kind."
        );
      } else kinds.push(step.action.kind);
      if (step.choice !== undefined) {
        if (!Array.isArray(step.choice))
          add(
            "invalid_effect_choice",
            "violation",
            `${path}.choice`,
            refs,
            "Step choice must be an array of effect steps."
          );
        else
          step.choice.forEach((choice, index) =>
            auditStep(choice, `${path}.choice[${index}]`, refs, kinds)
          );
      }
    };
    const auditEffect = (effect, path, inheritedRefs) => {
      if (!isObject(effect)) {
        add(
          "invalid_effect",
          "violation",
          path,
          inheritedRefs,
          "An effect must be an object."
        );
        return inheritedRefs;
      }
      const refs = validateRefs(effect, path, inheritedRefs);
      if (
        !isObject(effect.timing) ||
        typeof effect.timing.kind !== "string" ||
        !effect.timing.kind.trim()
      ) {
        add(
          "invalid_effect_timing",
          "violation",
          `${path}.timing`,
          refs,
          "An effect must declare a timing with a nonempty kind."
        );
      }
      if (typeof effect.stub === "string" && effect.stub.trim()) {
        add(
          "explicit_stub",
          "violation",
          path,
          refs,
          "This effect explicitly declares an implementation stub.",
          { stub: effect.stub }
        );
      }
      if (!Array.isArray(effect.steps)) {
        add(
          "invalid_effect_steps",
          "violation",
          path,
          refs,
          "Effect steps must be an array."
        );
      } else if (!effect.steps.length) {
        const carriers = carrierEvidence(refs);
        // declaration-only effect は、各 textRef が structured carrier によって
        // 個別に実行経路と回帰へ結び付く場合だけ完結する。carrier が一部だけ、または
        // 一切無い空 steps は従来どおり review に残し、textRef だけで隠さない。
        const allRefsCoveredByCarriers =
          refs.length > 0 &&
          refs.every((index) =>
            carriers.some((carrier) => carrier.index === index)
          );
        if (!allRefsCoveredByCarriers)
          add(
            "empty_effect_steps",
            "review",
            path,
            refs,
            "No action is encoded here; compare the text with mechanic or top-level declaration handling.",
            { carriers, semanticStatus: "not_assessed" }
          );
      } else {
        const kinds = [];
        effect.steps.forEach((step, index) =>
          auditStep(step, `${path}.steps[${index}]`, refs, kinds)
        );
        if (kinds.length && kinds.every((kind) => kind === "noop"))
          add(
            "noop_only_effect",
            "review",
            path,
            refs,
            "Only noop actions are present; verify selection bookkeeping or external mechanic handling.",
            {
              actionKinds: kinds,
              carriers: carrierEvidence(refs),
              semanticStatus: "not_assessed",
            }
          );
      }
      return refs;
    };
    // Discover malformed/future containers too, without duplicating the shared mechanic-path list.
    // Only Effect.steps and EffectStep.choice use the V2 schema; arbitrary action.steps can be V1.
    const walk = (value, path, refs = []) => {
      if (!isObject(value) && !Array.isArray(value)) return;
      for (const [key, child] of Object.entries(value)) {
        if (key === "backFace") continue;
        const childPath = Array.isArray(value)
          ? `${path}[${key}]`
          : path
            ? `${path}.${key}`
            : key;
        if (key === "effects") {
          if (!Array.isArray(child)) {
            add(
              "invalid_effect_container",
              "violation",
              childPath,
              refs,
              "An effects container must be an array."
            );
            continue;
          }
          if (!child.length && EFFECT_MARKER.test(lines.join("\n"))) {
            add(
              "empty_effect_container",
              "review",
              childPath,
              refs,
              "This container has no effects; verify whether a declaration-only mechanic covers its text.",
              { knownContainer: knownPaths.has(childPath) }
            );
          }
          if (child.length && !knownPaths.has(childPath) && !refs.length) {
            add(
              "unregistered_effect_container",
              "review",
              childPath,
              refs,
              "The shared top-level/mechanic coverage enumerator does not include this effect container."
            );
          }
          child.forEach((effect, index) => {
            const effectPath = `${childPath}[${index}]`;
            const effectRefs = auditEffect(effect, effectPath, refs);
            walk(effect, effectPath, effectRefs);
          });
        } else if (key === "grantedEffect") {
          const effectRefs = auditEffect(child, childPath, refs);
          walk(child, childPath, effectRefs);
        } else walk(child, childPath, refs);
      }
    };
    walk(face, "");
    for (const entry of entries) {
      if (entry.source !== "unclaimed") continue;
      const index = Number(/textLines\[(\d+)\]$/.exec(entry.id)?.[1]);
      // The ledger enumerates the shared top-level/mechanic paths. Explicit nested
      // grantedEffect textRef is also structural attribution, never semantic proof.
      if (nestedSourceRefs.has(index)) continue;
      add(
        "unaccounted_text_line",
        "review",
        `textLines[${index}]`,
        [index],
        "No effect textRef, structured carrier, or general rule accounts for this full source line.",
        {
          ledgerId: entry.id,
          source: entry.source,
          textHash: entry.textHash,
          executionLike: entry.executionLike,
          semanticStatus: "not_assessed",
        }
      );
    }
  }
  return issues;
}

function setOf(cardNo) {
  // "BSAZ03-C01" -> "BSAZ03"
  const m = /^([A-Z]+\d+(?:\.\d+)?)/.exec(cardNo || "");
  return m ? m[1] : "OTHER";
}

async function loadCards() {
  const fixture = process.env.ORICA_CARDS_COVERAGE_FIXTURE_JSON;
  if (fixture) {
    const cards = JSON.parse(fixture);
    if (!Array.isArray(cards))
      throw new Error("ORICA_CARDS_COVERAGE_FIXTURE_JSON must be an array");
    return cards;
  }
  // dist が stale だと誤判定するため、card-data を incremental build してから読む。
  log("[cards:coverage] building @orica/card-data ...");
  try {
    execSync("npx tsc -b packages/card-data", { cwd: ROOT, stdio: "pipe" });
  } catch (e) {
    console.error(
      "[cards:coverage] build failed:\n" + (e.stdout || e).toString()
    );
    process.exit(2);
  }

  const distUrl = pathToFileURL(
    join(ROOT, "packages/card-data/dist/generated-index.js")
  ).href;
  const { ALL_CARDS } = await import(distUrl);
  return ALL_CARDS;
}

export function buildCoverageReport(ALL_CARDS) {
  const bySet = new Map();
  const todoCards = [];
  const reviewCards = [];
  const vanillaWithEffectsCards = [];

  for (const { cardNo, face } of ALL_CARDS.flatMap(collectCardFaces)) {
    const card = { ...face, cardNo };
    const set = setOf(card.cardNo);
    const c = classify(card);
    if (!bySet.has(set))
      bySet.set(set, { set, done: 0, todo: 0, vanilla: 0, total: 0 });
    const row = bySet.get(set);
    row.total++;
    row[c.status]++;
    if (c.status === "todo") todoCards.push(card.cardNo);
    if (c.status === "done" && c.markerLines > Math.max(c.effLen, 1) + 1)
      reviewCards.push({
        cardNo: card.cardNo,
        markerLines: c.markerLines,
        effLen: c.effLen,
      });
    // vanilla(EFFECT_MARKER 非一致)なのに effects が既に実装済み = マーカー正規表現の
    // 見落とし濃厚（issues/P3-16 residual-risks.md「BSTH01-C01」参照）。マーカーをこれ以上
    // 広げると過検知リスクが上がるため個別対応方針だが、同種カードの見落としを機械検知する。
    if (c.status === "vanilla" && c.effLen > 0)
      vanillaWithEffectsCards.push({ cardNo: card.cardNo, effLen: c.effLen });
  }

  const sets = [...bySet.values()].sort((a, b) => a.set.localeCompare(b.set));
  const totals = sets.reduce(
    (acc, s) => {
      acc.done += s.done;
      acc.todo += s.todo;
      acc.vanilla += s.vanilla;
      acc.total += s.total;
      return acc;
    },
    { done: 0, todo: 0, vanilla: 0, total: 0 }
  );
  const convertible = totals.done + totals.todo;
  const pct = convertible
    ? ((totals.done / convertible) * 100).toFixed(1)
    : "100.0";

  const auditIssues = collectCoverageFindings(ALL_CARDS);
  const auditViolationCount = auditIssues.filter(
    ({ severity }) => severity === "violation"
  ).length;
  const auditReviewCount = auditIssues.length - auditViolationCount;
  return {
    generatedBy: "scripts/cards-coverage.mjs",
    totals: { ...totals, convertible, donePct: Number(pct) },
    sets,
    todoCount: todoCards.length,
    todoCards,
    reviewCount: reviewCards.length,
    vanillaWithEffectsCount: vanillaWithEffectsCards.length,
    vanillaWithEffectsCards,
    auditIssues,
    auditViolationCount,
    auditReviewCount,
    complete: totals.todo === 0 && auditViolationCount === 0,
  };
}

async function main() {
  const inputState = process.env.ORICA_CARDS_COVERAGE_FIXTURE_JSON
    ? null
    : auditStateFingerprint(ROOT);
  const cards = await loadCards();
  const report = buildCoverageReport(cards);
  const reviewState = applyReviewResolutions(cards, report.auditIssues);
  report.rawAuditReviewCount = report.auditReviewCount;
  report.auditIssues = reviewState.pending;
  report.confirmedAuditReviews = reviewState.confirmed;
  report.confirmedAuditReviewCount = reviewState.confirmed.length;
  report.auditReviewCount -= reviewState.confirmed.length;
  report.reviewContextFingerprint = reviewState.contextFingerprint;
  if (inputState && auditStateFingerprint(ROOT) !== inputState)
    throw new Error("Audit inputs changed during coverage measurement");
  report.auditStateFingerprint = inputState;
  const { totals, sets, todoCards, vanillaWithEffectsCards } = report;
  const gateIncomplete = SET_FILTER
    ? todoCards.some((cardNo) => setOf(cardNo) === SET_FILTER) ||
      report.auditIssues.some(
        ({ cardNo, severity }) =>
          severity === "violation" && setOf(cardNo) === SET_FILTER
      )
    : !report.complete;

  // JSON は常に書き出す (scheduled loop / 進捗追跡の入力)
  if (process.env.ORICA_CARDS_COVERAGE_NO_WRITE !== "1") {
    writeFileSync(
      join(ROOT, "card-coverage.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
  }

  if (JSON_ONLY) {
    process.stdout.write(stringifyMachineJson(report) + "\n");
    process.exit(GATE && gateIncomplete ? 1 : 0);
  }

  if (SET_FILTER) {
    const inSet = todoCards.filter((n) => setOf(n) === SET_FILTER);
    log(`\n[${SET_FILTER}] todo cards (${inSet.length}):`);
    for (const n of inSet) log("  " + n);
    const findings = report.auditIssues.filter(
      ({ cardNo }) => setOf(cardNo) === SET_FILTER
    );
    for (const issue of findings)
      log(
        `  ${issue.severity}: ${issue.cardNo} ${issue.effectPath} ${issue.kind}`
      );
    process.exit(GATE && gateIncomplete ? 1 : 0);
  }

  log("\n=== カード effects 変換カバレッジ ===");
  log("set          done  todo  vanilla  total  done%(of convertible)");
  for (const s of sets) {
    const conv = s.done + s.todo;
    const p = conv ? ((s.done / conv) * 100).toFixed(0) : "—";
    const mark = s.todo > 0 ? "  ◀ 残" : "";
    log(
      `${s.set.padEnd(12)} ${String(s.done).padStart(4)}  ${String(s.todo).padStart(4)}  ${String(s.vanilla).padStart(7)}  ${String(s.total).padStart(5)}  ${String(p).padStart(4)}%${mark}`
    );
  }
  log("-".repeat(60));
  log(
    `TOTAL        ${String(totals.done).padStart(4)}  ${String(totals.todo).padStart(4)}  ${String(totals.vanilla).padStart(7)}  ${String(totals.total).padStart(5)}  ${totals.donePct.toFixed(1)}%`
  );
  log(
    `\n変換対象 (todo): ${todoCards.length} 枚 / 変換済み: ${totals.done} / バニラ: ${totals.vanilla}`
  );
  log(`部分 stub の疑い (要レビュー, 低信頼度): ${report.reviewCount} 枚`);
  log(
    `全文・効果構造監査: violation ${report.auditViolationCount} / review ${report.auditReviewCount}`
  );
  if (vanillaWithEffectsCards.length > 0) {
    log(
      `⚠ vanilla判定だがeffects実装済み (EFFECT_MARKER見落とし濃厚): ${vanillaWithEffectsCards.length} 枚`
    );
    for (const c of vanillaWithEffectsCards)
      log(`  ${c.cardNo} (effects×${c.effLen})`);
  }
  log(
    `停止条件 (todo===0 && auditViolationCount===0): ${report.complete ? "✅ 達成" : "❌ 未達"}`
  );
  if (process.env.ORICA_CARDS_COVERAGE_NO_WRITE !== "1")
    log(`\ncard-coverage.json を出力しました。`);

  process.exit(GATE && gateIncomplete ? 1 : 0);
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
