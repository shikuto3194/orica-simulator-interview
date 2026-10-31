// State-grant クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// 回復/疲労/場残留/ライフ増減/攻撃ステップ制御/追加攻撃/追加ターンの状態付与実行。

import { replaceCardInstances } from "../zone/card-instance-state";
import {
  finalizeBattleEndScopeExpirations,
  getBattleEndDeferralChainId,
  hasPendingBattleEndFinalizeBlockers,
} from "../battle/battle-end-scope-finalize";
import { canFireBattleEndDeferral } from "../battle/battle-end-deferral-gate";
import {
  getEffectiveColors,
  getEffectiveTribes,
  hasActiveEndRestriction,
  hasActiveOpponentEndRestriction,
  hasForceAttackStepEndAfterFirstBattle,
  refundEffectUsageIfRecorded,
  removeExpiredContinuousEffects,
} from "../legal/legal-actions-shared";
import {
  resolveLifeDamage,
  updateCard,
  getTotalCoresOnCardById,
  recoverExhaustState,
} from "../core/core-system";
import {
  createBattleResolutionEntitySnapshot,
  getBattleEntityBattleEndMemberInstanceIds,
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
  recomputeBattleEntityBp,
  resetBattleEntitiesAfterAttackEnd,
} from "../battle/battle-shared";
import { computeLifeReductionAmountBonus } from "./structured-modifiers";
import {
  getAdditionalCosts,
  matchesCardFilter,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import { recomputeAndRebuildBattleStateContinuousEffects } from "./continuous-effect-rebuild";
import type {
  CardDefinition,
  CardInstance,
  BattleResolutionParticipantSnapshot,
  ContinuousEffect,
  EffectTarget,
  ExhaustState,
  GameState,
  LifeDamageAction,
  LifeFillAction,
  PendingAttackStepEndBlockedRetry,
  PendingAttackStepEndFinalization,
  PendingBattleEndDeferral,
  PendingImmediateBattleEnd,
  PendingTurnEndExhaustDowngrade,
  PendingTurnEndFinalization,
  RecordedEffectUsage,
  RecordedEffectUsageEntry,
  StayOnFieldAction,
  TimingScope,
} from "../model";
import type { SerializedStepContext } from "../step-execution-context";
import {
  collectUnderCardScopeIds,
  matchesColorCount,
  hasActivePendingStackNegateRequests,
} from "../model";
import type { CardFilter } from "../dsl-types";
import { getEffectiveSoulStateIds } from "../mechanics/magic-compatible-soul-state";
import {
  isCardExhaustionForbidden,
  synchronizeBraveExhaustion,
} from "../mechanics/brave-spirit-state-recovery";
import { hasPendingLeaveResolutionChoice } from "../pending-state-guards";
import { resolveCardExhaustAffect } from "./effect-affect-adapter";
import { isCardRecoveryRestricted } from "./recovery-restriction";
import type { PendingTriggeredEffectContext } from "./structured-effect-interpreter";
import { evaluateApplicability } from "./effect-applicability";
import { evaluateCondition } from "./structured-condition-eval";
import { advanceStep, enterTurn } from "../turn-system";
import { captureInterruptedTurn, nextTurnNumber } from "../turn-context";
import {
  flushPendingLeavesAndQueueReactions,
  queueBattleEndTriggers,
  type BurstActionRegistrationLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "./trigger-system";
import { hasOutstandingEffectResolutionContinuation } from "../state-based-actions";
import { collectExpiredEffectSuppressionSourceIds } from "./expired-effect-suppression";
import { stabilizeSourcesReleasedByEffectSuppressionExpiry } from "./effect-suppression-expiry-stabilization";
import {
  applyLifeGainReplacementReplace,
  createPendingLifeGainReplacementChoice,
  getLifeGainReplacementCE,
  getLifeGainPreventionCE,
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import type { TargetLockBypassProfile } from "./target-affect-gate";

export type AttackStepEndBlockedRetryGate = (args: {
  state: GameState;
  pending: PendingAttackStepEndFinalization;
  retry: PendingAttackStepEndBlockedRetry;
  stepContext: SerializedStepContext;
}) => boolean;

function hasResolvablePendingBurst(state: GameState): boolean {
  return state.pendingBurstChecks.some((pending) => {
    if (
      state.revealedBurstStates.some(
        (revealed) => revealed.checkId === pending.checkId
      )
    ) {
      return true;
    }
    return state.setBurstStates.some(
      (setBurst) => setBurst.playerId === pending.actingPlayerId
    );
  });
}

function selectStayTargetsByCount<T>(items: T[], count: number): T[] {
  return count === -1 ? items : items.slice(0, count);
}

function buildStayOnFieldCardFilter(target: EffectTarget): CardFilter | null {
  const filter: CardFilter = { ...(target.filter ?? {}) };
  if (target.category !== undefined) filter.category = target.category;
  if (target.colors !== undefined) filter.colors = target.colors;
  if (target.tribes !== undefined) filter.tribes = target.tribes;
  if (target.tribesLogic !== undefined) filter.tribesLogic = target.tribesLogic;
  if (target.tribesRequired !== undefined)
    filter.tribesRequired = target.tribesRequired;
  if (target.noTribes !== undefined) filter.noTribes = target.noTribes;
  if (target.cardName !== undefined) filter.cardName = target.cardName;
  if (target.minCost !== undefined) filter.minCost = target.minCost;
  if (target.maxCost !== undefined) filter.maxCost = target.maxCost;
  if (target.costBasis !== undefined) filter.costBasis = target.costBasis;
  if (target.combined !== undefined) filter.combined = target.combined;
  if (target.maxBp !== undefined) filter.maxBp = target.maxBp;
  if (target.maxCores !== undefined) filter.maxCores = target.maxCores;
  if (target.minCores !== undefined) filter.minCores = target.minCores;
  if (target.includeSoulState === true) filter.soulState = "include";
  if (target.grandwalkerOnly === true) {
    filter.targetsGrandwalker = "only";
  } else if (target.includeGrandwalker === true) {
    filter.targetsGrandwalker = true;
  }
  if (target.includeGrandstone === true) filter.targetsGrandstone = true;
  return Object.keys(filter).length > 0 ? filter : null;
}

function resolveStayOnFieldTargets(
  state: GameState,
  actingPlayerId: string,
  action: StayOnFieldAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[]
): CardInstance[] {
  const pendingLeaveInstanceIds = new Set(
    state.pendingLeaveEntities.map((pendingLeave) => pendingLeave.instanceId)
  );

  if (action.target.selfCard && sourceInstanceId) {
    const self = state.cardInstances.find(
      (c) =>
        c.instanceId === sourceInstanceId &&
        c.zone === "field" &&
        pendingLeaveInstanceIds.has(c.instanceId)
    );
    return self ? [self] : [];
  }

  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const filter = buildStayOnFieldCardFilter(action.target);
  const sourceCard = sourceInstanceId
    ? state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
    : undefined;
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  const soulStateIds =
    action.target.includeSoulState === true
      ? null
      : getEffectiveSoulStateIds(state, getCardDefinitionById);
  const underCardIds = collectUnderCardScopeIds(state);

  const matchesStayTargetFilters = (card: CardInstance): boolean => {
    const definition = getCardDefinitionById(card.definitionId);
    if (definition === undefined) return false;
    if (
      filter !== null &&
      !matchesCardFilter(card, definition, filter, {
        state,
        ...(soulStateIds ? { soulStateIds } : {}),
        underCardIds,
        ...(sourceDefinition ? { sourceDefinition } : {}),
        battleEntities: state.battleEntities,
        fieldCategoryContext: true,
        getCardDefinitionById,
        effectiveColors: getEffectiveColors(state, card, definition),
        effectiveBp: getCombinedUnitBp(
          state,
          card,
          definition,
          getCardDefinitionById
        ),
        coreCount: getTotalCoresOnCardById(state, card.instanceId),
        effectiveLevel: getEffectiveLevel(
          state,
          card,
          definition,
          getCardDefinitionById
        ),
        additionalCosts: getAdditionalCosts(state, card.instanceId),
        effectiveSymbolCount: getCombinedUnitSymbolCount(
          state,
          card,
          definition,
          getCardDefinitionById
        ),
        evaluateCondition: (condition, conditionSourceId, conditionActorId) =>
          evaluateCondition(
            state,
            condition,
            conditionSourceId,
            conditionActorId,
            getCardDefinitionById
          ),
        evaluateApplicability: (applicability, applicabilitySourceId) =>
          evaluateApplicability(
            state,
            applicability,
            applicabilitySourceId,
            getCardDefinitionById
          ),
      })
    ) {
      return false;
    }
    const effectiveColors = getEffectiveColors(state, card, definition);
    if (
      (action.target.minColorCount !== undefined ||
        action.target.maxColorCount !== undefined) &&
      !matchesColorCount(
        effectiveColors,
        action.target.minColorCount,
        action.target.maxColorCount
      )
    ) {
      return false;
    }
    return true;
  };

  if (preSelectedIds && preSelectedIds.length > 0) {
    const idSet = new Set(preSelectedIds);
    const selected = state.cardInstances.filter(
      (card) =>
        idSet.has(card.instanceId) &&
        card.zone === "field" &&
        pendingLeaveInstanceIds.has(card.instanceId) &&
        matchesStayTargetFilters(card)
    );
    if (selected.length > 0) return selected;
  }

  const candidates = state.cardInstances.filter((card) => {
    if (card.controllerPlayerId !== targetPlayerId) return false;
    if (card.zone !== "field") return false;
    if (!pendingLeaveInstanceIds.has(card.instanceId)) return false;
    return matchesStayTargetFilters(card);
  });

  return selectStayTargetsByCount(candidates, action.target.count);
}

export function executeRecover(
  state: GameState,
  actingPlayerId: string,
  target: EffectTarget,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  recoveryMode: "one_step" | "fully" = "one_step"
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, target.player, state);

  const toRecover = resolveTargetCards(
    state,
    targetPlayerId,
    target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    (card) =>
      card.exhaustState !== "recovered" &&
      !isCardRecoveryRestricted(
        state,
        card,
        getCardDefinitionById,
        recoveryMode
      ),
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId,
    { allowPendingLeaveSelfCard: true }
  );
  if (toRecover.length === 0) return state;

  state.log.push(...toRecover.map((c) => `effect:recover:${c.instanceId}`));
  return synchronizeBraveExhaustion(
    replaceCardInstances(
      {
        ...state,
      },
      state.cardInstances.map((c) => {
        if (!toRecover.some((t) => t.instanceId === c.instanceId)) return c;
        const exhaustState =
          recoveryMode === "fully"
            ? "recovered"
            : recoverExhaustState(c.exhaustState);
        return {
          ...c,
          exhaustState,
          ...(exhaustState === "recovered"
            ? { exhaustedByUnpreventableEffect: false }
            : {}),
        };
      })
    ),
    getCardDefinitionById
  );
}

/**
 * engine-exhaust-provenance-skip-refresh (BSLH01-C04): 対象カードに「次のリフレッシュ
 * ステップでは回復できない」1回限定マーカー (`CardInstance.skipNextRefreshRecovery`) を
 * 付与する。`executeRecover` と同じ target 解決/防止レベル判定パイプラインを再利用し、
 * 回復状態では「疲労したカード」に該当しないため付与しない。
 */
export function executePreventNextRecovery(
  state: GameState,
  actingPlayerId: string,
  target: EffectTarget,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, target.player, state);

  const toMark = resolveTargetCards(
    state,
    targetPlayerId,
    target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    (card) => card.exhaustState !== "recovered",
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId
  );
  if (toMark.length === 0) return state;

  state.log.push(
    ...toMark.map((c) => `effect:prevent_next_recovery:${c.instanceId}`)
  );
  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) =>
      toMark.some((t) => t.instanceId === c.instanceId)
        ? { ...c, skipNextRefreshRecovery: true }
        : c
    )
  );
}

