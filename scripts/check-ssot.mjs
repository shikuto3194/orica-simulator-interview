#!/usr/bin/env node
import {
  hasImplicitEffectCoreChoice,
  hasDedicatedCoreSelector,
  hasForcedMultiPlacementPhase,
  hasRawMultiPlacementFieldSources,
} from "./core-hud-ssot.mjs";
/**
 * check:ssot — SSOT (Single Source of Truth) 違反の registry 駆動スキャナ。
 *
 * CLAUDE.md「同じ列挙の判別・写像を 2 箇所に実装しない (SSOT)」の機械ゲート。
 * `pre-tool-guard.js` が編集前に block するのに対し、こちらは `pnpm verify` /
 * pre-push でツリー全体を最終 gate し、複数編集をまたぐドリフトや hook 未通過経路
 * (手動 git add 等) を backstop する。
 *
 * 仕組み: RULES に登録した各「正源」について、detector にマッチするソースを走査し、
 * `allow` (正源所有モジュール・型定義・テスト等) でも `baseline` (現状容認済みの
 * 正当サイト) でもないファイルがマッチしたら違反として fail する。新しい正源を
 * 作ったら本ファイルと `.claude/hooks/pre-tool-guard.js` の allowlist に登録する。
 *
 * Usage:
 *   node scripts/check-ssot.mjs           # gate (違反で exit 1)
 *   node scripts/check-ssot.mjs --list    # 各 rule のマッチ全件を出力 (baseline 整備用)
 *
 * NOTE: token レベルのコピペ検出 (jscpd 等) はここには含めない。「登録した概念の
 * 並行実装」だけを決定論的に見る方針 (既存クローンの許容 baseline 整備不要・偽陽性ゼロ)。
 * 粗いクローン検出が必要なら別途 `npx jscpd <path>` を手動で回す。
 */

import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import ts from "typescript";
import resolutionScopeGuard from "./harness/effect-resolution-scope-guard.cjs";
import { findCountZeroOptionalCountStepIssues } from "./effect-optionality-detector.mjs";
import { findDerivedStateSsotIssues } from "./derived-state-ssot.mjs";
import { findAiSearchStateFieldIssues } from "./ai-search-state-fields.mjs";

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".claude",
  "dist",
  "build",
  ".turbo",
  ".vite",
  "coverage",
  "playwright-report",
  "test-results",
  "debug-screenshots",
]);

const SCAN_ROOTS = ["apps", "packages", "scripts"];
const SOURCE_RE = /\.(ts|tsx|js|mjs)$/;

// テスト / 型定義 / 正源所有モジュールは源種別リテラルを正当に持つ。全 rule 共通。
const COMMON_ALLOW = [
  /[\\/]test[\\/]/,
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /[\\/]model\.ts$/,
];

const zoneTrioDetector = (text) =>
  ["reserve", "trash", "life"].every((z) =>
    new RegExp(
      `(?:\\.kind\\s*===\\s*|\\bcase\\s+|["']kind["']\\s*:\\s*)["']${z}["']`
    ).test(text)
  );

// 「表示キーの並行写像」= ゾーン三つ組判別 ＋ overrides 構築 ＋ 正源非経由。
// ゾーンを判別*するだけ* (制御フロー・エンジン機構・別レイヤ) は対象外にして、
// 必要な分散を阻害しない。pre-tool-guard.js / write-advisor.ts と同一述語。
const isParallelZoneDisplayMapping = (text) =>
  zoneTrioDetector(text) &&
  /[Oo]verrides\b/.test(text) &&
  !/coreContainerDisplayKey/.test(text);

const targetAffectLegacyHelperDetector = (text) =>
  /\b(?:filterOutResistantCards|filterOutImmuneCards|isCardImmuneToOpponentEffect|isPlayerImmuneToOpponentEffect|isImmuneToBpCompareDestroy|isLeaveOutcomeBlockedByResistance|isLeaveOutcomeBlockedById|isExhaustBlockedByResistance)\s*\(/.test(
    text
  ) ||
  /import\s*\{[^}]*\b(?:filterOutResistantCards|filterOutImmuneCards|isCardImmuneToOpponentEffect|isPlayerImmuneToOpponentEffect|isImmuneToBpCompareDestroy|isLeaveOutcomeBlockedByResistance|isLeaveOutcomeBlockedById|isExhaustBlockedByResistance)\b[^}]*\}\s*from\s*["'][^"']*effect-resistance-check["']/.test(
    text
  );

// P3-113: スタック窓オープンの低レベル実装 (stack-window-openers.ts) を新規呼び出し元が
// 直接叩くと、8→2 汎用エントリポイント (openEffectDeclarationStackWindow /
// openDeferredDeclarationStackWindow, いずれも legal-actions-apply.ts) への収斂が
// 将来のキーワード能力実装で再度崩れる。呼び出し (import ではなく call 構文) だけを検出する。
const STACK_WINDOW_LOW_LEVEL_OPENERS = [
  "openStackWindow",
  "openBurstActivationStackWindow",
  "openBurstEffectDeclarationStackWindow",
  "openStackSubWindowInStack",
  "openStackSubWindow",
  "openPreDeclarationStackSubWindow",
];
const stackWindowOpenerDirectCallDetector = (text) =>
  STACK_WINDOW_LOW_LEVEL_OPENERS.some((name) =>
    new RegExp(`\\b${name}\\(`).test(text)
  );

// P3-121: CardFilter.category(ies) の判定を `def.printedCategory` 直読で行う経路。
// getEffectiveCategory (act-as-spirit.ts) を経由しないため、override_properties CE の
// `excludeCategory`/`treatAsCategory` が伝播しない (BSTH03-M01「アルティメットとして
// 扱わない」等の静かな回避バグ)。`.category(ies).includes(...printedCategory)` と
// cost CE matcher の `options?.effectiveCategories ?? [printedCategory]` fallback を狙う
// (printedCategory === "brave" 等の単純比較は対象外、偽陽性なし)。
const excludeCategoryDirectReadDetector = (text) =>
  /\.categor(?:y|ies)\.includes\([^)]*printedCategory\)/.test(text) ||
  /const\s+effectiveCategories\s*=\s*options\?\.effectiveCategories\s*\?\?\s*\[[^\]]*printedCategory/.test(
    text
  ) ||
  /effectiveCategories\s*:\s*\[[^\]]*printedCategory/.test(text);

const EXCLUDE_CATEGORY_BASELINE_FILES = [];

// tribe-match-inline: 系統トークン集合に対する some/every + includes による系統マッチ
// 判定のインライン実装 (scan:ssot-candidates probe を 2026-08-05 全件分類済で卒業移植)。
// 正源 matchesTribes() は tribesLogic(AND/OR) / tribesRequired / excludeTribeSubstring /
// noTribes の 4 軸を一括で見るため、インライン実装はいずれかを取りこぼす (実例:
// 76f373576 の AND 条件既定 OR 化バグ)。呼び出し委譲だけでなく、CardFilter のサブセット
// 再定義だった OracleCondition / ChangeSwapCondition / UnsealCondition.cardFilter・
// causeFilter も dsl-types.ts の `TribeMatchFilter`（matchesTribes が読む 4 軸の Pick）を
// 型レベルで共有するよう統合済み (classificationPolicy: "subset-type-unification"、
// 「呼び出しだけ寄せた」状態を卒業の条件にしない、という 2026-08-03 ユーザー判断に従う)。
// 2026-08-05 guard-audit-tribe-match-inline: `?.`（オプショナルチェイニング）を挟む
// 変種 (`x.tribes?.some(...)` / `y?.includes(...)`) は元 regex が `\.` 固定だったため
// 検出漏れしていた (structured-condition-eval.ts の trigger_source_match が実例、
// matchesTribes() へ統合済み)。両箇所を `\??\.` に広げて再発を防ぐ。
const TRIBE_MATCH_INLINE_RE =
  /\b(\w*[Tt]ribes?\w*)\s*\??\.\s*(?:some|every)\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*(\w*[Tt]ribe\w*|parts|baseParts)\s*\??\.\s*includes\s*\(\s*\2\s*\)/;
const tribeMatchInlineDetector = (text) => TRIBE_MATCH_INLINE_RE.test(text);

// classified 済み (別概念、CardFilter 対象選定意味論ではない): ssot-candidate-scan.mjs
// 卒業時点の判断を継承。新規サイトはここに足さず matchesTribes へ寄せること。
const TRIBE_MATCH_INLINE_BASELINE_FILES = [
  // ImmunityScope.excludeTribes — 効果ソースの耐性スコープ判定軸 (OR 集合演算のみ)。
  "packages/rules-core/src/effect/effect-resistance-check.ts",
  // LinkAidData.costSourceTribes と実効系統の集合交差判定 (対象選定ではない)。
  "packages/rules-core/src/legal/legal-actions-availability.ts",
  // effect_source_prevention_immunity CE の免疫スコープ系統 (excludeTribes と同型)。
  "packages/rules-core/src/legal/legal-actions-shared.ts",
];

// P3-139: kind による switch の default: が具体ドメイン値(文字列/オブジェクトリテラル)を
// 返す構造。未列挙 kind が静かに別物として扱われ、型でもテストでも検出されない
// (旧 scan:ssot-candidates probe `kind-dispatch-silent-default` を卒業移植、
// convertCoreLocation "void,self" が実例。P3-146 まで affectOperationForAction
// "destroy" も実例だったが、当該関数は dead code として削除済み)。
// switch 単位で見る (ファイル単位だと「適用側」「評価側」を区別できず誤検出する)。
const KIND_SWITCH_RE = /switch\s*\(([^)]*\bkind\b[^)]*)\)\s*\{/g;
const DEFAULT_SAFE_RES = [
  /\bthrow\b/,
  /return\s+(?:undefined|null|void 0)\s*;/,
  /:\s*never\b/,
  /assertNever|exhaustive/i,
];
// 文字列リテラル / オブジェクトリテラルを返す default = 具体ドメイン値への縮退。
const DEFAULT_CONCRETE_RE = /return\s+("(?:[^"\\]|\\.)*"|'[^']*'|\{)/;

function extractSwitchBody(text, braceStart) {
  let depth = 0;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(braceStart, i + 1);
    }
  }
  return null;
}

/** `default:` 節の本体を次の `case` 直前まで切り出す。 */
function extractDefaultClause(switchBody) {
  const d = /\bdefault\s*:/.exec(switchBody);
  if (!d) return null;
  const rest = switchBody.slice(d.index + d[0].length);
  const nextCase = rest.search(/\n\s*case\s/);
  return (nextCase === -1 ? rest : rest.slice(0, nextCase))
    .replace(/\}\s*$/, "")
    .trim();
}

const kindDispatchSilentDefaultDetector = (text) => {
  KIND_SWITCH_RE.lastIndex = 0;
  let m;
  while ((m = KIND_SWITCH_RE.exec(text)) !== null) {
    const braceStart = text.indexOf("{", m.index + m[0].length - 1);
    if (braceStart === -1) continue;
    const body = extractSwitchBody(text, braceStart);
    if (!body) continue;
    const clause = extractDefaultClause(body);
    if (!clause) continue;
    if (DEFAULT_SAFE_RES.some((re) => re.test(clause))) continue;
    if (DEFAULT_CONCRETE_RE.test(clause)) return true;
  }
  return false;
};

// card-filter-enumerated-projection: CardFilter 系の値を per-field 条件付き
// スプレッドで列挙コピーしている射影 (scan:ssot-candidates probe を 2026-08-05
// 全件分類済で卒業移植)。候補列挙は matchesCardFilter/matchesCostCEFilterClause
// (SSOT) へ丸ごと流れるため、列挙から漏れたフィールド (tribesLogic/tribesRequired/
// requiredKeywordTags 等) が黙って落ちる (guard-audit-card-filter-projection 実例:
// native-action-registry.ts の player+cardFilter allowlist、native-ce-registration-
// handlers.ts の dynamicTargetFilterFromTargetSpec/executeRestrictManifest、
// native-target-resolution.ts の convertTargetSpecToEffectTarget、
// structured-cost-gate.ts の executeAdditionalCost)。正しい形は素のスプレッド
// `{ ...filter }`（CardFilter 全体が伝播する）。不足フィールドを列挙に追記して塞ぐのは
// 対症療法 (classificationPolicy: "subset-type-unification" — 素のスプレッドで型が
// 合わないときは native 側のサブセット型を CardFilter へ統合する。cost gate の
// targetFilter のように player を含む独自型は `{ player: EffectPlayerRef } & CardFilter`
// へ統合する)。狙うのは「同一ソースに対する per-field 条件付きスプレッドが 2 個以上」。
const CARD_FILTER_COND_SPREAD_RE =
  /\.\.\.\(\s*([\w.]+)\.(\w+)\s*(?:!==\s*undefined\s*)?\?\s*\{\s*(\w+)\s*:\s*\1\.\2\s*\}\s*:\s*\{\s*\}\s*\)/g;
