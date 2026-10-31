#!/usr/bin/env node
/**
 * cards:fidelity — カード effects 変換の忠実度監査。
 *
 * coverage の従来の done 率と、忠実度の判定は別指標（100% ≠ 完全実装）。
 * coverage は構造/全文帰属、本監査は本文とDSLの対応を検査する。
 * 静的に確定できる違反と原文確認候補を分離し、いずれもフルランへ渡す。
 *
 * 検出項目:
 *   1. stubEffects   : effects[].stub フィールド持ち（明示的な未表現宣言）
 *   2. uncoveredLines: 表裏の効果マーカー行 (■/フラッシュ/スタック/タイミング見出し/メイン) のうち、どの effect の
 *                      textRef にも（当該行 or 直後の行が）含まれない行 → 変換漏れの疑い
 *   3. noTextRef     : effects はあるが textRef が 1 つも無いカード（帰属判定不能）
 *   4. symbolMismatch: 印字 symbolColors / reductionSymbols が外部ミラー
 *                      (external-qa/cardData.js) の symbol / reduction と不一致
 *                      → 印字データの入力ミス検出（P3-94）。ミラー不在時はスキップ
 *                      （gate に影響しない。external-qa は gitignore）。
 *   5. optionalWording (warn): textRef 行に可能形（できる/戻せる/置ける/加えられる/
 *                      入れ替えられる/裏返せる/払える 等）を含む non-stub effect のうち、
 *                      executionMode:"optional" / target.count.min:0 / choice /
 *                      conditional_cost 等の任意表現を一切持たないものを列挙（P3-96）。
 *                      裁定 2026-06-12「できる=任意」一般則の機械監査。**warn のみ**で
 *                      gate には影響しない（誤検出が多いため。能力付与「アタックできる」
 *                      等は exception 登録）。
 *   6. continuityWording (warn): textRef 行が「Xを満たしている間、フィールドに置き」型
 *                      イディオムを含む effect を列挙（2026-07-18, BSLH01-T07..T17 由来）。
 *                      常時/誘発の分類根拠は「発揮開始タイミング語彙(『〜時』見出し等)の
 *                      有無」であり「置き/置ける」の強制/任意ではない（誤って後者を根拠に
 *                      した実例が本件、qa-016 が前者の基準を裏付ける）。正誤は判定せず
 *                      注意喚起のみの **warn**（gate 非影響）。
 *   7. immunityZoneScope: 自己「このカードは相手の効果を受けない」型で本文にゾーン限定が
 *                      無いのに applicability.zone が公開/使用中 zone の明示列挙になっていない
 *                      ものを検出。`anywhere` や deck への過拡張を防ぐ。
 *   8. effectOptionality: 先頭任意文 + 後続依存文なのに effect.executionMode が
 *                      optional ではないもの、または effect-level optional の先頭 step に
 *                      redundant な executionMode optional を重ねたものを検出
 *                      （2026-08-09 ユーザー裁定）。
 *   9. countOptionalStep: 「自分のカウント0のとき、自分のカウント+1できる。」が
 *                      複数 step effect 内で count_increase step optional/prompt に
 *                      結び直されていないものを検出（BSSA01-C01/C03 再発防止）。
 *  10. semanticConstraints / semanticFlow: 回数・支払い・対象境界・処理順序・二択・
 *                      継続期間を参照本文と照合。明確な矛盾は violations、対応が曖昧な
 *                      候補は semanticReviews（gate 非影響）。カード番号の例外は使わない。
 *
 * 除外: scripts/fidelity-ignore.json（{"<cardNo>": {"lines": [idx...], "reason": "..."}}）。
 * 監査済み・誤検出と確認した行のみ理由付きで登録する。stub は除外不可（解消が完了条件）。
 * symbolMismatch の除外: scripts/symbol-audit-exceptions.json
 *   （{"<cardNo>": {"aspects": ["symbol"|"reduction"], "reason": "..."}}）。
 *   ミラー側の転記ミスをカード画像で確認したカードのみ理由付きで登録する。
 * optionalWording の除外: scripts/optional-wording-exceptions.json
 *   （{"<cardNo>": {"effectIndexes": [i...], "reason": "..."}}）。能力付与・継続効果・
 *   分割実装等の false positive を理由付きで登録する。
 * continuityWording の除外: scripts/continuity-wording-exceptions.json
 *   （{"<cardNo>": {"reason": "..."}}）。カード全文単位の warn のため effectIndexes
 *   は無い。常時/誘発の分類を確認済み（03c + qa-016 参照済み）のカードのみ
 *   理由付きで登録する。
 *
 * Usage:
 *   node scripts/cards-fidelity-audit.mjs           # 集計表 + fidelity-audit.json 出力
 *   node scripts/cards-fidelity-audit.mjs --gate    # 違反が残れば exit 1 (停止条件用)
 *   node scripts/cards-fidelity-audit.mjs --json    # JSON のみ stdout
 *   node scripts/cards-fidelity-audit.mjs --set BSDB01  # 指定弾の違反詳細を列挙
 */

import {
  normalizeMirrorSymbols,
  normalizeSymbolEntries,
} from "./printed-symbol-audit.mjs";
import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import {
  hasOptionalWording,
  hasOptionalExpression,
} from "./optional-wording-detector.mjs";
import {
  findCountZeroOptionalCountStepIssues,
  findEffectLevelOptionalityIssue,
  findRedundantRootStepOptionalityIssue,
} from "./effect-optionality-detector.mjs";
import { hasContinuityPlacementWording } from "./continuity-wording-detector.mjs";
import { findSoulCoreExclusionViolation } from "./soul-core-exclusion-detector.mjs";
import { findInertFilterFields } from "./inert-filter-field-detector.mjs";
import {
  REQUIRED_SELF_IMMUNITY_ZONES,
  hasUnboundedSelfEffectImmunityWording,
  normalizeApplicabilityZoneList,
} from "./immunity-zone-scope-detector.mjs";
import { findPutActionSemanticIssues } from "./put-action-semantics-detector.mjs";
import {
  collectUsageLimitCarriers,
  findConstraintFidelityIssues,
} from "./fidelity-constraint-detector.mjs";
import { findFlowFidelityIssues } from "./fidelity-flow-detector.mjs";
import { applyReviewResolutions } from "./fidelity-review-state.mjs";
import { auditStateFingerprint, loadAuditMirror } from "./audit-inputs.mjs";
import { findOracleTriggerKindIssues } from "./oracle-trigger-kind-detector.mjs";
import {
  CARD_EFFECT_MARKER as EFFECT_MARKER,
  collectCardFaces,
  collectEffectContainers,
} from "./card-text-accountability-core.mjs";