export function executeExhaust(
  state: GameState,
  actingPlayerId: string,
  target: EffectTarget,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  targetState?: "exhausted" | "heavily_exhausted",
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  /** `ExhaustAction.downgradeAtTurnEnd` (BSTH11-C04)。degree:"heavy_exhaust" 時のみ意味を持つ。 */
  downgradeAtTurnEnd?: boolean,
  /** set_exhaust_state による重疲労→疲労の状態合わせ。 */
  allowDowngrade = false
): GameState {
  const resultState = targetState ?? "exhausted";
  const targetPlayerId = resolvePlayerRef(actingPlayerId, target.player, state);
  const exhaustFilter = (c: { exhaustState: string }) =>
    resultState === "heavily_exhausted"
      ? c.exhaustState !== "heavily_exhausted"
      : c.exhaustState === "recovered" ||
        (allowDowngrade && c.exhaustState === "heavily_exhausted");

  const toExhaust = resolveTargetCards(
    state,
    targetPlayerId,
    target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    exhaustFilter,
    sourcePreventionBypass,
    effectSourceInstanceId,
    effectSourceDefinitionId
  );
  if (toExhaust.length === 0) return state;
  const toExhaustAfterGate = toExhaust.filter((card) => {
    if (
      !isCardExhaustionForbidden(
        card,
        getCardDefinitionById(card.definitionId)
      ) &&
      resolveCardExhaustAffect(
        state,
        card,
        actingPlayerId,
        getCardDefinitionById,
        sourcePreventionLevel,
        sourcePreventionBypass
      ).kind === "allowed"
    ) {
      return true;
    }
    state.log.push(
      `effect:exhaust:blocked-by-resistance:${actingPlayerId}:${card.instanceId}`
    );
    return false;
  });
  if (toExhaustAfterGate.length === 0) return state;

  state.log.push(
    ...toExhaustAfterGate.map(
      (c) =>
        `effect:${resultState === "heavily_exhausted" ? "heavy_exhaust" : "exhaust"}:${c.instanceId}`
    )
  );
  const shouldScheduleDowngrade =
    downgradeAtTurnEnd === true && resultState === "heavily_exhausted";
  const newDowngrades: PendingTurnEndExhaustDowngrade[] =
    shouldScheduleDowngrade
      ? toExhaustAfterGate.map((c) => ({
          cardInstanceId: c.instanceId,
          createdAtTurn: state.turnNumber,
          fieldInstanceGeneration: c.fieldInstanceGeneration ?? 0,
        }))
      : [];
  return synchronizeBraveExhaustion(
    replaceCardInstances(
      {
        ...state,
        ...(newDowngrades.length > 0
          ? {
              pendingTurnEndExhaustDowngrades: [
                ...state.pendingTurnEndExhaustDowngrades,
                ...newDowngrades,
              ],
            }
          : {}),
      },
      state.cardInstances.map((c) =>
        toExhaustAfterGate.some((t) => t.instanceId === c.instanceId)
          ? {
              ...c,
              exhaustState: resultState,
              exhaustedByUnpreventableEffect:
                sourcePreventionLevel === "unpreventable",
            }
          : c
      )
    ),
    getCardDefinitionById
  );
}

/**
 * `pendingTurnEndExhaustDowngrades` (ExhaustAction.downgradeAtTurnEnd, BSTH11-C04) を
 * ターン終了時、同じフィールド個体を疲労状態にする。途中で回復しても適用し、
 * 離場・再登場した別個体には適用しない。予約は一度だけ消化する。
 */
export function flushPendingTurnEndExhaustDowngrades(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (state.pendingTurnEndExhaustDowngrades.length === 0) return state;
  const downgradeIds = new Set(
    state.cardInstances
      .filter(
        (card) =>
          card.zone === "field" &&
          state.pendingTurnEndExhaustDowngrades.some(
            (entry) =>
              entry.cardInstanceId === card.instanceId &&
              entry.createdAtTurn === state.turnNumber &&
              (entry.fieldInstanceGeneration ?? 0) ===
                (card.fieldInstanceGeneration ?? 0)
          )
      )
      .map((card) => card.instanceId)
  );
  state.log.push(
    ...Array.from(downgradeIds).map(
      (id) => `effect:turn-end-exhaust-downgrade:${id}`
    )
  );
  const result: GameState = replaceCardInstances(
    {
      ...state,
      pendingTurnEndExhaustDowngrades: [],
    },
    state.cardInstances.map((c) =>
      downgradeIds.has(c.instanceId) ? { ...c, exhaustState: "exhausted" } : c
    )
  );
  return getCardDefinitionById
    ? synchronizeBraveExhaustion(result, getCardDefinitionById)
    : result;
}

/**
 * 対象カードを pendingLeave から取り除き、指定の疲労状態でフィールドに残置する。
 *
 * 同じ simultaneousGroupId に属する destroy/leave_field 系の pending triggered/burst で
 * `relatedInstanceId === target.instanceId` のものは同時に撤回する
 * （破壊起因の関連トリガーが C 側残置によって不発になる例: B → C 順に解決した場合の B 不発）。
 *
 * 破壊そのものを回避する真の置換ではなく、pending leave に入った *後* に triggered で
 * 残置する用途に限定。
 */