const CARD_FILTER_SOURCE_RE =
  /(?:^|\.)(?:filter|targetFilter|cardFilter|sourceFilter|effectFilter|effectiveFilter)$/i;

const cardFilterEnumeratedProjectionDetector = (text) => {
  const bySource = new Map();
  CARD_FILTER_COND_SPREAD_RE.lastIndex = 0;
  let m;
  while ((m = CARD_FILTER_COND_SPREAD_RE.exec(text)) !== null) {
    const [, src, key, destKey] = m;
    if (key !== destKey) continue;
    if (!CARD_FILTER_SOURCE_RE.test(src)) continue;
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }
  for (const count of bySource.values()) {
    if (count >= 2) return true;
  }
  return false;
};

// zone-browse-current-state-detail: ZoneBrowseModal 内のカード詳細は
// CardDefinition 単体ではなく、GameState.cardInstances 上の current CardInstance を
// SSOT として CardDetailModal へ渡す。ゾーンブラウズは通常ゾーン/対象候補/
// フィールド重なりを一手に扱うため、ここで definition-only に落とすと
// 現在Lv/BP/コア/疲労/ソウルコア/override 表示が全経路で欠落する。
const zoneBrowseDefinitionOnlyDetailDetector = (text) => {
  const storesDefinitionOnlyDetail =
    /useState\s*<\s*CardDefinition\s*\|\s*null\s*>/.test(text) ||
    /\bsetDetailCard\s*\(\s*def\s*\)/.test(text);
  if (storesDefinitionOnlyDetail) return true;

  const modalMatch = /<CardDetailModal[\s\S]*?\/>/.exec(text);
  if (!modalMatch) return false;
  const modal = modalMatch[0];
  return !(
    /cardInstance=\{detailInstance\}/.test(modal) &&
    /gameState=\{state\}/.test(modal) &&
    /getCardDefinitionById=\{getDefinition\}/.test(modal)
  );
};