// A nested granted Effect owns its textRef. Resolve only the reported path,
// rather than re-enumerating effect containers or attributing its text to the parent.
function semanticSource(effect, rootPath, issuePath) {
  const relative = (issuePath ?? "").replace(/^\$\.?/, "");
  let value = effect;
  let currentPath = rootPath;
  let effectPath = rootPath;
  let textRef = effect?.textRef ?? [];
  for (const key of relative.match(/[^.[\]]+/g) ?? []) {
    currentPath += Array.isArray(value) ? `[${key}]` : `.${key}`;
    value = value?.[key];
    if (value?.timing && Array.isArray(value.steps)) {
      effectPath = currentPath;
      textRef = value.textRef ?? textRef;
    }
  }
  return {
    effectPath,
    textRef,
    path: relative ? `${rootPath}.${relative}` : rootPath,
  };
}

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

const LINE_MARKER =
  /■|フラッシュ|スタック|^(?:Lv\d(?:-Lv\d)*\s*)?(?:【[^】]*】\s*)?『|^メイン$/;
// 煌臨/契約煌臨/超契約煌臨 の宣言ヘッダ行（例「フラッシュ【契約煌臨：「X」『…』】」）。
// 煌臨の宣言は CardDefinition.adventData（declare_advent 配線済み）が表現し、effects[].textRef
// には現れない。adventData を持つカードのこのヘッダ行は covered とみなす（後述の skip）。
const ADVENT_HEADER = /【[^】]*煌臨[：:]/;
// 顕現の宣言ヘッダ行（例「フラッシュ【顕現：「アリス」&導界者ネクサス&C2以上『自分の
// メインステップ』】」）。ADVENT_HEADER と同型: CardDefinition.manifestData
// （declare_manifest 配線済み）が表現し、effects[].textRef には現れない。
const MANIFEST_HEADER = /【顕現[：:]/;
// 神技/導技/契約技/転者/転神 等の起動効果（divineSkills）宣言ヘッダ行
// （例「【導技：4】Lv1-Lv2 フラッシュ『お互いのアタックステップ』」）。これらは
// CardDefinition.grandwalkerData.divineSkills が表現し effects[].textRef には現れない。
// adventData ヘッダと同様、divineSkills を持つカードのこのヘッダ行は covered とみなす。
// マスクではない: divineSkills 未実装のカードは依然 uncovered として顕在化する。
const DIVINE_SKILL_HEADER = /【(?:神技|導技|契約技|転者|転神)[：:】]/;
// 契約合体キーワード宣言ヘッダ行（例「フラッシュ【契約合体：GE＆赤／紫『自分のターン』】」）。
// CardDefinition.contractCombineData が braveCondition/timingScope を表現し、effects[].textRef
// には現れない（adventData ヘッダと同型。contractCombineData 未実装のカードは依然 uncovered
// として顕在化する。P3-111 S2）。
const CONTRACT_COMBINE_HEADER = /【契約合体[：:]/;
// アクセル宣言ヘッダ行（例「フラッシュ【アクセル：コスト5<赤><赤><赤><神>（この効果は
// 手札から使用できる）】」）。ADVENT_HEADER と同型: CardDefinition.accelData
// (timing/cost/reduction) がヘッダを表現し、本体効果は accelData.effects[].textRef に
// 現れるため card.effects[].textRef には現れない。accelData 未実装のカードは依然
// uncovered として顕在化する（マスクではない）。
const ACCEL_HEADER = /【アクセル[：:]/;
// チェンジ/コントラクトチェンジ宣言ヘッダ行。CardDefinition.changeData
// (cost/reduction/swapCondition) がヘッダを表現し、本体効果は changeData.effects[] で
// nested container として stub/任意文言等を監査する。
const CHANGE_HEADER = /【(?:コントラクトチェンジ|チェンジ)[：:]/;
// 神託/導託の宣言ヘッダ行（例「【神託：〔依神＆ネクサス〕〔スタック効果＆マジック〕】」）。
// CardDefinition.grandwalkerData.oracleConditions が条件を表現し、oracle-system が
// 召喚/煌臨/配置/使用時と配置時神託の実行を担う。
const ORACLE_HEADER = /【(?:神託|導託)[：:]/;
const ORACLE_HEADER_EXTRA_CONSTRAINT =
  /ステップに1回|ターンに1回|ゲームに[0-9０-９一二三四五六七八九十]+回|同名/;
const BLUE_MAGIC_STACK_DOMAIN_LINE =
  /青のマジックカードのスタック効果が発揮されたとき.*デッキを上から4枚破棄.*ボイドからコア1個/;

function oracleHeaderCoveredByGrandwalkerData(card, line) {
  if (!card.grandwalkerData?.oracleConditions?.length) return false;
  if (
    /ステップに1回/.test(line) &&
    card.grandwalkerData.oracleTriggerLimit === "step_once"
  ) {
    const remaining = line.replace(
      /〔召喚[／/]煌臨での導託はステップに1回〕/g,
      ""
    );
    return !ORACLE_HEADER_EXTRA_CONSTRAINT.test(remaining);
  }
  return !ORACLE_HEADER_EXTRA_CONSTRAINT.test(line);
}

function blueMagicStackDomainCoveredByGrandwalkerData(card, line) {
  return (
    card.grandwalkerData?.kind === "grandwalker" &&
    card.grandwalkerData.domainHooks?.includes("blue_magic_stack_domain") &&
    BLUE_MAGIC_STACK_DOMAIN_LINE.test(line)
  );
}

function setOf(cardNo) {
  const m = /^([A-Z]+\d+(?:\.\d+)?)/.exec(cardNo || "");
  return m ? m[1] : "OTHER";
}

