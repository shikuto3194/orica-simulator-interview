import { requireCardZone } from "../model";
import { replaceCardInstances } from "../zone/card-instance-state";
import { isInHandForOwnEffect } from "../effect/card-access-rules";
import { resolveSeparatedBraveExhaustState } from "./brave-spirit-state-recovery";
import { resolveDefinitionEffect } from "../effect/definition-effect-reference";
/**
 * アクセル / チェンジ システム
 *
 * アクセル: 手札からマジックのようにコストを支払い効果を使用。使用後は手元(set_aside)へ。
 *           条件不成立時はトラッシュへ。手元からアクセルは再使用不可。
 * チェンジ: フラッシュタイミングで手札からコストを支払い効果を使用。
 *           フィールドのスピリットと入れ替え（回復状態・召喚イベント不発火）可能。
 */
import { recordHandExchange } from "../zone/hand-increase";
import {
  getApplicableCostOverrideCEs,
  matchesCardName,
  matchesTribes,
} from "../card/card-filter";
import { getCardById } from "../card/card-lookup";
import { calculateReduction, type ReductionResult } from "../core/cost-system";
import {
  moveCardZone,
  moveNormalCores,
  moveSoulCore,
  updateCard,
} from "../core/core-system";
import { recomputeBattleEntityBp } from "../battle/battle-shared";
import { getEffectiveCategory } from "./act-as-spirit";
import {
  derivePreventionLevel,
  getEffectiveColors,
  getEffectiveTribes,
  matchesBraveConditionForCard,
  resolveDynamicStackNegatePreventionLevel,
  canUseEffectByUsageLimit,
  recordEffectUsageIfLimited,
} from "../legal/legal-actions-shared";
import type { BattleImmediateEffectActionRegistrationLookup } from "../battle/battle-immediate-effect-system";
import {
  type HandWrittenEffectResolverLookup,
  runActionMainResolution,
} from "../effect/effect-resolution";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import { deriveSuppressionEffectDescriptor } from "../effect/structured-effect-registrations";
import type { DSL } from "../dsl-types";
import { checkAndQueueOracleChoices } from "./oracle-system";
import {
  collectAndQueueTriggerReactions,
  collectCostPaymentVanishTriggers,
  queueEffectActivationTriggers,
  queueFlashUsedTriggers,
  type BurstActionRegistrationLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../effect/trigger-system";
import type {
  AccelData,
  ActiveStack,
  CardDefinition,
  CardInstance,
  ChangeData,
  ChangeSwapCondition,
  ContinuousEffect,
  GameState,
  LifeCoreKind,
  PendingAccelCleanup,
  UnderCardEntry,
} from "../model";
import {
  applyCardCostPayments,
  assertMatchingPaymentAmount,
  getAvailableCardCostPaymentSources,
  getTotalPaymentAmount,
  type AvailableCardCostPaymentSourcesResult,
  type CardCostPaymentSource,
} from "../core/payment-system";
import { recomputeAndRebuildContinuousEffectsForSources } from "../effect/continuous-effect-rebuild";
import {
  hasOutstandingEffectResolutionContinuation,
  isChainAtOrUnder,
  type EffectFilterTag,
} from "../state-based-actions";
import { queuePreFlushGrantedEffectsAndFlushPendingLeaves } from "../zone/pending-leave-flush";
import { getEffectDescriptorSourceKindForPrintedCategory } from "../source-kinds";
import { isExcludedByHostExclusiveLock } from "./advent-system";
import { adventSourceIdsOf } from "../model";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";

// ─── 共通ヘルパー ───

function getCardInstanceOrThrow(
  state: GameState,
  instanceId: string,
  detail: string
): CardInstance {
  const card = getCardById(state, instanceId);
  if (!card) throw new Error(`${detail}: ${instanceId}`);
  return card;
}

function getCardDefinitionOrThrow(
  definitionId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): CardDefinition {
  const def = getCardDefinitionById(definitionId);
  if (!def) throw new Error(`Unknown card definition: ${definitionId}`);
  return def;
}

function deriveAccelChangeSuppressionEffectDescriptor(options: {
  sourceDefinitionId: string;
  sourceKind: ReturnType<
    typeof getEffectDescriptorSourceKindForPrintedCategory
  >;
  keyword: "accel" | "change";
  effects: readonly import("../dsl-types").Effect[] | undefined;
}) {
  const firstEffect = options.effects?.[0];
  if (!firstEffect) {
    return {
      sourceDefinitionId: options.sourceDefinitionId,
      sourceKind: options.sourceKind,
      keywords: [options.keyword],
    };
  }
  const descriptor = deriveSuppressionEffectDescriptor(firstEffect, {
    sourceDefinitionId: options.sourceDefinitionId,
    sourceKind: options.sourceKind,
    effectIndex: 0,
  });
  return {
    ...descriptor,
    keywords: [...new Set([...(descriptor.keywords ?? []), options.keyword])],
  };
}

function deriveFirstAccelChangeEffectPreventionLevel(
  effects: readonly import("../dsl-types").Effect[] | undefined
): import("../model").EffectPreventionLevel | undefined {
  const firstEffect = effects?.[0];
  return firstEffect ? derivePreventionLevel(firstEffect) : undefined;
}

function collectAccelChangeCostPaymentVanishTriggers(options: {
  beforeState: GameState;
  afterState: GameState;
  chainId: string;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  return collectCostPaymentVanishTriggers({
    beforeState: options.beforeState,
    afterState: options.afterState,
    chainId: options.chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

function getPendingLeaveSourceContext(
  state: GameState,
  pendingLeaves: readonly GameState["pendingLeaveEntities"][number][],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): {
  causedBySourceInstanceId?: string | null;
  sourceColors?: readonly CardDefinition["colors"][number][];
  sourceCategory?: CardDefinition["printedCategory"];
} {
  const sourceInstanceIds = Array.from(
    new Set(
      pendingLeaves
        .map((pendingLeave) => pendingLeave.causedByEffectSourceInstanceId)
        .filter(
          (sourceInstanceId): sourceInstanceId is string =>
            typeof sourceInstanceId === "string" && sourceInstanceId.length > 0
        )
    )
  );
  if (sourceInstanceIds.length !== 1) return {};
  const causedBySourceInstanceId = sourceInstanceIds[0]!;
  const sourceCard = getCardById(state, causedBySourceInstanceId);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (sourceCard === undefined || sourceDefinition === undefined) {
    return { causedBySourceInstanceId };
  }
  return {
    causedBySourceInstanceId,
    sourceColors: getEffectiveColors(state, sourceCard, sourceDefinition),
    sourceCategory: sourceDefinition.printedCategory,
  };
}

function flushPendingLeavesAndCollectReactions(options: {
  state: GameState;
  chainId: string | null;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  if (options.chainId === null) {
    let state = options.state;
    for (const chainId of new Set(
      state.pendingLeaveEntities.map((leave) => leave.chainId)
    )) {
      state = flushPendingLeavesAndCollectReactions({
        ...options,
        state,
        chainId,
      });
    }
    return state;
  }

  const scopedPendingLeaves = options.state.pendingLeaveEntities.filter(
    (pendingLeave) => pendingLeave.chainId === options.chainId
  );
  if (scopedPendingLeaves.length === 0) return options.state;

  const otherPendingLeaves = options.state.pendingLeaveEntities.filter(
    (pendingLeave) => pendingLeave.chainId !== options.chainId
  );
  const scopedState: GameState = {
    ...options.state,
    pendingLeaveEntities: scopedPendingLeaves,
  };
  const sourceContext = getPendingLeaveSourceContext(
    options.state,
    scopedPendingLeaves,
    options.getCardDefinitionById
  );
  const { causedBySourceInstanceId, ...flushSourceContext } = sourceContext;
  const scopedAfterFlush = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
    state: scopedState,
    chainId: options.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    ...flushSourceContext,
  });
  if (scopedAfterFlush === scopedState) return options.state;

  const afterFlush: GameState = {
    ...scopedAfterFlush,
    pendingLeaveEntities: [
      ...otherPendingLeaves,
      ...scopedAfterFlush.pendingLeaveEntities,
    ],
  };
  return collectAndQueueTriggerReactions({
    beforeState: options.state,
    afterState: afterFlush,
    source: "action_resolution",
    chainId: options.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedBySourceInstanceId: causedBySourceInstanceId ?? null,
  });
}

/**
 * アクセル/チェンジ用の軽減計算。
 * カード自体の cost/reductionSymbols ではなく、accelData/changeData の cost/reduction を使用する。
 */
export function calculateAccelChangeReduction(options: {
  state: GameState;
  actingPlayerId: string;
  cost: number;
  reductionSymbols: readonly import("../model").SymbolColor[];
  /** 対象コストを支払うカード使用手段。種別限定 CE の照合に必須。 */
  useKind: DSL.CardUseKind;
  sourceInstanceId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): ReductionResult {
  // calculateReduction は card.cost と card.reductionSymbols を使うため、
  // 仮想的なカード定義を構築して渡す
  const virtualCard = {
    cost: options.cost,
    reductionSymbols: [...options.reductionSymbols],
  } as CardDefinition;
  return calculateReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: virtualCard,
    ...(options.sourceInstanceId !== undefined
      ? { sourceInstanceId: options.sourceInstanceId }
      : {}),
    useKind: options.useKind,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

/**
 * アクセル/チェンジ用のコスト支払いソース取得。
 */
export function getAvailableAccelChangePaymentSources(options: {
  state: GameState;
  actingPlayerId: string;
  cost: number;
  reductionSymbols: readonly import("../model").SymbolColor[];
  /** 対象コストを支払うカード使用手段。種別限定 CE の照合に必須。 */
  useKind: DSL.CardUseKind;
  sourceInstanceId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): AvailableCardCostPaymentSourcesResult {
  const virtualCard = {
    cost: options.cost,
    reductionSymbols: [...options.reductionSymbols],
  } as CardDefinition;
  return getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: virtualCard,
    ...(options.sourceInstanceId !== undefined
      ? { sourceInstanceId: options.sourceInstanceId }
      : {}),
    useKind: options.useKind,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

/**
 * ENGINE-accel-tribe-cost-override (BSTH08.5-R12 effects[0]) 向け。
 * 「自分の系統：Xを持つカードの【アクセル】のコストを0にできる」型の cost_override CE を
 * アクセル対象カードに対して照合する。`getMagicFreeUseSource` (magic-system.ts) の
 * アクセル版で、消費側 SSOT である `getApplicableCostOverrideCEs` (card-filter.ts) を
 * そのまま流用する（並行実装を持たない）。`cardEffectMode: "accel"` 固定で照合するため
 * (マジックの main/flash/stack とは別軸)、マジック使用コスト計算には波及しない
 * (`matchesCostCEFilterClause` の `usingEffectMode` 安全側デフォルト、card-filter.ts)。
 *
 * usageLimit は継続付与の開始制限。開始済みのCEは失効まで再消費せずに使え、
 * 別の付与は共通の使用制限で照合する。候補ごとに照合して未使用の付与も探索する。
 */
export interface AccelFreeUseSource {
  continuousEffectId?: string;
  usageLimitConsumed?: boolean;
  sourceEffect?: import("../dsl-types").Effect;
  canUseWithoutCost: boolean;
  sourceInstanceId?: string;
  sourceDefinitionId?: string;
  usageLimit?:
    | import("../model").EffectUsageLimit
    | import("../model").EffectUsageLimit[];
  limitGroupId?: string;
  effectLabel?: string;
}

export function getAccelFreeUseSource(options: {
  state: GameState;
  actingPlayerId: string;
  accelCard: CardInstance;
  accelDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): AccelFreeUseSource {
  const ces = getApplicableCostOverrideCEs(
    options.state,
    options.actingPlayerId,
    options.accelDefinition,
    {
      card: options.accelCard,
      effectiveCategories: (() => {
        const category = getEffectiveCategory(
          options.state,
          options.accelCard,
          options.accelDefinition
        );
        return category !== undefined ? [category] : [];
      })(),
      effectiveColors: getEffectiveColors(
        options.state,
        options.accelCard,
        options.accelDefinition
      ),
      effectiveTribes: getEffectiveTribes(
        options.state,
        options.accelCard,
        options.accelDefinition,
        options.getCardDefinitionById
      ),
      cardZone: options.accelCard.zone,
      cardEffectMode: "accel",
      getCardDefinitionById: options.getCardDefinitionById,
    }
  );
  for (const freeCe of ces) {
    if (freeCe.modifierAmount !== 0) continue;
    const grantingEffect =
      freeCe.provenance?.effectIndex !== undefined
        ? resolveDefinitionEffect(
            options.getCardDefinitionById(
              freeCe.provenance.effectSourceDefinitionId ??
                freeCe.sourceDefinitionId
            ),
            freeCe.provenance.effectIndex,
            freeCe.provenance.definitionPath
          )
        : undefined;
    const effectLabel = `accel_cost_override:${freeCe.provenance?.effectIndex ?? "external"}`;
    if (
      !freeCe.usageLimitConsumed &&
      grantingEffect?.usageLimit &&
      !canUseEffectByUsageLimit({
        state: options.state,
        sourceInstanceId: freeCe.sourceInstanceId,
        sourceDefinitionId: freeCe.sourceDefinitionId,
        sourceEffect: grantingEffect,
        getCardDefinitionById: options.getCardDefinitionById,
        effectLabel,
        usageLimit: grantingEffect.usageLimit,
        ...(grantingEffect.limitGroupId
          ? { groupId: grantingEffect.limitGroupId }
          : {}),
      })
    )
      continue;
    return {
      continuousEffectId: freeCe.effectId,
      usageLimitConsumed: freeCe.usageLimitConsumed === true,
      canUseWithoutCost: true,
      sourceInstanceId: freeCe.sourceInstanceId,
      sourceDefinitionId: freeCe.sourceDefinitionId,
      ...(grantingEffect ? { sourceEffect: grantingEffect } : {}),
      ...(grantingEffect?.usageLimit !== undefined
        ? { usageLimit: grantingEffect.usageLimit }
        : {}),
      ...(grantingEffect?.limitGroupId !== undefined
        ? { limitGroupId: grantingEffect.limitGroupId }
        : {}),
      effectLabel,
    };
  }
  return { canUseWithoutCost: false };
}

/** 同じ継続付与は一度だけ開始する。再生成された別CEは通常の使用制限を再確認する。 */
export function startAccelCostOverride(
  options: Parameters<typeof getAccelFreeUseSource>[0] & {
    expectedSourceInstanceId: string | undefined;
  }
): GameState {
  const source = getAccelFreeUseSource(options);
  if (
    !source.canUseWithoutCost ||
    source.sourceInstanceId !== options.expectedSourceInstanceId ||
    !source.sourceInstanceId ||
    !source.sourceDefinitionId ||
    !source.continuousEffectId
  ) {
    throw new Error("Accel cost override is no longer available");
  }
  if (source.usageLimitConsumed || !source.usageLimit) return options.state;
  const state = recordEffectUsageIfLimited({
    state: options.state,
    sourceInstanceId: source.sourceInstanceId,
    sourceDefinitionId: source.sourceDefinitionId,
    effectLabel: source.effectLabel!,
    usageLimit: source.usageLimit,
    ...(source.limitGroupId ? { groupId: source.limitGroupId } : {}),
  });
  return {
    ...state,
    activeContinuousEffects: state.activeContinuousEffects.map((ce) =>
      ce.effectId === source.continuousEffectId
        ? { ...ce, usageLimitConsumed: true }
        : ce
    ),
  };
}

/**
 * ENGINE-accel-tribe-cost-override: 「アクセルのコストを0にできる」cost_override CE
 * (`getAccelFreeUseSource`) が適用されたときの reduction。baseline (通常軽減計算) から
 * additionalCost/additionalCostModifiers のみ引き継ぎ reducedCost を強制0にする
 * (`createNoCostMagicReduction`、magic-system.ts と対称)。
 */
function createNoCostAccelChangeReduction(
  cost: number,
  baseline: ReductionResult
): ReductionResult {
  return {
    printedCost: cost,
    totalReduction: cost,
    satisfiedReductionSymbolCount: 0,
    requiredReductionSymbolCount: baseline.requiredReductionSymbolCount,
    reducedCost: 0,
    additionalCost: baseline.additionalCost,
    finalCost: Math.max(0, baseline.additionalCost),
    reductionBreakdown: [],
    fieldSymbolSources: [],
    additionalCostModifiers: baseline.additionalCostModifiers,
  };
}

// ─── アクセル ───

export interface AccelActionResult {
  state: GameState;
  chainId: string;
  reduction: ReductionResult;
}

export interface UseAccelCardAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  cardInstanceId: string;
  accelData: AccelData;
  paymentSources: readonly CardCostPaymentSource[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  targetInstanceIds?: string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  coreShootDistribution?: Record<string, number>;
  coreShootSoulCoreInstanceId?: string;
  /**
   * ENGINE-accel-tribe-cost-override: cost_override CE (amount=0) による無料使用
   * (`getAccelFreeUseSource`/`UseAccelLegalAction.costMode==="free"`)。true のとき
   * 通常の symbol 軽減計算を無視し reducedCost を強制0にする
   * (`resolveMagicReduction` withoutCost、magic-system.ts と対称)。
   */
  withoutCost?: boolean;
}

function createAccelChainId(
  state: GameState,
  actingPlayerId: string,
  instanceId: string
): string {
  return `accel:${state.turnNumber}:${actingPlayerId}:${state.step}:${instanceId}`;
}

function moveCardToInUse(
  state: GameState,
  instanceId: string,
  chainId: string,
  prefix: string
): GameState {
  state.log.push(`${prefix}:in-use:${chainId}:${instanceId}`);
  return moveCardZone(state, instanceId, "in_use", undefined);
}

function moveCardToSetAside(
  state: GameState,
  instanceId: string,
  chainId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  state.log.push(`accel:set-aside:${chainId}:${instanceId}`);
  // 手元にある間に発揮する continuous 効果 (BSTH08.5-M11 等) は、
  // cleanup で hand -> set_aside へ移った直後に登録する必要がある。通常の
  // action 後の再評価まで待つと、その中間 state が invariant を満たさない。
  return recomputeAndRebuildContinuousEffectsForSources(
    moveCardZone(state, instanceId, "set_aside", "accel-card"),
    getCardDefinitionById,
    [instanceId]
  );
}

function moveCardToTrash(
  state: GameState,
  instanceId: string,
  chainId: string,
  prefix: string
): GameState {
  state.log.push(`${prefix}:trash:${chainId}:${instanceId}`);
  return moveCardZone(state, instanceId, "trash", `${prefix}-card`);
}

function hasPendingAccelCleanupBlockers(
  state: GameState,
  chainId: string,
  cardInstanceId: string,
  options: { includePendingLeaves?: boolean } = {}
): boolean {
  const includePendingLeaves = options.includePendingLeaves ?? true;
  const matchesChain = (candidate: string | null | undefined): boolean =>
    typeof candidate === "string" && isChainAtOrUnder(candidate, chainId);
  const matchesStackChain = (stack: ActiveStack | null | undefined): boolean =>
    stack !== null &&
    stack !== undefined &&
    (matchesChain(stack.chainId) ||
      matchesStackChain(stack.previousPendingStackAction));
  const matchesUseAccelOracle = (
    pending: GameState["pendingTriggeredEffects"][number]
  ): boolean =>
    pending.mechanic?.kind === "oracle" &&
    pending.mechanic.triggerKind === "use_accel" &&
    pending.mechanic.triggerCardInstanceId === cardInstanceId;
  return (
    state.pendingTriggeredEffects.some((effect) =>
      matchesChain(effect.chainId)
    ) ||
    state.pendingTriggeredEffects.some(matchesUseAccelOracle) ||
    (state.pendingEffectCompletions ?? []).some((effect) =>
      matchesChain(effect.chainId)
    ) ||
    state.pendingDeferredTriggeredEffects.some((effect) =>
      matchesChain(effect.chainId)
    ) ||
    state.pendingPrivateDeclarations.some((decl) =>
      matchesChain(decl.chainId)
    ) ||
    state.pendingChangeCleanupChoice !== null ||
    (includePendingLeaves &&
      state.pendingLeaveEntities.some((pendingLeave) =>
        matchesChain(pendingLeave.chainId)
      )) ||
    hasOutstandingEffectResolutionContinuation({
      ...state,
      pendingStackCascade: null,
    }) ||
    matchesStackChain(state.stackWindow?.pendingStackAction) ||
    matchesStackChain(state.preDeclarationStackWindow?.pendingStackAction) ||
    matchesStackChain(state.activeAttack?.flashWindowState?.pendingStackAction)
  );
}

function hasPendingDescendantLeaves(
  state: GameState,
  chainId: string
): boolean {
  return state.pendingLeaveEntities.some(
    (pendingLeave) =>
      pendingLeave.chainId !== chainId &&
      isChainAtOrUnder(pendingLeave.chainId, chainId)
  );
}

function getCleanupScopedPendingLeaveChainIds(
  state: GameState,
  cleanups: readonly PendingAccelCleanup[]
): string[] {
  const chainIds = new Set<string>();
  for (const pendingLeave of state.pendingLeaveEntities) {
    if (
      cleanups.some((cleanup) =>
        isChainAtOrUnder(pendingLeave.chainId, cleanup.chainId)
      )
    ) {
      chainIds.add(pendingLeave.chainId);
    }
  }
  return [...chainIds].sort((a, b) => b.length - a.length);
}

function queueOrRunAccelCleanup(options: {
  state: GameState;
  cardInstanceId: string;
  chainId: string;
  outcome: "set_aside" | "trash";
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState {
  if (
    !hasPendingAccelCleanupBlockers(
      options.state,
      options.chainId,
      options.cardInstanceId
    )
  ) {
    return options.outcome === "trash"
      ? moveCardToTrash(
          options.state,
          options.cardInstanceId,
          options.chainId,
          "accel"
        )
      : moveCardToSetAside(
          options.state,
          options.cardInstanceId,
          options.chainId,
          options.getCardDefinitionById
        );
  }

  const pendingAccelCleanups = options.state.pendingAccelCleanups ?? [];
  if (
    pendingAccelCleanups.some(
      (cleanup) =>
        cleanup.chainId === options.chainId &&
        cleanup.cardInstanceId === options.cardInstanceId
    )
  ) {
    return options.state;
  }

  return {
    ...options.state,
    pendingAccelCleanups: [
      ...pendingAccelCleanups,
      {
        chainId: options.chainId,
        cardInstanceId: options.cardInstanceId,
        outcome: options.outcome,
      },
    ],
    log: [
      ...options.state.log,
      `accel:cleanup-pending:${options.chainId}:${options.cardInstanceId}:${options.outcome}`,
    ],
  };
}

function runChangeCleanup(options: {
  state: GameState;
  cardInstanceId: string;
  chainId: string;
  outcome: "trash" | "swap";
  swapTargetInstanceId?: string;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  changeData: ChangeData;
}): GameState {
  if (options.outcome === "swap" && options.swapTargetInstanceId) {
    const changeCard = getCardById(options.state, options.cardInstanceId);
    const changeCardDef = changeCard
      ? options.getCardDefinitionById(changeCard.definitionId)
      : undefined;
    const validSwapTargets = getChangeSwapCandidates({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      swapCondition: options.changeData.swapCondition,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(changeCardDef ? { changeCardDef } : {}),
    });
    if (validSwapTargets.includes(options.swapTargetInstanceId)) {
      return executeSpiritHandSwap(
        options.state,
        options.cardInstanceId,
        options.swapTargetInstanceId,
        options.chainId,
        options.actingPlayerId,
        options.getCardDefinitionById,
        options.changeData
      );
    }
    return moveCardToTrash(
      {
        ...options.state,
        log: [
          ...options.state.log,
          `change:swap-target-invalid:${options.chainId}:${options.swapTargetInstanceId}`,
        ],
      },
      options.cardInstanceId,
      options.chainId,
      "change"
    );
  }
  return moveCardToTrash(
    options.state,
    options.cardInstanceId,
    options.chainId,
    "change"
  );
}

function queueChangeCleanupChoice(options: {
  state: GameState;
  cardInstanceId: string;
  chainId: string;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  changeData: ChangeData;
}): GameState {
  if (
    options.state.pendingChangeCleanupChoice?.chainId === options.chainId &&
    options.state.pendingChangeCleanupChoice.cardInstanceId ===
      options.cardInstanceId
  ) {
    return options.state;
  }

  const changeCard = getCardById(options.state, options.cardInstanceId);
  const changeCardDef = changeCard
    ? options.getCardDefinitionById(changeCard.definitionId)
    : undefined;
  const swapCandidateInstanceIds = getChangeSwapCandidates({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    swapCondition: options.changeData.swapCondition,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(changeCardDef ? { changeCardDef } : {}),
  });

  if (swapCandidateInstanceIds.length === 0) {
    return moveCardToTrash(
      options.state,
      options.cardInstanceId,
      options.chainId,
      "change"
    );
  }

  return {
    ...options.state,
    pendingChangeCleanupChoice: {
      pendingId: `change-cleanup:${options.chainId}:${options.cardInstanceId}`,
      chainId: options.chainId,
      cardInstanceId: options.cardInstanceId,
      sourceDefinitionId: changeCard?.definitionId ?? "dsl-unknown",
      actingPlayerId: options.actingPlayerId,
      changeData: options.changeData,
      swapCandidateInstanceIds,
    },
    log: [
      ...options.state.log,
      `change:cleanup-choice-pending:${options.chainId}:${options.cardInstanceId}:candidates=${swapCandidateInstanceIds.join(",")}`,
    ],
  };
}

function queueOrRunChangeCleanup(options: {
  state: GameState;
  cardInstanceId: string;
  chainId: string;
  outcome: "trash" | "swap" | "choice";
  swapTargetInstanceId?: string;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  changeData: ChangeData;
}): GameState {
  if (
    !hasPendingAccelCleanupBlockers(
      options.state,
      options.chainId,
      options.cardInstanceId
    )
  ) {
    if (options.outcome === "choice") {
      return queueChangeCleanupChoice(options);
    }
    return runChangeCleanup({
      ...options,
      outcome: options.outcome,
    });
  }

  const pendingAccelCleanups = options.state.pendingAccelCleanups ?? [];
  if (
    pendingAccelCleanups.some(
      (cleanup) =>
        (cleanup.kind ?? "accel") === "change" &&
        cleanup.chainId === options.chainId &&
        cleanup.cardInstanceId === options.cardInstanceId
    )
  ) {
    return options.state;
  }

  const cleanup: PendingAccelCleanup =
    options.outcome === "choice"
      ? {
          kind: "change",
          chainId: options.chainId,
          cardInstanceId: options.cardInstanceId,
          outcome: "choice",
          actingPlayerId: options.actingPlayerId,
          changeData: options.changeData,
        }
      : options.outcome === "swap" && options.swapTargetInstanceId
        ? {
            kind: "change",
            chainId: options.chainId,
            cardInstanceId: options.cardInstanceId,
            outcome: "swap",
            swapTargetInstanceId: options.swapTargetInstanceId,
            actingPlayerId: options.actingPlayerId,
            changeData: options.changeData,
          }
        : {
            kind: "change",
            chainId: options.chainId,
            cardInstanceId: options.cardInstanceId,
            outcome: "trash",
            changeData: options.changeData,
          };

  return {
    ...options.state,
    pendingAccelCleanups: [...pendingAccelCleanups, cleanup],
    log: [
      ...options.state.log,
      `change:cleanup-pending:${options.chainId}:${options.cardInstanceId}:${cleanup.outcome}`,
    ],
  };
}

export function resolvePendingChangeCleanupChoice(options: {
  state: GameState;
  pendingId: string;
  outcome: "trash" | "swap";
  swapTargetInstanceId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState {
  const pending = options.state.pendingChangeCleanupChoice;
  if (!pending || pending.pendingId !== options.pendingId) {
    throw new Error(`No pending change cleanup choice: ${options.pendingId}`);
  }
  const card = getCardById(options.state, pending.cardInstanceId);
  if (!card) {
    throw new Error(`Change cleanup card not found: ${pending.cardInstanceId}`);
  }
  const stateWithoutPending: GameState = {
    ...options.state,
    pendingChangeCleanupChoice: null,
  };
  if (options.outcome === "swap") {
    const swapTargetInstanceId = options.swapTargetInstanceId;
    if (!swapTargetInstanceId) {
      throw new Error("Change cleanup swap target is required");
    }
    if (!pending.swapCandidateInstanceIds.includes(swapTargetInstanceId)) {
      throw new Error(
        `Change cleanup swap target ${swapTargetInstanceId} is not a candidate`
      );
    }
    return runChangeCleanup({
      state: stateWithoutPending,
      cardInstanceId: pending.cardInstanceId,
      chainId: pending.chainId,
      outcome: "swap",
      swapTargetInstanceId,
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      changeData: pending.changeData,
    });
  }
  return runChangeCleanup({
    state: stateWithoutPending,
    cardInstanceId: pending.cardInstanceId,
    chainId: pending.chainId,
    outcome: "trash",
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    changeData: pending.changeData,
  });
}

export function finalizePendingAccelCleanups(
  state: GameState,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined
): GameState {
  const pendingAccelCleanups = state.pendingAccelCleanups ?? [];
  if (pendingAccelCleanups.length === 0) return state;

  let currentState = state;
  const flushedChainIds = new Set<string>();
  for (const chainId of getCleanupScopedPendingLeaveChainIds(
    currentState,
    pendingAccelCleanups
  )) {
    if (flushedChainIds.has(chainId)) continue;
    if (hasPendingDescendantLeaves(currentState, chainId)) {
      continue;
    }
    currentState = flushPendingLeavesAndCollectReactions({
      state: currentState,
      chainId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    flushedChainIds.add(chainId);
  }

  const cleanupsByDeepestChainFirst = [...pendingAccelCleanups].sort(
    (a, b) => b.chainId.length - a.chainId.length
  );
  for (const cleanup of cleanupsByDeepestChainFirst) {
    if (flushedChainIds.has(cleanup.chainId)) continue;
    if (
      hasPendingDescendantLeaves(currentState, cleanup.chainId) ||
      hasPendingAccelCleanupBlockers(
        currentState,
        cleanup.chainId,
        cleanup.cardInstanceId,
        { includePendingLeaves: false }
      )
    ) {
      continue;
    }
    currentState = flushPendingLeavesAndCollectReactions({
      state: currentState,
      chainId: cleanup.chainId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    flushedChainIds.add(cleanup.chainId);
  }
  const remaining: PendingAccelCleanup[] = [];

  for (const cleanup of pendingAccelCleanups) {
    if (
      hasPendingAccelCleanupBlockers(
        currentState,
        cleanup.chainId,
        cleanup.cardInstanceId
      )
    ) {
      remaining.push(cleanup);
      continue;
    }
    const card = getCardById(currentState, cleanup.cardInstanceId);
    if (!card || card.zone !== "in_use") {
      continue;
    }
    if (cleanup.kind === "change") {
      if (cleanup.outcome === "choice") {
        currentState = queueChangeCleanupChoice({
          state: currentState,
          cardInstanceId: cleanup.cardInstanceId,
          chainId: cleanup.chainId,
          actingPlayerId: cleanup.actingPlayerId,
          getCardDefinitionById,
          changeData: cleanup.changeData,
        });
        continue;
      }
      currentState = runChangeCleanup({
        state: currentState,
        cardInstanceId: cleanup.cardInstanceId,
        chainId: cleanup.chainId,
        outcome: cleanup.outcome,
        ...(cleanup.outcome === "swap"
          ? {
              swapTargetInstanceId: cleanup.swapTargetInstanceId,
              actingPlayerId: cleanup.actingPlayerId,
            }
          : { actingPlayerId: card.controllerPlayerId }),
        getCardDefinitionById,
        changeData: cleanup.changeData,
      });
      continue;
    }
    currentState =
      cleanup.outcome === "trash"
        ? moveCardToTrash(
            currentState,
            cleanup.cardInstanceId,
            cleanup.chainId,
            "accel"
          )
        : moveCardToSetAside(
            currentState,
            cleanup.cardInstanceId,
            cleanup.chainId,
            getCardDefinitionById
          );
  }

  return {
    ...currentState,
    pendingAccelCleanups: remaining,
  };
}

export function useAccelCardAsAction(
  options: UseAccelCardAsActionOptions
): AccelActionResult {
  const card = getCardInstanceOrThrow(
    options.state,
    options.cardInstanceId,
    "Unknown accel card"
  );
  const definition = getCardDefinitionOrThrow(
    card.definitionId,
    options.getCardDefinitionById
  );

  if (card.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Accel card is not controlled by ${options.actingPlayerId}`
    );
  }
  if (
    !isInHandForOwnEffect(
      options.state,
      card,
      options.actingPlayerId,
      options.getCardDefinitionById
    )
  ) {
    throw new Error(
      `Accel card must be in hand (not set_aside): ${card.instanceId}`
    );
  }
  if (!definition.accelData) {
    throw new Error(`Card does not have accelData: ${definition.cardNo}`);
  }

  const { accelData } = options;
  const chainId = createAccelChainId(
    options.state,
    options.actingPlayerId,
    card.instanceId
  );

  const baselineReduction = calculateAccelChangeReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cost: accelData.cost,
    reductionSymbols: accelData.reduction,
    useKind: "accel",
    sourceInstanceId: card.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const reduction = options.withoutCost
    ? createNoCostAccelChangeReduction(accelData.cost, baselineReduction)
    : baselineReduction;

  assertMatchingPaymentAmount(reduction, options.paymentSources);

  // ① declare
  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `accel:declare:${chainId}:${card.instanceId}:${definition.cardNo}`,
      `accel:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  // ② hand → in_use
  currentState = moveCardToInUse(
    currentState,
    card.instanceId,
    chainId,
    "accel"
  );

  // ③ cost payment
  const stateBeforeCostPayment = currentState;
  const stateAfterPayments = applyCardCostPayments({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const stateAfterVanishTriggers = collectAccelChangeCostPaymentVanishTriggers({
    beforeState: stateBeforeCostPayment,
    afterState: stateAfterPayments,
    chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  currentState = {
    ...stateAfterVanishTriggers,
    log: [
      ...stateAfterVanishTriggers.log,
      `accel:cost-paid:${chainId}:${options.actingPlayerId}:${getTotalPaymentAmount(options.paymentSources)}`,
    ],
  };

  // ④ resolve effects (using accelData.effects)
  const startLogs = [
    `accel:targets:${chainId}:${(options.targetInstanceIds ?? []).join(",")}`,
    `accel:resolve-main:start:${chainId}`,
  ];
  const endLogs = [
    `accel:resolve-main:end:${chainId}`,
    `accel:resolve-derived:end:${chainId}`,
  ];

  currentState = runActionMainResolution({
    state: currentState,
    chainId,
    context: {
      chainId,
      actingPlayerId: options.actingPlayerId,
      magicCard: card,
      magicDefinition: {
        ...definition,
        // アクセル効果を effects として渡す
        effects: accelData.effects,
      },
      targetInstanceIds: [...(options.targetInstanceIds ?? [])],
      reduction,
      sourceCard: card,
      isAccelData: true,
      promptUnresolvedChoice: true,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(options.coreShootDistribution
        ? { coreShootDistribution: options.coreShootDistribution }
        : {}),
      ...(options.coreShootSoulCoreInstanceId
        ? { coreShootSoulCoreInstanceId: options.coreShootSoulCoreInstanceId }
        : {}),
    },
    startLogs,
    endLogs,
  });

  // アクセル使用時の神託チェック。cleanup は神託 pending を待ってから行う。
  currentState = checkAndQueueOracleChoices(
    currentState,
    card.instanceId,
    "use_accel",
    options.getCardDefinitionById,
    chainId
  );

  // ⑤ cleanup: 効果成功 → 手元(set_aside) / 条件不成立 → トラッシュ
  // 全アクセル効果の条件が不成立の場合はトラッシュ行き
  const allConditionsUnmet =
    (accelData.effects?.length ?? 0) > 0 &&
    accelData.effects!.every(
      (eff) =>
        eff.condition &&
        eff.condition.length > 0 &&
        !evaluateCondition(
          currentState,
          eff.condition,
          card.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )
    );
  currentState = queueOrRunAccelCleanup({
    state: currentState,
    cardInstanceId: card.instanceId,
    chainId,
    outcome: allConditionsUnmet ? "trash" : "set_aside",
    getCardDefinitionById: options.getCardDefinitionById,
  });
  currentState = finalizePendingAccelCleanups(
    currentState,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): 非スタックコンテキスト
  // (即時解決) 経路でもアクセル完全解決後に非バースト「効果を発揮したとき」観測を発火する。
  // resolveDeferredAccelStack (deferred stack 経路) と対称。allConditionsUnmet
  // (08b_accel-change-zero-counter.md:19「効果未発揮扱い」) では発火しない。
  if (!allConditionsUnmet) {
    currentState = queueEffectActivationTriggers({
      chainId: chainId,
      state: currentState,
      activatorPlayerId: options.actingPlayerId,
      relatedInstanceId: card.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  return {
    state: currentState,
    chainId,
    reduction,
  };
}

/**
 * フラッシュコンテキストでアクセルを使用する（スタック窓を開く場合）。
 * 宣言+コスト支払いまでを行い、解決は deferred stack に委ねる。
 */
export function useAccelCardInFlashContextAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  cardInstanceId: string;
  accelData: AccelData;
  paymentSources: readonly CardCostPaymentSource[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  targetInstanceIds?: string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  /** ENGINE-accel-tribe-cost-override: `UseAccelCardAsActionOptions.withoutCost` と対称。 */
  withoutCost?: boolean;
}): { state: GameState; activeStack: ActiveStack } {
  const card = getCardInstanceOrThrow(
    options.state,
    options.cardInstanceId,
    "Unknown accel card"
  );
  const definition = getCardDefinitionOrThrow(
    card.definitionId,
    options.getCardDefinitionById
  );

  if (card.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Accel card is not controlled by ${options.actingPlayerId}`
    );
  }
  if (
    !isInHandForOwnEffect(
      options.state,
      card,
      options.actingPlayerId,
      options.getCardDefinitionById
    )
  ) {
    throw new Error(`Accel card must be in hand: ${card.instanceId}`);
  }
  const activationZone = "hand" as const;

  const chainId = createAccelChainId(
    options.state,
    options.actingPlayerId,
    card.instanceId
  );
  const baselineReduction = calculateAccelChangeReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cost: options.accelData.cost,
    reductionSymbols: options.accelData.reduction,
    useKind: "accel",
    sourceInstanceId: card.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const reduction = options.withoutCost
    ? createNoCostAccelChangeReduction(
        options.accelData.cost,
        baselineReduction
      )
    : baselineReduction;

  assertMatchingPaymentAmount(reduction, options.paymentSources);

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `accel:declare:${chainId}:${card.instanceId}:${definition.cardNo}`,
      `accel:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  currentState = moveCardToInUse(
    currentState,
    card.instanceId,
    chainId,
    "accel"
  );

  const stateBeforeCostPayment = currentState;
  const stateAfterPayments = applyCardCostPayments({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const stateAfterVanishTriggers = collectAccelChangeCostPaymentVanishTriggers({
    beforeState: stateBeforeCostPayment,
    afterState: stateAfterPayments,
    chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  currentState = {
    ...stateAfterVanishTriggers,
    log: [
      ...stateAfterVanishTriggers.log,
      `accel:cost-paid:${chainId}:${options.actingPlayerId}:${getTotalPaymentAmount(options.paymentSources)}`,
    ],
  };
  if (options.accelData.timing === "flash") {
    currentState = queueFlashUsedTriggers({
      chainId: chainId,
      state: currentState,
      flashSourceInstanceId: card.instanceId,
      userPlayerId: options.actingPlayerId,
      flashSourceFromZone: card.zone,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  const accelNegatePreventionLevel = resolveDynamicStackNegatePreventionLevel({
    state: currentState,
    sourceInstanceId: card.instanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const accelPreventionLevel = deriveFirstAccelChangeEffectPreventionLevel(
    options.accelData.effects
  );
  const activeStack: ActiveStack = {
    stackId: `stack:${chainId}`,
    actionKind: "accel",
    chainId,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: card.instanceId,
    cardDefinitionId: card.definitionId,
    targetInstanceIds: [...(options.targetInstanceIds ?? [])],
    ...(options.chosenLifeCoreKind !== undefined
      ? { chosenLifeCoreKind: options.chosenLifeCoreKind }
      : {}),
    targetEffectFilterTags: options.targetEffectFilterTags ?? ["general"],
    suppressionEffectDescriptor: deriveAccelChangeSuppressionEffectDescriptor({
      sourceDefinitionId: card.definitionId,
      sourceKind: getEffectDescriptorSourceKindForPrintedCategory(
        definition.printedCategory
      ),
      keyword: "accel",
      effects: options.accelData.effects,
    }),
    reducedCost: reduction.reducedCost,
    totalReduction: reduction.totalReduction,
    costForFilter: reduction.effectiveCost ?? reduction.printedCost,
    chosenTiming: options.accelData.timing,
    activationLabel: options.accelData.timing,
    sourceActivationZone: activationZone,
    ...(card.zone === "deck" ? { sourcePhysicalZone: "deck" as const } : {}),
    ...(accelNegatePreventionLevel !== undefined
      ? { negatePreventionLevel: accelNegatePreventionLevel }
      : {}),
    ...(accelPreventionLevel !== undefined
      ? { preventionLevel: accelPreventionLevel }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  return { state: currentState, activeStack };
}

/**
 * Deferred accel stack の解決。スタック窓が閉じた後に呼ばれる。
 */
export function resolveDeferredAccelStack(options: {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}): GameState {
  const { activeStack } = options;
  const card = getCardById(options.state, activeStack.cardInstanceId);
  if (!card)
    throw new Error(
      `Deferred accel card not found: ${activeStack.cardInstanceId}`
    );

  const definition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  if (!definition)
    throw new Error(`Unknown card definition: ${activeStack.cardDefinitionId}`);
  if (!definition.accelData)
    throw new Error(`Card does not have accelData: ${definition.cardNo}`);

  if (activeStack.isNullified) {
    let currentState = {
      ...options.state,
      log: [
        ...options.state.log,
        `accel:nullified:${activeStack.chainId}:${activeStack.cardInstanceId}`,
      ],
    };
    currentState = checkAndQueueOracleChoices(
      currentState,
      activeStack.cardInstanceId,
      "use_accel",
      options.getCardDefinitionById,
      activeStack.chainId
    );
    currentState = queueOrRunAccelCleanup({
      state: currentState,
      cardInstanceId: activeStack.cardInstanceId,
      chainId: activeStack.chainId,
      outcome: "trash",
      getCardDefinitionById: options.getCardDefinitionById,
    });
    return finalizePendingAccelCleanups(
      currentState,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
  }

  const reducedCost = activeStack.reducedCost ?? 0;
  const reduction: ReductionResult = {
    printedCost: definition.accelData.cost,
    totalReduction: activeStack.totalReduction ?? 0,
    satisfiedReductionSymbolCount:
      activeStack.satisfiedReductionSymbolCount ?? 0,
    requiredReductionSymbolCount: activeStack.requiredReductionSymbolCount ?? 0,
    reducedCost,
    additionalCost: 0,
    finalCost: reducedCost,
    reductionBreakdown: [],
    fieldSymbolSources: [],
    additionalCostModifiers: [],
  };

  const startLogs = [
    `accel:targets:${activeStack.chainId}:${activeStack.targetInstanceIds.join(",")}`,
    `accel:resolve-main:start:${activeStack.chainId}`,
  ];
  const endLogs = [
    `accel:resolve-main:end:${activeStack.chainId}`,
    `accel:resolve-derived:end:${activeStack.chainId}`,
  ];

  let currentState = runActionMainResolution({
    state: options.state,
    chainId: activeStack.chainId,
    context: {
      chainId: activeStack.chainId,
      actingPlayerId: activeStack.actingPlayerId,
      magicCard: card,
      magicDefinition: {
        ...definition,
        effects: definition.accelData.effects,
      },
      targetInstanceIds: [...activeStack.targetInstanceIds],
      reduction,
      sourceCard: card,
      isAccelData: true,
      promptUnresolvedChoice: true,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    },
    startLogs,
    endLogs,
  });

  // アクセル使用時の神託チェック。cleanup は神託 pending を待ってから行う。
  currentState = checkAndQueueOracleChoices(
    currentState,
    activeStack.cardInstanceId,
    "use_accel",
    options.getCardDefinitionById,
    activeStack.chainId
  );

  // 効果成功 → 手元(set_aside) / 条件不成立 → トラッシュ
  const deferredAllUnmet =
    (definition.accelData.effects?.length ?? 0) > 0 &&
    definition.accelData.effects!.every(
      (eff) =>
        eff.condition &&
        eff.condition.length > 0 &&
        !evaluateCondition(
          currentState,
          eff.condition,
          activeStack.cardInstanceId,
          activeStack.actingPlayerId,
          options.getCardDefinitionById
        )
    );
  currentState = queueOrRunAccelCleanup({
    state: currentState,
    cardInstanceId: activeStack.cardInstanceId,
    chainId: activeStack.chainId,
    outcome: deferredAllUnmet ? "trash" : "set_aside",
    getCardDefinitionById: options.getCardDefinitionById,
  });

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): アクセルが
  // 完全解決した後に非バースト「効果を発揮したとき」観測を発火する。deferredAllUnmet
  // (全効果条件不成立) は 08b_accel-change-zero-counter.md:19「効果未発揮扱い」の
  // 裁定により「発揮した」に該当しないため、この経路では発火しない。
  if (deferredAllUnmet) {
    return currentState;
  }
  return queueEffectActivationTriggers({
    chainId: activeStack.chainId,
    state: currentState,
    activatorPlayerId: activeStack.actingPlayerId,
    relatedInstanceId: activeStack.cardInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

// ─── チェンジ ───

export interface ChangeActionResult {
  state: GameState;
  chainId: string;
  reduction: ReductionResult;
}

export interface UseChangeCardAsActionOptions {
  state: GameState;
  actingPlayerId: string;
  cardInstanceId: string;
  changeData: ChangeData;
  paymentSources: readonly CardCostPaymentSource[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
  targetInstanceIds?: string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
  coreShootDistribution?: Record<string, number>;
  coreShootSoulCoreInstanceId?: string;
}

function createChangeChainId(
  state: GameState,
  actingPlayerId: string,
  instanceId: string
): string {
  return `change:${state.turnNumber}:${actingPlayerId}:${state.step}:${instanceId}`;
}

/**
 * チェンジの入れ替え条件にマッチするフィールドスピリットを列挙。
 * `changeCardDef` (入れ替えを行うチェンジカード自身の定義) は BSDB01-CX01 host
 * exclusive-lock (SSOT isExcludedByHostExclusiveLock、advent/brave-combine 側と共有)
 * の除外判定に使う。省略時は安全側 (=保護中なら常に除外) に倒す。
 */
export function getChangeSwapCandidates(options: {
  state: GameState;
  actingPlayerId: string;
  swapCondition: ChangeSwapCondition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  changeCardDef?: CardDefinition;
}): string[] {
  const candidates: string[] = [];
  const { swapCondition } = options;
  for (const card of options.state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== options.actingPlayerId) continue;

    const def = options.getCardDefinitionById(card.definitionId);
    if (!def) continue;

    // スピリットのみ（アルティメット、ネクサス、ブレイヴ単体は不可）
    if (def.printedCategory !== "spirit") continue;

    // 合体ブレイヴは除外（attachedToInstanceId が設定されているもの）
    if (card.attachedToInstanceId !== null) continue;

    // 魂状態は除外
    const isSoulState = options.state.players.some((p) =>
      p.soulStateInstanceIds.includes(card.instanceId)
    );
    if (isSoulState) continue;

    if (
      swapCondition.adventState === "advented" &&
      adventSourceIdsOf(card).length === 0
    )
      continue;

    if (
      isExcludedByHostExclusiveLock(
        options.state,
        card,
        options.changeCardDef,
        options.getCardDefinitionById
      )
    )
      continue;

    // 色条件 (P3-33: treat_as_color CE 反映)
    if (swapCondition.colors && swapCondition.colors.length > 0) {
      const effColors = getEffectiveColors(options.state, card, def);
      if (!effColors.some((c) => swapCondition.colors!.includes(c))) continue;
    }

    // 系統条件
    if (swapCondition.tribes && swapCondition.tribes.length > 0) {
      if (!matchesTribes(def.tribe, swapCondition)) continue;
    }

    // 最大コスト条件
    if (swapCondition.maxCost !== undefined) {
      if (def.cost > swapCondition.maxCost) continue;
    }

    candidates.push(card.instanceId);
  }
  return candidates;
}

function transferNamedAdventSourcesOnChangeSwap(options: {
  state: GameState;
  swapTargetInstanceId: string;
  changeCardInstanceId: string;
  transfer: ChangeData["transferAdventSourcesOnSwap"] | undefined;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  chainId: string;
}): GameState {
  const transfer = options.transfer;
  if (!transfer || transfer.cardNames.length === 0) return options.state;
  const swapTarget = getCardById(options.state, options.swapTargetInstanceId);
  const changeCard = getCardById(options.state, options.changeCardInstanceId);
  if (!swapTarget || !changeCard) return options.state;

  const moving: UnderCardEntry[] = [];
  const remaining: UnderCardEntry[] = [];
  const leavingWithSwapTarget: string[] = [];
  for (const entry of swapTarget.underCards) {
    if (entry.role !== "advent_source") {
      remaining.push(entry);
      continue;
    }
    const underCard = getCardById(options.state, entry.cardInstanceId);
    const underDef = underCard
      ? options.getCardDefinitionById(underCard.definitionId)
      : undefined;
    if (underDef && matchesCardName(underDef.name, transfer.cardNames)) {
      moving.push(entry);
    } else {
      leavingWithSwapTarget.push(entry.cardInstanceId);
    }
  }
  if (moving.length === 0 && leavingWithSwapTarget.length === 0)
    return options.state;

  let nextState: GameState = replaceCardInstances(
    {
      ...options.state,
      log: [
        ...options.state.log,
        `change:swap-transfer-advent-sources:${options.chainId}:${moving
          .map((entry) => entry.cardInstanceId)
          .join(",")}`,
      ],
    },
    options.state.cardInstances.map((card) => {
      if (card.instanceId === options.swapTargetInstanceId) {
        return { ...card, underCards: remaining };
      }
      if (card.instanceId === options.changeCardInstanceId) {
        return { ...card, underCards: [...card.underCards, ...moving] };
      }
      return card;
    })
  );

  for (const sourceId of leavingWithSwapTarget) {
    const sourceCard = getCardById(nextState, sourceId);
    if (!sourceCard) continue;
    const sourceDef = options.getCardDefinitionById(sourceCard.definitionId);
    const zoneRoleName = sourceDef
      ? `${sourceDef.printedCategory}-card`
      : sourceCard.zoneRoleName;
    nextState = moveCardZone(
      nextState,
      sourceId,
      requireCardZone(swapTarget.zone),
      zoneRoleName
    );
    nextState = updateCard(nextState, sourceId, (card) =>
      applyFaceDownPolicyOnZoneChange(
        {
          ...card,
          normalCoreCount: 0,
          exhaustState: "recovered" as const,
          attachedToInstanceId: null,
          attachedChildrenIds: [],
          underCards: [],
        },
        swapTarget.zone
      )
    );
    nextState.log.push(
      `change:swap-advent-source-follows-target:${options.chainId}:${sourceId}:${swapTarget.zone}`
    );
  }

  return nextState;
}

function hasDurationScope(ce: ContinuousEffect): boolean {
  const scope = ce.duration.scope;
  return (
    scope === "turn" ||
    scope === "battle" ||
    scope === "attack" ||
    scope === "step"
  );
}

function retargetChangeInheritedContinuousEffects(
  effects: readonly ContinuousEffect[],
  swapTargetInstanceId: string,
  changeCardInstanceId: string
): ContinuousEffect[] {
  return effects
    .map((ce) => {
      if (ce.targetInstanceId === swapTargetInstanceId) {
        if (hasDurationScope(ce)) {
          return { ...ce, targetInstanceId: changeCardInstanceId };
        }
        return null;
      }
      return ce;
    })
    .filter((ce): ce is ContinuousEffect => ce !== null);
}

function resolveChangeSwapBraveIds(options: {
  state: GameState;
  swapTarget: CardInstance;
  changeCard: CardInstance;
  changeDef: CardDefinition;
  attachedBraveIds: readonly string[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): {
  validBraveIds: string[];
  detachedBraveIds: string[];
} {
  let validBraveIds = [...options.attachedBraveIds];
  let changed: boolean;
  do {
    const simulatedHost: CardInstance = {
      ...options.changeCard,
      zone: "field",
      zoneRoleName: "spirit",
      attachedChildrenIds: validBraveIds,
    };
    const simulatedState: GameState = replaceCardInstances(
      {
        ...options.state,
        activeContinuousEffects: retargetChangeInheritedContinuousEffects(
          options.state.activeContinuousEffects,
          options.swapTarget.instanceId,
          options.changeCard.instanceId
        ),
      },
      options.state.cardInstances.map((card) => {
        if (card.instanceId === options.changeCard.instanceId) {
          return simulatedHost;
        }
        if (validBraveIds.includes(card.instanceId)) {
          return {
            ...card,
            attachedToInstanceId: options.changeCard.instanceId,
          };
        }
        return card;
      })
    );
    const nextValidBraveIds = validBraveIds.filter((braveId) => {
      const braveCard = getCardById(simulatedState, braveId);
      const braveDef = braveCard
        ? options.getCardDefinitionById(braveCard.definitionId)
        : undefined;
      if (!braveCard || !braveDef) return false;
      if (
        braveDef.braveCondition &&
        !matchesBraveConditionForCard({
          condition: braveDef.braveCondition,
          state: simulatedState,
          card: simulatedHost,
          definition: options.changeDef,
          getCardDefinitionById: options.getCardDefinitionById,
          excludeBraveInstanceId: braveId,
          categoryEvaluation: "brave_host",
        })
      ) {
        return false;
      }
      return true;
    });
    changed = nextValidBraveIds.length !== validBraveIds.length;
    validBraveIds = nextValidBraveIds;
  } while (changed);

  const validBraveIdSet = new Set(validBraveIds);
  return {
    validBraveIds,
    detachedBraveIds: options.attachedBraveIds.filter(
      (braveId) => !validBraveIdSet.has(braveId)
    ),
  };
}

/**
 * チェンジの入れ替え処理。
 * - フィールドのスピリットを手札に戻す（手札増加扱いではない）
 * - チェンジカードを回復状態でフィールドへ（召喚イベント不発火）
 * - バトル中の場合は BattleEntity を切り替え
 */
export function executeSpiritHandSwap(
  state: GameState,
  changeCardInstanceId: string,
  swapTargetInstanceId: string,
  chainId: string,
  actingPlayerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  changeData: Pick<ChangeData, "transferAdventSourcesOnSwap"> = {},
  enterRecovered = true
): GameState {
  const changeCard = getCardById(state, changeCardInstanceId);
  const swapTarget = getCardById(state, swapTargetInstanceId);
  if (!changeCard || !swapTarget) {
    throw new Error(
      `Change swap target not found: change=${changeCardInstanceId} swap=${swapTargetInstanceId}`
    );
  }

  const targetDef = getCardDefinitionById(swapTarget.definitionId);
  if (!targetDef) {
    throw new Error(
      `Unknown definition for swap target: ${swapTarget.definitionId}`
    );
  }

  const attachedBraveIds = Array.from(
    new Set([
      ...swapTarget.attachedChildrenIds,
      ...state.cardInstances
        .filter(
          (c) =>
            c.attachedToInstanceId === swapTargetInstanceId &&
            c.zone === "field"
        )
        .map((c) => c.instanceId),
    ])
  );

  let currentState: GameState = {
    ...state,
    log: [
      ...state.log,
      `change:swap:${chainId}:${changeCardInstanceId}→field:${swapTargetInstanceId}→hand`,
    ],
  };

  const changeDef = getCardDefinitionById(changeCard.definitionId);
  if (!changeDef) {
    throw new Error(
      `Unknown definition for change card: ${changeCard.definitionId}`
    );
  }
  const { validBraveIds, detachedBraveIds } = resolveChangeSwapBraveIds({
    state: currentState,
    swapTarget,
    changeCard,
    changeDef,
    attachedBraveIds,
    getCardDefinitionById,
  });

  // Q5846: 回復指定がなければ、場のスピリットの疲労状態を引き継ぐ。
  const incomingExhaustState = enterRecovered
    ? "recovered"
    : swapTarget.exhaustState;
  // 入替先を field へ。チェンジでは in_use、通常の入替では hand から移動する。
  currentState = moveCardZone(
    currentState,
    changeCardInstanceId,
    "field",
    "spirit"
  );
  currentState = updateCard(currentState, changeCardInstanceId, (c) => ({
    ...c,
    exhaustState: incomingExhaustState,
    attachedChildrenIds: validBraveIds,
  }));

  // BS35 Q5847: 入れ替え対象に置かれていたコアはそのままチェンジカードに置く。
  const targetCoreCount = swapTarget.normalCoreCount;
  if (targetCoreCount > 0) {
    currentState = moveNormalCores(
      currentState,
      { kind: "card", instanceId: swapTargetInstanceId },
      { kind: "card", instanceId: changeCardInstanceId },
      targetCoreCount
    );
    currentState.log.push(
      `change:swap-cores-to-change-card:${chainId}:${targetCoreCount}`
    );
  }
  const soulOwners = currentState.players.filter(
    (player) =>
      player.soulCoreLocation?.kind === "card" &&
      player.soulCoreLocation.instanceId === swapTargetInstanceId
  );
  for (const soulOwner of soulOwners) {
    currentState = moveSoulCore(
      currentState,
      soulOwner.id,
      { kind: "card", instanceId: swapTargetInstanceId },
      { kind: "card", instanceId: changeCardInstanceId }
    );
    currentState.log.push(
      `change:swap-soul-core-to-change-card:${chainId}:${soulOwner.id}`
    );
  }
  const remainingSoulCoreCount =
    getCardById(currentState, swapTargetInstanceId)?.soulCoreCount ?? 0;
  if (remainingSoulCoreCount > 0) {
    currentState = moveSoulCore(
      currentState,
      swapTarget.controllerPlayerId,
      { kind: "card", instanceId: swapTargetInstanceId },
      { kind: "card", instanceId: changeCardInstanceId },
      remainingSoulCoreCount
    );
    currentState.log.push(
      `change:swap-soul-cores-to-change-card:${chainId}:${swapTarget.controllerPlayerId}:${remainingSoulCoreCount}`
    );
  }

  // スワップ対象を手札へ（手札増加扱いではない → handIncreasedBy は加算しない）
  // moveCardZone が handCount を自動で +1 する
  currentState = moveCardZone(
    currentState,
    swapTargetInstanceId,
    "hand",
    "spirit-card"
  );
  currentState = recordHandExchange(state, currentState);
  currentState = updateCard(currentState, swapTargetInstanceId, (c) => ({
    ...c,
    exhaustState: "recovered" as const,
    attachedToInstanceId: null,
    attachedChildrenIds: [],
  }));

  // BS35 Q5849: ブレイヴは合体条件を満たす限り合体したまま。
  for (const braveId of validBraveIds) {
    currentState = updateCard(currentState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: changeCardInstanceId,
      exhaustState: incomingExhaustState,
    }));
  }
  for (const braveId of detachedBraveIds) {
    currentState = updateCard(currentState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: null,
      exhaustState: resolveSeparatedBraveExhaustState(
        c,
        getCardDefinitionById(c.definitionId),
        { ...swapTarget, exhaustState: incomingExhaustState }
      ),
    }));
  }
  currentState = transferNamedAdventSourcesOnChangeSwap({
    state: currentState,
    swapTargetInstanceId,
    changeCardInstanceId,
    transfer: changeData.transferAdventSourcesOnSwap,
    getCardDefinitionById,
    chainId,
  });
  currentState = {
    ...currentState,
    activeContinuousEffects: retargetChangeInheritedContinuousEffects(
      currentState.activeContinuousEffects,
      swapTargetInstanceId,
      changeCardInstanceId
    ),
  };

  // バトル中の入れ替え: BattleEntity を切り替え
  if (currentState.activeAttack) {
    const detachedBraveIdSet = new Set(detachedBraveIds);
    currentState = {
      ...currentState,
      battleEntities: currentState.battleEntities.map((entity) => {
        if (entity.memberInstanceIds.includes(swapTargetInstanceId)) {
          const newMembers = entity.memberInstanceIds
            .map((id) =>
              id === swapTargetInstanceId ? changeCardInstanceId : id
            )
            .filter((id) => !detachedBraveIdSet.has(id));
          return {
            ...entity,
            memberInstanceIds: Array.from(new Set(newMembers)),
          };
        }
        return entity;
      }),
    };
    currentState = recomputeBattleEntityBp(currentState, getCardDefinitionById);
  }

  return currentState;
}

export function useChangeCardAsAction(
  options: UseChangeCardAsActionOptions
): ChangeActionResult {
  const card = getCardInstanceOrThrow(
    options.state,
    options.cardInstanceId,
    "Unknown change card"
  );
  const definition = getCardDefinitionOrThrow(
    card.definitionId,
    options.getCardDefinitionById
  );

  if (card.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Change card is not controlled by ${options.actingPlayerId}`
    );
  }
  if (
    !isInHandForOwnEffect(
      options.state,
      card,
      options.actingPlayerId,
      options.getCardDefinitionById
    )
  ) {
    throw new Error(`Change card must be in hand: ${card.instanceId}`);
  }
  if (!definition.changeData) {
    throw new Error(`Card does not have changeData: ${definition.cardNo}`);
  }

  const { changeData } = options;
  const chainId = createChangeChainId(
    options.state,
    options.actingPlayerId,
    card.instanceId
  );

  const reduction = calculateAccelChangeReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cost: changeData.cost,
    reductionSymbols: changeData.reduction,
    useKind: "change",
    sourceInstanceId: card.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });

  assertMatchingPaymentAmount(reduction, options.paymentSources);

  // ① declare
  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `change:declare:${chainId}:${card.instanceId}:${definition.cardNo}`,
      `change:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  // ② hand → in_use
  currentState = moveCardToInUse(
    currentState,
    card.instanceId,
    chainId,
    "change"
  );

  // ③ cost payment
  const stateBeforeCostPayment = currentState;
  const stateAfterPayments = applyCardCostPayments({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const stateAfterVanishTriggers = collectAccelChangeCostPaymentVanishTriggers({
    beforeState: stateBeforeCostPayment,
    afterState: stateAfterPayments,
    chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  currentState = {
    ...stateAfterVanishTriggers,
    log: [
      ...stateAfterVanishTriggers.log,
      `change:cost-paid:${chainId}:${options.actingPlayerId}:${getTotalPaymentAmount(options.paymentSources)}`,
    ],
  };

  // ④ resolve effects (using changeData.effects)
  const startLogs = [
    `change:targets:${chainId}:${(options.targetInstanceIds ?? []).join(",")}`,
    `change:resolve-main:start:${chainId}`,
  ];
  const endLogs = [
    `change:resolve-main:end:${chainId}`,
    `change:resolve-derived:end:${chainId}`,
  ];

  currentState = runActionMainResolution({
    state: currentState,
    chainId,
    context: {
      chainId,
      actingPlayerId: options.actingPlayerId,
      magicCard: card,
      magicDefinition: {
        ...definition,
        effects: changeData.effects,
      },
      isChangeData: true,
      promptUnresolvedChoice: true,
      targetInstanceIds: [...(options.targetInstanceIds ?? [])],
      reduction,
      sourceCard: card,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(options.coreShootDistribution
        ? { coreShootDistribution: options.coreShootDistribution }
        : {}),
      ...(options.coreShootSoulCoreInstanceId
        ? { coreShootSoulCoreInstanceId: options.coreShootSoulCoreInstanceId }
        : {}),
    },
    startLogs,
    endLogs,
  });

  currentState = flushPendingLeavesAndCollectReactions({
    state: currentState,
    chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  // ⑤ cleanup: 入れ替え or 破棄。continuation / 誘発 / pending leave が残る場合は chain close まで遅延。
  currentState = queueOrRunChangeCleanup({
    state: currentState,
    cardInstanceId: card.instanceId,
    chainId,
    outcome: "choice",
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    changeData: options.changeData,
  });

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): 非スタックコンテキスト
  // (即時解決) 経路でもチェンジ完全解決後に非バースト「効果を発揮したとき」観測を発火する。
  // resolveDeferredChangeStack (deferred stack 経路) と対称。
  currentState = queueEffectActivationTriggers({
    chainId: chainId,
    state: currentState,
    activatorPlayerId: options.actingPlayerId,
    relatedInstanceId: card.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  return {
    state: currentState,
    chainId,
    reduction,
  };
}

/**
 * フラッシュコンテキストでチェンジを使用する（スタック窓を開く場合）。
 */
export function useChangeCardInFlashContextAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  cardInstanceId: string;
  changeData: ChangeData;
  paymentSources: readonly CardCostPaymentSource[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  targetInstanceIds?: string[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  targetEffectFilterTags?: readonly EffectFilterTag[];
}): { state: GameState; activeStack: ActiveStack } {
  const card = getCardInstanceOrThrow(
    options.state,
    options.cardInstanceId,
    "Unknown change card"
  );
  const definition = getCardDefinitionOrThrow(
    card.definitionId,
    options.getCardDefinitionById
  );

  if (card.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Change card is not controlled by ${options.actingPlayerId}`
    );
  }
  if (
    !isInHandForOwnEffect(
      options.state,
      card,
      options.actingPlayerId,
      options.getCardDefinitionById
    )
  ) {
    throw new Error(`Change card must be in hand: ${card.instanceId}`);
  }
  const activationZone = "hand" as const;

  const chainId = createChangeChainId(
    options.state,
    options.actingPlayerId,
    card.instanceId
  );
  const reduction = calculateAccelChangeReduction({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    cost: options.changeData.cost,
    reductionSymbols: options.changeData.reduction,
    useKind: "change",
    sourceInstanceId: card.instanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });

  assertMatchingPaymentAmount(reduction, options.paymentSources);

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `change:declare:${chainId}:${card.instanceId}:${definition.cardNo}`,
      `change:reduction:${chainId}:${reduction.reducedCost}:${reduction.totalReduction}`,
    ],
  };

  currentState = moveCardToInUse(
    currentState,
    card.instanceId,
    chainId,
    "change"
  );

  const stateBeforeCostPayment = currentState;
  const stateAfterPayments = applyCardCostPayments({
    state: currentState,
    actingPlayerId: options.actingPlayerId,
    chainId,
    paymentSources: options.paymentSources,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const stateAfterVanishTriggers = collectAccelChangeCostPaymentVanishTriggers({
    beforeState: stateBeforeCostPayment,
    afterState: stateAfterPayments,
    chainId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  currentState = {
    ...stateAfterVanishTriggers,
    log: [
      ...stateAfterVanishTriggers.log,
      `change:cost-paid:${chainId}:${options.actingPlayerId}:${getTotalPaymentAmount(options.paymentSources)}`,
    ],
  };
  currentState = queueFlashUsedTriggers({
    chainId: chainId,
    state: currentState,
    flashSourceInstanceId: card.instanceId,
    userPlayerId: options.actingPlayerId,
    flashSourceFromZone: card.zone,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  const changeNegatePreventionLevel = resolveDynamicStackNegatePreventionLevel({
    state: currentState,
    sourceInstanceId: card.instanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const changePreventionLevel = deriveFirstAccelChangeEffectPreventionLevel(
    options.changeData.effects
  );
  const activeStack: ActiveStack = {
    stackId: `stack:${chainId}`,
    actionKind: "change",
    chainId,
    actingPlayerId: options.actingPlayerId,
    cardInstanceId: card.instanceId,
    cardDefinitionId: card.definitionId,
    targetInstanceIds: [...(options.targetInstanceIds ?? [])],
    ...(options.chosenLifeCoreKind !== undefined
      ? { chosenLifeCoreKind: options.chosenLifeCoreKind }
      : {}),
    targetEffectFilterTags: options.targetEffectFilterTags ?? ["general"],
    suppressionEffectDescriptor: deriveAccelChangeSuppressionEffectDescriptor({
      sourceDefinitionId: card.definitionId,
      sourceKind: getEffectDescriptorSourceKindForPrintedCategory(
        definition.printedCategory
      ),
      keyword: "change",
      effects: options.changeData.effects,
    }),
    reducedCost: reduction.reducedCost,
    totalReduction: reduction.totalReduction,
    costForFilter: reduction.effectiveCost ?? reduction.printedCost,
    chosenTiming: "flash",
    activationLabel: "flash",
    sourceActivationZone: activationZone,
    ...(card.zone === "deck" ? { sourcePhysicalZone: "deck" as const } : {}),
    ...(changeNegatePreventionLevel !== undefined
      ? { negatePreventionLevel: changeNegatePreventionLevel }
      : {}),
    ...(changePreventionLevel !== undefined
      ? { preventionLevel: changePreventionLevel }
      : {}),
    previousResponseSourcePlayerId: null,
    previousPendingStackAction: null,
  };

  return { state: currentState, activeStack };
}

/**
 * Deferred change stack の解決。
 */
export function resolveDeferredChangeStack(options: {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
  getRegisteredBattleImmediateEffectActions?: BattleImmediateEffectActionRegistrationLookup;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}): GameState {
  const { activeStack } = options;
  const card = getCardById(options.state, activeStack.cardInstanceId);
  if (!card)
    throw new Error(
      `Deferred change card not found: ${activeStack.cardInstanceId}`
    );

  const definition = options.getCardDefinitionById(
    activeStack.cardDefinitionId
  );
  if (!definition)
    throw new Error(`Unknown card definition: ${activeStack.cardDefinitionId}`);
  if (!definition.changeData)
    throw new Error(`Card does not have changeData: ${definition.cardNo}`);

  if (activeStack.isNullified) {
    const currentState = flushPendingLeavesAndCollectReactions({
      state: {
        ...options.state,
        log: [
          ...options.state.log,
          `change:nullified:${activeStack.chainId}:${activeStack.cardInstanceId}`,
        ],
      },
      chainId: activeStack.chainId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
    return queueOrRunChangeCleanup({
      state: currentState,
      cardInstanceId: activeStack.cardInstanceId,
      chainId: activeStack.chainId,
      outcome: "trash",
      actingPlayerId: activeStack.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      changeData: definition.changeData,
    });
  }

  const reducedCost = activeStack.reducedCost ?? 0;
  const reduction: ReductionResult = {
    printedCost: definition.changeData.cost,
    totalReduction: activeStack.totalReduction ?? 0,
    satisfiedReductionSymbolCount:
      activeStack.satisfiedReductionSymbolCount ?? 0,
    requiredReductionSymbolCount: activeStack.requiredReductionSymbolCount ?? 0,
    reducedCost,
    additionalCost: 0,
    finalCost: reducedCost,
    reductionBreakdown: [],
    fieldSymbolSources: [],
    additionalCostModifiers: [],
  };

  const startLogs = [
    `change:targets:${activeStack.chainId}:${activeStack.targetInstanceIds.join(",")}`,
    `change:resolve-main:start:${activeStack.chainId}`,
  ];
  const endLogs = [
    `change:resolve-main:end:${activeStack.chainId}`,
    `change:resolve-derived:end:${activeStack.chainId}`,
  ];

  let currentState = runActionMainResolution({
    state: options.state,
    chainId: activeStack.chainId,
    context: {
      chainId: activeStack.chainId,
      actingPlayerId: activeStack.actingPlayerId,
      magicCard: card,
      magicDefinition: {
        ...definition,
        effects: definition.changeData.effects,
      },
      isChangeData: true,
      promptUnresolvedChoice: true,
      targetInstanceIds: [...activeStack.targetInstanceIds],
      reduction,
      sourceCard: card,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    },
    startLogs,
    endLogs,
  });

  currentState = flushPendingLeavesAndCollectReactions({
    state: currentState,
    chainId: activeStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  // 入れ替え or 破棄。continuation / 誘発 / pending leave が残る場合は chain close まで遅延。
  currentState = queueOrRunChangeCleanup({
    state: currentState,
    cardInstanceId: activeStack.cardInstanceId,
    chainId: activeStack.chainId,
    outcome: "choice",
    actingPlayerId: activeStack.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    changeData: definition.changeData,
  });

  // ENGINE-effect-activation-card-event-observer (BSTH09-TR01(A)): チェンジが
  // 完全解決した後に非バースト「効果を発揮したとき」観測を発火する。
  return queueEffectActivationTriggers({
    chainId: activeStack.chainId,
    state: currentState,
    activatorPlayerId: activeStack.actingPlayerId,
    relatedInstanceId: activeStack.cardInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}