export function executeStayOnField(
  state: GameState,
  actingPlayerId: string,
  action: StayOnFieldAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  triggerContext?: PendingTriggeredEffectContext
): GameState {
  // stay_on_field の対象は典型的には pendingLeaveKind が設定された
  // 「離脱待機中」のカード自身。標準の collectTargetCardCandidates は pendingLeave を
  // 持つカードを除外するため、ここでは zone === "field" のみで直接検索する。
  const toStay = resolveStayOnFieldTargets(
    state,
    actingPlayerId,
    action,
    getCardDefinitionById,
    sourceInstanceId,
    preSelectedIds
  );
  if (toStay.length === 0) {
    state.log.push(`effect:stay_on_field:no-targets`);
    return state;
  }

  const targetIdSet = new Set(toStay.map((c) => c.instanceId));
  // newExhaustState 省略時は現在の疲労状態を維持する（「同じ状態で残す/残せる」）。
  const newExhaustState: ExhaustState | undefined = action.newExhaustState;

  // 1. 対象を pendingLeaveEntities から除外し、cardInstance の pendingLeave* を null クリア
  //    + 疲労状態を newExhaustState に設定（省略時は据え置き）
  let nextState = state;
  for (const card of toStay) {
    nextState = updateCard(nextState, card.instanceId, (c) => ({
      ...c,
      ...(newExhaustState !== undefined
        ? { exhaustState: newExhaustState }
        : {}),
      pendingLeaveKind: null,
      pendingLeaveCause: null,
      pendingLeaveChainId: null,
      deferZoneMoveUntilChainEnd: false,
    }));
  }

  const remainingPendingLeaves = nextState.pendingLeaveEntities.filter(
    (pl) => !targetIdSet.has(pl.instanceId)
  );

  // 2. 同じ simultaneousGroupId 内の関連 pendingTriggeredEffects/pendingBurstChecks を撤回
  //    対象: relatedInstanceId が当該カード かつ eventKind ∈ {destroy, vanish, bounce, leave_field}
  const currentGroupId = triggerContext?.simultaneousGroupId;
  const DESTROY_EVENT_KINDS = new Set([
    "destroy",
    "vanish",
    "bounce",
    "leave_field",
  ]);

  const revokedPendingIds: string[] = [];
  const revokedBurstIds: string[] = [];

  let nextPendingTriggeredEffects = nextState.pendingTriggeredEffects;
  const nextPendingDeferredTriggeredEffects =
    nextState.pendingDeferredTriggeredEffects;
  let nextPendingBurstChecks = nextState.pendingBurstChecks;

  if (currentGroupId !== undefined) {
    nextPendingTriggeredEffects = nextState.pendingTriggeredEffects.filter(
      (pe) => {
        const isMatch =
          pe.simultaneousGroupId === currentGroupId &&
          pe.declaredFromPrivateZone !== true &&
          pe.relatedInstanceId !== null &&
          targetIdSet.has(pe.relatedInstanceId) &&
          DESTROY_EVENT_KINDS.has(pe.eventKind);
        if (isMatch) revokedPendingIds.push(pe.pendingId);
        return !isMatch;
      }
    );
    // deferred は宣言済み。待機状態喪失後も、不発を含む通常解決へ渡す。
    nextPendingBurstChecks = nextState.pendingBurstChecks.filter((bc) => {
      const isMatch =
        bc.simultaneousGroupId === currentGroupId &&
        bc.relatedInstanceId !== null &&
        bc.relatedInstanceId !== undefined &&
        targetIdSet.has(bc.relatedInstanceId) &&
        DESTROY_EVENT_KINDS.has(bc.eventKind as string);
      if (isMatch) revokedBurstIds.push(bc.checkId);
      return !isMatch;
    });
  }

  const logs: string[] = [
    ...toStay.map(
      (c) => `effect:stay_on_field:${c.instanceId}:${newExhaustState ?? "keep"}`
    ),
    ...revokedPendingIds.map((id) => `stay_on_field:revoke:${id}`),
    ...revokedBurstIds.map((id) => `stay_on_field:revoke_burst:${id}`),
  ];

  return {
    ...nextState,
    pendingLeaveEntities: remainingPendingLeaves,
    pendingTriggeredEffects: nextPendingTriggeredEffects,
    pendingDeferredTriggeredEffects: nextPendingDeferredTriggeredEffects,
    pendingBurstChecks: nextPendingBurstChecks,
    log: [...nextState.log, ...logs],
  };
}

export function executeLifeDamage(
  state: GameState,
  actingPlayerId: string,
  action: LifeDamageAction,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  sourceDefinitionId?: string,
  battleEndDeferralAttackId?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const cause =
    actingPlayerId !== targetPlayerId ? "opponent_effect" : "self_effect";
  const sourceCardMatchesFilter =
    sourceInstanceId && getCardDefinitionById
      ? createLifeDamageActionSourceMatcher(
          state,
          sourceInstanceId,
          sourceDefinitionId,
          getCardDefinitionById
        )
      : undefined;
  return resolveLifeDamage(
    state,
    targetPlayerId,
    action.amount +
      (cause === "opponent_effect" && action.amount > 0 && sourceInstanceId
        ? computeLifeReductionAmountBonus(
            state,
            actingPlayerId,
            sourceInstanceId
          )
        : 0),
    [],
    {
      cause: cause as "opponent_effect" | "self_effect",
      actingPlayerId,
      ...(sourceCardMatchesFilter ? { sourceCardMatchesFilter } : {}),
      ...(battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId }
        : {}),
    },
    getCardDefinitionById
  );
}

function createLifeDamageActionSourceMatcher(
  state: GameState,
  sourceInstanceId: string,
  sourceDefinitionId: string | undefined,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): ((filter: CardFilter, protectedPlayerId: string) => boolean) | undefined {
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  if (!sourceCard) return undefined;
  if (sourceCard.zone !== "field") return undefined;
  const sourceDefinition =
    (sourceDefinitionId
      ? getCardDefinitionById(sourceDefinitionId)
      : undefined) ?? getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDefinition) return undefined;
  return (filter: CardFilter, protectedPlayerId: string) => {
    if (sourceCard.controllerPlayerId === protectedPlayerId) return false;
    // core_move と同じく、保護対象はライフであり発生源カードは参照だけ。
    return matchesCardReferenceFilter(sourceCard, sourceDefinition, filter, {
      state,
      underCardIds: collectUnderCardScopeIds(state),
      effectiveColors: getEffectiveColors(state, sourceCard, sourceDefinition),
      effectiveTribes: getEffectiveTribes(
        state,
        sourceCard,
        sourceDefinition,
        getCardDefinitionById
      ),
      additionalCosts: getAdditionalCosts(state, sourceCard.instanceId),
      ...(sourceCard.zone === "field"
        ? {
            effectiveBp: getCombinedUnitBp(
              state,
              sourceCard,
              sourceDefinition,
              getCardDefinitionById
            ),
            coreCount: getTotalCoresOnCardById(state, sourceCard.instanceId),
            effectiveLevel: getEffectiveLevel(
              state,
              sourceCard,
              sourceDefinition,
              getCardDefinitionById
            ),
            effectiveSymbolCount: getCombinedUnitSymbolCount(
              state,
              sourceCard,
              sourceDefinition,
              getCardDefinitionById
            ),
          }
        : {}),
    });
  };
}

export function executeEndAttackStep(
  state: GameState,
  actingPlayerId: string,
  unaffectedByRestriction?: boolean,
  sourceInstanceId?: string,
  recordedUsage?: RecordedEffectUsage,
  blockedByOpponentRetry?: PendingAttackStepEndBlockedRetry
): GameState {
  state.log.push(`effect:end_attack_step:${actingPlayerId}`);
  // アタックステップ中でなければ何もしない
  if (state.step !== "attack") return state;
  // 「相手は効果でアタックステップを終了できない」: actingPlayerId を対象とする妨害 CE があれば、
  // この「終了する」効果は妨害を受け no-op (= 終了する側が効果を受ける)。
  // 「受けない」(R12 unaffectedByRestriction) は immune 相当として扱い、通常の妨害は
  // 受けない。ただし「この『終了できない』効果は相手の効果では防げない」
  // (preventionLevel: "unpreventable") は immune を貫通する。
  // 通常のステップ進行 (advanceStep) はこの関数を通らないため「効果で」のみ妨害される。
  if (
    hasActiveEndRestriction(
      state,
      actingPlayerId,
      ["restrict_end_attack_step", "restrict_end_step"],
      unaffectedByRestriction
    )
  ) {
    state.log.push(
      `effect:end_attack_step:blocked-by-restriction:${actingPlayerId}`
    );
    return state;
  }

  const refundableUsageEntries =
    getEndEffectRefundableUsageEntries(recordedUsage);
  const pending: PendingAttackStepEndFinalization = {
    pendingId: `attack-step-end:${state.turnNumber}:${state.pendingAttackStepEndFinalizations.length}`,
    actingPlayerId,
    sourceInstanceId: sourceInstanceId ?? actingPlayerId,
    createdAtTurn: state.turnNumber,
    ...(unaffectedByRestriction === true ? { unaffectedByRestriction } : {}),
    ...(refundableUsageEntries.length > 0 ? { refundableUsageEntries } : {}),
    ...(blockedByOpponentRetry !== undefined ? { blockedByOpponentRetry } : {}),
  };

  return {
    ...state,
    pendingAttackStepEndFinalizations: [
      ...state.pendingAttackStepEndFinalizations,
      pending,
    ],
    log: [...state.log, `effect:end_attack_step:pending:${actingPlayerId}`],
  };
}