// core-operation-dedicated-selector:
// コア配置/移動/掴み/コスト支払い系のユーザー入力は FieldArea 上の既存
// coreSelection/CoreSelectionHud 経路を正源にする。PendingCoreSplitSelection /
// PendingCoreSourceAllocation を専用モーダル + ローカル state で解く実装は、フィールドの
// コアタップ/掴み/仮想表示配線を迂回しやすい (BSTH01-R05 の splitDestinations と
// field_card コスト支払い配分が実例)。同型の再導入を機械的に検知する。
const dedicatedCoreOperationSelectorDetector = (text) => {
  if (hasDedicatedCoreSelector(text) || hasForcedMultiPlacementPhase(text))
    return true;
  const referencesCorePending =
    /\bPending(?:Core(?:SplitSelection|SourceAllocation|CountSelection)|LifeCoreSelection|LinkAidCostSourceChoice|SummonCostCoreMoveChoice|PayToActCoreGate)\b/.test(
      text
    ) || /\bCore(?:Split|SourceAllocation)Modal\b/.test(text);
  if (!referencesCorePending) return false;
  const ownsSelectionState =
    /\buseState\s*(?:<|\()/.test(text) ||
    /\bcore(?:SplitDistribution|SourceAllocations)\b/.test(text) ||
    /\ballocations\b/.test(text);
  return ownsSelectionState && /\bonConfirm\s*[:=]/.test(text);
};

// effect-text-summon-cost-before-stack:
// BSGE01-R01 型の「効果文内に書かれた自己召喚コスト」は使用コストではない。
// use_hand_card_effect / resolve_pending_triggered_effect の宣言クリック時に GUI が
// summon_in_trigger HUD を開くと、発揮応答スタック窓より前に支払い遷移してしまう。
// 正しい順序は「宣言 → スタック窓 → 窓後 executeSummon でコスト → 維持コア」
// (10_rules/02:197-199, P3-110)。
const EFFECT_TEXT_SUMMON_DECLARATION_ACTIONS = [
  "use_hand_card_effect",
  "resolve_pending_triggered_effect",
];
const PRE_STACK_SUMMON_CONTEXT_CHARS = 8000;

const effectTextSummonCostBeforeStackDetector = (text) => {
  if (/\bopenFreeEffectSummonPlacement\b/.test(text)) return true;

  const setPendingCostPaymentRe = /\bsetPendingCostPayment\s*\(\s*\{/g;
  let match;
  while ((match = setPendingCostPaymentRe.exec(text)) !== null) {
    const braceStart = text.indexOf("{", match.index);
    const paymentBlock =
      braceStart === -1 ? null : extractSwitchBody(text, braceStart);
    if (
      !paymentBlock ||
      !/\bmode\s*:\s*"summon_in_trigger"/.test(paymentBlock)
    ) {
      continue;
    }

    const before = text.slice(
      Math.max(0, match.index - PRE_STACK_SUMMON_CONTEXT_CHARS),
      match.index
    );
    const isDeclarationPath = EFFECT_TEXT_SUMMON_DECLARATION_ACTIONS.some(
      (kind) => new RegExp(`\\baction\\.kind\\s*===\\s*"${kind}"`).test(before)
    );
    if (isDeclarationPath) return true;
  }

  return false;
};

// as-if-soul-core-choice-after-stack:
// 【契約合体】/【煌臨】系の「ソウルコアを置いたものとして」は効果文内の経路選択。
// 発揮宣言ではスタック窓だけを開き、窓後・対象選択前に pendingAsIfSoulCoreChoice で選ぶ。
// GUI が宣言クリック時に独自モーダルを作る経路と、legal declaration が ActiveStack へ
// useAlternateCost/costWaived を固定する経路を別々に検出する。
const asIfSoulCoreChoiceBeforeStackUiDetector = (text) =>
  /\bbuildAsIfSoulCoreChoice\b/.test(text) ||
  /\basIfSoulCoreResolution\b/.test(text);

const asIfSoulCoreDeclarationFreezeDetector = (text) =>
  /adventUseAlternateCost\s*:\s*\w+Action\.useAlternateCost/.test(text) ||
  /\bcontractCombineCostWaived\s*:\s*true\b/.test(text) ||
  /\buseAlternateCost\s*:\s*true\b/.test(text) ||
  /\bcostWaived\s*:\s*true\b/.test(text);

// advent-source-leave-summon-exact-event:
// BSSG01-C08 型の「離れるとき、その煌臨元を召喚」は pending leave pre-flush
// 参照であり、physical `leave_field` 専用の exactEventKind:true と同居してはいけない。
// restrictToTriggerLeaveAdventSource はこのスコープ限定召喚の marker なので、
// 近傍に exactEventKind:true が戻ったら回帰として fail する。
const ADVENT_LEAVE_SUMMON_CONTEXT_CHARS = 1800;
const adventSourceLeaveSummonExactEventDetector = (text) => {
  const re = /\brestrictToTriggerLeaveAdventSource\s*:\s*true\b/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const nearby = text.slice(
      Math.max(0, match.index - ADVENT_LEAVE_SUMMON_CONTEXT_CHARS),
      Math.min(text.length, match.index + ADVENT_LEAVE_SUMMON_CONTEXT_CHARS)
    );
    if (
      /\bevent\s*:\s*["']leave_field["']/.test(nearby) &&
      /\bexactEventKind\s*:\s*true\b/.test(nearby)
    ) {
      return true;
    }
  }
  return false;
};

// core-source-takeable-parallel: コア移動元候補判定の5層のうち3層以上を
// 自前で呼び直している経路 (scan:ssot-candidates probe を 2026-08-05 全件修正で
// 卒業移植)。正源 getFieldCoreSourceTakeableCount() は独立コア管理 / 対象ロック /
// 効果免疫 / CardFilter 既定除外 / コア最低残存数耐性を一括適用するため、
// 個別 helper の共起は同じ概念の並行実装として扱う。
const CORE_SOURCE_TAKEABLE_LAYERS = [
  /\b(?:canMoveCoresFrom|hasIndependentCoreManagement)\s*\(/,
  /\bapplyCardTargetAcquisitionGate\s*\(/,
  /\bresolveCardImmunityAffect\s*\(/,
  /\bcoreShootCardMatchesFilter\s*\(/,
  /\bgetCoreMinimumProtectedByResistance\s*\(/,
];
const coreSourceTakeableParallelDetector = (text) =>
  CORE_SOURCE_TAKEABLE_LAYERS.filter((re) => re.test(text)).length >= 3;

/**
 * 登録された SSOT rule。
 * - scope: この rule が対象とするファイル (posix path 前方一致 regex)。省略時は全ソース。
 * - detector(text): そのファイルが「概念の判別・写像」を含むか
 * - allow: 正源所有 / 正当な別用途 (regex, posix path に対して test)
 * - baseline: 現状容認済みの正当サイト (control-flow / consumer 等)。新規はここに足さず正源へ寄せる。
 * - canonical: 寄せ先の正源関数名 (メッセージ用)
 *
 * NOTE: detector は「ゾーン三つ組判別 ＋ overrides 構築 ＋ 正源非経由」= 表示キーの
 * 並行写像だけにマッチする。ゾーンを判別*するだけ*の制御フロー・エンジン機構・別レイヤは
 * 対象外 (必要な分散を阻害しない)。正源 coreContainerDisplayKey は playground-web 表示層の
 * 概念なので scope も表示層に限定する。rules-core エンジンのコンテナ操作は別レイヤの関心事。
 */
const RULES = [
  {
    name: "continuation-resolution-scope",
    description:
      "継続再開と最終化は一つの原因IDスコープを共有し、別々のIDを指定しない。",
    scope:
      /packages[\\/]rules-core[\\/]src[\\/]legal[\\/](?:pending-action-handlers|stack-resolution-core)\.ts$/,
    detector: (text) => resolutionScopeGuard.hasUnscopedResolutionCalls(text),
    canonical: "effect/effect-resolution-scope.ts",
    allow: [],
    baseline: [],
  },
  {
    name: "action-resolution-scope",
    description: "行動の継続最終化も実行元と同じ原因IDスコープを経由する。",
    scope:
      /packages[\\/]rules-core[\\/]src[\\/]legal[\\/]legal-actions-apply\.ts$/,
    detector: (text) =>
      resolutionScopeGuard.hasUnscopedResolutionCalls(text, true),
    canonical: "effect/effect-resolution-scope.ts",
    allow: [],
    baseline: [],
  },
  {
    name: "battle-lifetime-finalization",
    description:
      "成立済みバトルの破棄はバトル/ステップ終了処理が所有する。参加体の離脱処理から activeAttack を消さない。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: (text) =>
      /\bactiveAttack\s*:\s*null\b|\.activeAttack\s*=\s*null\b/.test(text),
    canonical:
      "battle/battle-actions.ts / effect/structured-state-grants.ts / turn-system.ts",
    allow: [
      /[\\/]battle[\\/]battle-actions\.ts$/,
      /[\\/]effect[\\/]structured-state-grants\.ts$/,
      /[\\/]turn-system\.ts$/,
      /[\\/]factories\.ts$/,
      /[\\/]state-sanitize\.ts$/,
      /[\\/]ai-observation-encoder\.ts$/,
    ],
    baseline: [],
  },
  {
    name: "core-zone-display-mapping",
    description:
      "コア所在ゾーン (reserve/trash/life) → 表示キーの並行写像。正源 coreContainerDisplayKey() に集約する。",
    scope: /^apps[\\/]playground-web[\\/]src[\\/]/,
    detector: isParallelZoneDisplayMapping,
    canonical:
      "coreContainerDisplayKey() (apps/playground-web/src/coreDisplayOverrides.ts)",
    allow: [
      /apps[\\/]playground-web[\\/]src[\\/]coreDisplayOverrides\.ts$/,
      /apps[\\/]playground-web[\\/]src[\\/]coreSelectionFacade\.ts$/,
    ],
    baseline: [
      // tap / 支払い等の制御フローでゾーン種別を分岐する正当サイト、および zone を
      // 直接描画する consumer。表示キー写像ではないので容認。新規の表示キー写像は
      // ここに足さず coreContainerDisplayKey を共有すること。
      "apps/playground-web/src/components/BattleScreen.tsx",
      "apps/playground-web/src/components/FieldArea.tsx",
    ],
  },
  {
    name: "target-affect-gate-consumer",
    description:
      "効果対象/作用判定 helper の executor 直呼び。正源 effect-affect-adapter の AffectDecision gate に集約する。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: targetAffectLegacyHelperDetector,
    canonical: "effect-affect-adapter.ts (TargetRef/AffectDecision gate)",
    allow: [
      /packages[\\/]rules-core[\\/]src[\\/](?:[a-z-]+[\\/])?effect-affect-adapter\.ts$/,
      /packages[\\/]rules-core[\\/]src[\\/](?:[a-z-]+[\\/])?effect-resistance-check\.ts$/,
    ],
    baseline: [],
  },
  {
    name: "stack-window-opener-direct-call",
    description:
      "低レベル stack-window opener (openStackWindow 等 6 関数) の直接呼び出し。正源 openEffectDeclarationStackWindow() / openDeferredDeclarationStackWindow() (legal-actions-apply.ts) に集約する (P3-113)。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: stackWindowOpenerDirectCallDetector,
    canonical:
      "openEffectDeclarationStackWindow() / openDeferredDeclarationStackWindow() (legal/legal-actions-apply.ts)",
    allow: [
      /packages[\\/]rules-core[\\/]src[\\/]legal[\\/]stack-window-openers\.ts$/,
      /packages[\\/]rules-core[\\/]src[\\/]legal[\\/]legal-actions-apply\.ts$/,
    ],
    baseline: [],
  },
  {
    name: "exclude-category-effective-lookup",
    description:
      "CardFilter.category(ies) 判定の def.printedCategory 直読。正源 getEffectiveCategory() (act-as-spirit.ts) に集約する (P3-121)。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: excludeCategoryDirectReadDetector,
    canonical: "getEffectiveCategory() (mechanics/act-as-spirit.ts)",
    allow: [
      /packages[\\/]rules-core[\\/]src[\\/]mechanics[\\/]act-as-spirit\.ts$/,
    ],
    baseline: EXCLUDE_CATEGORY_BASELINE_FILES,
  },
  {
    name: "kind-dispatch-silent-default",
    description:
      "kind による switch の default: が具体ドメイン値(文字列/オブジェクトリテラル)を返す構造。未列挙 kind が静かに別物として扱われ、型でもテストでも検出されない (P3-139)。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: kindDispatchSilentDefaultDetector,
    canonical:
      "throw / never 網羅チェック (`: never` exhaustiveness) / undefined 返却のいずれか（新 kind 追加時に必ず気付く形。switch ごとに選ぶ）",
    allow: [],
    baseline: [],
  },
  {
    name: "tribe-match-inline",
    description:
      "系統トークン集合に対する some/every + includes による系統マッチ判定のインライン実装。正源 matchesTribes() は tribesLogic(AND/OR) / tribesRequired / excludeTribeSubstring / noTribes の 4 軸を一括で見るため、インライン実装はいずれかを取りこぼす。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: tribeMatchInlineDetector,
    canonical: "matchesTribes() (packages/rules-core/src/card/tribe-filter.ts)",
    allow: [/packages[\\/]rules-core[\\/]src[\\/]card[\\/]tribe-filter\.ts$/],
    baseline: TRIBE_MATCH_INLINE_BASELINE_FILES,
  },
  {
    name: "card-filter-enumerated-projection",
    description:
      "CardFilter 系の値を per-field 条件付きスプレッドで列挙コピーしている射影。列挙から漏れたフィールドが silent drop される。素のスプレッド ({ ...filter }) に寄せる。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: cardFilterEnumeratedProjectionDetector,
    canonical:
      "素のスプレッド `{ ...<filter> }`（CardFilter を丸ごと渡す。card-filter.ts の matchesCardFilter/matchesCostCEFilterClause が丸ごと消費する）",
    allow: [],
    baseline: [],
  },
  {
    name: "zone-browse-current-state-detail",
    description:
      "ZoneBrowseModal の詳細表示が CardDefinition 単体へ落ちる経路。ゾーンブラウズ詳細は GameState.cardInstances の current CardInstance を SSOT として CardDetailModal へ渡す。",
    scope:
      /^apps[\\/]playground-web[\\/]src[\\/]components[\\/]ZoneBrowseModal\.tsx$/,
    detector: zoneBrowseDefinitionOnlyDetailDetector,
    canonical:
      "detailInstanceId → state.cardInstances.find(...) → CardDetailModal cardInstance/gameState/getCardDefinitionById",
    allow: [],
    baseline: [],
  },
  {
    name: "effect-core-choice-must-use-hud",
    description:
      "効果解決が任意のコア支払元・配置を自動決定している。候補プレビュー以外は共通pending/HUDへ渡す。",
    scope:
      /^packages[\\/]rules-core[\\/]src[\\/](?:effect[\\/](?:structured-summon|hand-gain-cost)|legal[\\/]pending-action-handlers)\.ts$/,
    detector: hasImplicitEffectCoreChoice,
    canonical:
      "resolveEffectSummonPaymentChoice / pendingMultiPlacement / getAutomaticNormalCorePaymentSources",
    allow: [],
    baseline: [],
  },
  {
    name: "multi-placement-field-source-ssot",
    description:
      "複数配置HUDの候補表示/grabが生のcardInstancesから配置元を独自判定している。通常召喚と共通のbuildPlacementFieldSourcesを使う。",
    scope: /^apps[\\/]playground-web[\\/]src[\\/]/,
    detector: hasRawMultiPlacementFieldSources,
    canonical:
      "placementFieldSources.ts: buildPlacementFieldSources → canProvideEnterFieldCorePlacementSource",
    allow: [],
    baseline: [],
  },
  {
    name: "core-operation-dedicated-selector",
    description:
      "コア配置/移動/掴み/コスト支払い系の配分・支払い元選択を専用モーダル/ローカル state で実装している。既存 coreSelection/CoreSelectionHud/FieldArea tap 経路に集約する。",
    scope: /^apps[\\/]playground-web[\\/]src[\\/]components[\\/]/,
    detector: dedicatedCoreOperationSelectorDetector,
    canonical:
      "coreSelectionFacade + CoreSelectionHud + FieldArea coreTap* (apps/playground-web/src)",
    allow: [],
    baseline: [],
  },
  {
    name: "effect-text-summon-cost-before-stack",
    description:
      "use_hand_card_effect / resolve_pending_triggered_effect の効果文内自己召喚コストを、発揮応答スタック窓より前の summon_in_trigger HUD に流している。効果文内コストは窓後 executeSummon に集約する。",
    scope:
      /^apps[\\/]playground-web[\\/]src[\\/]components[\\/]BattleScreen\.tsx$/,
    detector: effectTextSummonCostBeforeStackDetector,
    canonical:
      "10_rules/02:197-199 + executeSummon の窓後 cost/pendingMultiPlacement 処理",
    allow: [],
    baseline: [],
  },
  {
    name: "as-if-soul-core-choice-before-stack-ui",
    description:
      "【契約合体】/【煌臨】系の「ソウルコアを置いたものとして」選択を GUI が宣言クリック時に独自モーダル化している。選択は窓後 pendingAsIfSoulCoreChoice に集約する。",
    scope:
      /^apps[\\/]playground-web[\\/]src[\\/]components[\\/]BattleScreen\.tsx$/,
    detector: asIfSoulCoreChoiceBeforeStackUiDetector,
    canonical:
      "pendingAsIfSoulCoreChoice (rules-core stack-resolution-core.ts → BattleScreen resolve_pending_as_if_soul_core_choice)",
    allow: [],
    baseline: [],
  },
  {
    name: "as-if-soul-core-declaration-freeze",
    description:
      "【契約合体】/【煌臨】系の通常/擬制経路を legal declaration action / ActiveStack に宣言時固定している。効果文内の経路選択は窓後 pendingAsIfSoulCoreChoice に集約する。",
    scope:
      /^packages[\\/]rules-core[\\/]src[\\/]legal[\\/](?:legal-actions-apply|legal-actions-availability)\.ts$/,
    detector: asIfSoulCoreDeclarationFreezeDetector,
    canonical:
      "pendingAsIfSoulCoreChoice + applyAsIfSoulCoreChoiceToStack() (legal/stack-resolution-core.ts)",
    allow: [],
    baseline: [],
  },
  {
    name: "advent-source-leave-summon-exact-event",
    description:
      "restrictToTriggerLeaveAdventSource 型の煌臨元召喚を physical leave_field 専用 exactEventKind:true に戻している。これは pending leave pre-flush の「離れるとき」参照に集約する。",
    scope: /^packages[\\/]card-data[\\/]src[\\/]cards[\\/]/,
    detector: adventSourceLeaveSummonExactEventDetector,
    canonical:
      "10_rules/04_state-based-rules.md「離れるとき」= pending leave pre-flush + trigger-system.ts pendingLeave adventSourceInstanceIds",
    allow: [],
    baseline: [],
  },
  {
    name: "core-source-takeable-parallel",
    description:
      "コア移動元候補判定の5層のうち3層以上を自前で呼び直している経路。正源 getFieldCoreSourceTakeableCount() に集約する。",
    scope: /^packages[\\/]rules-core[\\/]src[\\/]/,
    detector: coreSourceTakeableParallelDetector,
    canonical:
      "getFieldCoreSourceTakeableCount() (packages/rules-core/src/effect/structured-core-shoot.ts)",
    allow: [
      /packages[\\/]rules-core[\\/]src[\\/]effect[\\/]structured-core-shoot\.ts$/,
    ],
    baseline: [],
  },
];

// P3-116 再発防止: LEGAL_ACTION_WINDOW_CLASSIFICATION の `not_a_declaration` エントリが
// 「現状こう動いているから」という理由だけで分類されていないかの warn-only 検出。
// P3-112/P3-115/P3-116 で3件連続反復した「実装形状を正としてルールテキスト再照合を
// 省略する」認知パターンの機械ガード。RULES (fail する SSOT 違反) とは別系統: ここは
// warn のみで exit code に影響しない (`brave_combine` 等ルール未確定の kind を build gate
// でブロックしないため)。導入時点で既存の resolve_*/pass_* 系エントリの多くが個別引用を
// 持たず warn 対象になるのは既知 (P3-115 時点で束ね書きだったための想定内ノイズ、
// 段階的な追記候補として残す)。
const WINDOW_CLASSIFICATION_FILE =
  "packages/rules-core/src/legal/legal-action-window-classification.ts";
const CITATION_PATTERNS = [
  /pending[A-Z]\w*/,
  /02:[12]\d\d/,
  /04b:\d+/,
  /needs-ruling/i,
];

const FREESTANDING_NOT_DECLARATION_ALLOWLIST = new Set([
  // Rule-confirmed non-declarations despite being standalone legal actions:
  // pass actions close an existing window; decline/end are routine progression;
  // set_burst is setup bookkeeping, not activation.
  "pass_stack",
  "pass_pre_declaration_stack",
  "decline_block",
  "end_attack_step",
  "set_burst",
]);

function toPascalCaseKind(kind) {
  return kind
    .split("_")
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join("");
}

function parseClassificationEntries(text, value) {
  const lines = text.split("\n");
  const entries = [];
  const entryRe = new RegExp(
    `^\\s*([a-zA-Z_][a-zA-Z0-9_]*):\\s*"${value}",?\\s*(\\/\\/.*)?$`
  );
  for (let i = 0; i < lines.length; i++) {
    const m = entryRe.exec(lines[i]);
    if (!m) continue;
    const kind = m[1];
    const trailingComment = m[2] ?? "";
    const precedingLines = [];
    let j = i - 1;
    while (j >= 0) {
      const trimmed = lines[j].trim();
      if (trimmed.startsWith("//")) {
        precedingLines.unshift(trimmed);
        j--;
        continue;
      }
      break;
    }
    entries.push({
      kind,
      line: i + 1,
      citationText: [...precedingLines, trailingComment].join(" "),
    });
  }
  return entries;
}

async function checkWindowClassificationCitations(files, cache) {
  const abs = files.find((f) => toPosix(f) === WINDOW_CLASSIFICATION_FILE);
  if (!abs) return [];
  let text = cache.get(abs);
  if (text === undefined) {
    text = await readFile(abs, "utf8");
    cache.set(abs, text);
  }
  const entries = parseClassificationEntries(text, "not_a_declaration");
  const warnings = [];
  for (const entry of entries) {
    const hasCitation = CITATION_PATTERNS.some((re) =>
      re.test(entry.citationText)
    );
    if (!hasCitation) {
      warnings.push(
        `[not-a-declaration-needs-citation] ${WINDOW_CLASSIFICATION_FILE}:${entry.line} ` +
          `"${entry.kind}" に pending state 名 / 02:1xx-2xx / 04b:* / needs-ruling いずれの根拠引用も無い。`
      );
    }
  }
  return warnings;
}

// 逆方向チェック: `not_a_declaration` に分類された kind の getAvailable*LegalActions が
// `pending` 系 state 参照を一切持たない (= フリースタンディング宣言) のに not_a_declaration
// のままなら warn する。命名規約 getAvailable<PascalKind>LegalActions で確実に特定できた
// 場合のみ判定し (未特定は false positive 回避のためスキップ)、bullet_edit 発見時の
// 構造的シグナル (P3-116 issue 根拠) を継続監視する。
async function checkFreestandingNotADeclarationKinds(files, cache) {
  const classificationAbs = files.find(
    (f) => toPosix(f) === WINDOW_CLASSIFICATION_FILE
  );
  if (!classificationAbs) return [];
  let classificationText = cache.get(classificationAbs);
  if (classificationText === undefined) {
    classificationText = await readFile(classificationAbs, "utf8");
    cache.set(classificationAbs, classificationText);
  }
  const entries = parseClassificationEntries(
    classificationText,
    "not_a_declaration"
  );

  const rulesCoreFiles = files.filter((f) =>
    /^packages[\\/]rules-core[\\/]src[\\/]/.test(toPosix(f))
  );
  const warnings = [];
  for (const entry of entries) {
    const fnName = `getAvailable${toPascalCaseKind(entry.kind)}LegalActions`;
    for (const abs of rulesCoreFiles) {
      let text = cache.get(abs);
      if (text === undefined) {
        text = await readFile(abs, "utf8");
        cache.set(abs, text);
      }
      const startIdx = text.indexOf(`function ${fnName}(`);
      if (startIdx === -1) continue;
      const braceStart = text.indexOf("{", startIdx);
      if (braceStart === -1) break;
      let depth = 0;
      let endIdx = -1;
      for (let k = braceStart; k < text.length; k++) {
        if (text[k] === "{") depth++;
        else if (text[k] === "}") {
          depth--;
          if (depth === 0) {
            endIdx = k;
            break;
          }
        }
      }
      if (endIdx === -1) break;
      const body = text.slice(braceStart, endIdx);
      if (
        !/\bpending[A-Za-z]*\b/.test(body) &&
        !FREESTANDING_NOT_DECLARATION_ALLOWLIST.has(entry.kind)
      ) {
        warnings.push(
          `[freestanding-not-a-declaration] ${toPosix(abs)}: ${fnName}() は ` +
            `pending state を参照しないフリースタンディング宣言だが、"${entry.kind}" は ` +
            `LEGAL_ACTION_WINDOW_CLASSIFICATION で not_a_declaration に分類されている ` +
            `(02:190 適合性の再確認候補、P3-116)。`
        );
      }
      break;
    }
  }
  return warnings;
}

// P3-115 機械ガード項目3: `opens_own_window` に分類された kind の
// `LEGAL_ACTION_HANDLERS`（legal-actions-apply.ts）エントリ本体が、窓関連識別子
// （`preDeclarationStackWindow`/`stackWindow`/`openEffectDeclarationStackWindow`/
// `openDeferredDeclarationStackWindow`/低レベル opener 群/`flashWindowState`）を
// 本体・直接委譲先1段のいずれにも一切参照していない場合の warn-only 検出。
// P3-113 の stack-window-opener-direct-call（あってはいけない直接呼び出しの検出）
// と対になる「あるべき参照の省略」検出。呼び出しグラフの厳密なトレースは行わず、
// ハンドラ本体テキスト + 直接呼び出し先関数本体1段のテキスト検索による近似検知
// (issue 記載の一次防衛線方針)。
const LEGAL_ACTIONS_APPLY_FILE =
  "packages/rules-core/src/legal/legal-actions-apply.ts";
const OPENS_OWN_WINDOW_MARKERS = [
  "preDeclarationStackWindow",
  "stackWindow",
  "flashWindowState",
  "openEffectDeclarationStackWindow",
  "openDeferredDeclarationStackWindow",
  ...STACK_WINDOW_LOW_LEVEL_OPENERS,
];
const OPENS_OWN_WINDOW_MARKER_RE = new RegExp(
  `\\b(?:${OPENS_OWN_WINDOW_MARKERS.join("|")})\\b`
);
// `options.foo(`のようなメンバアクセス呼び出しは対象外 (直前が `.` のものを除外)。
const CALL_IDENTIFIER_RE = /(?<!\.)\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

// `key: (...) => ...` エントリの本体を、丸括弧/波括弧/角括弧の深さがトップレベルに
// 戻った直後の最初のカンマまでとして抽出する (単一式アロー・ブロックアロー両対応)。
function extractHandlerEntryBody(text, key) {
  const startMatch = new RegExp(`(?:^|\\n)[ \\t]*${key}:\\s*\\(`).exec(text);
  if (!startMatch) return null;
  const bodyStart = text.indexOf(`${key}:`, startMatch.index) + key.length + 1;
  let depth = 0;
  let i = bodyStart;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth--;
    else if (ch === "," && depth === 0) break;
  }
  return text.slice(bodyStart, i);
}

// 関数名から定義本体 (最初に見つかった `function name(...) {...}` /
// `const name = (...) => {...}` の波括弧内) を全ファイル横断で1件だけ探す。
async function findFunctionBodyAcrossFiles(name, files, cache) {
  const declRe = new RegExp(
    `(?:export\\s+)?function\\s+${name}\\b\\s*\\(|(?:export\\s+)?const\\s+${name}\\b[^=]*=\\s*(?:async\\s*)?\\(`
  );
  for (const abs of files) {
    let text = cache.get(abs);
    if (text === undefined) {
      text = await readFile(abs, "utf8");
      cache.set(abs, text);
    }
    const m = declRe.exec(text);
    if (!m) continue;
    const braceIdx = text.indexOf("{", m.index);
    if (braceIdx === -1) continue;
    let depth = 0;
    let end = -1;
    for (let k = braceIdx; k < text.length; k++) {
      if (text[k] === "{") depth++;
      else if (text[k] === "}") {
        depth--;
        if (depth === 0) {
          end = k;
          break;
        }
      }
    }
    if (end === -1) continue;
    return text.slice(braceIdx, end);
  }
  return null;
}

async function checkOpensOwnWindowHandlersReferenceWindow(files, cache) {
  const classificationAbs = files.find(
    (f) => toPosix(f) === WINDOW_CLASSIFICATION_FILE
  );
  const applyAbs = files.find((f) => toPosix(f) === LEGAL_ACTIONS_APPLY_FILE);
  if (!classificationAbs || !applyAbs) return [];
  let classificationText = cache.get(classificationAbs);
  if (classificationText === undefined) {
    classificationText = await readFile(classificationAbs, "utf8");
    cache.set(classificationAbs, classificationText);
  }
  let applyText = cache.get(applyAbs);
  if (applyText === undefined) {
    applyText = await readFile(applyAbs, "utf8");
    cache.set(applyAbs, applyText);
  }
  const entries = parseClassificationEntries(
    classificationText,
    "opens_own_window"
  );

  const warnings = [];
  for (const entry of entries) {
    const body = extractHandlerEntryBody(applyText, entry.kind);
    if (body === null) {
      warnings.push(
        `[opens-own-window-missing-handler] ${WINDOW_CLASSIFICATION_FILE}:${entry.line} ` +
          `"${entry.kind}" は opens_own_window だが LEGAL_ACTION_HANDLERS (${LEGAL_ACTIONS_APPLY_FILE}) に対応する handler entry が見つからない。`
      );
      continue;
    }
    if (OPENS_OWN_WINDOW_MARKER_RE.test(body)) continue;

    const calledNames = new Set();
    for (const m of body.matchAll(CALL_IDENTIFIER_RE)) calledNames.add(m[1]);
    let foundInDelegate = false;
    for (const name of calledNames) {
      const delegateBody = await findFunctionBodyAcrossFiles(
        name,
        files,
        cache
      );
      if (delegateBody && OPENS_OWN_WINDOW_MARKER_RE.test(delegateBody)) {
        foundInDelegate = true;
        break;
      }
    }
    if (!foundInDelegate) {
      warnings.push(
        `[opens-own-window-missing-reference] ${LEGAL_ACTIONS_APPLY_FILE} ` +
          `LEGAL_ACTION_HANDLERS.${entry.kind} (opens_own_window, ${WINDOW_CLASSIFICATION_FILE}:${entry.line}) が ` +
          `窓関連識別子 (preDeclarationStackWindow/stackWindow/openEffectDeclarationStackWindow 等) を ` +
          `ハンドラ本体・直接委譲先いずれにも参照していない (P3-115 機械ガード項目3)。`
      );
    }
  }
  return warnings;
}

function collectCountOptionalStepIssuesForContainer(
  out,
  cardNo,
  effects,
  textLines,
  detailPrefix = ""
) {
  if (!Array.isArray(effects)) return;
  for (const [effectIndex, effect] of effects.entries()) {
    const issues = findCountZeroOptionalCountStepIssues(effect, textLines);
    for (const issue of issues) {
      const steps = issue.dependentStepIndexes?.length
        ? ` steps=${issue.dependentStepIndexes.join(",")}`
        : "";
      out.push({
        cardNo,
        detail: `${detailPrefix}effects[${effectIndex}]: ${issue.detail}${steps}`,
      });
    }
  }
}

function collectCountOptionalStepIssuesForFace(
  out,
  face,
  faceCardNo,
  textLines,
  detailPrefix = ""
) {
  collectCountOptionalStepIssuesForContainer(
    out,
    faceCardNo,
    face.effects,
    textLines,
    detailPrefix
  );
  const nestedContainers = [
    ["mirage", face.mirageData],
    ["accel", face.accelData],
    ["change", face.changeData],
    ["zeroCounter", face.zeroCounterData],
    ["quartz", face.quartzData],
  ];
  for (const [tag, data] of nestedContainers) {
    collectCountOptionalStepIssuesForContainer(
      out,
      `${faceCardNo}#${tag}`,
      data?.effects,
      textLines,
      detailPrefix
    );
  }
}

async function checkCardDataCountOptionalStepSsot() {
  try {
    execSync("npx tsc -b packages/card-data", { cwd: ROOT, stdio: "pipe" });
  } catch (e) {
    const output = `${e.stdout || ""}${e.stderr || ""}`.trim();
    return [
      {
        cardNo: "packages/card-data",
        detail: `card-data build failed before count optional step SSOT audit${output ? `: ${output.slice(0, 500)}` : ""}`,
      },
    ];
  }

  const distUrl =
    pathToFileURL(join(ROOT, "packages/card-data/dist/generated-index.js"))
      .href + `?ssot=${Date.now()}`;
  const { ALL_CARDS } = await import(distUrl);
  const issues = [];
  for (const card of ALL_CARDS) {
    collectCountOptionalStepIssuesForFace(
      issues,
      card,
      card.cardNo,
      card.textLines
    );
    if (card.backFace) {
      collectCountOptionalStepIssuesForFace(
        issues,
        card.backFace,
        card.backFace.cardNo || `${card.cardNo}#back`,
        card.backFace.textLines,
        "backFace "
      );
    }
    if (card.grandwalkerData?.divineSkills) {
      for (const [
        skillIndex,
        skill,
      ] of card.grandwalkerData.divineSkills.entries()) {
        collectCountOptionalStepIssuesForContainer(
          issues,
          `${card.cardNo}#divineSkill[${skillIndex}]`,
          skill.effects,
          card.textLines
        );
      }
    }
  }
  return issues;
}

async function readCachedProjectFile(cache, relPath) {
  const abs = join(ROOT, relPath);
  let text = cache.get(abs);
  if (text === undefined) {
    text = await readFile(abs, "utf8");
    cache.set(abs, text);
  }
  return text;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sourceFileFromText(relPath, text) {
  return ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true);
}

function propertyNameText(name) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name)
  ) {
    return name.text;
  }
  throw new Error(`Unsupported property name: ${name.getText()}`);
}

function unwrapTsExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function collectInterfaceFieldsFromText(relPath, text, interfaceName) {
  const file = sourceFileFromText(relPath, text);
  for (const statement of file.statements) {
    if (
      !ts.isInterfaceDeclaration(statement) ||
      statement.name.text !== interfaceName
    ) {
      continue;
    }
    return sortedUnique(
      statement.members
        .filter(ts.isPropertySignature)
        .map((member) => propertyNameText(member.name))
    );
  }
  throw new Error(`${interfaceName} interface not found in ${relPath}`);
}

function stringLiteralsFromTypeNode(typeNode) {
  if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
    return [typeNode.literal.text];
  }
  if (ts.isUnionTypeNode(typeNode)) {
    return typeNode.types.flatMap(stringLiteralsFromTypeNode);
  }
  return [];
}

function collectTypeAliasStringUnionFromText(relPath, text, typeName) {
  const file = sourceFileFromText(relPath, text);
  for (const statement of file.statements) {
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === typeName
    ) {
      const values = stringLiteralsFromTypeNode(statement.type);
      if (values.length === 0) {
        throw new Error(`${typeName} has no string literals in ${relPath}`);
      }
      return sortedUnique(values);
    }
  }
  throw new Error(`${typeName} type alias not found in ${relPath}`);
}

function collectInterfacePropertyStringUnionFromText(
  relPath,
  text,
  interfaceName,
  propertyName
) {
  const file = sourceFileFromText(relPath, text);
  for (const statement of file.statements) {
    if (
      !ts.isInterfaceDeclaration(statement) ||
      statement.name.text !== interfaceName
    ) {
      continue;
    }
    for (const member of statement.members) {
      if (
        !ts.isPropertySignature(member) ||
        propertyNameText(member.name) !== propertyName ||
        !member.type
      ) {
        continue;
      }
      const values = stringLiteralsFromTypeNode(member.type);
      if (values.length === 0) {
        throw new Error(
          `${interfaceName}.${propertyName} has no string literals in ${relPath}`
        );
      }
      return sortedUnique(values);
    }
    throw new Error(
      `${interfaceName}.${propertyName} property not found in ${relPath}`
    );
  }
  throw new Error(`${interfaceName} interface not found in ${relPath}`);
}

function collectStringArrayConstFromText(relPath, text, constName) {
  const file = sourceFileFromText(relPath, text);
  let values;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName &&
      node.initializer
    ) {
      const initializer = unwrapTsExpression(node.initializer);
      if (!ts.isArrayLiteralExpression(initializer)) {
        throw new Error(`${constName} is not an array literal in ${relPath}`);
      }
      values = initializer.elements.map((element) => {
        if (!ts.isStringLiteral(element)) {
          throw new Error(`${constName} contains non-string element`);
        }
        return element.text;
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!values) throw new Error(`${constName} const not found in ${relPath}`);
  return sortedUnique(values);
}

function collectObjectConstEntriesFromText(relPath, text, constName) {
  const file = sourceFileFromText(relPath, text);
  let entries;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName &&
      node.initializer
    ) {
      const initializer = unwrapTsExpression(node.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) {
        throw new Error(`${constName} is not an object literal in ${relPath}`);
      }
      entries = new Map();
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) {
          throw new Error(`${constName} has unsupported object property`);
        }
        const key = propertyNameText(property.name);
        const value = unwrapTsExpression(property.initializer);
        entries.set(key, ts.isStringLiteral(value) ? value.text : undefined);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!entries) throw new Error(`${constName} const not found in ${relPath}`);
  return entries;
}

function collectObjectConstKeysFromText(relPath, text, constName) {
  return sortedUnique(
    collectObjectConstEntriesFromText(relPath, text, constName).keys()
  );
}

function collectArrayPropertyFromObjectConstText(
  relPath,
  text,
  constName,
  propertyName
) {
  const file = sourceFileFromText(relPath, text);
  let values;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constName &&
      node.initializer
    ) {
      const initializer = unwrapTsExpression(node.initializer);
      if (!ts.isObjectLiteralExpression(initializer)) {
        throw new Error(`${constName} is not an object literal in ${relPath}`);
      }
      for (const property of initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        if (propertyNameText(property.name) !== propertyName) continue;
        const value = unwrapTsExpression(property.initializer);
        if (!ts.isArrayLiteralExpression(value)) {
          throw new Error(`${constName}.${propertyName} is not an array`);
        }
        values = value.elements.map((element) => {
          if (!ts.isStringLiteral(element)) {
            throw new Error(
              `${constName}.${propertyName} has non-string element`
            );
          }
          return element.text;
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!values) {
    throw new Error(`${constName}.${propertyName} not found in ${relPath}`);
  }
  return sortedUnique(values);
}

function collectDiscriminantKindsFromText(
  relPath,
  text,
  typeName,
  discriminantName
) {
  const file = sourceFileFromText(relPath, text);
  const kindsFromType = (node) => {
    if (ts.isUnionTypeNode(node)) return node.types.flatMap(kindsFromType);
    if (!ts.isTypeLiteralNode(node)) return [];
    for (const member of node.members) {
      if (
        ts.isPropertySignature(member) &&
        member.type &&
        propertyNameText(member.name) === discriminantName
      ) {
        return stringLiteralsFromTypeNode(member.type);
      }
    }
    return [];
  };
  for (const statement of file.statements) {
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === typeName
    ) {
      return sortedUnique(kindsFromType(statement.type));
    }
  }
  throw new Error(`${typeName} type alias not found in ${relPath}`);
}

function collectLegalActionKindsFromText(relPath, text) {
  const file = sourceFileFromText(relPath, text);
  const interfaceKinds = new Map();
  for (const statement of file.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    for (const member of statement.members) {
      if (
        !ts.isPropertySignature(member) ||
        !ts.isIdentifier(member.name) ||
        member.name.text !== "kind" ||
        !member.type
      ) {
        continue;
      }
      const kinds = stringLiteralsFromTypeNode(member.type);
      if (kinds.length > 0) interfaceKinds.set(statement.name.text, kinds);
    }
  }
  for (const statement of file.statements) {
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      statement.name.text !== "LegalAction" ||
      !ts.isUnionTypeNode(statement.type)
    ) {
      continue;
    }
    const kinds = statement.type.types.flatMap((node) => {
      if (!ts.isTypeReferenceNode(node) || !ts.isIdentifier(node.typeName)) {
        throw new Error(`Unsupported LegalAction member: ${node.getText()}`);
      }
      const resolved = interfaceKinds.get(node.typeName.text);
      if (!resolved) {
        throw new Error(`Missing kind property for ${node.typeName.text}`);
      }
      return resolved;
    });
    return sortedUnique(kinds);
  }
  throw new Error(`LegalAction type alias not found in ${relPath}`);
}

function pushSetDiff(
  violations,
  rel,
  subject,
  actual,
  expected,
  rule = PLAYER_DECISION_CONTRACT_SSOT_RULE
) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((value) => !actualSet.has(value));
  const extra = actual.filter((value) => !expectedSet.has(value));
  if (missing.length === 0 && extra.length === 0) return;
  violations.push({
    rule,
    rel:
      `${rel}: ${subject} mismatch` +
      ` missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`,
  });
}

