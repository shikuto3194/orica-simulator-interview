import { recordBraveFieldEntry } from "./semantic-trigger-events";
import { requireCardZone } from "../model";
/**
 * 共有アクション実行エンジン。
 * 個別の execute* 関数（executeDestroy / executeSummon など）を export し、
 * effect-interpreter.ts:executeNativeAction から直接呼び出される形で利用される。
 */
import {
  putCardOnField,
  isEffectFieldEntryRestricted,
  isEffectSummonFieldEntry,
} from "../card/put-card-on-field";
import { queueEnterFieldCorePlacement } from "../zone/enter-field-placement-pending";
export { isEffectSummonFieldEntry } from "../card/put-card-on-field";
import type {
  CardCategory,
  CardColor,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  EffectCoreLocation,
  Duration,
  EffectPlayerRef,
  EffectTarget,
  GameState,
  Zone,
} from "../model";
import {
  matchesColorCount,
  isGrandstoneNexus,
  isGrandwalkerOrGuidedNexus,
  collectUnderCardScopeIds,
  resolveSelfReferenceCard,
} from "../model";

/**
 * トリガーイベントのコンテキスト情報。
 * evaluateConditionClause で trigger_colors / trigger_from_zone の評価に使用。
 */
import {
  evaluateCondition,
  getCardCurrentLevel,
} from "./structured-condition-eval";
import { evaluateApplicability } from "./effect-applicability";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
export { evaluateCondition, getCardCurrentLevel };

export interface TriggerContext {
  cause?: import("../model").TriggerEventCause;
  /** トリガーを引き起こした効果のソースカードの色 */
  sourceColors?: readonly CardColor[];
  /** トリガーを引き起こした効果のソースカードの系統（trigger_tribes 評価用） */
  sourceTribes?: readonly string[];
  /** トリガーを引き起こした効果のソースカード名（trigger_source_match 評価用） */
  sourceCardName?: string;
  /**
   * トリガーを引き起こした効果のソースカードの印字カテゴリ
   * （trigger_source_category 評価用）。「マジック以外の自分の効果で〜」(BSES01-C01)
   * のように発生源カードの種別で限定する用途。
   */
  sourceCategory?: CardCategory;
  /**
   * トリガーを引き起こした効果のソースカードのコントローラープレイヤー ID
   * （trigger_source_player 評価用）。「自分の/相手の○○効果で」型の限定条件に使う。
   */
  sourcePlayerId?: string;
  /**
   * トリガーを引き起こした効果のソースカードの instanceId
   * （`trigger_tribes.excludeSelfSource` 評価用）。「このカード以外の自分の系統：X
   * を持つ効果で〜」(BSTH07-転醒R01(A)) のように、発生源が「このカード自身」の
   * 効果を除外する用途。sourceCard（＝効果を持つカード自身）へはフォールバックしない。
   */
  sourceInstanceId?: string;
  /** 論理上、カードイベントが発生した元ゾーン。 */
  fromZone?: Zone;
  /**
   * カードが直前に物理的にいたゾーン。deck_reveal 後の移動など、論理起点とは別に
   * 実移動元を本文条件として判定する必要がある場合にのみ注入する。
   */
  physicalFromZone?: Zone;
  /**
   * トリガーの relatedInstanceId (対象化された/観測されたカード) の現在ゾーン
   * (`ConditionClause.kind:"trigger_related_instance_off_field"` 評価用)。
   * 「フィールド以外で発揮中の…を対象とした相手の効果」(BSLH01-T14) のように、
   * targeted disclosure が zone!=="field" の対象にも発火するようになった後、
   * カード側で通常の on-field 対象化と区別するために使う。
   */
  relatedInstanceZone?: Zone;
  /**
   * `deferredTo:"battle_end"` 効果の発火時、直前に終了したバトルがブロックされていたか
   * (ConditionClause.kind:"battle_was_blocked" 評価用)。fireBattleEndDeferrals からのみ渡される。
   */
  battleWasBlocked?: boolean;
  /**
   * `deferredTo:"battle_end"` 効果の発火時、直前に終了したバトルで対象プレイヤーのライフが
   * 実際に減ったか (ConditionClause.kind:"battle_life_reduced" 評価用)。
   * fireBattleEndDeferrals からのみ渡される。
   */
  battleLifeReduced?: boolean;
}
import {
  getTotalCoresOnCardById,
  moveCardZone,
  updateCard,
} from "../core/core-system";
import { getCardById } from "../card/card-lookup";
import {
  getDefaultZoneRoleName,
  getMinimumRequiredCoresFromDefinition,
} from "../factories";

/**
 * カード定義が持つ `Effect.effectTribes`（効果メタ属性としての系統タグ）のうち、
 * 現在の状態で条件を満たすものを収集して union で返す。`getEffectiveTribes` の
 * カード全体系統（対象選択の `tribes` filter 等に使われる）とは別軸のため、
 * ここでは合成しない ― 呼び出し側 (`TriggerContext.sourceTribes` 導出) で union する。
 * `condition` 省略時は常時付与。
 */