export function executeEndTurn(
  state: GameState,
  actingPlayerId: string,
  unaffectedByRestriction?: boolean,
  sourceInstanceId?: string,
  recordedUsage?: RecordedEffectUsage
): GameState {
  state.log.push(`effect:end_turn:${actingPlayerId}`);
  if (
    hasActiveEndRestriction(
      state,
      actingPlayerId,
      ["restrict_end_turn"],
      unaffectedByRestriction
    )
  ) {
    state.log.push(`effect:end_turn:blocked-by-restriction:${actingPlayerId}`);
    return state;
  }

  const refundableUsageEntries =
    getEndEffectRefundableUsageEntries(recordedUsage);
  const pending: PendingTurnEndFinalization = {
    pendingId: `turn-end:${state.turnNumber}:${state.pendingTurnEndFinalizations.length}`,
    actingPlayerId,
    sourceInstanceId: sourceInstanceId ?? actingPlayerId,
    createdAtTurn: state.turnNumber,
    ...(unaffectedByRestriction === true ? { unaffectedByRestriction } : {}),
    ...(refundableUsageEntries.length > 0 ? { refundableUsageEntries } : {}),
  };

  return {
    ...state,
    pendingTurnEndFinalizations: [
      ...state.pendingTurnEndFinalizations,
      pending,
    ],
    log: [...state.log, `effect:end_turn:pending:${actingPlayerId}`],
  };
}

function getEndEffectRefundableUsageEntries(
  recordedUsage?: RecordedEffectUsage
): readonly RecordedEffectUsageEntry[] {
  if (!recordedUsage) return [];
  const entries: readonly RecordedEffectUsageEntry[] = [
    recordedUsage,
    ...(recordedUsage.extraRecords ?? []),
  ];
  return entries.filter((entry) => {
    const usageLimits = Array.isArray(entry.usageLimit)
      ? entry.usageLimit
      : [entry.usageLimit];
    return usageLimits.some((limit) => limit.unlessAffectedByOpponent === true);
  });
}

function hasTurnEndFinalizationBlockers(state: GameState): boolean {
  return (
    state.effectQueueEntries.length > 0 ||
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0 ||
    state.pendingBurstChecks.length > 0 ||
    state.pendingLeaveEntities.length > 0 ||
    hasPendingLeaveResolutionChoice(state) ||
    state.pendingTrashOptionalAdds.length > 0 ||
    state.pendingDeckReveal !== null ||
    state.pendingZoneSelection !== null ||
    state.pendingStepOptionalChoice !== null ||
    state.pendingStepChoice !== null ||
    state.pendingDeckRevealCountBoostChoice !== null ||
    state.pendingStepOptionalTargetSelection !== null ||
    state.pendingDrawStepCostChoice !== null ||
    state.pendingSummonCostExcludeChoice !== null ||
    state.pendingSummonCostCoreMoveChoice !== null ||
    state.pendingGroupedSummonCostOverrideChoice !== null ||
    state.pendingLifeDamageDiscardChoice !== null ||
    state.pendingLifeGainReplacementChoice !== null ||
    state.pendingCoreShootSelection !== null ||
    state.pendingEffectTargetSelection !== null ||
    state.pendingAsIfSoulCoreChoice !== null ||
    state.pendingEffectOptionalRepeatChoice !== null ||
    state.pendingEffectOptionalRepeatCountSelection !== null ||
    state.pendingBorrowedEffectChoice !== null ||
    state.pendingBorrowedEffectTargetSelection !== null ||
    state.pendingTargetedDisclosureContinuation !== null ||
    state.pendingAfterTriggersContinuations.length > 0 ||
    state.pendingPayToActCoreGate !== null ||
    state.pendingPayToActHandDiscardGate !== null ||
    state.pendingFieldMagicPreCostTrigger !== null ||
    state.pendingEnterFieldPlacement !== null ||
    state.pendingStackCascade !== null ||
    hasActivePendingStackNegateRequests(state) ||
    state.pendingBraveCombineChoice !== null ||
    state.pendingHandTrashSwapChoice !== null ||
    state.pendingFieldHandSwapChoice !== null ||
    state.pendingTenshoSummon !== null ||
    state.pendingReverseRebirthSummon !== null ||
    state.pendingStoneFlipCombine !== null ||
    state.pendingCoreSplitSelection !== null ||
    state.pendingSplitSummonChoice !== null ||
    state.pendingCoreCountSelection !== null ||
    state.pendingCountSelection !== null ||
    state.pendingDiscardSetBurstCountSelection !== null ||
    state.pendingLifeCoreSelection !== null ||
    state.pendingCoreSourceAllocation !== null ||
    state.pendingLinkAidCostSourceChoice !== null ||
    state.pendingEffectSummonCostPayment !== null ||
    state.pendingCoreDistribution !== null ||
    state.pendingChangeCleanupChoice !== null ||
    state.pendingMultiPlacement !== null ||
    state.pendingTargetRedirects.length > 0 ||
    (state.pendingAccelCleanups ?? []).length > 0 ||
    state.pendingBattleEndDeferrals.length > 0 ||
    state.pendingImmediateBattleEnds.length > 0 ||
    state.pendingBattleEndFinalizeAttackIds.length > 0 ||
    state.pendingSetAsideExitReplacementChoice !== null ||
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    state.activeAttack?.flashWindowState?.pendingStackAction != null
  );
}

function isTurnEndFinalizationRestricted(
  state: GameState,
  pending: PendingTurnEndFinalization
): boolean {
  return hasActiveEndRestriction(
    state,
    pending.actingPlayerId,
    ["restrict_end_turn"],
    pending.unaffectedByRestriction
  );
}

function isAttackStepEndFinalizationRestricted(
  state: GameState,
  pending: PendingAttackStepEndFinalization
): boolean {
  return hasActiveEndRestriction(
    state,
    pending.actingPlayerId,
    ["restrict_end_attack_step", "restrict_end_step"],
    pending.unaffectedByRestriction
  );
}

function survivesForcedBattleScopeCleanup(effect: ContinuousEffect): boolean {
  const { scope, nextBattleEnd } = effect.duration;
  if (scope !== "battle" && scope !== "attack") return true;
  // nextBattleEnd はターン境界を跨いで実際の battle_end まで生存する設計
  // (model.ts Duration.nextBattleEnd)。効果でターン終了する場合は実際のバトル終了
  // イベントを経ていないため、ここで強制的に無効化してはならない
  // (adversarial verifier round2 lens3 指摘、ENGINE-continuous-effect-duration-rewrite。
  // duration_override による scope:"turn"→"battle"+nextBattleEnd 書き換え後の CE が
  // この経路を通ると誤って除去される実害があった)。
  return nextBattleEnd === true;
}

function expireContinuousEffectsAtEffectTurnEnd(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): {
  state: GameState;
  sourcesReleasedBySuppressionExpiry: Set<string>;
} {
  const opts = getCardDefinitionById ? { getCardDefinitionById } : undefined;
  const afterTurnExpiry = removeExpiredContinuousEffects(
    state,
    { kind: "turn_end" },
    opts
  );
  const afterCurrentStepExpiry = removeExpiredContinuousEffects(
    {
      ...state,
      activeContinuousEffects: afterTurnExpiry,
    },
    {
      kind: "step_end",
      step: state.step,
      activePlayerId: state.activePlayerId,
    },
    opts
  );
  const activeContinuousEffects = afterCurrentStepExpiry.filter(
    survivesForcedBattleScopeCleanup
  );
  const afterExpiry = { ...state, activeContinuousEffects };
  if (!getCardDefinitionById) {
    return {
      state: afterExpiry,
      sourcesReleasedBySuppressionExpiry: new Set<string>(),
    };
  }
  const sourceInstanceIds = collectExpiredEffectSuppressionSourceIds(
    state,
    activeContinuousEffects,
    getCardDefinitionById
  );
  return {
    state: afterExpiry,
    sourcesReleasedBySuppressionExpiry: sourceInstanceIds,
  };
}