function loadIgnore() {
  const p = join(SCRIPT_DIR, "fidelity-ignore.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadSymbolExceptions() {
  const p = join(SCRIPT_DIR, "symbol-audit-exceptions.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

function loadOptionalWordingExceptions() {
  const p = join(SCRIPT_DIR, "optional-wording-exceptions.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

// P3-96 任意文言検出: scripts/optional-wording-detector.mjs に分離 (テスト容易性のため)

function loadContinuityWordingExceptions() {
  const p = join(SCRIPT_DIR, "continuity-wording-exceptions.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

// 継続/誘発 分類ミス再発防止検出: scripts/continuity-wording-detector.mjs に分離

function loadInertFilterFieldExceptions() {
  const p = join(SCRIPT_DIR, "inert-filter-field-exceptions.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

// 不活性フィルタフィールド検出: scripts/inert-filter-field-detector.mjs に分離

function loadSoulCoreExclusionExceptions() {
  const p = join(SCRIPT_DIR, "soul-core-exclusion-exceptions.json");
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8"));
}

// 《ソウルコア》以外 → effectKind:"normal_only" 必須検出:
// scripts/soul-core-exclusion-detector.mjs に分離

// 外部ミラー (external-qa/cardData.js) の印字値正源。日本語シンボル名 → SymbolColor enum。
async function loadAllCardsForAudit() {
  const fixtureJson = process.env.ORICA_CARDS_FIDELITY_AUDIT_FIXTURE_JSON;
  if (fixtureJson) {
    const parsed = JSON.parse(fixtureJson);
    if (!Array.isArray(parsed)) {
      throw new Error(
        "ORICA_CARDS_FIDELITY_AUDIT_FIXTURE_JSON must be an array"
      );
    }
    log("[cards:fidelity] using fixture cards from env");
    return parsed;
  }

  log("[cards:fidelity] building @orica/card-data ...");
  try {
    execSync("npx tsc -b packages/card-data", { cwd: ROOT, stdio: "pipe" });
  } catch (e) {
    console.error(
      "[cards:fidelity] build failed:\n" + (e.stdout || e).toString()
    );
    process.exit(2);
  }

  const distUrl = pathToFileURL(
    join(ROOT, "packages/card-data/dist/generated-index.js")
  ).href;
  const { ALL_CARDS } = await import(distUrl);
  return ALL_CARDS;
}

async function main() {
  const inputState = process.env.ORICA_CARDS_FIDELITY_AUDIT_FIXTURE_JSON
    ? null
    : auditStateFingerprint(ROOT);
  const ALL_CARDS = await loadAllCardsForAudit();
  const ignore = loadIgnore();
  const owExceptions = loadOptionalWordingExceptions();
  const cwExceptions = loadContinuityWordingExceptions();
  const scExceptions = loadSoulCoreExclusionExceptions();
  const ifExceptions = loadInertFilterFieldExceptions();

  const bySet = new Map();
  const violations = []; // { cardNo, kind, detail }
  const warnings = []; // { cardNo, kind, detail } — gate に影響しない
  const rawSemanticReviews = [];

  // bySet の get-or-create（stub 監査を EFFECT_MARKER skip より前に動かす際、
  // 集計行の遅延生成を共有するための helper）。
  const getRow = (cardNo) => {
    const set = setOf(cardNo);
    if (!bySet.has(set)) {
      bySet.set(set, {
        set,
        stub: 0,
        uncovered: 0,
        noTextRef: 0,
        symMismatch: 0,
        immunityZoneScope: 0,
        effectOptionality: 0,
        countOptionalStep: 0,
        putActionSemantics: 0,
        semantic: 0,
      });
    }
    return bySet.get(set);
  };

  // card_event executionMode 監査用 helper (10_rules/03c ruling C 2026-06-24)。
  // findRevealedEffect (省略時 optional) と findMovedToTrashAutoEffect (省略時 mandatory) の
  // 既定が経路別で非対称。書き忘れ silent miss を CI で機械検知する。
  // 対象: timing.kind === "card_event" かつ event に "revealed" or "moved_to_trash" を含む
  // effect で executionMode が undefined のとき fail。stub があっても skip しない
  // (card_event 文脈で stub silent miss 許容しない)。other card_event 種別 (attack/advent/summon
  // 等) は getEffectExecutionMode (default mandatory) 経路で対称のため対象外。
  const ASYMMETRIC_EVENTS = new Set(["revealed", "moved_to_trash"]);
  const auditCardEventExecutionMode = (
    auditCardNo,
    auditEffects,
    auditViolations
  ) => {
    for (const [i, eff] of auditEffects.entries()) {
      const t = eff.timing;
      if (!t || t.kind !== "card_event") continue;
      const events = Array.isArray(t.event) ? t.event : [t.event];
      const hasAsym = events.some((e) => ASYMMETRIC_EVENTS.has(e));
      if (!hasAsym) continue;
      if (eff.executionMode !== undefined) continue;
      auditViolations.push({
        cardNo: auditCardNo,
        kind: "card_event_execution_mode",
        detail: `effects[${i}]: timing.event=${JSON.stringify(t.event)} executionMode 省略 (revealed/moved_to_trash は default 非対称、per-effect 明示必須 — 10_rules/03c ruling C)`,
      });
    }
  };

  // optional_wording 監査用 helper (EFFECT_MARKER vanilla skip より前に定義)。
  // marker 判定と独立した per-effect textRef ベースで実行する (verifier round 8 Lens 2 refute
  // BSTH09-C03: 『XX時』 marker のみのカードが EFFECT_MARKER に hit せず audit を漏らす silent
  // false negative を防ぐ, 2026-06-23)。
  const textRefKey = (arr) => (Array.isArray(arr) ? arr.join(",") : "");
  const textRefIncludesAll = (container, subset) =>
    Array.isArray(container) &&
    Array.isArray(subset) &&
    subset.every((idx) => container.includes(idx));
  const auditOptionalWording = (auditCardNo, auditEffects, auditTextLines) => {
    const excEffects = new Set(owExceptions[auditCardNo]?.effectIndexes ?? []);
    for (const [i, eff] of auditEffects.entries()) {
      if (eff.stub) continue;
      if (!Array.isArray(eff.textRef) || eff.textRef.length === 0) continue;
      if (excEffects.has(i)) continue;
      // steps:[] は maxCombinedBraves 等の top-level 宣言フィールドを指す textRef
      // bookkeeping のみの placeholder (BSTH02-X04 effects[1] 等)。実行される action が
      // 無いため executionMode 監査の対象にならない。
      if (Array.isArray(eff.steps) && eff.steps.length === 0) continue;
      const lines = eff.textRef
        .map((idx) => auditTextLines?.[idx] ?? "")
        .filter((s) => s.length > 0);
      const text = lines.join("\n");
      if (!hasOptionalWording(text)) continue;
      if (hasOptionalExpression(eff)) continue;
      // 同一 textRef、または textRef を内包する兄弟 effect が既に任意表現を持つ場合、この行の
      // 任意性はその兄弟が担っている（例: 召喚許可 effect が optional、その代替コストを
      // 定める continuous cost_modify effect は同じ行を指すが単独では任意表現を持たない。
      // BSAZ02-M01 effects[0]/[1] の「配置でき、そうしたとき」split も同型）。
      const myKey = textRefKey(eff.textRef);
      const coveredBySibling = auditEffects.some(
        (other, j) =>
          j !== i &&
          (textRefKey(other.textRef) === myKey ||
            textRefIncludesAll(other.textRef, eff.textRef)) &&
          hasOptionalExpression(other)
      );
      if (coveredBySibling) continue;
      warnings.push({
        cardNo: auditCardNo,
        kind: "optional_wording",
        detail: `effects[${i}]: textRef=${JSON.stringify(eff.textRef)} 任意文言含むが executionMode/min0/choice 等の任意表現なし — ${lines[0]?.slice(0, 60) ?? ""}`,
      });
    }
  };

  const auditEffectLevelOptionality = (
    auditCardNo,
    auditEffects,
    auditTextLines
  ) => {
    for (const [i, eff] of auditEffects.entries()) {
      const issues = [
        findEffectLevelOptionalityIssue(eff, auditTextLines),
        findRedundantRootStepOptionalityIssue(eff, auditTextLines),
      ].filter(Boolean);
      for (const issue of issues) {
        const row = getRow(auditCardNo);
        row.effectOptionality = (row.effectOptionality || 0) + 1;
        const dependentSteps = issue.dependentStepIndexes?.length
          ? ` (dependent steps: ${issue.dependentStepIndexes.join(",")})`
          : "";
        violations.push({
          cardNo: auditCardNo,
          kind: "effect_level_optionality",
          detail: `effects[${i}]: ${issue.detail}${dependentSteps}`,
        });
      }
      const countOptionalStepIssues = findCountZeroOptionalCountStepIssues(
        eff,
        auditTextLines
      );
      for (const issue of countOptionalStepIssues) {
        const row = getRow(auditCardNo);
        row.countOptionalStep = (row.countOptionalStep || 0) + 1;
        const dependentSteps = issue.dependentStepIndexes?.length
          ? ` (steps: ${issue.dependentStepIndexes.join(",")})`
          : "";
        violations.push({
          cardNo: auditCardNo,
          kind: "count_optional_step",
          detail: `effects[${i}]: ${issue.detail}${dependentSteps}`,
        });
      }
    }
  };

  // 継続/誘発 分類ミス再発防止監査 (2026-07-18, BSLH01-T07..T17 由来)。
  // 「Xを満たしている間、フィールドに置き」型イディオムを検出したら、正誤を判定せず
  // 一律 warn する (03c §常時/継続 vs 誘発/即時 を読んだか、qa-016 裏取りしたかは
  // カードごとの読解が要るため機械では判定不能。注意喚起のみ)。
  // カード全文(card.textLines)を対象にする — effects[].textRef 単位ではない。
  // 発見契機の BSLH01-T07..T17 自体、このイディオム行(textLines[2])は
  // continuousSummonCondition/summonCondition という **top-level フィールド**で
  // 表現され、どの effects[].textRef からも参照されない（textRef 単位監査だと
  // 恒久的に見落とす死角になる、optionalWording 側の EFFECT_MARKER blind-spot
  // 修正(09a434c3)と同種の教訓）。
  const auditedContinuityCardNos = new Set();
  const auditContinuityWording = (auditCardNo, auditTextLines) => {
    if (auditedContinuityCardNos.has(auditCardNo)) return;
    auditedContinuityCardNos.add(auditCardNo);
    if (cwExceptions[auditCardNo]) return;
    const text = (auditTextLines || []).join("\n");
    if (!hasContinuityPlacementWording(text)) return;
    warnings.push({
      cardNo: auditCardNo,
      kind: "continuity_wording",
      detail: `「満たしている間、フィールドに置き」型イディオム検出 — 常時/誘発の分類根拠は発揮開始タイミング語彙の有無(03c §常時/継続 vs 誘発/即時, qa-016)であり「置き/置ける」の強制/任意ではない点に注意`,
    });
  };

  // 《ソウルコア》以外 → effectKind:"normal_only" 必須監査 (2026-08-03, BSSA01-C01 由来)。
  // カード全文単位（continuity と同じく effects[].textRef 非依存）。同一 cardNo を
  // 二重計上しない。exceptions は cardNo 単位で落とす（理由を JSON の値に書く）。
  const auditedSoulCoreCardNos = new Set();
  const auditSoulCoreExclusion = (
    auditCardNo,
    auditTextLines,
    auditEffects
  ) => {
    if (auditedSoulCoreCardNos.has(auditCardNo)) return;
    auditedSoulCoreCardNos.add(auditCardNo);
    if (scExceptions[auditCardNo]) return;
    const found = findSoulCoreExclusionViolation(auditTextLines, auditEffects);
    if (!found) return;
    // gate ではなく warn。理由: (1) 既存の語彙系 (optional_wording / continuity_wording) と
    // 揃える、(2) reason=missing_action は未実装の可能性で正誤にカード読解が要る、
    // (3) violations に入れると `cards:fidelity --gate` (停止条件2) は赤になるのに
    // ledger の total (= stub+uncovered+noTextRef+symbolMismatch) は変わらず、
    // guard-audit の precondition (fidelity-total-zero) と gate が食い違う。
    // 確定した実バグは cluster として登録して消化する。
    warnings.push({
      cardNo: auditCardNo,
      kind: "soul_core_exclusion_effect_kind",
      detail: `[${found.reason}] ${found.detail}`,
    });
  };

  // 不活性フィルタフィールド監査 (2026-08-03, P3-134 由来)。読解を要さない機械判定
  // (「この組み合わせでは評価経路に到達しない」という engine 側の事実だけで決まる)。
  // warn 扱い: 現時点の挙動は誤らせないが、絞り込みが効いていると誤読させる罠。
  const auditedInertCardNos = new Set();
  const auditInertFilterFields = (auditCardNo, auditEffects) => {
    if (auditedInertCardNos.has(auditCardNo)) return;
    auditedInertCardNos.add(auditCardNo);
    if (ifExceptions[auditCardNo]) return;
    for (const found of findInertFilterFields(auditEffects)) {
      warnings.push({
        cardNo: auditCardNo,
        kind: "inert_filter_field",
        detail: found.detail,
      });
    }
  };

  const hasSelfEffectImmunityAction = (eff) =>
    Array.isArray(eff.steps) &&
    eff.steps.some(
      (step) =>
        step?.action?.kind === "effect_immunity" &&
        step.action.target?.kind === "self"
    );
  const auditImmunityZoneScope = (
    auditCardNo,
    auditEffects,
    auditTextLines,
    detailPrefix = ""
  ) => {
    for (const [i, eff] of auditEffects.entries()) {
      if (eff.stub || !hasSelfEffectImmunityAction(eff)) continue;
      if (!Array.isArray(eff.textRef) || eff.textRef.length === 0) continue;
      const text = eff.textRef
        .map((idx) => auditTextLines?.[idx] ?? "")
        .join("\n");
      if (!hasUnboundedSelfEffectImmunityWording(text)) continue;
      const zones = normalizeApplicabilityZoneList(eff.applicability?.zone);
      const missing = REQUIRED_SELF_IMMUNITY_ZONES.filter(
        (zone) => !zones.includes(zone)
      );
      const requiredZoneSet = new Set(REQUIRED_SELF_IMMUNITY_ZONES);
      const overbroad = zones.filter((zone) => !requiredZoneSet.has(zone));
      if (missing.length === 0 && overbroad.length === 0) continue;
      const row = getRow(auditCardNo);
      row.immunityZoneScope = (row.immunityZoneScope || 0) + 1;
      violations.push({
        cardNo: auditCardNo,
        kind: "immunity_zone_scope",
        detail: `${detailPrefix}effects[${i}]: 自己「このカードは相手の効果を受けない」だが applicability.zone=${JSON.stringify(eff.applicability?.zone ?? null)}。missing=${missing.join(",") || "-"} overbroad=${overbroad.join(",") || "-"}`,
      });
    }
  };

  // 明示 stub 監査 helper (EFFECT_MARKER vanilla skip より前に定義)。
  // optionalWording と同じ理由 (verifier round 8 Lens 2 refute, BSTH09-C03) で、
  // 『XX時』のみのカード (EFFECT_MARKER = ■|【|フラッシュ|スタック|〔 に非マッチ) の
  // stub が監査の死角になっていた (2026-07-17 発見: BSAZ02-C08 が該当、cards:fidelity
  // --set BSAZ02 の violations に一度も出現していなかった)。stub は textLine marker との
  // 相関を必要としないデータフィールドなので、marker 判定と独立に全カードを対象にする。
  const auditStub = (auditCardNo, auditEffects, detailPrefix = "") => {
    for (const [i, eff] of auditEffects.entries()) {
      if (typeof eff.stub === "string" && eff.stub.length > 0) {
        getRow(auditCardNo).stub++;
        violations.push({
          cardNo: auditCardNo,
          kind: "stub",
          detail: `${detailPrefix}effects[${i}]: ${eff.stub}`,
        });
      }
    }
  };

  const auditPutActionSemantics = (auditCardNo, root) => {
    for (const issue of findPutActionSemanticIssues(root)) {
      const row = getRow(auditCardNo);
      row.putActionSemantics = (row.putActionSemantics || 0) + 1;
      violations.push({
        cardNo: auditCardNo,
        kind: "put_action_semantics",
        detail: `${issue.path}: ${issue.detail}`,
      });
    }
  };

  // 1 face (front or back) の全 nested Effect[] container を audit する。
  // face level: face.effects, face.mirageData/accelData/changeData/zeroCounterData/quartzData
  // CardDefinition のみ持つ: grandwalkerData.divineSkills (front のみ)
  // backFace は CardBackFace で quartzData + effects のみだが、型定義の変更追従と
  // verifier round 14 Lens 2 refute (backFace.quartzData.effects silent FN) を防ぐため、
  // 全 nested container を均一に走査する。
  const auditFaceWithNested = (face, faceCardNo, faceTextLines, opts = {}) => {
    const detailPrefix = opts.isBack ? "backFace " : "";
    // カード全文単位（effects[].textRef 非依存）。summonCondition 等 top-level
    // フィールドで表現され、どの effects[].textRef からも参照されない箇所も拾うため。
    auditContinuityWording(faceCardNo, faceTextLines);
    // 同じくカード全文単位。effects 側は face 全体（未実装 = effects 空も検出対象なので
    // effects.length > 0 のガード内に入れない）。
    auditSoulCoreExclusion(faceCardNo, faceTextLines, face.effects);
    auditInertFilterFields(faceCardNo, face.effects);
    if (Array.isArray(face.effects) && face.effects.length > 0) {
      auditOptionalWording(faceCardNo, face.effects, faceTextLines);
      auditEffectLevelOptionality(faceCardNo, face.effects, faceTextLines);
      auditCardEventExecutionMode(faceCardNo, face.effects, violations);
      auditStub(faceCardNo, face.effects, detailPrefix);
      auditImmunityZoneScope(
        faceCardNo,
        face.effects,
        faceTextLines,
        detailPrefix
      );
    }
    const containers = [
      ["mirage", face.mirageData],
      ["accel", face.accelData],
      ["change", face.changeData],
      ["zeroCounter", face.zeroCounterData],
      ["quartz", face.quartzData],
    ];
    for (const [tag, data] of containers) {
      if (data && Array.isArray(data.effects)) {
        auditOptionalWording(
          `${faceCardNo}#${tag}`,
          data.effects,
          faceTextLines
        );
        auditEffectLevelOptionality(
          `${faceCardNo}#${tag}`,
          data.effects,
          faceTextLines
        );
        auditCardEventExecutionMode(
          `${faceCardNo}#${tag}`,
          data.effects,
          violations
        );
        auditStub(`${faceCardNo}#${tag}`, data.effects, detailPrefix);
        auditImmunityZoneScope(
          `${faceCardNo}#${tag}`,
          data.effects,
          faceTextLines,
          detailPrefix
        );
      }
    }
  };

  for (const { cardNo, face } of ALL_CARDS.flatMap(collectCardFaces)) {
    const card = { ...face, cardNo };
    for (const issue of findOracleTriggerKindIssues(card)) {
      getRow(cardNo).semantic++;
      violations.push({
        cardNo,
        ...issue,
        effectPath: "grandwalkerData.oracleTriggerKinds",
      });
    }
    auditPutActionSemantics(card.cardNo, card);
    // optional_wording / stub: EFFECT_MARKER (vanilla skip) より前 + 全カードを対象にする。
    // marker 判定の char set (■/【/フラッシュ/スタック/〔) は uncovered line 用で、
    // 『XX時』 のみのカードを vanilla 扱いしないように独立に audit する。
    auditFaceWithNested(card, card.cardNo, card.textLines);
    if (card.grandwalkerData?.divineSkills) {
      for (const [
        skillIndex,
        skill,
      ] of card.grandwalkerData.divineSkills.entries()) {
        if (Array.isArray(skill.effects)) {
          auditOptionalWording(
            `${card.cardNo}#divineSkill[${skillIndex}]`,
            skill.effects,
            card.textLines
          );
          auditEffectLevelOptionality(
            `${card.cardNo}#divineSkill[${skillIndex}]`,
            skill.effects,
            card.textLines
          );
          auditCardEventExecutionMode(
            `${card.cardNo}#divineSkill[${skillIndex}]`,
            skill.effects,
            violations
          );
          auditStub(`${card.cardNo}#divineSkill[${skillIndex}]`, skill.effects);
          auditImmunityZoneScope(
            `${card.cardNo}#divineSkill[${skillIndex}]`,
            skill.effects,
            card.textLines
          );
        }
      }
    }
    const effectEntries = collectEffectContainers(card).flatMap(
      ({ path, effects }) => {
        // DivineSkillEntry.turnLimit and usageLimit gate the skill declaration.
        // The latter also supports step/game limits. Its nested
        // Effect deliberately has no duplicate usageLimit: the engine gates
        // declaration through the skill entry before resolving its effects.
        const divineSkillMatch =
          /^grandwalkerData\.divineSkills\[(\d+)\]\.effects$/.exec(path);
        const skill = divineSkillMatch
          ? card.grandwalkerData?.divineSkills?.[Number(divineSkillMatch[1])]
          : null;
        const kindByTurnLimit = {
          once: "per_instance",
          once_per_name: "per_card_name",
        };
        const kind = skill?.turnLimit
          ? kindByTurnLimit[skill.turnLimit]
          : undefined;
        const skillPath = path.slice(0, -".effects".length);
        const inheritedUsageLimits = [
          ...(kind
            ? [
                {
                  kind,
                  duration: "turn",
                  maxCount: skill.maxUsesPerTurn ?? 1,
                  path: `${skillPath}.turnLimit`,
                },
              ]
            : []),
          ...collectUsageLimitCarriers(skill, skillPath),
        ];
        return effects.map((effect, index) => ({
          effect,
          effectIndex: index,
          path: `${path}[${index}]`,
          containerPath: path,
          constraintOptions: {
            inheritedUsageLimits,
            normalActionPermissionEffectIndex: index,
          },
        }));
      }
    );
    const effectsAlways = effectEntries.map(({ effect }) => effect);

    // 2026-09 原文監査の再発検知。本文マーカーの有無で飛ばさず、表裏と
    // mechanic 内の各 Effect を同じ正源 container 一覧から走査する。
    for (const {
      effect,
      effectIndex,
      path: effectPath,
      containerPath,
      constraintOptions,
    } of effectEntries) {
      for (const [auditFamily, detect] of [
        ["constraint", findConstraintFidelityIssues],
        ["flow", findFlowFidelityIssues],
      ]) {
        for (const issue of detect(
          effect,
          card.textLines ?? [],
          auditFamily === "constraint"
            ? {
                ...constraintOptions,
                normalActionPermissionEffectIndex: effectIndex,
                // 複数 Effect をまたぐ共通 primitive が、参照する effectIndex の
                // timing/形を検証できるよう、同一 container の index を保った全 Effect
                // を渡す。カード番号での例外ではなく DSL 関係そのものを監査する。
                containerEffects: effectEntries
                  .filter((entry) => entry.containerPath === containerPath)
                  .map((entry) => entry.effect),
                // 同一印字文を分割した effect_param_modify は自分で target を
                // 持たない。本文が明示的に「この『…効果』」と参照する場合だけ
                // detector が兄弟の対象 filter を照合できるように渡す。
                siblingEffects: effectEntries
                  .filter(
                    (entry) =>
                      entry !== undefined &&
                      entry.containerPath === containerPath &&
                      entry.effect !== effect &&
                      JSON.stringify(entry.effect.textRef ?? []) ===
                        JSON.stringify(effect.textRef ?? [])
                  )
                  .map((entry) => entry.effect),
                // 「このブレイヴの効果の条件を…に変更」型は異なる textRef の先行
                // action を参照する。detector 側で文言・scope・action kind・元上限+
                // delta を全照合するため、同一 Effect container の候補だけを渡す。
                referencedEffects: effectEntries
                  .filter(
                    (entry) =>
                      entry !== undefined &&
                      entry.containerPath === containerPath &&
                      entry.effect !== effect
                  )
                  .map((entry) => entry.effect),
              }
            : undefined
        )) {
          const source = semanticSource(effect, effectPath, issue.path);
          const finding = {
            cardNo: card.cardNo,
            kind: issue.kind,
            auditFamily,
            severity: issue.severity,
            ...source,
            evidence: issue.evidence,
            detail: `${source.path}: ${issue.message}`,
          };
          if (issue.severity === "violation") {
            getRow(card.cardNo).semantic++;
            violations.push(finding);
          } else if (issue.severity === "review") {
            rawSemanticReviews.push(finding);
          } else {
            throw new Error(
              `Unknown semantic finding severity: ${issue.severity}`
            );
          }
        }
      }
    }

    const text = (card.textLines || []).join("\n");
    if (!EFFECT_MARKER.test(text)) continue; // vanilla
    const effects = effectsAlways;
    if (effects.length === 0) continue; // todo は coverage 側の責務

    const row = getRow(card.cardNo);

    // 1 / 1b. 明示 stub (front + backFace) 監査は EFFECT_MARKER vanilla skip より前で
    //    全カードを対象に既に実行済み (auditStub、2026-07-17 optional_wording と同型に移設)。

    // 5. optional wording 監査は EFFECT_MARKER vanilla skip より前で全カードを対象に
    //    既に実行済み (verifier round 8 Lens 2 refute)。

    // 2. textRef 未カバーの効果マーカー行
    //
    // 判定は **効果ごと** (2026-08-03 修正)。旧実装は「カード内に 1 件でも textRef が
    // あれば通す」card 単位で、**印字根拠のない効果を素通し**していた。実例:
    // BSES01-C02/C05/C06/M01-M04/R01/R03/X01 の forced-token 効果 10 件は、どのカードの
    // 印字テキストにも該当記述が無いまま mandatory 効果として存在していたが、
    // 同カードの他効果が textRef を持つため 0 件と報告されていた。
    // textRef は表示専用ではなく挙動にも効く ([[project_textref_semantics_beyond_display]])
    // ため、印字根拠の無い効果は忠実度違反として扱う。
    const refs = new Set();
    for (const ref of card.adventData?.beforeAdventSourceAddition?.textRef ??
      [])
      refs.add(ref);
    const orphanIndexes = [];
    effects.forEach((eff, i) => {
      if (Array.isArray(eff.textRef) && eff.textRef.length > 0) {
        for (const r of eff.textRef) refs.add(r);
      } else if (effectEntries[i].path.startsWith("effects[")) {
        // 神技などの専用carrierはtext-ledgerで帰属を検証する。
        orphanIndexes.push(i);
      }
    });
    if (orphanIndexes.length > 0) {
      row.noTextRef += orphanIndexes.length;
      for (const i of orphanIndexes) {
        violations.push({
          cardNo: card.cardNo,
          kind: "no_textref",
          detail: `${effectEntries[i].path} に textRef 無し (印字テキストに対応行が無い効果)`,
        });
      }
    }
    if (refs.size === 0) continue;

    const ignoredLines = new Set(ignore[card.cardNo]?.lines ?? []);
    (card.textLines || []).forEach((line, idx) => {
      const isOracleHeader = ORACLE_HEADER.test(line);
      if (!LINE_MARKER.test(line) && !isOracleHeader) return;
      if (refs.has(idx) || refs.has(idx + 1)) return;
      if (ignoredLines.has(idx)) return;
      // 煌臨宣言ヘッダ行は adventData が表現する（マスクではない: advent 未実装のカードは
      // adventData を持たないため依然 uncovered として顕在化する。1 カード = 高々 1 ヘッダ行）。
      // dualHostAdventData（多重煌臨、P3-133）も同じヘッダ文言「【…煌臨：…】」を使うため
      // 同じ ADVENT_HEADER exemption を共有する（adventData と併存しないため二重免除の懸念なし）。
      if (
        (card.adventData || card.dualHostAdventData) &&
        ADVENT_HEADER.test(line)
      )
        return;
      // 顕現宣言ヘッダ行は manifestData が表現する（adventData ヘッダと同型。manifest
      // 未実装のカードは manifestData を持たないため依然 uncovered として顕在化する）。
      if (card.manifestData && MANIFEST_HEADER.test(line)) return;
      // 神技/導技/契約技/転者/転神 の宣言ヘッダ行は grandwalkerData.divineSkills が表現する
      // （declare_advent と同型。divineSkills 未実装のカードは依然 uncovered として顕在化する）。
      if (
        card.grandwalkerData?.divineSkills?.length > 0 &&
        DIVINE_SKILL_HEADER.test(line)
      )
        return;
      // 神託/導託ヘッダ行のうち、対象条件だけのものは grandwalkerData.oracleConditions
      // が表現する。ヘッダ内に「ステップに1回」等の追加制約がある場合は、
      // textRef/stub または専用データが無ければ uncovered として残す。
      if (isOracleHeader && oracleHeaderCoveredByGrandwalkerData(card, line))
        return;
      if (blueMagicStackDomainCoveredByGrandwalkerData(card, line)) return;
      // 契約合体ヘッダ行は contractCombineData が表現する（declare_advent と同型）。
      if (card.contractCombineData && CONTRACT_COMBINE_HEADER.test(line))
        return;
      if (card.accelData && ACCEL_HEADER.test(line)) return;
      if (card.changeData && CHANGE_HEADER.test(line)) return;
      row.uncovered++;
      violations.push({
        cardNo: card.cardNo,
        kind: "uncovered_line",
        detail: `textLines[${idx}]: ${line.slice(0, 60)}`,
      });
    });
  }

  // 4. 印字 symbol / reduction の外部ミラー照合（ミラー在のときのみ; P3-94）
  const { cards: mirror, input: mirrorInput } = loadAuditMirror(ROOT);
  if (mirror) {
    const symExceptions = loadSymbolExceptions();
    const byNo = new Map();
    for (const m of mirror) if (m && m.cardNumber) byNo.set(m.cardNumber, m);
    for (const card of ALL_CARDS) {
      const m = byNo.get(card.cardNo);
      if (!m) continue; // ミラーに無いカードは照合不能
      const exc = symExceptions[card.cardNo];
      const skip = new Set(
        exc
          ? Array.isArray(exc.aspects)
            ? exc.aspects
            : ["symbol", "reduction"]
          : []
      );
      const checks = [
        [
          "symbol",
          normalizeSymbolEntries(
            card.symbolColorEntries ??
              (card.symbolColors || []).map((color) => [color])
          ),
          normalizeSymbolEntries(
            (m.symbol || [])
              .filter((token) => String(token).trim())
              .map((token) => normalizeMirrorSymbols([token]))
          ),
        ],
        [
          "symbol",
          [...(card.symbolColors || [])].sort(),
          normalizeMirrorSymbols(m.symbol),
        ],
        [
          "reduction",
          [...(card.reductionSymbols || [])].sort(),
          normalizeMirrorSymbols(m.reduction),
        ],
      ];
      for (const [aspect, cd, mi] of checks) {
        if (skip.has(aspect)) continue;
        if (JSON.stringify(cd) === JSON.stringify(mi)) continue;
        const set = setOf(card.cardNo);
        if (!bySet.has(set))
          bySet.set(set, {
            set,
            stub: 0,
            uncovered: 0,
            noTextRef: 0,
            symMismatch: 0,
            immunityZoneScope: 0,
            effectOptionality: 0,
            countOptionalStep: 0,
            putActionSemantics: 0,
          });
        const row = bySet.get(set);
        row.symMismatch = (row.symMismatch || 0) + 1;
        violations.push({
          cardNo: card.cardNo,
          kind: "symbol_mismatch",
          detail: `${aspect}: card-data=${JSON.stringify(cd)} ≠ mirror=${JSON.stringify(mi)}`,
        });
      }
    }
  } else {
    log("[cards:fidelity] external-qa mirror 不在: symbol 照合をスキップ");
  }

  const reviewState = applyReviewResolutions(ALL_CARDS, rawSemanticReviews);
  const semanticReviews = reviewState.pending;
  const sets = [...bySet.values()]
    .filter(
      (s) =>
        s.stub +
          s.uncovered +
          s.noTextRef +
          (s.symMismatch || 0) +
          (s.immunityZoneScope || 0) +
          (s.effectOptionality || 0) +
          (s.countOptionalStep || 0) +
          (s.putActionSemantics || 0) +
          (s.semantic || 0) >
        0
    )
    .sort((a, b) => a.set.localeCompare(b.set));
  const totals = {
    stub: violations.filter((v) => v.kind === "stub").length,
    uncovered: violations.filter((v) => v.kind === "uncovered_line").length,
    noTextRef: violations.filter((v) => v.kind === "no_textref").length,
    symbolMismatch: violations.filter((v) => v.kind === "symbol_mismatch")
      .length,
    cardEventExecutionMode: violations.filter(
      (v) => v.kind === "card_event_execution_mode"
    ).length,
    immunityZoneScope: violations.filter(
      (v) => v.kind === "immunity_zone_scope"
    ).length,
    effectOptionality: violations.filter(
      (v) => v.kind === "effect_level_optionality"
    ).length,
    countOptionalStep: violations.filter(
      (v) => v.kind === "count_optional_step"
    ).length,
    putActionSemantics: violations.filter(
      (v) => v.kind === "put_action_semantics"
    ).length,
    semanticConstraints: violations.filter(
      (v) => v.auditFamily === "constraint"
    ).length,
    semanticFlow: violations.filter((v) => v.auditFamily === "flow").length,
  };
  const report = {
    auditStateFingerprint: inputState,
    generatedBy: "scripts/cards-fidelity-audit.mjs",
    totals,
    sets,
    violations,
    warnings,
    semanticReviews,
    semanticReviewCount: semanticReviews.length,
    rawSemanticReviewCount: rawSemanticReviews.length,
    confirmedSemanticReviews: reviewState.confirmed,
    confirmedSemanticReviewCount: reviewState.confirmed.length,
    reviewContextFingerprint: reviewState.contextFingerprint,
    auditInputs: { mirror: mirrorInput },
    reviewRequired: semanticReviews.length > 0,
    warningTotals: {
      optionalWording: warnings.filter((w) => w.kind === "optional_wording")
        .length,
      inertFilterField: warnings.filter((w) => w.kind === "inert_filter_field")
        .length,
      soulCoreExclusion: warnings.filter(
        (w) => w.kind === "soul_core_exclusion_effect_kind"
      ).length,
      continuityWording: warnings.filter((w) => w.kind === "continuity_wording")
        .length,
    },
    clean: violations.length === 0,
  };

  if (inputState && auditStateFingerprint(ROOT) !== inputState)
    throw new Error("Audit inputs changed during fidelity measurement");
  if (process.env.ORICA_CARDS_FIDELITY_AUDIT_NO_WRITE !== "1") {
    writeFileSync(
      join(ROOT, "fidelity-audit.json"),
      JSON.stringify(report, null, 2) + "\n"
    );
  }

  if (JSON_ONLY) {
    process.stdout.write(stringifyMachineJson(report) + "\n");
    const gateViolations = SET_FILTER
      ? violations.filter((v) => setOf(v.cardNo) === SET_FILTER)
      : violations;
    process.exit(GATE && gateViolations.length > 0 ? 1 : 0);
  }

  if (SET_FILTER) {
    const inSet = violations.filter((v) => setOf(v.cardNo) === SET_FILTER);
    log(`\n[${SET_FILTER}] violations (${inSet.length}):`);
    for (const v of inSet) log(`  ${v.cardNo} [${v.kind}] ${v.detail}`);
    const wInSet = warnings.filter((w) => setOf(w.cardNo) === SET_FILTER);
    const reviewsInSet = semanticReviews.filter(
      (v) => setOf(v.cardNo) === SET_FILTER
    );
    if (reviewsInSet.length > 0) {
      log(`\n[${SET_FILTER}] semantic reviews (${reviewsInSet.length}):`);
      for (const v of reviewsInSet)
        log(`  ${v.cardNo} [${v.kind}] ${v.detail}`);
    }
    if (wInSet.length > 0) {
      log(`\n[${SET_FILTER}] warnings (${wInSet.length}):`);
      for (const w of wInSet) log(`  ${w.cardNo} [${w.kind}] ${w.detail}`);
    }
    process.exit(GATE && inSet.length > 0 ? 1 : 0);
  }

  log("\n=== カード effects 忠実度監査 ===");
  log(
    "set          stub  uncovered  noTextRef  symMismatch  immZone  effOpt  countOpt  putDsl  semantic"
  );
  for (const s of sets) {
    log(
      `${s.set.padEnd(12)} ${String(s.stub).padStart(4)}  ${String(s.uncovered).padStart(9)}  ${String(s.noTextRef).padStart(9)}  ${String(s.symMismatch || 0).padStart(11)}  ${String(s.immunityZoneScope || 0).padStart(7)}  ${String(s.effectOptionality || 0).padStart(6)}  ${String(s.countOptionalStep || 0).padStart(8)}  ${String(s.putActionSemantics || 0).padStart(6)}  ${String(s.semantic || 0).padStart(8)}`
    );
  }
  log("-".repeat(105));
  log(
    `TOTAL        ${String(totals.stub).padStart(4)}  ${String(totals.uncovered).padStart(9)}  ${String(totals.noTextRef).padStart(9)}  ${String(totals.symbolMismatch).padStart(11)}  ${String(totals.immunityZoneScope).padStart(7)}  ${String(totals.effectOptionality).padStart(6)}  ${String(totals.countOptionalStep).padStart(8)}  ${String(totals.putActionSemantics).padStart(6)}  ${String(totals.semanticConstraints + totals.semanticFlow).padStart(8)}`
  );
  if (totals.cardEventExecutionMode > 0) {
    log(
      `card_event executionMode 省略 (revealed/moved_to_trash 非対称回避): ${totals.cardEventExecutionMode} 件`
    );
  }
  log(
    `\n停止条件 (違反0): ${report.clean ? "✅ 達成" : `❌ 未達 (${violations.length} 件)`}`
  );
  log(
    `原文制約の矛盾: ${totals.semanticConstraints} / 制御フローの矛盾: ${totals.semanticFlow}`
  );
  log(
    `原文確認が必要な類似候補: ${semanticReviews.length} 件（gate の違反とは区別し、フルランが確認）`
  );
  if (warnings.length > 0) {
    log(
      `\n[warn] optional_wording: ${report.warningTotals.optionalWording} 件 ` +
        `(P3-96, gate 非影響。除外は scripts/optional-wording-exceptions.json)`
    );
    if (report.warningTotals.continuityWording > 0) {
      log(
        `[warn] continuity_wording: ${report.warningTotals.continuityWording} 件 ` +
          `(常時/誘発分類の再確認要。03c §常時/継続 vs 誘発/即時 + qa-016 参照。gate 非影響。除外は scripts/continuity-wording-exceptions.json)`
      );
    }
  }
  log(`fidelity-audit.json を出力しました。`);
  log(`弾別詳細: node scripts/cards-fidelity-audit.mjs --set <SET>`);

  process.exit(GATE && !report.clean ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