function pushUnsupportedValues(
  violations,
  rel,
  subject,
  entries,
  allowedValues,
  rule
) {
  const allowed = new Set(allowedValues);
  const invalid = [...entries]
    .filter(([, value]) => !allowed.has(value))
    .map(([field, value]) => `${field}:${value}`);
  if (invalid.length === 0) return;
  violations.push({
    rule,
    rel: `${rel}: unsupported ${subject} ${invalid.join(", ")}`,
  });
}

const PLAYER_DECISION_CONTRACT_SSOT_RULE = {
  name: "player-decision-contract-ssot",
  description:
    "人間/AI/通信の decision surface 契約。LegalAction / system action / preGame / action-input の追加時に分類・生成・適用・encoder 更新漏れを検知する。",
  canonical:
    "packages/rules-core/src/player-decision-contract.ts + training-decision-surface handler registries",
};

const ACTION_REPLAY_CONTROL_KEYS = ["clientMutationId", "serverAutoDrain"];

async function checkPlayerDecisionContractSsot(cache) {
  const violations = [];
  const contractRel = "packages/rules-core/src/player-decision-contract.ts";
  const legalRel = "packages/rules-core/src/legal/legal-actions-types.ts";
  const modelRel = "packages/rules-core/src/model.ts";
  const encoderRel = "packages/rules-core/src/training-action-encoder.ts";
  const trainingRel = "packages/rules-core/src/training-decision-surface.ts";
  const gameApiRel = "apps/playground-web/server/game-api.ts";

  const contract = await readCachedProjectFile(cache, contractRel);
  const legal = await readCachedProjectFile(cache, legalRel);
  const model = await readCachedProjectFile(cache, modelRel);
  const encoder = await readCachedProjectFile(cache, encoderRel);
  const training = await readCachedProjectFile(cache, trainingRel);
  const gameApi = await readCachedProjectFile(cache, gameApiRel);

  const applyFields = collectInterfaceFieldsFromText(
    legalRel,
    legal,
    "ApplyLegalActionOptions"
  );
  const applyRoleEntries = collectObjectConstEntriesFromText(
    contractRel,
    contract,
    "APPLY_OPTION_FIELD_ROLES"
  );
  pushSetDiff(
    violations,
    contractRel,
    "APPLY_OPTION_FIELD_ROLES keys vs ApplyLegalActionOptions fields",
    sortedUnique(applyRoleEntries.keys()),
    applyFields
  );
  const aiDecisionFields = sortedUnique(
    [...applyRoleEntries.entries()]
      .filter(([, role]) => role === "ai_decision")
      .map(([field]) => field)
  );
  const invalidRoles = [...applyRoleEntries.entries()]
    .filter(([, role]) => role !== "ai_decision" && role !== "engine_context")
    .map(([field, role]) => `${field}:${role}`);
  if (invalidRoles.length > 0) {
    violations.push({
      rule: PLAYER_DECISION_CONTRACT_SSOT_RULE,
      rel: `${contractRel}: unsupported ApplyLegalActionOptions roles ${invalidRoles.join(", ")}`,
    });
  }

  const passthroughKeys = collectStringArrayConstFromText(
    gameApiRel,
    gameApi,
    "passthroughKeys"
  );
  pushSetDiff(
    violations,
    gameApiRel,
    "extractApplyOptionsFromBody passthroughKeys vs ai_decision fields",
    passthroughKeys,
    aiDecisionFields
  );
  const actionAllowedKeys = collectArrayPropertyFromObjectConstText(
    gameApiRel,
    gameApi,
    "ALLOWED_KEYS",
    "action"
  );
  pushSetDiff(
    violations,
    gameApiRel,
    "ALLOWED_KEYS.action vs ai_decision fields + actionId + expectedVersion",
    actionAllowedKeys.filter(
      (key) => !ACTION_REPLAY_CONTROL_KEYS.includes(key)
    ),
    sortedUnique([...aiDecisionFields, "actionId", "expectedVersion"])
  );

  const legalKinds = collectLegalActionKindsFromText(legalRel, legal);
  const encodedKinds = collectStringArrayConstFromText(
    encoderRel,
    encoder,
    "ACTION_KINDS"
  );
  pushSetDiff(
    violations,
    encoderRel,
    "ACTION_KINDS vs LegalAction discriminants",
    encodedKinds,
    legalKinds
  );

  const systemKinds = collectStringArrayConstFromText(
    contractRel,
    contract,
    "PLAYER_SYSTEM_ACTION_KINDS"
  );
  pushSetDiff(
    violations,
    contractRel,
    "PLAYER_SYSTEM_ACTION_KINDS vs PlayerSystemAction union",
    systemKinds,
    collectDiscriminantKindsFromText(
      contractRel,
      contract,
      "PlayerSystemAction",
      "kind"
    )
  );
  pushSetDiff(
    violations,
    trainingRel,
    "SYSTEM_ACTION_CHOICE_BUILDERS vs PLAYER_SYSTEM_ACTION_KINDS",
    collectObjectConstKeysFromText(
      trainingRel,
      training,
      "SYSTEM_ACTION_CHOICE_BUILDERS"
    ),
    systemKinds
  );
  pushSetDiff(
    violations,
    trainingRel,
    "SYSTEM_ACTION_APPLIERS vs PLAYER_SYSTEM_ACTION_KINDS",
    collectObjectConstKeysFromText(
      trainingRel,
      training,
      "SYSTEM_ACTION_APPLIERS"
    ),
    systemKinds
  );

  const preGamePhases = collectTypeAliasStringUnionFromText(
    modelRel,
    model,
    "PreGamePhase"
  );
  const phaseRoleKeys = collectObjectConstKeysFromText(
    contractRel,
    contract,
    "PLAYER_PREGAME_PHASE_DECISION_ROLES"
  );
  pushSetDiff(
    violations,
    contractRel,
    "PLAYER_PREGAME_PHASE_DECISION_ROLES vs PreGamePhase",
    phaseRoleKeys,
    preGamePhases
  );
  pushSetDiff(
    violations,
    trainingRel,
    "PREGAME_DECISION_NODE_BUILDERS vs PreGamePhase",
    collectObjectConstKeysFromText(
      trainingRel,
      training,
      "PREGAME_DECISION_NODE_BUILDERS"
    ),
    preGamePhases
  );

  const preGameChoiceKinds = collectStringArrayConstFromText(
    contractRel,
    contract,
    "PLAYER_PREGAME_CHOICE_KINDS"
  );
  pushSetDiff(
    violations,
    contractRel,
    "PLAYER_PREGAME_CHOICE_KINDS vs PlayerPreGameChoice union",
    preGameChoiceKinds,
    collectDiscriminantKindsFromText(
      contractRel,
      contract,
      "PlayerPreGameChoice",
      "kind"
    )
  );
  pushSetDiff(
    violations,
    trainingRel,
    "PREGAME_CHOICE_APPLIERS vs PLAYER_PREGAME_CHOICE_KINDS",
    collectObjectConstKeysFromText(
      trainingRel,
      training,
      "PREGAME_CHOICE_APPLIERS"
    ),
    preGameChoiceKinds
  );

  const selfplayAutoFields = collectStringArrayConstFromText(
    contractRel,
    contract,
    "SELFPLAY_AUTO_INPUT_FIELDS"
  );
  pushSetDiff(
    violations,
    contractRel,
    "SELFPLAY_AUTO_INPUT_FIELDS subset check",
    selfplayAutoFields.filter((field) => !aiDecisionFields.includes(field)),
    []
  );
  const trainingImplementedFields = collectStringArrayConstFromText(
    trainingRel,
    training,
    "TRAINING_IMPLEMENTED_ACTION_INPUT_FIELDS"
  );
  const trainingGapFields = collectObjectConstKeysFromText(
    trainingRel,
    training,
    "TRAINING_ACTION_INPUT_FIELD_GAPS"
  );
  pushSetDiff(
    violations,
    trainingRel,
    "TRAINING_IMPLEMENTED_ACTION_INPUT_FIELDS + TRAINING_ACTION_INPUT_FIELD_GAPS vs ai_decision fields",
    sortedUnique([...trainingImplementedFields, ...trainingGapFields]),
    aiDecisionFields
  );

  return violations;
}