function refundTurnEndBlockedUsage(
  state: GameState,
  pending: PendingTurnEndFinalization | PendingAttackStepEndFinalization
): GameState {
  if (!pending.refundableUsageEntries?.length) return state;
  let current = state;
  for (const entry of pending.refundableUsageEntries) {
    current = refundEffectUsageIfRecorded({
      state: current,
      sourceInstanceId: entry.sourceInstanceId ?? pending.sourceInstanceId,
      effectLabel: entry.effectLabel,
      usageLimit: entry.usageLimit as
        | import("../model").EffectUsageLimit
        | import("../model").EffectUsageLimit[],
      ...(entry.groupId ? { groupId: entry.groupId } : {}),
      ...(entry.relatedInstanceId
        ? { relatedInstanceId: entry.relatedInstanceId }
        : {}),
      ...(entry.triggerEventScopeKey
        ? { triggerEventScopeKey: entry.triggerEventScopeKey }
        : {}),
    });
  }
  return {
    ...current,
    log: [
      ...current.log,
      `effect:usage-refund:affected-by-opponent:${pending.sourceInstanceId}`,
    ],
  };
}

function openAttackStepEndBlockedRetry(
  state: GameState,
  pending: PendingAttackStepEndFinalization,
  shouldOpenBlockedRetry?: AttackStepEndBlockedRetryGate
): GameState {
  const retry = pending.blockedByOpponentRetry;
  if (!retry || state.pendingStepOptionalChoice !== null) return state;
  const cont = retry.continuation;
  const stepContext = {
    ...cont.stepContext,
    results: {
      ...cont.stepContext.results,
      [retry.blockedStepId]: {
        stepId: retry.blockedStepId,
        affectedCardInstanceIds: [],
        succeeded: false,
        executed: true,
        blockedByOpponentEffect: true,
      },
    },
  };
  if (
    !shouldOpenBlockedRetry ||
    !shouldOpenBlockedRetry({ state, pending, retry, stepContext })
  ) {
    return state;
  }
  const continuation = { ...cont, stepContext };
  const pendingId = `pso:${cont.sourceInstanceId}:${cont.effectIndex}:${cont.stepIndex}:blocked:${pending.pendingId}`;
  return {
    ...state,
    pendingStepOptionalChoice: {
      pendingId,
      actingPlayerId: cont.actingPlayerId,
      choosingPlayerId: retry.choosingPlayerId,
      sourceInstanceId: cont.sourceInstanceId,
      sourceDefinitionId: cont.sourceDefinitionId,
      effectIndex: cont.effectIndex,
      stepIndex: cont.stepIndex,
      ...(retry.stepLabel !== undefined ? { stepLabel: retry.stepLabel } : {}),
      canExecute: true,
      continuation,
    },
    log: [
      ...state.log,
      `effect:step-optional-pending:${pendingId}:step=${cont.stepIndex}`,
    ],
  };
}

export function finalizePendingAttackStepEndFinalizations(
  state: GameState,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  shouldOpenBlockedRetry?: AttackStepEndBlockedRetryGate,
  lookups: TurnTransitionLookups = {}
): GameState {
  if (state.pendingAttackStepEndFinalizations.length === 0) return state;
  if (hasTurnEndFinalizationBlockers(state)) return state;

  let current = state;
  for (const pending of state.pendingAttackStepEndFinalizations) {
    if (isAttackStepEndFinalizationRestricted(current, pending)) {
      const blockedByOpponentEffect = hasActiveOpponentEndRestriction(
        current,
        pending.actingPlayerId,
        ["restrict_end_attack_step", "restrict_end_step"],
        pending.unaffectedByRestriction
      );
      const refunded = blockedByOpponentEffect
        ? refundTurnEndBlockedUsage(current, pending)
        : current;
      current = {
        ...refunded,
        pendingAttackStepEndFinalizations:
          refunded.pendingAttackStepEndFinalizations.filter(
            (item) => item.pendingId !== pending.pendingId
          ),
        log: [
          ...refunded.log,
          `effect:end_attack_step:blocked-by-restriction:${pending.actingPlayerId}`,
        ],
      };
      if (blockedByOpponentEffect && pending.blockedByOpponentRetry) {
        return openAttackStepEndBlockedRetry(
          current,
          pending,
          shouldOpenBlockedRetry
        );
      }
      continue;
    }

    const finalized: GameState = {
      ...current,
      window: "step_end",
      activeAttack: null,
      battleEntities: resetBattleEntitiesAfterAttackEnd(current),
      pendingAttackStepEndFinalizations: [],
      // survivesForcedBattleScopeCleanup を再利用 (SSOT): nextBattleEnd===true の CE は
      // 実際の battle_end を経ていないため、効果でアタックステップを終了する場合も
      // 強制無効化してはならない (adversarial verifier round3 lens3 指摘、
      // finalizePendingTurnEndFinalizations と同型の欠陥が姉妹関数に残存していた)。
      activeContinuousEffects: current.activeContinuousEffects.filter(
        survivesForcedBattleScopeCleanup
      ),
      log: [
        ...current.log,
        `effect:end_attack_step:finalized:${pending.actingPlayerId}`,
      ],
    };
    return advanceStep(
      finalized,
      getCardDefinitionById ?? (() => undefined),
      lookups.getRegisteredTriggeredEffectActions ?? (() => undefined),
      lookups.getRegisteredBurstActions
    );
  }

  return current;
}

export function finalizePendingTurnEndFinalizations(
  state: GameState,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): GameState {
  if (state.pendingTurnEndFinalizations.length === 0) return state;
  if (hasTurnEndFinalizationBlockers(state)) return state;

  let current = state;
  for (const pending of state.pendingTurnEndFinalizations) {
    if (isTurnEndFinalizationRestricted(current, pending)) {
      const blockedByOpponentEffect = hasActiveOpponentEndRestriction(
        current,
        pending.actingPlayerId,
        ["restrict_end_turn"],
        pending.unaffectedByRestriction
      );
      const refunded = blockedByOpponentEffect
        ? refundTurnEndBlockedUsage(current, pending)
        : current;
      current = {
        ...refunded,
        pendingTurnEndFinalizations:
          refunded.pendingTurnEndFinalizations.filter(
            (item) => item.pendingId !== pending.pendingId
          ),
        log: [
          ...refunded.log,
          `effect:end_turn:blocked-by-restriction:${pending.actingPlayerId}`,
        ],
      };
      continue;
    }

    const { state: afterExpiry, sourcesReleasedBySuppressionExpiry } =
      expireContinuousEffectsAtEffectTurnEnd(current, getCardDefinitionById);
    const finalized: GameState = replaceCardInstances(
      {
        ...afterExpiry,
        step: "end",
        window: "end_step_cleanup",
        activeAttack: null,
        battleEntities: resetBattleEntitiesAfterAttackEnd(current),
        pendingAttackStepEndFinalizations: [],
        pendingTurnEndFinalizations: [],
        pendingExtraSteps: [],
        stepContinuation: [],
        log: [
          ...current.log,
          `effect:end_turn:finalized:${pending.actingPlayerId}`,
        ],
      },
      current.cardInstances.map((card) =>
        card.divineTransformState
          ? { ...card, divineTransformState: null }
          : card
      )
    );
    if (getCardDefinitionById && sourcesReleasedBySuppressionExpiry.size > 0) {
      return stabilizeSourcesReleasedByEffectSuppressionExpiry(
        finalized,
        getCardDefinitionById,
        sourcesReleasedBySuppressionExpiry
      );
    }
    return getCardDefinitionById
      ? recomputeBattleEntityBp(finalized, getCardDefinitionById)
      : finalized;
  }

  return current;
}

export function finalizePendingEndFinalizations(
  state: GameState,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined,
  shouldOpenBlockedRetry?: AttackStepEndBlockedRetryGate,
  lookups: TurnTransitionLookups = {}
): GameState {
  const afterTurn = finalizePendingTurnEndFinalizations(
    state,
    getCardDefinitionById
  );
  return finalizePendingAttackStepEndFinalizations(
    afterTurn,
    getCardDefinitionById,
    shouldOpenBlockedRetry,
    lookups
  );
}

