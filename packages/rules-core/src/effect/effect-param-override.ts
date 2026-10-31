// ============================================================
// Effect Parameter Override — 他効果のターゲットフィルタ条件を
// 継続的に書き換えるメタ修飾 (P3-14 A-7)。
//
// カードテキスト例:
//   - 「このスピリットの『BP破壊効果』の上限を+5000し、
//      その対象を相手のアルティメットにもできる」(BSTH01-X09)
//   - 「『コスト破壊効果』の上限を+2する」(BSTH07-転醒R01(B))
//   - 「自分のトークンマジックの『破壊効果』/『疲労効果』のコスト上限を+3する」
//      (BSLH01-M01, scope: "player_cards" + effectClass: "cost_destroy"/"cost_exhaust")
//
// 既存の継続修飾 (`bp_modify` 等) はカード自体の属性を書き換えるが、
// `effect_param_override` は **他効果の DSL パラメータ自体** を書き換える。
// ============================================================

import type { CardFilter } from "../dsl-types";
import type {
  CardCategory,
  CardDefinition,
  ContinuousEffect,
  GameState,
} from "../model";
import { matchesCardFilter } from "../card/card-filter";

/**
 * effect_param_override CE が修飾対象とする効果分類。
 *
 * 命名規約: `<param_kind>_<action_kind>`
 *   - bp_*   → target.filter.maxBp が定義された該当アクション
 *   - cost_* → target.filter.maxCost が定義された該当アクション
 */
export type EffectParamOverrideClass =
  | "bp_destroy"
  | "cost_destroy"
  | "bp_vanish"
  | "cost_vanish"
  | "bp_bounce"
  | "cost_bounce"
  | "cost_prevent_battle"
  | "cost_exhaust";

/**
 * effect_param_override CE の修飾範囲。
 *
 * - "self": CE のソース自身が発揮する効果のみが修飾対象。
 * - "combined_unit": 合体ユニット (ホスト + 全ブレイヴ) の任意メンバーが
 *   発揮する効果が修飾対象。合体ブレイヴからホスト効果を修飾するケース。
 * - "player_cards": CE の `targetFilter` (player + CardFilter, cost_modify の
 *   player+cardFilter と同型の既存汎用フィールド) に一致するカード群が発揮する
 *   効果すべてが修飾対象。「自分のトークンマジックの…」のような単一カード/合体
 *   ユニットを超えたカード群スコープ (BSLH01-M01)。
 */
export type EffectParamOverrideScope =
  | "self"
  | "combined_unit"
  | "player_cards";

/**
 * effect_param_override CE の metadata 構造。
 * `ContinuousEffect.metadata` (Record<string, unknown>) に格納する。
 */
export interface EffectParamOverrideMetadata {
  effectClass: EffectParamOverrideClass;
  scope: EffectParamOverrideScope;
  /** maxBp / maxCost の閾値に加算する値。 */
  addLimitAmount?: number;
  /** ターゲット category に追加するカテゴリ集合。 */
  addTargetCategories?: CardCategory[];
}

const VALID_EFFECT_CLASSES = new Set<EffectParamOverrideClass>([
  "bp_destroy",
  "cost_destroy",
  "bp_vanish",
  "cost_vanish",
  "bp_bounce",
  "cost_bounce",
  "cost_prevent_battle",
  "cost_exhaust",
]);

const VALID_SCOPES = new Set<EffectParamOverrideScope>([
  "self",
  "combined_unit",
  "player_cards",
]);

/**
 * CE の metadata から EffectParamOverrideMetadata を取り出す型ガード付きヘルパー。
 * 妥当でない CE は null を返す。
 */
export function getEffectParamOverrideMetadata(
  ce: ContinuousEffect
): EffectParamOverrideMetadata | null {
  if (ce.modifierTag !== "effect_param_override") return null;
  const raw = ce.metadata as Record<string, unknown> | undefined;
  if (!raw) return null;

  const effectClass = raw.effectClass;
  const scope = raw.scope;
  if (
    typeof effectClass !== "string" ||
    !VALID_EFFECT_CLASSES.has(effectClass as EffectParamOverrideClass)
  ) {
    return null;
  }
  if (
    typeof scope !== "string" ||
    !VALID_SCOPES.has(scope as EffectParamOverrideScope)
  ) {
    return null;
  }

  const meta: EffectParamOverrideMetadata = {
    effectClass: effectClass as EffectParamOverrideClass,
    scope: scope as EffectParamOverrideScope,
  };
  if (typeof raw.addLimitAmount === "number") {
    meta.addLimitAmount = raw.addLimitAmount;
  }
  if (Array.isArray(raw.addTargetCategories)) {
    meta.addTargetCategories = raw.addTargetCategories.filter(
      (c): c is CardCategory => typeof c === "string"
    );
  }
  return meta;
}

/**
 * 2 つのカードが同一合体ユニットに属するか判定する。
 *
 * - 同一インスタンスは true
 * - ブレイヴ→ホスト: attachedToInstanceId が他方と一致
 * - ホスト→ブレイヴ: attachedChildrenIds に他方が含まれる
 * - 兄弟ブレイヴ: attachedToInstanceId が同一ホスト
 */
function inSameCombinedUnit(
  state: GameState,
  idA: string,
  idB: string
): boolean {
  if (idA === idB) return true;
  const a = state.cardInstances.find((c) => c.instanceId === idA);
  const b = state.cardInstances.find((c) => c.instanceId === idB);
  if (!a || !b) return false;
  const aHost = a.attachedToInstanceId ?? a.instanceId;
  const bHost = b.attachedToInstanceId ?? b.instanceId;
  return aHost === bHost;
}