const AI_OBSERVATION_CONTRACT_SSOT_RULE = {
  name: "ai-observation-contract-ssot",
  description:
    "AI 観測入力と探索用field分類。GameState全field・pending・CardDefinitionの追加時に分類漏れを検知する。探索用分類は配送許可やH1-H3の証明ではない。",
  canonical:
    "packages/rules-core/src/{ai-observation,ai-search-state-fields}.ts + manual/ai-reference/20_design/16_ai-observation-contract.md",
};

async function checkAiObservationContractSsot(cache) {
  const violations = [];
  const modelRel = "packages/rules-core/src/model.ts";
  const observationRel = "packages/rules-core/src/ai-observation.ts";
  const encoderRel = "packages/rules-core/src/ai-observation-encoder.ts";
  const searchFieldsRel = "packages/rules-core/src/ai-search-state-fields.ts";

  const model = await readCachedProjectFile(cache, modelRel);
  const observation = await readCachedProjectFile(cache, observationRel);
  const encoder = await readCachedProjectFile(cache, encoderRel);
  const searchFields = await readCachedProjectFile(cache, searchFieldsRel);
  for (const issue of findAiSearchStateFieldIssues(model, searchFields)) {
    violations.push({
      rule: AI_OBSERVATION_CONTRACT_SSOT_RULE,
      rel: `${searchFieldsRel}: ${issue}`,
    });
  }

  const cardDefinitionFields = collectInterfaceFieldsFromText(
    modelRel,
    model,
    "CardDefinition"
  );
  const staticRoleEntries = collectObjectConstEntriesFromText(
    observationRel,
    observation,
    "AI_STATIC_CARD_FEATURE_FIELD_ROLES"
  );
  pushSetDiff(
    violations,
    observationRel,
    "AI_STATIC_CARD_FEATURE_FIELD_ROLES keys vs CardDefinition fields",
    sortedUnique(staticRoleEntries.keys()),
    cardDefinitionFields,
    AI_OBSERVATION_CONTRACT_SSOT_RULE
  );
  pushUnsupportedValues(
    violations,
    observationRel,
    "AI_STATIC_CARD_FEATURE_FIELD_ROLES roles",
    staticRoleEntries.entries(),
    [
      "feature",
      "mechanic_feature",
      "effect_feature",
      "visual",
      "metadata",
      "external_id",
    ],
    AI_OBSERVATION_CONTRACT_SSOT_RULE
  );

  const gameStatePendingFields = collectInterfaceFieldsFromText(
    modelRel,
    model,
    "GameState"
  ).filter((field) => field.startsWith("pending"));
  const pendingRoleEntries = collectObjectConstEntriesFromText(
    observationRel,
    observation,
    "AI_OBSERVATION_PENDING_FIELD_ROLES"
  );
  pushSetDiff(
    violations,
    observationRel,
    "AI_OBSERVATION_PENDING_FIELD_ROLES keys vs GameState pending* fields",
    sortedUnique(pendingRoleEntries.keys()),
    gameStatePendingFields,
    AI_OBSERVATION_CONTRACT_SSOT_RULE
  );
  pushUnsupportedValues(
    violations,
    observationRel,
    "AI_OBSERVATION_PENDING_FIELD_ROLES roles",
    pendingRoleEntries.entries(),
    ["summary", "engine_internal"],
    AI_OBSERVATION_CONTRACT_SSOT_RULE
  );

  const pushEncoderDomainDiff = (typeName, constName) => {
    pushSetDiff(
      violations,
      encoderRel,
      `${constName} vs ${typeName}`,
      collectStringArrayConstFromText(encoderRel, encoder, constName),
      collectTypeAliasStringUnionFromText(modelRel, model, typeName),
      AI_OBSERVATION_CONTRACT_SSOT_RULE
    );
  };
  pushEncoderDomainDiff("Zone", "AI_OBSERVATION_ENCODER_ZONE_DOMAIN");
  pushEncoderDomainDiff("Step", "AI_OBSERVATION_ENCODER_STEP_DOMAIN");
  pushEncoderDomainDiff("Window", "AI_OBSERVATION_ENCODER_WINDOW_DOMAIN");
  pushEncoderDomainDiff(
    "ExhaustState",
    "AI_OBSERVATION_ENCODER_EXHAUST_DOMAIN"
  );
  pushEncoderDomainDiff(
    "PendingLeaveKind",
    "AI_OBSERVATION_ENCODER_PENDING_LEAVE_DOMAIN"
  );
  pushEncoderDomainDiff(
    "PreGamePhase",
    "AI_OBSERVATION_ENCODER_PRE_GAME_PHASE_DOMAIN"
  );
  pushEncoderDomainDiff(
    "CardCategory",
    "AI_OBSERVATION_ENCODER_CATEGORY_DOMAIN"
  );
  pushEncoderDomainDiff(
    "PublicDisclosureAudience",
    "AI_OBSERVATION_ENCODER_DISCLOSURE_AUDIENCE_DOMAIN"
  );
  pushSetDiff(
    violations,
    encoderRel,
    "AI_OBSERVATION_ENCODER_GAME_RESULT_KIND_DOMAIN vs GameResult.kind",
    collectStringArrayConstFromText(
      encoderRel,
      encoder,
      "AI_OBSERVATION_ENCODER_GAME_RESULT_KIND_DOMAIN"
    ),
    collectInterfacePropertyStringUnionFromText(
      modelRel,
      model,
      "GameResult",
      "kind"
    ),
    AI_OBSERVATION_CONTRACT_SSOT_RULE
  );
  pushSetDiff(
    violations,
    encoderRel,
    "AI_OBSERVATION_ENCODER_PENDING_KIND_DOMAIN vs summary pending roles",
    collectStringArrayConstFromText(
      encoderRel,
      encoder,
      "AI_OBSERVATION_ENCODER_PENDING_KIND_DOMAIN"
    ),
    sortedUnique(
      [...pendingRoleEntries.entries()]
        .filter(([, role]) => role === "summary")
        .map(([field]) => field)
    ),
    AI_OBSERVATION_CONTRACT_SSOT_RULE
  );

  return violations;
}