export function executeEndBattle(
  state: GameState,
  actingPlayerId: string,
  unaffectedByRestriction?: boolean,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions?: TriggeredEffectActionRegistrationLookup,
  resolveBattleEndDeferral?: (
    state: GameState,
    deferral: PendingBattleEndDeferral,
    wasBlocked: boolean
  ) => GameState,
  deferBattleEndEntry = false,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  state.log.push(`effect:end_battle:${actingPlayerId}`);
  const activeAttack = state.activeAttack;
  if (state.step !== "attack" || activeAttack === null) {
    state.log.push(`effect:end_battle:no-active-battle:${actingPlayerId}`);
    return state;
  }
  if (
    hasActiveEndRestriction(
      state,
      actingPlayerId,
      ["restrict_end_battle"],
      unaffectedByRestriction
    )
  ) {
    state.log.push(
      `effect:end_battle:blocked-by-restriction:${actingPlayerId}`
    );
    return state;
  }
  const shouldDeferBattleEndEntry =
    deferBattleEndEntry || hasResolvablePendingBurst(state);

  const participantInstanceIds = new Set<string>();
  const blockSideInstanceIds = new Set<string>();
  for (const entityId of activeAttack.participantEntityIds) {
    const entity = state.battleEntities.find((e) => e.entityId === entityId);
    for (const memberId of entity
      ? getBattleEntityBattleEndMemberInstanceIds(entity)
      : []) {
      participantInstanceIds.add(memberId);
    }
  }
  for (const assignment of activeAttack.blockAssignments) {
    for (const blockerEntityId of assignment.blockedByEntityIds) {
      const blocker = state.battleEntities.find(
        (e) => e.entityId === blockerEntityId
      );
      for (const memberId of blocker
        ? getBattleEntityBattleEndMemberInstanceIds(blocker)
        : []) {
        participantInstanceIds.add(memberId);
        blockSideInstanceIds.add(memberId);
      }
    }
  }

  const participantSnapshots: BattleResolutionParticipantSnapshot[] =
    activeAttack.participantEntityIds.map((entityId) => {
      const entity = state.battleEntities.find((e) => e.entityId === entityId);
      const assignment = activeAttack.blockAssignments.find(
        (a) => a.participantEntityId === entityId
      );
      const blockedBy = (assignment?.blockedByEntityIds ?? []).flatMap(
        (blockerEntityId) => {
          const blocker = state.battleEntities.find(
            (e) => e.entityId === blockerEntityId
          );
          return blocker ? [createBattleResolutionEntitySnapshot(blocker)] : [];
        }
      );
      const memberInstanceIds = entity
        ? getBattleEntityBattleEndMemberInstanceIds(entity)
        : [];
      return {
        entityId,
        memberInstanceIds,
        resolvedBp: entity?.resolvedBp ?? 0,
        resolvedSymbols: entity?.resolvedSymbols ?? [],
        blockedBy,
      };
    });

  let nextState: GameState = state;
  if (getCardDefinitionById && !shouldDeferBattleEndEntry) {
    nextState = queueBattleEndTriggers({
      state: nextState,
      participantInstanceIds: Array.from(participantInstanceIds),
      attackId: activeAttack.attackId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions,
      blockSideInstanceIds: Array.from(blockSideInstanceIds),
      ...(activeAttack.battleDestroyedRecords
        ? { destroyedRecords: activeAttack.battleDestroyedRecords }
        : {}),
    });
    nextState = fireEndBattleDeferrals(
      nextState,
      activeAttack.attackId,
      participantSnapshots,
      getCardDefinitionById,
      resolveBattleEndDeferral
    );
  }
  const pausedBattleEndDeferrals =
    !shouldDeferBattleEndEntry &&
    hasOutstandingEffectResolutionContinuation(nextState) &&
    nextState.pendingBattleEndDeferrals.some(
      (deferral) => deferral.attackId === activeAttack.attackId
    );

  const survivingFieldCardIds = new Set(
    nextState.cardInstances
      .filter((card) => card.zone === "field" && card.pendingLeaveKind === null)
      .map((card) => card.instanceId)
  );
  const nextBattleEntities = nextState.battleEntities
    .map((entity) => ({
      ...entity,
      memberInstanceIds: entity.memberInstanceIds.filter((memberId) =>
        survivingFieldCardIds.has(memberId)
      ),
      attackState: "idle" as const,
    }))
    .filter((entity) => entity.memberInstanceIds.length > 0);

  const pendingImmediateBattleEnd: PendingImmediateBattleEnd | null =
    shouldDeferBattleEndEntry || pausedBattleEndDeferrals
      ? {
          attackId: activeAttack.attackId,
          participantInstanceIds: Array.from(participantInstanceIds),
          blockSideInstanceIds: Array.from(blockSideInstanceIds),
          participantSnapshots,
          ...(activeAttack.battleDestroyedRecords
            ? { destroyedRecords: activeAttack.battleDestroyedRecords }
            : {}),
          ...(pausedBattleEndDeferrals ? { battleEndEntryStarted: true } : {}),
        }
      : null;
  let shouldDeferFinalize = hasPendingBattleEndFinalizeBlockers(
    nextState,
    activeAttack.attackId
  );

  let endedState: GameState = {
    ...nextState,
    battleEntities: nextBattleEntities,
    activeAttack: null,
    battleResolutionGroup: null,
    window: "none",
    pendingImmediateBattleEnds: pendingImmediateBattleEnd
      ? [...nextState.pendingImmediateBattleEnds, pendingImmediateBattleEnd]
      : nextState.pendingImmediateBattleEnds,
    pendingBattleEndFinalizeAttackIds:
      shouldDeferFinalize &&
      !nextState.pendingBattleEndFinalizeAttackIds.includes(
        activeAttack.attackId
      )
        ? [
            ...nextState.pendingBattleEndFinalizeAttackIds,
            activeAttack.attackId,
          ]
        : nextState.pendingBattleEndFinalizeAttackIds,
    log: [
      ...nextState.log,
      `battle:end:${activeAttack.attackId}`,
      `attack:end:${activeAttack.attackId}`,
      ...(pendingImmediateBattleEnd
        ? [`battle:end-entry:deferred:${activeAttack.attackId}`]
        : []),
      ...(shouldDeferFinalize
        ? [`battle:end-scope-finalize:deferred:${activeAttack.attackId}`]
        : []),
    ],
  };

  if (!shouldDeferFinalize && pendingImmediateBattleEnd === null) {
    endedState = flushPendingLeavesAndQueueReactions({
      beforeFlushState: endedState,
      chainId: getBattleEndDeferralChainId(activeAttack.attackId),
      attackId: activeAttack.attackId,
      getCardDefinitionById: getCardDefinitionById ?? (() => undefined),
      getRegisteredTriggeredEffectActions:
        getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions,
      queueRegisteredPreFlush: true,
    });
    shouldDeferFinalize = hasPendingBattleEndFinalizeBlockers(
      endedState,
      activeAttack.attackId
    );
    if (shouldDeferFinalize) {
      endedState = {
        ...endedState,
        pendingBattleEndFinalizeAttackIds:
          endedState.pendingBattleEndFinalizeAttackIds.includes(
            activeAttack.attackId
          )
            ? endedState.pendingBattleEndFinalizeAttackIds
            : [
                ...endedState.pendingBattleEndFinalizeAttackIds,
                activeAttack.attackId,
              ],
        log: [
          ...endedState.log,
          `battle:end-scope-finalize:deferred:${activeAttack.attackId}`,
        ],
      };
    } else {
      endedState = finalizeBattleEndScopeExpirations(
        endedState,
        activeAttack.attackId,
        getCardDefinitionById
      );
    }
  }

  const battlesEndedThisTurn = (endedState.battlesEndedThisTurn ?? 0) + 1;
  // 「このアタックステップの最初にアタックするなら」型の gate は通常の
  // battle-actions 経路だけでなく、この effect:end_battle 経路でも同じ実バトル終了を
  // 観測する。ターン通算と step-local tally を常に対にして更新する。
  const battlesEndedThisAttackStep =
    (endedState.battlesEndedThisAttackStep ?? 0) + 1;
  endedState = {
    ...endedState,
    battlesEndedThisTurn,
    battlesEndedThisAttackStep,
  };
  if (getCardDefinitionById) {
    endedState = recomputeAndRebuildBattleStateContinuousEffects(
      endedState,
      getCardDefinitionById
    );
  }
  if (
    battlesEndedThisTurn === 1 &&
    endedState.step === "attack" &&
    hasForceAttackStepEndAfterFirstBattle(endedState, endedState.activePlayerId)
  ) {
    endedState.log.push(
      `battle:forced-attack-step-end:${activeAttack.attackId}`
    );
    endedState = executeEndAttackStep(endedState, endedState.activePlayerId);
  }

  return endedState;
}