/**
 * scope: "player_cards" 判定。CE の `targetFilter` (player + CardFilter、
 * cost_modify の player+cardFilter と同型の既存汎用フィールド、model.ts:1100) を
 * executingSourceId のカードに対して照合する。`targetFilter` 未設定の CE は
 * 一致しない (安全側)。
 * `duration_override` CE (duration-override.ts) も同じ targetFilter 形状を
 * 使うため、この判定関数を export して共有する (SSOT)。
 */
export function matchesPlayerCardsScope(
  state: GameState,
  ce: ContinuousEffect,
  executingSourceId: string,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  const filter = ce.targetFilter;
  if (!filter) return false;
  const card = state.cardInstances.find(
    (c) => c.instanceId === executingSourceId
  );
  if (!card) return false;
  if (filter.player !== "either") {
    const wantsOpponent = filter.player === "opponent";
    const ceOwnerIsController = ce.actingPlayerId === card.controllerPlayerId;
    if (wantsOpponent === ceOwnerIsController) return false;
  }
  if (!getCardDefinitionById) return false;
  const def = getCardDefinitionById(card.definitionId);
  if (!def) return false;
  return matchesCardFilter(card, def, filter, { state });
}

/**
 * scope に応じて CE が executingSourceId の効果を修飾するか判定する。
 */
function matchesEffectParamOverrideScope(
  state: GameState,
  ce: ContinuousEffect,
  executingSourceId: string,
  scope: EffectParamOverrideScope,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): boolean {
  switch (scope) {
    case "self":
      return ce.sourceInstanceId === executingSourceId;
    case "combined_unit":
      return inSameCombinedUnit(state, ce.sourceInstanceId, executingSourceId);
    case "player_cards":
      return matchesPlayerCardsScope(
        state,
        ce,
        executingSourceId,
        getCardDefinitionById
      );
  }
}

/**
 * filter に effect_param_override CE の delta を適用する。
 *
 * 1. effectClass が一致する CE のみ対象 (例: "bp_destroy" は destroy + maxBp 系のみ)。
 * 2. scope に応じて CE のソースと executingSourceId が修飾対象範囲にあるか判定。
 * 3. addLimitAmount は effectClass の bp/cost 種別に応じて filter.maxBp or maxCost に加算。
 *    - 元の filter に該当閾値が定義されていない場合は加算しない (テキスト分類が一致しない)。
 * 4. addTargetCategories は filter.category 配列に union 結合 (重複除去)。
 *    - 元の filter に category が無い場合は何もしない。
 *
 * 入力 filter は不変。常に新しいオブジェクトを返す (または delta なしならそのまま返す)。
 */
export function applyEffectParamOverridesToFilter(
  filter: CardFilter,
  effectClass: EffectParamOverrideClass,
  executingSourceId: string,
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): CardFilter {
  if (state.activeContinuousEffects.length === 0) return filter;

  const matchingMetas: EffectParamOverrideMetadata[] = [];
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "effect_param_override") continue;
    const meta = getEffectParamOverrideMetadata(ce);
    if (!meta) continue;
    if (meta.effectClass !== effectClass) continue;
    if (
      !matchesEffectParamOverrideScope(
        state,
        ce,
        executingSourceId,
        meta.scope,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    matchingMetas.push(meta);
  }

  if (matchingMetas.length === 0) return filter;

  let result: CardFilter = { ...filter };
  const limitKind: "maxBp" | "maxCost" = effectClass.startsWith("bp_")
    ? "maxBp"
    : "maxCost";

  for (const meta of matchingMetas) {
    if (meta.addLimitAmount !== undefined && result[limitKind] !== undefined) {
      result = {
        ...result,
        [limitKind]: result[limitKind]! + meta.addLimitAmount,
      };
    }
    if (
      meta.addTargetCategories !== undefined &&
      meta.addTargetCategories.length > 0 &&
      result.category !== undefined
    ) {
      const merged = new Set<CardCategory>([
        ...result.category,
        ...meta.addTargetCategories,
      ]);
      result = { ...result, category: Array.from(merged) };
    }
  }

  return result;
}

/**
 * アクション kind と filter の内容から、対応する effectClass を導出する。
 * effect_param_override CE 適用時に Action.kind から自動で分類するために使用する。
 *
 * 戻り値 null は「該当する effectClass が無い (= filter が分類に乗らない)」を意味する。
 */
export function deriveEffectParamOverrideClass(
  actionKind: "destroy" | "vanish" | "bounce" | "prevent_battle" | "exhaust",
  filter: CardFilter
): EffectParamOverrideClass | null {
  const hasBpLimit =
    filter.maxBp !== undefined || filter.maxBpSource !== undefined;
  const hasCostLimit =
    filter.maxCost !== undefined || filter.maxCostSource !== undefined;
  switch (actionKind) {
    case "destroy":
      if (hasBpLimit) return "bp_destroy";
      if (hasCostLimit) return "cost_destroy";
      return null;
    case "vanish":
      if (hasBpLimit) return "bp_vanish";
      if (hasCostLimit) return "cost_vanish";
      return null;
    case "bounce":
      if (hasBpLimit) return "bp_bounce";
      if (hasCostLimit) return "cost_bounce";
      return null;
    case "prevent_battle":
      if (hasCostLimit) return "cost_prevent_battle";
      return null;
    // 「疲労効果」は bp 版の前例が無いため cost のみ (prevent_battle と同型)。
    case "exhaust":
      if (hasCostLimit) return "cost_exhaust";
      return null;
  }
}