const FIELD_LEAVE_PENDING_SSOT_RULE = {
  name: "field-leave-pending-ssot",
  description:
    "フィールド離脱ゾーン移動の正門。field 起点の離脱 action (bounce / send_to_deck / remove_from_game / move_card / move_self) は直接 zone を書き換えず queuePendingLeave に集約する。",
  canonical:
    "queuePendingLeave() + flushPendingLeaves() (packages/rules-core/src/state-based-actions.ts)",
};

async function checkFieldLeavePendingSsot(cache) {
  const violations = [];
  const requirePattern = (rel, text, pattern, detail) => {
    if (!pattern.test(text)) {
      violations.push({
        rule: FIELD_LEAVE_PENDING_SSOT_RULE,
        rel: `${rel}: ${detail}`,
      });
    }
  };

  const zoneOpsRel = "packages/rules-core/src/effect/structured-zone-ops.ts";
  const replacementRel =
    "packages/rules-core/src/effect/structured-card-replacement.ts";
  const moveCardRel =
    "packages/rules-core/src/effect/native-move-core-handlers.ts";
  const publicDisclosureRel = "packages/rules-core/src/public-disclosure.ts";
  const nativeActionRel =
    "packages/rules-core/src/effect/native-action-registry.ts";
  const frontHelperRel =
    "packages/rules-core/src/effect/native-effect-front-helpers.ts";
  const stateRuleDocRel =
    "manual/ai-reference/10_rules/04_state-based-rules.md";

  const zoneOps = await readCachedProjectFile(cache, zoneOpsRel);
  requirePattern(
    zoneOpsRel,
    zoneOps,
    /const\s+fieldTargets\s*=\s*toBounce\.filter\(\(c\)\s*=>\s*c\.zone\s*===\s*"field"\)/,
    "executeBounce must split field targets before direct movement"
  );
  requirePattern(
    zoneOpsRel,
    zoneOps,
    /const\s+pendingFieldTargets\s*=\s*fieldTargets\.filter\([\s\S]*?pendingFieldTargetChildIds/,
    "executeBounce must queue host leaves while leaving attached children to host resolution"
  );
  requirePattern(
    zoneOpsRel,
    zoneOps,
    /const\s+directTargets\s*=\s*toBounce\.filter\([\s\S]*?c\.zone\s*!==\s*"field"/,
    "executeBounce direct targets must be non-field only"
  );
  requirePattern(
    zoneOpsRel,
    zoneOps,
    /queuePendingLeave\(\{[\s\S]*?kind:\s*"bounce"[\s\S]*?leaveDestination:\s*\{/,
    "executeBounce must queue field bounce with an explicit leaveDestination"
  );
  requirePattern(
    zoneOpsRel,
    zoneOps,
    /const\s+fieldTargetChildIdsToFollowHost\s*=\s*new\s+Set<string>\(\)/,
    "executeSendToDeck must suppress attached-child double pending for selected hosts"
  );
  requirePattern(
    zoneOpsRel,
    zoneOps,
    /const\s+fieldTargets\s*=\s*toSend\.filter\([\s\S]*?card\.zone\s*===\s*"field"[\s\S]*?!fieldTargetChildIdsToFollowHost\.has/,
    "executeSendToDeck must split field targets and exclude selected host children"
  );
  requirePattern(
    zoneOpsRel,
    zoneOps,
    /queuePendingLeave\(\{[\s\S]*?kind:\s*"bounce"[\s\S]*?leaveDestination:\s*\{\s*zone:\s*"deck"/,
    "executeSendToDeck must queue field targets with deck leaveDestination"
  );

  const replacement = await readCachedProjectFile(cache, replacementRel);
  requirePattern(
    replacementRel,
    replacement,
    /const\s+fieldTargetChildIdsToFollowHost\s*=\s*new\s+Set<string>\(\)/,
    "executeRemoveFromGame must suppress attached-child double pending for selected hosts"
  );
  requirePattern(
    replacementRel,
    replacement,
    /const\s+fieldTargets\s*=\s*toRemove\.filter\([\s\S]*?c\.zone\s*===\s*"field"[\s\S]*?!fieldTargetChildIdsToFollowHost\.has/,
    "executeRemoveFromGame must split field targets and exclude selected host children"
  );
  requirePattern(
    replacementRel,
    replacement,
    /const\s+nonFieldTargets\s*=\s*toRemove\.filter\(\(c\)\s*=>\s*c\.zone\s*!==\s*"field"\)/,
    "executeRemoveFromGame direct targets must be non-field only"
  );
  requirePattern(
    replacementRel,
    replacement,
    /queuePendingLeave\(\{[\s\S]*?kind:\s*"remove_from_game"/,
    "executeRemoveFromGame field targets must queue remove_from_game pendingLeave"
  );

  const moveCard = await readCachedProjectFile(cache, moveCardRel);
  requirePattern(
    moveCardRel,
    moveCard,
    /const\s+fieldLeaveMoveCards\s*=[\s\S]*?isSingleFromZone\("field"\)[\s\S]*?toZone\s*!==\s*"field"[\s\S]*?toSourceUnderCardRole\s*===\s*undefined/,
    "executeMoveCard must detect field-origin moves that leave the field"
  );
  requirePattern(
    moveCardRel,
    moveCard,
    /const\s+pendingFieldLeaveMoveCards\s*=\s*fieldLeaveMoveCards\.filter\([\s\S]*?fieldLeaveMoveChildIds/,
    "executeMoveCard must queue selected hosts and leave attached children to host resolution"
  );
  requirePattern(
    moveCardRel,
    moveCard,
    /queuePendingLeave\(\{[\s\S]*?kind:\s*pendingLeaveKindForFieldMove\(actualToZone\)[\s\S]*?leaveDestination:\s*\{[\s\S]*?zone:\s*actualToZone/,
    "executeMoveCard field-origin moves must queue pendingLeave with the actual destination"
  );

  const frontHelper = await readCachedProjectFile(cache, frontHelperRel);
  requirePattern(
    frontHelperRel,
    frontHelper,
    /case\s+"move_self":\s*case\s+"move_card":\s*\{[\s\S]*?didPendingLeaveStateChange\(pre,\s*post\)/,
    "move_self/move_card success detection must treat pendingLeave creation as state change"
  );

  const publicDisclosure = await readCachedProjectFile(
    cache,
    publicDisclosureRel
  );
  requirePattern(
    publicDisclosureRel,
    publicDisclosure,
    /function\s+collectPendingLeaveZoneMoves\(/,
    "public disclosure must observe newly queued pendingLeave moves"
  );
  requirePattern(
    publicDisclosureRel,
    publicDisclosure,
    /const\s+pendingMoves\s*=\s*collectPendingLeaveZoneMoves\(args\.before,\s*args\.after\)/,
    "effect-step public disclosure must collect planned pendingLeave moves"
  );
  requirePattern(
    publicDisclosureRel,
    publicDisclosure,
    /for\s*\(const\s+\{\s*previous,\s*current,\s*to\s*\}\s+of\s+pendingMoves\)[\s\S]*?kind:\s*"card_move"[\s\S]*?from:\s*previous\.zone[\s\S]*?to,/,
    "effect-step public disclosure must attach field pendingLeave destinations to target results"
  );

  const nativeAction = await readCachedProjectFile(cache, nativeActionRel);
  const moveSelfHandler =
    nativeAction.match(
      /move_self:\s*\(ctx\)\s*=>\s*\{[\s\S]*?\n {2}\},/
    )?.[0] ?? "";
  requirePattern(
    nativeActionRel,
    moveSelfHandler,
    /if\s*\(action\.destination\s*!==\s*"field"\s*&&\s*sourceCard\.zone\s*===\s*"field"\)\s*\{[\s\S]*?queuePendingLeave\(\{[\s\S]*?leaveDestination:\s*\{\s*zone:\s*action\.destination\s*\}/,
    "move_self field departures must queue pendingLeave with the actual destination"
  );
  requirePattern(
    nativeActionRel,
    moveSelfHandler,
    /return\s+queuePendingLeave\(\{[\s\S]*?\}\);\s*\}\s*const\s+sourceDefinition[\s\S]*?moveCardZone\(/,
    "move_self field departures must return pending state before non-field direct moves, without an inline flush"
  );

  const stateRuleDoc = await readCachedProjectFile(cache, stateRuleDocRel);
  requirePattern(
    stateRuleDocRel,
    stateRuleDoc,
    /### `pendingLeave` を立てる \/ 立てない境界/,
    "state-based rules doc must define when zone movement should not create pendingLeave"
  );
  requirePattern(
    stateRuleDocRel,
    stateRuleDoc,
    /`move_card`:[\s\S]*?`from\.zone === "field"`[\s\S]*?`leaveDestination:\{ zone:"trash" \}`/,
    "state-based rules doc must pin move_card field-to-trash as non-destroy pending leave"
  );

  return violations;
}

const BURST_ACTIVATION_QUEUE_SSOT_RULE = {
  name: "burst-activation-effect-queue-ssot",
  description:
    "バースト発動可否 UI の並行実装。pendingBurstChecks は EffectQueue item↔action claim を正源にし、専用 pending overlay / 独自ラベル写像へ戻さない。",
  canonical:
    "EffectQueueOverlay buildEffectQueue()/queueItemClaimsAction() + ACTION_UI_ROUTES action-bar + ActionBar choice-group dedupe",
};

const BRAVE_ATTACHMENT_UI_SSOT_RULE = {
  name: "brave-attachment-ui-ssot",
  description:
    "合体ブレイヴ表示/クリック/重なりブラウズが host.attachedChildrenIds を関係の正源として直読している。UI は子側 attachedToInstanceId + zone=field から派生する getAttachedFieldBravesForHost() に集約する。",
  canonical:
    "getAttachedFieldBravesForHost() (apps/playground-web/src/utils/field-under-card-visual.ts)",
};

const BRAVE_COMBINE_CHOICE_UI_SSOT_RULE = {
  name: "brave-combine-choice-ui-ssot",
  description:
    "ブレイヴ召喚/転醒後ブレイヴの合体/スピリット状態選択 UI 契約。pendingBraveCombineChoice と pendingStoneFlipCombine は同じ選択モーダルに合流し、合体先選択は既存 HUD、盤面確認は modal-hidden 経路を正源にする。",
  canonical:
    "BattleScreen braveCombineChoicePending + resolve_brave_combine_choice target HUD + modal-hidden peek toggle",
};

async function checkBraveAttachmentUiSsot(cache) {
  const violations = [];
  const push = (rel, detail) =>
    violations.push({
      rule: BRAVE_ATTACHMENT_UI_SSOT_RULE,
      rel: `${rel}: ${detail}`,
    });

  const visualRel = "apps/playground-web/src/utils/field-under-card-visual.ts";
  const fieldAreaRel = "apps/playground-web/src/components/FieldArea.tsx";
  const actionGroupsRel =
    "apps/playground-web/src/utils/card-action-modal-groups.ts";

  const visual = await readCachedProjectFile(cache, visualRel);
  const requiredVisualPatterns = [
    [
      /export\s+function\s+getAttachedFieldBravesForHost\s*\(/,
      "must expose the attached-brave UI projection helper",
    ],
    [
      /child\.zone\s*===\s*["']field["']/,
      "attached-brave UI helper must reject non-field child cards",
    ],
    [
      /child\.attachedToInstanceId\s*===\s*host\.instanceId/,
      "attached-brave UI helper must derive membership from child.attachedToInstanceId",
    ],
  ];
  for (const [re, detail] of requiredVisualPatterns) {
    if (!re.test(visual)) push(visualRel, detail);
  }

  const directHostCacheRead =
    /\.attachedChildrenIds\s*(?:\??\.)?\s*(?:map|filter|find|some|every|forEach|includes|length|\[)/;
  for (const rel of [fieldAreaRel, actionGroupsRel]) {
    const text = await readCachedProjectFile(cache, rel);
    if (!/\bgetAttachedFieldBravesForHost\b/.test(text)) {
      push(rel, "must use getAttachedFieldBravesForHost()");
    }
    if (directHostCacheRead.test(text)) {
      push(
        rel,
        "must not read attachedChildrenIds directly; it is only an ordering/cache field"
      );
    }
  }

  return violations;
}

async function checkBraveCombineChoiceUiSsot(cache) {
  const violations = [];
  const push = (rel, detail) =>
    violations.push({
      rule: BRAVE_COMBINE_CHOICE_UI_SSOT_RULE,
      rel: `${rel}: ${detail}`,
    });
  const requirePattern = (rel, text, pattern, detail) => {
    if (!pattern.test(text)) push(rel, detail);
  };

  const battleScreenRel = "apps/playground-web/src/components/BattleScreen.tsx";
  const battleScreen = await readCachedProjectFile(cache, battleScreenRel);
  const modalStart = battleScreen.indexOf(
    "ブレイヴ召喚/転醒後ブレイヴ: スタック窓クローズ後"
  );
  // このモーダル自身のIIFE終端で区切る。隣の選択UIの有無には依存しない。
  const modalEnd =
    modalStart >= 0 ? battleScreen.indexOf("\n        })()}", modalStart) : -1;
  const modalBlock =
    modalStart >= 0 && modalEnd > modalStart
      ? battleScreen.slice(modalStart, modalEnd)
      : "";
  if (!modalBlock) {
    push(
      battleScreenRel,
      "must keep the shared brave combine/spirit-state modal block"
    );
  }

  requirePattern(
    battleScreenRel,
    battleScreen,
    /const\s+braveCombineChoicePending\s*=\s*[\s\S]*?displayState\.pendingBraveCombineChoice\s*\?\?\s*[\s\S]*?displayState\.pendingStoneFlipCombine\s*;/,
    "pendingStoneFlipCombine must route through the same pending selector as pendingBraveCombineChoice"
  );
  requirePattern(
    battleScreenRel,
    battleScreen,
    /const\s+isBraveCombineChoiceHostSelection\s*=[\s\S]*?pendingAction\?\.kind\s*===\s*"resolve_brave_combine_choice"[\s\S]*?braveCombineChoicePending\?\.pendingId\s*===\s*pendingAction\.pendingId/,
    "host-selection HUD phase must be distinguished from the modal phase"
  );
  requirePattern(
    battleScreenRel,
    battleScreen,
    /\(\s*braveCombineChoicePending\s*!==\s*null\s*&&\s*!\s*isBraveCombineChoiceHostSelection\s*\)/,
    "the peek-toggle full-screen modal gate must exclude the HUD host-selection phase"
  );
  requirePattern(
    battleScreenRel,
    battleScreen,
    /displayState\.pendingStoneFlipCombine\s*!==\s*null/,
    "pendingStoneFlipCombine must count as a UI pending state"
  );
  requirePattern(
    battleScreenRel,
    battleScreen,
    /stone-flip-combine:\$\{displayState\.pendingStoneFlipCombine\.pendingId\}/,
    "modalKey must reset hidden state when the stone-flip combine pending changes"
  );
  requirePattern(
    battleScreenRel,
    battleScreen,
    /pendingAction\.kind\s*===\s*"resolve_brave_combine_choice"[\s\S]*?<TargetToast\s+title="合体先選択"\s+subText="合体先をタップ"/,
    "resolve_brave_combine_choice host selection must use the existing centered target HUD"
  );

  requirePattern(
    battleScreenRel,
    modalBlock,
    /braveCombineChoicePending\s*&&[\s\S]*?!isBraveCombineChoiceHostSelection[\s\S]*?braveCombineChoicePending\.actingPlayerId\s*===\s*viewingPlayer/,
    "the modal must be driven by the shared braveCombineChoicePending value"
  );
  requirePattern(
    battleScreenRel,
    modalBlock,
    /a\.kind\s*===\s*"resolve_brave_combine_choice"[\s\S]*?a\.pendingId\s*===\s*pending\.pendingId/,
    "choice actions must be scoped by pendingId"
  );
  requirePattern(
    battleScreenRel,
    modalBlock,
    /"corePlacementChoice"\s+in\s+pending[\s\S]*?pending\.corePlacementChoice\s*!=\s*null/,
    "stone-flip spirit-state choice must preserve the core-placement branch"
  );
  requirePattern(
    battleScreenRel,
    modalBlock,
    /const\s+enterHostSelection\s*=[\s\S]*?candidateTargetInstanceIds:\s*hostTargetIds[\s\S]*?targetMode:\s*"manual"/,
    "the modal's combine button must enter the existing manual target HUD for multiple hosts"
  );
  requirePattern(
    battleScreenRel,
    modalBlock,
    /className=\{`card-action-overlay\$\{modalsHidden\s*\?\s*" modal-hidden"\s*:\s*""\}`\}/,
    "the combine/spirit-state modal must hide via the existing modal-hidden peek path"
  );
  requirePattern(
    battleScreenRel,
    modalBlock,
    /aria-hidden=\{modalsHidden\s*\?\s*"true"\s*:\s*undefined\}/,
    "the hidden modal must also set aria-hidden while peeking at the board"
  );
  if (/合体:/.test(modalBlock)) {
    push(
      battleScreenRel,
      "must not render direct per-host combine buttons; use the target HUD after the 合体 branch"
    );
  }

  return violations;
}

const CODEX_STOP_GUARD_CHECK_GATE_RULE = {
  name: "codex-stop-guard-check-gate-ssot",
  description:
    "Codex Stop hook のコード編集後 check gate 契約。コード編集後の解除条件は check/test/lint/tsc/vitest 等に限定し、git status/diff/commit や apply_patch/MultiEdit の取りこぼしへ戻さない。",
  canonical:
    ".codex/hooks/stop-guard.js CHECK_COMMAND_PATTERNS + .codex/hooks.json edit matcher + .codex/hooks/test-stop-guard.js regression cases",
};

async function checkBurstActivationQueueSsot(cache) {
  const violations = [];
  const push = (rel, detail) =>
    violations.push({
      rule: BURST_ACTIVATION_QUEUE_SSOT_RULE,
      rel: `${rel}: ${detail}`,
    });

  const actionUiRel = "apps/playground-web/src/components/action-ui.ts";
  const actionBarRel = "apps/playground-web/src/components/ActionBar.tsx";
  const battleScreenRel = "apps/playground-web/src/components/BattleScreen.tsx";
  const effectQueueRel =
    "apps/playground-web/src/components/EffectQueueOverlay.tsx";

  const actionUi = await readCachedProjectFile(cache, actionUiRel);
  if (!/\bresolve_pending_burst_check:\s*"action-bar"/.test(actionUi)) {
    push(actionUiRel, "resolve_pending_burst_check must route to action-bar");
  }
  if (!/\bdecline_pending_burst_check:\s*"action-bar"/.test(actionUi)) {
    push(actionUiRel, "decline_pending_burst_check must route to action-bar");
  }

  const actionBar = await readCachedProjectFile(cache, actionBarRel);
  if (!/action\.kind\s*===\s*"resolve_pending_burst_check"/.test(actionBar)) {
    push(
      actionBarRel,
      "ActionBar choice-group dedupe must include resolve_pending_burst_check"
    );
  }
  if (
    !/\bcheckId\b/.test(actionBar) ||
    !/\bregistrationIndex\b/.test(actionBar)
  ) {
    push(
      actionBarRel,
      "burst choice-group key must include checkId and registrationIndex"
    );
  }

  const effectQueue = await readCachedProjectFile(cache, effectQueueRel);
  const requiredEffectQueuePatterns = [
    [/\|\s*"burst_check"/, "EffectQueueItemKind must include burst_check"],
    [
      /type:\s*"burstCheck";\s*data:\s*PendingBurstCheck/,
      "EffectQueueItem.sourceRef must include burstCheck/PendingBurstCheck",
    ],
    [
      /pendingBurstCheckToQueueItem\s*\(/,
      "buildEffectQueue must create a burst item from pendingBurstChecks",
    ],
    [
      /for\s*\(\s*const\s+pending\s+of\s+state\.pendingBurstChecks\s*\)/,
      "buildEffectQueue must iterate state.pendingBurstChecks",
    ],
    [
      /case\s+"burstCheck"\s*:/,
      "queueItemClaimsAction must claim burstCheck actions",
    ],
    [
      /action\.kind\s*!==\s*"resolve_pending_burst_check"/,
      "burstCheck claim must explicitly handle resolve_pending_burst_check",
    ],
    [
      /action\.kind\s*!==\s*"decline_pending_burst_check"/,
      "burstCheck claim must explicitly handle decline_pending_burst_check",
    ],
  ];
  for (const [re, detail] of requiredEffectQueuePatterns) {
    if (!re.test(effectQueue)) push(effectQueueRel, detail);
  }

  const battleScreen = await readCachedProjectFile(cache, battleScreenRel);
  const forbiddenBattleScreenPatterns = [
    [
      /\bhasPendingBurstCheckDecision\b/,
      "do not reintroduce a dedicated burst pending UI gate",
    ],
    [
      /key:\s*"burst-check"/,
      "do not reintroduce the dedicated burst simplePendingDecision overlay",
    ],
    [
      /const\s+burstButtons\s*=\s*buttonsFor\s*\(/,
      "simplePendingDecision must not render burst resolve/decline buttons",
    ],
    [
      /buttonsFor\s*\(\s*\[\s*["']resolve_pending_burst_check["']/,
      "simplePendingDecision must not render burst resolve/decline buttons",
    ],
    [
      /case\s+"resolve_pending_burst_check"\s*:/,
      "BattleScreen must not carry a burst-specific label switch; use getActionLabel via ActionBar",
    ],
  ];
  for (const [re, detail] of forbiddenBattleScreenPatterns) {
    if (re.test(battleScreen)) push(battleScreenRel, detail);
  }

  return violations;
}

async function checkCodexStopGuardCheckGateSsot(cache) {
  const violations = [];
  const push = (rel, detail) =>
    violations.push({
      rule: CODEX_STOP_GUARD_CHECK_GATE_RULE,
      rel: `${rel}: ${detail}`,
    });

  const stopGuardRel = ".codex/hooks/stop-guard.js";
  const hooksJsonRel = ".codex/hooks.json";
  const postEditRel = ".codex/hooks/post-edit-typecheck.js";
  const testRel = ".codex/hooks/test-stop-guard.js";

  const stopGuard = await readCachedProjectFile(cache, stopGuardRel);
  const requiredStopGuardPatterns = [
    [
      /const\s+CHECK_COMMAND_PATTERNS\s*=/,
      "must define CHECK_COMMAND_PATTERNS as the check allowlist",
    ],
    [/codex:finish-check/, "must accept codex:finish-check as a check"],
    [/pnpm(?:\\\.cmd)?/, "must recognize pnpm-based check commands"],
    [
      /tailToolUsesSinceLastUser\s*\(/,
      "must scan the whole current turn, not only a short tool lookback",
    ],
    [
      /collectToolUseBlocks\s*\(/,
      "must recurse into nested multi_tool_use tool calls",
    ],
    [/tool_uses/, "must inspect nested multi_tool_use input.tool_uses"],
    [/apply_patch/, "must recognize apply_patch edits"],
    [/multiedit/i, "must recognize MultiEdit edits"],
    [
      /codeEditedFilesForToolUse\s*\(/,
      "must detect code edits by tool input/file/patch content",
    ],
  ];
  for (const [re, detail] of requiredStopGuardPatterns) {
    if (!re.test(stopGuard)) push(stopGuardRel, detail);
  }
  const forbiddenStopGuardPatterns = [
    [/const\s+VERIFY_PATTERNS\s*=/, "do not revert to VERIFY_PATTERNS naming"],
    [
      /\/git\\s\+\([^)]*(?:add|commit|status|diff)[^)]*\)\//,
      "git add/status/diff/commit must not be a check command pattern",
    ],
  ];
  for (const [re, detail] of forbiddenStopGuardPatterns) {
    if (re.test(stopGuard)) push(stopGuardRel, detail);
  }

  const postEdit = await readCachedProjectFile(cache, postEditRel);
  const requiredPostEditPatterns = [
    [
      /editedFilePaths\(json\.tool_input\)/,
      "post-edit typecheck must inspect all edited paths, not only file_path",
    ],
    [
      /pathsFromPatchText\s*\(/,
      "post-edit typecheck must extract paths from apply_patch payloads",
    ],
  ];
  for (const [re, detail] of requiredPostEditPatterns) {
    if (!re.test(postEdit)) push(postEditRel, detail);
  }

  const hooksJson = await readCachedProjectFile(cache, hooksJsonRel);
  let hooks;
  try {
    hooks = JSON.parse(hooksJson);
  } catch {
    push(hooksJsonRel, "must be valid JSON");
  }
  if (hooks) {
    const requireMatcherTokens = (eventName, commandNeedle, tokens) => {
      const entries = hooks.hooks?.[eventName];
      const entry = Array.isArray(entries)
        ? entries.find((candidate) =>
            (candidate.hooks ?? []).some((hook) =>
              String(hook.command ?? "").includes(commandNeedle)
            )
          )
        : undefined;
      const matcher = String(entry?.matcher ?? "");
      for (const token of tokens) {
        if (!matcher.includes(token)) {
          push(
            hooksJsonRel,
            `${eventName} matcher for ${commandNeedle} must include ${token}`
          );
        }
      }
    };
    requireMatcherTokens("PreToolUse", "pre-tool-guard.js", [
      "MultiEdit",
      "apply_patch",
    ]);
    requireMatcherTokens("PostToolUse", "post-edit-typecheck.js", [
      "MultiEdit",
      "apply_patch",
    ]);
  }

  const test = await readCachedProjectFile(cache, testRel);
  const requiredTestPatterns = [
    [/git status only/, "must test that git status alone still blocks"],
    [/apply_patch code edit/, "must test apply_patch edit detection"],
    [/corepack pnpm check/, "must test check command release"],
    [
      /edit older than 10 tools/,
      "must test current-turn scanning beyond the old 10-tool lookback",
    ],
  ];
  for (const [re, detail] of requiredTestPatterns) {
    if (!re.test(test)) push(testRel, detail);
  }

  return violations;
}

async function collectSourceFiles() {
  const files = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.name !== ".claude") continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(abs);
      } else if (SOURCE_RE.test(e.name)) {
        files.push(abs);
      }
    }
  }
  for (const r of SCAN_ROOTS) await walk(join(ROOT, r));
  return files;
}

function toPosix(absPath) {
  return relative(ROOT, absPath).replaceAll("\\", "/");
}

async function main() {
  const listMode = process.argv.includes("--list");
  const files = await collectSourceFiles();
  const cache = new Map();
  const violations = [];
  const semanticViolations = [];

  for (const rule of RULES) {
    const matched = [];
    for (const abs of files) {
      const rel = toPosix(abs);
      const winNorm = rel.replaceAll("/", "\\");
      if (rule.scope && !rule.scope.test(winNorm) && !rule.scope.test(rel))
        continue;
      let text = cache.get(abs);
      if (text === undefined) {
        text = await readFile(abs, "utf8");
        cache.set(abs, text);
      }
      if (!rule.detector(text)) continue;
      matched.push(rel);
      if (listMode) continue;
      const allowed =
        COMMON_ALLOW.some((re) => re.test(winNorm)) ||
        rule.allow.some((re) => re.test(winNorm)) ||
        rule.baseline.includes(rel);
      if (!allowed) violations.push({ rule, rel });
    }
    if (listMode) {
      console.log(`# rule: ${rule.name} (${matched.length} files)`);
      for (const m of matched) console.log(`  ${m}`);
    }
  }

  if (listMode) return 0;

  const derivedSources = new Map();
  for (const abs of files) {
    const rel = toPosix(abs);
    if (rel.startsWith("packages/rules-core/src/"))
      derivedSources.set(rel, await readCachedProjectFile(cache, rel));
  }
  for (const issue of findDerivedStateSsotIssues(derivedSources)) {
    violations.push({
      rule: {
        name: "derived-state-ownership",
        description: issue.detail,
        canonical:
          "continuous-effect-rebuild.ts / battle-shared.ts / game-state-invariants-derived.ts",
      },
      rel: `${issue.file}: ${issue.detail}`,
    });
  }

  violations.push(...(await checkBurstActivationQueueSsot(cache)));
  violations.push(...(await checkBraveAttachmentUiSsot(cache)));
  violations.push(...(await checkBraveCombineChoiceUiSsot(cache)));
  violations.push(...(await checkCodexStopGuardCheckGateSsot(cache)));
  violations.push(...(await checkFieldLeavePendingSsot(cache)));
  violations.push(...(await checkPlayerDecisionContractSsot(cache)));
  violations.push(...(await checkAiObservationContractSsot(cache)));
  semanticViolations.push(...(await checkCardDataCountOptionalStepSsot()));

  // P3-116: warn-only チェック。exit code には影響しない。
  const warnings = [
    ...(await checkWindowClassificationCitations(files, cache)),
    ...(await checkFreestandingNotADeclarationKinds(files, cache)),
    ...(await checkOpensOwnWindowHandlersReferenceWindow(files, cache)),
  ];
  if (warnings.length > 0) {
    console.warn(`check:ssot WARN: ${warnings.length} warning(s).\n`);
    for (const w of warnings) console.warn(`  ${w}`);
    console.warn("");
  }

  if (violations.length === 0 && semanticViolations.length === 0) {
    console.log(
      `check:ssot passed: 0 violation(s) across ${RULES.length} rule(s) + semantic gates.`
    );
    return 0;
  }
  console.error(
    `check:ssot FAILED: ${violations.length + semanticViolations.length} violation(s).\n`
  );
  for (const v of violations) {
    console.error(`[${v.rule.name}] ${v.rel}`);
    console.error(`  → ${v.rule.description}`);
    console.error(`  → 正源 ${v.rule.canonical} を共有 / 拡張すること。`);
    console.error(
      `  → 正当な別用途 (制御フロー等) なら scripts/check-ssot.mjs の baseline と pre-tool-guard.js の allowlist に登録。\n`
    );
  }
  for (const v of semanticViolations) {
    console.error(`[card-data-count-optional-step] ${v.cardNo}`);
    console.error(
      '  → 「自分のカウント0のとき、自分のカウント+1できる。」は複数 step effect 内では count_increase step に executionMode:"optional" と prompt.sourceText を持たせる。'
    );
    console.error(`  → ${v.detail}\n`);
  }
  return 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("check:ssot crashed:", err);
    process.exit(1);
  });