function fireEndBattleDeferrals(
  state: GameState,
  attackId: string,
  participantSnapshots: readonly BattleResolutionParticipantSnapshot[],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  resolveBattleEndDeferral:
    | ((
        state: GameState,
        deferral: PendingBattleEndDeferral,
        wasBlocked: boolean
      ) => GameState)
    | undefined
): GameState {
  if (!resolveBattleEndDeferral) return state;
  const matching = state.pendingBattleEndDeferrals.filter(
    (deferral) => deferral.attackId === attackId
  );
  if (matching.length === 0) return state;

  let currentState: GameState = {
    ...state,
    pendingBattleEndDeferrals: state.pendingBattleEndDeferrals.filter(
      (deferral) => deferral.attackId !== attackId
    ),
  };

  for (let index = 0; index < matching.length; index += 1) {
    const deferral = matching[index]!;
    const ownSnapshot = participantSnapshots.find((snapshot) =>
      snapshot.memberInstanceIds.includes(deferral.sourceInstanceId)
    );
    const wasBlocked =
      deferral.battleEndDeferralWasBlocked ??
      (ownSnapshot ? ownSnapshot.blockedBy.length > 0 : false);
    if (
      !canFireBattleEndDeferral({
        state: currentState,
        deferral,
        getCardDefinitionById,
      })
    ) {
      currentState.log.push(
        `battle:end-deferral:skip-source-left:${attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`
      );
      continue;
    }
    currentState.log.push(
      `battle:end-deferral:fire:${attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`
    );
    currentState = resolveBattleEndDeferral(currentState, deferral, wasBlocked);
    if (hasOutstandingEffectResolutionContinuation(currentState)) {
      return {
        ...currentState,
        pendingBattleEndDeferrals: [
          ...currentState.pendingBattleEndDeferrals,
          ...matching.slice(index + 1),
        ],
        log: [
          ...currentState.log,
          `battle:end-deferral:paused:${attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`,
        ],
      };
    }
  }

  return currentState;
}

export function executeLifeFill(
  state: GameState,
  actingPlayerId: string,
  action: LifeFillAction,
  /** 元の効果の発生源カード (resume/sourceColors 記録用。未指定でも本体挙動は不変)。 */
  sourceInstanceId?: string,
  /**
   * `resolvePendingLifeGainReplacementChoiceForLifeFill` の decline resume 経由でのみ true。
   * `life_gain_replacement` CE 照合 (pendingLifeGainReplacementChoice 生成) を1回スキップし、
   * 元の targetValue までの増加をそのまま完了させる (executeCoreMove の
   * skipLifeGainReplacementChoice と同型)。
   */
  skipLifeGainReplacementChoice?: boolean,
  battleEndDeferralAttackId?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);
  const player = state.players.find((p) => p.id === targetPlayerId);
  if (!player) return state;

  const currentLife = player.lifeNormalCoreCount;
  const deficit = action.targetValue - currentLife;
  if (deficit <= 0) {
    state.log.push(
      `effect:life_fill:${targetPlayerId}:already_at_target:${currentLife}>=${action.targetValue}`
    );
    return state;
  }

  // 「[プレイヤー]のライフは増やせない」型の完全禁止 (life_gain_prevention CE、
  // BSTH002-R02【セット中】)。executeCoreMove の to:life 経路と同じ検出条件を共有する
  // (getLifeGainPreventionCE)。actingPlayerId を問わず無条件で回復を no-op 化する。
  if (getLifeGainPreventionCE(state, targetPlayerId)) {
    state.log.push(
      `effect:life_gain_prevention:blocked:${targetPlayerId}:life_fill:deficit=${deficit}`
    );
    return state;
  }

  // 「自分の効果で自分のライフが増えるとき、増やす代わりに...」(life_gain_replacement CE、
  // BSTH02.7-X03 effects[3])。executeCoreMove の to:life 経路と同じ検出条件・pending 生成を
  // 共有する (getLifeGainReplacementCE / createPendingLifeGainReplacementChoice)。
  if (targetPlayerId === actingPlayerId && !skipLifeGainReplacementChoice) {
    const replacementCE = getLifeGainReplacementCE(state, targetPlayerId);
    if (replacementCE) {
      return createPendingLifeGainReplacementChoice(
        state,
        targetPlayerId,
        replacementCE.sourceInstanceId,
        deficit,
        {
          lifeFillResume: {
            actingPlayerId,
            action,
            ...(sourceInstanceId ? { sourceInstanceId } : {}),
            ...(battleEndDeferralAttackId !== undefined
              ? { battleEndDeferralAttackId }
              : {}),
          },
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        }
      );
    }
  }

  // リザーブからライフにコアを移動（リザーブ不足時はボイドから補填）
  const fromReserve = Math.min(deficit, player.reserveNormalCoreCount);
  const fromVoid = Math.min(deficit - fromReserve, player.voidNormalCoreCount);
  const totalFill = fromReserve + fromVoid;
  if (totalFill <= 0) return state;

  state.log.push(
    `effect:life_fill:${targetPlayerId}:${currentLife}->${currentLife + totalFill}:reserve=${fromReserve}:void=${fromVoid}`
  );
  return {
    ...state,
    players: state.players.map((p) =>
      p.id === targetPlayerId
        ? {
            ...p,
            lifeNormalCoreCount: p.lifeNormalCoreCount + totalFill,
            reserveNormalCoreCount: p.reserveNormalCoreCount - fromReserve,
            voidNormalCoreCount: p.voidNormalCoreCount - fromVoid,
          }
        : p
    ),
  };
}

/**
 * `pendingLifeGainReplacementChoice` を解決する (`lifeFillResume` 経路、
 * `executeLifeFill` 由来の自己ライフ増加)。
 *
 * - `replace`: `applyLifeGainReplacementReplace` に委譲 (相手のライフのコア1個を
 *   トラッシュに置き、元の増加を完全にキャンセルする)。
 * - `decline`: 置換せず、`lifeFillResume` の記述で `executeLifeFill` を
 *   `skipLifeGainReplacementChoice:true` で再呼び出しし、元の増加を完了させる。
 */
export function resolvePendingLifeGainReplacementChoiceForLifeFill(
  state: GameState,
  choice: "replace" | "decline",
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  const pending = state.pendingLifeGainReplacementChoice;
  if (!pending || !pending.lifeFillResume) return state;

  if (choice === "replace") {
    return applyLifeGainReplacementReplace(
      state,
      pending,
      getCardDefinitionById
    );
  }

  const resume = pending.lifeFillResume;
  const cleared: GameState = {
    ...state,
    pendingLifeGainReplacementChoice: null,
    log: [
      ...state.log,
      `effect:life_gain_replacement:decline:${pending.decidingPlayerId}:resume-life_fill`,
    ],
  };
  return executeLifeFill(
    cleared,
    resume.actingPlayerId,
    resume.action,
    resume.sourceInstanceId,
    /*skipLifeGainReplacementChoice=*/ true,
    resume.battleEndDeferralAttackId ?? pending.battleEndDeferralAttackId
  );
}

export function executeAdditionalAttack(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  _timingScope?: TimingScope
): GameState {
  state.log.push(
    `effect:additional_attack:${actingPlayerId}:${sourceInstanceId}`
  );
  // ENGINE-additional-attack-mid-declare-attack-window-risk:
  // card_event:"attack" は declare_attack 窓内 (現在のバトルが block 未確定) で解決される
  // ため、ここで activeAttack を即クリアすると進行中のバトルが確定前に消滅してしまう。
  // 現在のバトルはそのまま通常手順 (block 宣言 → 解決) へ進めさせ、代わりに
  // sourceInstanceId へ「疲労状態でもアタック宣言できる」一回限りの grant を積む。
  // 現在のバトルが終了し window が "none" に戻った時点で、この grant を持つカードは
  // getAttackDeclarationBlockReason の exhaustState チェックをバイパスして再アタック宣言
  // 可能になる (confirmAttackDeclarationAsAction で宣言確定時に grant を1つ消費)。
  return {
    ...state,
    pendingAdditionalAttackGrants: [
      ...state.pendingAdditionalAttackGrants,
      sourceInstanceId,
    ],
  };
}

/**
 * ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md): 「◯回まで連続でバトルできる」型
 * grant (BSTH06-X03【三歩必殺】)。`additional_attack` と同じく card_event:"attack" は
 * declare_attack 窓内 (現在のバトルが block 未確定) で解決されるため、この時点で
 * activeAttack は既に存在する。その activeAttack へ直接 connectBattleGrant を設定し、
 * バトル解決終盤 (battle-actions.ts, battle_end 誘発の直前) の続行/終了選択で参照させる。
 * activeAttack が無い (発火タイミングの前提が崩れた) 場合は no-op。
 * `maxUses` は継続回数 (DSL.ConnectBattleAction 参照、総バトル回数ではない)。
 */
export function executeGrantConnectBattle(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  maxUses: number
): GameState {
  if (!state.activeAttack) return state;
  state.log.push(
    `effect:connect_battle:grant:${actingPlayerId}:${sourceInstanceId}:${maxUses}`
  );
  return {
    ...state,
    activeAttack: {
      ...state.activeAttack,
      connectBattleGrant: { sourceInstanceId, remainingUses: maxUses },
    },
  };
}