export function getEffectTribeGrants(
  state: GameState,
  sourceInstanceId: string,
  sourceDef: CardDefinition | undefined,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  if (!sourceDef?.effects) return [];
  const result: string[] = [];
  for (const effect of sourceDef.effects) {
    const grant = effect.effectTribes;
    if (!grant) continue;
    if (
      grant.condition &&
      grant.condition.length > 0 &&
      !evaluateCondition(
        state,
        grant.condition,
        sourceInstanceId,
        actingPlayerId,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    for (const tribe of grant.tribes) {
      if (!result.includes(tribe)) result.push(tribe);
    }
  }
  return result;
}
import {
  getCombinedUnitBp,
  getEffectiveLevel,
  getCombinedUnitSymbolCount,
} from "../battle/battle-shared";

import {
  resolveCardImmunityAffect,
  resolveCardLeaveAffectDecisions,
  type CardAffectGateResult,
} from "./effect-affect-adapter";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
import { type ResistanceSourceCause } from "./effect-resistance-check";
import {
  cardTargetRef,
  normalizePreventionProfile,
  resolveTargetAcquisition,
  type EffectSourceContext,
  type TargetAcquireContext,
  type TargetLockBypassProfile,
} from "./target-affect-gate";
import {
  matchesCardFilter,
  matchesTribes,
  shouldExcludeAttachedCombinedChildForFieldCategoryFilter,
} from "../card/card-filter";
import {
  getCombinedUnitCostFilterOptions,
  getCardDefinitionForEffectiveFieldCard,
  getEffectiveColors,
  getEffectiveTribes,
  getEffectSourceTribePreventionBypass,
  getTargetAcquisitionGatesForCard,
} from "../legal/legal-actions-shared";
import {
  getEffectiveCategories,
  getEffectiveCategory,
  getEffectiveTribe,
} from "../mechanics/act-as-spirit";

import { nextPendingSelectionId } from "./structured-effect-sequences";
import { arePreSelectedTargetRefsPreserved } from "./preselected-target-ref-context";

export {
  executeCoreMove,
  resolvePendingLifeDamageDiscardChoiceForCoreMove,
  resolvePendingLifeGainReplacementChoiceForCoreMove,
  getLifeGainReplacementCE,
  getLifeGainPreventionCE,
  createPendingLifeGainReplacementChoice,
  applyLifeGainReplacementReplace,
  toSimpleNormalCoreContainer,
  executeBonusCoreMove,
} from "./structured-core-move";

export {
  executeDraw,
  executeReturnFromTrash,
  executeSearchDeck,
  executeBounce,
  executeDiscardHand,
  executeRevealHand,
  executePeekDeck,
  executeShuffleZone,
  executeSendToDeck,
  shouldAutoFinalizeDeckRevealRemainder,
  executeDeckReveal,
} from "./structured-zone-ops";

export {
  executeSummon,
  executeSoulStateSummon,
  executeTokenSummon,
  executeAllRelatedTokensSummon,
  executeSplitSummonChoice,
  executeSplitSummonChoiceTokenBranch,
  executeSplitSummonChoiceZoneBranch,
  executeRefSummon,
  resolveSummonFromZoneCandidates,
  getAvailableTokenSummonCount,
} from "./structured-summon";

export {
  executeDestroy,
  executeVanish,
  executeRemoveFromGame,
  executeDivineTransform,
  executeRebirth,
  executeReverseRebirth,
} from "./structured-card-replacement";

export {
  executeBpModify,
  executeCountIncrease,
  executeDeclareGimmick,
  executeCountGainModifier,
  executeCoreMoveAmountModifier,
  computeCoreMoveAmountBonus,
  executeCountDecrease,
  executeCountSet,
  executeDrawModify,
  executeEffectParamModify,
  executeDurationOverride,
} from "./structured-modifiers";

export {
  executeEffectImmunity,
  executeEffectResistance,
  executePreventBattle,
  executePreventBraveSeparation,
  executePreventNormalCoreMove,
  executeRequireBattleCost,
  executeRequireAttackExhaustCost,
  executeRequireBattleDestroyCost,
  executeRequireHandGainCost,
  executeHandGainPrevention,
  executePreventLifeDamage,
  executeRestrictFlash,
  executeRestrictStack,
  executeRestrictBurstActivation,
  executeRestrictAdvent,
  executeRestrictRecovery,
  executeRestrictReserveCostPayment,
  executeRestrictFieldCostPayment,
  executeGrantEffectSourcePreventionImmunity,
  executeSuppressStackSource,
  executeForceFirstAttacker,
  executeForcedTargetInclusion,
  executePreventHandDiscard,
  executePreventDeckDiscard,
  executeRedirectDeckDiscardToExclude,
  executeRestrictCorePlacement,
  executeRestrictSymbolAddition,
  executeLifeGainReplacement,
  executeLifeGainPrevention,
  executeCoreMoveDestinationReplacement,
  executeGateFlashStackCore,
  executeGateFlashStackHandDiscard,
  executeRestrictEndAttackStep,
  executeRestrictEndBattle,
  executeRestrictEndStep,
  executeRestrictEndTurn,
} from "./structured-continuous-effects";

export {
  reserveCoreShootSentinelId,
  parseReserveCoreShootSentinelId,
  getCoreShootSoulSourceId,
  coreShootSoulDestinationAllowed,
  analyzeCoreShootCandidates,
} from "./structured-core-shoot";

export {
  findRevealedEffect,
  findMovedToTrashAutoEffect,
  processMovedToTrashEffects,
  materializeDeferredTrashOptionalAdds,
} from "./structured-trash-ops";

export {
  executeCostOverride,
  executeAdditionalCost,
  executeAdventCostOverride,
  executeTreatAs,
  executeNegate,
} from "./structured-cost-gate";

export {
  executeSymbolAdd,
  executeUnblockable,
  executeAllowBlockWhileExhausted,
  executeAllowAttackWhileExhausted,
  executeAllowTaplessBattleDeclare,
  executeBlockUnblockable,
} from "./structured-combat";

export { executeUnderCardSlotCapacityGrant } from "./native-under-card-slot-capacity";

export {
  executeRecover,
  executeExhaust,
  executePreventNextRecovery,
  executeStayOnField,
  executeLifeDamage,
  executeLifeFill,
  resolvePendingLifeGainReplacementChoiceForLifeFill,
  executeEndAttackStep,
  executeEndTurn,
  finalizePendingAttackStepEndFinalizations,
  finalizePendingEndFinalizations,
  finalizePendingTurnEndFinalizations,
  executeEndBattle,
  executeAdditionalAttack,
  executeGrantConnectBattle,
  executeGrantExtraTurn,
  executeGrantExtraSteps,
  executeSkipNextTurn,
} from "./structured-state-grants";

export { executeEnterSoulState } from "./structured-soul-state";

export function cloneStateForPendingSnapshot(state: GameState): GameState {
  return { ...state, log: [...state.log] };
}

/** Duration オブジェクトをログ用文字列に変換 */
export function durationStr(d: Duration): string {
  const parts: string[] = [d.scope];
  if (d.whose) parts.push(d.whose);
  if (d.step) parts.push(d.step);
  if (d.untilTurnEnd) parts.push("until_turn_end");
  if (d.nextBattleEnd) parts.push("next_battle_end");
  return parts.join("_");
}

/** count=-1 は「すべて」。それ以外は先頭 count 件を返す。 */
function selectByCount<T>(items: T[], count: number): T[] {
  return count === -1 ? items : items.slice(0, count);
}

type CardLeaveAffectOperation =
  | "destroy"
  | "bounce"
  | "send_to_deck"
  | "vanish"
  | "remove_from_game";

export function effectSourceContext(
  actingPlayerId: string,
  sourceInstanceId: string | undefined,
  sourcePreventionLevel: import("../model").EffectPreventionLevel | undefined,
  sourceTargetLockBypass: TargetLockBypassProfile | undefined
): EffectSourceContext {
  return {
    actingPlayerId,
    ...(sourceInstanceId !== undefined ? { sourceInstanceId } : {}),
    prevention: normalizePreventionProfile({
      ...(sourcePreventionLevel !== undefined
        ? { resistance: sourcePreventionLevel }
        : {}),
      ...(sourceTargetLockBypass !== undefined
        ? { targetLockBypass: sourceTargetLockBypass }
        : {}),
    }),
    cause: "effect",
  };
}

function hasSpecialNexusTargetLockBypass(
  sourceTargetLockBypass: TargetLockBypassProfile | undefined
): boolean {
  return (
    sourceTargetLockBypass !== undefined &&
    sourceTargetLockBypass.kind !== "none"
  );
}

function cardSelectorIntent(
  target: EffectTarget,
  preSelectedIds?: string[]
): TargetAcquireContext["selectorIntent"] {
  if (target.count === -1) return "include_all";
  if (preSelectedIds && preSelectedIds.length > 0) return "explicit_target";
  return "explicit_target";
}

export function applyCardTargetAcquisitionGate<T extends CardInstance>(
  state: GameState,
  cards: readonly T[],
  source: EffectSourceContext,
  selectorIntent: TargetAcquireContext["selectorIntent"],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): T[] {
  const ctx: TargetAcquireContext = {
    source,
    targetClass: "card_or_zone",
    selectorIntent,
  };
  return cards.filter(
    (card) =>
      resolveTargetAcquisition(
        ctx,
        cardTargetRef(card),
        getTargetAcquisitionGatesForCard(state, card, getCardDefinitionById, {
          source,
        })
      ).kind === "candidate"
  );
}

function resolveCardLeaveAffectGate<T extends CardInstance>(
  state: GameState,
  cards: readonly T[],
  operation: CardLeaveAffectOperation,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: import("../model").EffectPreventionLevel | undefined,
  pierceCannotLeaveField = false,
  sourceCause: ResistanceSourceCause = "effect",
  sourcePreventionBypass?: TargetLockBypassProfile
): CardAffectGateResult<T>[] {
  return resolveCardLeaveAffectDecisions(
    state,
    cards,
    operation,
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    pierceCannotLeaveField,
    sourceCause,
    sourcePreventionBypass
  );
}

function partitionCardAffectGate<T extends CardInstance>(
  results: readonly CardAffectGateResult<T>[]
): { allowed: T[]; blocked: T[] } {
  const allowed: T[] = [];
  const blocked: T[] = [];
  for (const result of results) {
    if (result.decision.kind === "allowed") {
      allowed.push(result.card);
    } else {
      blocked.push(result.card);
    }
  }
  return { allowed, blocked };
}

export function resolveCardLeaveGate<T extends CardInstance>(
  state: GameState,
  cards: readonly T[],
  operation: CardLeaveAffectOperation,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel: import("../model").EffectPreventionLevel | undefined,
  pierceCannotLeaveField = false,
  sourceCause: ResistanceSourceCause = "effect",
  sourcePreventionBypass?: TargetLockBypassProfile
): { allowed: T[]; blocked: T[] } {
  return partitionCardAffectGate(
    resolveCardLeaveAffectGate(
      state,
      cards,
      operation,
      actingPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      pierceCannotLeaveField,
      sourceCause,
      sourcePreventionBypass
    )
  );
}

/**
 * コアシュート対象候補を分析する。
 * 複数のフィールドカードにコアがある場合に候補を返す。
 * 候補が1つ以下、またはコア合計が amount 以下なら null（自動解決可能）。
 */
export interface CoreShootCandidate {
  instanceId: string;
  definitionId: string;
  availableCores: number;
  /**
   * リザーブ擬似候補（フィールド/リザーブ横断コア除去, BSTH001-X01）の印。
   * true のとき instanceId は `reserve:<playerId>` sentinel で、実体カードでなく
   * playerId のリザーブ通常コアを表す。GUI/apply はこの候補をカードでなく
   * リザーブコアとして扱う。
   */
  isReserve?: boolean;
}

export interface PendingCoreShoot {
  sourceGroupMinimums?: import("../model").CoreSourceGroupMinimum[];
  candidates: CoreShootCandidate[];
  totalAmount: number;
  /**
   * P3-88: 「コアN個まで」最低取得数。省略時は totalAmount（＝ちょうど totalAmount を強制）。
   * 0 を指定すると 0〜totalAmount のプレイヤー選択（under-selection）になる。
   */
  minTotal?: number;
  toKind: string;
  toPlayerId: string;
  /**
   * toKind が field/field_card/card_instance のとき、コアを実際に置く単一カードの
   * instanceId (resolveCoreShootCardDestinationId で候補ちょうど1枚のときのみ解決)。
   * reserve/trash/void/life 宛では常に undefined。
   */
  toCardInstanceId?: string;
}

// ─── 効果条件 (Condition) 評価 ───

/**
 * Lv 条件 (`min_level` ConditionClause / `applicability.level`) 判定に使うカードの実効 Lv。
 *
 * SSOT: 実効 Lv の算出は `getEffectiveLevel` (battle-shared) ただ 1 つに委譲する。表示・
 * effective identity・card-filter と同一規約になり、levelCost override CE / act_as_spirit token /
 * 消滅待機 snapshot (Ver.17.0 例2) をすべて同じく扱う。`getCardDefinitionById` を渡すと override /
 * token も解決される (未指定なら印字 levelDefs + snapshot のみ)。
 *
 * かつてはこの関数が独自にコア→Lv を算出しており、消滅待機 snapshot を P3-83 で両系統に二重実装
 * していた (SSOT 違反)。委譲に一本化して解消した。
 */
// --- P0 アクション実装 ---

// --- ヘルパー ---

/** @internal インタプリタからの再利用用。 */
export function resolvePlayerRef(
  actingPlayerId: string,
  ref: EffectPlayerRef,
  state: GameState
): string {
  if (ref === "self") return actingPlayerId;
  return (
    state.players.find((p) => p.id !== actingPlayerId)?.id ?? actingPlayerId
  );
}

export function resolveLocationPlayer(
  actingPlayerId: string,
  loc: EffectCoreLocation,
  state: GameState
): string {
  if ("player" in loc)
    return resolvePlayerRef(actingPlayerId, loc.player, state);
  return actingPlayerId;
}

// --- P1 アクション実装 ---

// --- フィールド残置 (triggered な「破壊されたとき疲労状態で残る」等) ---

/**
 * stay_on_field 実行時のコンテキスト情報。
 * 同時誘発グループ内の関連 pending を撤回するために simultaneousGroupId を渡す。
 */
export interface PendingTriggeredEffectContext {
  simultaneousGroupId?: string;
}

/**
 * カードを任意のゾーン (トラッシュ等) からフィールドへ「配置」する共通プリミティブ。
 *
 * 通常は配置 (placement)。召喚/配置を区別する呼び出し側は eventKind を指定する。
 * コストなしの場入りを想定し、フィールド進入時コアは共通の維持コア選択で確定する。
 *
 * - ゾーン移動と handCount 調整は共通プリミティブ `moveCardZone` 経由。
 * - zoneRoleName はカテゴリ別 SSOT `getDefaultZoneRoleName(def, "field")` を使用
 *   (spirit/ultimate/brave → そのまま、nexus → "nexus")。
 * - 配置時 (place) 誘発は呼び出し側の before/after 差分
 *   (collectAndQueueTriggerReactions / collectTriggerEventsFromStateDelta) が
 *   return_from_trash/search_deck の per-instance field 配置ログから収集する。
 *   ブレイヴについては操作のeventKindを型付き台帳へ明示する。
 */
export function placeCardFromZoneToField(
  state: GameState,
  instanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  eventKind: "summon" | "place" = "place"
): GameState {
  const card = getCardById(state, instanceId);
  if (!card) return state;
  if (card.zone === "field") return state;
  const def = getCardDefinitionById(card.definitionId);
  if (!def) return state;
  if (def.printedCategory !== "nexus" && !isEffectSummonFieldEntry(def)) {
    return putCardOnField(state, instanceId, getCardDefinitionById);
  }
  if (isEffectFieldEntryRestricted(state, card, def, getCardDefinitionById)) {
    return {
      ...state,
      log: [...state.log, `effect:field_place:${instanceId}:restricted`],
    };
  }

  const minCores = getMinimumRequiredCoresFromDefinition(def);
  const zoneRoleName = getDefaultZoneRoleName(def, "field");

  // 1. ゾーン移動 (handCount 等は moveCardZone が調整)。
  let nextState = moveCardZone(state, instanceId, "field", zoneRoleName);

  // 2. フィールド進入時のインスタンス状態を初期化 (summon-from-other と同等)。
  nextState = updateCard(nextState, instanceId, (c) => ({
    ...c,
    normalCoreCount: 0,
    minimumRequiredCores: minCores,
    exhaustState: "recovered" as const,
    attachedToInstanceId: null,
    attachedChildrenIds: [],
  }));

  nextState = recordBraveFieldEntry(
    nextState,
    def,
    instanceId,
    eventKind,
    card.zone
  );
  return queueEnterFieldCorePlacement({
    state: nextState,
    beforeState: state,
    instanceId,
    getCardDefinitionById,
    eventKind,
  });
}

export function getSearchDeckFieldEntryLogEntry(
  actingPlayerId: string,
  instanceId: string,
  definition: CardDefinition | undefined
): string {
  return isEffectSummonFieldEntry(definition)
    ? `effect:summon:${instanceId}:self:search_deck`
    : `effect:field_place:search_deck:${actingPlayerId}:${instanceId}`;
}

function collectTargetCardCandidates(
  state: GameState,
  targetPlayerId: string,
  target: EffectTarget,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  bypassSpecialNexusTargetLock = false,
  allowPendingLeaveSelfCard = false,
  ignoreCategoryExclusion = false
) {
  // selfCard: 効果の発生源カード自身のみを対象とする。
  // 通常は field 上の直接ソースだけを候補化するが、使用中マジック自身の
  // 「このカードを除外する」は in_use ソースを、手元常駐効果の自己参照
  // (ENGINE-set-aside-exit-replacement-choice、BSTH08.5-M11「自分がこのカードを
  // 除外するとき」) は set_aside ソースを、同じ target acquisition 経路へ載せる。
  // selfCard は自分対象なので immunity は後段で落とさず、leave 系の affect gate が
  // cannot_leave / cannot_be_removed_from_game を判定する。
  // P3-145 SSOT: この zone 許容 (field/in_use/set_aside) は target-resolution.ts
  // resolveTargetSpec の case "self"/"source_card" と揃えてある。片方だけ変更しない。
  if (target.selfCard && sourceInstanceId) {
    const self = resolveSelfReferenceCard(state, sourceInstanceId);
    if (
      (self?.zone !== "field" &&
        self?.zone !== "in_use" &&
        self?.zone !== "set_aside") ||
      (self.pendingLeaveKind !== null && !allowPendingLeaveSelfCard)
    )
      return [];
    return self ? [self] : [];
  }

  // 魂状態のインスタンスIDを収集（includeSoulState でなければ除外用）
  const soulStateIds = target.includeSoulState
    ? null
    : getEffectiveSoulStateIds(state, getCardDefinitionById);
  const sourceDefinition = getCardDefinitionById(
    state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
      ?.definitionId ?? ""
  );

  return state.cardInstances.filter((c) => {
    if (c.controllerPlayerId !== targetPlayerId) return false;
    // 対象ゾーン: target.zone 指定時はそれに従う (ENGINE-effect-immunity-hand-zone-scope)。
    // 省略時は従来どおり field 限定。
    if (target.zone ? !target.zone.includes(c.zone) : c.zone !== "field")
      return false;
    if (c.pendingLeaveKind !== null) return false;
    // 魂状態のカードは通常の効果対象から除外
    if (soulStateIds && soulStateIds.has(c.instanceId)) return false;
    const def = target.filter
      ? getCardDefinitionForEffectiveFieldCard(c, getCardDefinitionById, {
          state,
          filter: target.filter,
        })
      : getCardDefinitionById(c.definitionId);
    if (!def) return false;
    if (target.filter) {
      return matchesCardFilter(c, def, target.filter, {
        state,
        ...(soulStateIds ? { soulStateIds } : {}),
        underCardIds: collectUnderCardScopeIds(state),
        ...(sourceDefinition ? { sourceDefinition } : {}),
        battleEntities: state.battleEntities,
        fieldCategoryContext: true,
        getCardDefinitionById,
        effectiveColors: getEffectiveColors(state, c, def),
        effectiveTribes: getEffectiveTribes(
          state,
          c,
          def,
          getCardDefinitionById
        ),
        effectiveBp: getCombinedUnitBp(state, c, def, getCardDefinitionById),
        coreCount: getTotalCoresOnCardById(state, c.instanceId),
        effectiveLevel: getEffectiveLevel(state, c, def, getCardDefinitionById),
        effectiveSymbolCount: getCombinedUnitSymbolCount(
          state,
          c,
          def,
          getCardDefinitionById
        ),
        ...getCombinedUnitCostFilterOptions(
          state,
          c,
          def,
          getCardDefinitionById
        ),
        evaluateCondition: (condition, sourceId, conditionActingPlayerId) =>
          evaluateCondition(
            state,
            condition,
            sourceId,
            conditionActingPlayerId,
            getCardDefinitionById
          ),
        evaluateApplicability: (applicability, sourceId) =>
          evaluateApplicability(
            state,
            applicability,
            sourceId,
            getCardDefinitionById
          ),
        ...(bypassSpecialNexusTargetLock
          ? { bypassSpecialNexusTargetLock: true }
          : {}),
        ignoreCategoryExclusion,
      });
    }
    // 創界神/導界者ネクサスは「創界神対象」効果のみ受ける（includeGrandwalker でなければ除外）
    if (
      !bypassSpecialNexusTargetLock &&
      !target.includeGrandwalker &&
      isGrandwalkerOrGuidedNexus(def)
    )
      return false;
    // grandwalkerOnly:true は CardFilter.targetsGrandwalker:"only" の射影。
    // 通常 spirit/nexus を排除し、創界神/導界者ネクサスのみを残す。
    if (target.grandwalkerOnly && !isGrandwalkerOrGuidedNexus(def))
      return false;
    // 創界石ネクサスは「創界石対象」効果のみ受ける（includeGrandstone でなければ除外）
    if (
      !bypassSpecialNexusTargetLock &&
      !target.includeGrandstone &&
      isGrandstoneNexus(def)
    )
      return false;
    // P3-69: 裏向き/act_as_spirit を考慮した実効 category で判定する。
    // 裏向き素性なしは undefined → どの category にもマッチしない。
    if (target.category) {
      if (
        shouldExcludeAttachedCombinedChildForFieldCategoryFilter(
          state,
          c,
          def,
          { category: target.category }
        )
      ) {
        return false;
      }
      const effCat = getEffectiveCategory(
        state,
        c,
        def,
        ignoreCategoryExclusion
      );
      const effCategories =
        effCat === undefined
          ? []
          : getEffectiveCategories(
              state,
              c,
              def,
              getCardDefinitionById,
              ignoreCategoryExclusion
            );
      if (!target.category.some((category) => effCategories.includes(category)))
        return false;
    }
    const effColors = getEffectiveColors(state, c, def);
    if (target.colors && !target.colors.some((col) => effColors.includes(col)))
      return false;
    if (
      (target.minColorCount !== undefined ||
        target.maxColorCount !== undefined) &&
      !matchesColorCount(effColors, target.minColorCount, target.maxColorCount)
    )
      return false;
    // 系統判定は SSOT `matchesTribes` に委譲する (tribes の OR/AND、tribesRequired の
    // AND 必須系統、noTribes をまとめて評価する)。かつてここが OR 固定の旧 `tribeMatches`
    // を呼んでいたため、「系統：「A」と「B」を持つ」型の AND 指定が黙って OR に落ちていた。
    // `target.filter` を持つ DSL 由来の対象は上の matchesCardFilter 経路で処理済みで、
    // ここへ来るのは EffectTarget を直接組み立てる内部経路のみ。
    if (
      target.tribes ||
      target.tribesRequired ||
      target.noTribes !== undefined
    ) {
      if (
        !matchesTribes(
          getEffectiveTribe(state, c, def, getCardDefinitionById),
          {
            ...(target.tribes ? { tribes: target.tribes } : {}),
            ...(target.tribesLogic ? { tribesLogic: target.tribesLogic } : {}),
            ...(target.tribesRequired
              ? { tribesRequired: target.tribesRequired }
              : {}),
            ...(target.noTribes !== undefined
              ? { noTribes: target.noTribes }
              : {}),
          }
        )
      )
        return false;
    }
    if (
      target.maxBp !== undefined &&
      getCombinedUnitBp(state, c, def, getCardDefinitionById) > target.maxBp
    )
      return false;
    if (
      target.minCost !== undefined ||
      target.maxCost !== undefined ||
      target.costBasis !== undefined ||
      target.combined !== undefined
    ) {
      if (
        !matchesCardFilter(
          c,
          def,
          {
            ...(target.minCost !== undefined
              ? { minCost: target.minCost }
              : {}),
            ...(target.maxCost !== undefined
              ? { maxCost: target.maxCost }
              : {}),
            ...(target.costBasis !== undefined
              ? { costBasis: target.costBasis }
              : {}),
            ...(target.combined !== undefined
              ? { combined: target.combined }
              : {}),
          },
          {
            ...getCombinedUnitCostFilterOptions(
              state,
              c,
              def,
              getCardDefinitionById
            ),
          }
        )
      )
        return false;
    }
    // コア数 (「コアN個以下/以上の〜」)。collectTargetCardCandidates は field カードのみ走査するため
    // coreCount は常に算出可能。SSOT = getTotalCoresOnCardById (通常コア + soul,
    // 10_rules/06_core-system.md L41 generic コアは soul を含む)。matchesCardFilter の
    // coreCount 注入経路と同じ helper を使う (候補列挙パスとの一致)。
    if (target.maxCores !== undefined || target.minCores !== undefined) {
      const coreCount = getTotalCoresOnCardById(state, c.instanceId);
      if (target.minCores !== undefined && coreCount < target.minCores)
        return false;
      if (target.maxCores !== undefined && coreCount > target.maxCores)
        return false;
    }
    return true;
  });
}

/**
 * フィールド対象の解決。selfCard → GUI/redirect 事前選択 → count:-1 → 自動選択 の優先順。
 *
 * P3-47 F-4: redirect_effect_target 経由の re-entry で渡される preSelectedIds は
 * count=-1 の時でも honor する (executeRecover / executeExhaust / executeStayOnField と同方針)。
 * count=-1 で preSelectedIds を無視すると redirect 後の差し替えが反映されない。
 */
export function resolveTargetCards(
  state: GameState,
  targetPlayerId: string,
  target: EffectTarget,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId: string,
  preSelectedIds?: string[],
  /**
   * カード対象「相手の効果を受けない」(`defense_immune`) を実行時に除外するための効果発動側。
   * 省略時は免疫フィルタを適用しない (後方互換)。self/opponent/any は
   * 共通 card immunity gate で判定し、自分対象も scope に応じて免疫を適用する。
   * GUI 候補列挙 (getCandidateTargetInstanceIds →
   * filterTargetsByPreventionLevel) を経ない battle_immediate / 自動選択 / count:-1 経路で
   * 初めて塞がれる ([P3-77] 線61 のカード耐性汎用配線の構造化インタプリタ側補完)。
   */
  actingPlayerId?: string,
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  /** true のとき対象取得ゲート (target-lock CE の cannot_be_targeted/cannot_include) を適用する。 */
  applyTargetAcquisitionGate?: boolean,
  candidateFilter?: (card: CardInstance) => boolean,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  options?: {
    allowPendingLeaveSelfCard?: boolean;
    /** 部分免疫を作用種別で照合する。省略時は従来の汎用効果として判定する。 */
    effectAspect?: string;
    /** 宣言済み TargetRef の再開では acquisition だけを省略し、immunity は affect gate で判定する。 */
    preservePreSelectedTargetRefs?: boolean;
  }
) {
  const immunitySourceIdentity = resolveAffectSourceIdentity({
    state,
    sourceInstanceId,
    ...(effectSourceInstanceId !== undefined ? { effectSourceInstanceId } : {}),
    ...(effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId }
      : {}),
    getCardDefinitionById,
  });
  const immunitySourceInstanceId = immunitySourceIdentity.instanceId;
  const effectSourceCard = immunitySourceIdentity.instance;
  const effectSourceDefinition = immunitySourceIdentity.definition;
  const bypassSpecialNexusTargetLock = hasSpecialNexusTargetLockBypass(
    sourceTargetLockBypass
  );
  const immunitySourcePreventionBypass =
    sourcePreventionBypass ??
    (actingPlayerId !== undefined
      ? getEffectSourceTribePreventionBypass(
          state,
          immunitySourceInstanceId,
          actingPlayerId,
          getCardDefinitionById
        )
      : undefined);
  // 発揮元の実効 identity を渡す。継承の self 対象は host でも、効果源は provider になり得る。
  const immunitySource: {
    instance?: CardInstance;
    definition?: CardDefinition;
  } = {
    ...(effectSourceCard ? { instance: effectSourceCard } : {}),
    ...(effectSourceDefinition ? { definition: effectSourceDefinition } : {}),
  };
  const dropImmune = <T extends CardInstance>(cards: T[]): T[] =>
    actingPlayerId === undefined
      ? cards
      : cards.filter(
          (c) =>
            resolveCardImmunityAffect(
              state,
              c,
              actingPlayerId,
              sourcePreventionLevel ?? "none",
              immunitySource,
              getCardDefinitionById,
              immunitySourcePreventionBypass,
              options?.effectAspect
            ).kind === "allowed"
        );
  const filterCandidates = <T extends CardInstance>(cards: T[]): T[] =>
    candidateFilter === undefined ? cards : cards.filter(candidateFilter);
  const applyAcquisition = <T extends CardInstance>(cards: T[]): T[] =>
    actingPlayerId === undefined || applyTargetAcquisitionGate !== true
      ? cards
      : applyCardTargetAcquisitionGate(
          state,
          cards,
          effectSourceContext(
            actingPlayerId,
            immunitySourceInstanceId,
            sourcePreventionLevel,
            sourceTargetLockBypass
          ),
          cardSelectorIntent(target, preSelectedIds),
          getCardDefinitionById
        );
  const collectCandidates = (): CardInstance[] => {
    const targetPlayerIds =
      target.player === "either"
        ? state.players.map((player) => player.id)
        : [targetPlayerId];
    return targetPlayerIds.flatMap((playerId) =>
      collectTargetCardCandidates(
        state,
        playerId,
        target,
        getCardDefinitionById,
        sourceInstanceId,
        bypassSpecialNexusTargetLock,
        options?.allowPendingLeaveSelfCard ?? false,
        sourceTargetLockBypass?.kind === "all_effects"
      )
    );
  };

  // selfCard: sourceInstanceId のカード自身。自分対象も通常候補と同じ免疫・取得 gate を通す。
  if (target.selfCard) {
    return applyAcquisition(
      dropImmune(
        filterCandidates(
          collectTargetCardCandidates(
            state,
            targetPlayerId,
            target,
            getCardDefinitionById,
            sourceInstanceId,
            bypassSpecialNexusTargetLock,
            options?.allowPendingLeaveSelfCard ?? false,
            sourceTargetLockBypass?.kind === "all_effects"
          )
        )
      )
    );
  }
  // GUI / ref / redirect 由来の preSelectedIds がある場合は最優先。
  // 空配列も「解決済み対象なし」を意味し、自動再解決へ落としてはいけない。
  if (preSelectedIds !== undefined) {
    const idSet = new Set(preSelectedIds);
    const preSelectedCards = filterCandidates(
      state.cardInstances.filter((c) => idSet.has(c.instanceId))
    );
    if (
      options?.preservePreSelectedTargetRefs === true ||
      arePreSelectedTargetRefsPreserved(preSelectedIds)
    ) {
      return dropImmune(preSelectedCards);
    }
    return applyAcquisition(dropImmune(preSelectedCards));
  }
  // count:-1: 全件対象（GUI 選択不要）
  if (target.count === -1) {
    return applyAcquisition(dropImmune(filterCandidates(collectCandidates())));
  }
  // fallback: 自動選択（AI / テスト用）。免疫カードを候補から除いてから count で絞る
  // (免疫カードを誤って先頭で掴み、有効な対象を取りこぼすのを防ぐ)。
  const candidates = applyAcquisition(
    dropImmune(filterCandidates(collectCandidates()))
  );
  return selectByCount(candidates, target.count);
}

// --- バウンス（手札に戻す） ---

// --- 手札破棄 ---

// --- 手札公開 ---

// --- デッキ閲覧 (peek_deck) ---

// --- ゾーンシャッフル (shuffle_zone) ---

// --- デッキ送り ---

// --- デッキオープン: revealed 自動効果 ---

/** Effect の cardEventDisposition を優先し、なければ steps の先頭アクションから推論する（後方互換） */
export function resolveCardEventDisposition(
  effect: import("../dsl-types").Effect
): import("../dsl-types").CardEventDisposition {
  if (effect.cardEventDisposition) {
    if (effect.cardEventDisposition.kind === "move")
      requireCardZone(effect.cardEventDisposition.destination);
    return effect.cardEventDisposition;
  }
  const first = effect.steps[0];
  if (!first) return { kind: "move", destination: "hand" }; // 後方互換
  const action = first.action;
  if (action.kind === "move_self") {
    return { kind: "move", destination: requireCardZone(action.destination) };
  }
  if (action.kind === "summon") {
    const cm = action.costModifier;
    return cm != null
      ? { kind: "summon", costModifier: cm }
      : { kind: "summon" };
  }
  if (action.kind === "remove_from_game") {
    return { kind: "remove_from_game" };
  }
  return { kind: "steps_only" };
}

// --- トラッシュ移動: moved_to_trash 自動効果 ---

/**
 * revealed_choice 系 `pendingDeckReveal` を構築する共通ヘルパー。
 *
 * オープン由来 (`origin="deck"`) とトラッシュ由来 (`origin="trash"`) は、どちらも
 * 「スタック窓を開かない add/not ピック画面（revealed_choice）」という同一 UX に収束する。
 * 異なるのは注入する値（`picks` / `remainder` / 候補 / `origin`）だけ。両経路がこのヘルパーを共有する。
 */
export function buildRevealedChoicePending(params: {
  beforePickSteps?: import("../dsl-types").EffectStep[];
  beforeMoveSteps?: import("../dsl-types").EffectStep[];
  actingPlayerId: string;
  targetPlayerId?: string;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  revealedCardInstanceIds: string[];
  /**
   * pending 生成時点の revealed カード全体の不変スナップショット。省略時は
   * `revealedCardInstanceIds` をそのまま使う（trash origin 等、両者が同じ呼び出しに
   * 限り一致するケース）。
   */
  originalRevealedCardInstanceIds?: string[];
  revealTo?: import("../model").PendingDeckReveal["revealTo"];
  picks: import("../model").PendingDeckReveal["picks"];
  remainder: import("../model").PendingDeckReveal["remainder"];
  phase: import("../model").PendingDeckReveal["phase"];
  origin: "deck" | "trash";
  /** deck reveal から場に出たカード自身の summon/place 効果を抑止する。 */
  suppressFieldEntryEffects?: boolean;
  optionalCandidateIds?: string[];
  revealedUsageGroupByInstanceId?: Record<string, string>;
  revealedDispositionMap?: Record<
    string,
    import("../model").RevealedDisposition
  >;
  bonusStepsByInstanceId?: Record<
    string,
    ReadonlyArray<import("../dsl-types").EffectStep>
  >;
  priorStateSnapshot?: GameState;
}): import("../model").PendingDeckReveal {
  const hasOptional =
    params.optionalCandidateIds !== undefined &&
    params.optionalCandidateIds.length > 0;
  const hasDispositionMap =
    params.revealedDispositionMap !== undefined &&
    Object.keys(params.revealedDispositionMap).length > 0;
  const choicePlayerId =
    params.origin === "deck" &&
    params.phase === "revealed_choice" &&
    hasOptional
      ? (params.targetPlayerId ?? params.actingPlayerId)
      : params.actingPlayerId;
  return {
    pendingId: nextPendingSelectionId("dr"),
    ...(params.beforePickSteps
      ? { beforePickSteps: params.beforePickSteps }
      : {}),
    ...(params.beforeMoveSteps
      ? { beforeMoveSteps: params.beforeMoveSteps }
      : {}),
    actingPlayerId: choicePlayerId,
    ...(choicePlayerId !== params.actingPlayerId
      ? { revealedChoiceParentPlayerId: params.actingPlayerId }
      : {}),
    ...(params.targetPlayerId !== undefined &&
    params.targetPlayerId !== params.actingPlayerId
      ? { targetPlayerId: params.targetPlayerId }
      : {}),
    sourceInstanceId: params.sourceInstanceId,
    sourceDefinitionId: params.sourceDefinitionId,
    revealedCardInstanceIds: params.revealedCardInstanceIds,
    originalRevealedCardInstanceIds:
      params.originalRevealedCardInstanceIds ?? params.revealedCardInstanceIds,
    ...(params.revealTo !== undefined ? { revealTo: params.revealTo } : {}),
    ...(params.suppressFieldEntryEffects
      ? { suppressFieldEntryEffects: true }
      : {}),
    picks: params.picks,
    remainder: params.remainder,
    phase: params.phase,
    currentPickIndex: 0,
    pickedCardInstanceIds: [],
    origin: params.origin,
    ...(hasOptional
      ? {
          revealedAutoAddCandidateIds: params.optionalCandidateIds,
        }
      : {}),
    ...(hasDispositionMap
      ? { revealedDispositionMap: params.revealedDispositionMap }
      : {}),
    ...(params.revealedUsageGroupByInstanceId !== undefined
      ? {
          revealedUsageGroupByInstanceId: params.revealedUsageGroupByInstanceId,
        }
      : {}),
    ...(params.bonusStepsByInstanceId !== undefined
      ? { bonusStepsByInstanceId: params.bonusStepsByInstanceId }
      : {}),
    ...(params.priorStateSnapshot !== undefined
      ? { priorStateSnapshot: params.priorStateSnapshot }
      : {}),
  };
}

// --- デッキオープン ---

// --- カウント増加 ---

// --- 魂状態 ---

// --- 転神/転者（創界神/導界者ネクサスにスピリット二重状態を付与） ---

// --- 消滅（コアはリザーブに置かれる） ---

// --- シンボル追加 (ContinuousEffect 登録) ---

// --- 効果耐性 (ContinuousEffect: defense_immune 登録) ---

export function dynamicTargetFilterFromEffectTarget(
  target: EffectTarget
): ContinuousEffect["targetFilter"] | null {
  if (target.selfCard || target.count !== -1) return null;
  if (target.filter?.filterOr && target.filter.filterOr.length > 0) {
    return null;
  }
  if (target.filter) {
    const explicitZone = target.zone ?? target.filter.zone;
    const hasCostOrCombinedFilter =
      target.filter.minCost !== undefined ||
      target.filter.maxCost !== undefined ||
      target.filter.costBasis !== undefined ||
      target.filter.combined !== undefined;
    const useImplicitFieldZone =
      explicitZone === undefined && hasCostOrCombinedFilter;
    if (
      target.filter.noTribes !== true &&
      explicitZone === undefined &&
      !useImplicitFieldZone
    ) {
      return null;
    }
    return {
      player: target.player,
      ...target.filter,
      ...(explicitZone !== undefined || useImplicitFieldZone
        ? { zone: explicitZone ?? ["field"] }
        : {}),
    };
  }
  if (target.noTribes !== true && !target.zone) return null;
  return {
    player: target.player,
    ...(target.category ? { category: target.category } : {}),
    ...(target.colors ? { colors: target.colors } : {}),
    ...(target.tribes ? { tribes: target.tribes } : {}),
    // 系統 AND 条件 (「系統：「A」と「B」を持つ」)。tribes だけ写すと
    // matchesTribes が既定 OR で判定してしまう (target.filter 経路は上で全展開済み)。
    ...(target.tribesLogic ? { tribesLogic: target.tribesLogic } : {}),
    ...(target.tribesRequired ? { tribesRequired: target.tribesRequired } : {}),
    ...(target.cardName ? { cardName: target.cardName } : {}),
    ...(target.minCost !== undefined ? { minCost: target.minCost } : {}),
    ...(target.maxCost !== undefined ? { maxCost: target.maxCost } : {}),
    ...(target.costBasis !== undefined ? { costBasis: target.costBasis } : {}),
    ...(target.combined !== undefined ? { combined: target.combined } : {}),
    ...(target.maxCores !== undefined ? { maxCores: target.maxCores } : {}),
    ...(target.minCores !== undefined ? { minCores: target.minCores } : {}),
    ...(target.noTribes === true ? { noTribes: true } : {}),
    ...(target.zone ? { zone: target.zone } : {}),
  };
}

// --- コスト上書き (ContinuousEffect: cost_override 登録) ---

// --- 追加コスト (ContinuousEffect: additional_cost 登録) ---
// 「このカードのコストは X としても扱う」: 元のコスト値を維持しつつ追加コスト値を持つ

// --- ブロック不可 (ContinuousEffect: unblockable 登録) ---

// --- 疲労状態でもブロック可能 (ContinuousEffect: allow_block_while_exhausted 登録) ---

// --- 「ブロックされない」相手をブロック可能 (ContinuousEffect: block_unblockable 登録) ---

// --- ライフダメージ防止 (CE: prevent_life_damage 登録) ---
//
// NOTE: prevent_life_damage は CE 登録のみで consumer 未配線 (silent disabled)。
// 新規カードは life_damage_interception(mode:"replace") を直接使うこと
// (BSTH07-R10 / BSTH02.7-TX01(A) / BSTH04-C11 等の先例)。残存採用カード (BSFT01-TR09 等)
// も逐次置換する想定。

// --- 効果耐性 (CE: effect_resistance 登録) ---

// --- アタック/ブロック禁止 (CE: prevent_battle 登録) ---

// --- ドロー枚数修正 (CE: draw_modify 登録) ---

// --- 効果パラメータ修飾 (CE: effect_param_override 登録) — P3-14 A-7 ---

// --- フラッシュ制限 (CE: restrict_flash 登録) ---

// --- スタック効果制限 (CE: restrict_stack 登録, P3-75) ---

// --- スタックタイミング元抑止 (CE: suppress_stack_source 登録, P3-75) ---

// --- 手札破棄耐性 (CE: prevent_hand_discard 登録。BSFT01-C03/C04) ---

// --- デッキ破棄耐性 (CE: prevent_deck_discard 登録。BSTH08.5-C21) ---

// --- ライフコア配置制限 (CE: restrict_core_placement_life 登録。BSTH02.7-C01 effects[2] choice[0]) ---

// --- 発揮前提コア除去ゲート (CE: gate_flash_stack_core 登録。BSTS01-M03) ---

// --- 色/シンボル扱い変更 (CE: treat_as 登録) ---

// --- アタックステップ終了 ---

// --- アタックステップ終了の妨害 (CE: restrict_end_attack_step 登録) ---

// --- ゲーム除外（removed_from_game ゾーンへ移動） ---

// --- ライフ補填（目標値まで回復） ---

// --- 追加アタック ---

// --- 無効化 (CE: negate 登録) ---

// --- 転醒（カード裏返し） ---

// --- 統一召喚（自己召喚 + ゾーンから別カード召喚） ---