/**
 * P3-63: 追加ターン取得 (BSTH02-M01 等)。
 *
 * 現ターン状態 (turnNumber / activePlayerId / step / window / activeAttack) を
 * `extraTurnState.returnContext` にスナップショットして保存し、状態を
 * 「追加ターン取得者のスタートステップ」へジャンプさせる。
 *
 * `returnPoint === "previous_attack_battle"` のとき、追加ターン終了時に
 * `advanceFromEndStep` 側で `returnContext` を復元して中断中の状態 (例: 相手の
 * アタックステップのバトル中) に戻る。省略時は現ターン終了後の追加を予約する。
 *
 * `skipSteps` は追加ターン中の `advanceStep` でステップ遷移をスキップするために
 * `extraTurnState.skipSteps` に保持する。
 *
 * 通常の追加ターンは現ターン終了後に開始する。明示的な中断復帰型のみ即時取得する。
 */
export function executeGrantExtraTurn(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.GrantExtraTurnAction,
  options: TurnTransitionLookups = {}
): GameState {
  const ownerPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player ?? "self",
    state
  );
  const skipSteps = (action.skipSteps ??
    []) as readonly import("../model").Step[];
  if (action.returnPoint !== "previous_attack_battle") {
    if (state.pendingExtraTurn) return state;
    return { ...state, pendingExtraTurn: { ownerPlayerId, skipSteps } };
  }
  if (state.extraTurnState?.deferredStart) return state;
  const returnContext = captureInterruptedTurn(state);
  // 追加ターンを発揮した時点で別の宣言/効果発揮 window が開いている場合、その
  // stack を残したまま `window: none` へ飛ぶと priority owner の legal action が
  // 見えなくなる。まず現在の stack/cascade を閉じ、安定化した攻撃状態から追加
  // ターンを開始する。BSTH02-M01 と BSGE01-M03 が同じ attack で発動したときに
  // 実際に起きる経路を selfplay fuzz seed 1558635057 で固定する。
  const deferStart =
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    (state.activeAttack?.flashWindowState?.pendingStackAction ?? null) !==
      null ||
    // `resolveStackCascade` は stack window を閉じた後に LIFO で解決するため、
    // 現在解決中と外側の未解決 stack を一時 guard に保持する。ここで開始すると、
    // 外側 stack を旧 attack 文脈の外で解決してしまう。
    (state.pendingStackCascadeFlushGuardStacks?.length ?? 0) > 0;
  state.log.push(
    `effect:grant_extra_turn:${ownerPlayerId}:skip=${skipSteps.join(",") || "(none)"}:return=${action.returnPoint ?? "(none)"}`
  );
  if (deferStart) {
    return {
      ...state,
      extraTurnState: {
        ownerPlayerId,
        skipSteps,
        returnContext,
        deferredStart: true,
      },
    };
  }
  return enterTurn(
    {
      ...state,
      activeContinuousEffects: state.activeContinuousEffects.filter(
        (ce) => !returnContext.suspendedContinuousEffects?.includes(ce)
      ),
      extraTurnState: { ownerPlayerId, skipSteps, returnContext },
    },
    ownerPlayerId,
    nextTurnNumber(state),
    options.getCardDefinitionById ?? (() => undefined),
    options.getRegisteredTriggeredEffectActions ?? (() => undefined),
    options.getRegisteredBurstActions
  );
}

/**
 * 開いていた応答窓の解決後に、予約済みの追加ターンを開始する。
 *
 * `executeGrantExtraTurn` の直後は stack / cascade 中断の可能性があるため、この
 * 関数は `advanceStep` の pending drain 後にだけ呼ぶ。復帰点をここで取り直すことで
 * 追加ターン終了時に既に閉じた stack window を復元しない。
 */
/**
 * 追加ターンは、応答 stack だけでなく、その stack が生んだ誘発・バースト・
 * battle-end の再評価まで drain し終えた安定点からのみ開始する。
 *
 * `advanceStep` 経由は `assertNoPendingQueues` がさらに広く守る。一方、
 * stack cascade の出口は直接この helper を呼ぶため、ここでも reaction queue を
 * 明示的に gate する。これを省くと、M01 の追加ターンが battle-end 誘発や別の
 * バーストを残したまま開始し、それらを元の攻撃文脈から切り離してしまう。
 */
function hasDeferredExtraTurnStartBlocker(state: GameState): boolean {
  return (
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    // 窓を閉じても宣言確定は未完了。閉鎖中の window を復帰先に保存しない。
    state.pendingPreDeclarationConfirmation !== null ||
    (state.activeAttack?.flashWindowState?.pendingStackAction ?? null) !==
      null ||
    (state.pendingStackCascadeFlushGuardStacks?.length ?? 0) > 0 ||
    hasOutstandingEffectResolutionContinuation(state) ||
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingBurstChecks.length > 0 ||
    state.battleImmediateEffects.length > 0 ||
    state.pendingImmediateBattleEnds.length > 0 ||
    state.pendingBattleEndFinalizeAttackIds.length > 0 ||
    state.pendingAttackStepEndFinalizations.length > 0 ||
    state.pendingTurnEndFinalizations.length > 0 ||
    // discardCostGate のライフダメージは、支払う/受ける選択まで元の効果解決を
    // 中断する。leave flush 用 helper には循環防止のため含めないが、ターン開始は
    // この未解決選択を跨げない。
    state.pendingLifeDamageDiscardChoice !== null ||
    state.pendingConnectBattleDecision !== null ||
    state.pendingStackNegateRequests.length > 0
  );
}

export interface TurnTransitionLookups {
  getCardDefinitionById?:
    | ((id: string) => CardDefinition | undefined)
    | undefined;
  getRegisteredTriggeredEffectActions?:
    | TriggeredEffectActionRegistrationLookup
    | undefined;
  getRegisteredBurstActions?: BurstActionRegistrationLookup | undefined;
}

export function startDeferredExtraTurnIfReady(
  state: GameState,
  options: TurnTransitionLookups = {}
): GameState {
  const extraTurnState = state.extraTurnState;
  if (
    extraTurnState?.deferredStart !== true ||
    hasDeferredExtraTurnStartBlocker(state)
  ) {
    return state;
  }

  const returnContext =
    extraTurnState.returnContext === null
      ? null
      : captureInterruptedTurn(
          state,
          extraTurnState.returnContext.extraTurnState ?? null
        );
  const ready: GameState = {
    ...state,
    activeContinuousEffects: state.activeContinuousEffects.filter(
      (ce) => !returnContext?.suspendedContinuousEffects?.includes(ce)
    ),
    extraTurnState: {
      ownerPlayerId: extraTurnState.ownerPlayerId,
      skipSteps: extraTurnState.skipSteps,
      returnContext,
    },
    log: [
      ...state.log,
      `effect:grant_extra_turn:deferred-start:${extraTurnState.ownerPlayerId}`,
    ],
  };
  return enterTurn(
    ready,
    extraTurnState.ownerPlayerId,
    nextTurnNumber(state),
    options.getCardDefinitionById ?? (() => undefined),
    options.getRegisteredTriggeredEffectActions ?? (() => undefined),
    options.getRegisteredBurstActions
  );
}

/**
 * ENGINE-extra-turn-step-insertion: 現在のターンを離れずに指定ステップを強制挿入する
 * (BSLH01-X01【導技：7】「このステップ終了後、自分は、リフレッシュステップと
 * アタックステップを1回ずつ行える」等)。`state.pendingExtraSteps` へ追記するだけで、
 * 実際の消費・進行は `advanceStep`（turn-system.ts）が行う。
 */
export function executeGrantExtraSteps(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.GrantExtraStepsAction
): GameState {
  state.log.push(
    `effect:grant_extra_steps:${actingPlayerId}:${action.steps.join(",")}`
  );
  return {
    ...state,
    pendingExtraSteps: [
      ...new Set([...(state.pendingExtraSteps ?? []), ...action.steps]),
    ],
  };
}

/**
 * ENGINE-opponent-turn-skip (BSAZ01-C03「相手は次のターンを行えない」)。
 * 現在のターンには一切介入せず、対象プレイヤーの playerId を `pendingTurnSkips` へ積む
 * だけ。消費 (次のターン開始をこのプレイヤー分だけ飛ばす) は
 * `advanceFromEndStep`（turn-system.ts）が行う。
 */
export function executeSkipNextTurn(
  state: GameState,
  actingPlayerId: string,
  action: import("../dsl-types").DSL.SkipNextTurnAction
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.player ?? "opponent",
    state
  );
  state.log.push(`effect:skip_next_turn:${targetPlayerId}`);
  return {
    ...state,
    pendingTurnSkips: [
      ...new Set([...(state.pendingTurnSkips ?? []), targetPlayerId]),
    ],
  };
}
