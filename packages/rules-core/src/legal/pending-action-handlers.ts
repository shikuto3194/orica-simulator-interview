import { requireCardZone } from "../model";
import { executeRemoveFromGame } from "../effect/structured-card-replacement";
import { prepareDeckRevealMirageChoice } from "./mirage-set-choice";
import { recordSemanticTriggerEvent } from "../effect/semantic-trigger-events";
import { deriveEffectAspectForImmunity } from "../effect/effect-aspect";
import { replaceCardInstances } from "../zone/card-instance-state";
import { openEntryBraveCombineChoice } from "../zone/enter-field-brave-choice";
import { isAwaitingEffectEntryCores } from "../zone/enter-field-placement-pending";
import {
  hasEnterFieldOnlyCorePlacementRestriction,
  hasIndependentCoreManagement,
} from "../model";
import { resumeSummonDeclaration } from "./legal-actions-apply";
import {
  hasPendingEffectResolution,
  restorePendingSchedulingAfterRollback,
} from "../effect/pending-resolution-policy";
import { createEffectResolutionScope } from "../effect/effect-resolution-scope";
import { appendPublicDisclosuresForStateTransition } from "../public-disclosure";
import { isCoreDistributionAllocationValid } from "../core/core-distribution-constraints";
import { requireTriggerChainId } from "../chain-id";
import { queueCardEventBonusSteps } from "../effect/card-event-bonus-steps";
import { payHandGainCost } from "../effect/hand-gain-cost";
import { getZoneSelectionHandGainCost } from "./zone-selection-hand-gain-cost";
import { reverseRebirthSummonSourceReturnedState } from "../core/reverse-rebirth-core-return";
import {
  getDeckRevealHandGainCost,
  payDeckRevealHandGainCost,
} from "./deck-reveal-hand-gain-cost";
import { canPayRequiredEffectCosts } from "./required-effect-cost-gate";
import {
  getCoreMoveChangedCardIds,
  getCoreMoveChangedCoreAmount,
} from "../core/core-move-result";
import { runPendingDeckRevealBoundary } from "../effect/deck-reveal-boundary";
import { recordHandEntries, recordHandExchange } from "../zone/hand-increase";
// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).
import { applyStoneFlipCombineAction } from "./mechanic-trigger-handlers";
import { executeBounce } from "../effect/structured-zone-ops";
import {
  executeEffectAdvent,
  resolveDeferredAdventStack,
} from "../mechanics/advent-system";
import { openEffectDeclarationStackWindow } from "./legal-actions-apply";
import { advanceAttackDeclarationStateIfReady } from "./attack-burst-flow";
import { finalizeResolvedBurstCard } from "../mechanics/burst-system";
import {
  applyOrDeferTargetedDisclosureResolutionCleanups,
  applyTargetedDisclosureResolutionCleanupsWhenReady,
  resolveDeferredStackAction,
  resolveStackCascade,
  resumeStackCascadeIfReady,
  shouldDiscardRemainingStacksAfterBattleEnded,
} from "./stack-resolution-core";
import {
  lookupRegistrationForStack,
  setActiveStackChoiceIndex,
} from "./stack-target-resolution";

import {
  checkAndQueueMagicStackDomain,
  checkAndQueueOracleChoices,
} from "../mechanics/oracle-system";
import {
  isHandGainPreventedByOwnEffect,
  isZoneEntryBlockedByResistance,
} from "../effect/effect-resistance-check";
import {
  isDeckDiscardExcludeRedirectActive,
  resolveCardImmunityAffect,
  resolveDeckDiscardContainerAffect,
} from "../effect/effect-affect-adapter";
import {
  consumePendingLifeDamageTurnCapBuckets,
  generateSoulCoreOutsideGame,
  getPlayerLifeCoreCount,
  getTotalCoresOnCardById,
  isSoulCoreOn,
  moveCardZone,
  moveDeckCardsToPosition,
  moveNormalCores,
  moveSoulCore,
  markLifeDamageInterceptionUseCostGateUsedThisTurn,
  resolveCardLeavesFieldCores,
  resolvePendingLifeDamageDiscardChoice,
  updateCard,
  updatePlayer,
} from "../core/core-system";
import {
  buildCoreDistributionMovePlan,
  buildCoreDistributionSoulMovePlan,
  coreDistributionSoulCoreSourceContainerFromKey,
  coreDistributionSoulCoreSourceKey,
  type NormalCoreDistributionSourceChunk,
  type SoulCoreDistributionSourceChunk,
} from "../core/core-distribution-flow";
import {
  getCoreDistributionMoveLimit,
  getCoreDistributionTargetTotalBounds,
} from "../core/core-distribution-target-totals";
import { getCombinedUnitSymbolCount } from "../battle/battle-shared";
import {
  finalizeBattleEndSequenceAfterCombat,
  recordCompletedBattleAndFinalizeAttackStepEnd,
} from "../battle/battle-actions";
import {
  executeBraveCombine,
  moveBraveCombineCoresToHost,
  rebuildContinuousAndApplyStateBasedActions,
} from "./brave-combine-state-helpers";
import {
  removeMirageSetState,
  planMirageSetReplacements,
} from "../mechanics/mirage-system";
import {
  getCombinedUnitBp,
  getCombinedUnitEffectiveOrAdditionalCost,
  getEffectiveColors,
  getEffectiveTribes,
  getMandatoryForcedTargetInclusionIds,
  getSummonTrashCorePlacementGrant,
} from "./legal-actions-shared";
import { rememberKnownDeckCardsByInstanceIds } from "../known-deck";
import {
  applyDeckRevealSwapPlacement,
  getCurrentDeckRevealSwapOutCandidateIds,
  getDeckRevealRevealedChoiceCandidateIds,
  getDeckRevealRevealedChoiceMaxPickCount,
  isDeckRevealRevealedChoiceGroupSelectionValid,
  getDeckRevealSwapPendingDestination,
  getDeckRevealSwapOutHandCandidateIds,
  getDeckRevealSwapOutCandidateIds,
  getRevealedChoiceSwapFallbackRemainder,
  shouldDeferRevealedChoiceSwapPlacement,
} from "./deck-reveal-swap-helpers";

import {
  getBattleEndDeferralChainId,
  maybeFinalizeBattleEndScopeExpirations,
} from "../battle/battle-end-scope-finalize";
import { flushPendingLeavesAndQueueReactions } from "../zone/pending-leave-flush";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";
import {
  getDeckRevealBlockedHandAddRemainderIds,
  getDeckRevealRemainderOrderCandidateIds,
  getDeckRevealOrderableRemainderIds,
  getDeckRevealSelectablePickCandidateIds,
  getDeckRevealExclusiveGroupBranches,
  getUnresolvedDeckRevealSplitSwapPickedIds,
  resolveDeckRevealCostGateToApply,
} from "./deck-reveal-pick-candidates";

import { processPendingImmediateBattleEnds } from "../effect/effect-resolution";
import { setEffectQueueEntries } from "../effect/effect-queue";
import { nextPendingSelectionId } from "../effect/structured-effect-sequences";
import {
  recomputeAndRebuildContinuousEffects,
  recomputeAndRebuildContinuousEffectsForSources,
} from "../effect/continuous-effect-rebuild";

import type {
  ActiveStack,
  CardDefinition,
  EffectCoreLocation,
  GameState,
  NormalCoreContainer,
  PendingCoreDistribution,
  PendingMultiPlacement,
  PendingZoneSelection,
  PlayerScopedSoulCoreLocation,
  PendingStepOptionalTargetSelection,
  PendingDeckReveal,
  RebirthAction,
  SoulCoreContainer,
  SupplementalTriggerEvent,
  SummonAction,
  Zone,
} from "../model";

import {
  resolvePendingDrawStepCostChoice,
  resumeDrawStepAfterPlacement,
} from "../turn-system";

import type {
  ApplyLegalActionOptions,
  ResolvePendingDeckRevealResult,
  ResolvePendingZoneSelectionResult,
  ResolvePendingStepChoiceResult,
  ResolvePendingStepOptionalChoiceResult,
  ResolveConnectBattleDecisionResult,
  ResolvePendingDeckRevealCountBoostChoiceResult,
  ResolvePendingEnterFieldPlacementResult,
  ResolveBraveCombineChoiceResult,
  ResolveTenshoSummonResult,
  ResolvePendingLifeGainReplacementChoiceResult,
} from "./legal-actions-types";

function maybeFinalizeBattleEndScopeAfterPendingDrain(
  state: GameState,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  return maybeFinalizeBattleEndScopeExpirations(
    state,
    options.getCardDefinitionById,
    {
      flushBeforeFinalize: (beforeFlushState, attackId) =>
        flushPendingLeavesAndQueueReactions({
          beforeFlushState,
          chainId: getBattleEndDeferralChainId(attackId),
          attackId,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions ?? (() => []),
          getRegisteredBurstActions: options.getRegisteredBurstActions,
          queueRegisteredPreFlush: true,
        }),
    }
  );
}

function annotateLifeCoreInitialStepResults(
  results: readonly StepResult[],
  state: GameState,
  fromLocation: EffectCoreLocation
): readonly StepResult[] {
  if (fromLocation.kind !== "card_instance") {
    return results;
  }
  const instanceId = fromLocation.instanceId;
  const cardLeaveKind = state.cardInstances.find(
    (card) => card.instanceId === instanceId
  )?.pendingLeaveKind;
  const entityLeaveKind = state.pendingLeaveEntities.find(
    (pendingLeave) =>
      pendingLeave.instanceId === instanceId &&
      pendingLeave.blockedByResistance !== true
  )?.kind;
  const leaveKind = cardLeaveKind ?? entityLeaveKind;
  if (leaveKind === undefined || leaveKind === null) return results;

  return results.map((result) =>
    result.affectedCardInstanceIds.includes(instanceId)
      ? {
          ...result,
          leftFieldKindsByCardId: {
            ...(result.leftFieldKindsByCardId ?? {}),
            [instanceId]: leaveKind,
          },
        }
      : result
  );
}

function finalizeBattleEndAfterPendingSnapshotRestore(
  restoredState: GameState,
  sourceState: GameState,
  battleEndAttackId: string | undefined,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  if (battleEndAttackId === undefined) return restoredState;
  const pendingBattleEndFinalizeAttackIds = Array.from(
    new Set([
      ...restoredState.pendingBattleEndFinalizeAttackIds,
      ...sourceState.pendingBattleEndFinalizeAttackIds,
      battleEndAttackId,
    ])
  );
  let restored: GameState = {
    ...restoredState,
    pendingBattleEndDeferrals: [...sourceState.pendingBattleEndDeferrals],
    pendingImmediateBattleEnds: [...sourceState.pendingImmediateBattleEnds],
    pendingBattleEndFinalizeAttackIds,
  };
  restored = processPendingImmediateBattleEnds({
    state: restored,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return maybeFinalizeBattleEndScopeAfterPendingDrain(restored, options);
}

/**
 * 配置/転醒の選択を abort して prior snapshot へ戻すとき、snapshot に含まれる
 * 当該 effect 解決中だけの bookkeeping は復元してはならない。
 *
 * `effectQueueEntries` は現在解決中の chain を表す一時状態であり、abort はその effect
 * の後続 step を実行せずに解決を終える操作である。これを復元すると、以後に生成される
 * end_attack_step finalization が「効果解決中」と誤認して永続的に pending のままになる。
 * `pendingStackCascade` と flush guard も同じ理由で snapshot から復元してはならない。
 * これらは親 stack の解決中に後から積まれうる。snapshot を取った時点へ巻き戻すと、
 * 発動済みバーストだけを残して parent cascade を失い、以後の step 進行が不可能になる。
 * parent cascade だけは current state 側を維持する。一方 flush guard は cascade resolver
 * 内だけで使う一時 guard なので、snapshot/current のどちらからも持ち越さない。
 */
function restoreAbortedEffectState(
  restoredState: GameState,
  currentState: GameState
): GameState {
  const {
    pendingStackCascadeFlushGuardStacks: _discardSnapshotFlushGuardStacks,
    ...restoredWithoutSnapshotFlushGuardStacks
  } = restoredState;
  return {
    ...setEffectQueueEntries(restoredWithoutSnapshotFlushGuardStacks, []),
    pendingStackCascade: currentState.pendingStackCascade,
  };
}

import {
  executeCoreMove,
  processMovedToTrashEffects,
  placeCardFromZoneToField,
  getSearchDeckFieldEntryLogEntry,
  isEffectSummonFieldEntry,
  shouldAutoFinalizeDeckRevealRemainder,
  resolvePendingLifeDamageDiscardChoiceForCoreMove,
  resolvePendingLifeGainReplacementChoiceForCoreMove,
  resolvePendingLifeGainReplacementChoiceForLifeFill,
  evaluateCondition,
  resolvePlayerRef,
} from "../effect/structured-effect-interpreter";

import { executeEffect } from "../effect/effect-interpreter";
import {
  didNonCardActionChangeState,
  cloneStateForTriggerDelta,
  queueTargetedDisclosureForStep,
} from "../effect/native-effect-front-helpers";
import {
  canAutoExecuteSummonFromZoneCandidate,
  canAutoExecuteSummonFromZoneCandidateSequence,
  getMaxAutoExecutableSummonFromZoneSelectionCount,
  normalizeSummonFromZoneZone,
  resolveSummonFromZoneCandidates,
} from "../effect/summon-from-zone-candidates";
import { findApplicableTargetRedirects } from "../effect/redirect-effect-target";
import { resolveAffectSourceIdentity } from "../effect/effect-source-identity";
import { resumePendingRetriggerContinuations } from "../effect/retrigger-system";
import { evaluateApplicability } from "../effect/effect-applicability";
import { executeCountDecrease } from "../effect/structured-modifiers";
import { collectFieldCardDestinationCandidates } from "../effect/structured-core-move";
import { resolveLinkAidWithChosenCostSource } from "../mechanics/link-aid-system";
import {
  queueEffectActivationTriggers,
  type BurstActionRegistrationLookup,
  type TriggeredEffectActionRegistrationLookup,
} from "../effect/trigger-system";
import { didEffectActivationFail } from "../effect/effect-activation-observer";
import {
  assertPaymentSourcesAreAvailable,
  applyCardCostPayments,
  getTotalPaymentAmount,
} from "../core/payment-system";
import {
  applyEnterFieldCorePlacements,
  assertEnterFieldCorePlacementsAllowed,
  getPlacedCoreCount,
  type EnterFieldCorePlacement,
} from "../zone/enter-field-placement-execution";
import { getEnterFieldCorePlacementPolicy } from "../zone/enter-field-placement-policy";
import {
  derivePreventionProfile,
  getCandidateTargetInstanceIds,
  composeRecordedUsage,
  canUseEffectByUsageLimit,
  getChoiceVariantUsageLabel,
  recordEffectUsageIfLimited,
  getStableEffectLabel,
} from "./legal-actions-shared";
import { useMagicCardInFlashContextAsAction } from "../mechanics/magic-system";
import { buildMagicLookup } from "../effect/structured-effect-registrations";
import { resolveCount, resolveCountBound } from "../effect/target-resolution";
import {
  getActionTargetSpec,
  resolveAmountToNumber,
  resolveBraveCombineIncomingBraveDefinition,
  resolveBraveCombineIncomingBraveInstanceId,
  targetRequiresBraveCombineHostEligibility,
  targetRequiresSourceAttachedChildren,
} from "../effect/native-target-resolution";
import {
  deserializeStepContext,
  getStepResult,
} from "../step-execution-context";
import type {
  SerializedStepContext,
  StepResult,
} from "../step-execution-context";

import type { RegisteredTargetedEffectActionBase } from "./legal-actions-types";

import {
  collectStateBasedActions,
  completeBraveForcedSeparation,
  continueBraveForcedSeparations,
  resolveBraveCapacitySelection,
  hasOutstandingEffectResolutionContinuation,
  queuePendingLeave,
  resolveSetAsideExitReplacementChoice,
} from "../state-based-actions";
import {
  applyRebirthCountBonus,
  executeRebirth,
} from "../effect/structured-card-replacement";

import {
  useSummonInStackContextAsAction,
  playSummonAsAction,
} from "../play/play-card-system";
import { getDefaultZoneRoleName } from "../factories";

import { getCardById } from "../card/card-lookup";
import {
  isCardDefinitionToken,
  isMagicLikeCardForm,
} from "../card/card-filter";

import {
  resolveSummonCostExcludeChoiceSelection,
  calculateFullyPaidSummonRemainingCost,
} from "../mechanics/summon-cost-exclude-choice";
import { calculateFullReductionSummonCost } from "../core/cost-system";
import {
  applyFreeMirageSetBookkeeping,
  useEffectSetMirageAsAction,
} from "../mechanics/mirage-system";
import { resolveSummonCostCoreMoveChoiceSelection } from "../mechanics/summon-cost-core-move-choice";
import { calculateFreeSummonCost } from "../effect/summon-cost";
import type { SummonCostCoreMoveDestination } from "../mechanics/summon-cost-core-move-choice";
import { resolveGroupedSummonCostOverrideSelection } from "../mechanics/grouped-summon-cost-override-choice";
import { executeDiscardSetBurst } from "../mechanics/burst-system";
import {
  executeSummon,
  executeSummonOther,
  executeSplitSummonChoiceBranchesWithPlacementPending,
} from "../effect/structured-summon";

/**
 * ZoneSelectionContinuation / StepOptionalContinuation / PendingAfterTriggersContinuation
 * (`sourceDefinitionId`+`effectIndex`から再開対象 effect を探す全ての continuation 型) の
 * 再開対象 effect を解決する。`divineSkillIndex` 指定時は top-level `def.effects[]` ではなく
 * `def.grandwalkerData.divineSkills[divineSkillIndex].effects[]` を参照する
 * (神技/導技の効果本体は divineSkills 側に定義されるため、
 * ENGINE-divine-skill-nested-effect-continuation、BSLH01-X01「導技：2」初出)。
 * `isAccelData` / `isChangeData` 指定時も、カード本体 effects[] ではなく
 * 対応する keyword data 側の effects[] を参照する。
 */
export function resolveContinuationEffect(
  def: CardDefinition | undefined,
  continuation: {
    effectIndex: number;
    resumeEffectOverride?: import("../dsl-types").Effect;
    divineSkillIndex?: number;
    isAccelData?: boolean;
    isChangeData?: boolean;
  }
): import("../dsl-types").Effect | undefined {
  if (continuation.resumeEffectOverride)
    return continuation.resumeEffectOverride;
  if (continuation.divineSkillIndex !== undefined) {
    return def?.grandwalkerData?.divineSkills?.[continuation.divineSkillIndex]
      ?.effects?.[continuation.effectIndex];
  }
  if (continuation.isAccelData) {
    return def?.accelData?.effects?.[continuation.effectIndex];
  }
  if (continuation.isChangeData) {
    return def?.changeData?.effects?.[continuation.effectIndex];
  }
  return def?.effects?.[continuation.effectIndex];
}

function mergeUniqueStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): string[] | undefined {
  if (left === undefined && right === undefined) return undefined;
  const merged: string[] = [];
  for (const id of [...(left ?? []), ...(right ?? [])]) {
    if (!merged.includes(id)) merged.push(id);
  }
  return merged;
}

function mergeSerializedStepResult(
  existing: StepResult | undefined,
  next: StepResult
): StepResult {
  if (!existing) return next;
  return {
    ...existing,
    ...next,
    affectedCardInstanceIds:
      mergeUniqueStrings(
        existing.affectedCardInstanceIds,
        next.affectedCardInstanceIds
      ) ?? [],
    succeeded: existing.succeeded || next.succeeded,
    executed: existing.executed === true || next.executed === true,
    blockedByOpponentEffect:
      existing.blockedByOpponentEffect === true ||
      next.blockedByOpponentEffect === true,
  };
}

function withSerializedStepResult(
  stepContext: SerializedStepContext,
  result: StepResult
): SerializedStepContext {
  return {
    ...stepContext,
    results: {
      ...stepContext.results,
      [result.stepId]: mergeSerializedStepResult(
        stepContext.results[result.stepId],
        result
      ),
    },
  };
}

function getPendingSourceColors(options: {
  state: GameState;
  sourceInstanceId?: string | null;
  sourceDefinitionId?: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): CardDefinition["colors"] {
  const sourceCard = options.sourceInstanceId
    ? getCardById(options.state, options.sourceInstanceId)
    : undefined;
  const sourceDefinition = sourceCard
    ? options.getCardDefinitionById(sourceCard.definitionId)
    : options.sourceDefinitionId
      ? options.getCardDefinitionById(options.sourceDefinitionId)
      : undefined;
  return getEffectiveColors(options.state, sourceCard, sourceDefinition);
}

/**
 * 任意枚数の discard は pendingZoneSelection を跨ぐため、選択確定後に初めて
 * moved_to_trash のカード自身の自動効果を判定する。抑止指定は選んだカードだけに
 * 消費し、未選択候補や後続 discard へ持ち越さない。
 */
function processPendingZoneSelectionMovedToTrashEffects(options: {
  state: GameState;
  beforeMoveState: GameState;
  pending: PendingZoneSelection;
  movedToTrashIds: readonly string[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState {
  if (options.movedToTrashIds.length === 0) return options.state;

  // 選択を跨ぐ破棄でも、誘発抑止/遅延と常時効果の更新は分ける。
  const state =
    options.pending.suppressMovedToTrashEffects === true ||
    options.pending.deferMovedToTrashEffects === true
      ? recomputeAndRebuildContinuousEffectsForSources(
          options.state,
          options.getCardDefinitionById,
          options.movedToTrashIds
        )
      : options.state;
  const targetPlayerId =
    options.pending.targetPlayerId ?? options.pending.actingPlayerId;
  if (options.pending.suppressMovedToTrashEffects === true) {
    return {
      ...state,
      log: [
        ...state.log,
        `moved_to_trash:suppressed:${targetPlayerId}:${options.movedToTrashIds.length}`,
      ],
    };
  }

  if (options.pending.deferMovedToTrashEffects === true) {
    return {
      ...state,
      log: [
        ...state.log,
        `moved_to_trash:deferred:${targetPlayerId}:${options.movedToTrashIds.length}`,
      ],
    };
  }

  const sourceCard = getCardById(
    options.state,
    options.pending.sourceInstanceId
  );
  const sourceDefinition = sourceCard
    ? options.getCardDefinitionById(sourceCard.definitionId)
    : options.getCardDefinitionById(options.pending.sourceDefinitionId);
  return processMovedToTrashEffects(
    options.state,
    [...options.movedToTrashIds],
    options.getCardDefinitionById,
    {
      sourceColors: getEffectiveColors(
        options.state,
        sourceCard,
        sourceDefinition
      ),
      sourceTribes: getEffectiveTribes(
        options.state,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById
      ),
      ...(sourceDefinition?.name
        ? { sourceCardName: sourceDefinition.name }
        : {}),
      ...(sourceDefinition?.printedCategory
        ? { sourceCategory: sourceDefinition.printedCategory }
        : {}),
      ...(sourceCard ? { sourcePlayerId: sourceCard.controllerPlayerId } : {}),
      fromZone: options.pending.sourceZone,
    },
    options.beforeMoveState
  );
}

function getRebirthCompletionBeforeStateForTriggerDelta(
  pending: PendingCoreDistribution,
  afterState: GameState
): GameState {
  const completion = pending.rebirthCompletion;
  if (!completion || !pending.priorStateSnapshot) return afterState;

  const snapshot = pending.priorStateSnapshot;
  const sourceInstanceId = completion.sourceInstanceId;
  const snapshotCard = snapshot.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  if (snapshotCard?.zone === "field") return snapshot;

  const afterCard = afterState.cardInstances.find(
    (card) => card.instanceId === sourceInstanceId
  );
  if (!afterCard) return snapshot;

  return replaceCardInstances(
    {
      ...snapshot,
      pendingLeaveEntities: snapshot.pendingLeaveEntities.filter(
        (pendingLeave) => pendingLeave.instanceId !== sourceInstanceId
      ),
    },
    snapshot.cardInstances.some((card) => card.instanceId === sourceInstanceId)
      ? snapshot.cardInstances.map((card) =>
          card.instanceId === sourceInstanceId
            ? {
                ...afterCard,
                definitionId: afterCard.originalDefinitionId,
                zone: "field" as const,
                pendingLeaveKind: null,
                pendingLeaveCause: null,
                pendingLeaveChainId: null,
                deferZoneMoveUntilChainEnd: false,
              }
            : card
        )
      : [
          ...snapshot.cardInstances,
          {
            ...afterCard,
            definitionId: afterCard.originalDefinitionId,
            zone: "field" as const,
            pendingLeaveKind: null,
            pendingLeaveCause: null,
            pendingLeaveChainId: null,
            deferZoneMoveUntilChainEnd: false,
          },
        ]
  );
}

function getDeckRevealPickedDestination(
  pending: PendingDeckReveal,
  id: string
):
  | "hand"
  | "field"
  | "hand_swap"
  | "hand_or_set_aside_swap"
  | "mirage_set"
  | "set_aside"
  | "hand_or_set_aside_choice"
  | "trash" {
  const fallbackPickedDestination = pending.picks[0]?.destination ?? "hand";
  return pending.pickedDestinationByInstance?.[id] ?? fallbackPickedDestination;
}

function createDeckRevealSplitSwapSelectionPending(
  state: GameState,
  pending: PendingDeckReveal,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): import("../model").PendingZoneSelection | null {
  const pickedId = getUnresolvedDeckRevealSplitSwapPickedIds(pending)[0];
  if (!pickedId) return null;

  const pickedDestination = getDeckRevealPickedDestination(pending, pickedId);
  const candidateZones: Array<"hand" | "set_aside"> =
    pickedDestination === "hand_or_set_aside_swap"
      ? ["hand", "set_aside"]
      : ["hand"];
  const alreadySelectedSwapOutIds = new Set(
    Object.values(pending.swapOutByPickedInstanceId ?? {}).filter(
      (id): id is string => typeof id === "string"
    )
  );
  const candidateCardInstanceIds = getDeckRevealSwapOutCandidateIds({
    state,
    actingPlayerId: pending.actingPlayerId,
    zones: candidateZones,
    getCardDefinitionById,
    excludeInstanceIds: [
      ...alreadySelectedSwapOutIds,
      ...pending.pickedCardInstanceIds,
    ],
  });

  return {
    pendingId: `dr-split-swap:${pending.pendingId}:${pickedId}`,
    actingPlayerId: pending.actingPlayerId,
    sourceInstanceId: pending.sourceInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    actionKind: "discard_hand",
    sourceZone:
      pickedDestination === "hand_or_set_aside_swap" ? "set_aside" : "hand",
    candidateCardInstanceIds,
    maxCount: 1,
    destination: "deck_bottom",
    remainingActions: [],
    effectTiming: { kind: "continuous" },
    canSkip: true,
    swapPickedInstanceId: pickedId,
    swapPickedFallbackRemainder: "bottom",
    swapCandidateZones: candidateZones,
    deckRevealResumeAfterSwapSelection: pending,
    ...(pending.continuation !== undefined
      ? { continuation: pending.continuation }
      : {}),
    ...(pending.postResolutionOracle !== undefined
      ? { postResolutionOracle: pending.postResolutionOracle }
      : {}),
  };
}

function assertDeckRevealRemainderOrderPermutation(
  order: readonly string[],
  expectedIds: readonly string[]
): void {
  if (order.length !== expectedIds.length) {
    throw new Error(
      `Deck reveal remainder order must contain exactly ${expectedIds.length} card(s); got ${order.length}`
    );
  }
  const expectedSet = new Set(expectedIds);
  const seen = new Set<string>();
  for (const id of order) {
    if (!expectedSet.has(id)) {
      throw new Error(`Invalid deck reveal remainder order card: ${id}`);
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate deck reveal remainder order card: ${id}`);
    }
    seen.add(id);
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) {
      throw new Error(`Missing deck reveal remainder order card: ${id}`);
    }
  }
}

function assertDeckRevealRemainderPlacementsMap(
  order: readonly string[],
  placements: Record<string, "top" | "bottom"> | undefined
): void {
  if (order.length === 0) return;
  if (placements === undefined) {
    throw new Error("Deck reveal top_bottom_split requires placements");
  }
  const expectedSet = new Set(order);
  const placementIds = Object.keys(placements);
  if (placementIds.length !== order.length) {
    throw new Error(
      `Deck reveal placements must contain exactly ${order.length} card(s); got ${placementIds.length}`
    );
  }
  for (const id of placementIds) {
    if (!expectedSet.has(id)) {
      throw new Error(`Invalid deck reveal placement card: ${id}`);
    }
    const value = placements[id];
    if (value !== "top" && value !== "bottom") {
      throw new Error(`Invalid deck reveal placement for ${id}: ${value}`);
    }
  }
  for (const id of order) {
    if (!Object.prototype.hasOwnProperty.call(placements, id)) {
      throw new Error(`Missing deck reveal placement card: ${id}`);
    }
  }
}

function cleanupCompletedInUseMagicSourceIfReady(options: {
  state: GameState;
  sourceInstanceId: string;
  chainId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState {
  if (hasOutstandingEffectResolutionContinuation(options.state)) {
    return options.state;
  }
  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  if (!sourceCard || sourceCard.zone !== "in_use") return options.state;
  const sourceDef = options.getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDef || !isMagicLikeCardForm(sourceCard, sourceDef)) {
    return options.state;
  }
  const returnsToTokenPool = isCardDefinitionToken(sourceDef);
  const destinationZone = returnsToTokenPool ? "removed_from_game" : "trash";
  const zoneRoleName = getDefaultZoneRoleName(sourceDef, destinationZone);
  const afterCoreRelease = resolveCardLeavesFieldCores(
    options.state,
    options.sourceInstanceId,
    null,
    options.getCardDefinitionById
  );
  const moved = moveCardZone(
    afterCoreRelease,
    options.sourceInstanceId,
    destinationZone,
    zoneRoleName
  );
  const logged = {
    ...moved,
    log: [
      ...moved.log,
      `${returnsToTokenPool ? "magic:token-pool" : "magic:trash"}:${options.chainId}:${options.sourceInstanceId}`,
    ],
  };
  const afterMovedToTrashEffects =
    destinationZone === "trash"
      ? processMovedToTrashEffects(
          logged,
          [options.sourceInstanceId],
          options.getCardDefinitionById,
          { fromZone: "in_use" }
        )
      : logged;
  return destinationZone === "trash"
    ? recomputeAndRebuildContinuousEffectsForSources(
        afterMovedToTrashEffects,
        options.getCardDefinitionById,
        [options.sourceInstanceId]
      )
    : afterMovedToTrashEffects;
}

function getSummonZoneFromEffectActivationZone(
  activationZone: import("../model").EffectActivationSourceZone
): SummonAction["zone"] | undefined {
  return activationZone === "hand" ||
    activationZone === "set_aside" ||
    activationZone === "trash"
    ? activationZone
    : undefined;
}

function buildEffectSummonSelfActionFromPending(options: {
  activationZone: import("../model").EffectActivationSourceZone;
  fixedPaymentCost?: number;
}): SummonAction {
  const zone = getSummonZoneFromEffectActivationZone(options.activationZone);
  return {
    kind: "summon",
    target: "self",
    summonCause: "effect",
    ...(zone !== undefined ? { zone } : {}),
    ...(options.activationZone === "advent_source"
      ? { includeAdventSource: true }
      : {}),
    ...(options.activationZone === "soul_state"
      ? { includeSoulState: true }
      : {}),
    ...(options.fixedPaymentCost !== undefined
      ? { fixedPayment: options.fixedPaymentCost }
      : {}),
  };
}

function finalizeDeckRevealTransition(
  state: GameState,
  beforeState: GameState,
  sourcePending: PendingDeckReveal,
  options: ApplyLegalActionOptions,
  cause?: { chainId: string; battleEndDeferralAttackId?: string }
): GameState {
  const battleEndAttackId =
    cause?.battleEndDeferralAttackId ??
    sourcePending.continuation?.battleEndDeferralAttackId;
  return createEffectResolutionScope(
    cause ??
      sourcePending.continuation ??
      sourcePending.postResolutionOracle ?? {
        chainId: `deck-reveal:${sourcePending.pendingId}`,
      },
    battleEndAttackId
  ).finalize({
    state,
    beforeState,
    endLogs: [],
    actingPlayerId: sourcePending.actingPlayerId,
    causedBySourceInstanceId:
      sourcePending.continuation?.effectSourceInstanceId ??
      sourcePending.sourceInstanceId,
    enterFieldCausedByPlayerId: sourcePending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state,
      sourceInstanceId: sourcePending.sourceInstanceId,
      sourceDefinitionId: sourcePending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
}

export function applyPendingDeckRevealAction(
  options: ApplyLegalActionOptions
): ResolvePendingDeckRevealResult {
  const sourcePending = options.state.pendingDeckReveal;
  // 下位の操作は log.push も使うため、差分の起点を操作前に固定する。
  const beforeState = cloneStateForTriggerDelta(options.state);
  const result = applyPendingDeckRevealActionInternal(options);
  const pending = result.state.pendingDeckReveal;
  let state =
    pending?.beforePickSteps?.length || pending?.beforeMoveSteps?.length
      ? runPendingDeckRevealBoundary(result.state, options, executeEffect)
      : result.state;
  if (sourcePending)
    state = finalizeDeckRevealTransition(
      state,
      beforeState,
      sourcePending,
      options
    );
  return {
    ...result,
    state: resumeStackCascadeAfterPendingCloses(state, options),
  };
}

function applyPendingDeckRevealActionInternal(
  options: ApplyLegalActionOptions
): ResolvePendingDeckRevealResult {
  const pending = options.state.pendingDeckReveal;
  if (!pending) {
    throw new Error("No pendingDeckReveal in state");
  }

  // revealed_choice フェーズ: オープンカードの自動効果選択
  if (
    pending.phase === "revealed_choice" &&
    options.action.kind === "resolve_pending_deck_reveal_pick"
  ) {
    const selectedIds = options.selectedDeckRevealCardIds ?? [];
    const selectedSet = new Set(selectedIds);
    if (!isDeckRevealRevealedChoiceGroupSelectionValid(pending, selectedIds)) {
      throw new Error(
        "Deck reveal revealed choice violates no_duplicate/exclusive group"
      );
    }
    const dispositionMap = pending.revealedDispositionMap ?? {};
    const candidateIds = getDeckRevealRevealedChoiceCandidateIds({
      state: options.state,
      pending,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    const maxPickCount = getDeckRevealRevealedChoiceMaxPickCount({
      state: options.state,
      pending,
      candidateIds,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    for (const selectedId of selectedIds) {
      if (!candidateIds.includes(selectedId)) {
        throw new Error(
          `Invalid deck reveal revealed choice candidate: ${selectedId}`
        );
      }
    }
    if (selectedIds.length > maxPickCount) {
      throw new Error(
        `Deck reveal revealed choice exceeds max: ${selectedIds.length} > ${maxPickCount}`
      );
    }
    const selectedSwapIds = selectedIds.filter(
      (id) => dispositionMap[id]?.kind === "swap"
    );
    const swapOutHandCandidates =
      selectedSwapIds.length > 0
        ? getDeckRevealSwapOutHandCandidateIds({
            state: options.state,
            actingPlayerId: pending.actingPlayerId,
            excludeInstanceIds: selectedIds,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        : [];
    if (selectedSwapIds.length > swapOutHandCandidates.length) {
      throw new Error(
        `Cannot accept ${selectedSwapIds.length} deck reveal swap(s) with ${swapOutHandCandidates.length} hand card(s)`
      );
    }

    // 選択カードを disposition に応じてゾーン移動
    let handCount = 0;
    const zoneUpdates = new Map<
      string,
      GameState["cardInstances"][number]["zone"]
    >();
    const fieldChoiceIds: string[] = [];
    // set_as_mirage 受理カードは後段で有償の効果セットとして解決する。
    const mirageSetIds: string[] = [];
    // set_as_burst 受理カード（BSTH09-M01 型）: 手札を経由せずバーストゾーンへ直行し
    // setBurstStates に追加する。zoneUpdates とは別に zoneRoleName も burst 用に上書きする。
    const burstSetIds: string[] = [];
    const zoneRoleOverrides = new Map<string, string>();
    // swap 型（「手札1枚と入れ替えられる」）の受理カードはここでは revealed/trash に保持し、
    // 後続の swapPickedInstanceId pending で 1 対 1 交換として手札へ入れる。
    for (const id of selectedIds) {
      const disposition = dispositionMap[id] ?? {
        kind: "move",
        destination: "hand",
      };
      if (disposition.kind === "move") {
        if (disposition.destination === "field") {
          fieldChoiceIds.push(id);
        } else {
          zoneUpdates.set(id, disposition.destination);
        }
        if (disposition.destination === "hand") handCount++;
      } else if (disposition.kind === "swap") {
        continue;
      } else if (disposition.kind === "set_as_burst") {
        burstSetIds.push(id);
        zoneUpdates.set(id, "burst");
        const inst = getCardById(options.state, id);
        const def = inst
          ? options.getCardDefinitionById(inst.definitionId)
          : undefined;
        if (def)
          zoneRoleOverrides.set(id, getDefaultZoneRoleName(def, "burst"));
      } else if (disposition.kind === "set_as_mirage") {
        mirageSetIds.push(id);
      } else {
        // summon / steps_only: 将来対応。現状はフォールバックとして hand へ
        zoneUpdates.set(id, "hand");
        handCount++;
      }
    }

    const mirageChoice = prepareDeckRevealMirageChoice(
      options.state,
      pending,
      mirageSetIds,
      {
        kind: "revealed_choice",
        action: options.action,
        selectedCardIds: selectedIds,
        ...(options.paymentSources !== undefined
          ? { paymentSources: options.paymentSources }
          : {}),
        ...(options.deckRevealMiragePaymentSourcesByInstanceId !== undefined
          ? {
              miragePaymentSourcesByInstanceId:
                options.deckRevealMiragePaymentSourcesByInstanceId,
            }
          : {}),
      },
      options.getCardDefinitionById
    );
    if (mirageChoice.state) return { state: mirageChoice.state };

    // 選択カード名をログ
    if (selectedIds.length > 0) {
      const cardNames = selectedIds.map((id) => {
        const inst = getCardById(options.state, id);
        if (!inst) return id;
        const def = options.getCardDefinitionById(inst.definitionId);
        return def?.name ?? inst.definitionId;
      });
      options.state.log.push(
        `deck_reveal:revealed_choice:${pending.actingPlayerId}:${cardNames.join(",")}`
      );
    }
    for (const id of burstSetIds) {
      const inst = getCardById(options.state, id);
      const def = inst
        ? options.getCardDefinitionById(inst.definitionId)
        : undefined;
      options.state.log.push(
        `burst:set:${pending.actingPlayerId}:${id}:${def?.cardNo ?? id}:revealed_choice`
      );
    }

    // hand_gain_cost_gate (engine-opponent-hand-gain-paid-tax-gate): revealed_choice
    // 経由の手札加算にも1コスト課税を適用する。候補列挙側
    // (getDeckRevealRevealedChoiceCandidateIds/isRevealedChoiceHandGainUnaffordable) が
    // 支払い不能な手札加算 disposition を事前に除外しているため、handCount>0 の時点では
    // 必ず支払える (require_battle_cost / plain pick 経路と同じ affordability の裏返し)。
    const handGainCostGateAmount =
      handCount > 0
        ? getDeckRevealHandGainCost(options.state, pending) * handCount
        : 0;
    const stateAfterHandGainCostGate =
      handGainCostGateAmount > 0
        ? payDeckRevealHandGainCost(
            options.state,
            pending,
            handGainCostGateAmount,
            options.getCardDefinitionById,
            options.paymentSources
          )
        : options.state;

    // zone 更新
    let zoneMovedState = stateAfterHandGainCostGate;
    for (const [id, destination] of zoneUpdates) {
      const beforeMove = zoneMovedState;
      zoneMovedState = recordHandEntries(
        beforeMove,
        moveCardZone(
          beforeMove,
          id,
          requireCardZone(destination),
          zoneRoleOverrides.get(id)
        ),
        () => ({
          playerId: getCardById(beforeMove, id)!.ownerPlayerId,
          sourceInstanceId: id,
          sourceDefinitionId: getCardById(beforeMove, id)!.definitionId,
        })
      );
    }
    const remainingRevealedIds = pending.revealedCardInstanceIds.filter(
      (id) => !selectedSet.has(id)
    );

    // set_as_burst 受理カードを setBurstStates へ追加する（burst-system.ts
    // useSetBurstAsAction と同じ配列 shape。手札由来の legal action ではないため
    // burstSetPlayerIdsThisTurn/revealedBurstStates 側は触らない）。
    const burstSetEntries = burstSetIds.map((id) => ({
      playerId:
        getCardById(options.state, id)?.controllerPlayerId ??
        pending.actingPlayerId,
      cardInstanceId: id,
    }));

    // ボーナスステップ実行（core_move 等）: 実際に手札へ受理された候補にのみ適用する
    // (TrashOptionalAddEntry/PendingDeckReveal.bonusStepsByInstanceId、
    // engine-trash-optional-bonus-steps。BSTH02-R11/BSTH03-C11/C12 型)。
    let stateAfterBonusSteps: GameState = {
      ...zoneMovedState,
      ...(burstSetEntries.length > 0
        ? {
            setBurstStates: [
              ...options.state.setBurstStates,
              ...burstSetEntries,
            ],
          }
        : {}),
    };
    const parentChainId =
      pending.continuation?.chainId ??
      pending.postResolutionOracle?.chainId ??
      `deck-reveal:${pending.pendingId}`;
    for (const id of selectedIds) {
      if (zoneUpdates.get(id) !== "hand") continue;
      const bonusSteps = pending.bonusStepsByInstanceId?.[id];
      if (!bonusSteps || bonusSteps.length === 0) continue;
      stateAfterBonusSteps = queueCardEventBonusSteps(
        stateAfterBonusSteps,
        id,
        bonusSteps,
        options.getCardDefinitionById,
        pending.revealedChoiceParentPlayerId !== undefined
          ? parentChainId
          : undefined
      );
    }
    const finalizeSelfEffect = (
      state: GameState,
      beforeState: GameState,
      sourceInstanceId: string
    ): GameState => {
      const card = getCardById(state, sourceInstanceId);
      if (!card) return state;
      const selfPending = { ...pending };
      delete selfPending.continuation;
      delete selfPending.postResolutionOracle;
      // Rebuild this self effect before its SBA boundary, rather than letting
      // the parent's next boundary discover the changed minimum core count.
      state = recomputeAndRebuildContinuousEffectsForSources(
        state,
        options.getCardDefinitionById,
        [sourceInstanceId]
      );
      return finalizeDeckRevealTransition(
        state,
        beforeState,
        {
          ...selfPending,
          sourceInstanceId,
          sourceDefinitionId: card.definitionId,
        },
        options,
        {
          chainId: `${parentChainId}:card-event:${sourceInstanceId}`,
          ...(pending.continuation?.battleEndDeferralAttackId !== undefined
            ? {
                battleEndDeferralAttackId:
                  pending.continuation.battleEndDeferralAttackId,
              }
            : {}),
        }
      );
    };
    // card_event 由来のミラージュセットは手札アクションではない。
    // コスト・軽減・入替だけを通常ミラージュと共有し、解決中にスタック窓やターン回数は発生させない。
    const mirageTransitions: { id: string; beforeState: GameState }[] = [];
    for (const id of mirageSetIds) {
      const beforeMirage = cloneStateForTriggerDelta(stateAfterBonusSteps);
      const paymentSources =
        options.deckRevealMiragePaymentSourcesByInstanceId?.[id];
      if (paymentSources === undefined) {
        throw new Error(
          `deckRevealMiragePaymentSourcesByInstanceId is required for ${id}`
        );
      }
      stateAfterBonusSteps = useEffectSetMirageAsAction({
        state: stateAfterBonusSteps,
        actingPlayerId: pending.actingPlayerId,
        sourceInstanceId: id,
        paymentSources,
        effectAuthorizedSourceZones: ["revealed", "trash"],
        replacedMirageInstanceIds: mirageChoice.replacementsByInstanceId[id]!,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }).state;
      if (pending.revealedChoiceParentPlayerId !== undefined) {
        mirageTransitions.push({ id, beforeState: beforeMirage });
      }
    }
    const revealedChoiceExtraZoneEntryIds = selectedIds.filter((id) => {
      const destination = zoneUpdates.get(id);
      return destination === "hand" || destination === "set_aside";
    });
    if (revealedChoiceExtraZoneEntryIds.length > 0) {
      stateAfterBonusSteps = recomputeAndRebuildContinuousEffectsForSources(
        stateAfterBonusSteps,
        options.getCardDefinitionById,
        revealedChoiceExtraZoneEntryIds
      );
    }
    const applyFieldChoices = (
      baseState: GameState,
      optionsForFieldChoice?: {
        logPlacement?: boolean;
        finalizeSelfEffects?: boolean;
      }
    ): GameState => {
      if (fieldChoiceIds.length === 0) return baseState;
      let result = baseState;
      for (const id of fieldChoiceIds) {
        const beforeEntry = optionsForFieldChoice?.finalizeSelfEffects
          ? cloneStateForTriggerDelta(result)
          : result;
        const beforeCard = getCardById(result, id);
        result = placeCardFromZoneToField(
          result,
          id,
          options.getCardDefinitionById,
          optionsForFieldChoice?.finalizeSelfEffects &&
            isEffectSummonFieldEntry(
              beforeCard &&
                options.getCardDefinitionById(beforeCard.definitionId)
            )
            ? "summon"
            : "place"
        );
        const afterCard = getCardById(result, id);
        if (beforeCard?.zone !== "field" && afterCard?.zone === "field") {
          result = {
            ...result,
            log: [
              ...result.log,
              ...(optionsForFieldChoice?.logPlacement === false ||
              (optionsForFieldChoice?.finalizeSelfEffects &&
                isAwaitingEffectEntryCores(result, id))
                ? []
                : [
                    optionsForFieldChoice?.finalizeSelfEffects &&
                    isEffectSummonFieldEntry(
                      options.getCardDefinitionById(afterCard.definitionId)
                    )
                      ? `effect:summon:${id}:self:deck_reveal`
                      : `effect:field_place:deck_reveal:${pending.actingPlayerId}:${id}`,
                  ]),
              ...(pending.suppressFieldEntryEffects
                ? [`effect:field-entry-suppress-triggered-effects:${id}`]
                : []),
            ],
          };
        }
        if (optionsForFieldChoice?.finalizeSelfEffects && afterCard) {
          // The revealed card's own entry is a separate cause from the opener.
          result = finalizeSelfEffect(result, beforeEntry, id);
        }
      }
      return result;
    };

    const updatedCardInstances = stateAfterBonusSteps.cardInstances;
    const updatedPlayers = stateAfterBonusSteps.players;
    const updatedSetBurstStates = stateAfterBonusSteps.setBurstStates;

    const carryFieldChoicesToDeckReveal = <
      T extends Pick<
        PendingDeckReveal,
        "pickedCardInstanceIds" | "pickedDestinationByInstance"
      >,
    >(
      pendingForCarry: T
    ): T => {
      if (fieldChoiceIds.length === 0) return pendingForCarry;
      const existing = new Set(pendingForCarry.pickedCardInstanceIds);
      const appended = fieldChoiceIds.filter((id) => !existing.has(id));
      return {
        ...pendingForCarry,
        pickedCardInstanceIds: [
          ...pendingForCarry.pickedCardInstanceIds,
          ...appended,
        ],
        pickedDestinationByInstance: {
          ...pendingForCarry.pickedDestinationByInstance,
          ...Object.fromEntries(fieldChoiceIds.map((id) => [id, "field"])),
        },
      };
    };

    // swap 受理時: 手札1枚を「このカード」の行き先へ送る入れ替えを発生させる。
    // 行き先はトラッシュ由来ならトラッシュ、オープン由来ならその deck_reveal の remainder。
    // 入れ替えで出す手札の選択は discard_hand 型 pendingZoneSelection を再利用する（SSOT）。
    // 入れ替えで加えたカード自身は出す候補から除外（07b §line 42 不活性則）。
    const swapFallbackRemainder =
      getRevealedChoiceSwapFallbackRemainder(pending);
    const swapDestination = getDeckRevealSwapPendingDestination(
      swapFallbackRemainder
    );
    const deferSwapPlacement = shouldDeferRevealedChoiceSwapPlacement(pending);
    const swapOutPendings: import("../model").PendingZoneSelection[] =
      selectedSwapIds.map((id) => ({
        pendingId: `zs-swap:${pending.pendingId}:${id}`,
        actingPlayerId: pending.actingPlayerId,
        sourceInstanceId: pending.sourceInstanceId,
        sourceDefinitionId: pending.sourceDefinitionId,
        actionKind: "discard_hand",
        sourceZone: "hand",
        candidateCardInstanceIds: swapOutHandCandidates,
        maxCount: 1,
        destination: swapDestination,
        ...(swapDestination === "deck_bottom"
          ? {
              destinationPosition:
                swapFallbackRemainder === "top" ? "top" : "bottom",
            }
          : {}),
        remainingActions: [],
        effectTiming: { kind: "continuous" },
        canSkip: false,
        swapPickedInstanceId: id,
        swapPickedFallbackRemainder: swapFallbackRemainder,
        swapCandidateZones: ["hand"],
        swapOutExcludedInstanceIds: selectedIds,
        ...(deferSwapPlacement ? { swapPlacementFollowsDeckReveal: true } : {}),
        ...(pending.continuation !== undefined
          ? { continuation: pending.continuation }
          : {}),
        ...(pending.postResolutionOracle !== undefined
          ? { postResolutionOracle: pending.postResolutionOracle }
          : {}),
      }));
    const firstSwapOutPending = swapOutPendings[0] ?? null;
    const restSwapOutPendings = swapOutPendings.slice(1);
    const blockedDispositionMap = Object.fromEntries(
      Object.entries(pending.revealedDispositionMap ?? {}).filter(
        ([, disposition]) => disposition.kind === "blocked"
      )
    );
    const carryBlockedDispositionMap =
      Object.keys(blockedDispositionMap).length > 0
        ? { revealedDispositionMap: blockedDispositionMap }
        : {};
    const {
      revealedAutoAddCandidateIds: _drop,
      revealedDispositionMap: _drop2,
      revealedChoiceParentPlayerId,
      ...pendingForParent
    } = pending;
    const pendingRest = {
      ...pendingForParent,
      actingPlayerId: revealedChoiceParentPlayerId ?? pending.actingPlayerId,
    };

    if (revealedChoiceParentPlayerId !== undefined) {
      // Finish the owner's self effects before resuming a different player's
      // reveal. The common after-triggers runner gives the parent its own
      // before-state, actor and source for SBA/entry/leave attribution.
      const parentResume: import("../model").PendingAfterTriggersContinuation =
        {
          continuationId: `deck-reveal-parent:${pending.pendingId}`,
          chainId: parentChainId,
          waitChainId: parentChainId,
          sourceInstanceId: pending.sourceInstanceId,
          sourceDefinitionId: pending.sourceDefinitionId,
          actingPlayerId: revealedChoiceParentPlayerId,
          effectIndex: pending.continuation?.effectIndex ?? 0,
          resumeStepIndex: 0,
          stepContext: { results: {} },
          resumeEffectOverride: {
            timing: { kind: "continuous" },
            steps: [
              {
                action: {
                  kind: "resume_deck_reveal",
                  pending: {
                    ...pendingRest,
                    ...carryBlockedDispositionMap,
                    revealedCardInstanceIds: remainingRevealedIds,
                    phase: "picking",
                    currentPickIndex: 0,
                    ...(firstSwapOutPending
                      ? { pendingSwapOut: firstSwapOutPending }
                      : {}),
                  },
                },
              },
            ],
          },
          ...(pending.continuation?.effectSourceInstanceId !== undefined
            ? {
                effectSourceInstanceId:
                  pending.continuation.effectSourceInstanceId,
              }
            : {}),
          ...(pending.continuation?.battleEndDeferralAttackId !== undefined
            ? {
                battleEndDeferralAttackId:
                  pending.continuation.battleEndDeferralAttackId,
              }
            : {}),
        };
      const oldContinuationCount =
        options.state.pendingAfterTriggersContinuations.length;
      const selfContinuations =
        stateAfterBonusSteps.pendingAfterTriggersContinuations;
      let selfState: GameState = {
        ...stateAfterBonusSteps,
        pendingDeckReveal: null,
        pendingAfterTriggersContinuations: [
          ...selfContinuations.slice(0, oldContinuationCount),
          parentResume,
          ...selfContinuations.slice(oldContinuationCount),
        ],
        ...(restSwapOutPendings.length > 0
          ? {
              pendingDeckRevealSwapChain: [
                ...options.state.pendingDeckRevealSwapChain,
                ...restSwapOutPendings,
              ],
            }
          : {}),
      };
      for (const { id, beforeState } of mirageTransitions) {
        selfState = finalizeSelfEffect(selfState, beforeState, id);
      }
      return {
        state: applyFieldChoices(selfState, { finalizeSelfEffects: true }),
      };
    }

    if (
      pending.origin !== "trash" &&
      remainingRevealedIds.length === 0 &&
      !pendingRest.beforePickSteps?.length &&
      !pendingRest.beforeMoveSteps?.length &&
      !deferSwapPlacement
    ) {
      const autoPlacement =
        pendingRest.remainder === "top_or_bottom" ||
        pendingRest.remainder === "bottom_or_trash"
          ? "bottom"
          : pendingRest.remainder;
      const stateWithUpdates = replaceCardInstances(
        {
          ...stateAfterBonusSteps,
          players: updatedPlayers,
          setBurstStates: updatedSetBurstStates,
          ...(restSwapOutPendings.length > 0
            ? {
                pendingDeckRevealSwapChain: [
                  ...options.state.pendingDeckRevealSwapChain,
                  ...restSwapOutPendings,
                ],
              }
            : {}),
        },
        updatedCardInstances
      );
      const pendingForFinalize = carryFieldChoicesToDeckReveal({
        ...pendingRest,
        ...carryBlockedDispositionMap,
        revealedCardInstanceIds: remainingRevealedIds,
        ...(firstSwapOutPending ? { pendingSwapOut: firstSwapOutPending } : {}),
      });
      return {
        state: finalizeDeckReveal(
          stateWithUpdates,
          pendingForFinalize,
          remainingRevealedIds,
          options.getCardDefinitionById,
          autoPlacement,
          {
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
          }
        ),
      };
    }

    // trash 由来（moved_to_trash の任意手札追加）: picks/remainder は無く、
    // 非選択カードはトラッシュに据え置きで即完了。
    if (pending.origin === "trash") {
      const beforeFieldChoices = replaceCardInstances(
        {
          ...stateAfterBonusSteps,
          players: updatedPlayers,
          setBurstStates: updatedSetBurstStates,
          pendingDeckReveal: null,
        },
        updatedCardInstances
      );
      const stateWithFieldChoices = applyFieldChoices(beforeFieldChoices);
      return {
        state: {
          ...stateWithFieldChoices,
          ...(firstSwapOutPending
            ? { pendingZoneSelection: firstSwapOutPending }
            : {}),
          ...(restSwapOutPendings.length > 0
            ? {
                pendingDeckRevealSwapChain: [
                  ...options.state.pendingDeckRevealSwapChain,
                  ...restSwapOutPendings,
                ],
              }
            : {}),
        },
      };
    }

    // picking フェーズへ遷移
    // pick グループが無く、残りオープンカードの戻し順が無意味（trash 行き / 1 枚で
    // 配置先固定）な場合は picking→ordering を経由せず即完了する（P3-93 GUI 整合）。
    // revealed_choice 経由（任意手札追加つきのオープン）でこの分岐に来るため、
    // bug2 の創出時／pick 完了時ガードだけでは塞げない残路だった。
    const pendingForRemainder = carryFieldChoicesToDeckReveal({
      ...pendingRest,
      ...carryBlockedDispositionMap,
      revealedCardInstanceIds: remainingRevealedIds,
      ...(firstSwapOutPending ? { pendingSwapOut: firstSwapOutPending } : {}),
    });
    const orderableRemainingRevealedIds = getDeckRevealOrderableRemainderIds(
      options.state,
      pendingForRemainder,
      options.getCardDefinitionById,
      remainingRevealedIds
    );
    if (
      pendingRest.picks.length === 0 &&
      !pendingRest.beforePickSteps?.length &&
      !pendingRest.beforeMoveSteps?.length &&
      !deferSwapPlacement &&
      shouldAutoFinalizeDeckRevealRemainder(
        pendingRest.remainder,
        orderableRemainingRevealedIds.length
      )
    ) {
      const autoPlacement =
        pendingRest.remainder === "top_or_bottom" ||
        pendingRest.remainder === "bottom_or_trash"
          ? "bottom"
          : pendingRest.remainder;
      const stateWithUpdates = replaceCardInstances(
        {
          ...stateAfterBonusSteps,
          players: updatedPlayers,
          setBurstStates: updatedSetBurstStates,
          ...(restSwapOutPendings.length > 0
            ? {
                pendingDeckRevealSwapChain: [
                  ...options.state.pendingDeckRevealSwapChain,
                  ...restSwapOutPendings,
                ],
              }
            : {}),
        },
        updatedCardInstances
      );
      return {
        state: finalizeDeckReveal(
          stateWithUpdates,
          pendingForRemainder,
          orderableRemainingRevealedIds,
          options.getCardDefinitionById,
          autoPlacement,
          {
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
          }
        ),
      };
    }

    const stateWithUpdates = replaceCardInstances(
      {
        ...stateAfterBonusSteps,
        players: updatedPlayers,
        setBurstStates: updatedSetBurstStates,
        ...(restSwapOutPendings.length > 0
          ? {
              pendingDeckRevealSwapChain: [
                ...options.state.pendingDeckRevealSwapChain,
                ...restSwapOutPendings,
              ],
            }
          : {}),
      },
      updatedCardInstances
    );
    return {
      state: {
        ...stateWithUpdates,
        pendingDeckReveal: carryFieldChoicesToDeckReveal({
          ...pendingRest,
          ...carryBlockedDispositionMap,
          revealedCardInstanceIds: remainingRevealedIds,
          phase: "picking" as const,
          currentPickIndex: 0,
          // swap 受理時は入れ替えの手札選択を reveal 完了まで持ち越す。
          ...(firstSwapOutPending
            ? { pendingSwapOut: firstSwapOutPending }
            : {}),
        }),
      },
    };
  }

  if (options.action.kind === "resolve_pending_deck_reveal_pick") {
    const selectedIds = options.selectedDeckRevealCardIds ?? [];
    const currentPick = pending.picks[pending.currentPickIndex];
    if (!currentPick) {
      throw new Error(
        `No deck reveal pick at index ${pending.currentPickIndex}`
      );
    }
    let nextPickIndex: number;
    let declaredDestination:
      | "hand"
      | "field"
      | "hand_swap"
      | "hand_or_set_aside_swap"
      | "mirage_set"
      | "set_aside"
      | "hand_or_set_aside_choice"
      | "trash";
    let costGateToApply: number | undefined;
    const handGainCost = getDeckRevealHandGainCost(options.state, pending);
    let declinesHandGain: boolean;

    if (currentPick.exclusiveGroup) {
      // 排他選択グループ (XOR): 未解決の兄弟 pick group をまとめて1回の選択で
      // 解決する。選択が「どの兄弟の要求を過不足なく満たすか」で採否ブランチが
      // 決まる（複数ブランチの候補を跨いだ選択は不成立）。
      const branches = getDeckRevealExclusiveGroupBranches(
        options.state,
        pending,
        pending.currentPickIndex,
        options.getCardDefinitionById
      );
      // candidateIds.length===0 のブランチは除外する: count:-1 ("すべて") ブランチは
      // 候補0枚だと requiredCount も0になり、空選択が vacuous に一致してしまう。
      // これを許すと、候補が実在する他の mandatory ブランチを無視して素通りできてしまう
      // (adversarial verifier 2026-07-29 round1 refute)。0候補ブランチの扱いは
      // 常に下の !matched 分岐 (allEmpty / groupIsMandatory 判定) に委ねる。
      // (costGate 支払い不能ブランチも getDeckRevealExclusiveGroupBranches が
      // candidateIds:[] にしているため同じ経路で除外される。BSTH08.5-C23)
      const matched = branches.find(
        (b) =>
          b.candidateIds.length > 0 &&
          selectedIds.length === b.requiredCount &&
          selectedIds.every((id) => b.candidateIds.includes(id))
      );
      const groupIsMandatory = branches.some((b) => b.pick.mandatory);
      const allEmpty = branches.every((b) => b.candidateIds.length === 0);
      declinesHandGain =
        selectedIds.length === 0 &&
        handGainCost > 0 &&
        branches.some(
          (b) =>
            (b.pick.destination ?? "hand") === "hand" &&
            b.candidateIds.length > 0
        );
      if (!matched) {
        if (
          selectedIds.length === 0 &&
          (allEmpty || !groupIsMandatory || declinesHandGain)
        ) {
          nextPickIndex =
            (branches[branches.length - 1]?.index ?? pending.currentPickIndex) +
            1;
          declaredDestination = "hand";
        } else {
          throw new Error(
            `Deck reveal exclusive pick selection satisfies no branch of group "${currentPick.exclusiveGroup}"`
          );
        }
      } else {
        nextPickIndex =
          (branches[branches.length - 1]?.index ?? pending.currentPickIndex) +
          1;
        declaredDestination = matched.pick.destination ?? "hand";
        costGateToApply = resolveDeckRevealCostGateToApply(
          options.state,
          pending,
          matched.pick
        );
      }
    } else {
      const candidateIds = getDeckRevealSelectablePickCandidateIds(
        options.state,
        pending,
        currentPick,
        options.getCardDefinitionById
      );
      const pickMaxCount =
        currentPick.count < 0 ? candidateIds.length : currentPick.count;
      declinesHandGain =
        selectedIds.length === 0 &&
        handGainCost > 0 &&
        (currentPick.destination ?? "hand") === "hand" &&
        candidateIds.length > 0;
      const requiredCount = currentPick.mandatory
        ? Math.min(pickMaxCount, candidateIds.length)
        : 0;
      if (selectedIds.length < requiredCount && !declinesHandGain) {
        throw new Error(
          `Deck reveal pick requires ${requiredCount} selection(s); got ${selectedIds.length}`
        );
      }
      if (selectedIds.length > pickMaxCount) {
        throw new Error(
          `Deck reveal pick exceeds max: ${selectedIds.length} > ${pickMaxCount}`
        );
      }
      for (const selectedId of selectedIds) {
        if (!candidateIds.includes(selectedId)) {
          throw new Error(`Invalid deck reveal pick candidate: ${selectedId}`);
        }
      }
      nextPickIndex = pending.currentPickIndex + 1;
      declaredDestination = currentPick.destination ?? "hand";
      costGateToApply = resolveDeckRevealCostGateToApply(
        options.state,
        pending,
        currentPick
      );
    }

    // "hand_or_set_aside_choice" (BSTH08.5-C23): swap 型と異なり交換相手が不要な
    // 単純な行き先の自由選択のため、別 pending を起こさず同一アクションの追加入力
    // (deckRevealPickFreeDestination) で解決する。0 枚選択なら行き先は使われないため
    // 未指定でも通す。
    const currentGroupDestination:
      | "hand"
      | "field"
      | "hand_swap"
      | "hand_or_set_aside_swap"
      | "mirage_set"
      | "set_aside"
      | "trash" =
      declaredDestination === "hand_or_set_aside_choice"
        ? selectedIds.length === 0
          ? "hand"
          : (() => {
              const chosen = options.deckRevealPickFreeDestination;
              if (chosen !== "hand" && chosen !== "set_aside") {
                throw new Error(
                  `Deck reveal pick destination "hand_or_set_aside_choice" requires deckRevealPickFreeDestination ("hand"|"set_aside")`
                );
              }
              return chosen;
            })()
        : declaredDestination;

    // 「手札に加えるまたは手元に置く」は、手元なら手札純増ではない。候補段階では
    // 両方を残し、実際に手札を選んだ場合だけ「(player)は、(player)の効果で手札を
    // 増やせない」の source-scoped gate で拒否する（BSTH08.5-C23 / BSRK01-X01）。
    if (
      selectedIds.length > 0 &&
      currentGroupDestination === "hand" &&
      isHandGainPreventedByOwnEffect(
        options.state,
        pending.targetPlayerId ?? pending.actingPlayerId,
        pending.actingPlayerId
      )
    ) {
      throw new Error(
        'Deck reveal pick destination "hand" blocked by hand_gain_prevention'
      );
    }

    // `hand_or_set_aside_choice` は手元へ置く選択のため候補を残すが、手札を選んだ
    // 場合は BSRK01-C02 の外部 hand_gain_cost_gate をここで再評価する。候補列挙時は
    // 手元へ置く経路を残すためこの対価を加えられないので、最終選択で native costGate
    // と大きい方を採り、支払い不能な偽装手札選択を拒否する。
    if (selectedIds.length > 0 && currentGroupDestination === "hand") {
      const externalHandGainCost = getDeckRevealHandGainCost(
        options.state,
        pending
      );
      if (pending.handGainCostDecision === "declined")
        throw new Error(
          'Deck reveal pick destination "hand" blocked by hand_gain_cost_gate'
        );
      if (externalHandGainCost > 0) {
        costGateToApply = Math.max(costGateToApply ?? 0, externalHandGainCost);
      }
    }

    // ENGINE-set-aside-entry-restriction: "hand_or_set_aside_choice" は自由選択のため
    // getDeckRevealPickCandidateIdsExcluding の候補フィルタ (destination === "set_aside" 直接
    // 指定のみ対象) では捕捉できない。行き先が set_aside に確定した時点で
    // destination-zone-scoped resistance (cannot_enter_zone) を再チェックし、阻止対象が
    // 含まれていれば選択自体を拒否する (BSTH08.5-X04「このカードの効果以外で手元に置けない」)。
    if (currentGroupDestination === "set_aside") {
      for (const id of selectedIds) {
        const card = getCardById(options.state, id);
        if (
          card &&
          isZoneEntryBlockedByResistance(
            options.state,
            card,
            "set_aside",
            pending.actingPlayerId,
            options.getCardDefinitionById
          )
        ) {
          throw new Error(
            `Deck reveal pick destination "set_aside" blocked by resistance: ${id}`
          );
        }
      }
    }

    // costGate (「1コスト支払うことで」型ブランチ) の実支払い。legal action 列挙時点で
    // 支払い不能ブランチは候補0枚化されているため、ここに到達する時点では必ず支払える
    // (getDeckRevealExclusiveGroupBranches と同じ affordability 判定の裏返し)。
    const stateAfterCostGate =
      costGateToApply !== undefined && selectedIds.length > 0
        ? payDeckRevealHandGainCost(
            options.state,
            pending,
            costGateToApply,
            options.getCardDefinitionById,
            options.paymentSources
          )
        : options.state;

    const newPicked = [...pending.pickedCardInstanceIds, ...selectedIds];
    // pick group ごとに destination をカード instance に紐付けて記録する。
    // finalize で per-pick の swap / hand / field を区別するため。
    const nextPickedDestinationByInstance: Record<
      string,
      | "hand"
      | "field"
      | "hand_swap"
      | "hand_or_set_aside_swap"
      | "mirage_set"
      | "set_aside"
      | "trash"
    > = { ...(pending.pickedDestinationByInstance ?? {}) };
    for (const id of selectedIds) {
      nextPickedDestinationByInstance[id] = currentGroupDestination;
    }
    const pendingAfterPick = {
      ...pending,
      ...(declinesHandGain
        ? { handGainCostDecision: "declined" as const }
        : selectedIds.length > 0 &&
            currentGroupDestination === "hand" &&
            handGainCost > 0
          ? { handGainCostDecision: "paid" as const }
          : {}),
      pickedCardInstanceIds: newPicked,
      pickedDestinationByInstance: nextPickedDestinationByInstance,
    };

    if (nextPickIndex >= pending.picks.length) {
      // 全グループ完了 → ordering フェーズ or 即完了
      const pendingForOrdering = {
        ...pendingAfterPick,
        currentPickIndex: nextPickIndex,
        phase: "ordering_remainder" as const,
      };
      if (pendingForOrdering.beforeMoveSteps?.length) {
        return {
          state: {
            ...stateAfterCostGate,
            pendingDeckReveal: pendingForOrdering,
          },
        };
      }
      return {
        state: continueDeckRevealAfterPicks(
          stateAfterCostGate,
          pendingForOrdering,
          options
        ),
      };
    }

    // 次のピックグループへ
    stateAfterCostGate.log.push(
      `deck_reveal:pick:group${pending.currentPickIndex}:${selectedIds.length}selected`
    );
    return {
      state: {
        ...stateAfterCostGate,
        pendingDeckReveal: {
          ...pendingAfterPick,
          currentPickIndex: nextPickIndex,
        },
      },
    };
  }

  // ordering
  const defaultRemainderIds = getDeckRevealRemainderOrderCandidateIds(
    pending,
    pending.revealedCardInstanceIds.filter(
      (id) => !pending.pickedCardInstanceIds.includes(id)
    )
  );
  const order =
    options.deckRevealRemainderOrder ??
    getDeckRevealOrderableRemainderIds(
      options.state,
      pending,
      options.getCardDefinitionById,
      defaultRemainderIds
    );
  const expectedOrderIds = getDeckRevealOrderableRemainderIds(
    options.state,
    pending,
    options.getCardDefinitionById,
    defaultRemainderIds
  );
  assertDeckRevealRemainderOrderPermutation(order, expectedOrderIds);
  const choices =
    pending.remainder === "bottom_or_trash"
      ? ["bottom", "trash"]
      : ["top", "bottom"];
  if (
    (pending.remainder === "bottom_or_trash" ||
      pending.remainder === "top_or_bottom") &&
    options.deckRevealPlacement !== undefined &&
    !choices.includes(options.deckRevealPlacement)
  ) {
    throw new Error("Deck reveal remainder placement is unavailable");
  }
  const placement =
    pending.remainder === "top_or_bottom" ||
    pending.remainder === "bottom_or_trash"
      ? (options.deckRevealPlacement ?? "bottom")
      : pending.remainder;
  return {
    state: finalizeDeckReveal(
      options.state,
      pending,
      order,
      options.getCardDefinitionById,
      placement,
      {
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        ...(options.deckRevealRemainderPlacements !== undefined
          ? { remainderPlacementById: options.deckRevealRemainderPlacements }
          : {}),
      }
    ),
  };
}

/** 選択完了後の移動・順序選択を、通常処理と途中手順の再開で共有する。 */
export function continueDeckRevealAfterPicks(
  state: GameState,
  pending: PendingDeckReveal,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  const entered = prepareDeckRevealFieldEntries(
    state,
    pending,
    options.getCardDefinitionById
  );
  if (entered.state.pendingMultiPlacement) return entered.state;
  state = entered.state;
  pending = entered.pending;
  const remainingIds = pending.revealedCardInstanceIds.filter(
    (id) => !pending.pickedCardInstanceIds.includes(id)
  );
  const orderCandidateIds = getDeckRevealRemainderOrderCandidateIds(
    pending,
    remainingIds
  );
  const orderableRemainingIds = getDeckRevealOrderableRemainderIds(
    state,
    pending,
    options.getCardDefinitionById,
    orderCandidateIds
  );
  const splitSwapSelectionPending = createDeckRevealSplitSwapSelectionPending(
    state,
    pending,
    options.getCardDefinitionById
  );
  if (splitSwapSelectionPending) {
    state.log.push(
      `deck_reveal:pick_complete:${pending.pickedCardInstanceIds.length}picked`
    );
    return {
      ...state,
      pendingDeckReveal: null,
      pendingZoneSelection: splitSwapSelectionPending,
    };
  }
  if (
    shouldAutoFinalizeDeckRevealRemainder(
      pending.remainder,
      orderableRemainingIds.length
    )
  ) {
    // 0枚 / trash / 1枚で配置先固定の場合は順序選択を出さず即完了
    // （trash は置き順無意味・P3-93。top_or_bottom は1枚でもユーザー選択が必要）
    const autoPlacement =
      pending.remainder === "bottom_or_trash" ||
      pending.remainder === "top_or_bottom" ||
      pending.remainder === "top_bottom_split"
        ? "bottom"
        : pending.remainder;
    return finalizeDeckReveal(
      state,
      pending,
      orderableRemainingIds,
      options.getCardDefinitionById,
      autoPlacement,
      {
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }
    );
  }
  // ordering フェーズへ
  state.log.push(
    `deck_reveal:pick_complete:${pending.pickedCardInstanceIds.length}picked`
  );
  return { ...state, pendingDeckReveal: pending };
}

/** Keep the reveal (including repeat continuation) suspended until core choices finish. */
function prepareDeckRevealFieldEntries(
  state: GameState,
  pending: PendingDeckReveal,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  finalization?: Omit<
    NonNullable<import("../model").PendingMultiPlacement["deckRevealResume"]>,
    "reveal"
  >
): { state: GameState; pending: PendingDeckReveal } {
  let result = state;
  const attempted = new Set(pending.attemptedFieldEntryIds ?? []);
  for (const id of pending.pickedCardInstanceIds) {
    if (
      (pending.pickedDestinationByInstance?.[id] ??
        pending.picks[0]?.destination) !== "field"
    )
      continue;
    if (attempted.has(id)) continue;
    attempted.add(id);
    if (getCardById(result, id)?.zone === "field") continue;
    const card = getCardById(result, id);
    result = placeCardFromZoneToField(
      result,
      id,
      getCardDefinitionById,
      isEffectSummonFieldEntry(card && getCardDefinitionById(card.definitionId))
        ? "summon"
        : "place"
    );
    if (
      pending.suppressFieldEntryEffects &&
      getCardById(result, id)?.zone === "field"
    ) {
      result = {
        ...result,
        log: [
          ...result.log,
          `effect:field-entry-suppress-triggered-effects:${id}`,
        ],
      };
    }
  }
  pending = { ...pending, attemptedFieldEntryIds: [...attempted] };
  if (!result.pendingMultiPlacement) return { state: result, pending };
  return {
    pending,
    state: {
      ...result,
      pendingDeckReveal: null,
      pendingMultiPlacement: {
        ...result.pendingMultiPlacement,
        priorStateSnapshot: pending.priorStateSnapshot ?? state,
        deckRevealResume: { reveal: pending, ...finalization },
      },
    },
  };
}

/**
 * DeckReveal を完了する: picked→hand, remainder→deck bottom/top/trash。
 * 手札に加えたカード名をログに記録（公開情報）。
 */
export function finalizeDeckReveal(
  state: GameState,
  pending: PendingDeckReveal,
  remainderOrder: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  effectivePlacement?:
    | "top"
    | "bottom"
    | "top_or_bottom"
    | "top_bottom_split"
    | "bottom_or_trash"
    | "trash",
  finalizeOptions?: {
    getRegisteredTriggeredEffectActions: NonNullable<
      ApplyLegalActionOptions["getRegisteredTriggeredEffectActions"]
    >;
    getRegisteredBurstActions?: ApplyLegalActionOptions["getRegisteredBurstActions"];
    remainderPlacementById?: Record<string, "top" | "bottom">;
  }
): GameState {
  const mirageSources = pending.pickedCardInstanceIds.filter(
    (id) => getDeckRevealPickedDestination(pending, id) === "mirage_set"
  );
  const mirageChoice = prepareDeckRevealMirageChoice(
    state,
    pending,
    mirageSources,
    {
      kind: "finalize",
      remainderOrder,
      ...(effectivePlacement !== undefined ? { effectivePlacement } : {}),
      ...(finalizeOptions?.remainderPlacementById !== undefined
        ? { remainderPlacementById: finalizeOptions.remainderPlacementById }
        : {}),
    },
    getCardDefinitionById
  );
  if (mirageChoice.state) return mirageChoice.state;
  pending = {
    ...pending,
    mirageReplacementsByInstanceId: mirageChoice.replacementsByInstanceId,
  };
  const entered = prepareDeckRevealFieldEntries(
    state,
    pending,
    getCardDefinitionById,
    {
      remainderOrder,
      ...(effectivePlacement !== undefined
        ? { placement: effectivePlacement }
        : {}),
      ...(finalizeOptions?.remainderPlacementById !== undefined
        ? { remainderPlacementById: finalizeOptions.remainderPlacementById }
        : {}),
    }
  );
  if (entered.state.pendingMultiPlacement) return entered.state;
  state = entered.state;
  pending = entered.pending;
  const deckOwnerPlayerId = pending.targetPlayerId ?? pending.actingPlayerId;
  const pickedSet = new Set(pending.pickedCardInstanceIds);
  const failedHandAddTrashIds = new Set(
    getDeckRevealBlockedHandAddRemainderIds(
      state,
      pending,
      getCardDefinitionById,
      pending.revealedCardInstanceIds.filter((id) => !pickedSet.has(id))
    )
  );
  const remainderSet = new Set([...remainderOrder, ...failedHandAddTrashIds]);
  const deckRemainderSet = new Set(
    remainderOrder.filter((id) => !failedHandAddTrashIds.has(id))
  );
  const originalRevealedCardInstanceIds =
    pending.originalRevealedCardInstanceIds ?? pending.revealedCardInstanceIds;
  // per-pick destination map (10_rules/07b §BSTH09-C04/C05)。
  // 未記録 (旧経路) のときは picks[0].destination にフォールバックして既存挙動を保つ。
  const fallbackPickedDestination = pending.picks[0]?.destination ?? "hand";
  const destByInstance = pending.pickedDestinationByInstance ?? {};
  const getPickedDestination = (
    id: string
  ):
    | "hand"
    | "field"
    | "hand_swap"
    | "hand_or_set_aside_swap"
    | "mirage_set"
    | "set_aside"
    | "hand_or_set_aside_choice"
    | "trash" => destByInstance[id] ?? fallbackPickedDestination;
  const placement = effectivePlacement ?? pending.remainder;
  const resolvedSwapPlacement: "top" | "bottom" | "trash" =
    placement === "trash" ? "trash" : placement === "top" ? "top" : "bottom";
  const splitSwapOutByPicked = pending.swapOutByPickedInstanceId ?? {};
  const hasSplitSwapChoice = (id: string): boolean =>
    Object.prototype.hasOwnProperty.call(splitSwapOutByPicked, id);
  const splitSkippedPickedSet = new Set(
    Object.entries(splitSwapOutByPicked)
      .filter(([, swapOutId]) => swapOutId === null)
      .map(([pickedId]) => pickedId)
  );
  const splitSwapPickedZoneById = new Map<string, "hand" | "set_aside">();
  for (const [pickedId, swapOutId] of Object.entries(splitSwapOutByPicked)) {
    if (swapOutId === null) continue;
    const swapOutCard = getCardById(state, swapOutId);
    if (!swapOutCard) {
      throw new Error(
        `Deck reveal split swap-out card not found: ${swapOutId}`
      );
    }
    const resolvedZone: "hand" | "set_aside" =
      swapOutCard.zone === "set_aside" ? "set_aside" : "hand";
    // ENGINE-set-aside-entry-restriction: top_bottom_split remainder の per-pick
    // swap-out 選択で picked card が手元(set_aside)側へ入る組み合わせのとき、
    // destination-zone-scoped resistance (cannot_enter_zone) で阻止される対象なら
    // 選択自体を拒否する。
    if (resolvedZone === "set_aside") {
      const pickedCard = getCardById(state, pickedId);
      if (
        pickedCard &&
        isZoneEntryBlockedByResistance(
          state,
          pickedCard,
          "set_aside",
          pending.actingPlayerId,
          getCardDefinitionById
        )
      ) {
        throw new Error(
          `Deck reveal split swap into set_aside blocked by resistance: ${pickedId}`
        );
      }
    }
    splitSwapPickedZoneById.set(pickedId, resolvedZone);
  }
  const resolveDeferredSwapPlacement = (
    swapPending: import("../model").PendingZoneSelection
  ): import("../model").PendingZoneSelection =>
    swapPending.swapPlacementFollowsDeckReveal === true &&
    swapPending.pendingId.startsWith(`zs-swap:${pending.pendingId}:`)
      ? applyDeckRevealSwapPlacement(swapPending, resolvedSwapPlacement)
      : swapPending;

  // hand_swap / hand_or_set_aside_swap な picked card: finalize 内では一旦 revealed のまま保留し、
  // per-pick swap-out 選択 (pendingZoneSelection) 解決時に hand/set_aside or remainder 行きへ確定する。
  const swapPendingPickedIds: string[] = [];
  for (const id of pending.pickedCardInstanceIds) {
    const destination = getPickedDestination(id);
    if (
      destination === "hand_swap" ||
      destination === "hand_or_set_aside_swap"
    ) {
      if (hasSplitSwapChoice(id)) continue;
      swapPendingPickedIds.push(id);
    }
  }
  const swapPendingSet = new Set(swapPendingPickedIds);
  const expectedRemainderIds = getDeckRevealRemainderOrderCandidateIds(
    pending,
    pending.revealedCardInstanceIds.filter((id) => !pickedSet.has(id))
  );
  for (const id of expectedRemainderIds) {
    if (!remainderSet.has(id)) {
      throw new Error(`Deck reveal remainder order is missing card: ${id}`);
    }
  }

  state.log.push(
    `deck_reveal:finalize:${pending.actingPlayerId}:picked=${pickedSet.size}:remainder=${remainderSet.size}:${placement}`
  );
  if (pending.pickedCardInstanceIds.length > 0) {
    if ((pending.revealTo ?? "both") !== "both") {
      state.log.push(
        `deck_reveal:picked_cards_private:${pending.actingPlayerId}:count=${pending.pickedCardInstanceIds.length}`
      );
    } else {
      const pickedCardNames = pending.pickedCardInstanceIds.map((id) => {
        const inst = getCardById(state, id);
        if (!inst) return id;
        const def = getCardDefinitionById(inst.definitionId);
        return def?.name ?? inst.definitionId;
      });
      state.log.push(
        `deck_reveal:picked_cards:${pending.actingPlayerId}:${pickedCardNames.join(",")}`
      );
    }
  }
  for (const id of pending.pickedCardInstanceIds) {
    if (getPickedDestination(id) !== "field") continue;
    const inst = getCardById(state, id);
    if (inst?.zone !== "field") continue;
    const def = getCardDefinitionById(inst.definitionId);
    if (
      def?.printedCategory === "spirit" ||
      def?.printedCategory === "ultimate" ||
      def?.printedCategory === "brave"
    ) {
      state.log.push(`effect:summon:${id}:self:deck_reveal`);
    } else {
      state.log.push(
        `effect:field_place:deck_reveal:${pending.actingPlayerId}:${id}`
      );
    }
    if (pending.suppressFieldEntryEffects) {
      state.log.push(`effect:field-entry-suppress-triggered-effects:${id}`);
    }
  }

  // remainder カードを remainderOrder 順にソート
  const orderIndexMap = new Map(remainderOrder.map((id, idx) => [id, idx]));

  // カードを分類: picked / remainder / other
  const otherCards: typeof state.cardInstances = [];
  const remainderCards: typeof state.cardInstances = [];
  let movedState = state;
  const moveRevealedCard = (
    card: GameState["cardInstances"][number],
    zone: import("../model").CardZone,
    zoneRoleName?: string
  ) => {
    movedState = moveCardZone(movedState, card.instanceId, zone, zoneRoleName);
    return getCardById(movedState, card.instanceId)!;
  };
  for (const c of state.cardInstances) {
    if (pickedSet.has(c.instanceId)) {
      if (splitSkippedPickedSet.has(c.instanceId)) {
        if (placement === "trash") {
          otherCards.push(moveRevealedCard(c, "trash"));
        } else {
          remainderCards.push(moveRevealedCard(c, "deck"));
        }
      } else if (splitSwapPickedZoneById.has(c.instanceId)) {
        otherCards.push(
          moveRevealedCard(c, splitSwapPickedZoneById.get(c.instanceId)!)
        );
      } else if (swapPendingSet.has(c.instanceId)) {
        // hand_or_set_aside_swap: swap-out 解決まで revealed のまま据え置く
        otherCards.push(c);
      } else {
        const dest = getPickedDestination(c.instanceId);
        const def = getCardDefinitionById(c.definitionId);
        const zone: typeof c.zone =
          dest === "field"
            ? c.zone
            : dest === "mirage_set"
              ? "mirage"
              : dest === "set_aside"
                ? "set_aside"
                : dest === "trash"
                  ? "trash"
                  : "hand";
        otherCards.push(
          moveRevealedCard(
            c,
            requireCardZone(zone),
            (dest === "field" || dest === "mirage_set") && def
              ? getDefaultZoneRoleName(def, zone)
              : undefined
          )
        );
      }
    } else if (remainderSet.has(c.instanceId)) {
      if (placement === "trash" || failedHandAddTrashIds.has(c.instanceId)) {
        otherCards.push(moveRevealedCard(c, "trash"));
      } else {
        remainderCards.push(moveRevealedCard(c, "deck"));
      }
    } else {
      otherCards.push(c);
    }
  }

  // remainderOrder 順にソート
  remainderCards.sort(
    (a, b) =>
      (orderIndexMap.get(a.instanceId) ?? 0) -
      (orderIndexMap.get(b.instanceId) ?? 0)
  );

  const insertAtDeckTop = (
    cards: typeof state.cardInstances,
    insertion: typeof state.cardInstances
  ): typeof state.cardInstances => {
    if (insertion.length === 0) return cards;
    const firstDeckIdx = cards.findIndex(
      (c) => c.ownerPlayerId === deckOwnerPlayerId && c.zone === "deck"
    );
    if (firstDeckIdx === -1) return [...cards, ...insertion];
    return [
      ...cards.slice(0, firstDeckIdx),
      ...insertion,
      ...cards.slice(firstDeckIdx),
    ];
  };
  const insertAtDeckBottom = (
    cards: typeof state.cardInstances,
    insertion: typeof state.cardInstances
  ): typeof state.cardInstances => {
    if (insertion.length === 0) return cards;
    let lastDeckIdx = -1;
    for (let i = cards.length - 1; i >= 0; i--) {
      if (
        cards[i]!.ownerPlayerId === deckOwnerPlayerId &&
        cards[i]!.zone === "deck"
      ) {
        lastDeckIdx = i;
        break;
      }
    }
    if (lastDeckIdx === -1) return [...cards, ...insertion];
    return [
      ...cards.slice(0, lastDeckIdx + 1),
      ...insertion,
      ...cards.slice(lastDeckIdx + 1),
    ];
  };
  const toDeckStorageOrder = (
    cards: typeof state.cardInstances
  ): typeof state.cardInstances => [...cards].reverse();

  // deckRevealRemainderOrder は UI と ApplyLegalActionOptions の契約どおり
  // 「デッキ下から順」。cardInstances の deck 配列は上→下なので挿入時に反転する。
  let finalCardInstances: typeof state.cardInstances;
  if (placement === "trash" || remainderCards.length === 0) {
    finalCardInstances = otherCards;
  } else if (placement === "top") {
    finalCardInstances = insertAtDeckTop(
      otherCards,
      toDeckStorageOrder(remainderCards)
    );
  } else if (placement === "top_bottom_split") {
    assertDeckRevealRemainderPlacementsMap(
      remainderOrder,
      finalizeOptions?.remainderPlacementById
    );
    const placementById = finalizeOptions?.remainderPlacementById ?? {};
    const topCards = remainderCards.filter(
      (card) => placementById[card.instanceId] === "top"
    );
    const bottomCards = remainderCards.filter(
      (card) => placementById[card.instanceId] !== "top"
    );
    finalCardInstances = insertAtDeckBottom(
      insertAtDeckTop(otherCards, toDeckStorageOrder(topCards)),
      toDeckStorageOrder(bottomCards)
    );
  } else {
    finalCardInstances = insertAtDeckBottom(
      otherCards,
      toDeckStorageOrder(remainderCards)
    );
  }

  // 戻す順番は「好きな順番で戻す」型の効果テキスト (例: cardData.js) が示す通り
  // プレイヤーが自由に選べる公開情報。ログも UI/入力契約と同じ「デッキ下から順」で残す。
  // finalCardInstances 確定後の実際の並び (=山札の上から順) から対象カードだけを読み、
  // 反転して下→上へ戻すことで、top/top_bottom_split 個別の挿入ロジック再現を避ける。
  // trash 行きは置き順無意味(P3-93)のため対象外。
  if (
    (pending.revealTo ?? "both") === "both" &&
    placement !== "trash" &&
    deckRemainderSet.size > 0
  ) {
    const orderedRemainderNames = finalCardInstances
      .filter(
        (c) =>
          deckRemainderSet.has(c.instanceId) &&
          c.ownerPlayerId === deckOwnerPlayerId &&
          c.zone === "deck"
      )
      .reverse()
      .map(
        (c) => getCardDefinitionById(c.definitionId)?.name ?? c.definitionId
      );
    if (orderedRemainderNames.length > 0) {
      state.log.push(
        `deck_reveal:remainder_order:${pending.actingPlayerId}:${placement}:${orderedRemainderNames.join(",")}`
      );
    }
  }

  let result: typeof state = replaceCardInstances(
    {
      ...movedState,
      pendingDeckReveal: null,
      pendingDeckRevealSwapChain: state.pendingDeckRevealSwapChain.map(
        resolveDeferredSwapPlacement
      ),
    },
    finalCardInstances
  );

  result = recordHandExchange(
    state,
    result,
    new Set(splitSwapPickedZoneById.keys())
  );

  // ミラージュ無償セット (BSGE01-M04): zone は上の分類ループで既に "mirage" 済み。
  // 既存ミラージュがあれば手札へ戻し、mirageSetStates を更新する。
  for (const id of pending.pickedCardInstanceIds) {
    if (getPickedDestination(id) !== "mirage_set") continue;
    result = applyFreeMirageSetBookkeeping(
      result,
      pending.actingPlayerId,
      id,
      getCardDefinitionById,
      mirageChoice.replacementsByInstanceId[id]
    );
  }

  const pickedExtraZoneEntryIds = pending.pickedCardInstanceIds.filter((id) => {
    if (splitSwapPickedZoneById.has(id)) return true;
    const destination = getPickedDestination(id);
    return destination === "hand" || destination === "set_aside";
  });
  if (pickedExtraZoneEntryIds.length > 0) {
    result = recomputeAndRebuildContinuousEffectsForSources(
      result,
      getCardDefinitionById,
      pickedExtraZoneEntryIds
    );
  }

  // moved_to_trash 自動効果: remainder がトラッシュに行った場合。
  // revealed blocked が hand/swap pick に該当して手札追加に失敗したカードも、
  // 公式裁定（手札に加えられず「他のカード」でもない revealed card は破棄）に従いここで処理する。
  // destination:"trash" で選択されたカード (BSKB01-M01) も同様にトラッシュ着地として扱う。
  const pickedTrashIds = pending.pickedCardInstanceIds.filter(
    (id) => getPickedDestination(id) === "trash"
  );
  const movedToTrashRemainderIds = [
    ...(placement === "trash" ? [...remainderSet] : [...failedHandAddTrashIds]),
    ...pickedTrashIds,
  ];
  if (movedToTrashRemainderIds.length > 0) {
    const srcInst = getCardById(state, pending.sourceInstanceId);
    const srcDef = srcInst
      ? getCardDefinitionById(srcInst.definitionId)
      : undefined;
    // deck_reveal の候補はこの時点で一度 revealed へ移動済みである。元のデッキ起点を
    // 引き継ぐと、「オープン後に破棄された」カードまで deck からの破棄として
    // moved_to_trash 効果を再発火させてしまう。直前の物理ゾーンを共通処理へ渡す。
    result = processMovedToTrashEffects(
      result,
      movedToTrashRemainderIds,
      getCardDefinitionById,
      {
        sourceColors: getEffectiveColors(result, srcInst, srcDef),
        sourceTribes: srcDef?.tribe ? srcDef.tribe.split("・") : [],
        ...(srcDef?.name ? { sourceCardName: srcDef.name } : {}),
        ...(srcDef?.printedCategory
          ? { sourceCategory: srcDef.printedCategory }
          : {}),
        ...(srcInst ? { sourcePlayerId: srcInst.controllerPlayerId } : {}),
        fromZone: "deck",
      },
      state
    );
    result = recomputeAndRebuildContinuousEffectsForSources(
      result,
      getCardDefinitionById,
      movedToTrashRemainderIds
    );
  }

  // swap 受理時に持ち越した入れ替え用の手札選択を emit する。
  // 候補が手札を離れている保険として再フィルタ（reveal 解決中に動いた場合）。
  const pendingSwapOut = pending.pendingSwapOut
    ? resolveDeferredSwapPlacement(pending.pendingSwapOut)
    : undefined;
  if (pendingSwapOut && result.pendingZoneSelection === null) {
    const validCandidates = getCurrentDeckRevealSwapOutCandidateIds({
      state: result,
      pending: pendingSwapOut,
      getCardDefinitionById,
    });
    if (validCandidates.length === 0 && pendingSwapOut.canSkip === false) {
      throw new Error("Cannot emit deck reveal swap without a hand candidate");
    }
    if (validCandidates.length > 0) {
      result = {
        ...result,
        pendingZoneSelection: {
          ...pendingSwapOut,
          candidateCardInstanceIds: validCandidates,
          ...(pending.continuation !== undefined
            ? { continuation: pending.continuation }
            : {}),
          ...(pending.postResolutionOracle !== undefined
            ? { postResolutionOracle: pending.postResolutionOracle }
            : {}),
        },
      };
    }
  }

  // hand_swap / hand_or_set_aside_swap: per-pick swap-out 選択を順次 emit する。
  // 1 件目 = pendingZoneSelection、2 件目以降 = pendingDeckRevealSwapChain。
  // remainder へのフォールバック行き先 (空選択時) は placement (top/bottom/trash) と同等。
  // 正源: 10_rules/07b §BSTH09-C04/C05「手札/手元と入れ替えられる」(裁定 2026-06-17)。
  if (swapPendingPickedIds.length > 0) {
    const swapDestZone =
      placement === "trash"
        ? "trash"
        : placement === "top"
          ? "deck_top"
          : "deck_bottom";
    const fallbackRemainder: "top" | "bottom" | "trash" =
      placement === "top" ? "top" : placement === "trash" ? "trash" : "bottom";
    const allowsPlacementChoice = placement === "top_bottom_split";
    const chain: import("../model").PendingZoneSelection[] = [];
    for (const pickedId of swapPendingPickedIds) {
      const pickedDestination = getPickedDestination(pickedId);
      const handCandidates = getDeckRevealSwapOutHandCandidateIds({
        state: result,
        actingPlayerId: pending.actingPlayerId,
        getCardDefinitionById,
        excludeInstanceIds: swapPendingPickedIds,
      });
      const setAsideCandidates =
        pickedDestination === "hand_or_set_aside_swap"
          ? result.cardInstances
              .filter(
                (c) =>
                  c.ownerPlayerId === pending.actingPlayerId &&
                  c.zone === "set_aside"
              )
              .map((c) => c.instanceId)
          : [];
      // 注: ここでは「現時点の」候補で固定する。実際は chain 解決中に手札が変動するので、
      // 解決時にも再評価する (applyPendingZoneSelection の swapPickedInstanceId 経路)。
      const swapPending: import("../model").PendingZoneSelection = {
        pendingId: `dr-swap:${pending.pendingId}:${pickedId}`,
        actingPlayerId: pending.actingPlayerId,
        sourceInstanceId: pending.sourceInstanceId,
        sourceDefinitionId: pending.sourceDefinitionId,
        actionKind: "discard_hand",
        sourceZone: "hand",
        candidateCardInstanceIds: [...handCandidates, ...setAsideCandidates],
        maxCount: 1,
        // swap-out の物理行き先は picked card の remainder と同じ (deck top/bottom or trash)。
        // ただし PendingZoneSelection.destination は trash/deck_bottom 等の限定値。
        // placement に応じて分岐させる (deck_top は別 destination 値が無いため仮で deck_bottom 採用、
        // 実際の移動は applyPendingZoneSelection 内で swap 経路の特例実装で行う)。
        destination: swapDestZone === "trash" ? "trash" : "deck_bottom",
        remainingActions: [],
        effectTiming: { kind: "continuous" },
        canSkip: true,
        swapPickedInstanceId: pickedId,
        swapPickedFallbackRemainder: fallbackRemainder,
        ...(allowsPlacementChoice ? { swapAllowsPlacementChoice: true } : {}),
        swapCandidateZones:
          pickedDestination === "hand_swap" ? ["hand"] : ["hand", "set_aside"],
        ...(pending.continuation !== undefined
          ? { continuation: pending.continuation }
          : {}),
        ...(pending.postResolutionOracle !== undefined
          ? { postResolutionOracle: pending.postResolutionOracle }
          : {}),
      };
      chain.push(swapPending);
    }
    // 1 件目を emit、残りを chain queue へ
    if (result.pendingZoneSelection === null) {
      result = {
        ...result,
        pendingZoneSelection: chain[0]!,
        pendingDeckRevealSwapChain: chain.slice(1),
      };
    } else {
      // 既に pendingSwapOut が emit 済み (revealed_choice 由来の swap)。chain は後ろに連結。
      result = {
        ...result,
        pendingDeckRevealSwapChain: [
          ...result.pendingDeckRevealSwapChain,
          ...chain,
        ],
      };
    }
  }

  // continuation がある場合は元効果の後続ステップを再実行する
  // (「手札に加えなかったとき、トラッシュから...手札に戻せる」等、
  // ENGINE-deck-reveal-hand-added-tracking)。実際に手札へ加わったカード ID を
  // recordStepId の StepResult (handAddedCardInstanceIds) として注入し、
  // 後続 ref_count(result:"hand_added") がそれを参照できるようにする。
  const continuation = pending.continuation;
  if (continuation && finalizeOptions) {
    const battleEndAttackId = continuation.battleEndDeferralAttackId;
    const resolution = createEffectResolutionScope(continuation);
    const def = getCardDefinitionById(continuation.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, continuation);
    if (effect) {
      const handAddedCardInstanceIds = pending.pickedCardInstanceIds.filter(
        (id) => getPickedDestination(id) === "hand"
      );
      const priorRepeatResult = continuation.repeatResume
        ? continuation.stepContext.results[continuation.recordStepId]
        : undefined;
      const priorHandAddedCardInstanceIds =
        priorRepeatResult?.handAddedCardInstanceIds ?? [];
      const priorRevealedCardInstanceIds =
        priorRepeatResult?.revealedCardInstanceIds ?? [];
      const restoredStepContext = {
        ...continuation.stepContext,
        results: {
          ...continuation.stepContext.results,
          [continuation.recordStepId]: {
            stepId: continuation.recordStepId,
            affectedCardInstanceIds: [
              ...priorHandAddedCardInstanceIds,
              ...handAddedCardInstanceIds,
            ],
            handAddedCardInstanceIds: [
              ...priorHandAddedCardInstanceIds,
              ...handAddedCardInstanceIds,
            ],
            // revealed 全体 (pick/revealed_choice 結果に関係なく「その中の X 1枚につき」を
            // cards_from_ref(result:"revealed") で参照するため、BSLH01-C14 型)。
            // pending.revealedCardInstanceIds は revealed_choice フェーズ完了時に
            // mandatory/optional 消化分を除いた「残り」へ再代入される作業用リストのため、
            // フェーズ遷移で不変の originalRevealedCardInstanceIds を使う
            // (affectedCardInstanceIds=既存 ref target 解決等が依存、とも独立に保持)。
            revealedCardInstanceIds: [
              ...priorRevealedCardInstanceIds,
              ...originalRevealedCardInstanceIds,
            ],
            // 公開は完了済み。手札に加えなかった場合も、後段の任意処理は辞退できる。
            executed: true,
            succeeded:
              priorHandAddedCardInstanceIds.length +
                handAddedCardInstanceIds.length >
              0,
          },
        },
      };
      if (result.pendingMultiPlacement) {
        return {
          ...result,
          pendingMultiPlacement: {
            ...result.pendingMultiPlacement,
            continuation: { ...continuation, stepContext: restoredStepContext },
          },
        };
      }
      // deck_reveal の一時停止/再開を跨いで pendingTargetedDisclosureContinuation が
      // 失われないよう、pending 生成時に保持した値を再開直前に復元する
      // (StepOptionalContinuation と同型の resume パターン、needs-dsl.audit
      // BSLH01-R06/BSLH01-C01)。
      const deckRevealResumeState =
        continuation.targetedDisclosureContinuation !== undefined
          ? {
              ...result,
              pendingTargetedDisclosureContinuation:
                continuation.targetedDisclosureContinuation,
            }
          : result;
      result = resolution.execute({
        state: deckRevealResumeState,
        effect,
        effectIndex: continuation.effectIndex,
        ...(continuation.divineSkillIndex !== undefined
          ? { divineSkillIndex: continuation.divineSkillIndex }
          : {}),
        ...(continuation.isAccelData !== undefined
          ? { isAccelData: continuation.isAccelData }
          : {}),
        ...(continuation.isChangeData !== undefined
          ? { isChangeData: continuation.isChangeData }
          : {}),
        sourceInstanceId: continuation.sourceInstanceId,
        actingPlayerId: continuation.actingPlayerId,
        ...(continuation.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
          : {}),
        ...(continuation.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: continuation.effectSourceDefinitionId }
          : {}),
        ...(continuation.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId:
                continuation.sourceCardReferenceInstanceId,
            }
          : {}),
        targetedDisclosureSourceDefinitionId: continuation.sourceDefinitionId,
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          finalizeOptions.getRegisteredTriggeredEffectActions,
        ...(finalizeOptions.getRegisteredBurstActions !== undefined
          ? {
              getRegisteredBurstActions:
                finalizeOptions.getRegisteredBurstActions,
            }
          : {}),
        startFromStepIndex: continuation.resumeStepIndex,
        restoredStepContext,
        resumePreviousStepPreState: pending.priorStateSnapshot ?? state,
        ...(continuation.repeatResume !== undefined
          ? { repeatResume: continuation.repeatResume }
          : {}),
        ...(continuation.choiceIndex !== undefined
          ? { choiceIndex: continuation.choiceIndex }
          : {}),
        ...(continuation.effectActionKind !== undefined
          ? { effectActionKind: continuation.effectActionKind }
          : {}),
        ...(continuation.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
          : {}),
        ...(continuation.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
          : {}),
        ...(continuation.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: continuation.costPaidThisEffect }
          : {}),
        ...(continuation.postResolutionOracle !== undefined
          ? { postResolutionOracle: continuation.postResolutionOracle }
          : {}),
        ...(battleEndAttackId !== undefined
          ? {
              battleEndDeferralAttackId: battleEndAttackId,
            }
          : {}),
      });
      result = checkAndQueuePostResolutionOracleIfReady(
        result,
        continuation.postResolutionOracle,
        getCardDefinitionById,
        finalizeOptions.getRegisteredTriggeredEffectActions,
        finalizeOptions.getRegisteredBurstActions
      );
    }
  }

  const afterMagicCleanup = cleanupCompletedInUseMagicSourceIfReady({
    state: result,
    sourceInstanceId: pending.sourceInstanceId,
    chainId:
      pending.continuation?.chainId ??
      pending.postResolutionOracle?.chainId ??
      `deck-reveal:${pending.pendingId}`,
    getCardDefinitionById,
  });

  // 解決境界は呼び出し元（通常effect / pending action）が一度だけ確定する。
  return afterMagicCleanup;
}

/**
 * ZoneSelection pending の解決。
 * プレイヤーが選択したカードを目的ゾーンに移動し、残りアクションを再実行する。
 */
export function applyPendingZoneSelectionAction(
  options: ApplyLegalActionOptions
): ResolvePendingZoneSelectionResult {
  const pending = options.state.pendingZoneSelection;
  if (!pending) {
    throw new Error("No pending zone selection to resolve");
  }

  let selectedIds = options.selectedZoneCardIds ?? [];
  const canSkip = pending.canSkip ?? true;
  const alternates = pending.alternateSelections ?? [];
  const candidateSet = new Set(pending.candidateCardInstanceIds);

  if (new Set(selectedIds).size !== selectedIds.length) {
    throw new Error("Zone selection contains duplicate card instance IDs");
  }

  // primary 検証: 全 id が primary 候補内 + 数量条件。
  // canSkip=true (up-to): 0..maxCount で OK。
  // canSkip=false (exact): ちょうど maxCount のみ OK。
  const allInPrimary = selectedIds.every((id) => candidateSet.has(id));
  const primarySatisfied = canSkip
    ? allInPrimary && selectedIds.length <= pending.maxCount
    : allInPrimary && selectedIds.length === pending.maxCount;

  // alternate 検証: ちょうど alt.count 枚 + 全 id が alt 候補内。
  const matchedAlternate = alternates.find((alt) => {
    if (selectedIds.length !== alt.count) return false;
    const altSet = new Set(alt.candidateInstanceIds);
    return selectedIds.every((id) => altSet.has(id));
  });

  // skip パス (空選択)
  if (selectedIds.length === 0) {
    if (!canSkip && getZoneSelectionHandGainCost(options.state, pending) <= 0) {
      throw new Error(
        `Zone selection cannot be skipped (mandatory): ${pending.actionKind}`
      );
    }
    // canSkip=true で空選択 = skip。primary 候補内/外チェックも不要。
  } else if (!primarySatisfied && !matchedAlternate) {
    // どの条件も満たさない: 詳細エラー
    if (!allInPrimary) {
      const offending = selectedIds.find((id) => !candidateSet.has(id));
      const inAnyAlt =
        offending !== undefined &&
        alternates.some((a) => a.candidateInstanceIds.includes(offending));
      if (!inAnyAlt) {
        throw new Error(`Selected card is not a candidate: ${offending}`);
      }
    }
    if (selectedIds.length > pending.maxCount) {
      throw new Error(
        `Zone selection count exceeds max: ${selectedIds.length} > ${pending.maxCount}`
      );
    }
    throw new Error(
      `Zone selection does not satisfy any criterion: selected=${selectedIds.length}, required ${canSkip ? `<=${pending.maxCount}` : `==${pending.maxCount}`}` +
        (alternates.length > 0
          ? ` or alternate(${alternates.map((a) => a.count).join("/")})`
          : "")
    );
  }

  if (pending.braveCapacityHostInstanceId !== undefined) {
    return {
      state: finalizeRuleBraveSeparation(
        resolveBraveCapacitySelection(
          options.state,
          selectedIds,
          options.getCardDefinitionById
        ),
        pending,
        options
      ),
    };
  }

  const zoneSelectionDestinationByCardId =
    options.zoneSelectionDestinationByCardId ?? {};
  if (
    pending.destination === "hand_or_set_aside_choice" &&
    selectedIds.length > 0
  ) {
    const selectedSet = new Set(selectedIds);
    for (const id of Object.keys(zoneSelectionDestinationByCardId)) {
      if (!selectedSet.has(id)) {
        throw new Error(
          `Zone selection destination specified for unselected card: ${id}`
        );
      }
    }
    for (const id of selectedIds) {
      const destination = zoneSelectionDestinationByCardId[id];
      if (destination !== "hand" && destination !== "set_aside") {
        throw new Error(
          `Zone selection destination "hand_or_set_aside_choice" requires zoneSelectionDestinationByCardId for selected card: ${id}`
        );
      }
    }
  }

  const resolveZoneSelectionDestination = (
    cardInstanceId: string
  ): "hand" | "set_aside" => {
    const destination = zoneSelectionDestinationByCardId[cardInstanceId];
    if (destination !== "hand" && destination !== "set_aside") {
      throw new Error(
        `Zone selection destination "hand_or_set_aside_choice" requires zoneSelectionDestinationByCardId for selected card: ${cardInstanceId}`
      );
    }
    return destination;
  };

  // 「手札/手元に戻す」の二択は、候補時点では手元へ置く正当な選択を残す。
  // ただし手札を選んだ確定時には、受益者自身が発揮した効果かを含めて X01/C02 を
  // 再評価する。pending の選択者は効果発揮者と異なり得るため、effectActingPlayerId を
  // 優先する。C02 は同一効果の複数枚 hand 選択でも一度だけ支払う。
  if (pending.destination === "hand_or_set_aside_choice") {
    const effectActingPlayerId =
      pending.effectActingPlayerId ?? pending.actingPlayerId;
    for (const id of selectedIds) {
      if (resolveZoneSelectionDestination(id) !== "hand") continue;
      const card = getCardById(options.state, id);
      const recipientPlayerId =
        pending.targetPlayerId ?? card?.ownerPlayerId ?? pending.actingPlayerId;
      if (
        isHandGainPreventedByOwnEffect(
          options.state,
          recipientPlayerId,
          effectActingPlayerId
        )
      ) {
        throw new Error(
          `Zone selection destination "hand" blocked by hand_gain_prevention: ${id}`
        );
      }
    }
  }

  let currentState = { ...options.state, log: [...options.state.log] };
  const handGainCost = getZoneSelectionHandGainCost(
    currentState,
    pending,
    selectedIds,
    zoneSelectionDestinationByCardId
  );
  if (handGainCost > 0) {
    const payment = payHandGainCost(
      currentState,
      {
        ...pending,
        actingPlayerId: pending.effectActingPlayerId ?? pending.actingPlayerId,
      },
      handGainCost,
      options.getCardDefinitionById,
      options.paymentSources
    );
    currentState = payment.state;
    if (!payment.canGain)
      selectedIds = selectedIds.filter(
        (id) =>
          getZoneSelectionHandGainCost(
            options.state,
            pending,
            [id],
            zoneSelectionDestinationByCardId
          ) === 0
      );
  }
  const extraZoneEntryIds = new Set<string>();
  let needsFullContinuousRebuildAfterZoneSelection = false;

  if (pending.deckRevealResumeAfterSwapSelection) {
    const pickedId = pending.swapPickedInstanceId;
    if (!pickedId) {
      throw new Error("Deck reveal split swap selection is missing picked id");
    }
    const selectedSwapOutId = selectedIds[0] ?? null;
    const resumedPending: PendingDeckReveal = {
      ...pending.deckRevealResumeAfterSwapSelection,
      swapOutByPickedInstanceId: {
        ...(pending.deckRevealResumeAfterSwapSelection
          .swapOutByPickedInstanceId ?? {}),
        [pickedId]: selectedSwapOutId,
      },
    };
    currentState.log.push(
      selectedSwapOutId
        ? `deck_reveal:split_swap_select:${pickedId}<-${selectedSwapOutId}`
        : `deck_reveal:split_swap_skip:${pickedId}`
    );
    const nextSplitSwapPending = createDeckRevealSplitSwapSelectionPending(
      currentState,
      resumedPending,
      options.getCardDefinitionById
    );
    return {
      state: {
        ...currentState,
        pendingDeckReveal: nextSplitSwapPending ? null : resumedPending,
        pendingZoneSelection: nextSplitSwapPending,
      },
    };
  }

  // deck_reveal の per-pick 「手札/手元と入れ替え」(BSTH09-C04/C05) 経路。
  // 通常の discard_hand 移動を行わず、選択 1 枚を picked card の行き先 (remainder と同じ) へ送り、
  // 同じ位置に picked card を入れる「物理 1 対 1 交換」を実行する。
  // 空選択 (skip) のときは picked card を fallback remainder 行き先へ送るのみ。
  // 解決後は chain queue から次の swap-out 選択を emit する。
  // 正源: 10_rules/07b §BSTH09-C04/C05「手札/手元と入れ替えられる」(裁定 2026-06-17)。
  if (pending.swapPickedInstanceId) {
    const pickedId = pending.swapPickedInstanceId;
    const fallbackRemainder = pending.swapPickedFallbackRemainder ?? "bottom";
    const swapRemainder =
      pending.swapAllowsPlacementChoice === true &&
      fallbackRemainder !== "trash"
        ? (options.deckRevealPlacement ?? fallbackRemainder)
        : fallbackRemainder;
    const placePicked = (
      st: GameState,
      destZone: "hand" | "set_aside" | "deck" | "trash"
    ): GameState => {
      // picked card は revealed 状態でホールド中。最終ゾーンに配置する。
      let next = moveCardZone(st, pickedId, destZone);
      if (destZone === "deck") {
        next = moveDeckCardsToPosition(
          next,
          pending.actingPlayerId,
          [pickedId],
          swapRemainder === "top" ? "top" : "bottom"
        );
      }
      return next;
    };

    if (selectedIds.length === 0) {
      // skip: picked card を remainder と同じ行き先へ送る (swap 諦め)。
      currentState.log.push(
        `effect:deck_reveal_swap:${pending.actingPlayerId}:skip:${pickedId}->${swapRemainder}`
      );
      if (swapRemainder === "trash") {
        currentState = placePicked(currentState, "trash");
      } else {
        currentState = placePicked(currentState, "deck");
      }
    } else {
      // 1 枚選択: その card を picked と同じ remainder 行き先へ、picked を元ゾーンへ。
      const swappedOutId = selectedIds[0]!;
      const swappedOutInst = getCardById(currentState, swappedOutId);
      const swappedOutOriginZone: "hand" | "set_aside" =
        swappedOutInst?.zone === "set_aside" ? "set_aside" : "hand";
      // ENGINE-set-aside-entry-restriction: 「手札/手元と入れ替え」で picked card が
      // 手元(set_aside)側へ入る組み合わせのとき、destination-zone-scoped resistance
      // (cannot_enter_zone) で阻止される対象なら選択自体を拒否する。
      if (swappedOutOriginZone === "set_aside") {
        const pickedCard = getCardById(currentState, pickedId);
        if (
          pickedCard &&
          isZoneEntryBlockedByResistance(
            currentState,
            pickedCard,
            "set_aside",
            pending.actingPlayerId,
            options.getCardDefinitionById
          )
        ) {
          throw new Error(
            `Deck reveal swap into set_aside blocked by resistance: ${pickedId}`
          );
        }
      }
      currentState.log.push(
        `effect:deck_reveal_swap:${pending.actingPlayerId}:swap:${pickedId}<->${swappedOutId}(${swappedOutOriginZone}->${swapRemainder})`
      );
      // swap-out をデッキ/トラッシュへ
      if (swapRemainder === "trash") {
        currentState = moveCardZone(currentState, swappedOutId, "trash");
      } else {
        currentState = moveCardZone(currentState, swappedOutId, "deck");
        currentState = moveDeckCardsToPosition(
          currentState,
          pending.actingPlayerId,
          [swappedOutId],
          swapRemainder === "top" ? "top" : "bottom"
        );
      }
      // picked card を swap-out の元ゾーンへ
      currentState = placePicked(currentState, swappedOutOriginZone);
      currentState = recordHandExchange(
        options.state,
        currentState,
        new Set([pickedId])
      );
    }

    // 次の swap pending を chain から dequeue
    const chain = currentState.pendingDeckRevealSwapChain;
    if (chain.length > 0) {
      const [nextPending, ...rest] = chain;
      // 動的再評価: 候補は pending の swap 制約に従って現在ゾーンから取り直す。
      const candidates = getCurrentDeckRevealSwapOutCandidateIds({
        state: currentState,
        pending: nextPending!,
        getCardDefinitionById: options.getCardDefinitionById,
      });
      currentState = {
        ...currentState,
        pendingZoneSelection: {
          ...nextPending!,
          candidateCardInstanceIds: candidates,
        },
        pendingDeckRevealSwapChain: rest,
      };
    } else {
      currentState = {
        ...currentState,
        pendingZoneSelection: null,
        pendingDeckRevealSwapChain: [],
      };
    }
    currentState = checkAndQueuePostResolutionOracleIfReady(
      currentState,
      pending.postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
    currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      currentState,
      options
    );
    currentState = resumeStackCascadeAfterPendingCloses(currentState, options);
    currentState = cleanupCompletedInUseMagicSourceIfReady({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      chainId:
        pending.continuation?.chainId ??
        pending.postResolutionOracle?.chainId ??
        `zone-selection:${pending.pendingId}`,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    return { state: currentState };
  }

  // アクション種別に応じてカードを移動。pending 解決で耐性等により実際に動かなかった
  // カードは continuation の StepResult に含めない。
  let resolvedZoneSelectionIds = selectedIds;
  switch (pending.actionKind) {
    case "bounce": {
      const context = pending.bounceContext;
      if (!context) throw new Error("Missing bounce context");
      currentState = executeBounce(
        currentState,
        pending.actingPlayerId,
        {
          ...context.action,
          destinationByCardId: zoneSelectionDestinationByCardId,
        },
        options.getCardDefinitionById,
        pending.sourceInstanceId,
        selectedIds,
        pending.sourcePreventionLevel,
        context.sourceTargetLockBypass,
        pending.sourcePreventionBypass,
        context.effectSourceInstanceId,
        context.effectSourceDefinitionId,
        context.pendingLeaveChainId
      );
      break;
    }
    case "advent_source": {
      const preparation = pending.adventPreparation;
      if (!preparation) throw new Error("Missing advent preparation context");
      currentState = { ...currentState, pendingZoneSelection: null };
      currentState = preparation.declaredStack
        ? resolveDeferredAdventStack(
            currentState,
            {
              ...preparation.declaredStack,
              adventSelectedSourceIds: selectedIds,
            },
            options
          )
        : executeEffectAdvent(
            currentState,
            pending.actingPlayerId,
            { ...preparation.params, selectedSourceIds: selectedIds },
            options.getCardDefinitionById
          );
      needsFullContinuousRebuildAfterZoneSelection = true;
      break;
    }
    case "search_deck": {
      currentState.log.push(
        `effect:search_deck:${pending.actingPlayerId}:${selectedIds.length}:${pending.destination}`
      );
      if (pending.destination === "hand") {
        for (const id of selectedIds) {
          currentState = moveCardZone(currentState, id, "hand");
          extraZoneEntryIds.add(id);
        }
      } else if (pending.destination === "set_aside") {
        for (const id of selectedIds) {
          currentState = moveCardZone(currentState, id, "set_aside");
          extraZoneEntryIds.add(id);
        }
      } else if (pending.destination === "hand_or_set_aside_choice") {
        for (const id of selectedIds) {
          const destination = resolveZoneSelectionDestination(id);
          if (destination === "set_aside") {
            const card = getCardById(currentState, id);
            if (
              card &&
              isZoneEntryBlockedByResistance(
                currentState,
                card,
                "set_aside",
                pending.actingPlayerId,
                options.getCardDefinitionById,
                pending.sourcePreventionLevel ?? "none",
                pending.sourcePreventionBypass
              )
            ) {
              throw new Error(
                `Zone selection into set_aside blocked by resistance: ${id}`
              );
            }
          }
          currentState = moveCardZone(currentState, id, destination);
          extraZoneEntryIds.add(id);
        }
      } else if (pending.destination === "field") {
        for (const id of selectedIds) {
          const card = currentState.cardInstances.find(
            (instance) => instance.instanceId === id
          );
          currentState = placeCardFromZoneToField(
            currentState,
            id,
            options.getCardDefinitionById,
            isEffectSummonFieldEntry(
              card && options.getCardDefinitionById(card.definitionId)
            )
              ? "summon"
              : "place"
          );
          if (getCardById(currentState, id)?.zone === "field") {
            currentState.log.push(
              getSearchDeckFieldEntryLogEntry(
                pending.actingPlayerId,
                id,
                card
                  ? options.getCardDefinitionById(card.definitionId)
                  : undefined
              )
            );
          }
        }
      } else if (pending.destination === "deck") {
        const position = pending.destinationPosition ?? "bottom";
        currentState.log.push(
          `effect:search_deck:${pending.actingPlayerId}:${selectedIds.length}:deck:${position}`
        );
        const deckOwnerPlayerId =
          pending.targetPlayerId ?? pending.actingPlayerId;
        currentState = moveDeckCardsToPosition(
          currentState,
          deckOwnerPlayerId,
          selectedIds,
          position
        );
        currentState = rememberKnownDeckCardsByInstanceIds({
          state: currentState,
          playerId: deckOwnerPlayerId,
          instanceIds: selectedIds,
          audience: "actor_only",
          actorPlayerId: pending.actingPlayerId,
        });
      }
      break;
    }
    case "return_from_trash": {
      currentState.log.push(
        `effect:return_from_trash:${pending.actingPlayerId}:${selectedIds.length}:${pending.destination}`
      );
      // destination === "field": 共通配置プリミティブでフィールドへ配置
      // (配置時誘発は呼び出し側の差分検出が自動発火)。
      // destination === "deck": トラッシュ→デッキ。相手トラッシュ操作では targetPlayerId の
      // deckCount を増やす。
      // destination === "removed_from_game": トラッシュ→除外 (BSTH08-XX01 effects[1])。
      // それ以外は従来どおり手札へ。
      if (pending.destination === "field") {
        for (const id of selectedIds) {
          currentState = placeCardFromZoneToField(
            currentState,
            id,
            options.getCardDefinitionById
          );
          if (getCardById(currentState, id)?.zone === "field") {
            currentState.log.push(
              `effect:field_place:return_from_trash:${pending.actingPlayerId}:${id}`
            );
          }
        }
      } else if (pending.destination === "deck") {
        currentState.log.push(
          `effect:return_from_trash:${pending.actingPlayerId}:${selectedIds.length}:deck:${pending.destinationPosition ?? "unspecified"}`
        );
        const selectedIdSet = new Set(selectedIds);
        const coresToReserve = currentState.cardInstances
          .filter((card) => selectedIdSet.has(card.instanceId))
          .reduce((sum, card) => sum + card.normalCoreCount, 0);
        currentState = replaceCardInstances(
          {
            ...currentState,
          },
          currentState.cardInstances.map((card) =>
            selectedIdSet.has(card.instanceId)
              ? applyFaceDownPolicyOnZoneChange(
                  {
                    ...card,
                    zone: "deck",
                    normalCoreCount: 0,
                    exhaustState: "recovered",
                    attachedToInstanceId: null,
                    attachedChildrenIds: [],
                    underCards: [],
                  },
                  "deck"
                )
              : card
          )
        );
        currentState = updatePlayer(
          currentState,
          pending.targetPlayerId ?? pending.actingPlayerId,
          (p) => ({
            ...p,
            reserveNormalCoreCount: p.reserveNormalCoreCount + coresToReserve,
          })
        );
        currentState = moveDeckCardsToPosition(
          currentState,
          pending.targetPlayerId ?? pending.actingPlayerId,
          selectedIds,
          pending.destinationPosition ?? "bottom"
        );
      } else if (pending.destination === "removed_from_game") {
        const effectActingPlayerId =
          pending.effectActingPlayerId ?? pending.actingPlayerId;
        currentState = executeRemoveFromGame(
          currentState,
          effectActingPlayerId,
          {
            kind: "remove_from_game",
            target: {
              player:
                (pending.targetPlayerId ?? pending.actingPlayerId) ===
                effectActingPlayerId
                  ? "self"
                  : "opponent",
              zone: [
                ...new Set(
                  selectedIds.flatMap((id) => {
                    const c = getCardById(currentState, id);
                    return c ? [c.zone] : [];
                  })
                ),
              ],
              count: selectedIds.length,
            },
          },
          options.getCardDefinitionById,
          pending.sourceInstanceId,
          selectedIds,
          pending.sourcePreventionLevel,
          pending.continuation?.sourceTargetLockBypass,
          pending.sourcePreventionBypass,
          pending.continuation?.chainId,
          pending.continuation?.battleEndDeferralAttackId
        );
        resolvedZoneSelectionIds = selectedIds.filter(
          (id) => getCardById(currentState, id)?.zone === "removed_from_game"
        );
      } else if (pending.destination === "set_aside") {
        for (const id of selectedIds) {
          currentState = moveCardZone(currentState, id, "set_aside");
          extraZoneEntryIds.add(id);
        }
      } else if (pending.destination === "hand_or_set_aside_choice") {
        for (const id of selectedIds) {
          const destination = resolveZoneSelectionDestination(id);
          if (destination === "set_aside") {
            const card = getCardById(currentState, id);
            if (
              card &&
              isZoneEntryBlockedByResistance(
                currentState,
                card,
                "set_aside",
                pending.actingPlayerId,
                options.getCardDefinitionById,
                pending.sourcePreventionLevel ?? "none",
                pending.sourcePreventionBypass
              )
            ) {
              throw new Error(
                `Zone selection into set_aside blocked by resistance: ${id}`
              );
            }
          }
          currentState = moveCardZone(currentState, id, destination);
          extraZoneEntryIds.add(id);
        }
      } else {
        for (const id of selectedIds) {
          currentState = moveCardZone(currentState, id, "hand");
          extraZoneEntryIds.add(id);
        }
      }
      break;
    }
    case "discard_hand": {
      const beforeDiscardState = currentState;
      // 行き先: 通常は trash。`deck_bottom` 指定時はデッキの下へ戻す（BSRK01-C03）。
      // actionKind 名は従来互換だが、DiscardAction.fromZone="deck" のミル選択もここを通る。
      // 枚数と誘発の移動元には論理上の手札でなく各カードの物理ゾーンを使う。
      // デッキ破棄は selection 中にも継続効果を再評価する。開始時に有効だった
      // prevent/redirect を固定すると、選択待ちに入った後に有効化された C21/X02 を
      // 見落とし、逆に期限切れ redirect を残してしまう。
      const isDeckDiscardPending =
        pending.sourceZone === "deck" &&
        (pending.destination === "trash" ||
          pending.destination === "removed_from_game");
      const targetPlayerId = pending.targetPlayerId ?? pending.actingPlayerId;
      const sourceCard = getCardById(currentState, pending.sourceInstanceId);
      const sourceDefinition = sourceCard
        ? options.getCardDefinitionById(sourceCard.definitionId)
        : options.getCardDefinitionById(pending.sourceDefinitionId);
      const effectSource = {
        ...(sourceCard ? { instance: sourceCard } : {}),
        ...(sourceDefinition ? { definition: sourceDefinition } : {}),
      };
      const effectActingPlayerId =
        pending.effectActingPlayerId ??
        sourceCard?.controllerPlayerId ??
        pending.actingPlayerId;
      const sourcePreventionLevel = pending.sourcePreventionLevel ?? "none";
      const deckDiscardBlocked =
        isDeckDiscardPending &&
        resolveDeckDiscardContainerAffect(
          currentState,
          targetPlayerId,
          options.getCardDefinitionById,
          sourcePreventionLevel,
          pending.sourcePreventionBypass
        ).kind !== "allowed";
      const discardDestination =
        isDeckDiscardPending &&
        !deckDiscardBlocked &&
        isDeckDiscardExcludeRedirectActive(currentState, targetPlayerId)
          ? "removed_from_game"
          : isDeckDiscardPending
            ? "trash"
            : pending.destination;
      const resolvedDiscardIds =
        isDeckDiscardPending && deckDiscardBlocked
          ? []
          : isDeckDiscardPending
            ? selectedIds.filter((id) => {
                const card = getCardById(currentState, id);
                if (!card || card.zone !== "deck") return false;
                const sourceAllowed =
                  resolveCardImmunityAffect(
                    currentState,
                    card,
                    effectActingPlayerId,
                    sourcePreventionLevel,
                    effectSource,
                    options.getCardDefinitionById,
                    pending.sourcePreventionBypass
                  ).kind === "allowed";
                return sourceAllowed;
              })
            : selectedIds;
      resolvedZoneSelectionIds = resolvedDiscardIds;
      if (deckDiscardBlocked) {
        currentState.log.push(
          `effect:discard_deck:${targetPlayerId}:immune:no-discardable`
        );
      }
      const skippedDiscardCount =
        selectedIds.length - resolvedDiscardIds.length;
      if (skippedDiscardCount > 0 && !deckDiscardBlocked) {
        currentState.log.push(
          `effect:discard_deck:immune:skipped:${skippedDiscardCount}`
        );
      }
      if (discardDestination === "deck_bottom") {
        currentState.log.push(
          `effect:discard_hand:${pending.actingPlayerId}:deck_bottom:${resolvedDiscardIds.length}`
        );
        for (const id of resolvedDiscardIds) {
          currentState = moveCardZone(currentState, id, "deck", undefined);
          if (pending.sourceZone === "mirage") {
            currentState = removeMirageSetState(currentState, id);
          }
        }
        currentState = moveDeckCardsToPosition(
          currentState,
          targetPlayerId,
          resolvedDiscardIds,
          "bottom"
        );
        if (resolvedDiscardIds.length > 0) {
          needsFullContinuousRebuildAfterZoneSelection = true;
        }
      } else {
        currentState.log.push(
          `effect:discard_hand:${pending.actingPlayerId}:${resolvedDiscardIds.length}`
        );
        for (const id of resolvedDiscardIds) {
          currentState = moveCardZone(
            currentState,
            id,
            discardDestination === "removed_from_game"
              ? "removed_from_game"
              : "trash",
            undefined
          );
          if (pending.sourceZone === "mirage") {
            currentState = removeMirageSetState(currentState, id);
          }
        }
        if (resolvedDiscardIds.length > 0) {
          needsFullContinuousRebuildAfterZoneSelection = true;
        }
        if (discardDestination === "trash") {
          currentState = processPendingZoneSelectionMovedToTrashEffects({
            state: currentState,
            beforeMoveState: beforeDiscardState,
            pending,
            movedToTrashIds: resolvedDiscardIds,
            getCardDefinitionById: options.getCardDefinitionById,
          });
        }
      }
      break;
    }
    case "move_to_set_aside": {
      currentState.log.push(
        `effect:move_to_set_aside:${pending.actingPlayerId}:${selectedIds.length}`
      );
      for (const id of selectedIds) {
        currentState = moveCardZone(currentState, id, "set_aside");
        extraZoneEntryIds.add(id);
      }
      break;
    }
  }

  // pending クリア
  currentState = { ...currentState, pendingZoneSelection: null };
  if (
    currentState.pendingSetAsideExitReplacementChoice &&
    pending.continuation
  ) {
    // searchの対象選択から置換選択へ元の本文継続を移し、先行再開しない。
    return {
      state: {
        ...currentState,
        pendingSetAsideExitReplacementChoice: {
          ...currentState.pendingSetAsideExitReplacementChoice,
          continuation: {
            ...pending.continuation,
            resumePreviousStepPreState:
              pending.priorStateSnapshot ?? options.state,
          },
          stepResultId: pending.continuation.recordStepId,
        },
      },
    };
  }
  if (needsFullContinuousRebuildAfterZoneSelection) {
    currentState = recomputeAndRebuildContinuousEffects(
      currentState,
      options.getCardDefinitionById
    );
  } else if (extraZoneEntryIds.size > 0) {
    currentState = recomputeAndRebuildContinuousEffectsForSources(
      currentState,
      options.getCardDefinitionById,
      extraZoneEntryIds
    );
  }
  currentState = emitNextDeckRevealSwapPendingIfReady(
    currentState,
    options.getCardDefinitionById
  );
  const zoneSelectionFieldEntryBeforeState =
    pending.priorStateSnapshot ?? options.state;
  const shouldFinalizeZoneSelectionFieldEntry =
    !pending.adventPreparation?.declaredStack;
  let finalizedZoneSelectionFieldEntry = false;

  currentState = recordHandEntries(options.state, currentState);

  // 後続stepの有無によらず、維持コア選択へ元効果の原因と選択前盤面を引き継ぐ。
  if (currentState.pendingMultiPlacement) {
    currentState = {
      ...currentState,
      pendingMultiPlacement: {
        ...currentState.pendingMultiPlacement,
        sourceInstanceId:
          pending.continuation?.sourceInstanceId ?? pending.sourceInstanceId,
        sourceDefinitionId:
          pending.continuation?.sourceDefinitionId ??
          pending.sourceDefinitionId,
        effectActingPlayerId:
          pending.continuation?.actingPlayerId ??
          pending.effectActingPlayerId ??
          pending.actingPlayerId,
        effectTiming: pending.effectTiming,
        ...(pending.continuation?.effectIndex !== undefined
          ? { sourceEffectIndex: pending.continuation.effectIndex }
          : {}),
        priorStateSnapshot: zoneSelectionFieldEntryBeforeState,
      },
    };
  }

  // continuation がある場合は元効果の後続ステップを再実行する
  // (「手札N枚まで破棄→破棄1枚につき2枚ドロー」等)。選択カード (selectedIds) を
  // recordStepId の StepResult として注入し、後続 cards_from_ref が参照できるようにする。
  const continuation = pending.continuation;
  if (continuation) {
    const battleEndAttackId = continuation.battleEndDeferralAttackId;
    const resolution = createEffectResolutionScope(continuation);
    const def = options.getCardDefinitionById(continuation.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, continuation);
    if (effect) {
      // SerializedStepContext の追加フィールド (triggerRelatedInstanceId 等) を保持しつつ
      // results を新しい recordStepId エントリで上書きする (verifier 2026-06-22 round 13
      // lens 4 補正、Zone-selection 再開で trigger_related_instance Y が空に落ちる silent gap)。
      const resolvedAdventId =
        pending.adventPreparation?.params.adventCardInstanceId;
      const resultIds = resolvedAdventId
        ? currentState.cardInstances
            .filter(
              (c) =>
                c.instanceId === resolvedAdventId &&
                c.zone === "field" &&
                c.underCards.some(
                  (under) =>
                    under.cardInstanceId ===
                    pending.adventPreparation!.params.targetInstanceId
                )
            )
            .map((c) => c.instanceId)
        : pending.actionKind === "bounce"
          ? selectedIds.filter((id) => {
              const card = getCardById(currentState, id);
              return (
                card?.pendingLeaveKind === "bounce" ||
                (card !== undefined &&
                  card.zone === zoneSelectionDestinationByCardId[id])
              );
            })
          : pending.actionKind === "discard_hand"
            ? resolvedZoneSelectionIds
            : pending.destination === "field"
              ? selectedIds.filter(
                  (id) => getCardById(currentState, id)?.zone === "field"
                )
              : pending.destination === "removed_from_game"
                ? resolvedZoneSelectionIds
                : selectedIds;
      const restoredStepContext = {
        ...continuation.stepContext,
        results: {
          ...continuation.stepContext.results,
          [continuation.recordStepId]: {
            stepId: continuation.recordStepId,
            affectedCardInstanceIds: [...resultIds],
            succeeded: resultIds.length > 0,
          },
        },
      };
      const beforeResume = currentState;
      if (currentState.pendingMultiPlacement) {
        return {
          state: {
            ...currentState,
            pendingMultiPlacement: {
              ...currentState.pendingMultiPlacement,
              priorStateSnapshot: zoneSelectionFieldEntryBeforeState,
              continuation: {
                ...continuation,
                chainId: requireTriggerChainId(continuation.chainId),
                stepContext: restoredStepContext,
              },
            },
          },
        };
      }
      if (pending.adventPreparation && currentState.pendingCoreDistribution) {
        currentState = resolution.finalize({
          state: currentState,
          beforeState: zoneSelectionFieldEntryBeforeState,
          endLogs: [],
          actingPlayerId: continuation.actingPlayerId,
          causedBySourceInstanceId:
            continuation.effectSourceInstanceId ??
            continuation.sourceInstanceId,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
        });
        return {
          state: {
            ...currentState,
            pendingCoreDistribution: {
              ...currentState.pendingCoreDistribution!,
              continuation: {
                ...continuation,
                chainId: requireTriggerChainId(continuation.chainId),
                stepContext: restoredStepContext,
              },
            },
          },
        };
      }
      // zone_selection の一時停止/再開を跨いだ pendingTargetedDisclosureContinuation 消失対策
      // (deck_reveal と同型、needs-dsl.audit BSLH01-R06/BSLH01-C01 修正の一環)。
      const zoneSelectionResumeState =
        continuation.targetedDisclosureContinuation !== undefined
          ? {
              ...currentState,
              pendingTargetedDisclosureContinuation:
                continuation.targetedDisclosureContinuation,
            }
          : currentState;
      currentState = resolution.execute({
        state: zoneSelectionResumeState,
        effect,
        effectIndex: continuation.effectIndex,
        ...(continuation.divineSkillIndex !== undefined
          ? { divineSkillIndex: continuation.divineSkillIndex }
          : {}),
        ...(continuation.isAccelData !== undefined
          ? { isAccelData: continuation.isAccelData }
          : {}),
        ...(continuation.isChangeData !== undefined
          ? { isChangeData: continuation.isChangeData }
          : {}),
        sourceInstanceId: continuation.sourceInstanceId,
        actingPlayerId: continuation.actingPlayerId,
        ...(continuation.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
          : {}),
        ...(continuation.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: continuation.effectSourceDefinitionId }
          : {}),
        ...(continuation.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId:
                continuation.sourceCardReferenceInstanceId,
            }
          : {}),
        targetedDisclosureSourceDefinitionId: continuation.sourceDefinitionId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        startFromStepIndex: continuation.resumeStepIndex,
        restoredStepContext,
        ...(pending.priorStateSnapshot !== undefined
          ? { resumePreviousStepPreState: pending.priorStateSnapshot }
          : {}),
        ...(continuation.choiceIndex !== undefined
          ? { choiceIndex: continuation.choiceIndex }
          : {}),
        ...(continuation.effectActionKind !== undefined
          ? { effectActionKind: continuation.effectActionKind }
          : {}),
        ...(continuation.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
          : {}),
        ...(continuation.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
          : {}),
        ...(continuation.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: continuation.costPaidThisEffect }
          : {}),
        ...(continuation.postResolutionOracle !== undefined
          ? { postResolutionOracle: continuation.postResolutionOracle }
          : {}),
        ...(battleEndAttackId !== undefined
          ? {
              battleEndDeferralAttackId: battleEndAttackId,
            }
          : {}),
      });
      currentState = resolution.finalize({
        state: currentState,
        beforeState: shouldFinalizeZoneSelectionFieldEntry
          ? zoneSelectionFieldEntryBeforeState
          : beforeResume,
        endLogs: [],
        actingPlayerId: continuation.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        sourceColors: getPendingSourceColors({
          state: currentState,
          sourceInstanceId: continuation.sourceInstanceId,
          sourceDefinitionId: continuation.sourceDefinitionId,
          getCardDefinitionById: options.getCardDefinitionById,
        }),
        causedBySourceInstanceId:
          continuation.effectSourceInstanceId ?? continuation.sourceInstanceId,
        enterFieldCausedByPlayerId: continuation.actingPlayerId,
        ...(battleEndAttackId !== undefined
          ? { battleEndDeferralAttackId: battleEndAttackId }
          : {}),
      });
      finalizedZoneSelectionFieldEntry = shouldFinalizeZoneSelectionFieldEntry;
      currentState = checkAndQueuePostResolutionOracleIfReady(
        currentState,
        continuation.postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      );
    }
  }

  if (
    shouldFinalizeZoneSelectionFieldEntry &&
    !finalizedZoneSelectionFieldEntry
  ) {
    const battleEndAttackId = pending.continuation?.battleEndDeferralAttackId;
    const resolution = createEffectResolutionScope(
      pending.continuation ??
        pending.postResolutionOracle ?? {
          chainId: `zone-selection:${pending.pendingId}`,
        },
      battleEndAttackId
    );
    currentState = resolution.finalize({
      state: currentState,
      beforeState: zoneSelectionFieldEntryBeforeState,
      endLogs: [],
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      sourceColors: getPendingSourceColors({
        state: currentState,
        sourceInstanceId: pending.sourceInstanceId,
        sourceDefinitionId: pending.sourceDefinitionId,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
      causedBySourceInstanceId:
        pending.continuation?.effectSourceInstanceId ??
        pending.sourceInstanceId,
      enterFieldCausedByPlayerId: pending.actingPlayerId,
      ...(battleEndAttackId !== undefined
        ? { battleEndDeferralAttackId: battleEndAttackId }
        : {}),
    });
  }

  currentState = checkAndQueuePostResolutionOracleIfReady(
    currentState,
    pending.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );
  currentState = resumeStackCascadeAfterPendingCloses(currentState, options);
  currentState = cleanupCompletedInUseMagicSourceIfReady({
    state: currentState,
    sourceInstanceId: pending.sourceInstanceId,
    chainId:
      pending.continuation?.chainId ??
      pending.postResolutionOracle?.chainId ??
      `zone-selection:${pending.pendingId}`,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return { state: currentState };
}

function resumeStackCascadeAfterPendingCloses(
  state: GameState,
  options: Parameters<typeof resumeStackCascadeIfReady>[1]
): GameState {
  if (
    hasOutstandingEffectResolutionContinuation({
      ...state,
      pendingStackCascade: null,
    })
  ) {
    return state;
  }
  const afterImmediateBattleEnds = processPendingImmediateBattleEnds({
    state,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return resumeStackCascadeIfReady(afterImmediateBattleEnds, options);
}

export function checkAndQueuePostResolutionOracleIfReady(
  state: GameState,
  postResolutionOracle:
    | import("../model").PostResolutionOracleTrigger
    | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions?: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  if (!postResolutionOracle) return state;
  if (postResolutionOracle.triggerKind === "effect_activated") {
    if (hasOutstandingEffectResolutionContinuation(state)) return state;
    if (getRegisteredTriggeredEffectActions === undefined) return state;
    if (
      postResolutionOracle.effectActivationLogStart !== undefined &&
      didEffectActivationFail(
        state.log.slice(postResolutionOracle.effectActivationLogStart),
        postResolutionOracle.triggerCardInstanceId
      )
    ) {
      return state;
    }
    return queueEffectActivationTriggers({
      chainId: requireTriggerChainId(postResolutionOracle.chainId),
      state,
      activatorPlayerId: postResolutionOracle.activatorPlayerId,
      relatedInstanceId: postResolutionOracle.triggerCardInstanceId,
      ...(postResolutionOracle.effectSourceTotalReduction !== undefined
        ? {
            effectSourceTotalReduction:
              postResolutionOracle.effectSourceTotalReduction,
          }
        : {}),
      ...(postResolutionOracle.effectSourceSatisfiedReductionSymbolCount !==
      undefined
        ? {
            effectSourceSatisfiedReductionSymbolCount:
              postResolutionOracle.effectSourceSatisfiedReductionSymbolCount,
          }
        : {}),
      ...(postResolutionOracle.effectSourceRequiredReductionSymbolCount !==
      undefined
        ? {
            effectSourceRequiredReductionSymbolCount:
              postResolutionOracle.effectSourceRequiredReductionSymbolCount,
          }
        : {}),
      ...(postResolutionOracle.eligibleSourceInstanceIds !== undefined
        ? {
            eligibleSourceInstanceIds:
              postResolutionOracle.eligibleSourceInstanceIds,
          }
        : {}),
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
  }
  if (hasOpenEffectResolutionPending(state)) {
    return state;
  }
  let currentState = resumeUseCostGateCoreMoveAfterMagicIfReady(
    state,
    postResolutionOracle,
    {
      getCardDefinitionById,
      ...(getRegisteredTriggeredEffectActions !== undefined
        ? { getRegisteredTriggeredEffectActions }
        : {}),
      ...(getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions }
        : {}),
    }
  );
  if (
    postResolutionOracle.effectActivatedActivatorPlayerId !== undefined &&
    getRegisteredTriggeredEffectActions !== undefined
  ) {
    const effectDidNotActivate =
      postResolutionOracle.effectActivationLogStart !== undefined &&
      didEffectActivationFail(
        currentState.log.slice(postResolutionOracle.effectActivationLogStart),
        postResolutionOracle.triggerCardInstanceId
      );
    if (!effectDidNotActivate) {
      currentState = queueEffectActivationTriggers({
        chainId: requireTriggerChainId(postResolutionOracle.chainId),
        state: currentState,
        activatorPlayerId:
          postResolutionOracle.effectActivatedActivatorPlayerId,
        relatedInstanceId: postResolutionOracle.triggerCardInstanceId,
        ...(postResolutionOracle.effectSourceTotalReduction !== undefined
          ? {
              effectSourceTotalReduction:
                postResolutionOracle.effectSourceTotalReduction,
            }
          : {}),
        ...(postResolutionOracle.effectSourceSatisfiedReductionSymbolCount !==
        undefined
          ? {
              effectSourceSatisfiedReductionSymbolCount:
                postResolutionOracle.effectSourceSatisfiedReductionSymbolCount,
            }
          : {}),
        ...(postResolutionOracle.effectSourceRequiredReductionSymbolCount !==
        undefined
          ? {
              effectSourceRequiredReductionSymbolCount:
                postResolutionOracle.effectSourceRequiredReductionSymbolCount,
            }
          : {}),
        ...(postResolutionOracle.eligibleSourceInstanceIds !== undefined
          ? {
              eligibleSourceInstanceIds:
                postResolutionOracle.eligibleSourceInstanceIds,
            }
          : {}),
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions,
      });
    }
  }
  const withOracle = checkAndQueueOracleChoices(
    currentState,
    postResolutionOracle.triggerCardInstanceId,
    postResolutionOracle.triggerKind,
    getCardDefinitionById,
    requireTriggerChainId(postResolutionOracle.chainId),
    { magicTiming: postResolutionOracle.magicTiming }
  );
  if (postResolutionOracle.triggerKind !== "use_magic") {
    return withOracle;
  }
  return checkAndQueueMagicStackDomain(
    withOracle,
    postResolutionOracle.triggerCardInstanceId,
    postResolutionOracle.magicTiming,
    getCardDefinitionById,
    requireTriggerChainId(postResolutionOracle.chainId),
    { magicEffectiveColors: postResolutionOracle.magicEffectiveColors }
  );
}

export function emitNextDeckRevealSwapPendingIfReady(
  state: GameState,
  getCardDefinitionById?: (id: string) => CardDefinition | undefined
): GameState {
  if (
    state.pendingZoneSelection !== null ||
    state.pendingDeckRevealSwapChain.length === 0
  ) {
    return state;
  }
  const [nextPending, ...rest] = state.pendingDeckRevealSwapChain;
  const candidates = getCurrentDeckRevealSwapOutCandidateIds({
    state,
    pending: nextPending!,
    getCardDefinitionById,
  });
  return {
    ...state,
    pendingZoneSelection: {
      ...nextPending!,
      candidateCardInstanceIds: candidates,
    },
    pendingDeckRevealSwapChain: rest,
  };
}

export function attachPostResolutionOracleToPendingCoreDistribution(
  state: GameState,
  postResolutionOracle:
    | import("../model").PostResolutionOracleTrigger
    | undefined
): GameState {
  if (!postResolutionOracle || state.pendingCoreDistribution === null) {
    return state;
  }
  return {
    ...state,
    pendingCoreDistribution: {
      ...state.pendingCoreDistribution,
      postResolutionOracle,
    },
  };
}

/**
 * 宣言時に畳んだ EffectStep.choice の変種別 usageLimit を、窓後に実際の枝が
 * 選ばれた時点で記録する。effect 全体の共有制限は従来どおり宣言時に記録済み。
 */
function recordDeferredStackChoiceVariantUsage(options: {
  state: GameState;
  stack: ActiveStack;
  choiceIndex: number;
  resolverOptions: ApplyLegalActionOptions;
}): { state: GameState; stack: ActiveStack } {
  const registration = lookupRegistrationForStack(
    options.stack,
    options.resolverOptions
  ) as
    | (RegisteredTargetedEffectActionBase & {
        effectIndex?: number;
        choiceIndex?: number;
        choices?: readonly {
          usageLimit?:
            | import("../model").EffectUsageLimit
            | import("../model").EffectUsageLimit[];
        }[];
      })
    | null;
  const usageLimit = registration?.choices?.[options.choiceIndex]?.usageLimit;
  if (usageLimit === undefined) {
    return { state: options.state, stack: options.stack };
  }

  let baseLabel: string | undefined;
  switch (options.stack.actionKind) {
    case "magic":
      baseLabel = "magic";
      break;
    case "field_card_effect":
      if (options.stack.fieldEffectRegistrationIndex !== undefined) {
        baseLabel = `${options.stack.fieldEffectSourceKind ?? "field_effect"}:${options.stack.fieldEffectRegistrationIndex}`;
      }
      break;
    case "hand_card_effect": {
      const registrationIndex =
        options.resolverOptions
          .getRegisteredHandActivatedEffectActions?.(
            options.stack.cardDefinitionId
          )
          ?.findIndex(
            (candidate) =>
              candidate.effectIndex === options.stack.handActivatedEffectIndex
          ) ?? -1;
      if (registrationIndex >= 0) {
        baseLabel = `hand_activated:${registrationIndex}`;
      }
      break;
    }
    case "triggered_effect":
      if (options.stack.triggeredRegistrationIndex !== undefined) {
        baseLabel = getStableEffectLabel(
          "triggered",
          options.stack.triggeredRegistrationIndex,
          registration ?? undefined
        );
      }
      break;
    case "burst_activation":
      if (options.stack.burstRegistrationIndex !== undefined) {
        baseLabel = getStableEffectLabel(
          "burst",
          options.stack.burstRegistrationIndex,
          undefined
        );
      }
      break;
    case "battle_immediate_effect":
      if (options.stack.battleImmediateRegistrationIndex !== undefined) {
        baseLabel = getStableEffectLabel(
          "battle_immediate",
          options.stack.battleImmediateRegistrationIndex,
          registration ?? undefined
        );
      }
      break;
    default:
      break;
  }
  if (baseLabel === undefined) {
    return { state: options.state, stack: options.stack };
  }

  const sourceInstanceId =
    options.stack.effectSourceInstanceId ?? options.stack.cardInstanceId;
  const sourceDefinitionId =
    options.stack.effectSourceDefinitionId ?? options.stack.cardDefinitionId;
  const effectLabel = getChoiceVariantUsageLabel(
    baseLabel,
    options.choiceIndex
  );
  const triggeredSnapshot = options.stack.triggeredPendingSnapshot;
  const battleSnapshot = options.stack.battleImmediatePromptSnapshot;
  const triggerEventScopeKey =
    options.stack.actionKind === "triggered_effect"
      ? triggeredSnapshot?.pendingId
      : options.stack.actionKind === "battle_immediate_effect" && battleSnapshot
        ? `battle_immediate:${battleSnapshot.attackId}:${battleSnapshot.timing}:${battleSnapshot.sourceEffectDefinitionId ?? battleSnapshot.sourceDefinitionId}:${battleSnapshot.registrationIndex}`
        : undefined;
  const relatedInstanceId =
    options.stack.actionKind === "triggered_effect"
      ? (triggeredSnapshot?.relatedInstanceId ?? undefined)
      : undefined;
  const triggerActivationKey =
    options.stack.actionKind === "triggered_effect"
      ? (triggeredSnapshot?.chainId ?? undefined)
      : undefined;
  const state = recordEffectUsageIfLimited({
    state: options.state,
    sourceInstanceId,
    sourceDefinitionId,
    effectLabel,
    usageLimit,
    ...(relatedInstanceId !== undefined ? { relatedInstanceId } : {}),
    ...(triggerEventScopeKey !== undefined ? { triggerEventScopeKey } : {}),
    ...(triggerActivationKey !== undefined ? { triggerActivationKey } : {}),
  });

  const recordedEntry: import("../model").RecordedEffectUsageEntry = {
    sourceInstanceId,
    effectLabel,
    usageLimit,
    ...(relatedInstanceId !== undefined ? { relatedInstanceId } : {}),
    ...(triggerEventScopeKey !== undefined ? { triggerEventScopeKey } : {}),
  };
  const existing = options.stack.recordedUsage;
  const existingEntries: import("../model").RecordedEffectUsageEntry[] = [];
  if (existing !== undefined) {
    const { extraRecords, ...primary } = existing;
    existingEntries.push(primary, ...(extraRecords ?? []));
  }
  const recordedUsage = composeRecordedUsage([
    ...existingEntries,
    recordedEntry,
  ]);
  return {
    state,
    stack: {
      ...options.stack,
      ...(recordedUsage !== undefined ? { recordedUsage } : {}),
    },
  };
}

export function applyPendingStepChoiceAction(
  options: ApplyLegalActionOptions
): ResolvePendingStepChoiceResult {
  const pending = options.state.pendingStepChoice;
  if (!pending) {
    throw new Error("No pending step choice to resolve");
  }
  const action = options.action;
  if (action.kind !== "resolve_pending_step_choice") {
    throw new Error(
      `applyPendingStepChoice expects action.kind=resolve_pending_step_choice (got ${action.kind})`
    );
  }
  if (action.pendingId !== pending.pendingId) {
    throw new Error(
      `pendingStepChoice pendingId mismatch: action=${action.pendingId} pending=${pending.pendingId}`
    );
  }
  if (action.actingPlayerId !== pending.choosingPlayerId) {
    throw new Error(
      `pendingStepChoice choosingPlayerId mismatch: action=${action.actingPlayerId} pending=${pending.choosingPlayerId}`
    );
  }
  const chosen = pending.choices.find(
    (choice) => choice.choiceIndex === action.choiceIndex
  );
  if (
    !chosen ||
    !canPayRequiredEffectCosts(
      options.state,
      pending.actingPlayerId,
      chosen,
      options.getCardDefinitionById,
      [],
      {},
      {
        sourceInstanceId: pending.sourceInstanceId,
        sourceDefinitionId: pending.sourceDefinitionId,
        effectIndex: pending.effectIndex,
        continuation: pending.continuation,
      }
    )
  ) {
    throw new Error(
      `pendingStepChoice choiceIndex ${action.choiceIndex} is not available`
    );
  }

  if (pending.mirageSetChoice !== undefined) {
    const choice = pending.mirageSetChoice;
    const selected = choice.replacementChoices[action.choiceIndex];
    if (!selected) throw new Error("Invalid deck reveal mirage choice");
    const restoredPending = {
      ...choice.reveal,
      mirageReplacementsByInstanceId: {
        ...choice.replacementsByInstanceId,
        [choice.sourceInstanceId]: [...selected],
      },
    };
    const restoredState: GameState = {
      ...options.state,
      pendingStepChoice: null,
      pendingDeckReveal: restoredPending,
    };
    // 元操作へ戻る前に、全入力を同じ正源で再検証する。後続カードはまだ未配置。
    const plan = planMirageSetReplacements({
      state: restoredState,
      actingPlayerId: pending.actingPlayerId,
      sourceInstanceIds: choice.sourceInstanceIds,
      replacementsByInstanceId: restoredPending.mirageReplacementsByInstanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    if (plan.unresolved?.sourceInstanceId === choice.sourceInstanceId)
      throw new Error("Mirage replacement choice was not consumed");
    if (choice.resume.kind === "revealed_choice") {
      return applyPendingDeckRevealAction({
        ...options,
        state: restoredState,
        action: choice.resume.action,
        selectedDeckRevealCardIds: choice.resume.selectedCardIds,
        ...(choice.resume.paymentSources !== undefined
          ? { paymentSources: choice.resume.paymentSources }
          : {}),
        ...(choice.resume.miragePaymentSourcesByInstanceId !== undefined
          ? {
              deckRevealMiragePaymentSourcesByInstanceId:
                choice.resume.miragePaymentSourcesByInstanceId,
            }
          : {}),
      });
    }
    const before = cloneStateForTriggerDelta(restoredState);
    const finalized = finalizeDeckReveal(
      restoredState,
      restoredPending,
      choice.resume.remainderOrder,
      options.getCardDefinitionById,
      choice.resume.effectivePlacement,
      {
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        ...(choice.resume.remainderPlacementById !== undefined
          ? { remainderPlacementById: choice.resume.remainderPlacementById }
          : {}),
      }
    );
    const afterScope = finalizeDeckRevealTransition(
      finalized,
      before,
      restoredPending,
      options
    );
    return { state: resumeStackCascadeAfterPendingCloses(afterScope, options) };
  }

  if (pending.paidEffectModifierChoice !== undefined) {
    if (pending.deferredStack === undefined) {
      throw new Error(
        `paid effect modifier choice missing deferredStack: ${pending.pendingId}`
      );
    }
    const paidChoice = pending.paidEffectModifierChoice;
    const accepted = action.choiceIndex === 1;
    let stateAfterChoice: GameState = {
      ...options.state,
      pendingStepChoice: null,
      pendingStackCascade: null,
    };
    const additionalEvents: SupplementalTriggerEvent[] = [
      ...(pending.deferredStack.supplementalTriggerEvents ?? []),
    ];
    if (accepted) {
      stateAfterChoice = executeCountDecrease(
        stateAfterChoice,
        pending.actingPlayerId,
        "self",
        paidChoice.cost.amount,
        paidChoice.sourceTribes
      );
      additionalEvents.push({
        actingPlayerId: pending.actingPlayerId,
        eventKind: "count_decrease",
        source: "action_resolution",
        chainId: pending.deferredStack.chainId,
        attackId: options.state.activeAttack?.attackId ?? null,
        relatedPlayerId: pending.actingPlayerId,
        relatedInstanceId: paidChoice.sourceInstanceId,
        amount: paidChoice.cost.amount,
        cause: "self_effect",
      });
    }

    const resumedStack: ActiveStack = {
      ...pending.deferredStack,
      ...(paidChoice.kind === "paid_prevention_immunity"
        ? {
            paidPreventionImmunityChoiceResolved: true as const,
            ...(accepted
              ? {
                  // 対象候補判定は共通 preventionLevel を読む。バトル即時効果も
                  // 支払い済みの防止不可を、追加発揮数の選択を越えて保持する。
                  preventionLevel: "unpreventable" as const,
                  ...(pending.deferredStack.actionKind ===
                  "battle_immediate_effect"
                    ? {
                        battleImmediatePreventionLevel:
                          "unpreventable" as const,
                      }
                    : {}),
                }
              : {}),
          }
        : {
            paidLeaveSuppressionChoiceResolved: true as const,
            ...(accepted ? { suppressCausedLeaveEffects: true as const } : {}),
          }),
      ...(additionalEvents.length > 0
        ? { supplementalTriggerEvents: additionalEvents }
        : {}),
    };
    const remainingStacks = [
      ...(pending.remainingStacks ?? []),
      ...(options.state.pendingStackCascade?.remainingStacks ?? []),
    ];
    const loggedState: GameState = {
      ...stateAfterChoice,
      log: [
        ...stateAfterChoice.log,
        `effect:paid-modifier-choice:resolved:${pending.pendingId}:${paidChoice.kind}:${accepted ? "pay" : "decline"}`,
      ],
    };
    const afterCascade = resolveStackCascade(
      loggedState,
      [resumedStack, ...remainingStacks],
      options,
      options.state.pendingTargetedDisclosureContinuation !== null
        ? { allowDuringTargetedDisclosure: true }
        : undefined
    );
    return {
      state: resumeStackCascadeIfReady(afterCascade, options),
    };
  }

  if (pending.deferredStack !== undefined) {
    const selectedWithDeferredIndexes = setActiveStackChoiceIndex(
      {
        ...pending.deferredStack,
        ...(options.payCostPaymentSources !== undefined
          ? { payCostPaymentSources: options.payCostPaymentSources }
          : {}),
        ...(options.deferPayCostSourceSelection === true
          ? { deferPayCostSourceSelection: true }
          : {}),
      },
      action.choiceIndex
    );
    const { deferredChoiceIndexes: _deferredChoiceIndexes, ...selected } =
      selectedWithDeferredIndexes;
    const choiceUsage = recordDeferredStackChoiceVariantUsage({
      state: options.state,
      stack: selected,
      choiceIndex: action.choiceIndex,
      resolverOptions: options,
    });
    const resumedStack = choiceUsage.stack;
    const remainingStacks = [
      ...(pending.remainingStacks ?? []),
      ...(choiceUsage.state.pendingStackCascade?.remainingStacks ?? []),
    ];
    const stateWithoutPending: GameState = {
      ...choiceUsage.state,
      pendingStepChoice: null,
      pendingStackCascade: null,
      log: [
        ...choiceUsage.state.log,
        `effect:step-choice-resolved-after-stack:${pending.pendingId}:choice=${action.choiceIndex}`,
      ],
    };
    const afterCascade = resolveStackCascade(
      stateWithoutPending,
      [resumedStack, ...remainingStacks],
      options,
      choiceUsage.state.pendingTargetedDisclosureContinuation !== null
        ? { allowDuringTargetedDisclosure: true }
        : undefined
    );
    return {
      state: resumeStackCascadeIfReady(afterCascade, options),
    };
  }

  const cont = {
    ...pending.continuation,
    choiceIndex: action.choiceIndex,
  };
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  const effect =
    cont.resumeEffectOverride ?? resolveContinuationEffect(def, cont);
  if (!effect) {
    throw new Error(
      `applyPendingStepChoice: effect not found ${cont.sourceDefinitionId} [${cont.effectIndex}]`
    );
  }

  const stateWithoutPending: GameState = {
    ...options.state,
    pendingStepChoice: null,
    log: [
      ...options.state.log,
      `effect:step-choice-resolved:${pending.pendingId}:choice=${action.choiceIndex}`,
    ],
  };
  const reconstructedPending: import("../model").PendingStepOptionalChoice = {
    pendingId: pending.pendingId,
    actingPlayerId: pending.actingPlayerId,
    choosingPlayerId: pending.choosingPlayerId,
    sourceInstanceId: pending.sourceInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    effectIndex: pending.effectIndex,
    stepIndex: pending.stepIndex,
    ...(pending.stepLabel !== undefined
      ? { stepLabel: pending.stepLabel }
      : {}),
    canExecute: true,
    continuation: cont,
    ...(pending.targetedDisclosureResolutionCleanups !== undefined
      ? {
          targetedDisclosureResolutionCleanups:
            pending.targetedDisclosureResolutionCleanups,
        }
      : {}),
  };
  let currentState = resumeStepOptional({
    state: stateWithoutPending,
    effect,
    pending: reconstructedPending,
    choice: "execute",
    options,
    sourceDefinition: def,
  });
  currentState = resumePendingRetriggerContinuations({
    ...options,
    state: currentState,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return { state: currentState };
}

/**
 * StepOptionalChoice (`pendingStepOptionalChoice`) を解決する。
 *
 * - "execute": continuation.stepIndex から `optionalExecuteResumeStepIndex` 付きで executeEffect を再起動。
 *   当該 step の optional チェックを bypass して通常実行へ進む。
 * - "decline": continuation.stepIndex + 1 から executeEffect を再起動 (当該 step のみ skip)。
 *
 * いずれも `finalizeEffectResolution` で SBA + CE 再構築 + 配置時誘発を反映する。
 * 正源: model.ts §PendingStepOptionalChoice。
 */
export function applyPendingStepOptionalChoiceAction(
  options: ApplyLegalActionOptions
): ResolvePendingStepOptionalChoiceResult {
  const pending = options.state.pendingStepOptionalChoice;
  if (!pending) {
    throw new Error("No pending step optional choice to resolve");
  }
  const action = options.action;
  if (action.kind !== "resolve_pending_step_optional_choice") {
    throw new Error(
      `applyPendingStepOptionalChoice expects action.kind=resolve_pending_step_optional_choice (got ${action.kind})`
    );
  }
  if (action.pendingId !== pending.pendingId) {
    throw new Error(
      `pendingStepOptionalChoice pendingId mismatch: action=${action.pendingId} pending=${pending.pendingId}`
    );
  }
  // 権限検証は choosingPlayerId (= execute/decline 判断者) で行う。chooser 未指定/'self' の
  // ときは actingPlayerId と choosingPlayerId が同値、chooser='opponent' のときは相手プレイヤーが
  // apply 主体 (PendingStepOptionalTargetSelection §8778 と同 SSOT)。
  if (action.actingPlayerId !== pending.choosingPlayerId) {
    throw new Error(
      `pendingStepOptionalChoice choosingPlayerId mismatch: action=${action.actingPlayerId} pending=${pending.choosingPlayerId}`
    );
  }
  // SSOT: choice は action.choice のみを参照する (並行入力源を持たない)。
  const choice = action.choice;
  if (choice !== "execute" && choice !== "decline") {
    throw new Error(
      `pendingStepOptionalChoice action.choice must be "execute" or "decline" (got ${String(choice)})`
    );
  }
  if (choice === "execute" && pending.canExecute === false) {
    throw new Error(
      `pendingStepOptionalChoice execute is not available for pendingId=${pending.pendingId}`
    );
  }
  if (choice === "decline" && pending.canDecline === false) {
    throw new Error(
      `pendingStepOptionalChoice decline is not available for pendingId=${pending.pendingId}`
    );
  }
  let selectedOptionalQuantityAmount: number | undefined;
  if (pending.optionalQuantity !== undefined) {
    if (choice === "execute") {
      const selected = action.selectedAmount ?? pending.optionalQuantity.max;
      const minExecute = Math.max(1, pending.optionalQuantity.min);
      if (
        !Number.isInteger(selected) ||
        selected < minExecute ||
        selected > pending.optionalQuantity.max
      ) {
        throw new Error(
          `pendingStepOptionalChoice selectedAmount ${String(selected)} is out of range [${minExecute}, ${pending.optionalQuantity.max}]`
        );
      }
      selectedOptionalQuantityAmount = selected;
    } else if (action.selectedAmount !== undefined) {
      throw new Error(
        "pendingStepOptionalChoice decline must not carry selectedAmount"
      );
    }
  } else if (action.selectedAmount !== undefined) {
    throw new Error(
      "pendingStepOptionalChoice selectedAmount is only valid for optionalQuantity"
    );
  }
  const pendingForResume =
    selectedOptionalQuantityAmount !== undefined
      ? {
          ...pending,
          continuation: {
            ...pending.continuation,
            selectedOptionalQuantityAmount,
          },
        }
      : pending;
  const cont = pendingForResume.continuation;
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  const effect =
    cont.resumeEffectOverride ?? resolveContinuationEffect(def, cont);
  if (!effect) {
    throw new Error(
      `applyPendingStepOptionalChoice: effect not found ${cont.sourceDefinitionId} [${cont.effectIndex}]`
    );
  }
  let currentState: GameState = {
    ...options.state,
    pendingStepOptionalChoice: null,
    log: [
      ...options.state.log,
      `effect:step-optional-${choice}:${pending.pendingId}:step=${cont.stepIndex}`,
      ...(selectedOptionalQuantityAmount !== undefined
        ? [
            `effect:step-optional-quantity:${pending.pendingId}:amount=${selectedOptionalQuantityAmount}/${pending.optionalQuantity!.max}`,
          ]
        : []),
    ],
  };
  // execute かつ当該 step が独自 target を要するとき、ENGINE が pool.slice で機械選択する
  // のを避け、プレイヤー対象選択窓を開く。pending を立てて応答後に executeEffect を再開する。
  // 正源: needs-dsl.audit ENGINE-step-optional-target-step-pending-selection。
  if (choice === "execute") {
    const targetPending = tryBuildStepOptionalTargetSelection({
      state: currentState,
      effect,
      pendingId: pending.pendingId,
      continuation: cont,
      stepLabel: pending.stepLabel,
      getCardDefinitionById: options.getCardDefinitionById,
      sourceDefinition: def,
    });
    if (targetPending) {
      currentState = {
        ...currentState,
        pendingStepOptionalTargetSelection: targetPending,
        log: [
          ...currentState.log,
          `effect:step-optional-target-pending:${targetPending.pendingId}:step=${cont.stepIndex}:candidates=${targetPending.candidateInstanceIds.length}`,
        ],
      };
      return { state: currentState };
    }
  }
  currentState = resumeStepOptional({
    state: currentState,
    effect,
    pending: pendingForResume,
    choice,
    options,
    sourceDefinition: def,
  });
  currentState = resumePendingRetriggerContinuations({
    ...options,
    state: currentState,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return { state: currentState };
}

/** PendingStepOptionalChoice の execute/decline 後に executeEffect を再起動し finalize する共通処理。 */
export function resumeStepOptional(args: {
  state: GameState;
  effect: import("../dsl-types").Effect;
  pending: import("../model").PendingStepOptionalChoice;
  choice: "execute" | "decline";
  options: ApplyLegalActionOptions;
  sourceDefinition: CardDefinition | undefined;
  /** optional step 自身の target 解決結果 (PendingStepOptionalTargetSelection 経由)。 */
  selectedTargetInstanceIds?: readonly string[];
  selectedTargetStepId?: string;
  /**
   * `pendingDeckRevealCountBoostChoice` 等、`PendingStepOptionalChoice` とは別の pending が
   * この共通 finalize 処理を再利用する際に executeEffect へ追加で渡す options。
   */
  extraExecuteEffectOptions?: Partial<
    Omit<import("../effect/effect-interpreter").ExecuteEffectOptions, "chainId">
  >;
}): GameState {
  const { state, effect, pending, choice, options } = args;
  const cont = pending.continuation;
  const battleEndAttackId = cont.battleEndDeferralAttackId;
  const resolution = createEffectResolutionScope(cont);
  // selected* が指定されているとき: optional step 自身の対象を注入する。
  // 既存 cont.targetInstanceIds (= 効果宣言時に渡された対象) と衝突する場合は selected* を優先する。
  const useSelected =
    args.selectedTargetInstanceIds !== undefined &&
    args.selectedTargetStepId !== undefined;
  const finalTargetInstanceIds = useSelected
    ? [...args.selectedTargetInstanceIds!]
    : cont.targetInstanceIds !== undefined
      ? [...cont.targetInstanceIds]
      : undefined;
  const finalTargetStepId = useSelected
    ? args.selectedTargetStepId
    : cont.targetStepId;
  const resumeState =
    cont.targetedDisclosureContinuation !== undefined
      ? {
          ...state,
          pendingTargetedDisclosureContinuation:
            cont.targetedDisclosureContinuation,
        }
      : state;
  let currentState: GameState = resolution.execute({
    state: resumeState,
    effect,
    effectIndex: cont.effectIndex,
    sourceInstanceId: cont.sourceInstanceId,
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    // decline でも当該 step から再開して failed stepResult を記録する (次 step の
    // conditional_result 連結が「前段不成立で skip」を正しく評価するため)。
    startFromStepIndex: cont.stepIndex,
    restoredStepContext: cont.stepContext,
    // 任意選択後も支払い元はプレイヤーが選ぶ。宣言元のGUIフラグには依存しない。
    allowPendingPayCostSourceAllocation: true,
    // adversarial verifier 2026-07-31 round1 指摘: resume 後の executeEffect 実行中に
    // さらに別の on_step/nested pending が生成された場合、その新 continuation が
    // divineSkillIndex/isAccelData を継承できるよう、resume 元の cont 側の値も転写する
    // (他の継続再開箇所と同じパターンに揃える。ENGINE-move-card-actual-count-amount)。
    ...(cont.divineSkillIndex !== undefined
      ? { divineSkillIndex: cont.divineSkillIndex }
      : {}),
    ...(cont.isAccelData !== undefined
      ? { isAccelData: cont.isAccelData }
      : {}),
    ...(cont.isChangeData !== undefined
      ? { isChangeData: cont.isChangeData }
      : {}),
    ...(cont.resumeEffectOverride !== undefined
      ? { optionalStepResumeEffectOverride: cont.resumeEffectOverride }
      : {}),
    ...(choice === "execute"
      ? { optionalExecuteResumeStepIndex: cont.stepIndex }
      : { declinedOptionalStepIndex: cont.stepIndex }),
    ...(choice === "execute" &&
    cont.selectedOptionalQuantityAmount !== undefined
      ? {
          optionalStepQuantityOverride: {
            stepIndex: cont.stepIndex,
            amount: cont.selectedOptionalQuantityAmount,
          },
        }
      : {}),
    ...(cont.choiceIndex !== undefined
      ? { choiceIndex: cont.choiceIndex }
      : {}),
    ...(cont.effectActionKind !== undefined
      ? { effectActionKind: cont.effectActionKind }
      : {}),
    ...(cont.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: cont.sourcePreventionLevel }
      : {}),
    ...(cont.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: cont.sourcePreventionBypass }
      : {}),
    ...(cont.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: cont.effectSourceInstanceId }
      : {}),
    ...(cont.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
      : {}),
    ...(cont.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
      : {}),
    ...(cont.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: cont.costPaidThisEffect }
      : {}),
    ...(cont.postResolutionOracle !== undefined
      ? { postResolutionOracle: cont.postResolutionOracle }
      : {}),
    ...(finalTargetInstanceIds !== undefined
      ? { targetInstanceIds: finalTargetInstanceIds }
      : {}),
    ...(finalTargetStepId !== undefined
      ? { targetStepId: finalTargetStepId }
      : {}),
    ...(!useSelected && cont.targetGroups !== undefined
      ? { targetGroups: cont.targetGroups }
      : {}),
    ...(!useSelected && cont.preservePreSelectedTargetRefs === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(cont.repeatResume !== undefined
      ? { repeatResume: cont.repeatResume }
      : {}),
    ...(useSelected ? { targetSelectionResolved: true } : {}),
    ...(cont.recordedUsage !== undefined
      ? { recordedUsage: cont.recordedUsage }
      : {}),
    ...(cont.eventAmount !== undefined
      ? { eventAmount: cont.eventAmount }
      : {}),
    ...(cont.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            cont.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
    ...(args.extraExecuteEffectOptions ?? {}),
  });
  const triggerBeforeState =
    cont.stepContext.pendingConditionalCostRollback?.originalState ??
    resumeState;
  currentState = resolution.finalize({
    state: currentState,
    beforeState: triggerBeforeState,
    endLogs: [],
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: cont.sourceInstanceId,
      sourceDefinitionId: cont.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      cont.effectSourceInstanceId ?? cont.sourceInstanceId,
    enterFieldCausedByPlayerId: cont.actingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = checkAndQueuePostResolutionOracleIfReady(
    currentState,
    cont.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  currentState = applyOrDeferTargetedDisclosureResolutionCleanups(
    currentState,
    pending.targetedDisclosureResolutionCleanups
  );
  const battleEndedDuringOptionalResume =
    shouldDiscardRemainingStacksAfterBattleEnded(
      resumeState,
      currentState,
      currentState.pendingStackCascade?.remainingStacks ?? []
    );
  if (battleEndedDuringOptionalResume) {
    currentState = { ...currentState, pendingStackCascade: null };
  }
  const hasNonTargetedDisclosureContinuation =
    hasOutstandingEffectResolutionContinuation({
      ...currentState,
      pendingTargetedDisclosureContinuation: null,
      pendingStackCascade: null,
    });
  if (
    !battleEndedDuringOptionalResume &&
    !hasNonTargetedDisclosureContinuation
  ) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  // ENGINE-battle-end-deferred-yield-finalize: この optional choice が battle_end deferred
  // 効果由来だった場合、上記解決で当該 attackId の pendingStepOptionalChoice/pendingTriggeredEffects
  // が尽きていれば、予約されていた scope:"battle" CE 失効を発火する。
  if (battleEndAttackId !== undefined) {
    currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      currentState,
      options
    );
  }
  return cleanupCompletedInUseMagicSourceIfReady({
    state: currentState,
    sourceInstanceId: cont.sourceInstanceId,
    chainId: resolution.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

/**
 * ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md): 連続バトル (BSTH06-X03
 * 【三歩必殺】) の続行/終了選択を解決する。
 *
 * - `choice:"end"`: 保持していたコンテキストで通常の battle_end 経路
 *   (`finalizeBattleEndSequenceAfterCombat`、旧「else」分岐と同じ処理) を実行する。
 * - `choice:"continue"`: ブロック前フラッシュタイミングへ戻る (Q9096: アタック宣言なし・
 *   疲労なし)。`activeAttack` はまだ null 化されていない (pending 生成時点で
 *   queueBattleEndTriggers/resetBattleEntitiesAfterResolution 未実行のため、アタッカーは
 *   "attacking" のまま) — blockAssignments/flash 状態だけを次ラウンド用にリセットし、
 *   `connectBattleGrant.remainingUses` を1消費する。
 */
export function applyConnectBattleDecisionAction(
  options: ApplyLegalActionOptions
): ResolveConnectBattleDecisionResult {
  const pending = options.state.pendingConnectBattleDecision;
  if (!pending) {
    throw new Error("No pending connect battle decision to resolve");
  }
  const action = options.action;
  if (action.kind !== "resolve_connect_battle_decision") {
    throw new Error(
      `applyConnectBattleDecisionAction expects action.kind=resolve_connect_battle_decision (got ${action.kind})`
    );
  }
  if (action.pendingId !== pending.pendingId) {
    throw new Error(
      `pendingConnectBattleDecision pendingId mismatch: action=${action.pendingId} pending=${pending.pendingId}`
    );
  }
  if (action.actingPlayerId !== pending.actingPlayerId) {
    throw new Error(
      `pendingConnectBattleDecision actingPlayerId mismatch: action=${action.actingPlayerId} pending=${pending.actingPlayerId}`
    );
  }
  const choice = action.choice;
  if (choice !== "continue" && choice !== "end") {
    throw new Error(
      `pendingConnectBattleDecision action.choice must be "continue" or "end" (got ${String(choice)})`
    );
  }
  const clearedState: GameState = {
    ...options.state,
    pendingConnectBattleDecision: null,
    log: [
      ...options.state.log,
      `battle:connect-battle:decision-${choice}:${pending.pendingId}`,
    ],
  };
  if (choice === "end") {
    const finalState = finalizeBattleEndSequenceAfterCombat(
      {
        state: clearedState,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      },
      {
        state: clearedState,
        attackId: pending.attackId,
        participantInstanceIds: pending.participantInstanceIds,
        blockSideInstanceIds: pending.blockSideInstanceIds,
        destroyedRecords: pending.destroyedRecords ?? [],
        participantSnapshots: pending.participantSnapshots,
        appliedLifeDamage: pending.appliedLifeDamage,
        participantOwnSymbols: new Map(
          pending.participantOwnSymbols.map((entry) => [
            entry.entityId,
            entry.ownSymbols,
          ])
        ),
      }
    );
    return {
      state: recordCompletedBattleAndFinalizeAttackStepEnd(
        finalState,
        pending.attackId,
        options.getCardDefinitionById,
        options
      ),
    };
  }
  const activeAttack = clearedState.activeAttack;
  if (!activeAttack || !activeAttack.connectBattleGrant) {
    throw new Error(
      "pendingConnectBattleDecision continue: activeAttack.connectBattleGrant missing"
    );
  }

  const {
    blockDeclarationCompleted: _prevBlockDeclarationCompleted,
    ...activeAttackWithoutBlockDeclaration
  } = activeAttack;
  const continuedState: GameState = {
    ...clearedState,
    // The continuation resumes *before* the next before-block flash window.
    // `flash_before_block` itself requires activeAttack.flashWindowState to carry
    // the priority loop.  Returning directly with that field null leaves no
    // battle legal action, so use the normal opener state instead.
    window: "declare_attack",
    battleResolutionGroup: null,
    activeAttack: {
      ...activeAttackWithoutBlockDeclaration,
      connectBattleGrant: {
        sourceInstanceId: activeAttack.connectBattleGrant.sourceInstanceId,
        remainingUses: activeAttack.connectBattleGrant.remainingUses - 1,
      },
      blockAssignments: activeAttack.blockAssignments.map((assignment) => ({
        ...assignment,
        blockedByEntityIds: [],
      })),
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    },
    battleEntities: clearedState.battleEntities.map((entity) =>
      entity.attackState === "blocking" &&
      !activeAttack.participantEntityIds.includes(entity.entityId)
        ? { ...entity, attackState: "idle" as const }
        : entity
    ),
  };
  // A designated attack may have destroyed or otherwise invalidated its target
  // during the preceding battle.  Continue uses the same no-declaration
  // resumption point as the ordinary attack flow, so pass it through the
  // shared finalizer before exposing legal actions.  In particular, this
  // clears an invalid designated target and re-opens the before-block flash
  // path instead of leaving an activeAttack with no legal continuation.
  return {
    state: advanceAttackDeclarationStateIfReady(continuedState, options),
  };
}

/**
 * `pendingDeckRevealCountBoostChoice` (grant_optional_deck_reveal_count_boost CE、BSLH01-X09)
 * の apply/decline を解決する。
 *
 * `resumeStepOptional` (PendingStepOptionalChoice の共通 finalize 処理) を、当該 pending から
 * 変換した互換オブジェクトで再利用し、`resolvedDeckRevealCountBoost` を追加 options として
 * 渡すことで、deck_reveal step の revealCount へ bonusAmount (apply 時のみ) を加算して
 * executeEffect を再起動する。
 */
export function applyPendingDeckRevealCountBoostChoiceAction(
  options: ApplyLegalActionOptions
): ResolvePendingDeckRevealCountBoostChoiceResult {
  const pending = options.state.pendingDeckRevealCountBoostChoice;
  if (!pending) {
    throw new Error("No pending deck reveal count boost choice to resolve");
  }
  const action = options.action;
  if (action.kind !== "resolve_pending_deck_reveal_count_boost_choice") {
    throw new Error(
      `applyPendingDeckRevealCountBoostChoiceAction expects action.kind=resolve_pending_deck_reveal_count_boost_choice (got ${action.kind})`
    );
  }
  if (action.pendingId !== pending.pendingId) {
    throw new Error(
      `pendingDeckRevealCountBoostChoice pendingId mismatch: action=${action.pendingId} pending=${pending.pendingId}`
    );
  }
  if (action.actingPlayerId !== pending.actingPlayerId) {
    throw new Error(
      `pendingDeckRevealCountBoostChoice actingPlayerId mismatch: action=${action.actingPlayerId} pending=${pending.actingPlayerId}`
    );
  }
  const choice = action.choice;
  if (choice !== "apply" && choice !== "decline") {
    throw new Error(
      `pendingDeckRevealCountBoostChoice action.choice must be "apply" or "decline" (got ${String(choice)})`
    );
  }
  const cont = pending.continuation;
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  const effect =
    cont.resumeEffectOverride ?? resolveContinuationEffect(def, cont);
  if (!effect) {
    throw new Error(
      `applyPendingDeckRevealCountBoostChoiceAction: effect not found ${cont.sourceDefinitionId} [${cont.effectIndex}]`
    );
  }
  const compatPending: import("../model").PendingStepOptionalChoice = {
    pendingId: pending.pendingId,
    actingPlayerId: pending.actingPlayerId,
    choosingPlayerId: pending.actingPlayerId,
    sourceInstanceId: pending.sourceInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    effectIndex: pending.effectIndex,
    stepIndex: pending.stepIndex,
    continuation: cont,
    ...(pending.targetedDisclosureResolutionCleanups !== undefined
      ? {
          targetedDisclosureResolutionCleanups:
            pending.targetedDisclosureResolutionCleanups,
        }
      : {}),
  };
  let currentState: GameState = {
    ...options.state,
    pendingDeckRevealCountBoostChoice: null,
    log: [
      ...options.state.log,
      `effect:deck-reveal-count-boost-${choice}:${pending.pendingId}:step=${cont.stepIndex}`,
    ],
  };
  // NOTE: choice は常に "execute" を渡す (resumeStepOptional の decline は「step 自体を
  // skip する」意味の declinedOptionalStepIndex を設定するため、対象 step が別途
  // executionMode:"optional" でもある場合に誤って step 全体を飛ばしてしまう。deck_reveal
  // step は bonus の有無に関わらず必ず実行されるべきなので、実際の apply/decline の
  // 区別は resolvedDeckRevealCountBoost.appliedBonus (0=decline) だけで表現する。
  currentState = resumeStepOptional({
    state: currentState,
    effect,
    pending: compatPending,
    choice: "execute",
    options,
    sourceDefinition: def,
    extraExecuteEffectOptions: {
      resolvedDeckRevealCountBoost: {
        stepIndex: cont.stepIndex,
        appliedBonus: choice === "apply" ? pending.bonusAmount : 0,
      },
    },
  });
  currentState = resumePendingRetriggerContinuations({
    ...options,
    state: currentState,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return { state: currentState };
}

function shouldExcludePendingLeaveFromStepOptionalTargetCandidates(
  target: import("../dsl-types").TargetSpec
): boolean {
  switch (target.kind) {
    case "filter":
      return true;
    case "trigger_related_instance":
    case "trigger_related_combined_host":
    case "trigger_related_instances":
      return target.includePendingLeave !== true;
    default:
      return false;
  }
}

/**
 * optional step 自身の target.filter から候補/件数を解決し、選択窓 (PendingStepOptionalTargetSelection)
 * を立てるべきかを判定する。立てる場合は構築済み pending を返す。
 *
 * - 候補 0 → null (空撃ち: 既存挙動どおり pool.slice で 0 体扱いに落とす)
 * - filter target で必要数 === 最大数 === 候補数 → null (選択余地なし、engine が自動で全候補を取る)
 * - summon.from_zone → 実行可能性 gate で raw 候補から落ちた exact-all は pending を返す
 *   (絞り込み後の候補 instanceId を後続に注入するため)
 * - それ以外 → pending を返す
 */
export function tryBuildStepOptionalTargetSelection(args: {
  state: GameState;
  effect: import("../dsl-types").Effect;
  pendingId: string;
  continuation: import("../model").StepOptionalContinuation;
  stepLabel: string | undefined;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourceDefinition: CardDefinition | undefined;
}): PendingStepOptionalTargetSelection | null {
  const { state, effect, pendingId, continuation: cont } = args;
  const step = effect.steps[cont.stepIndex];
  if (!step) return null;
  // choice variant 解決: effect-interpreter §965-979 と同じ規約で活性 action を取り出す。
  // choiceIndex 未指定 / 0 → step.action (デフォルト)、N>=1 → step.choice[N-1].action。
  // BSLH01-C05 のように default destroy + choice discard_set_burst を併設する step で、
  // variant 別に target metadata が異なるため、ここで variant を選び損ねると誤った
  // 候補集合が pending 化される (verifier 指摘 2026-06-21 round 1)。
  let activeAction: import("../dsl-types").Action = step.action;
  let activeChooser: import("../dsl-types").PlayerRef | undefined =
    step.chooser;
  if (step.choice && step.choice.length > 0 && cont.choiceIndex !== undefined) {
    if (cont.choiceIndex > 0 && cont.choiceIndex <= step.choice.length) {
      const variant = step.choice[cont.choiceIndex - 1]!;
      activeAction = variant.action;
      // choice variant の chooser は variant 単位で上書き可。
      if (variant.chooser !== undefined) {
        activeChooser = variant.chooser;
      }
    }
    // choiceIndex === 0 はデフォルト action のまま。
  }
  const stepIdResolved = step.id ?? `__step_${cont.stepIndex}`;
  // 既に宣言時に注入された targetInstanceIds が当該 step 用に取り置かれているなら、
  // 重ねて選択窓を開かない (二重選択回避)。
  if (
    cont.targetInstanceIds !== undefined &&
    cont.targetInstanceIds.length > 0 &&
    (cont.targetStepId === undefined || cont.targetStepId === stepIdResolved)
  ) {
    return null;
  }

  // 前段 step 結果 / eventAmount / costPaidThisEffect / sourceInstanceId を保ったまま
  // DynamicCount (cards_from_ref / event_amount / cost_paid_this_effect / braves_on_source 等) を
  // 解決するため、continuation の serialized stepContext を deserialize して復元する
  // (verifier 指摘 2026-06-21 round 2)。
  const stepContext = deserializeStepContext(cont.stepContext, state);
  if (cont.eventAmount !== undefined)
    stepContext.eventAmount = cont.eventAmount;
  if (cont.costPaidThisEffect !== undefined)
    stepContext.costPaidThisEffect = cont.costPaidThisEffect;
  stepContext.sourceInstanceId = cont.sourceInstanceId;

  const resolveChoosingPlayerId = (): string => {
    if (activeChooser !== "opponent") return cont.actingPlayerId;
    return (
      state.playerOrder.find((id) => id !== cont.actingPlayerId) ??
      cont.actingPlayerId
    );
  };

  if (
    activeAction.kind === "summon" &&
    activeAction.target.kind === "from_zone" &&
    activeAction.target.filter?.soulState !== "only"
  ) {
    const summonTarget = activeAction.target;
    const summonCause: "effect" | "burst" =
      cont.effectActionKind === "burst_activation" ? "burst" : "effect";
    const nativeAction: SummonAction = {
      ...(activeAction.fieldCoreSourceMinimum !== undefined
        ? { fieldCoreSourceMinimum: activeAction.fieldCoreSourceMinimum }
        : {}),
      kind: "summon",
      target: "other",
      zone: normalizeSummonFromZoneZone(summonTarget.zone),
      count: 1,
      summonCause,
      ...(summonTarget.filter ? { filter: summonTarget.filter } : {}),
      ...(activeAction.costModifier === "free" ? { withoutCost: true } : {}),
      ...(typeof activeAction.costModifier === "object" &&
      "override" in activeAction.costModifier
        ? { overrideCost: activeAction.costModifier.override }
        : {}),
      ...(typeof activeAction.costModifier === "object" &&
      "fixedPayment" in activeAction.costModifier
        ? { fixedPayment: activeAction.costModifier.fixedPayment }
        : {}),
      ...(activeAction.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: activeAction.onBoardCoreSourceFilter }
        : {}),
      ...(activeAction.costModifier === "full_reduction"
        ? { fullReduction: true }
        : {}),
      ...(activeAction.trashCoreMax !== undefined
        ? { trashCoreMax: activeAction.trashCoreMax }
        : {}),
      ...(activeAction.trashCoreKind !== undefined
        ? { trashCoreKind: activeAction.trashCoreKind }
        : {}),
      ...(activeAction.ignoreSummonCondition
        ? { ignoreSummonCondition: true }
        : {}),
      ...(summonTarget.includeAdventSource
        ? { includeAdventSource: true }
        : {}),
      ...(summonTarget.includeSoulState ? { includeSoulState: true } : {}),
    };
    const rawCandidates = resolveSummonFromZoneCandidates(
      state,
      cont.actingPlayerId,
      {
        zone: summonTarget.zone,
        ...(summonTarget.filter ? { filter: summonTarget.filter } : {}),
        ...(summonTarget.includeAdventSource
          ? { includeAdventSource: true }
          : {}),
        ...(summonTarget.includeSoulState ? { includeSoulState: true } : {}),
        ...(activeAction.costModifier === "full_reduction"
          ? { fullReduction: true }
          : {}),
        ...(summonTarget.restrictToTriggerLeaveAdventSource
          ? {
              restrictToInstanceIds:
                stepContext.triggerAdventSourceInstanceIds ?? [],
            }
          : {}),
      },
      args.getCardDefinitionById
    );
    const executableCandidates = rawCandidates.filter((candidate) =>
      canAutoExecuteSummonFromZoneCandidate({
        state,
        actingPlayerId: cont.actingPlayerId,
        action: nativeAction,
        candidate,
        getCardDefinitionById: args.getCardDefinitionById,
      })
    );
    const candidates = executableCandidates.map(
      (candidate) => candidate.instanceId
    );
    if (candidates.length === 0) return null;

    let requiredTargetCount: number;
    let maxTargetCount: number;
    if (typeof summonTarget.count === "number") {
      requiredTargetCount = summonTarget.count;
      maxTargetCount = summonTarget.count;
    } else if (summonTarget.count === "all") {
      requiredTargetCount = candidates.length;
      maxTargetCount = candidates.length;
    } else if (
      typeof summonTarget.count === "object" &&
      summonTarget.count !== null &&
      "min" in summonTarget.count
    ) {
      requiredTargetCount =
        typeof summonTarget.count.min === "number"
          ? summonTarget.count.min
          : resolveCountBound(
              summonTarget.count.min,
              state,
              cont.actingPlayerId,
              stepContext,
              args.getCardDefinitionById
            );
      const max = summonTarget.count.max;
      if (max === undefined) {
        maxTargetCount = candidates.length;
      } else if (typeof max === "number") {
        maxTargetCount = max;
      } else {
        maxTargetCount = resolveCountBound(
          max,
          state,
          cont.actingPlayerId,
          stepContext,
          args.getCardDefinitionById
        );
      }
    } else {
      const resolvedCount = resolveCount(
        summonTarget.count,
        state,
        cont.actingPlayerId,
        stepContext,
        args.getCardDefinitionById
      );
      const effectiveCount =
        resolvedCount === -1 ? candidates.length : Math.max(0, resolvedCount);
      requiredTargetCount = effectiveCount;
      maxTargetCount = effectiveCount;
    }
    const maxExecutableSelectionCount =
      getMaxAutoExecutableSummonFromZoneSelectionCount({
        state,
        actingPlayerId: cont.actingPlayerId,
        action: nativeAction,
        candidates: executableCandidates,
        getCardDefinitionById: args.getCardDefinitionById,
        maxCountHint: maxTargetCount,
      });
    maxTargetCount = Math.min(maxTargetCount, maxExecutableSelectionCount);
    requiredTargetCount = Math.min(
      requiredTargetCount,
      maxExecutableSelectionCount
    );
    if (maxTargetCount <= 0) return null;
    if (
      rawCandidates.length === candidates.length &&
      maxExecutableSelectionCount === candidates.length &&
      requiredTargetCount === maxTargetCount &&
      candidates.length === requiredTargetCount
    ) {
      return null;
    }

    return {
      pendingId: `psots:${pendingId}`,
      actingPlayerId: cont.actingPlayerId,
      choosingPlayerId: resolveChoosingPlayerId(),
      sourceInstanceId: cont.sourceInstanceId,
      sourceDefinitionId: cont.sourceDefinitionId,
      effectIndex: cont.effectIndex,
      stepIndex: cont.stepIndex,
      ...(args.stepLabel !== undefined ? { stepLabel: args.stepLabel } : {}),
      requiredTargetCount,
      maxTargetCount,
      candidateInstanceIds: [...candidates],
      targetStepId: stepIdResolved,
      continuation: cont,
    };
  }

  const target = getActionTargetSpec(activeAction);
  if (!target) return null;
  if (target.kind === "self" || target.kind === "ref") return null;
  if (target.kind !== "filter") return null;
  if (target.count === "all") return null;

  // 候補列挙は通常の legal action と同じ SSOT (getCandidateTargetInstanceIds) を通す。
  // prevention / target acquisition gate / target effect filter tags / extremal 等を漏らさず
  // 適用するため、target.filter から最小限の RegisteredTargetedEffectActionBase を構築して渡す
  // (verifier 指摘 2026-06-21 round 5)。
  const playerScope: import("./legal-actions-types").LegalActionTargetPlayerScope =
    target.player === "self"
      ? "acting_player"
      : target.player === "opponent"
        ? "opponent"
        : "any";
  const candidateZones = target.zone
    ? Array.isArray(target.zone)
      ? target.zone
      : [target.zone]
    : (["field"] as readonly Zone[]);
  // 防止レベル / target lock bypass の SSOT 経路 (verifier 指摘 2026-06-21 round 6/7):
  // 候補列挙経路と実解決経路で gate 条件を一致させるため、effect の preventionRestriction も
  // 解釈する derivePreventionProfile を使い、resistance と targetLockBypass を導出する。
  // continuation 由来 (cont.sourcePreventionLevel) は明示的に上書きされている場合の上位値として
  // 採用する。
  const effectProfile = derivePreventionProfile(
    effect as {
      preventionLevel?: import("../model").EffectPreventionLevel;
      preventionRestriction?: unknown;
      targetLockBypass?: import("../effect/target-affect-gate").TargetLockBypassProfile;
    }
  );
  const effectPreventionLevel =
    cont.sourcePreventionLevel ?? effectProfile?.resistance;
  const effectTargetLockBypass = effectProfile?.targetLockBypass;
  // effect_param_override CE 反映用に action.kind を伝搬する (verifier round 8 指摘)。
  // destroy/vanish/bounce/prevent_battle のみ対象 (extractFieldTargetingFromAction
  // §1163-1168 と同 SSOT)。exhaust/recover は候補列挙を解決時の状態 gate と揃える。
  const activeActionKind = (activeAction as { kind?: string }).kind;
  const targetCardFilterActionKind:
    | "destroy"
    | "vanish"
    | "bounce"
    | "prevent_battle"
    | "exhaust"
    | "recover"
    | undefined =
    activeActionKind === "destroy" ||
    activeActionKind === "vanish" ||
    activeActionKind === "bounce" ||
    activeActionKind === "prevent_battle" ||
    activeActionKind === "exhaust" ||
    activeActionKind === "recover"
      ? activeActionKind
      : undefined;
  const targetExhaustState =
    activeActionKind === "exhaust"
      ? (activeAction as { degree?: unknown }).degree === "heavy_exhaust"
        ? ("heavily_exhausted" as const)
        : ("exhausted" as const)
      : undefined;
  const braveCombineHostOnly =
    targetRequiresBraveCombineHostEligibility(activeAction);
  const braveCombineIncomingBraveDefinition = braveCombineHostOnly
    ? resolveBraveCombineIncomingBraveDefinition(
        activeAction,
        state,
        stepContext,
        args.getCardDefinitionById
      )
    : undefined;
  const braveCombineIncomingBraveInstanceId = braveCombineHostOnly
    ? (resolveBraveCombineIncomingBraveInstanceId(activeAction, stepContext) ??
      cont.sourceInstanceId)
    : undefined;
  const targetEffectAspect = deriveEffectAspectForImmunity(activeAction);
  const sourceAttachedChildrenOnly =
    targetRequiresSourceAttachedChildren(activeAction);
  const syntheticRegistration: RegisteredTargetedEffectActionBase = {
    ...(targetEffectAspect !== undefined ? { targetEffectAspect } : {}),
    candidateTargetZones: candidateZones,
    candidateTargetPlayerScope: playerScope,
    ...(target.filter && Object.keys(target.filter).length > 0
      ? { targetCardFilter: target.filter }
      : {}),
    ...(target.excludeSelf ? { targetExcludeSelf: true } : {}),
    ...(targetCardFilterActionKind !== undefined
      ? { targetCardFilterActionKind }
      : {}),
    ...(targetExhaustState !== undefined ? { targetExhaustState } : {}),
    ...(braveCombineHostOnly ? { braveCombineHostOnly: true } : {}),
    ...(sourceAttachedChildrenOnly
      ? {
          sourceAttachedChildrenOnly: true,
          starGarmentTargetEligibleOnly: true,
        }
      : {}),
    ...(effectPreventionLevel !== undefined && effectPreventionLevel !== "none"
      ? { preventionLevel: effectPreventionLevel }
      : {}),
    ...(effectTargetLockBypass !== undefined &&
    effectTargetLockBypass.kind !== "none"
      ? { targetLockBypass: effectTargetLockBypass }
      : {}),
    ...(activeActionKind === "discard_set_burst"
      ? {
          targetSelectionBypassesAffectGate: true,
          targetCandidatesRequireSetBurstState: true,
        }
      : {}),
  };
  const rawCandidateInstanceIds = getCandidateTargetInstanceIds(
    state,
    cont.actingPlayerId,
    syntheticRegistration,
    {
      getCardDefinitionById: args.getCardDefinitionById,
      sourceInstanceId: cont.sourceInstanceId,
      affectSourceIdentity: resolveAffectSourceIdentity({
        state,
        sourceInstanceId: cont.sourceInstanceId,
        sourceDefinition: args.sourceDefinition,
        effectSourceInstanceId: cont.effectSourceInstanceId,
        effectSourceDefinitionId: cont.effectSourceDefinitionId,
        getCardDefinitionById: args.getCardDefinitionById,
      }),
      // cardName:'self' フィルタ解決のため sourceDefinition を伝搬する
      // (verifier round 9 指摘)。
      ...(args.sourceDefinition
        ? { sourceDefinition: args.sourceDefinition }
        : {}),
      ...(braveCombineIncomingBraveDefinition
        ? { braveCombineIncomingBraveDefinition }
        : {}),
      ...(braveCombineIncomingBraveInstanceId
        ? { braveCombineIncomingBraveInstanceId }
        : {}),
      ...(cont.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: cont.sourcePreventionBypass }
        : {}),
      evaluateCondition: (condition, sourceInstanceId, actingPlayerId) =>
        evaluateCondition(
          state,
          condition,
          sourceInstanceId,
          actingPlayerId,
          args.getCardDefinitionById
        ),
      evaluateApplicability: (applicability, sourceInstanceId) =>
        evaluateApplicability(
          state,
          applicability,
          sourceInstanceId,
          args.getCardDefinitionById
        ),
    }
  );
  // step optional target の追加選択では通常 filter target に限り、flush 前の
  // pending leave 個体を新規候補にしない。trigger_related_instance(s) は
  // includePendingLeave を尊重するため、この局所 gate では leave-related target を塞がない。
  const sourceStepCandidateIds = target.stepId
    ? new Set(
        getStepResult(stepContext, target.stepId)?.affectedCardInstanceIds ?? []
      )
    : null;
  const excludedStepCandidateIds = target.excludeStepId
    ? new Set(
        getStepResult(stepContext, target.excludeStepId)
          ?.affectedCardInstanceIds ?? []
      )
    : null;
  const candidateInstanceIds =
    shouldExcludePendingLeaveFromStepOptionalTargetCandidates(target)
      ? rawCandidateInstanceIds.filter((instanceId) => {
          const card = getCardById(state, instanceId);
          if (sourceStepCandidateIds && !sourceStepCandidateIds.has(instanceId))
            return false;
          if (excludedStepCandidateIds?.has(instanceId)) return false;
          return card?.pendingLeaveKind === null;
        })
      : rawCandidateInstanceIds.filter(
          (instanceId) =>
            (!sourceStepCandidateIds ||
              sourceStepCandidateIds.has(instanceId)) &&
            !excludedStepCandidateIds?.has(instanceId)
        );
  if (candidateInstanceIds.length === 0) return null;
  // 上記 candidateInstanceIds は legal-actions-shared が prevention / acquisition gate 後の
  // 実体 instanceId 配列を返す。後続の clamp/長さ判定に使う。
  const candidates = candidateInstanceIds;
  const budgetAmount =
    target.budget !== undefined
      ? resolveAmountToNumber(
          target.budget.amount,
          state,
          cont.actingPlayerId,
          stepContext,
          args.getCardDefinitionById
        )
      : undefined;
  const bpBudgetAmount =
    target.budget?.metric === "bp" ? budgetAmount : undefined;
  const costBudgetAmount =
    target.budget?.metric === "cost" ? budgetAmount : undefined;
  const symbolBudgetAmount =
    target.budget?.metric === "symbol" ? budgetAmount : undefined;

  let requiredTargetCount: number;
  let maxTargetCount: number;
  if (typeof target.count === "number") {
    requiredTargetCount = target.count;
    maxTargetCount = target.count;
  } else if (
    typeof target.count === "object" &&
    target.count !== null &&
    "min" in target.count
  ) {
    requiredTargetCount =
      typeof target.count.min === "number"
        ? target.count.min
        : resolveCountBound(
            target.count.min,
            state,
            cont.actingPlayerId,
            stepContext,
            args.getCardDefinitionById
          );
    const max = target.count.max;
    if (max === undefined) {
      maxTargetCount = candidates.length;
    } else if (typeof max === "number") {
      maxTargetCount = max;
    } else {
      maxTargetCount = resolveCountBound(
        max,
        state,
        cont.actingPlayerId,
        stepContext,
        args.getCardDefinitionById
      );
    }
  } else {
    // DynamicCount: target-resolution と同じ SSOT (resolveCount) で動的解決する。
    // 「自分のカウント N につき 1 体まで」等の動的件数を 1 仮固定すると pending の
    // 件数範囲が誤って restrict される (verifier 指摘 2026-06-21 round 2)。
    const resolvedCount = resolveCount(
      target.count,
      state,
      cont.actingPlayerId,
      stepContext,
      args.getCardDefinitionById
    );
    // resolveCount は "all" を -1 として返す。filter+all は上で弾いているのでここでは現れない。
    requiredTargetCount = Math.max(0, resolvedCount);
    maxTargetCount = Math.max(0, resolvedCount);
  }
  // 候補数不足時は実効件数へ clamp する (10_rules/03b §104「可能な限り選ぶ」)。
  // 例: count=2 / candidates=1 で required=2/max=1 の解決不能 pending を作らない
  // (verifier 指摘 2026-06-21 round 4)。
  maxTargetCount = Math.min(maxTargetCount, candidates.length);
  requiredTargetCount = Math.min(requiredTargetCount, candidates.length);
  if (maxTargetCount <= 0) return null;
  // require=0/max>0 も pending 化する。0 体で確定した場合は resume 側で
  // targetSelectionResolved を渡し、auto target 解決へのフォールバックを防ぐ。
  // 選択余地がない: 必須数 === 最大数 で候補数とも一致 → engine 自動採用に委ねる。
  if (
    requiredTargetCount === maxTargetCount &&
    candidates.length === requiredTargetCount
  ) {
    return null;
  }
  const targetStepId = stepIdResolved;
  // chooser 解決: step.chooser (variant 上書き反映済 activeChooser) を effect owner 基準で
  // 実プレイヤー ID に変換する。
  // - "self" / undefined → actingPlayerId
  // - "opponent" → 相手プレイヤー (state.playerOrder から派生)
  // - "either" → 現状 actingPlayerId にフォールバック (両者選択は別 mechanism、未スコープ)
  const choosingPlayerId = resolveChoosingPlayerId();
  return {
    pendingId: `psots:${pendingId}`,
    actingPlayerId: cont.actingPlayerId,
    choosingPlayerId,
    sourceInstanceId: cont.sourceInstanceId,
    sourceDefinitionId: cont.sourceDefinitionId,
    effectIndex: cont.effectIndex,
    stepIndex: cont.stepIndex,
    ...(args.stepLabel !== undefined ? { stepLabel: args.stepLabel } : {}),
    requiredTargetCount,
    maxTargetCount,
    ...(bpBudgetAmount !== undefined ? { bpBudgetAmount } : {}),
    ...(costBudgetAmount !== undefined ? { costBudgetAmount } : {}),
    ...(symbolBudgetAmount !== undefined ? { symbolBudgetAmount } : {}),
    candidateInstanceIds: [...candidates],
    targetStepId,
    continuation: cont,
  };
}

function resolveStepOptionalActiveAction(args: {
  effect: import("../dsl-types").Effect;
  continuation: import("../model").StepOptionalContinuation;
}): import("../dsl-types").Action | null {
  const step = args.effect.steps[args.continuation.stepIndex];
  if (!step) return null;
  let activeAction: import("../dsl-types").Action = step.action;
  if (
    step.choice &&
    step.choice.length > 0 &&
    args.continuation.choiceIndex !== undefined &&
    args.continuation.choiceIndex > 0 &&
    args.continuation.choiceIndex <= step.choice.length
  ) {
    activeAction = step.choice[args.continuation.choiceIndex - 1]!.action;
  }
  return activeAction;
}

function buildStepOptionalSummonFromZoneNativeAction(args: {
  activeAction: import("../dsl-types").Action;
  continuation: import("../model").StepOptionalContinuation;
}): SummonAction | null {
  const { activeAction, continuation: cont } = args;
  if (
    activeAction.kind !== "summon" ||
    activeAction.target.kind !== "from_zone" ||
    activeAction.target.filter?.soulState === "only"
  ) {
    return null;
  }
  const summonTarget = activeAction.target;
  const summonCause: "effect" | "burst" =
    cont.effectActionKind === "burst_activation" ? "burst" : "effect";
  return {
    ...(activeAction.fieldCoreSourceMinimum !== undefined
      ? { fieldCoreSourceMinimum: activeAction.fieldCoreSourceMinimum }
      : {}),
    kind: "summon",
    target: "other",
    zone: normalizeSummonFromZoneZone(summonTarget.zone),
    count: 1,
    summonCause,
    ...(summonTarget.filter ? { filter: summonTarget.filter } : {}),
    ...(activeAction.costModifier === "free" ? { withoutCost: true } : {}),
    ...(typeof activeAction.costModifier === "object" &&
    "override" in activeAction.costModifier
      ? { overrideCost: activeAction.costModifier.override }
      : {}),
    ...(typeof activeAction.costModifier === "object" &&
    "fixedPayment" in activeAction.costModifier
      ? { fixedPayment: activeAction.costModifier.fixedPayment }
      : {}),
    ...(activeAction.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: activeAction.onBoardCoreSourceFilter }
      : {}),
    ...(activeAction.costModifier === "full_reduction"
      ? { fullReduction: true }
      : {}),
    ...(activeAction.trashCoreMax !== undefined
      ? { trashCoreMax: activeAction.trashCoreMax }
      : {}),
    ...(activeAction.trashCoreKind !== undefined
      ? { trashCoreKind: activeAction.trashCoreKind }
      : {}),
    ...(activeAction.ignoreSummonCondition
      ? { ignoreSummonCondition: true }
      : {}),
    ...(summonTarget.includeAdventSource ? { includeAdventSource: true } : {}),
    ...(summonTarget.includeSoulState ? { includeSoulState: true } : {}),
  };
}

function assertStepOptionalSummonFromZoneSelectionAutoExecutable(args: {
  state: GameState;
  pending: PendingStepOptionalTargetSelection;
  effect: import("../dsl-types").Effect;
  selected: readonly string[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): void {
  if (args.selected.length === 0) return;
  const activeAction = resolveStepOptionalActiveAction({
    effect: args.effect,
    continuation: args.pending.continuation,
  });
  if (!activeAction) return;
  const nativeAction = buildStepOptionalSummonFromZoneNativeAction({
    activeAction,
    continuation: args.pending.continuation,
  });
  if (!nativeAction) return;
  const currentCandidates = resolveSummonFromZoneCandidates(
    args.state,
    args.pending.actingPlayerId,
    {
      zone: nativeAction.zone!,
      ...(nativeAction.filter ? { filter: nativeAction.filter } : {}),
      ...(nativeAction.includeAdventSource
        ? { includeAdventSource: true }
        : {}),
      ...(nativeAction.includeSoulState ? { includeSoulState: true } : {}),
      ...(nativeAction.fullReduction ? { fullReduction: true } : {}),
    },
    args.getCardDefinitionById
  );
  const currentCandidateById = new Map(
    currentCandidates.map((candidate) => [candidate.instanceId, candidate])
  );
  const selectedCandidates = args.selected.map((id) => {
    const candidate = currentCandidateById.get(id);
    if (!candidate) {
      throw new Error(
        `Step optional summon target ${id} is no longer a summon candidate (pendingId=${args.pending.pendingId})`
      );
    }
    return candidate;
  });
  if (
    !canAutoExecuteSummonFromZoneCandidateSequence({
      state: args.state,
      actingPlayerId: args.pending.actingPlayerId,
      action: nativeAction,
      candidates: selectedCandidates,
      getCardDefinitionById: args.getCardDefinitionById,
    })
  ) {
    throw new Error(
      `Step optional summon target selection is not collectively auto-executable (pendingId=${args.pending.pendingId})`
    );
  }
}

/**
 * PendingStepOptionalTargetSelection を解決する。GUI/サーバから渡された targetInstanceIds を
 * pending の候補・件数 (`requiredTargetCount` / `maxTargetCount`) で検証し、当該 optional step
 * を target 注入付きで再開する (executeEffect の `optionalExecuteResumeStepIndex` 経路)。
 */
export function applyPendingStepOptionalTargetSelectionAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingStepOptionalTargetSelectionResult {
  const pending = options.state.pendingStepOptionalTargetSelection;
  if (!pending) {
    throw new Error("No pending step optional target selection to resolve");
  }
  const action = options.action;
  if (action.kind !== "resolve_pending_step_optional_target_selection") {
    throw new Error(
      `applyPendingStepOptionalTargetSelection expects action.kind=resolve_pending_step_optional_target_selection (got ${action.kind})`
    );
  }
  if (action.pendingId !== pending.pendingId) {
    throw new Error(
      `pendingStepOptionalTargetSelection pendingId mismatch: action=${action.pendingId} pending=${pending.pendingId}`
    );
  }
  // 権限検証は choosingPlayerId (= 対象選択者) で行う。effect owner と一致する場合
  // (chooser='self' or 省略) は actingPlayerId と choosingPlayerId が同値、
  // chooser='opponent' のときは相手プレイヤーが apply 主体。
  if (action.actingPlayerId !== pending.choosingPlayerId) {
    throw new Error(
      `pendingStepOptionalTargetSelection choosingPlayerId mismatch: action=${action.actingPlayerId} pending=${pending.choosingPlayerId}`
    );
  }
  const selected = options.targetInstanceIds ?? [];
  if (
    selected.length < pending.requiredTargetCount ||
    selected.length > pending.maxTargetCount
  ) {
    throw new Error(
      `Step optional target count ${selected.length} out of range [${pending.requiredTargetCount}, ${pending.maxTargetCount}]`
    );
  }
  const candidateSet = new Set(pending.candidateInstanceIds);
  const seen = new Set<string>();
  for (const id of selected) {
    if (!candidateSet.has(id)) {
      throw new Error(
        `Step optional target ${id} is not a candidate (pendingId=${pending.pendingId})`
      );
    }
    if (seen.has(id)) {
      throw new Error(`Step optional target list contains duplicate ${id}`);
    }
    seen.add(id);
  }
  // forced_target_inclusion タウント (「可能なら対象に含めなければならない」):
  // on_step 型の対象選択 (destroy/vanish/bounce/prevent_battle/exhaust 等) も
  // pendingEffectTargetSelection と同じくタウント対象を除外できない (2経路目)。
  const mandatoryForcedTargetIds = getMandatoryForcedTargetInclusionIds(
    options.state,
    pending.actingPlayerId,
    pending.candidateInstanceIds,
    pending.maxTargetCount
  );
  if (mandatoryForcedTargetIds.length > 0) {
    const selectedSet = new Set(selected);
    const missing = mandatoryForcedTargetIds.filter(
      (id) => !selectedSet.has(id)
    );
    if (missing.length > 0) {
      throw new Error(
        `Step optional target selection must include forced target inclusion candidate(s): ${missing.join(",")}`
      );
    }
  }
  // 予算制対象選択: 選択集合の実効BP/コスト合計が budget を超えないことを検証する
  // （count 範囲とは独立の制約）。
  // getCombinedUnitBp (host+合体ブレイヴの「BP＋」加算込み、10_rules/05) を使う。選択対象が
  // 合体スピリットなら合体ブレイヴの BP＋ 分も消費 BP に含める必要がある（bpBudgetAmount 側の
  // 算出と定義を揃えないと budget/消費の両側で不整合になる）。
  if (pending.bpBudgetAmount !== undefined) {
    const selectedBpTotal = selected.reduce((sum, id) => {
      const card = options.state.cardInstances.find((c) => c.instanceId === id);
      if (!card) return sum;
      const def = options.getCardDefinitionById(card.definitionId);
      return (
        sum +
        getCombinedUnitBp(
          options.state,
          card,
          def,
          options.getCardDefinitionById
        )
      );
    }, 0);
    if (selectedBpTotal > pending.bpBudgetAmount) {
      throw new Error(
        `Step optional target BP total ${selectedBpTotal} exceeds budget ${pending.bpBudgetAmount} (pendingId=${pending.pendingId})`
      );
    }
  }
  if (pending.costBudgetAmount !== undefined) {
    const selectedCostTotal = selected.reduce((sum, id) => {
      const card = options.state.cardInstances.find((c) => c.instanceId === id);
      if (!card) return sum;
      const def = options.getCardDefinitionById(card.definitionId);
      return def
        ? sum +
            getCombinedUnitEffectiveOrAdditionalCost(
              options.state,
              card,
              def,
              options.getCardDefinitionById
            )
        : sum;
    }, 0);
    if (selectedCostTotal > pending.costBudgetAmount) {
      throw new Error(
        `Step optional target cost total ${selectedCostTotal} exceeds budget ${pending.costBudgetAmount} (pendingId=${pending.pendingId})`
      );
    }
  }
  if (pending.symbolBudgetAmount !== undefined) {
    const selectedSymbolTotal = selected.reduce((sum, id) => {
      const card = options.state.cardInstances.find((c) => c.instanceId === id);
      if (!card) return sum;
      const def = options.getCardDefinitionById(card.definitionId);
      return (
        sum +
        getCombinedUnitSymbolCount(
          options.state,
          card,
          def,
          options.getCardDefinitionById
        )
      );
    }, 0);
    if (selectedSymbolTotal > pending.symbolBudgetAmount) {
      throw new Error(
        `Step optional target symbol total ${selectedSymbolTotal} exceeds budget ${pending.symbolBudgetAmount} (pendingId=${pending.pendingId})`
      );
    }
  }
  const def = options.getCardDefinitionById(
    pending.continuation.sourceDefinitionId
  );
  const effect =
    pending.continuation.resumeEffectOverride ??
    resolveContinuationEffect(def, pending.continuation);
  if (!effect) {
    throw new Error(
      `applyPendingStepOptionalTargetSelection: effect not found ${pending.continuation.sourceDefinitionId} [${pending.continuation.effectIndex}]`
    );
  }
  assertStepOptionalSummonFromZoneSelectionAutoExecutable({
    state: options.state,
    pending,
    effect,
    selected,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const beforeResume: GameState = {
    ...options.state,
    pendingStepOptionalTargetSelection: null,
    log: [
      ...options.state.log,
      `effect:step-optional-target-resolved:${pending.pendingId}:${selected.join(",")}`,
    ],
  };
  const reconstructedPending: import("../model").PendingStepOptionalChoice = {
    pendingId: pending.pendingId,
    actingPlayerId: pending.actingPlayerId,
    // execute resume では既に choice は確定済み (target 選択窓に到達した = execute 選択)
    // のため、choosingPlayerId は actingPlayerId にフォールバック (権限検証は通らない経路)。
    choosingPlayerId: pending.actingPlayerId,
    sourceInstanceId: pending.sourceInstanceId,
    sourceDefinitionId: pending.sourceDefinitionId,
    effectIndex: pending.effectIndex,
    stepIndex: pending.stepIndex,
    ...(pending.stepLabel !== undefined
      ? { stepLabel: pending.stepLabel }
      : {}),
    continuation: pending.continuation,
  };
  let finalState = resumeStepOptional({
    state: beforeResume,
    effect,
    pending: reconstructedPending,
    choice: "execute",
    options,
    sourceDefinition: def,
    selectedTargetInstanceIds: selected,
    selectedTargetStepId: pending.targetStepId,
  });
  finalState = resumePendingRetriggerContinuations({
    ...options,
    state: finalState,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  return { state: finalState };
}

export function hasOpenEffectResolutionPending(state: GameState): boolean {
  return hasPendingEffectResolution(state, "effect");
}

/**
 * DrawStepCostChoice pending を解決する（コスト先払い型ドロー枚数修正 model A）。
 * 支払い (pay) なら破棄カードを指定して +N 確定、辞退 (decline) なら不加算。全エントリ解決後に
 * turn-system がシステムドローを bonus 付きで再開する。ルール正源: 10_rules/02 §コスト先払い型。
 */
export function applyPendingDrawStepCostChoiceAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingDrawStepCostChoiceResult {
  const pending = options.state.pendingDrawStepCostChoice;
  if (!pending) {
    throw new Error("No pending draw step cost choice to resolve");
  }
  const choice = options.drawStepCostChoice ?? "decline";
  const state = resolvePendingDrawStepCostChoice(
    options.state,
    choice,
    options.drawStepCostDiscardCardInstanceId,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
    }
  );
  return { state };
}

/**
 * SummonCostExcludeChoice pending を解決する（BSTH02.7-M01 effects[0] 等）。
 * 選択された候補カードをトラッシュから removed_from_game へ移動し、選択枚数分の
 * additionalCostModifiers を確定した上で、同じ sourceInstanceId の summon を即座に実行する
 * （summon action 本体の分岐は case "summon" の opensPlayCardStack 判定と同型）。
 */
export function applyPendingSummonCostExcludeChoiceAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingSummonCostExcludeChoiceResult {
  const pending = options.state.pendingSummonCostExcludeChoice;
  const beforeState = cloneStateForTriggerDelta(options.state);
  const result = applyPendingSummonCostExcludeChoiceActionInternal(options);
  return pending?.effectSummonActivationZone !== undefined
    ? {
        ...result,
        state: finalizeEffectSummonCostChoice(
          { ...options, state: beforeState },
          result.state,
          pending
        ),
      }
    : result;
}

function finalizeEffectSummonCostChoice(
  options: ApplyLegalActionOptions,
  state: GameState,
  pending: {
    pendingId: string;
    actingPlayerId: string;
    sourceInstanceId: string;
    sourceDefinitionId: string;
    effectSummonChainId?: string;
  }
): GameState {
  return createEffectResolutionScope({
    chainId: requireTriggerChainId(pending.effectSummonChainId),
  }).finalize({
    state,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    causedBySourceInstanceId: pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
  });
}

function applyPendingSummonCostExcludeChoiceActionInternal(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingSummonCostExcludeChoiceResult {
  const pending = options.state.pendingSummonCostExcludeChoice;
  if (!pending) {
    throw new Error("No pending summon cost exclude choice to resolve");
  }

  const selection = resolveSummonCostExcludeChoiceSelection(
    options.state,
    pending,
    options.summonCostExcludeSelectedCardInstanceIds ?? [],
    options.getCardDefinitionById
  );

  const stateWithChoiceClosed: import("../model").GameState = {
    ...selection.state,
    pendingSummonCostExcludeChoice: null,
  };

  // fullReduction (ENGINE-summon-self-exclude-alt-cost-full-reduction, BSTH11-M01 effects[0]):
  // 除外による支払いは線形割引ではなく costModifier:"full_reduction" と同一計算に合流する。
  // additionalCostModifiers (常に amount:0) の代わりに fixedPaymentCost を summon に渡す。
  const sourceCardForFullReduction = getCardById(
    stateWithChoiceClosed,
    pending.sourceInstanceId
  );
  const fullReductionFixedPaymentCost =
    selection.grantsFullCostPaid && sourceCardForFullReduction
      ? calculateFullyPaidSummonRemainingCost(
          stateWithChoiceClosed,
          pending.actingPlayerId,
          options.getCardDefinitionById(
            sourceCardForFullReduction.definitionId
          )!,
          sourceCardForFullReduction,
          options.getCardDefinitionById,
          pending.effectSummonActivationZone ? "effect" : undefined
        )
      : selection.grantsFullReduction && sourceCardForFullReduction
        ? calculateFullReductionSummonCost({
            state: stateWithChoiceClosed,
            actingPlayerId: pending.actingPlayerId,
            definition: options.getCardDefinitionById(
              sourceCardForFullReduction.definitionId
            )!,
            sourceInstanceId: pending.sourceInstanceId,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        : undefined;

  const paymentSources = options.paymentSources ?? [];
  if (pending.effectSummonActivationZone !== undefined) {
    const summoned = executeSummon(
      stateWithChoiceClosed,
      requireTriggerChainId(pending.effectSummonChainId),
      pending.actingPlayerId,
      buildEffectSummonSelfActionFromPending({
        activationZone: pending.effectSummonActivationZone,
        ...(fullReductionFixedPaymentCost !== undefined
          ? { fixedPaymentCost: fullReductionFixedPaymentCost }
          : {}),
      }),
      pending.sourceInstanceId,
      options.getCardDefinitionById,
      paymentSources,
      options.enterFieldCorePlacements,
      undefined,
      undefined,
      pending.effectSummonSourceEffectIndex,
      pending.effectSummonActivationZone,
      false,
      pending.effectSummonEffectTiming,
      fullReductionFixedPaymentCost !== undefined
        ? undefined
        : selection.additionalCostModifiers,
      undefined,
      options
    );
    return { state: summoned };
  }
  // 自己召喚許可 (summonPermissionEffectIndex 設定時) は main step 以外（フラッシュ窓等）でも
  // 常にスタック窓を開く (BSTH02.7-X02 effects[1] 型。legal-actions-apply.ts の通常 summon
  // 経路 opensPlayCardStack と同じ判定を pending 解決側にも複製する。SSOT: 両者とも
  // 「自己召喚許可は main 以外でも使える」同一ルールの別 chokepoint)。
  const opensPlayCardStack =
    (stateWithChoiceClosed.step === "main" &&
      stateWithChoiceClosed.activePlayerId === pending.actingPlayerId) ||
    pending.summonPermissionEffectIndex !== undefined;

  if (opensPlayCardStack) {
    const deferredResult = useSummonInStackContextAsAction({
      state: stateWithChoiceClosed,
      actingPlayerId: pending.actingPlayerId,
      cardInstanceId: pending.sourceInstanceId,
      paymentSources,
      ...(fullReductionFixedPaymentCost !== undefined
        ? { fixedPaymentCost: fullReductionFixedPaymentCost }
        : { additionalCostModifiers: selection.additionalCostModifiers }),
      ...(pending.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(pending.summonPermissionEffectIndex !== undefined
        ? {
            allowNonMainStep: true,
            sourceEffectIndex: pending.summonPermissionEffectIndex,
          }
        : {}),
      ...(options.enterFieldCorePlacements
        ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
        : {}),
    });
    // 自己召喚許可 (summonPermissionEffectIndex) の〔ターンに1回：同名〕等の使用制限は
    // legal-actions-apply.ts の case "summon" 通常経路と同じ chokepoint で記録する必要がある。
    // pending 経由 (BSTH02.7-X02 等) では summon 本体が deferred stack context を通るため、
    // このタイミングを逃すと記録漏れで無制限召喚になる (adversarial verifier 指摘)。
    const stateAfterSummonPermissionUsageRecord =
      pending.summonPermissionEffectIndex !== undefined
        ? recordEffectUsageIfLimited({
            state: deferredResult.state,
            sourceInstanceId: pending.sourceInstanceId,
            sourceDefinitionId: pending.sourceDefinitionId,
            effectLabel: getStableEffectLabel(
              "summon_permission",
              pending.summonPermissionEffectIndex,
              { effectIndex: pending.summonPermissionEffectIndex }
            ),
            usageLimit: pending.summonPermissionUsageLimit,
            ...(pending.summonPermissionLimitGroupId
              ? { groupId: pending.summonPermissionLimitGroupId }
              : {}),
          })
        : deferredResult.state;
    return {
      state: openEffectDeclarationStackWindow({
        baseState: stateWithChoiceClosed,
        stateAfterDeclaration: stateAfterSummonPermissionUsageRecord,
        rollbackBeforeState: options.state,
        rollbackExcludedCardIds:
          options.summonCostExcludeSelectedCardInstanceIds ?? [],
        activeStack: deferredResult.activeStack,
        actingPlayerId: pending.actingPlayerId,
      }),
      chainId: deferredResult.activeStack.chainId,
    };
  }

  const result = playSummonAsAction({
    state: stateWithChoiceClosed,
    actingPlayerId: pending.actingPlayerId,
    cardInstanceId: pending.sourceInstanceId,
    paymentSources,
    ...(fullReductionFixedPaymentCost !== undefined
      ? { fixedPaymentCost: fullReductionFixedPaymentCost }
      : { additionalCostModifiers: selection.additionalCostModifiers }),
    ...(pending.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.getHandWrittenEffectResolver
      ? { getHandWrittenEffectResolver: options.getHandWrittenEffectResolver }
      : {}),
    ...(options.enterFieldCorePlacements
      ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
      : {}),
  });
  return { state: result.state };
}

/**
 * SummonCostCoreMoveChoice pending を解決する（BSSL01-M02 effects[0,1]）。
 * 選択された枚数分のコアをトラッシュから移動先へ移し、costOffset 分の
 * additionalCostModifiers を確定した上で、同じ sourceInstanceId の summon を即座に実行する
 * （`applyPendingSummonCostExcludeChoiceAction` と同型の chokepoint 分岐）。
 */
export function applyPendingSummonCostCoreMoveChoiceAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingSummonCostCoreMoveChoiceResult {
  const pending = options.state.pendingSummonCostCoreMoveChoice;
  const beforeState = cloneStateForTriggerDelta(options.state);
  const result = applyPendingSummonCostCoreMoveChoiceActionInternal(options);
  return pending?.effectSummonActivationZone !== undefined
    ? {
        ...result,
        state: finalizeEffectSummonCostChoice(
          { ...options, state: beforeState },
          result.state,
          pending
        ),
      }
    : result;
}

function applyPendingSummonCostCoreMoveChoiceActionInternal(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingSummonCostCoreMoveChoiceResult {
  const pending = options.state.pendingSummonCostCoreMoveChoice;
  if (!pending) {
    throw new Error("No pending summon cost core move choice to resolve");
  }
  if (options.summonCostCoreMoveSelectedCount === undefined) {
    throw new Error(
      "Summon cost core move choice: summonCostCoreMoveSelectedCount is required"
    );
  }

  const rawDestination = options.summonCostCoreMoveDestination ?? "reserve";
  const destination: SummonCostCoreMoveDestination =
    rawDestination === "reserve"
      ? { kind: "reserve" }
      : { kind: "field_card", instanceId: rawDestination.fieldCardInstanceId };

  const selection = resolveSummonCostCoreMoveChoiceSelection(
    options.state,
    pending,
    options.summonCostCoreMoveSelectedCount,
    destination,
    options.summonCostCoreMoveAllocations,
    options.getCardDefinitionById
  );

  const stateWithChoiceClosed: import("../model").GameState = {
    ...selection.state,
    pendingSummonCostCoreMoveChoice: null,
  };

  const paymentSources = options.paymentSources ?? [];
  if (pending.effectSummonActivationZone !== undefined) {
    if (pending.grantsFreeSummon) {
      const freeEffect: import("../dsl-types").Effect = {
        timing: pending.effectSummonEffectTiming ?? {
          kind: "activated",
          mode: "flash",
        },
        steps: [
          {
            action: {
              kind: "summon",
              target: { kind: "self" },
              costModifier: "free",
            },
          },
        ],
      };
      return {
        state: createEffectResolutionScope({
          chainId: requireTriggerChainId(pending.effectSummonChainId),
        }).execute({
          state: stateWithChoiceClosed,
          effect: freeEffect,
          effectIndex: pending.effectSummonSourceEffectIndex ?? 0,
          optionalStepResumeEffectOverride: freeEffect,
          allowPendingPayCostSourceAllocation: true,
          sourceInstanceId: pending.sourceInstanceId,
          actingPlayerId: pending.actingPlayerId,
          activationZone: pending.effectSummonActivationZone,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          ...(options.getRegisteredBurstActions !== undefined
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
          ...(options.paymentSources !== undefined
            ? { summonPaymentSources: options.paymentSources }
            : {}),
          ...(options.enterFieldCorePlacements !== undefined
            ? {
                summonEnterFieldCorePlacements:
                  options.enterFieldCorePlacements,
              }
            : {}),
        }),
      };
    }
    const summoned = executeSummon(
      stateWithChoiceClosed,
      requireTriggerChainId(pending.effectSummonChainId),
      pending.actingPlayerId,
      buildEffectSummonSelfActionFromPending({
        activationZone: pending.effectSummonActivationZone,
      }),
      pending.sourceInstanceId,
      options.getCardDefinitionById,
      paymentSources,
      options.enterFieldCorePlacements,
      undefined,
      undefined,
      pending.effectSummonSourceEffectIndex,
      pending.effectSummonActivationZone,
      false,
      pending.effectSummonEffectTiming,
      selection.additionalCostModifiers,
      undefined,
      options
    );
    return { state: summoned };
  }
  // 自己召喚許可 (summonPermissionEffectIndex 設定時) は main step 以外（フラッシュ窓等）でも
  // 常にスタック窓を開く（BSSL01-M02 は flash mode 専用のため常にこちらを通る）。
  const opensPlayCardStack =
    (stateWithChoiceClosed.step === "main" &&
      stateWithChoiceClosed.activePlayerId === pending.actingPlayerId) ||
    pending.summonPermissionEffectIndex !== undefined;

  const freePayment = pending.grantsFreeSummon
    ? {
        fixedPaymentCost: calculateFreeSummonCost({
          state: stateWithChoiceClosed,
          actingPlayerId: pending.actingPlayerId,
          definition: options.getCardDefinitionById(
            pending.sourceDefinitionId
          )!,
          sourceInstanceId: pending.sourceInstanceId,
          getCardDefinitionById: options.getCardDefinitionById,
        }),
      }
    : {};

  if (opensPlayCardStack) {
    const deferredResult = useSummonInStackContextAsAction({
      state: stateWithChoiceClosed,
      ...freePayment,
      actingPlayerId: pending.actingPlayerId,
      cardInstanceId: pending.sourceInstanceId,
      paymentSources,
      additionalCostModifiers: selection.additionalCostModifiers,
      ...(pending.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(pending.summonPermissionEffectIndex !== undefined
        ? {
            allowNonMainStep: true,
            sourceEffectIndex: pending.summonPermissionEffectIndex,
          }
        : {}),
      ...(options.enterFieldCorePlacements
        ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
        : {}),
    });
    // 自己召喚許可 (summonPermissionEffectIndex) の〔ターンに1回：同名〕等の使用制限を
    // deferred stack context 通過後に記録する（applyPendingSummonCostExcludeChoiceAction と
    // 同型の chokepoint。記録漏れは BSSL01-M02 の〔ターンに1回：同名〕バイパスに直結する）。
    const stateAfterSummonPermissionUsageRecord =
      pending.summonPermissionEffectIndex !== undefined
        ? recordEffectUsageIfLimited({
            state: deferredResult.state,
            sourceInstanceId: pending.sourceInstanceId,
            sourceDefinitionId: pending.sourceDefinitionId,
            effectLabel: getStableEffectLabel(
              "summon_permission",
              pending.summonPermissionEffectIndex,
              { effectIndex: pending.summonPermissionEffectIndex }
            ),
            usageLimit: pending.summonPermissionUsageLimit,
            ...(pending.summonPermissionLimitGroupId
              ? { groupId: pending.summonPermissionLimitGroupId }
              : {}),
          })
        : deferredResult.state;
    return {
      state: openEffectDeclarationStackWindow({
        baseState: stateWithChoiceClosed,
        stateAfterDeclaration: stateAfterSummonPermissionUsageRecord,
        activeStack: deferredResult.activeStack,
        actingPlayerId: pending.actingPlayerId,
      }),
      chainId: deferredResult.activeStack.chainId,
    };
  }

  const result = playSummonAsAction({
    state: stateWithChoiceClosed,
    ...freePayment,
    actingPlayerId: pending.actingPlayerId,
    cardInstanceId: pending.sourceInstanceId,
    paymentSources,
    additionalCostModifiers: selection.additionalCostModifiers,
    ...(pending.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: pending.onBoardCoreSourceFilter }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.getHandWrittenEffectResolver
      ? { getHandWrittenEffectResolver: options.getHandWrittenEffectResolver }
      : {}),
    ...(options.enterFieldCorePlacements
      ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
      : {}),
  });
  return { state: result.state };
}

/**
 * GroupedSummonCostOverrideChoice pending を解決する (BSTH02.7-C06 branch2)。
 * 選択されたトラッシュカードを除外し、floor(除外枚数/groupSize) 体分
 * summonTargetInstanceIds の先頭のコストを overrideCost にした上で、executeSummonOther を
 * 直接実行する (applyPendingCoreCountAction と同型: 発動元 effect step へは戻らず、この
 * pending の解決自体が召喚の実行そのものを兼ねる。paymentSources は使わず自動 reserve
 * 経路に委ねる)。
 */
export function applyPendingGroupedSummonCostOverrideChoiceAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingGroupedSummonCostOverrideChoiceResult {
  const pending = options.state.pendingGroupedSummonCostOverrideChoice;
  if (!pending) {
    throw new Error(
      "No pending grouped summon cost override choice to resolve"
    );
  }

  const selection = resolveGroupedSummonCostOverrideSelection(
    options.state,
    pending,
    options.groupedSummonCostOverrideSelectedCardInstanceIds ?? []
  );

  const stateWithChoiceClosed: import("../model").GameState = {
    ...selection.state,
    pendingGroupedSummonCostOverrideChoice: null,
  };

  const v1Action: import("../model").SummonAction = {
    kind: "summon",
    target: "other",
    zone: "hand_or_set_aside",
    count: pending.summonTargetInstanceIds.length,
    ...(Object.keys(selection.perCardOverrideCost).length > 0
      ? { perCardOverrideCost: selection.perCardOverrideCost }
      : {}),
    ...(pending.nonOverrideFullReduction ? { fullReduction: true } : {}),
  };

  const nextState = executeSummonOther(
    stateWithChoiceClosed,
    pending.chainId,
    pending.actingPlayerId,
    v1Action,
    pending.sourceInstanceId,
    options.getCardDefinitionById,
    undefined,
    undefined,
    pending.summonTargetInstanceIds
  );

  // 召喚対象がブレイヴのとき、executeSummonOther は合体先選択待ちの
  // pendingBraveCombineChoice をセットして早期 return することがある
  // (structured-summon.ts の maybeOpenEffectSummonedBraveCombineChoice、P3-100)。
  // その場合はまだ召喚が完結していないため finalizeEffectResolution を呼ばずそのまま返す
  // (同型ガード: structured-summon.ts:731,824 / effect-interpreter.ts hasBlockingPendingSelection)。
  if (nextState.pendingBraveCombineChoice !== null) {
    return { state: nextState };
  }

  const finalState = createEffectResolutionScope({
    chainId: pending.chainId,
  }).finalize({
    state: nextState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: nextState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId: pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
  });

  return { state: finalState };
}

/**
 * LifeDamageDiscardChoice pending を解決する（discardCostGate 破棄コストゲート）。
 * 支払い (pay) ならソースカード自身を破棄してダメージ 0、辞退 (decline) なら
 * pendingAmount を通常通り適用する。ルール正源: 10_rules/02 §コスト先払い型
 * ドロー枚数修正と同じプレ判断モデル。
 */
export function resumeEffectAfterCoreMoveChoice(
  state: GameState,
  pending: Pick<
    NonNullable<GameState["pendingLifeDamageDiscardChoice"]>,
    "continuation" | "stepResultId"
  >,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >,
  beforePendingState: GameState,
  originalMoveReplaced = false,
  resolutionScope?: ReturnType<typeof createEffectResolutionScope>
): GameState {
  const cont = pending.continuation;
  if (!cont) return state;
  if (state.pendingLifeCoreSelection)
    return {
      ...state,
      pendingLifeCoreSelection: {
        ...state.pendingLifeCoreSelection,
        continuation: cont,
        deferredCoreMoveChoice: {
          ...(pending.stepResultId !== undefined
            ? { stepResultId: pending.stepResultId }
            : {}),
          beforeState: beforePendingState,
          originalMoveReplaced,
        },
      },
    };
  const coreMoveSucceeded =
    !originalMoveReplaced &&
    didNonCardActionChangeState("core_move", beforePendingState, state) ===
      true;
  const stepContext =
    pending.stepResultId !== undefined
      ? {
          ...cont.stepContext,
          results: {
            ...cont.stepContext.results,
            [pending.stepResultId]: {
              stepId: pending.stepResultId,
              affectedCardInstanceIds: originalMoveReplaced
                ? []
                : getCoreMoveChangedCardIds(beforePendingState, state),
              succeeded: coreMoveSucceeded,
              executed: coreMoveSucceeded,
              ...(() => {
                const numericAmount = originalMoveReplaced
                  ? 0
                  : getCoreMoveChangedCoreAmount(beforePendingState, state);
                return numericAmount > 0 ? { numericAmount } : {};
              })(),
            },
          },
        }
      : cont.stepContext;
  return resumeEffectBodyAfterChoice(
    state,
    cont,
    options,
    stepContext,
    resolutionScope
  );
}

/** SBA choices resolve an already-completed effect step. Keep its context
 * unchanged across every separation/core choice and resume exactly once. */
function finalizeRuleBraveSeparation(
  state: GameState,
  pending: PendingZoneSelection | PendingCoreDistribution,
  options: ApplyLegalActionOptions
): GameState {
  const cont = pending.continuation;
  const resolution = createEffectResolutionScope(
    cont ?? { chainId: `rule-brave-separation:${pending.pendingId}` },
    pending.battleEndDeferralAttackId
  );
  state = resolution.finalize({
    state,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: cont?.actingPlayerId ?? pending.actingPlayerId,
    causedBySourceInstanceId:
      cont?.effectSourceInstanceId ??
      cont?.sourceInstanceId ??
      pending.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  const inheritedMetadata = {
    ...(pending.postResolutionOracle
      ? { postResolutionOracle: pending.postResolutionOracle }
      : {}),
    ...(pending.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: pending.battleEndDeferralAttackId }
      : {}),
  };
  if (state.pendingCoreDistribution?.stateBasedBraveSeparation) {
    state = {
      ...state,
      pendingCoreDistribution: {
        ...state.pendingCoreDistribution,
        ...inheritedMetadata,
        ...(cont ? { continuation: cont } : {}),
      },
    };
    return applyTargetedDisclosureResolutionCleanupsWhenReady(
      state,
      pending.targetedDisclosureResolutionCleanups
    );
  }
  if (state.pendingZoneSelection?.braveCapacityHostInstanceId !== undefined) {
    state = {
      ...state,
      pendingZoneSelection: {
        ...state.pendingZoneSelection,
        ...inheritedMetadata,
        ...(cont
          ? { continuation: { ...cont, recordStepId: "__rule_cleanup" } }
          : {}),
      },
    };
    return applyTargetedDisclosureResolutionCleanupsWhenReady(
      state,
      pending.targetedDisclosureResolutionCleanups
    );
  }
  if (cont) {
    const beforeResume = state;
    state = resumeEffectBodyAfterChoice(state, cont, options);
    state = resolution.finalize({
      state,
      beforeState: beforeResume,
      endLogs: [],
      actingPlayerId: cont.actingPlayerId,
      causedBySourceInstanceId:
        cont.effectSourceInstanceId ?? cont.sourceInstanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }
  state = checkAndQueuePostResolutionOracleIfReady(
    state,
    cont?.postResolutionOracle ?? pending.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  state = applyTargetedDisclosureResolutionCleanupsWhenReady(
    state,
    pending.targetedDisclosureResolutionCleanups
  );
  if (!hasOutstandingEffectResolutionContinuation(state))
    state = resumeStackCascadeIfReady(state, options);
  return maybeFinalizeBattleEndScopeAfterPendingDrain(state, options);
}

/** 保存した本文の再開情報を一箇所で復元する。選択固有の処理は StepResult を渡す。 */
export function resumeEffectBodyAfterChoice(
  state: GameState,
  cont: import("../model").LifeCoreSelectionContinuation,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >,
  stepContext = cont.stepContext,
  resolution = createEffectResolutionScope(cont)
): GameState {
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  const effect =
    cont.resumeEffectOverride ?? resolveContinuationEffect(def, cont);
  if (!effect)
    throw new Error(
      `Cannot resume effect: ${cont.sourceDefinitionId}[${cont.effectIndex}]`
    );
  const battleEndAttackId = cont.battleEndDeferralAttackId;
  return resolution.execute({
    state:
      cont.targetedDisclosureContinuation !== undefined
        ? {
            ...state,
            pendingTargetedDisclosureContinuation:
              cont.targetedDisclosureContinuation,
          }
        : state,
    targetedDisclosureSourceDefinitionId: cont.sourceDefinitionId,
    effect,
    effectIndex: cont.effectIndex,
    ...(cont.divineSkillIndex !== undefined
      ? { divineSkillIndex: cont.divineSkillIndex }
      : {}),
    ...(cont.isAccelData !== undefined
      ? { isAccelData: cont.isAccelData }
      : {}),
    ...(cont.isChangeData !== undefined
      ? { isChangeData: cont.isChangeData }
      : {}),
    sourceInstanceId: cont.sourceInstanceId,
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    startFromStepIndex: cont.resumeStepIndex,
    ...(cont.resumePreviousStepPreState
      ? { resumePreviousStepPreState: cont.resumePreviousStepPreState }
      : {}),
    restoredStepContext: stepContext,
    ...(cont.initialStepResults
      ? { initialStepResults: cont.initialStepResults }
      : {}),
    ...(cont.pendingEffectPendingId
      ? { pendingEffectPendingId: cont.pendingEffectPendingId }
      : {}),
    ...(cont.repeatResume !== undefined
      ? { repeatResume: cont.repeatResume }
      : {}),
    ...(cont.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: cont.effectSourceInstanceId }
      : {}),
    ...(cont.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
      : {}),
    ...(cont.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
      : {}),
    ...(cont.choiceIndex !== undefined
      ? { choiceIndex: cont.choiceIndex }
      : {}),
    ...(cont.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: cont.sourcePreventionLevel }
      : {}),
    ...(cont.sourceTargetLockBypass !== undefined
      ? { sourceTargetLockBypass: cont.sourceTargetLockBypass }
      : {}),
    ...(cont.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: cont.sourcePreventionBypass }
      : {}),
    ...(cont.triggerFromZone !== undefined
      ? { triggerFromZone: cont.triggerFromZone }
      : {}),
    ...(cont.triggerCause !== undefined
      ? { triggerCause: cont.triggerCause }
      : {}),
    ...(cont.triggerRelatedInstanceZone !== undefined
      ? { triggerRelatedInstanceZone: cont.triggerRelatedInstanceZone }
      : {}),
    ...(cont.activationZone !== undefined
      ? { activationZone: cont.activationZone }
      : {}),
    ...(cont.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: cont.costPaidThisEffect }
      : {}),
    ...(cont.postResolutionOracle !== undefined
      ? { postResolutionOracle: cont.postResolutionOracle }
      : {}),
    ...(cont.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...cont.targetInstanceIds] }
      : {}),
    ...(cont.targetStepId !== undefined
      ? { targetStepId: cont.targetStepId }
      : {}),
    ...(cont.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(cont.targetGroups !== undefined
      ? { targetGroups: cont.targetGroups }
      : {}),
    ...(cont.sequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    ...(cont.recordedUsage !== undefined
      ? { recordedUsage: cont.recordedUsage }
      : {}),
    ...(cont.eventAmount !== undefined
      ? { eventAmount: cont.eventAmount }
      : {}),
    ...(cont.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            cont.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(battleEndAttackId !== undefined
      ? {
          battleEndDeferralAttackId: battleEndAttackId,
        }
      : {}),
    ...(cont.rangeAutoResolveStrategy !== undefined
      ? { rangeAutoResolveStrategy: cont.rangeAutoResolveStrategy }
      : {}),
    ...(cont.effectActionKind !== undefined
      ? { effectActionKind: cont.effectActionKind }
      : {}),
  });
}

/** カード処理の受諾・辞退は同じ完了経路を通る。最後のstepも発揮後処理まで再開する。 */
export function resumeEffectAfterCardChoice(
  state: GameState,
  pending: {
    continuation?: import("../model").LifeCoreSelectionContinuation;
    stepResultId?: string;
  } | null,
  options: ApplyLegalActionOptions,
  affectedCardInstanceIds: string[]
): GameState {
  const cont = pending?.continuation;
  if (!cont) return state;
  const resolution = createEffectResolutionScope(cont);
  const stepContext = pending.stepResultId
    ? {
        ...cont.stepContext,
        results: {
          ...cont.stepContext.results,
          [pending.stepResultId]: {
            stepId: pending.stepResultId,
            affectedCardInstanceIds,
            succeeded: affectedCardInstanceIds.length > 0,
            executed: affectedCardInstanceIds.length > 0,
          },
        },
      }
    : cont.stepContext;
  state = resumeEffectBodyAfterChoice(
    state,
    cont,
    options,
    stepContext,
    resolution
  );
  state = resolution.finalize({
    state,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedBySourceInstanceId:
      cont.effectSourceInstanceId ?? cont.sourceInstanceId,
    ...(cont.battleEndDeferralAttackId
      ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
      : {}),
  });
  return checkAndQueuePostResolutionOracleIfReady(
    state,
    cont.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
}

/**
 * useCostGate で置換された effect 内 life→X core_move は、無償マジックの効果と
 * その対象/配置 pending が完了してから「移動なし」として元 effect を再開する。
 * `PostResolutionOracleTrigger` は既存の全 pending continuation が保持するため、
 * 個別 pending ごとに専用の再開フィールドを増やさずに完結点を共有できる。
 */
function resumeCoreMoveCancelledByUseCostGateMagic(
  state: GameState,
  resume: NonNullable<
    Extract<
      import("../model").PostResolutionOracleTrigger,
      { triggerKind: "use_magic" }
    >["useCostGateCoreMoveResume"]
  >,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  if (!resume.continuation || !resume.coreMoveResume) return state;
  const resolution = createEffectResolutionScope(resume.continuation);

  let resumed = resumeEffectAfterCoreMoveChoice(
    state,
    resume,
    options,
    state,
    /* originalMoveReplaced= */ true,
    resolution
  );
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === resume.coreMoveResume!.sourceInstanceId
  );
  const sourceDefinition = sourceCard
    ? options.getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  resumed = resolution.finalize({
    state: resumed,
    beforeState: state,
    endLogs: [],
    actingPlayerId: resume.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getEffectiveColors(state, sourceCard, sourceDefinition),
    causedBySourceInstanceId:
      resume.coreMoveResume.effectSourceInstanceId ??
      resume.coreMoveResume.sourceInstanceId,
    enterFieldCausedByPlayerId: resume.actingPlayerId,
    ...(resume.coreMoveResume.battleEndDeferralAttackId !== undefined
      ? {
          battleEndDeferralAttackId:
            resume.coreMoveResume.battleEndDeferralAttackId,
        }
      : {}),
  });
  return resumed;
}

/**
 * 無償使用した magic の解決が安定した時点で、useCostGate が置換した core_move の
 * 外側 effect continuation を再開する。対象選択 handler と post-resolution handler が
 * 同じ完結判定を使えるように、ここを共通の public helper とする。
 */
export function resumeUseCostGateCoreMoveAfterMagicIfReady(
  state: GameState,
  postResolutionOracle:
    | import("../model").PostResolutionOracleTrigger
    | undefined,
  options: {
    getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
    getRegisteredTriggeredEffectActions?: TriggeredEffectActionRegistrationLookup;
    getRegisteredBurstActions?: BurstActionRegistrationLookup;
  }
): GameState {
  if (postResolutionOracle?.triggerKind !== "use_magic") return state;
  const resume = postResolutionOracle.useCostGateCoreMoveResume;
  if (
    !resume ||
    hasOpenEffectResolutionPending(state) ||
    options.getRegisteredTriggeredEffectActions === undefined
  ) {
    return state;
  }
  const currentState = resumeCoreMoveCancelledByUseCostGateMagic(
    state,
    resume,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
    }
  );
  return cleanupCompletedInUseMagicSourceIfReady({
    state: currentState,
    sourceInstanceId: postResolutionOracle.triggerCardInstanceId,
    chainId: `life-damage-use-cost-gate:${resume.pendingId}`,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

/**
 * life_damage_interception の useCostGate を、カードを単にトラッシュへ送るのではなく
 * 通常の無償 magic 使用パイプラインへ接続する。
 *
 * useCostGate の支払いは「使用」であるため、in_use、使用回数、card_used 誘発、対象選択、
 * 効果解決、トラッシュ移動を既存の magic 実装で一貫して処理する。flag は effect の
 * 条件評価より前に source instance 単位で立て、同一カードの条件無視だけを許可する。
 */
function resolveLifeDamageUseCostGateMagic(
  options: ApplyLegalActionOptions,
  pending: NonNullable<GameState["pendingLifeDamageDiscardChoice"]>
): GameState {
  const entry = pending.entries[0];
  if (!entry || entry.costKind !== "use") {
    throw new Error("Expected a useCostGate pending entry");
  }
  const sourceCard = options.state.cardInstances.find(
    (card) => card.instanceId === entry.sourceInstanceId
  );
  if (
    !sourceCard ||
    sourceCard.ownerPlayerId !== pending.decidingPlayerId ||
    sourceCard.zone !== "hand"
  ) {
    throw new Error("useCostGate source card is no longer usable from hand");
  }
  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );
  const useEffect = sourceDefinition?.effects?.[entry.useEffectIndex];
  if (
    !sourceDefinition ||
    useEffect?.timing.kind !== "activated" ||
    useEffect.timing.mode !== "flash"
  ) {
    throw new Error("useCostGate target must be a flash activated effect");
  }
  if (
    useEffect.usageLimit &&
    !canUseEffectByUsageLimit({
      state: options.state,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      getCardDefinitionById: options.getCardDefinitionById,
      sourceEffect: useEffect,
      effectLabel: "magic",
      usageLimit: useEffect.usageLimit,
    })
  ) {
    throw new Error("useCostGate target effect has exhausted its usage limit");
  }

  let beforeDeclaration = markLifeDamageInterceptionUseCostGateUsedThisTurn(
    {
      ...options.state,
      pendingLifeDamageDiscardChoice: null,
      log: [
        ...options.state.log,
        `effect:life_damage_interception:use-cost-gate:pay:${pending.decidingPlayerId}:use=${entry.sourceInstanceId}`,
      ],
    },
    pending.decidingPlayerId,
    entry.sourceInstanceId
  );
  beforeDeclaration = recordEffectUsageIfLimited({
    state: beforeDeclaration,
    sourceInstanceId: sourceCard.instanceId,
    sourceDefinitionId: sourceCard.definitionId,
    effectLabel: "magic",
    usageLimit: useEffect.usageLimit,
  });
  const declared = useMagicCardInFlashContextAsAction({
    state: beforeDeclaration,
    actingPlayerId: pending.decidingPlayerId,
    magicInstanceId: sourceCard.instanceId,
    allowedSourceZones: ["hand"],
    paymentSources: [],
    withoutCost: true,
    chosenTiming: "flash",
    effectIndex: entry.useEffectIndex,
    ...(pending.coreMoveResume !== undefined &&
    pending.continuation !== undefined
      ? {
          postResolutionOracle: {
            triggerCardInstanceId: sourceCard.instanceId,
            triggerKind: "use_magic" as const,
            magicTiming: "flash" as const,
            chainId: requireTriggerChainId(pending.continuation?.chainId),
            useCostGateCoreMoveResume: {
              pendingId: pending.pendingId,
              actingPlayerId: pending.actingPlayerId,
              ...(pending.continuation !== undefined
                ? { continuation: pending.continuation }
                : {}),
              ...(pending.stepResultId !== undefined
                ? { stepResultId: pending.stepResultId }
                : {}),
              coreMoveResume: pending.coreMoveResume,
            },
          },
        }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  // applyLegalAction の直接利用（テスト/API の軽量呼び出し）では magic lookup が
  // 省略されることがある。対象選択を落とさないため、この source definition 単体の
  // registration を安全な fallback として組み立てる。通常の caller が渡した lookup は
  // そのまま優先する。
  const resolverOptions = options.getRegisteredMagicActions
    ? options
    : {
        ...options,
        getRegisteredMagicActions: buildMagicLookup([sourceDefinition]),
      };
  return resolveStackCascade(
    declared.state,
    [declared.activeStack],
    resolverOptions
  );
}

export function applyPendingLifeDamageDiscardChoiceAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingLifeDamageDiscardChoiceResult {
  const pending = options.state.pendingLifeDamageDiscardChoice;
  if (!pending) {
    throw new Error("No pending life damage discard choice to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ?? {
      chainId: `life-damage-discard-choice:${pending.pendingId}`,
    },
    pending.battleEndDeferralAttackId
  );
  const choice = options.lifeDamageDiscardChoice ?? "decline";
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.coreMoveResume?.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;

  if (choice === "pay" && pending.entries[0]?.costKind === "use") {
    let state = resolveLifeDamageUseCostGateMagic(options, pending);
    if (
      pending.coreMoveResume !== undefined &&
      !hasOpenEffectResolutionPending(state)
    ) {
      state = resumeCoreMoveCancelledByUseCostGateMagic(
        state,
        {
          pendingId: pending.pendingId,
          actingPlayerId: pending.actingPlayerId,
          ...(pending.continuation !== undefined
            ? { continuation: pending.continuation }
            : {}),
          ...(pending.stepResultId !== undefined
            ? { stepResultId: pending.stepResultId }
            : {}),
          coreMoveResume: pending.coreMoveResume,
        },
        options
      );
      state = cleanupCompletedInUseMagicSourceIfReady({
        state,
        sourceInstanceId: pending.entries[0]!.sourceInstanceId,
        chainId: `life-damage-use-cost-gate:${pending.pendingId}`,
        getCardDefinitionById: options.getCardDefinitionById,
      });
    }
    state = applyOrDeferTargetedDisclosureResolutionCleanups(
      state,
      pending.targetedDisclosureResolutionCleanups
    );
    if (
      battleEndAttackId !== undefined &&
      !state.pendingLifeDamageDiscardChoice
    ) {
      state = maybeFinalizeBattleEndScopeAfterPendingDrain(state, options);
    }
    return { state };
  }

  if (!pending.coreMoveResume) {
    let state = resolvePendingLifeDamageDiscardChoice(options.state, choice);
    state = applyOrDeferTargetedDisclosureResolutionCleanups(
      state,
      pending.targetedDisclosureResolutionCleanups
    );
    if (
      battleEndAttackId !== undefined &&
      !state.pendingLifeDamageDiscardChoice
    ) {
      state = maybeFinalizeBattleEndScopeAfterPendingDrain(state, options);
    }
    return { state };
  }

  // core_move (executeCoreMove の life→X 経路) 発生の pending は専用 resume が必要
  // (resolvePendingLifeDamageDiscardChoice は resolveLifeDamage 直接ダメージ専用)。
  let state = resolvePendingLifeDamageDiscardChoiceForCoreMove(
    options.state,
    choice,
    options.getCardDefinitionById
  );

  // decline は常に core_move を pendingAmount で再開する。pay は costKind:"discard"
  // なら core_move を完全キャンセルする（実コア移動なし=flush不要）が、
  // costKind:"declare_gimmick" なら reduceBy 分軽減した amount で core_move を再開し、
  // 実際にコアが移動しうる（BSLH01-C12 adversarial verifier round 1 で確定した gap）。
  // いずれも resume 実行時は decline と同型に finalizeEffectResolution が必要。
  const entryCostKind = pending.entries[0]?.costKind;
  // 複数 gate entry が同一 core_move に一致した場合、resolvePendingLifeDamageDiscardChoiceForCoreMove
  // は残り entries があれば core_move を再開せず pendingLifeDamageDiscardChoice を残す
  // (declareGimmickGate pay / decline 双方)。この場合 finalizeEffectResolution はまだ早い。
  const shouldResumeContinuation =
    !state.pendingLifeDamageDiscardChoice && pending.continuation !== undefined;
  if (shouldResumeContinuation) {
    state = resumeEffectAfterCoreMoveChoice(
      state,
      pending,
      options,
      options.state,
      false,
      resolution
    );
  }

  if (
    (choice === "decline" ||
      entryCostKind === "declare_gimmick" ||
      shouldResumeContinuation) &&
    !state.pendingLifeDamageDiscardChoice
  ) {
    // pendingLifeCoreSelection の resume と同型: core_move 再開後は
    // finalizeEffectResolution でトリガー収集/SBA/leave flush を行う。
    const resume = pending.coreMoveResume;
    const originalSourceCard = options.state.cardInstances.find(
      (c) => c.instanceId === resume.sourceInstanceId
    );
    const sourceDef = originalSourceCard
      ? options.getCardDefinitionById(originalSourceCard.definitionId)
      : undefined;
    state = resolution.finalize({
      state,
      beforeState: options.state,
      endLogs: [],
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      sourceColors: getEffectiveColors(state, originalSourceCard, sourceDef),
      causedBySourceInstanceId:
        resume.effectSourceInstanceId ?? resume.sourceInstanceId,
      enterFieldCausedByPlayerId: pending.actingPlayerId,
      ...(battleEndAttackId !== undefined
        ? { battleEndDeferralAttackId: battleEndAttackId }
        : {}),
    });
    if (!hasOutstandingEffectResolutionContinuation(state)) {
      state = resumeStackCascadeIfReady(state, options);
    }
  }

  state = applyOrDeferTargetedDisclosureResolutionCleanups(
    state,
    pending.targetedDisclosureResolutionCleanups
  );
  if (
    battleEndAttackId !== undefined &&
    !state.pendingLifeDamageDiscardChoice
  ) {
    state = maybeFinalizeBattleEndScopeAfterPendingDrain(state, options);
  }

  return { state };
}

/**
 * LifeGainReplacementChoice pending を解決する (`life_gain_replacement` CE、
 * BSTH02.7-X03 effects[3])。replace ならこの core_move (元のライフ増加) をキャンセルし
 * 相手のライフのコア1個をトラッシュに置く、decline なら通常通り増やす。
 */
export function applyPendingLifeGainReplacementChoiceAction(
  options: ApplyLegalActionOptions
): ResolvePendingLifeGainReplacementChoiceResult {
  const pending = options.state.pendingLifeGainReplacementChoice;
  if (!pending) {
    throw new Error("No pending life gain replacement choice to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ?? {
      chainId: `life-gain-replacement-choice:${pending.pendingId}`,
    },
    pending.battleEndDeferralAttackId
  );
  const choice = options.lifeGainReplacementChoice ?? "decline";
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.coreMoveResume?.battleEndDeferralAttackId ??
    pending.lifeFillResume?.battleEndDeferralAttackId;

  // resume の起源 (core_move / life_fill) に応じて対応する resolver に委譲する。
  let state = pending.lifeFillResume
    ? resolvePendingLifeGainReplacementChoiceForLifeFill(
        options.state,
        choice,
        options.getCardDefinitionById
      )
    : resolvePendingLifeGainReplacementChoiceForCoreMove(
        options.state,
        choice,
        options.getCardDefinitionById
      );

  state = resumeEffectAfterCoreMoveChoice(
    state,
    pending,
    options,
    options.state,
    choice === "replace"
  );

  const originalSourceInstanceId =
    pending.coreMoveResume?.sourceInstanceId ??
    pending.lifeFillResume?.sourceInstanceId ??
    pending.sourceInstanceId;
  const originalSourceCard = options.state.cardInstances.find(
    (c) => c.instanceId === originalSourceInstanceId
  );
  const sourceDef = originalSourceCard
    ? options.getCardDefinitionById(originalSourceCard.definitionId)
    : undefined;
  state = resolution.finalize({
    state,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.decidingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getEffectiveColors(state, originalSourceCard, sourceDef),
    causedBySourceInstanceId:
      pending.coreMoveResume?.effectSourceInstanceId ??
      originalSourceInstanceId,
    enterFieldCausedByPlayerId: pending.decidingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  if (!hasOutstandingEffectResolutionContinuation(state)) {
    state = resumeStackCascadeIfReady(state, options);
  }
  if (battleEndAttackId !== undefined) {
    state = maybeFinalizeBattleEndScopeAfterPendingDrain(state, options);
  }

  state = applyOrDeferTargetedDisclosureResolutionCleanups(
    state,
    pending.targetedDisclosureResolutionCleanups
  );

  return { state };
}

/**
 * コアシュート pending を解決する。
 * プレイヤーが選択したコア分配に基づいてフィールドカードからコアを移動し、残りアクションを再実行する。
 */
export function applyPendingCoreSplitAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingCoreSplitResult {
  const pending = options.state.pendingCoreSplitSelection;
  if (!pending) {
    throw new Error("No pending core split selection to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ??
      pending.postResolutionOracle ?? {
        chainId: `core-split:${pending.pendingId}`,
      },
    pending.battleEndDeferralAttackId
  );
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;

  const distribution = options.coreSplitDistribution ?? [];
  if (distribution.length !== pending.destinations.length) {
    throw new Error(
      `Core split distribution length ${distribution.length} does not match destinations ${pending.destinations.length}`
    );
  }

  // 合計検証
  const total = distribution.reduce((s, n) => s + n, 0);
  if (total !== pending.totalAmount) {
    throw new Error(
      `Core split distribution total ${total} does not match required ${pending.totalAmount}`
    );
  }

  // 各 cap 検証 + 非負検証
  for (let i = 0; i < distribution.length; i++) {
    const amount = distribution[i]!;
    if (amount < 0) {
      throw new Error(
        `Core split distribution[${i}] = ${amount} must be non-negative`
      );
    }
    const cap = pending.destinations[i]!.cap;
    if (cap !== undefined && amount > cap) {
      throw new Error(
        `Core split distribution[${i}] = ${amount} exceeds cap ${cap}`
      );
    }
    // field/field_card destination へ正の配分をするなら、現在の盤面で候補が
    // 1件以上あることを検証する。候補0件のまま執行すると、outside_game 源
    // (ゲーム外からの新規ソウルコア生成) では生成そのものが起きず「置く」義務が
    // 消失し得る (adversarial verifier round1 指摘)。void/trash/reserve 源では
    // 候補0件でも既存コアが源に留まるだけで消失しないが、こちらは分配確定前の
    // 段階で不正な配分自体を拒否し、呼び出し元 (GUI/AI) に別の配分を選ばせる。
    const location = pending.destinations[i]!.location;
    if (
      amount > 0 &&
      (location.kind === "field" || location.kind === "field_card")
    ) {
      const destPlayerId = resolvePlayerRef(
        pending.actingPlayerId,
        location.player,
        options.state
      );
      const candidates = collectFieldCardDestinationCandidates({
        state: options.state,
        to: location,
        toPlayerId: destPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        coreMoveDestinationTargetIds: undefined,
      });
      if (candidates.length === 0) {
        throw new Error(
          `Core split distribution[${i}] = ${amount} targets a field/field_card destination with no eligible candidates`
        );
      }
    }
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `effect:core_move_split:resolve:${distribution.join(",")}`,
    ],
    pendingCoreSplitSelection: null,
  };

  const destinationOrder = distribution
    .map((amount, index) => ({ amount, index }))
    .sort((a, b) => {
      const aLocation = pending.destinations[a.index]!.location;
      const bLocation = pending.destinations[b.index]!.location;
      const aMayOpenFieldPending = isCoreSplitFieldDestination(aLocation);
      const bMayOpenFieldPending = isCoreSplitFieldDestination(bLocation);
      return Number(aMayOpenFieldPending) - Number(bMayOpenFieldPending);
    });

  // 各 destination に対して core_move を順次実行する。field destination は
  // pendingCoreDistribution を開いて中断し得るため、reserve 等の即時 destination
  // を先に確定してから field pending へ入る。
  for (const { amount, index } of destinationOrder) {
    if (amount <= 0) continue;
    const dest = pending.destinations[index]!;
    currentState = executeCoreMove(
      currentState,
      pending.actingPlayerId,
      pending.fromLocation,
      dest.location,
      amount,
      pending.sourceInstanceId,
      undefined,
      undefined,
      options.getCardDefinitionById,
      pending.effectTiming,
      undefined,
      undefined,
      undefined,
      pending.sourcePreventionLevel ?? "none",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      pending.sourceTargetLockBypass,
      undefined,
      undefined,
      undefined,
      pending.sourcePreventionBypass,
      pending.effectSourceInstanceId,
      pending.effectSourceDefinitionId,
      undefined,
      battleEndAttackId
    );
    currentState = attachPostResolutionOracleToPendingCoreDistribution(
      currentState,
      pending.postResolutionOracle
    );
    if (currentState.pendingCoreDistribution !== null) {
      const shouldAttachContinuation =
        pending.continuation &&
        currentState.pendingCoreDistribution.continuation === undefined;
      const shouldAttachBattleEnd =
        battleEndAttackId !== undefined &&
        currentState.pendingCoreDistribution.battleEndDeferralAttackId ===
          undefined;
      if (shouldAttachContinuation || shouldAttachBattleEnd) {
        currentState = {
          ...currentState,
          pendingCoreDistribution: {
            ...currentState.pendingCoreDistribution,
            ...(shouldAttachContinuation
              ? { continuation: pending.continuation }
              : {}),
            ...(shouldAttachBattleEnd
              ? { battleEndDeferralAttackId: battleEndAttackId }
              : {}),
          },
          log: pending.continuation
            ? [
                ...currentState.log,
                `effect:core-split-pending:${pending.pendingId}:nested-core-distribution-resume-at=${pending.continuation.resumeStepIndex}`,
              ]
            : currentState.log,
        };
      }
      return { state: currentState };
    }
  }

  if (pending.continuation) {
    const cont = pending.continuation;
    const def = options.getCardDefinitionById(cont.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, cont);
    if (!effect) {
      throw new Error(
        `applyPendingCoreSplitAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
      );
    }
    currentState = resolution.execute({
      state: currentState,
      effect,
      effectIndex: cont.effectIndex,
      ...(cont.divineSkillIndex !== undefined
        ? { divineSkillIndex: cont.divineSkillIndex }
        : {}),
      ...(cont.isAccelData !== undefined
        ? { isAccelData: cont.isAccelData }
        : {}),
      ...(cont.isChangeData !== undefined
        ? { isChangeData: cont.isChangeData }
        : {}),
      sourceInstanceId: cont.sourceInstanceId,
      actingPlayerId: cont.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext: cont.stepContext,
      ...(cont.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: cont.effectSourceInstanceId }
        : {}),
      ...(cont.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
        : {}),
      ...(cont.sourceCardReferenceInstanceId !== undefined
        ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
        : {}),
      ...(cont.effectActionKind !== undefined
        ? { effectActionKind: cont.effectActionKind }
        : {}),
      ...(cont.choiceIndex !== undefined
        ? { choiceIndex: cont.choiceIndex }
        : {}),
      ...(cont.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: cont.sourcePreventionLevel }
        : {}),
      ...(cont.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: cont.sourcePreventionBypass }
        : {}),
      ...(cont.costPaidThisEffect !== undefined
        ? { costPaidThisEffect: cont.costPaidThisEffect }
        : {}),
      ...(cont.postResolutionOracle !== undefined
        ? { postResolutionOracle: cont.postResolutionOracle }
        : {}),
      ...(battleEndAttackId !== undefined
        ? {
            battleEndDeferralAttackId: battleEndAttackId,
          }
        : {}),
    });
  }

  // resume 後に兄弟ハンドラ (applyResolveCoreSourceAllocationAction 等) と同じ
  // finalization を通す。Phase 1 (P3-108) で premature finalize の早期 flush を gate した
  // ため、継続を resolve したこの時点で finalizeEffectResolution を呼ばないと、コスト支払い
  // 消滅などの待機が次アクションまで flush されず遅延する。
  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

/**
 * `PendingSplitSummonChoice` を解決する (ENGINE-sequential-slot-choice、BSSL01-X01[5,6])。
 * トークン体数 (splitSummonTokenCount) + ゾーン具体カード集合
 * (splitSummonZoneCardInstanceIds) の複合選択を検証し、`executeSplitSummonChoiceTokenBranch`
 * → `executeSplitSummonChoiceZoneBranch` を順次実行してから元 effect の後続ステップへ継続する
 * (`applyPendingCoreSplitAction` と同型パターン)。
 */
export function applyPendingSplitSummonChoiceAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingSplitSummonChoiceResult {
  const pending = options.state.pendingSplitSummonChoice;
  if (!pending) {
    throw new Error("No pending split summon choice to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ?? pending,
    pending.battleEndDeferralAttackId
  );
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;

  const tokenCount = options.splitSummonTokenCount ?? 0;
  const zoneCardInstanceIds = options.splitSummonZoneCardInstanceIds ?? [];

  if (!Number.isInteger(tokenCount) || tokenCount < 0) {
    throw new Error(
      `splitSummonTokenCount must be a non-negative integer (got ${tokenCount})`
    );
  }
  if (tokenCount > pending.maxTokenCount) {
    throw new Error(
      `splitSummonTokenCount ${tokenCount} exceeds maxTokenCount ${pending.maxTokenCount}`
    );
  }
  const uniqueZoneIds = new Set(zoneCardInstanceIds);
  if (uniqueZoneIds.size !== zoneCardInstanceIds.length) {
    throw new Error(
      "splitSummonZoneCardInstanceIds must not contain duplicates"
    );
  }
  for (const id of zoneCardInstanceIds) {
    if (!pending.zoneCandidateInstanceIds.includes(id)) {
      throw new Error(
        `splitSummonZoneCardInstanceIds contains non-candidate id ${id}`
      );
    }
  }
  const total = tokenCount + zoneCardInstanceIds.length;
  if (total > pending.totalCount) {
    throw new Error(
      `split summon choice total ${total} exceeds totalCount ${pending.totalCount}`
    );
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `effect:split_summon_choice:resolve:token=${tokenCount}:zone=${zoneCardInstanceIds.length}`,
    ],
    pendingSplitSummonChoice: null,
  };

  const preBranchZoneById = new Map(
    currentState.cardInstances.map((card) => [card.instanceId, card.zone])
  );
  currentState = executeSplitSummonChoiceBranchesWithPlacementPending(
    currentState,
    pending,
    tokenCount,
    zoneCardInstanceIds,
    options.getCardDefinitionById,
    options.summonPaymentSources
  );

  if (currentState.pendingEffectSummonCostPayment)
    return { state: currentState };

  const affectedIds =
    currentState.pendingMultiPlacement?.targets.map(
      (target) => target.instanceId
    ) ??
    currentState.cardInstances
      .filter((card) => {
        const beforeZone = preBranchZoneById.get(card.instanceId);
        return beforeZone === undefined || beforeZone !== card.zone;
      })
      .map((card) => card.instanceId);

  const updateContinuationStepContext = <
    T extends {
      stepContext: import("../step-execution-context").SerializedStepContext;
    },
  >(
    continuation: T
  ): T => {
    const stepResultId = pending.stepResultId;
    if (stepResultId === undefined) return continuation;
    return {
      ...continuation,
      stepContext: {
        ...continuation.stepContext,
        results: {
          ...continuation.stepContext.results,
          [stepResultId]: {
            ...(continuation.stepContext.results[stepResultId] ?? {
              stepId: stepResultId,
              affectedCardInstanceIds: [],
              succeeded: affectedIds.length > 0,
            }),
            affectedCardInstanceIds: affectedIds,
            succeeded: affectedIds.length > 0,
          },
        },
      },
    };
  };

  if (currentState.pendingMultiPlacement !== null) {
    const continuation = currentState.pendingMultiPlacement.continuation;
    const updatedContinuation = continuation
      ? updateContinuationStepContext(continuation)
      : undefined;
    return {
      state: {
        ...currentState,
        pendingMultiPlacement: {
          ...currentState.pendingMultiPlacement,
          ...(updatedContinuation !== undefined
            ? { continuation: updatedContinuation }
            : {}),
          priorStateSnapshot: options.state,
        },
      },
    };
  }

  if (pending.continuation) {
    const cont = updateContinuationStepContext(pending.continuation);
    const def = options.getCardDefinitionById(cont.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, cont);
    if (!effect) {
      throw new Error(
        `applyPendingSplitSummonChoiceAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
      );
    }
    currentState = resolution.execute({
      state: currentState,
      effect,
      effectIndex: cont.effectIndex,
      ...(cont.divineSkillIndex !== undefined
        ? { divineSkillIndex: cont.divineSkillIndex }
        : {}),
      ...(cont.isAccelData !== undefined
        ? { isAccelData: cont.isAccelData }
        : {}),
      ...(cont.isChangeData !== undefined
        ? { isChangeData: cont.isChangeData }
        : {}),
      sourceInstanceId: cont.sourceInstanceId,
      actingPlayerId: cont.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext: cont.stepContext,
      ...(cont.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: cont.effectSourceInstanceId }
        : {}),
      ...(cont.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
        : {}),
      ...(cont.sourceCardReferenceInstanceId !== undefined
        ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
        : {}),
      ...(cont.effectActionKind !== undefined
        ? { effectActionKind: cont.effectActionKind }
        : {}),
      ...(cont.choiceIndex !== undefined
        ? { choiceIndex: cont.choiceIndex }
        : {}),
      ...(cont.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: cont.sourcePreventionLevel }
        : {}),
      ...(cont.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: cont.sourcePreventionBypass }
        : {}),
      ...(cont.costPaidThisEffect !== undefined
        ? { costPaidThisEffect: cont.costPaidThisEffect }
        : {}),
      ...(cont.postResolutionOracle !== undefined
        ? { postResolutionOracle: cont.postResolutionOracle }
        : {}),
      ...(battleEndAttackId !== undefined
        ? {
            battleEndDeferralAttackId: battleEndAttackId,
          }
        : {}),
    });
  }

  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

export function isCoreSplitFieldDestination(
  location: import("../model").EffectCoreLocation
): boolean {
  return (
    location.kind === "field" ||
    location.kind === "field_card" ||
    location.kind === "card_instance" ||
    location.kind === "target_card" ||
    location.kind === "this_card"
  );
}

export function applyPendingCoreCountAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingCoreCountResult {
  const pending = options.state.pendingCoreCountSelection;
  if (!pending) {
    throw new Error("No pending core count selection to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ??
      pending.postResolutionOracle ?? {
        chainId: `core-count:${pending.pendingId}`,
      },
    pending.battleEndDeferralAttackId
  );
  const battleEndAttackId = pending.battleEndDeferralAttackId;

  const chosen = options.coreCountSelection;
  if (chosen === undefined) {
    throw new Error("coreCountSelection is required to resolve core count");
  }
  if (
    !Number.isInteger(chosen) ||
    chosen < pending.min ||
    chosen > pending.max
  ) {
    throw new Error(
      `Core count ${chosen} is out of range [${pending.min}, ${pending.max}]`
    );
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `effect:core_count:resolve:${chosen}/${pending.max}`,
    ],
    pendingCoreCountSelection: null,
  };

  if (chosen > 0) {
    // pending 生成側で「コア除去効果+N」bonus を min/max に反映済の場合は
    // executeCoreMove 内での再加算を抑止する (amountBonusOverride=0)。
    const skipBonus = pending.coreMoveAmountBonusApplied !== undefined;
    currentState = executeCoreMove(
      currentState,
      pending.actingPlayerId,
      pending.fromLocation,
      pending.toLocation,
      chosen,
      pending.sourceInstanceId,
      undefined,
      undefined,
      options.getCardDefinitionById,
      pending.effectTiming,
      undefined,
      undefined,
      undefined,
      pending.sourcePreventionLevel ?? "none",
      undefined,
      undefined,
      undefined,
      undefined,
      skipBonus ? 0 : undefined,
      // ライフ→任意先 + 通常/ソウル混在 のとき、コア数選択 resolve 後にさらに持ち主選択
      // pending を立てる (二段 pending)。BS35 Q22728: 持ち主選択は count 解決後の partition でも適用。
      /*allowPendingLifeCoreSelection=*/ true,
      undefined,
      undefined,
      pending.sourceEffectIndex,
      pending.sourceTargetLockBypass,
      pending.sourceTargetStepId,
      undefined,
      pending.effectKind,
      pending.sourcePreventionBypass,
      pending.effectSourceInstanceId,
      pending.effectSourceDefinitionId,
      undefined,
      battleEndAttackId,
      pending.coreMoveDestinationTargetIds
    );
    if (battleEndAttackId !== undefined) {
      if (
        currentState.pendingLifeCoreSelection !== null &&
        currentState.pendingLifeCoreSelection.battleEndDeferralAttackId ===
          undefined
      ) {
        currentState = {
          ...currentState,
          pendingLifeCoreSelection: {
            ...currentState.pendingLifeCoreSelection,
            battleEndDeferralAttackId: battleEndAttackId,
          },
        };
      }
      if (
        currentState.pendingCoreDistribution !== null &&
        currentState.pendingCoreDistribution.battleEndDeferralAttackId ===
          undefined
      ) {
        currentState = {
          ...currentState,
          pendingCoreDistribution: {
            ...currentState.pendingCoreDistribution,
            battleEndDeferralAttackId: battleEndAttackId,
          },
        };
      }
    }
    currentState = attachPostResolutionOracleToPendingCoreDistribution(
      currentState,
      pending.postResolutionOracle
    );
  }

  const continuation = pending.continuation;
  if (
    continuation &&
    currentState.pendingLifeCoreSelection === null &&
    currentState.pendingCoreDistribution === null
  ) {
    const def = options.getCardDefinitionById(continuation.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, continuation);
    if (effect) {
      const beforeCoreMoveState = pending.priorStateSnapshot ?? options.state;
      const coreMoveSucceeded =
        didNonCardActionChangeState(
          "core_move",
          beforeCoreMoveState,
          currentState
        ) === true;
      const restoredStepContext = {
        ...continuation.stepContext,
        results: {
          ...continuation.stepContext.results,
          [continuation.recordStepId]: {
            stepId: continuation.recordStepId,
            affectedCardInstanceIds: getCoreMoveChangedCardIds(
              beforeCoreMoveState,
              currentState
            ),
            succeeded: coreMoveSucceeded,
            executed: coreMoveSucceeded,
            ...(() => {
              const numericAmount = getCoreMoveChangedCoreAmount(
                beforeCoreMoveState,
                currentState
              );
              return numericAmount > 0 ? { numericAmount } : {};
            })(),
          },
        },
      };
      const coreCountResumeState =
        continuation.targetedDisclosureContinuation !== undefined
          ? {
              ...currentState,
              pendingTargetedDisclosureContinuation:
                continuation.targetedDisclosureContinuation,
            }
          : currentState;
      currentState = resolution.execute({
        state: coreCountResumeState,
        effect,
        effectIndex: continuation.effectIndex,
        ...(continuation.divineSkillIndex !== undefined
          ? { divineSkillIndex: continuation.divineSkillIndex }
          : {}),
        ...(continuation.isAccelData !== undefined
          ? { isAccelData: continuation.isAccelData }
          : {}),
        ...(continuation.isChangeData !== undefined
          ? { isChangeData: continuation.isChangeData }
          : {}),
        sourceInstanceId: continuation.sourceInstanceId,
        actingPlayerId: continuation.actingPlayerId,
        ...(continuation.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
          : {}),
        ...(continuation.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: continuation.effectSourceDefinitionId }
          : {}),
        ...(continuation.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId:
                continuation.sourceCardReferenceInstanceId,
            }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        startFromStepIndex: continuation.resumeStepIndex,
        restoredStepContext,
        ...(pending.priorStateSnapshot !== undefined
          ? { resumePreviousStepPreState: pending.priorStateSnapshot }
          : {}),
        ...(continuation.choiceIndex !== undefined
          ? { choiceIndex: continuation.choiceIndex }
          : {}),
        ...(continuation.effectActionKind !== undefined
          ? { effectActionKind: continuation.effectActionKind }
          : {}),
        ...(continuation.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
          : {}),
        ...(continuation.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
          : {}),
        ...(continuation.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: continuation.costPaidThisEffect }
          : {}),
        ...(continuation.postResolutionOracle !== undefined
          ? { postResolutionOracle: continuation.postResolutionOracle }
          : {}),
        ...(battleEndAttackId !== undefined
          ? { battleEndDeferralAttackId: battleEndAttackId }
          : {}),
      });
    }
  }

  // resume 後に兄弟ハンドラと同じ finalization を通す (P3-108)。Phase 1 で premature finalize の
  // 早期 flush を gate したため、ここで finalize しないと待機が次アクションまで flush 遅延する。
  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = applyTargetedDisclosureResolutionCleanupsWhenReady(
    currentState,
    pending.targetedDisclosureResolutionCleanups
  );
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

/**
 * ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2:
 * 「カウントを好きなだけ減らす」(count_decrease の amount {min,max}) の数選択を解決する。
 *
 * `PendingCoreCountSelection` (単一 core_move ステップ完結) と異なり、こちらは通常
 * 後続ステップ（「そうしたとき」の連動効果等）を伴うため、`ZoneSelectionContinuation` と
 * 同型の resume（選択結果が解決時まで確定しないため `recordStepId` の `StepResult` に
 * `numericAmount` を注入してから `startFromStepIndex` で再開）を行う。
 * 後続ステップが無い（continuation 未設定）場合は countDecrease を直接適用して完了する。
 */
export function applyPendingCountSelectionAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingCountSelectionResult {
  const pending = options.state.pendingCountSelection;
  if (!pending) {
    throw new Error("No pending count selection to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ??
      pending.postResolutionOracle ?? {
        chainId: `count-selection:${pending.pendingId}`,
      },
    pending.battleEndDeferralAttackId
  );
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;

  const chosen = options.countDecreaseSelection;
  if (chosen === undefined) {
    throw new Error(
      "countDecreaseSelection is required to resolve count selection"
    );
  }
  if (
    !Number.isInteger(chosen) ||
    chosen < pending.min ||
    chosen > pending.max
  ) {
    throw new Error(
      `Count decrease ${chosen} is out of range [${pending.min}, ${pending.max}]`
    );
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `effect:count_selection:resolve:${chosen}/${pending.max}`,
    ],
    pendingCountSelection: null,
  };

  let selectedActionAffectedIds: string[] | undefined;
  let selectedActionAmount = chosen;
  const continuation = pending.continuation;
  if (pending.selectionAction) {
    const beforeAction = currentState;
    currentState = resolution.execute({
      state: currentState,
      effect: {
        timing: pending.effectTiming,
        steps: [{ action: { ...pending.selectionAction, count: chosen } }],
      },
      sourceInstanceId: pending.sourceInstanceId,
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      ...(continuation
        ? {
            effectIndex: continuation.effectIndex,
            restoredStepContext: continuation.stepContext,
            ...(continuation.effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
              : {}),
            ...(continuation.effectSourceDefinitionId !== undefined
              ? {
                  effectSourceDefinitionId:
                    continuation.effectSourceDefinitionId,
                }
              : {}),
            ...(continuation.sourceCardReferenceInstanceId !== undefined
              ? {
                  sourceCardReferenceInstanceId:
                    continuation.sourceCardReferenceInstanceId,
                }
              : {}),
            ...(continuation.sourcePreventionLevel !== undefined
              ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
              : {}),
            ...(continuation.sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
              : {}),
            ...(continuation.effectActionKind !== undefined
              ? { effectActionKind: continuation.effectActionKind }
              : {}),
          }
        : {}),
    });
    selectedActionAffectedIds = currentState.cardInstances
      .filter(
        (c) =>
          beforeAction.cardInstances.find(
            (previous) => previous.instanceId === c.instanceId
          )?.zone !== c.zone
      )
      .map((c) => c.instanceId);
    selectedActionAmount =
      pending.selectionAction.kind === "draw"
        ? Math.max(
            0,
            (currentState.players.find((p) => p.id === pending.targetPlayerId)
              ?.handCount ?? 0) -
              (beforeAction.players.find((p) => p.id === pending.targetPlayerId)
                ?.handCount ?? 0)
          )
        : selectedActionAffectedIds.length;
  } else if (chosen > 0) {
    currentState = executeCountDecrease(
      currentState,
      pending.actingPlayerId,
      pending.playerRef,
      chosen,
      pending.sourceTribes
    );
  }

  if (continuation) {
    const def = options.getCardDefinitionById(continuation.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, continuation);
    if (effect) {
      const restoredStepContext = {
        ...continuation.stepContext,
        results: {
          ...continuation.stepContext.results,
          [continuation.recordStepId]: {
            stepId: continuation.recordStepId,
            affectedCardInstanceIds: selectedActionAffectedIds ?? [
              pending.targetPlayerId,
            ],
            succeeded: selectedActionAmount > 0,
            numericAmount: selectedActionAmount,
          },
        },
      };
      // count_decrease の一時停止/再開を跨いだ pendingTargetedDisclosureContinuation 消失対策
      // (deck_reveal/zone_selection と同型、needs-dsl.audit BSLH01-R06/BSLH01-C01 修正の一環)。
      const countSelectionResumeState =
        continuation.targetedDisclosureContinuation !== undefined
          ? {
              ...currentState,
              pendingTargetedDisclosureContinuation:
                continuation.targetedDisclosureContinuation,
            }
          : currentState;
      currentState = resolution.execute({
        state: countSelectionResumeState,
        effect,
        effectIndex: continuation.effectIndex,
        ...(continuation.divineSkillIndex !== undefined
          ? { divineSkillIndex: continuation.divineSkillIndex }
          : {}),
        ...(continuation.isAccelData !== undefined
          ? { isAccelData: continuation.isAccelData }
          : {}),
        ...(continuation.isChangeData !== undefined
          ? { isChangeData: continuation.isChangeData }
          : {}),
        sourceInstanceId: continuation.sourceInstanceId,
        actingPlayerId: continuation.actingPlayerId,
        ...(continuation.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
          : {}),
        ...(continuation.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: continuation.effectSourceDefinitionId }
          : {}),
        ...(continuation.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId:
                continuation.sourceCardReferenceInstanceId,
            }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        startFromStepIndex: continuation.resumeStepIndex,
        restoredStepContext,
        // 継続 resume 直後の最初の step (= resumeStepIndex) にある connector
        // (conditional_result 等)も判定対象にする。zone-selection resume と同じ
        // resumePreviousStepPreState 経由 (ENGINE-cost-modify-additional-cost-value
        // -dynamic-amount Step3、PendingCountSelection.priorStateSnapshot 参照)。
        ...(pending.priorStateSnapshot !== undefined
          ? { resumePreviousStepPreState: pending.priorStateSnapshot }
          : {}),
        ...(continuation.choiceIndex !== undefined
          ? { choiceIndex: continuation.choiceIndex }
          : {}),
        ...(continuation.effectActionKind !== undefined
          ? { effectActionKind: continuation.effectActionKind }
          : {}),
        ...(continuation.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
          : {}),
        ...(continuation.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
          : {}),
        ...(continuation.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: continuation.costPaidThisEffect }
          : {}),
        ...(continuation.postResolutionOracle !== undefined
          ? { postResolutionOracle: continuation.postResolutionOracle }
          : {}),
        ...(battleEndAttackId !== undefined
          ? { battleEndDeferralAttackId: battleEndAttackId }
          : {}),
      });
    }
  }

  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

/**
 * ENGINE-composite-heterogeneous-removal-budget: discard_set_burst の count
 * {min,max}（「バーストN個まで」型）の枚数選択を解決する。
 *
 * `applyPendingCountSelectionAction` (count_decrease 版) と同型の continuation 再開
 * パターン。選択された枚数だけ `executeDiscardSetBurst` を直接呼び (setBurstStates
 * 先頭から決定的ピック、Q4185 非識別のため対象は経由しない)、後続 step がある場合は
 * 破棄した実 instance id を stepContext の StepResult へ記録して継続再開する。
 */
export function applyPendingDiscardSetBurstCountSelectionAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingDiscardSetBurstCountSelectionResult {
  const pending = options.state.pendingDiscardSetBurstCountSelection;
  if (!pending) {
    throw new Error("No pending discard_set_burst count selection to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ??
      pending.postResolutionOracle ?? {
        chainId: `discard-set-burst-count-selection:${pending.pendingId}`,
      },
    pending.battleEndDeferralAttackId
  );
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;

  const chosen = options.discardSetBurstCountSelection;
  if (chosen === undefined) {
    throw new Error(
      "discardSetBurstCountSelection is required to resolve discard_set_burst count selection"
    );
  }
  if (
    !Number.isInteger(chosen) ||
    chosen < pending.min ||
    chosen > pending.max
  ) {
    throw new Error(
      `Discard set burst count ${chosen} is out of range [${pending.min}, ${pending.max}]`
    );
  }

  const chosenIds = options.state.setBurstStates
    .filter((s) => s.playerId === pending.targetPlayerId)
    .map((s) => s.cardInstanceId)
    .slice(0, chosen);

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `effect:discard_set_burst_count_selection:resolve:${chosen}/${pending.max}`,
    ],
    pendingDiscardSetBurstCountSelection: null,
  };

  if (chosen > 0) {
    currentState = executeDiscardSetBurst(
      currentState,
      pending.actingPlayerId,
      pending.sourceInstanceId,
      pending.targetPlayerId,
      chosen,
      options.getCardDefinitionById,
      pending.destination,
      pending.unpreventable,
      chosenIds
    );
  }

  const continuation = pending.continuation;
  if (continuation) {
    const def = options.getCardDefinitionById(continuation.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, continuation);
    if (effect) {
      const restoredStepContext = {
        ...continuation.stepContext,
        results: {
          ...continuation.stepContext.results,
          [continuation.recordStepId]: {
            stepId: continuation.recordStepId,
            affectedCardInstanceIds: chosenIds,
            succeeded: chosen > 0,
            numericAmount: chosen,
          },
        },
      };
      const discardSetBurstResumeState =
        continuation.targetedDisclosureContinuation !== undefined
          ? {
              ...currentState,
              pendingTargetedDisclosureContinuation:
                continuation.targetedDisclosureContinuation,
            }
          : currentState;
      currentState = resolution.execute({
        state: discardSetBurstResumeState,
        effect,
        effectIndex: continuation.effectIndex,
        ...(continuation.divineSkillIndex !== undefined
          ? { divineSkillIndex: continuation.divineSkillIndex }
          : {}),
        ...(continuation.isAccelData !== undefined
          ? { isAccelData: continuation.isAccelData }
          : {}),
        ...(continuation.isChangeData !== undefined
          ? { isChangeData: continuation.isChangeData }
          : {}),
        sourceInstanceId: continuation.sourceInstanceId,
        actingPlayerId: continuation.actingPlayerId,
        ...(continuation.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
          : {}),
        ...(continuation.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: continuation.effectSourceDefinitionId }
          : {}),
        ...(continuation.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId:
                continuation.sourceCardReferenceInstanceId,
            }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        startFromStepIndex: continuation.resumeStepIndex,
        restoredStepContext,
        ...(pending.priorStateSnapshot !== undefined
          ? { resumePreviousStepPreState: pending.priorStateSnapshot }
          : {}),
        ...(continuation.choiceIndex !== undefined
          ? { choiceIndex: continuation.choiceIndex }
          : {}),
        ...(continuation.effectActionKind !== undefined
          ? { effectActionKind: continuation.effectActionKind }
          : {}),
        ...(continuation.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
          : {}),
        ...(continuation.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
          : {}),
        ...(continuation.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: continuation.costPaidThisEffect }
          : {}),
        ...(continuation.postResolutionOracle !== undefined
          ? { postResolutionOracle: continuation.postResolutionOracle }
          : {}),
        ...(battleEndAttackId !== undefined
          ? { battleEndDeferralAttackId: battleEndAttackId }
          : {}),
      });
    }
  }

  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

/**
 * ENGINE-core-move-from-life-owner-soul-choice: ライフ→任意先のコア移動で
 * 通常 / ソウル混在の持ち主選択 pending を解決する。
 *
 * pending 生成時点で interception (turn_cap カウンタ更新等) は state へ反映済、
 * `pending.totalAmount` は interception 後の adjustedAmount。本関数は
 * partition (normalChosen + soulChosen = totalAmount) を検証した後、
 * `executeCoreMove` を `lifeCorePartitionOverride` + `skipLifeDamageInterception=true`
 * で再呼び出しし、選ばれた partition で移動を完了する。
 *
 * 検証 (合計一致 / 各 cap 内 / 非負 / soulChosen ≤ 1) 違反は throw。
 */
export function applyPendingLifeCoreSelectionAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingLifeCoreSelectionResult {
  const pending = options.state.pendingLifeCoreSelection;
  if (!pending) {
    throw new Error("No pending life core selection to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ?? {
      chainId: `life-core-selection:${pending.pendingId}`,
    },
    pending.battleEndDeferralAttackId
  );
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;

  const choice = options.lifeCorePartitionChoice;
  if (!choice) {
    throw new Error(
      "lifeCorePartitionChoice is required to resolve life core selection"
    );
  }
  const { normalChosen, soulChosen } = choice;
  if (!Number.isInteger(normalChosen) || normalChosen < 0) {
    throw new Error(
      `normalChosen ${normalChosen} must be a non-negative integer`
    );
  }
  if (!Number.isInteger(soulChosen) || soulChosen < 0) {
    throw new Error(`soulChosen ${soulChosen} must be a non-negative integer`);
  }
  if (soulChosen > pending.soulAvailable) {
    throw new Error(
      `soulChosen ${soulChosen} exceeds available ${pending.soulAvailable}`
    );
  }
  if (normalChosen > pending.normalAvailable) {
    throw new Error(
      `normalChosen ${normalChosen} exceeds available ${pending.normalAvailable}`
    );
  }
  if (normalChosen + soulChosen !== pending.totalAmount) {
    throw new Error(
      `Life core partition total ${normalChosen + soulChosen} does not match required ${pending.totalAmount}`
    );
  }

  let currentState: GameState = {
    ...options.state,
    log: [
      ...options.state.log,
      `effect:core_move:${pending.fromLocation.kind}:resolve:normal=${normalChosen}/soul=${soulChosen}`,
    ],
    pendingLifeCoreSelection: null,
  };

  currentState = executeCoreMove(
    currentState,
    pending.effectSourcePlayerId,
    pending.fromLocation,
    pending.toLocation,
    pending.totalAmount,
    pending.sourceInstanceId,
    undefined,
    undefined,
    options.getCardDefinitionById,
    pending.effectTiming,
    undefined,
    undefined,
    undefined,
    pending.sourcePreventionLevel ?? "none",
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    /*allowPendingLifeCoreSelection=*/ false,
    /*lifeCorePartitionOverride=*/ { normalChosen, soulChosen },
    /*skipLifeDamageInterception=*/ true,
    pending.sourceEffectIndex,
    pending.sourceTargetLockBypass,
    pending.sourceTargetStepId,
    undefined,
    undefined,
    pending.sourcePreventionBypass,
    pending.effectSourceInstanceId,
    pending.effectSourceDefinitionId,
    undefined,
    battleEndAttackId,
    pending.coreMoveDestinationTargetIds
  );

  if (pending.lifeDamageInterception) {
    currentState = consumePendingLifeDamageTurnCapBuckets(
      currentState,
      pending.lifeDamageInterception,
      Math.max(
        0,
        getPlayerLifeCoreCount(
          options.state.players.find(
            (player) => player.id === pending.actingPlayerId
          )!
        ) -
          getPlayerLifeCoreCount(
            currentState.players.find(
              (player) => player.id === pending.actingPlayerId
            )!
          )
      )
    );
  }
  if (pending.deferredCoreMoveChoice) {
    currentState = resumeEffectAfterCoreMoveChoice(
      currentState,
      {
        ...(pending.continuation ? { continuation: pending.continuation } : {}),
        ...(pending.deferredCoreMoveChoice.stepResultId !== undefined
          ? { stepResultId: pending.deferredCoreMoveChoice.stepResultId }
          : {}),
      },
      options,
      pending.deferredCoreMoveChoice.beforeState,
      pending.deferredCoreMoveChoice.originalMoveReplaced,
      resolution
    );
  }
  if (pending.continuation && !pending.deferredCoreMoveChoice) {
    const cont = pending.continuation;
    const initialStepResults =
      cont.initialStepResults !== undefined
        ? annotateLifeCoreInitialStepResults(
            cont.initialStepResults,
            currentState,
            pending.fromLocation
          )
        : undefined;
    const def = options.getCardDefinitionById(cont.sourceDefinitionId);
    const effect =
      cont.resumeEffectOverride ?? resolveContinuationEffect(def, cont);
    if (!effect) {
      throw new Error(
        `applyPendingLifeCoreSelectionAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
      );
    }
    currentState = resolution.execute({
      state: currentState,
      effect,
      effectIndex: cont.effectIndex,
      ...(cont.divineSkillIndex !== undefined
        ? { divineSkillIndex: cont.divineSkillIndex }
        : {}),
      ...(cont.isAccelData !== undefined
        ? { isAccelData: cont.isAccelData }
        : {}),
      ...(cont.isChangeData !== undefined
        ? { isChangeData: cont.isChangeData }
        : {}),
      sourceInstanceId: cont.sourceInstanceId,
      actingPlayerId: cont.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext: cont.stepContext,
      ...(cont.repeatResume !== undefined
        ? { repeatResume: cont.repeatResume }
        : {}),
      ...(initialStepResults !== undefined ? { initialStepResults } : {}),
      ...(cont.resolvedCoreMoveAmounts
        ? { resolvedCoreMoveAmounts: cont.resolvedCoreMoveAmounts }
        : {}),
      ...(cont.resumePreviousStepPreState !== undefined
        ? { resumePreviousStepPreState: cont.resumePreviousStepPreState }
        : {}),
      ...(cont.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: cont.effectSourceInstanceId }
        : {}),
      ...(cont.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
        : {}),
      ...(cont.sourceCardReferenceInstanceId !== undefined
        ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
        : {}),
      ...(cont.effectActionKind !== undefined
        ? { effectActionKind: cont.effectActionKind }
        : {}),
      ...(cont.choiceIndex !== undefined
        ? { choiceIndex: cont.choiceIndex }
        : {}),
      ...(cont.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: cont.sourcePreventionLevel }
        : {}),
      ...(cont.sourceTargetLockBypass !== undefined
        ? { sourceTargetLockBypass: cont.sourceTargetLockBypass }
        : {}),
      ...(cont.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: cont.sourcePreventionBypass }
        : {}),
      ...(cont.triggerFromZone !== undefined
        ? { triggerFromZone: cont.triggerFromZone }
        : {}),
      ...(cont.triggerCause !== undefined
        ? { triggerCause: cont.triggerCause }
        : {}),
      ...(cont.triggerRelatedInstanceZone !== undefined
        ? { triggerRelatedInstanceZone: cont.triggerRelatedInstanceZone }
        : {}),
      ...(cont.activationZone !== undefined
        ? { activationZone: cont.activationZone }
        : {}),
      ...(cont.costPaidThisEffect !== undefined
        ? { costPaidThisEffect: cont.costPaidThisEffect }
        : {}),
      ...(cont.postResolutionOracle !== undefined
        ? { postResolutionOracle: cont.postResolutionOracle }
        : {}),
      ...(cont.targetInstanceIds !== undefined
        ? { targetInstanceIds: [...cont.targetInstanceIds] }
        : {}),
      ...(cont.targetStepId !== undefined
        ? { targetStepId: cont.targetStepId }
        : {}),
      ...(cont.targetSelectionResolved === true
        ? { targetSelectionResolved: true }
        : {}),
      ...(cont.targetGroups !== undefined
        ? { targetGroups: cont.targetGroups }
        : {}),
      ...(cont.sequentialTargetConsumption === true
        ? { sequentialTargetConsumption: true }
        : {}),
      ...(cont.recordedUsage !== undefined
        ? { recordedUsage: cont.recordedUsage }
        : {}),
      ...(cont.eventAmount !== undefined
        ? { eventAmount: cont.eventAmount }
        : {}),
      ...(cont.pendingEffectSimultaneousGroupId !== undefined
        ? {
            pendingEffectSimultaneousGroupId:
              cont.pendingEffectSimultaneousGroupId,
          }
        : {}),
      ...(battleEndAttackId !== undefined
        ? { battleEndDeferralAttackId: battleEndAttackId }
        : {}),
      ...(cont.rangeAutoResolveStrategy !== undefined
        ? { rangeAutoResolveStrategy: cont.rangeAutoResolveStrategy }
        : {}),
      ...(cont.effectActionKind !== undefined
        ? { effectActionKind: cont.effectActionKind }
        : {}),
      ...(battleEndAttackId !== undefined ? {} : {}),
    });
  }

  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.effectSourcePlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.effectSourceInstanceId ?? pending.sourceInstanceId,
    // 場入り起因判定は効果発動者 (chooser=life owner ではない) 基準。chooser を渡すと
    // 反応召喚の self_effect / opponent_effect 分類が反転する (verifier lens 1)。
    enterFieldCausedByPlayerId: pending.effectSourcePlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = applyOrDeferTargetedDisclosureResolutionCleanups(
    currentState,
    pending.targetedDisclosureResolutionCleanups
  );
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

/** 置換入力と原資選択後の共通出口。実支払いと最後の対象選択後だけ本文を再開する。 */
export function applySetAsideExitReplacementChoiceAction(
  options: ApplyLegalActionOptions,
  action: import("./legal-actions-types").ResolveSetAsideExitReplacementChoiceLegalAction,
  paymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[]
) {
  const pending = options.state.pendingSetAsideExitReplacementChoice;
  if (
    !pending ||
    pending.cardInstanceId !== action.cardInstanceId ||
    pending.choosingPlayerId !== action.actingPlayerId ||
    options.state.pendingCoreSourceAllocation?.purpose ===
      "set_aside_exit_replacement"
  )
    throw new Error("Stale or unauthorized set-aside exit replacement choice");
  const battleEndAttackId = pending.battleEndDeferralAttackId;
  let resultState = resolveSetAsideExitReplacementChoice(
    options.state,
    action.choice === "replace",
    options.getCardDefinitionById,
    paymentSources ?? options.payCostPaymentSources
  );
  if (!resultState.pendingSetAsideExitReplacementChoice) {
    const removedIds = (
      pending.removalTargetInstanceIds ?? [pending.cardInstanceId]
    ).filter((id) => {
      const card = resultState.cardInstances.find((c) => c.instanceId === id);
      return (
        card?.zone === "removed_from_game" ||
        card?.pendingLeaveKind === "remove_from_game"
      );
    });
    resultState = resumeEffectAfterCardChoice(
      resultState,
      pending,
      options,
      removedIds
    );
  }
  const afterImmediateBattleEnds =
    battleEndAttackId === undefined
      ? resultState
      : processPendingImmediateBattleEnds({
          state: resultState,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
        });
  return {
    state: maybeFinalizeBattleEndScopeAfterPendingDrain(
      afterImmediateBattleEnds,
      options
    ),
  };
}

/**
 * 効果コストの原資配分 pending (`pendingCoreSourceAllocation`) を解決する。
 *
 * 「支払い前中断 → 配分選択 → コストステップ再実行」方式:
 * pending 生成時点ではコアは一切移動していない。本関数は配分を検証した後、
 * `continuation` をもとに **コストステップ自体** (resumeStepIndex = コスト step) から
 * `executeEffect` を `coreSourceAllocations` 供給で再実行する。再実行イテレーションで
 * conditional_cost スナップショット (stepCtx.originalState) が取り直されるため、
 * 後段の効果側 (bounce 等) が失敗した場合の「ことで」双方向ロールバックで
 * 配分支払い分のコアが元のカードに戻る。
 *
 * 検証 (候補内 / available 以下 / 合計 == requiredTotal) 違反は throw。
 * resume 後は P3-47 F-6 と同じ finalization (SBA / トリガー収集 / pending leave flush)
 * を通し、スタックカスケード中断分 (`pendingStackCascade`) があれば再開する。
 */
export function applyResolveCoreSourceAllocationAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolveCoreSourceAllocationResult {
  const pending = options.state.pendingCoreSourceAllocation;
  if (!pending) {
    throw new Error("No pending core source allocation to resolve");
  }

  const allocations = options.coreSourceAllocations;
  if (!allocations) {
    throw new Error(
      "coreSourceAllocations is required to resolve core source allocation"
    );
  }

  // Snapshot validates the offered selection. The replacement resolver also
  // checks current legal availability by physical core kind before payment.
  const candidateById = new Map(
    pending.candidates.map((candidate) => [candidate.instanceId, candidate])
  );
  const soulSourceId = options.coreSourceSoulCoreInstanceId;
  let total = 0;
  for (const [id, amount] of Object.entries(allocations)) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new Error(
        `Core source allocation ${amount} for ${id} must be a non-negative integer`
      );
    }
    if (amount === 0) continue;
    const candidate = candidateById.get(id);
    if (candidate === undefined) {
      throw new Error(`Core source allocation target ${id} is not a candidate`);
    }
    const normalAvailable = candidate.normalAvailable ?? candidate.available;
    if (amount > normalAvailable) {
      throw new Error(
        `Core source allocation ${amount} for ${id} exceeds available ${normalAvailable}`
      );
    }
    total += amount;
  }
  if (soulSourceId !== undefined) {
    const candidate = candidateById.get(soulSourceId);
    if (candidate === undefined) {
      throw new Error(
        `Core source allocation soul source ${soulSourceId} is not a candidate`
      );
    }
    if (candidate.hasSoulCore !== true) {
      throw new Error(
        `Core source allocation soul source ${soulSourceId} has no movable soul core`
      );
    }
    total += 1;
  }
  const minimum = pending.minimumTotal ?? pending.requiredTotal;
  if (
    (total < minimum || total > pending.requiredTotal) &&
    !(pending.canDecline && total === 0)
  ) {
    throw new Error(
      `Core source allocation total ${total} does not match required ${pending.requiredTotal}`
    );
  }

  if (pending.purpose === "set_aside_exit_replacement") {
    const replacement = options.state.pendingSetAsideExitReplacementChoice;
    if (
      !replacement ||
      replacement.cardInstanceId !== pending.sourceInstanceId ||
      replacement.choosingPlayerId !== pending.actingPlayerId ||
      options.action.kind !== "resolve_core_source_allocation" ||
      options.action.pendingId !== pending.pendingId ||
      options.action.actingPlayerId !== pending.actingPlayerId
    )
      throw new Error(
        "Stale or unauthorized set-aside replacement cost allocation"
      );
    const ids = new Set([
      ...Object.keys(allocations),
      ...(soulSourceId ? [soulSourceId] : []),
    ]);
    const paymentSources: import("../core/payment-system").CardCostPaymentSource[] =
      [...ids].flatMap((id) => {
        const includeSoulCore = id === soulSourceId;
        const amount = (allocations[id] ?? 0) + Number(includeSoulCore);
        if (amount <= 0) return [];
        return [
          id === "reserve"
            ? { kind: "reserve" as const, amount, includeSoulCore }
            : {
                kind: "card" as const,
                instanceId: id,
                amount,
                includeSoulCore,
              },
        ];
      });
    return applySetAsideExitReplacementChoiceAction(
      {
        ...options,
        state: { ...options.state, pendingCoreSourceAllocation: null },
      },
      {
        kind: "resolve_set_aside_exit_replacement_choice",
        actionId: options.action.actionId,
        can: true,
        reason: "pending_set_aside_exit_replacement_choice",
        actingPlayerId: pending.actingPlayerId,
        cardInstanceId: replacement.cardInstanceId,
        choice: "replace",
      },
      paymentSources
    );
  }

  if (pending.deferredStack) {
    let resumed = resolveDeferredStackAction(
      { ...options.state, pendingCoreSourceAllocation: null },
      { ...pending.deferredStack, divineSkillCoreCost: total },
      options
    );
    if (!hasOutstandingEffectResolutionContinuation(resumed)) {
      resumed = resumeStackCascadeIfReady(resumed, options);
    }
    return {
      state: maybeFinalizeBattleEndScopeAfterPendingDrain(resumed, options),
    };
  }
  const cont = pending.continuation;
  if (!cont) {
    throw new Error(
      `applyResolveCoreSourceAllocationAction: pending ${pending.pendingId} has no continuation (effect-interpreter 経由でない生成は想定外)`
    );
  }
  const resolution = createEffectResolutionScope(cont);
  const battleEndAttackId = cont.battleEndDeferralAttackId;
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  const effect = resolveContinuationEffect(def, cont);
  if (!effect) {
    throw new Error(
      `applyResolveCoreSourceAllocationAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
    );
  }

  let currentState: GameState = {
    ...options.state,
    pendingCoreSourceAllocation: null,
    log: [
      ...options.state.log,
      `effect:core_source_allocation:resolve:${pending.pendingId}:${Object.entries(
        allocations
      )
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(",")}`,
    ],
  };

  // コストステップ自体から再実行 (配分は coreSourceAllocations で供給)
  currentState = resolution.execute({
    state: currentState,
    effect,
    effectIndex: cont.effectIndex,
    ...(cont.divineSkillIndex !== undefined
      ? { divineSkillIndex: cont.divineSkillIndex }
      : {}),
    ...(cont.isAccelData !== undefined
      ? { isAccelData: cont.isAccelData }
      : {}),
    ...(cont.isChangeData !== undefined
      ? { isChangeData: cont.isChangeData }
      : {}),
    sourceInstanceId: cont.sourceInstanceId,
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options.getRegisteredMagicActions !== undefined
      ? { getRegisteredMagicActions: options.getRegisteredMagicActions }
      : {}),
    startFromStepIndex: cont.resumeStepIndex,
    restoredStepContext: cont.stepContext,
    optionalExecuteResumeStepIndex: cont.resumeStepIndex,
    coreSourceAllocations: allocations,
    ...(cont.targetStepId !== undefined
      ? { targetStepId: cont.targetStepId, targetSelectionResolved: true }
      : {}),
    ...(cont.activationZone !== undefined
      ? { activationZone: cont.activationZone }
      : {}),
    ...(soulSourceId !== undefined
      ? { coreSourceSoulCoreInstanceId: soulSourceId }
      : {}),
    ...(cont.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: cont.effectSourceInstanceId }
      : {}),
    ...(cont.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
      : {}),
    ...(cont.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
      : {}),
    ...(cont.choiceIndex !== undefined
      ? { choiceIndex: cont.choiceIndex }
      : {}),
    ...(cont.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: cont.sourcePreventionLevel }
      : {}),
    ...(cont.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: cont.sourcePreventionBypass }
      : {}),
    ...(cont.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: cont.costPaidThisEffect }
      : {}),
    ...(cont.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...cont.targetInstanceIds] }
      : {}),
    ...(cont.recordedUsage !== undefined
      ? { recordedUsage: cont.recordedUsage }
      : {}),
    ...(cont.postResolutionOracle !== undefined
      ? { postResolutionOracle: cont.postResolutionOracle }
      : {}),
    ...(battleEndAttackId !== undefined
      ? {
          battleEndDeferralAttackId: battleEndAttackId,
        }
      : {}),
  });

  // P3-47 F-6: resume 後に通常解決と同じ finalization を通す
  // (SBA / CE 再計算 / トリガー収集 / pending leave flush)。
  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = checkAndQueuePostResolutionOracleIfReady(
    currentState,
    cont.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  currentState = applyTargetedDisclosureResolutionCleanupsWhenReady(
    currentState,
    pending.targetedDisclosureResolutionCleanups
  );

  // スタックカスケード中に本 pending で中断していた残りスタックがあれば再開する。
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

export function applyPendingLinkAidCostSourceChoiceAction(
  options: ApplyLegalActionOptions,
  action: Extract<
    import("./legal-actions-types").LegalAction,
    { kind: "resolve_pending_link_aid_cost_source_choice" }
  >
): import("./legal-actions-types").ResolvePendingLinkAidCostSourceChoiceResult {
  const pending = options.state.pendingLinkAidCostSourceChoice;
  if (!pending) {
    throw new Error("No pending link aid cost source choice to resolve");
  }
  if (
    pending.pendingId !== action.pendingId ||
    pending.actingPlayerId !== action.actingPlayerId ||
    pending.soulStateCardInstanceId !== action.soulStateCardInstanceId
  ) {
    throw new Error(
      `Link aid cost source choice action does not match pending ${pending.pendingId}`
    );
  }

  const chosenCandidate = pending.candidates.find(
    (candidate) =>
      candidate.costSourceInstanceId === action.costSourceInstanceId
  );
  if (chosenCandidate === undefined) {
    throw new Error(
      `Link aid cost source ${action.costSourceInstanceId} is not a candidate`
    );
  }

  let currentState: GameState = {
    ...options.state,
    pendingLinkAidCostSourceChoice: null,
    log: [
      ...options.state.log,
      `link_aid:cost-source-choice:resolved:${pending.pendingId}:${chosenCandidate.costSourceInstanceId}`,
    ],
  };

  currentState = resolveLinkAidWithChosenCostSource(
    currentState,
    pending.deferredStack,
    chosenCandidate,
    options
  );

  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

/**
 * 効果文内 summon のコスト支払い元選択 pending を解決する。
 *
 * 支払い後の維持コア配置は executeSummon が既存の pendingMultiPlacement を
 * 生成し、そちらの解決で finalization まで走らせる。
 */
export function applyResolvePendingEffectSummonCostPaymentAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingEffectSummonCostPaymentResult {
  const pending = options.state.pendingEffectSummonCostPayment;
  if (!pending) {
    throw new Error("No pending effect summon cost payment to resolve");
  }

  const paymentSources = options.summonPaymentSources;
  if (!paymentSources) {
    throw new Error(
      "summonPaymentSources is required to resolve effect summon cost payment"
    );
  }
  const totalProvided = getTotalPaymentAmount(paymentSources);
  if (totalProvided !== pending.requiredCost) {
    throw new Error(
      `Effect summon payment total ${totalProvided} does not match required ${pending.requiredCost}`
    );
  }
  assertPaymentSourcesAreAvailable({
    paymentSources,
    availableReserveCoreAmount: pending.availableReserveCoreAmount,
    availableOnBoardCoreSources: pending.availableOnBoardCoreSources,
  });

  if (pending.summonDeclaration)
    return resumeSummonDeclaration(
      {
        ...options,
        state: { ...options.state, pendingEffectSummonCostPayment: null },
        paymentSources,
      },
      pending.summonDeclaration
    );
  if (pending.splitSummonChoice) {
    const choice = pending.splitSummonChoice;
    return applyPendingSplitSummonChoiceAction({
      ...options,
      state: {
        ...options.state,
        pendingEffectSummonCostPayment: null,
        pendingSplitSummonChoice: choice.pending,
      },
      splitSummonTokenCount: choice.tokenCount,
      splitSummonZoneCardInstanceIds: choice.zoneCardInstanceIds,
      summonPaymentSources: paymentSources,
    });
  }
  const cont = pending.continuation;
  if (!cont) {
    throw new Error(
      `applyResolvePendingEffectSummonCostPaymentAction: pending ${pending.pendingId} has no continuation`
    );
  }
  const resolution = createEffectResolutionScope(cont);
  const battleEndAttackId = cont.battleEndDeferralAttackId;
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  const effect = resolveContinuationEffect(def, cont);
  if (!effect) {
    throw new Error(
      `applyResolvePendingEffectSummonCostPaymentAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
    );
  }

  let currentState: GameState = {
    ...options.state,
    pendingEffectSummonCostPayment: null,
    log: [
      ...options.state.log,
      `effect:summon_cost_payment:resolve:${pending.pendingId}:${paymentSources
        .map((source) =>
          source.kind === "reserve"
            ? `reserve:${source.amount}`
            : `${source.instanceId}:${source.amount}${source.includeSoulCore ? ":soul" : ""}`
        )
        .join(",")}`,
    ],
  };

  currentState = resolution.execute({
    state: currentState,
    effect,
    effectIndex: cont.effectIndex,
    ...(cont.divineSkillIndex !== undefined
      ? { divineSkillIndex: cont.divineSkillIndex }
      : {}),
    ...(cont.isAccelData !== undefined
      ? { isAccelData: cont.isAccelData }
      : {}),
    ...(cont.isChangeData !== undefined
      ? { isChangeData: cont.isChangeData }
      : {}),
    sourceInstanceId: cont.sourceInstanceId,
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    startFromStepIndex: cont.resumeStepIndex,
    restoredStepContext: cont.stepContext,
    ...(cont.repeatResume ? { repeatResume: cont.repeatResume } : {}),
    summonPaymentSources: paymentSources,
    skipStepUsageAtResume: true,
    ...(cont.effectActionKind !== undefined
      ? { effectActionKind: cont.effectActionKind }
      : {}),
    ...(cont.targetStepId !== undefined
      ? { targetStepId: cont.targetStepId }
      : {}),
    ...(cont.targetSelectionResolved !== undefined
      ? { targetSelectionResolved: cont.targetSelectionResolved }
      : {}),
    ...(pending.preCostCombineHostInstanceId !== undefined
      ? {
          summonPreCostCombineHostInstanceId:
            pending.preCostCombineHostInstanceId,
        }
      : {}),
    ...(cont.optionalExecuteResumeStepIndex !== undefined
      ? {
          optionalExecuteResumeStepIndex: cont.optionalExecuteResumeStepIndex,
        }
      : {}),
    ...(cont.activationZone !== undefined
      ? { activationZone: cont.activationZone }
      : {}),
    ...(cont.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: cont.effectSourceInstanceId }
      : {}),
    ...(cont.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
      : {}),
    ...(cont.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
      : {}),
    ...(cont.choiceIndex !== undefined
      ? { choiceIndex: cont.choiceIndex }
      : {}),
    ...(cont.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: cont.sourcePreventionLevel }
      : {}),
    ...(cont.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: cont.sourcePreventionBypass }
      : {}),
    ...(cont.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: cont.costPaidThisEffect }
      : {}),
    ...(cont.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...cont.targetInstanceIds] }
      : {}),
    ...(cont.recordedUsage !== undefined
      ? { recordedUsage: cont.recordedUsage }
      : {}),
    ...(cont.postResolutionOracle !== undefined
      ? { postResolutionOracle: cont.postResolutionOracle }
      : {}),
    ...(battleEndAttackId !== undefined
      ? {
          battleEndDeferralAttackId: battleEndAttackId,
        }
      : {}),
  });

  if (hasOutstandingEffectResolutionContinuation(currentState)) {
    return { state: currentState };
  }

  currentState = resolution.finalize({
    state: currentState,
    beforeState: options.state,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId: pending.actingPlayerId,
    ...(pending.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: pending.sourceEffectIndex }
      : {}),
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = checkAndQueuePostResolutionOracleIfReady(
    currentState,
    cont.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );

  return { state: currentState };
}

function toSoulCoreContainer(
  location: PlayerScopedSoulCoreLocation,
  playerId: string
): SoulCoreContainer {
  switch (location.kind) {
    case "card":
      return { kind: "card", instanceId: location.instanceId };
    case "reserve":
    case "trash":
    case "life":
      return { kind: location.kind, playerId };
    case "removed_from_game":
      return { kind: "removed_from_game" };
  }
}

function ensureSoulCoreSourceCountForLegacyState(
  state: GameState,
  playerId: string,
  source: SoulCoreContainer
): GameState {
  switch (source.kind) {
    case "card":
      return updateCard(state, source.instanceId, (card) =>
        card.soulCoreCount > 0
          ? card
          : { ...card, soulCoreCount: 1, everHadCorePlaced: true }
      );
    case "reserve":
      if (source.playerId !== playerId) return state;
      return updatePlayer(state, playerId, (player) =>
        player.reserveSoulCoreCount > 0
          ? player
          : { ...player, reserveSoulCoreCount: 1 }
      );
    case "trash":
      if (source.playerId !== playerId) return state;
      return updatePlayer(state, playerId, (player) =>
        player.trashSoulCoreCount > 0
          ? player
          : { ...player, trashSoulCoreCount: 1 }
      );
    case "life":
      if (source.playerId !== playerId) return state;
      return updatePlayer(state, playerId, (player) =>
        player.lifeSoulCoreCount > 0
          ? player
          : { ...player, lifeSoulCoreCount: 1 }
      );
    case "removed_from_game":
    case "void":
      return state;
  }
}

function getCoreDistributionSoulCoreSourceContainer(
  state: GameState,
  pending: NonNullable<GameState["pendingCoreDistribution"]>
): SoulCoreContainer | undefined {
  if (pending.fromKind === "reserve") {
    return { kind: "reserve", playerId: pending.fromPlayerId };
  }
  if (pending.fromKind === "trash") {
    return { kind: "trash", playerId: pending.fromPlayerId };
  }
  if (pending.fromKind === "life") {
    return { kind: "life", playerId: pending.fromPlayerId };
  }
  if (pending.fromKind === "any_movable") {
    const fromSoulLocation = state.players.find(
      (p) => p.id === pending.fromPlayerId
    )?.soulCoreLocation;
    return fromSoulLocation
      ? toSoulCoreContainer(fromSoulLocation, pending.fromPlayerId)
      : undefined;
  }
  return undefined;
}

function getSoulCoreSourceLogKind(
  source: SoulCoreContainer | undefined
): string {
  if (!source) return "unknown";
  return source.kind;
}

function getPositiveCoreDistributionTargetIds(
  pending: NonNullable<GameState["pendingCoreDistribution"]>,
  allocations: Record<string, number>,
  soulCoreAllocations: Record<string, number>
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of pending.candidates) {
    if (
      (allocations[candidate.instanceId] ?? 0) <= 0 &&
      (soulCoreAllocations[candidate.instanceId] ?? 0) <= 0
    ) {
      continue;
    }
    seen.add(candidate.instanceId);
    ids.push(candidate.instanceId);
  }
  return ids;
}

function normalizeCoreDistributionSoulCoreAllocations(options: {
  pending: NonNullable<GameState["pendingCoreDistribution"]>;
  soulCoreAllocations: Record<string, number> | undefined;
  soulCoreInstanceId: string | undefined;
}): Record<string, number> {
  if (options.soulCoreAllocations !== undefined) {
    return { ...options.soulCoreAllocations };
  }
  if (options.soulCoreInstanceId === undefined) return {};
  const count = options.pending.totalSoulCores ?? 1;
  return count > 0 ? { [options.soulCoreInstanceId]: count } : {};
}

function validateTargetTotalSelectionTotals(options: {
  state: GameState;
  pending: NonNullable<GameState["pendingCoreDistribution"]>;
  targetTotals: Record<string, number>;
  moveLimit: number;
}): void {
  const { state, pending, targetTotals, moveLimit } = options;
  const bounds = getCoreDistributionTargetTotalBounds(
    state,
    pending,
    moveLimit
  );
  let selectedTargetTotal = 0;
  let deficitTotal = 0;

  for (const candidate of pending.candidates) {
    const current = bounds.currentTotals[candidate.instanceId] ?? 0;
    const selected = targetTotals[candidate.instanceId] ?? 0;
    const minReachable = bounds.minimumTotals[candidate.instanceId] ?? 0;
    const maxReachable = bounds.maximumTotals[candidate.instanceId] ?? 0;
    if (selected < minReachable) {
      throw new Error(
        `Core distribution target total ${selected} for ${candidate.instanceId} is below reachable minimum ${minReachable}`
      );
    }
    if (selected > maxReachable) {
      throw new Error(
        `Core distribution target total ${selected} for ${candidate.instanceId} exceeds reachable maximum ${maxReachable}`
      );
    }
    selectedTargetTotal += selected;
    deficitTotal += Math.max(0, selected - current);
  }

  if (selectedTargetTotal < bounds.minimumSelectedTotal) {
    throw new Error(
      `Core distribution target total ${selectedTargetTotal} is below current target total ${bounds.minimumSelectedTotal}`
    );
  }
  if (selectedTargetTotal > bounds.maximumSelectedTotal) {
    throw new Error(
      `Core distribution target total ${selectedTargetTotal} exceeds reachable total ${bounds.maximumSelectedTotal}`
    );
  }
  if (deficitTotal > bounds.maximumDeficitTotal) {
    throw new Error(
      `Core distribution target total deficits ${deficitTotal} exceed move limit ${bounds.maximumDeficitTotal}`
    );
  }
}

function validateFixedTargetTotalsAfterSourceChoice(options: {
  state: GameState;
  pending: NonNullable<GameState["pendingCoreDistribution"]>;
  fixedTargetTotals: Record<string, number>;
  allocations: Record<string, number>;
  soulCoreAllocations: Record<string, number>;
  sourceAllocations: Record<string, number>;
  soulCoreSourceAllocations: Record<string, number>;
}): void {
  const {
    state,
    pending,
    fixedTargetTotals,
    allocations,
    soulCoreAllocations,
    sourceAllocations,
    soulCoreSourceAllocations,
  } = options;
  for (const candidate of pending.candidates) {
    const sourceKey = `field:${candidate.instanceId}`;
    const current = getTotalCoresOnCardById(state, candidate.instanceId);
    const incoming =
      (allocations[candidate.instanceId] ?? 0) +
      (soulCoreAllocations[candidate.instanceId] ?? 0);
    const outgoing =
      (sourceAllocations[sourceKey] ?? 0) +
      (soulCoreSourceAllocations[sourceKey] ?? 0);
    const actual = current - outgoing + incoming;
    const expected = fixedTargetTotals[candidate.instanceId] ?? 0;
    if (actual !== expected) {
      throw new Error(
        `Core distribution target ${candidate.instanceId} total ${actual} does not match fixed target total ${expected}`
      );
    }
  }
}

function maybeQueueCoreDistributionTargetedDisclosure(options: {
  applyOptions: ApplyLegalActionOptions;
  pending: NonNullable<GameState["pendingCoreDistribution"]>;
  positiveTargetIds: readonly string[];
  allocations: Record<string, number>;
  sourceAllocations?: Record<string, number>;
  soulCoreAllocations: Record<string, number>;
  soulCoreSourceAllocations?: Record<string, number>;
  soulCoreInstanceId?: string;
}): GameState | null {
  const {
    applyOptions,
    pending,
    positiveTargetIds,
    allocations,
    sourceAllocations,
    soulCoreAllocations,
    soulCoreSourceAllocations,
    soulCoreInstanceId,
  } = options;
  const ctx = pending.targetInterruption;
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;
  if (
    !ctx ||
    ctx.targetedDisclosureResolved === true ||
    positiveTargetIds.length === 0
  ) {
    return null;
  }
  const disclosed = queueTargetedDisclosureForStep({
    state: {
      ...applyOptions.state,
      pendingCoreDistribution: null,
    },
    selectedTargetInstanceIds: positiveTargetIds,
    resumeTargetInstanceIds: positiveTargetIds,
    actingPlayerId: ctx.actingPlayerId,
    sourceInstanceId: ctx.sourceInstanceId,
    sourceDefinitionId: ctx.sourceDefinitionId,
    ...(ctx.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: ctx.effectSourceInstanceId }
      : {}),
    ...(ctx.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: ctx.effectSourceDefinitionId }
      : {}),
    ...(ctx.sourceCardReferenceInstanceId !== undefined
      ? { sourceCardReferenceInstanceId: ctx.sourceCardReferenceInstanceId }
      : {}),
    targetedEventSourceInstanceId:
      ctx.effectSourceInstanceId ?? ctx.sourceInstanceId,
    targetedEventSourceDefinitionId:
      ctx.effectSourceDefinitionId ?? ctx.sourceDefinitionId,
    ...(ctx.effectActionKind !== undefined
      ? { effectActionKind: ctx.effectActionKind }
      : {}),
    ...(ctx.effectActivationTiming !== undefined
      ? { effectActivationTiming: ctx.effectActivationTiming }
      : {}),
    ...(ctx.chainId !== undefined ? { chainId: ctx.chainId } : {}),
    ...(battleEndAttackId !== undefined
      ? {
          battleEndDeferralAttackId: battleEndAttackId,
          chainId:
            ctx.chainId ?? getBattleEndDeferralChainId(battleEndAttackId),
        }
      : {}),
    effectIndex: ctx.effectIndex,
    ...(ctx.divineSkillIndex !== undefined
      ? { divineSkillIndex: ctx.divineSkillIndex }
      : {}),
    ...(ctx.isAccelData !== undefined ? { isAccelData: ctx.isAccelData } : {}),
    ...(ctx.isChangeData !== undefined
      ? { isChangeData: ctx.isChangeData }
      : {}),
    resumeStepIndex: ctx.stepIndex,
    targetStepId: ctx.targetStepId,
    stepContext: ctx.stepContext,
    getCardDefinitionById: applyOptions.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      applyOptions.getRegisteredTriggeredEffectActions,
    ...(applyOptions.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: applyOptions.getRegisteredBurstActions }
      : {}),
    ...(ctx.choiceIndex !== undefined ? { choiceIndex: ctx.choiceIndex } : {}),
    ...(ctx.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: ctx.sourcePreventionLevel }
      : {}),
    ...(ctx.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: ctx.sourcePreventionBypass }
      : {}),
    ...(ctx.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: ctx.costPaidThisEffect }
      : {}),
    ...(ctx.postResolutionOracle !== undefined
      ? { postResolutionOracle: ctx.postResolutionOracle }
      : {}),
    ...(ctx.effectResolutionBeforeState !== undefined
      ? { effectResolutionBeforeState: ctx.effectResolutionBeforeState }
      : {}),
    disclosureTargetStart: 0,
    disclosureTargetCount: positiveTargetIds.length,
    targetCandidateInstanceIds: pending.candidates.map((c) => c.instanceId),
    coreDistributionPending: pending,
    coreDistributionAllocations: allocations,
    ...(sourceAllocations !== undefined
      ? { coreDistributionSourceAllocations: sourceAllocations }
      : {}),
    ...(Object.keys(soulCoreAllocations).length > 0
      ? { coreDistributionSoulCoreAllocations: soulCoreAllocations }
      : {}),
    ...(soulCoreSourceAllocations !== undefined
      ? { coreDistributionSoulCoreSourceAllocations: soulCoreSourceAllocations }
      : {}),
    ...(soulCoreInstanceId !== undefined
      ? { coreDistributionSoulCoreInstanceId: soulCoreInstanceId }
      : {}),
  });
  return disclosed.queued ? disclosed.state : null;
}

function maybeQueueCoreDistributionTargetRedirect(options: {
  applyOptions: ApplyLegalActionOptions;
  pending: NonNullable<GameState["pendingCoreDistribution"]>;
  positiveTargetIds: readonly string[];
  allocations: Record<string, number>;
  sourceAllocations?: Record<string, number>;
  soulCoreAllocations: Record<string, number>;
  soulCoreSourceAllocations?: Record<string, number>;
  soulCoreInstanceId?: string;
}): GameState | null {
  const {
    applyOptions,
    pending,
    positiveTargetIds,
    allocations,
    sourceAllocations,
    soulCoreAllocations,
    soulCoreSourceAllocations,
    soulCoreInstanceId,
  } = options;
  const ctx = pending.targetInterruption;
  if (!ctx || positiveTargetIds.length === 0) return null;

  const sourceEffectInstanceId =
    ctx.effectSourceInstanceId ?? ctx.sourceInstanceId;
  const sourceEffectCard = getCardById(
    applyOptions.state,
    sourceEffectInstanceId
  );
  const sourceEffectDefinitionId =
    ctx.effectSourceDefinitionId ??
    sourceEffectCard?.definitionId ??
    ctx.sourceDefinitionId;
  const redirectEffectSourceIdentity = resolveAffectSourceIdentity({
    state: applyOptions.state,
    sourceInstanceId: ctx.sourceInstanceId,
    ...(ctx.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: ctx.effectSourceInstanceId }
      : {}),
    ...(ctx.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: ctx.effectSourceDefinitionId }
      : {}),
    getCardDefinitionById: applyOptions.getCardDefinitionById,
  });
  const skipped = new Set(pending.skippedTargetRedirectEffectIds ?? []);
  const match = findApplicableTargetRedirects(
    applyOptions.state,
    positiveTargetIds,
    ctx.actingPlayerId,
    ctx.sourcePreventionLevel,
    {
      instance: redirectEffectSourceIdentity.instance,
      definition: redirectEffectSourceIdentity.definition,
    },
    applyOptions.getCardDefinitionById,
    ctx.sourcePreventionBypass,
    ctx.targetSpec
      ? {
          targetSpec: ctx.targetSpec,
          sourceInstanceId: redirectEffectSourceIdentity.instanceId,
          stepContext: deserializeStepContext(
            ctx.stepContext,
            applyOptions.state
          ),
        }
      : undefined
  ).find((candidate) => !skipped.has(candidate.redirectEffectId));
  if (!match) return null;

  const redirectPending = {
    pendingId: `core-distribute-redirect:${match.redirectEffectId}:${applyOptions.state.turnNumber}:${applyOptions.state.pendingTargetRedirects.length}:${pending.pendingId}`,
    redirectEffectId: match.redirectEffectId,
    promptedPlayerId: match.promptedPlayerId,
    candidateChooserPlayerId: match.candidateChooserPlayerId,
    sourceEffectInstanceId,
    sourceEffectDefinitionId,
    originalResolvedInstanceIds: [...positiveTargetIds],
    redirectableInstanceId: match.protectedInstanceId,
    redirectableInstanceIds: [...match.redirectableInstanceIds],
    replacementMode: match.replacementMode,
    candidateTokenInstanceIds: [...match.candidateTokenInstanceIds],
    coreDistributionPendingId: pending.pendingId,
    coreDistributionAllocations: { ...allocations },
    ...(sourceAllocations !== undefined
      ? { coreDistributionSourceAllocations: { ...sourceAllocations } }
      : {}),
    ...(Object.keys(soulCoreAllocations).length > 0
      ? { coreDistributionSoulCoreAllocations: { ...soulCoreAllocations } }
      : {}),
    ...(soulCoreSourceAllocations !== undefined
      ? {
          coreDistributionSoulCoreSourceAllocations: {
            ...soulCoreSourceAllocations,
          },
        }
      : {}),
    ...(soulCoreInstanceId !== undefined
      ? { coreDistributionSoulCoreInstanceId: soulCoreInstanceId }
      : {}),
  } satisfies NonNullable<GameState["pendingTargetRedirects"][number]>;

  return {
    ...applyOptions.state,
    pendingTargetRedirects: [
      ...applyOptions.state.pendingTargetRedirects,
      redirectPending,
    ],
    log: [
      ...applyOptions.state.log,
      `effect:core-distribute-redirect-pending:${pending.pendingId}:protected=${match.protectedInstanceIds.join(",")}:redirectable=${match.redirectableInstanceIds.join(",")}:candidates=${match.candidateTokenInstanceIds.join(",")}`,
    ],
  };
}

export function applyPendingCoreDistributionAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingCoreDistributionResult {
  const pending = options.state.pendingCoreDistribution;
  if (!pending) {
    throw new Error("No pending core distribution to resolve");
  }
  if (pending.stateBasedBraveSeparation) {
    const { hostInstanceId, braveInstanceId } =
      pending.stateBasedBraveSeparation;
    const host = getCardById(options.state, hostInstanceId);
    const brave = getCardById(options.state, braveInstanceId);
    if (
      !host ||
      host.pendingLeaveKind !== null ||
      !brave ||
      brave.pendingLeaveKind !== null ||
      brave.attachedToInstanceId !== hostInstanceId
    ) {
      throw new Error("Brave separation core choice is no longer applicable");
    }
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ??
      pending.rebirthCompletion ??
      pending.targetInterruption ??
      pending.postResolutionOracle ?? {
        chainId: `core-distribute:${pending.pendingId}`,
      },
    pending.battleEndDeferralAttackId
  );
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;

  const allocations = options.coreDistributionAllocations ?? {};
  const soulCoreInstanceId = options.coreDistributionSoulCoreInstanceId;
  const soulCoreAllocations = normalizeCoreDistributionSoulCoreAllocations({
    pending,
    soulCoreAllocations: options.coreDistributionSoulCoreAllocations,
    soulCoreInstanceId,
  });

  // 配分検証
  let totalAllocated = 0;
  let selectedSoulCoreCount = 0;
  const candidateIds = new Set(pending.candidates.map((c) => c.instanceId));
  for (const [id, amount] of Object.entries(allocations)) {
    if (amount < 0) {
      throw new Error(
        `Core distribution amount ${amount} for ${id} must be non-negative`
      );
    }
    if (amount > 0 && !candidateIds.has(id)) {
      throw new Error(`Core distribution target ${id} is not a candidate`);
    }
    totalAllocated += amount;
  }
  const targetTotalSelection = pending.targetTotalSelection;
  if (
    targetTotalSelection !== undefined &&
    targetTotalSelection.fixedTargetTotals === undefined
  ) {
    const selectedSoulTargetTotal = Object.values(soulCoreAllocations).reduce(
      (sum, amount) => sum + Math.max(0, amount),
      0
    );
    const hasPhysicalCoreSelection =
      selectedSoulTargetTotal > 0 ||
      soulCoreInstanceId !== undefined ||
      options.coreDistributionSourceAllocations !== undefined ||
      options.coreDistributionSoulCoreSourceAllocations !== undefined;
    const chooserAlsoOwnsSources =
      targetTotalSelection.targetChooserPlayerId ===
      targetTotalSelection.sourceOwnerPlayerId;
    if (hasPhysicalCoreSelection && !chooserAlsoOwnsSources) {
      throw new Error(
        `Core distribution ${pending.pendingId} target-total selection must not choose physical core sources`
      );
    }
    const hasPositiveTargetTotals = Object.values(allocations).some(
      (amount) => amount > 0
    );
    // Training takes the factored path through a positive target-total choice.
    // Existing GUI/API callers controlled by the same player may still submit
    // a complete allocation directly, including an empty allocation that must
    // run the ordinary minimum-total/rollback validation.
    const shouldFactorTargetTotals =
      !chooserAlsoOwnsSources ||
      (!hasPhysicalCoreSelection && hasPositiveTargetTotals);
    if (shouldFactorTargetTotals) {
      validateTargetTotalSelectionTotals({
        state: options.state,
        pending,
        targetTotals: allocations,
        moveLimit: getCoreDistributionMoveLimit(pending),
      });
      const targetTotals = Object.fromEntries(
        Object.entries(allocations).filter(([, amount]) => amount > 0)
      );
      return {
        state: {
          ...options.state,
          pendingCoreDistribution: {
            ...pending,
            actingPlayerId: targetTotalSelection.sourceOwnerPlayerId,
            targetTotalSelection: {
              ...targetTotalSelection,
              fixedTargetTotals: targetTotals,
            },
          },
          log: [
            ...options.state.log,
            `effect:core_distribute:target-totals-selected:${pending.pendingId}:${Object.entries(
              targetTotals
            )
              .map(([id, amount]) => `${id}:${amount}`)
              .join(",")}`,
          ],
        },
      };
    }
  }
  if (totalAllocated > pending.totalNormalCores) {
    throw new Error(
      `Core distribution total ${totalAllocated} exceeds available ${pending.totalNormalCores}`
    );
  }
  for (const [id, amount] of Object.entries(soulCoreAllocations)) {
    if (amount < 0) {
      throw new Error(
        `Core distribution soul amount ${amount} for ${id} must be non-negative`
      );
    }
    if (amount > 0 && !candidateIds.has(id)) {
      throw new Error(`Soul core target ${id} is not a candidate`);
    }
    selectedSoulCoreCount += amount;
  }
  if (
    !isCoreDistributionAllocationValid(
      pending,
      allocations,
      soulCoreAllocations
    )
  ) {
    throw new Error(
      "Core distribution violates candidate or shared allocation limits"
    );
  }
  const fixedTargetTotals = pending.targetTotalSelection?.fixedTargetTotals;
  const hasSelectedSoulCore = selectedSoulCoreCount > 0;
  const totalSoulCores =
    pending.totalSoulCores ?? (pending.hasSoulCore ? 1 : 0);
  let selectedSoulCoreSourceContainer: SoulCoreContainer | undefined;
  // 単一ソース reserve/trash/life と any_movable は、generic な「コア」を
  // 06_core-system.md §41-42 どおりソウルコア込みで扱う。void だけは soul 非対応。
  // cross-player destination (fromPlayerId !== toPlayerId) では soul ownership 移転が
  // 未モデル化のため、soul 指定自体を不正扱いとする (ENGINE-core-move-soul-cross-player-
  // destination option b と同じ guard を applyPendingCoreShootAction から移植)。
  if (hasSelectedSoulCore && pending.fromPlayerId !== pending.toPlayerId) {
    throw new Error(
      `Core distribution soul-core source is not allowed for cross-player destination`
    );
  }
  if (hasSelectedSoulCore && !pending.hasSoulCore) {
    throw new Error("No soul core to distribute");
  }
  if (selectedSoulCoreCount > totalSoulCores) {
    throw new Error(
      `Core distribution soul total ${selectedSoulCoreCount} exceeds available ${totalSoulCores}`
    );
  }
  let multiSourceSoulAllocations: Record<string, number> | undefined;
  if (hasSelectedSoulCore) {
    if (pending.fromKind === "any_movable") {
      const requestedSourceAllocations =
        options.coreDistributionSoulCoreSourceAllocations;
      const soulSourceAvailable = pending.soulSourceAvailable ?? {};
      const sourceAllocations =
        requestedSourceAllocations ??
        (() => {
          const legacySource = getCoreDistributionSoulCoreSourceContainer(
            options.state,
            pending
          );
          if (!legacySource) return undefined;
          const legacyKey = coreDistributionSoulCoreSourceKey(legacySource);
          return legacyKey ? { [legacyKey]: selectedSoulCoreCount } : undefined;
        })();
      if (!sourceAllocations) {
        throw new Error(
          `Core distribution ${pending.pendingId} has no soul core source`
        );
      }
      let sourceSoulTotal = 0;
      for (const [key, amount] of Object.entries(sourceAllocations)) {
        if (!Number.isInteger(amount) || amount < 0) {
          throw new Error(
            `Core distribution soul source amount ${amount} for ${key} must be a non-negative integer`
          );
        }
        if (amount === 0) continue;
        const source = coreDistributionSoulCoreSourceContainerFromKey(
          pending.fromPlayerId,
          key
        );
        if (!source) {
          throw new Error(
            `Core distribution soul source ${key} is not supported`
          );
        }
        const cap =
          soulSourceAvailable[key] ??
          (requestedSourceAllocations === undefined ? amount : 0);
        if (amount > cap) {
          throw new Error(
            `Core distribution soul source ${key} amount ${amount} exceeds available ${cap}`
          );
        }
        sourceSoulTotal += amount;
      }
      if (sourceSoulTotal !== selectedSoulCoreCount) {
        throw new Error(
          `Core distribution soul source total ${sourceSoulTotal} does not match recipient soul total ${selectedSoulCoreCount}`
        );
      }
      multiSourceSoulAllocations = sourceAllocations;
    } else if (pending.fromKind === "outside_game") {
      // ゲーム外からの新規生成には既存の移動元コンテナが無いため、
      // ソース container 検証をスキップする (下の最終適用フェーズで
      // generateSoulCoreOutsideGame により直接生成する)。
      if (selectedSoulCoreCount <= 0) {
        throw new Error(
          `Core distribution ${pending.pendingId} has no soul core to place`
        );
      }
    } else {
      selectedSoulCoreSourceContainer =
        getCoreDistributionSoulCoreSourceContainer(options.state, pending);
      if (!selectedSoulCoreSourceContainer || selectedSoulCoreCount <= 0) {
        throw new Error(
          `Core distribution ${pending.pendingId} has no soul core source`
        );
      }
      if (
        selectedSoulCoreSourceContainer.kind === "card" &&
        (soulCoreAllocations[selectedSoulCoreSourceContainer.instanceId] ?? 0) >
          0
      ) {
        throw new Error(
          `Core distribution ${pending.pendingId} cannot place a soul core from a card to itself`
        );
      }
    }
  }
  const minTotal = pending.minTotal ?? 0;
  // ソウルコアも配置1個分として最低数に数える (「コア1個以上」をソウル単独で満たせる)。
  const effectivePlaced = totalAllocated + selectedSoulCoreCount;
  if (
    pending.rollbackIfBelowMinTotal &&
    effectivePlaced < pending.rollbackIfBelowMinTotal.minTotal
  ) {
    if (pending.rebirthCompletion) {
      const completion = pending.rebirthCompletion;
      if (completion.deferredAction) {
        return finalizeAbortedCoreDistribution(
          options,
          pending,
          `effect:core_distribute:rebirth-post-choice-cancelled:${pending.pendingId}:reason=${pending.rollbackIfBelowMinTotal.reason}:placed=${effectivePlaced}<${pending.rollbackIfBelowMinTotal.minTotal}`
        );
      }
      const failureChainId = `${completion.chainId}:rebirth:${completion.sourceInstanceId}:lv-deficit`;
      const failedBaseState: GameState = {
        ...options.state,
        pendingCoreDistribution: null,
        log: [
          ...options.state.log,
          `effect:core_distribute:rebirth-minimum-failed:${pending.pendingId}:reason=${pending.rollbackIfBelowMinTotal.reason}:placed=${effectivePlaced}<${pending.rollbackIfBelowMinTotal.minTotal}`,
        ],
      };
      let failedState = queuePendingLeave({
        state: failedBaseState,
        instanceId: completion.sourceInstanceId,
        kind: "vanish",
        cause: "effect_resolution",
        chainId: failureChainId,
        causePlayerId: completion.actingPlayerId,
        deferZoneMoveUntilChainEnd: false,
        causedByEffectSourceInstanceId: completion.sourceInstanceId,
        resolvedSourceRegistrationKeys: [completion.sourceInstanceId],
      });
      const beforeState = getRebirthCompletionBeforeStateForTriggerDelta(
        pending,
        failedState
      );
      failedState = createEffectResolutionScope(
        completion,
        battleEndAttackId
      ).finalize({
        state: failedState,
        beforeState,
        endLogs: [],
        actingPlayerId: completion.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        sourceColors: getPendingSourceColors({
          state: failedState,
          sourceInstanceId: completion.sourceInstanceId,
          sourceDefinitionId: pending.sourceDefinitionId,
          getCardDefinitionById: options.getCardDefinitionById,
        }),
        causedBySourceInstanceId: completion.sourceInstanceId,
        enterFieldCausedByPlayerId: completion.actingPlayerId,
        ...(battleEndAttackId !== undefined
          ? { battleEndDeferralAttackId: battleEndAttackId }
          : {}),
      });
      failedState = checkAndQueuePostResolutionOracleIfReady(
        failedState,
        pending.continuation?.postResolutionOracle ??
          pending.postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      );
      failedState = applyTargetedDisclosureResolutionCleanupsWhenReady(
        failedState,
        pending.targetedDisclosureResolutionCleanups
      );
      if (!hasOutstandingEffectResolutionContinuation(failedState)) {
        failedState = resumeStackCascadeIfReady(failedState, options);
      }
      failedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
        failedState,
        options
      );
      return { state: failedState };
    }
    if (!pending.priorStateSnapshot) {
      throw new Error(
        `Core distribution ${pending.pendingId} cannot rollback below-minimum placement without priorStateSnapshot`
      );
    }
    return finalizeAbortedCoreDistribution(
      options,
      pending,
      `effect:core_distribute:rollback:${pending.pendingId}:reason=${pending.rollbackIfBelowMinTotal.reason}:placed=${effectivePlaced}<${pending.rollbackIfBelowMinTotal.minTotal}`
    );
  }
  if (effectivePlaced < minTotal) {
    throw new Error(
      `Core distribution total ${effectivePlaced} is below minimum ${minTotal}`
    );
  }
  if (pending.maxTotal !== undefined && effectivePlaced > pending.maxTotal) {
    throw new Error(
      `Core distribution total ${effectivePlaced} exceeds maximum ${pending.maxTotal}`
    );
  }
  if (pending.mustPlaceSoulCore && totalAllocated < pending.totalNormalCores) {
    throw new Error(
      `Core distribution normal total ${totalAllocated} is below required all-normal total ${pending.totalNormalCores}`
    );
  }
  // BSTH01-M01 等「コアすべて」: ソウルコアを必ず配置先カードに置く必要がある。
  // hasSoulCore でありながら soulCoreInstanceId 未指定で完了することは不可。
  if (
    pending.mustPlaceSoulCore &&
    pending.hasSoulCore &&
    selectedSoulCoreCount < totalSoulCores
  ) {
    const soulSourceLabel =
      pending.fromKind === "any_movable" ? "selected source" : pending.fromKind;
    throw new Error(
      `Soul core in ${soulSourceLabel} must be placed (card text requires placing all cores)`
    );
  }

  // 直接 state を更新（executeCoreMove 経由だと amount=0 + ソウルコアのみ
  // のケースで再帰的に pending になる/早期 return する問題があるため）
  const allocMap = new Map(
    Object.entries(allocations).filter(([, v]) => v > 0)
  );
  let movedTotal = 0;
  for (const v of allocMap.values()) movedTotal += v;

  // P3-47 F-5: multi-source 検証 (fromKind="any_movable")
  let multiSourceAllocations: Record<string, number> | undefined;
  if (pending.fromKind === "any_movable") {
    const sourceAllocations = options.coreDistributionSourceAllocations ?? {};
    const sourceAvailable = pending.sourceAvailable ?? {};
    const allowedSourceKeys = new Set<string>();
    for (const src of pending.allowedSources ?? []) {
      const key = src.kind === "field" ? `field:${src.instanceId}` : src.kind;
      allowedSourceKeys.add(key);
    }
    let sourceTotal = 0;
    for (const [key, amount] of Object.entries(sourceAllocations)) {
      if (amount < 0) {
        throw new Error(
          `Core distribution source amount ${amount} for ${key} must be non-negative`
        );
      }
      if (amount === 0) continue;
      if (!allowedSourceKeys.has(key)) {
        throw new Error(
          `Core distribution source ${key} is not in allowedSources`
        );
      }
      const cap = sourceAvailable[key] ?? 0;
      if (amount > cap) {
        throw new Error(
          `Core distribution source ${key} amount ${amount} exceeds available ${cap}`
        );
      }
      sourceTotal += amount;
    }
    if (sourceTotal !== movedTotal) {
      throw new Error(
        `Core distribution source total ${sourceTotal} does not match recipient total ${movedTotal}`
      );
    }
    if (pending.sourceTotalAvailable !== undefined) {
      const sourceTotalAvailable = pending.sourceTotalAvailable;
      const soulSourceAllocations = multiSourceSoulAllocations ?? {};
      const sourceKeys = new Set<string>([
        ...Object.keys(sourceAllocations),
        ...Object.keys(soulSourceAllocations),
      ]);
      for (const key of sourceKeys) {
        const combinedAmount =
          (sourceAllocations[key] ?? 0) + (soulSourceAllocations[key] ?? 0);
        const cap = sourceTotalAvailable[key] ?? 0;
        if (combinedAmount > cap) {
          throw new Error(
            `Core distribution source ${key} total ${combinedAmount} exceeds combined available ${cap}`
          );
        }
      }
    }
    multiSourceAllocations = sourceAllocations;
  }

  if (fixedTargetTotals !== undefined) {
    validateFixedTargetTotalsAfterSourceChoice({
      state: options.state,
      pending,
      fixedTargetTotals,
      allocations,
      soulCoreAllocations,
      sourceAllocations: multiSourceAllocations ?? {},
      soulCoreSourceAllocations: multiSourceSoulAllocations ?? {},
    });
  }

  const positiveTargetIds = getPositiveCoreDistributionTargetIds(
    pending,
    allocations,
    soulCoreAllocations
  );
  const disclosedState = maybeQueueCoreDistributionTargetedDisclosure({
    applyOptions: options,
    pending,
    positiveTargetIds,
    allocations,
    ...(multiSourceAllocations !== undefined
      ? { sourceAllocations: multiSourceAllocations }
      : {}),
    soulCoreAllocations,
    ...(multiSourceSoulAllocations !== undefined
      ? { soulCoreSourceAllocations: multiSourceSoulAllocations }
      : {}),
    ...(soulCoreInstanceId !== undefined ? { soulCoreInstanceId } : {}),
  });
  if (disclosedState) {
    return { state: disclosedState };
  }
  const redirectState = maybeQueueCoreDistributionTargetRedirect({
    applyOptions: options,
    pending,
    positiveTargetIds,
    allocations,
    ...(multiSourceAllocations !== undefined
      ? { sourceAllocations: multiSourceAllocations }
      : {}),
    soulCoreAllocations,
    ...(multiSourceSoulAllocations !== undefined
      ? { soulCoreSourceAllocations: multiSourceSoulAllocations }
      : {}),
    ...(soulCoreInstanceId !== undefined ? { soulCoreInstanceId } : {}),
  });
  if (redirectState) {
    return { state: redirectState };
  }

  const sourceLabel =
    pending.fromKind === "reserve"
      ? "reserve"
      : pending.fromKind === "trash"
        ? "trash"
        : pending.fromKind === "void"
          ? "void"
          : pending.fromKind === "life"
            ? "life"
            : pending.fromKind === "outside_game"
              ? "outside_game"
              : "any_movable";
  let currentState: GameState = {
    ...options.state,
    pendingCoreDistribution: null,
    log: [
      ...options.state.log,
      movedTotal > 0
        ? `effect:core_move:${sourceLabel}:${pending.fromPlayerId}->field:${pending.toPlayerId}:${movedTotal}:player-selected`
        : `effect:core_move:${sourceLabel}->field:${pending.fromPlayerId}:0:player-selected-empty`,
    ],
  };

  const rebirthCompletion = pending.rebirthCompletion;
  const deferredRebirthAction = rebirthCompletion?.deferredAction;
  // 分離元を煌臨元へ畳む転醒では、待機中のホスト上からもコアを選べる。
  // 先に畳むと選択元のコアがリザーブへ退避されるため、選択分を移してから転醒する。
  const distributeBeforeRebirth = Boolean(
    deferredRebirthAction?.separatesFromHost &&
    deferredRebirthAction.foldCombinedPartnerToAdventSource
  );
  const completeDeferredRebirth = (state: GameState): GameState =>
    deferredRebirthAction && rebirthCompletion
      ? executeRebirth(
          state,
          rebirthCompletion.actingPlayerId,
          deferredRebirthAction,
          rebirthCompletion.sourceInstanceId,
          options.getCardDefinitionById,
          rebirthCompletion.chainId,
          rebirthCompletion.rebirthTimingWindowId
        )
      : state;
  const deferredRebirthCompleted = (state: GameState): boolean => {
    if (!deferredRebirthAction || !rebirthCompletion) return true;
    const card = getCardById(state, rebirthCompletion.sourceInstanceId);
    const candidate = pending.candidates.find(
      (entry) => entry.instanceId === rebirthCompletion.sourceInstanceId
    );
    return Boolean(
      card?.zone === "field" &&
      candidate &&
      card.definitionId === candidate.definitionId
    );
  };
  const abortFailedDeferredRebirth = (): { state: GameState } =>
    finalizeAbortedCoreSelection(
      options,
      {
        ...options.state,
        pendingCoreDistribution: null,
        log: [
          ...options.state.log,
          `effect:rebirth:${rebirthCompletion!.sourceInstanceId}:post-choice-completion-failed`,
        ],
      },
      pending,
      `${rebirthCompletion!.chainId}:post-choice-completion-failed`
    );
  if (!distributeBeforeRebirth) {
    currentState = completeDeferredRebirth(currentState);
    // 保存/入力待ちの間に count 条件や同時転醒資格が失われたら、
    // A 面へのコア移動・count 加算・後続 step 再開を行わない。
    if (!deferredRebirthCompleted(currentState)) {
      return abortFailedDeferredRebirth();
    }
  }

  if (movedTotal > 0 || selectedSoulCoreCount > 0) {
    const sourceChunks: NormalCoreDistributionSourceChunk[] = [];
    const pushSourceChunk = (
      container: NormalCoreContainer,
      amount: number | undefined
    ) => {
      if (!amount || amount <= 0) return;
      sourceChunks.push({ container, remaining: amount });
    };
    if (multiSourceAllocations) {
      pushSourceChunk(
        { kind: "reserve", playerId: pending.fromPlayerId },
        multiSourceAllocations["reserve"]
      );
      pushSourceChunk(
        { kind: "trash", playerId: pending.fromPlayerId },
        multiSourceAllocations["trash"]
      );
      pushSourceChunk(
        { kind: "life", playerId: pending.fromPlayerId },
        multiSourceAllocations["life"]
      );
      for (const [key, amount] of Object.entries(multiSourceAllocations)) {
        if (!key.startsWith("field:")) continue;
        pushSourceChunk({ kind: "card", instanceId: key.slice(6) }, amount);
      }
    } else if (pending.fromKind === "reserve") {
      pushSourceChunk(
        { kind: "reserve", playerId: pending.fromPlayerId },
        movedTotal
      );
    } else if (pending.fromKind === "trash") {
      pushSourceChunk(
        { kind: "trash", playerId: pending.fromPlayerId },
        movedTotal
      );
    } else if (pending.fromKind === "void") {
      pushSourceChunk(
        { kind: "void", playerId: pending.fromPlayerId },
        movedTotal
      );
    } else if (pending.fromKind === "life") {
      pushSourceChunk(
        { kind: "life", playerId: pending.fromPlayerId },
        movedTotal
      );
    }

    const movePlan = buildCoreDistributionMovePlan(
      sourceChunks,
      allocMap,
      pending.pendingId
    );
    for (const move of movePlan) {
      currentState = moveNormalCores(
        currentState,
        move.container,
        { kind: "card", instanceId: move.targetInstanceId },
        move.amount,
        options.getCardDefinitionById
      );
    }
    if (selectedSoulCoreCount > 0) {
      const soulAllocMap = new Map(
        Object.entries(soulCoreAllocations).filter(([, v]) => v > 0)
      );
      if (pending.fromKind === "outside_game") {
        // 既存コンテナからの移動ではなく、ゲーム外から新規生成して配置先カードへ直接置く
        // (BSLH01-X10 等)。moveSoulCore の from 側検証は使わず generateSoulCoreOutsideGame を使う。
        for (const [targetInstanceId, soulAmount] of Object.entries(
          soulCoreAllocations
        )) {
          if (soulAmount <= 0) continue;
          currentState.log.push(
            `effect:core_move:outside_game->field:${targetInstanceId}:${soulAmount}:player-selected`
          );
          currentState = generateSoulCoreOutsideGame(
            currentState,
            pending.toPlayerId,
            { kind: "card", instanceId: targetInstanceId },
            soulAmount,
            options.getCardDefinitionById
          );
        }
      } else if (multiSourceSoulAllocations !== undefined) {
        const soulSourceChunks: SoulCoreDistributionSourceChunk[] = [];
        for (const [key, amount] of Object.entries(
          multiSourceSoulAllocations
        )) {
          if (amount <= 0) continue;
          const container = coreDistributionSoulCoreSourceContainerFromKey(
            pending.fromPlayerId,
            key
          );
          if (!container) {
            throw new Error(
              `Core distribution soul source ${key} is not supported`
            );
          }
          soulSourceChunks.push({ container, remaining: amount });
        }
        const soulMovePlan = buildCoreDistributionSoulMovePlan(
          soulSourceChunks,
          soulAllocMap,
          pending.pendingId
        );
        for (const move of soulMovePlan) {
          currentState = ensureSoulCoreSourceCountForLegacyState(
            currentState,
            pending.fromPlayerId,
            move.container
          );
          currentState.log.push(
            `effect:core_move:soul_core:${pending.fromPlayerId}:${getSoulCoreSourceLogKind(move.container)}->field:${move.targetInstanceId}:${move.amount}`
          );
          currentState = moveSoulCore(
            currentState,
            pending.fromPlayerId,
            move.container,
            { kind: "card", instanceId: move.targetInstanceId },
            move.amount,
            options.getCardDefinitionById
          );
        }
      } else {
        currentState = ensureSoulCoreSourceCountForLegacyState(
          currentState,
          pending.fromPlayerId,
          selectedSoulCoreSourceContainer!
        );
        for (const [targetInstanceId, soulAmount] of Object.entries(
          soulCoreAllocations
        )) {
          if (soulAmount <= 0) continue;
          currentState.log.push(
            `effect:core_move:soul_core:${pending.fromPlayerId}:${getSoulCoreSourceLogKind(selectedSoulCoreSourceContainer)}->field:${targetInstanceId}:${soulAmount}`
          );
          currentState = moveSoulCore(
            currentState,
            pending.fromPlayerId,
            selectedSoulCoreSourceContainer!,
            { kind: "card", instanceId: targetInstanceId },
            soulAmount,
            options.getCardDefinitionById
          );
        }
      }
    }
    if (multiSourceAllocations) {
      const breakdown = Object.entries(multiSourceAllocations)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(",");
      if (breakdown) {
        currentState.log.push(
          `effect:core_move:any_movable:breakdown:${breakdown}`
        );
      }
    }
  }

  if (distributeBeforeRebirth) {
    currentState = completeDeferredRebirth(currentState);
    // 煌臨元化前に移した選択コアも、この入力直前の状態へ戻す。
    if (!deferredRebirthCompleted(currentState)) {
      return abortFailedDeferredRebirth();
    }
  }

  if (pending.stateBasedBraveSeparation) {
    const {
      hostInstanceId,
      braveInstanceId,
      remainingBraveInstanceIds,
      hostExhaustState,
    } = pending.stateBasedBraveSeparation;
    currentState = completeBraveForcedSeparation(
      currentState,
      braveInstanceId,
      hostInstanceId,
      options.getCardDefinitionById,
      hostExhaustState
    );
    // Settle level/waiting changes before advancing the owner's selected list.
    // Keep this pending marker during the sweep so it cannot open a second
    // capacity choice for a combination already selected for separation.
    currentState = rebuildContinuousAndApplyStateBasedActions(
      { ...currentState, pendingCoreDistribution: pending },
      options.getCardDefinitionById
    );
    currentState = { ...currentState, pendingCoreDistribution: null };
    currentState = continueBraveForcedSeparations(
      currentState,
      remainingBraveInstanceIds ?? [],
      options.getCardDefinitionById
    );
    return {
      state: finalizeRuleBraveSeparation(currentState, pending, options),
    };
  }

  if (pending.rebirthCompletion) {
    const completion = pending.rebirthCompletion;
    const countAction: RebirthAction = {
      kind: "rebirth",
      maxCount: Number.POSITIVE_INFINITY,
      triggerDescription: "rebirth completion",
      ...(completion.countBonusMode !== undefined
        ? { countBonusMode: completion.countBonusMode }
        : {}),
    };
    currentState = {
      ...currentState,
      players: currentState.players.map((player) =>
        player.id === completion.actingPlayerId
          ? applyRebirthCountBonus(player, countAction)
          : player
      ),
      log: [
        ...currentState.log,
        `effect:rebirth:${completion.sourceInstanceId}:completion:count`,
      ],
    };
  }

  // P3-47 Phase 2-2: continuation がある場合は元効果の後続ステップを再実行する。
  // executeCoreDistribute (mode="player_choice") が pendingCoreDistribution を生成して
  // 中断した時点で effect-interpreter が injected したコンテキスト。コア配置完了後、
  // startFromStepIndex = resumeStepIndex (= 次ステップ) で executeEffect を resume する。
  if (pending.continuation) {
    const cont = pending.continuation;
    const def = options.getCardDefinitionById(cont.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, cont);
    if (!effect) {
      throw new Error(
        `applyPendingCoreDistributionAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
      );
    }
    // ENGINE-core-distribute-actual-placement-count: mode="player_choice" は解決時まで
    // 実配置数が確定しないため、construction 時点では distribute step 自身の StepResult を
    // 記録できない（deck_reveal の handAddedCardInstanceIds と同型の制約）。resume 直前に
    // この distribute step の StepResult を注入し、後続 step の ref_count/ref_succeeded が
    // 「実際に置いた」件数/成否を参照できるようにする（BSDB01-C08「1個以上置いたとき」）。
    const distributeStepIndex = cont.resumeStepIndex - 1;
    const distributeStep = effect.steps[distributeStepIndex];
    const distributeRecordStepId =
      distributeStep?.id ?? `__step_${distributeStepIndex}`;
    const placedCardInstanceIds = Array.from(
      new Set([
        ...allocMap.keys(),
        ...Object.entries(soulCoreAllocations)
          .filter(([, amount]) => amount > 0)
          .map(([instanceId]) => instanceId),
      ])
    );
    const distributeNumericAmount = movedTotal + selectedSoulCoreCount;
    // 転醒に内包されたコア選択は、配置数にかかわらず転醒自体を完了する。
    // 中断前の executed / 選択情報を保ち、後続の択一分岐を再提示しない。
    const completedRebirthStep =
      pending.rebirthCompletion !== undefined &&
      distributeStep?.action.kind === "rebirth";
    const restoredStepContext = {
      ...cont.stepContext,
      results: {
        ...cont.stepContext.results,
        [distributeRecordStepId]: {
          ...cont.stepContext.results[distributeRecordStepId],
          stepId: distributeRecordStepId,
          affectedCardInstanceIds: completedRebirthStep
            ? [pending.rebirthCompletion!.sourceInstanceId]
            : placedCardInstanceIds,
          numericAmount: distributeNumericAmount,
          succeeded: completedRebirthStep || distributeNumericAmount >= 1,
          executed: true,
        },
      },
    };
    currentState = resolution.execute({
      state: currentState,
      effect,
      effectIndex: cont.effectIndex,
      ...(cont.divineSkillIndex !== undefined
        ? { divineSkillIndex: cont.divineSkillIndex }
        : {}),
      ...(cont.isAccelData !== undefined
        ? { isAccelData: cont.isAccelData }
        : {}),
      ...(cont.isChangeData !== undefined
        ? { isChangeData: cont.isChangeData }
        : {}),
      sourceInstanceId: cont.sourceInstanceId,
      actingPlayerId: cont.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext,
      ...(cont.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: cont.effectSourceInstanceId }
        : {}),
      ...(cont.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
        : {}),
      ...(cont.sourceCardReferenceInstanceId !== undefined
        ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
        : {}),
      ...(cont.effectActionKind !== undefined
        ? { effectActionKind: cont.effectActionKind }
        : {}),
      ...(cont.choiceIndex !== undefined
        ? { choiceIndex: cont.choiceIndex }
        : {}),
      ...(cont.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: cont.sourcePreventionLevel }
        : {}),
      ...(cont.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: cont.sourcePreventionBypass }
        : {}),
      ...(cont.costPaidThisEffect !== undefined
        ? { costPaidThisEffect: cont.costPaidThisEffect }
        : {}),
      ...(cont.postResolutionOracle !== undefined
        ? { postResolutionOracle: cont.postResolutionOracle }
        : {}),
      ...(battleEndAttackId !== undefined
        ? {
            battleEndDeferralAttackId: battleEndAttackId,
          }
        : {}),
    });
  }

  // P3-47 F-6: コア配置 (+ continuation resume) 後に通常解決と同じ finalization を通す。
  // executeEffect は step 間の after_triggers connector でしか SBA を回さず、resume した
  // ステップ列の終端では SBA / トリガー収集 / pending-leave flush を一切実行しない。
  // これを省くと、resume したステップで act_as_spirit (分身) CE が付与され 0 コアになった
  // 疑似スピリットがコア不足消滅 SBA を経由せず場に残ってしまう
  // (フランドール【フォーオブアカインド】のコア配分後)。
  const resolutionActingPlayerId =
    pending.continuation?.actingPlayerId ??
    pending.targetTotalSelection?.targetChooserPlayerId ??
    pending.actingPlayerId;
  const beforeStateForTriggerDelta =
    pending.rebirthCompletion !== undefined
      ? getRebirthCompletionBeforeStateForTriggerDelta(pending, currentState)
      : options.state;
  currentState = resolution.finalize({
    state: currentState,
    beforeState: beforeStateForTriggerDelta,
    ...(pending.supplementalTriggerEvents !== undefined
      ? { supplementalTriggerEvents: pending.supplementalTriggerEvents }
      : {}),
    endLogs: [],
    actingPlayerId: resolutionActingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ??
      pending.targetInterruption?.effectSourceInstanceId ??
      pending.sourceInstanceId,
    enterFieldCausedByPlayerId: resolutionActingPlayerId,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = checkAndQueuePostResolutionOracleIfReady(
    currentState,
    pending.continuation?.postResolutionOracle ?? pending.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  currentState = applyTargetedDisclosureResolutionCleanupsWhenReady(
    currentState,
    pending.targetedDisclosureResolutionCleanups
  );
  if (!hasOutstandingEffectResolutionContinuation(currentState)) {
    currentState = resumeStackCascadeIfReady(currentState, options);
  }
  currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
    currentState,
    options
  );
  return { state: currentState };
}

function finalizeAbortedCoreDistribution(
  options: ApplyLegalActionOptions,
  pending: PendingCoreDistribution,
  log: string
): { state: GameState } {
  const snapshot = pending.priorStateSnapshot ?? options.state;
  const restored = restoreAbortedEffectState(
    {
      ...snapshot,
      pendingCoreDistribution: null,
      log: [...snapshot.log, log],
    },
    options.state
  );
  return finalizeAbortedCoreSelection(
    options,
    restored,
    pending,
    `core-distribute:${pending.pendingId}:aborted`
  );
}

/** 配置を中止しても、先行stepの待機離脱と効果終了・スタック再開は完了させる。 */
function finalizeAbortedCoreSelection(
  options: ApplyLegalActionOptions,
  restored: GameState,
  pending:
    | PendingCoreDistribution
    | NonNullable<GameState["pendingMultiPlacement"]>,
  chainId: string
): { state: GameState } {
  const cause = pending.continuation ??
    ("rebirthCompletion" in pending ? pending.rebirthCompletion : undefined) ??
    ("postResolutionOracle" in pending
      ? pending.postResolutionOracle
      : undefined) ?? { chainId };
  restored = restorePendingSchedulingAfterRollback(restored, options.state);
  // 召喚step直前のsnapshotには公開中バーストが残るが、入力提示後には
  // 本体の解決後処理が済んでいる。巻き戻しで復活したカードにも同じ後処理を適用する。
  for (const burst of restored.revealedBurstStates) {
    if (
      options.state.revealedBurstStates.some(
        (current) => current.cardInstanceId === burst.cardInstanceId
      )
    )
      continue;
    restored = finalizeResolvedBurstCard({
      state: restored,
      actingPlayerId: burst.playerId,
      sourceInstanceId: burst.cardInstanceId,
      checkId: burst.checkId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;
  let currentState = createEffectResolutionScope(
    cause,
    battleEndAttackId
  ).finalize({
    state: restored,
    beforeState: restored,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ?? pending.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = resumePendingRetriggerContinuations({
    ...options,
    state: currentState,
  });
  currentState = finalizeBattleEndAfterPendingSnapshotRestore(
    currentState,
    options.state,
    battleEndAttackId,
    options
  );
  return {
    state: advanceAttackDeclarationStateIfReady(
      resumeStackCascadeIfReady(currentState, options),
      options
    ),
  };
}

/**
 * P3-48 follow-up: pendingCoreDistribution の player_choice 配分を中止する。
 *
 * `priorStateSnapshot` (pending 提示直前の state) で巻き戻す。
 * effect chain の `continuation` は呼ばれない (= 該当 effect の以降のステップは
 * 実行されない)。snapshot が無い (旧 state import 経由) 場合はエラー。
 *
 * abort 後の state は snapshot がそのまま入る (snapshot 自身は pendingCoreDistribution を
 * 持たないため、結果として pendingCoreDistribution は消える)。log に abort 痕跡を残す。
 */
export function applyAbortPendingCoreDistributionAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingCoreDistributionResult {
  const pending = options.state.pendingCoreDistribution;
  if (!pending) {
    throw new Error(
      "applyAbortPendingCoreDistributionAction: no pending core distribution to abort"
    );
  }
  if (!pending.priorStateSnapshot) {
    throw new Error(
      `applyAbortPendingCoreDistributionAction: pending ${pending.pendingId} has no priorStateSnapshot (旧 snapshot import 由来の可能性)`
    );
  }
  return finalizeAbortedCoreDistribution(
    options,
    pending,
    `effect:core_distribute:aborted:${pending.pendingId}:from=${pending.fromKind}:source=${pending.sourceDefinitionId}`
  );
}

export function applyPendingEnterFieldPlacementAction(
  options: ApplyLegalActionOptions
): ResolvePendingEnterFieldPlacementResult {
  const pending = options.state.pendingEnterFieldPlacement;
  if (!pending) {
    throw new Error("No pending enter-field placement to resolve");
  }
  if (options.action.kind !== "resolve_pending_enter_field_placement") {
    throw new Error("Expected resolve_pending_enter_field_placement action");
  }

  const placements = options.enterFieldCorePlacements ?? [];
  const sourceCard = getCardById(options.state, pending.sourceInstanceId);
  const sourceDefinition = options.getCardDefinitionById(
    pending.sourceDefinitionId
  );
  if (!sourceCard || !sourceDefinition) {
    throw new Error(
      `applyPendingEnterFieldPlacementAction: source missing ${pending.sourceInstanceId}`
    );
  }

  const basePolicy = getEnterFieldCorePlacementPolicy({
    card: sourceCard,
    definition: sourceDefinition,
  });
  // BSLH01-T13 型のトラッシュ配置 grant は pending 作成時で固定せず、
  // 実際に配置を選ぶ現在 state で再評価する。スタック窓の後に grant 自体が
  // 消えた場合は trash を選べず、残っていれば上限だけを policy へ合流する。
  const currentTrashGrant =
    pending.deferredStack?.actionKind === "summon"
      ? getSummonTrashCorePlacementGrant(
          options.state,
          pending.actingPlayerId,
          sourceDefinition
        )
      : null;
  // pending 生成時 (resolveDeferredStackAction) に確定した最小コアを正とする。
  // (直接合体=0 / スピリット状態=Lv1 / Lv1 を払えないスピリット状態ブレイヴ=0)。
  const policy = {
    ...basePolicy,
    minimumCoreCount: pending.minimumCoreCount,
    ...(currentTrashGrant
      ? { allowedTrashNormalCoreCount: currentTrashGrant.amount }
      : {}),
  };
  assertEnterFieldCorePlacementsAllowed(policy, placements);
  if (getPlacedCoreCount(placements) < policy.minimumCoreCount) {
    throw new Error(
      `Not enough enter-field cores selected: required=${policy.minimumCoreCount} selected=${getPlacedCoreCount(
        placements
      )}`
    );
  }

  if (pending.effectBraveCombineAsSummon) {
    const combine = pending.effectBraveCombineAsSummon;
    const resolution = createEffectResolutionScope(
      combine.continuation ?? combine,
      combine.continuation?.battleEndDeferralAttackId
    );
    const chainId = resolution.chainId;
    let currentState: GameState = {
      ...options.state,
      pendingEnterFieldPlacement: null,
      pendingStackCascade: null,
      log: [
        ...options.state.log,
        `play-card:enter-field-placement:resolved:${chainId}:${getPlacedCoreCount(
          placements
        )}`,
      ],
    };

    currentState = moveCardZone(
      currentState,
      combine.braveInstanceId,
      "field",
      getDefaultZoneRoleName(sourceDefinition, "field")
    );
    if (placements.length > 0) {
      currentState = applyEnterFieldCorePlacements({
        state: currentState,
        actingPlayerId: pending.actingPlayerId,
        destinationInstanceId: combine.braveInstanceId,
        placements,
        getCardDefinitionById: options.getCardDefinitionById,
      });
    }

    const braveCores =
      getCardById(currentState, combine.braveInstanceId)?.normalCoreCount ?? 0;
    const braveSoul = isSoulCoreOn(currentState, combine.braveInstanceId);
    currentState = executeBraveCombine(
      currentState,
      pending.actingPlayerId,
      combine.braveInstanceId,
      combine.hostInstanceId,
      options.getCardDefinitionById
    );
    const braveAfterCombine = getCardById(
      currentState,
      combine.braveInstanceId
    );
    const combineSucceeded =
      braveAfterCombine?.zone === "field" &&
      braveAfterCombine.attachedToInstanceId === combine.hostInstanceId;
    if (combineSucceeded) {
      currentState = recordSemanticTriggerEvent(currentState, {
        eventKind: "summon",
        relatedInstanceId: combine.braveInstanceId,
        fromZone: combine.fromZone,
      });
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `brave:combine:effect:${currentState.turnNumber}:${pending.actingPlayerId}:${combine.braveInstanceId}:${combine.hostInstanceId}:cores:${braveCores}${braveSoul ? "+soul" : ""}`,
          `effect:summon:${combine.braveInstanceId}:direct-combine:from=${combine.fromZone}:cost=0`,
        ],
      };
    }

    if (combine.continuation) {
      const combineStepResult: StepResult = {
        stepId: combine.stepResultId,
        affectedCardInstanceIds: combineSucceeded
          ? [combine.braveInstanceId]
          : [],
        succeeded: combineSucceeded,
        executed: combineSucceeded,
        ...(combine.chosenChoiceIndex !== undefined
          ? { chosenChoiceIndex: combine.chosenChoiceIndex }
          : {}),
      };
      const cont = {
        ...combine.continuation,
        stepContext: withSerializedStepResult(
          combine.continuation.stepContext,
          combineStepResult
        ),
      };
      const def = options.getCardDefinitionById(cont.sourceDefinitionId);
      const effect = resolveContinuationEffect(def, cont);
      if (!effect) {
        throw new Error(
          `applyPendingEnterFieldPlacementAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
        );
      }
      const combineResumeState =
        cont.targetedDisclosureContinuation !== undefined
          ? {
              ...currentState,
              pendingTargetedDisclosureContinuation:
                cont.targetedDisclosureContinuation,
            }
          : currentState;
      currentState = resolution.execute({
        state: combineResumeState,
        effect,
        effectIndex: cont.effectIndex,
        ...(cont.divineSkillIndex !== undefined
          ? { divineSkillIndex: cont.divineSkillIndex }
          : {}),
        ...(cont.isAccelData !== undefined
          ? { isAccelData: cont.isAccelData }
          : {}),
        ...(cont.isChangeData !== undefined
          ? { isChangeData: cont.isChangeData }
          : {}),
        sourceInstanceId: cont.sourceInstanceId,
        actingPlayerId: cont.actingPlayerId,
        ...(cont.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: cont.effectSourceInstanceId }
          : {}),
        ...(cont.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
          : {}),
        ...(cont.sourceCardReferenceInstanceId !== undefined
          ? {
              sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId,
            }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        startFromStepIndex: cont.resumeStepIndex,
        restoredStepContext: cont.stepContext,
        ...(cont.choiceIndex !== undefined
          ? { choiceIndex: cont.choiceIndex }
          : {}),
        ...(cont.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: cont.sourcePreventionLevel }
          : {}),
        ...(cont.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: cont.sourcePreventionBypass }
          : {}),
        ...(cont.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: cont.costPaidThisEffect }
          : {}),
        ...(cont.postResolutionOracle !== undefined
          ? { postResolutionOracle: cont.postResolutionOracle }
          : {}),
        ...(cont.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
          : {}),
      });
    }

    currentState = resolution.finalize({
      state: currentState,
      beforeState: combine.effectResolutionBeforeState,
      endLogs: [],
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      sourceColors: getPendingSourceColors({
        state: currentState,
        sourceInstanceId: combine.effectSourceInstanceId,
        sourceDefinitionId: combine.effectSourceDefinitionId,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
      causedBySourceInstanceId: combine.effectSourceInstanceId,
      enterFieldCausedByPlayerId: pending.actingPlayerId,
      sourceEffectIndex: combine.effectIndex,
      ...(combine.continuation?.battleEndDeferralAttackId !== undefined
        ? {
            battleEndDeferralAttackId:
              combine.continuation.battleEndDeferralAttackId,
          }
        : {}),
    });
    currentState = checkAndQueuePostResolutionOracleIfReady(
      currentState,
      combine.continuation?.postResolutionOracle ??
        pending.postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
    if (combine.continuation?.battleEndDeferralAttackId !== undefined) {
      currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
        currentState,
        options
      );
    }
    if (
      shouldDiscardRemainingStacksAfterBattleEnded(
        options.state,
        currentState,
        pending.remainingStacks
      )
    ) {
      return {
        state: resumeStackCascadeIfReady(
          { ...currentState, pendingStackCascade: null },
          options
        ),
      };
    }
    const afterCascade = resolveStackCascade(
      currentState,
      pending.remainingStacks,
      options
    );
    return {
      state: resumeStackCascadeIfReady(afterCascade, options),
    };
  }

  if (!pending.deferredStack) {
    throw new Error("No deferred stack for enter-field placement");
  }
  const resumedStack: ActiveStack = {
    ...pending.deferredStack,
    enterFieldCorePlacements: placements,
  };
  const remainingStacks = pending.remainingStacks;
  const stateWithoutPending: GameState = {
    ...options.state,
    pendingEnterFieldPlacement: null,
    pendingStackCascade: null,
    log: [
      ...options.state.log,
      `play-card:enter-field-placement:resolved:${resumedStack.chainId}:${getPlacedCoreCount(
        placements
      )}`,
    ],
  };
  const postResolutionOracle =
    pending.postResolutionOracle ?? pending.deferredStack.postResolutionOracle;
  const afterResumed = resolveDeferredStackAction(
    stateWithoutPending,
    resumedStack,
    options
  );
  const afterPostResolution = cleanupCompletedInUseMagicSourceIfReady({
    state: checkAndQueuePostResolutionOracleIfReady(
      afterResumed,
      postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    ),
    sourceInstanceId:
      postResolutionOracle?.triggerCardInstanceId ?? pending.sourceInstanceId,
    chainId: `enter-field-placement:${pending.pendingId}`,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (
    shouldDiscardRemainingStacksAfterBattleEnded(
      stateWithoutPending,
      afterPostResolution,
      remainingStacks
    )
  ) {
    return {
      state: { ...afterPostResolution, pendingStackCascade: null },
    };
  }
  return {
    state: resolveStackCascade(afterPostResolution, remainingStacks, options),
  };
}

/**
 * ブレイヴ召喚のスタック窓クローズ後の「合体する/スピリット状態」選択を解決する。
 * - `chosenHostInstanceId` 指定 → deferredStack に combineHostInstanceId を書き込み、合体で場入り。
 * - null → スピリット状態で場入り (combineHostInstanceId 未設定)。
 * いずれも `braveCombineChoiceResolved=true` にして解決を再開する。再開後は通常召喚と同じ
 * `pendingEnterFieldPlacement` (合体時 min 0 / スピリット時 Lv1) → 場入りへ続く。
 */
export function applyResolveBraveCombineChoiceAction(
  options: ApplyLegalActionOptions
): ResolveBraveCombineChoiceResult {
  if (options.action.kind !== "resolve_brave_combine_choice") {
    throw new Error("Expected resolve_brave_combine_choice action");
  }
  // 転醒内蔵 postRebirthChoice（pendingStoneFlipCombine）も同じ action kind を
  // 流用しているため、pendingId で分岐する。
  if (
    options.state.pendingStoneFlipCombine &&
    options.state.pendingStoneFlipCombine.pendingId === options.action.pendingId
  ) {
    return applyStoneFlipCombineAction(options);
  }
  const pending = options.state.pendingBraveCombineChoice;
  if (!pending) {
    throw new Error("No pending brave combine choice to resolve");
  }
  if (options.action.pendingId !== pending.pendingId) {
    throw new Error(
      `resolve_brave_combine_choice: pendingId mismatch: action=${options.action.pendingId} pending=${pending.pendingId}`
    );
  }
  const chosenHost = options.action.chosenHostInstanceId;
  // host 選択時は pending 生成時に算出した候補に含まれることを確認する
  // (候補は解決時点の生存ホストなので、不正な host への合体を防ぐ)。
  if (
    chosenHost !== null &&
    !pending.hostCandidateInstanceIds.includes(chosenHost)
  ) {
    throw new Error(
      `resolve_brave_combine_choice: invalid combine host ${chosenHost}`
    );
  }

  if (pending.multiPlacementPendingId) {
    const placement = options.state.pendingMultiPlacement;
    if (!placement || placement.pendingId !== pending.multiPlacementPendingId) {
      throw new Error("Brave choice has no matching field-entry placement");
    }
    if (chosenHost === null && !pending.spiritStateAffordable) {
      throw new Error("Not enough cores to summon brave in spirit state");
    }
    let state: GameState = {
      ...options.state,
      pendingBraveCombineChoice: null,
    };
    if (chosenHost !== null) {
      state = executeBraveCombine(
        state,
        pending.actingPlayerId,
        pending.braveInstanceId,
        chosenHost,
        options.getCardDefinitionById
      );
      if (
        getCardById(state, pending.braveInstanceId)?.attachedToInstanceId !==
        chosenHost
      ) {
        throw new Error(
          "Effect-summoned brave could not combine with selected host"
        );
      }
    }
    const host =
      chosenHost === null ? undefined : getCardById(state, chosenHost);
    const hostDefinition =
      host && options.getCardDefinitionById(host.definitionId);
    const skipsCorePlacement =
      hostDefinition !== undefined &&
      (hasIndependentCoreManagement(hostDefinition) ||
        hasEnterFieldOnlyCorePlacementRestriction(hostDefinition));
    const completedTarget = skipsCorePlacement
      ? placement.targets.find(
          (target) => target.instanceId === pending.braveInstanceId
        )
      : undefined;
    const enterFieldLog = completedTarget
      ? getMultiPlacementEnterFieldEventLogEntry(
          state,
          placement,
          completedTarget
        )
      : null;
    state = {
      ...state,
      pendingMultiPlacement: {
        ...placement,
        resolvedBraveCombineInstanceIds: [
          ...(placement.resolvedBraveCombineInstanceIds ?? []),
          pending.braveInstanceId,
        ],
        ...(completedTarget
          ? {
              completedTargets: [
                ...(placement.completedTargets ?? []),
                completedTarget,
              ],
            }
          : {}),
        targets: skipsCorePlacement
          ? placement.targets.filter(
              (target) => target.instanceId !== pending.braveInstanceId
            )
          : chosenHost === null
            ? placement.targets
            : placement.targets.map((target) =>
                target.instanceId === pending.braveInstanceId
                  ? {
                      ...target,
                      minimumCoreCount: 0,
                    }
                  : target
              ),
      },
      log: [
        ...state.log,
        `brave:combine-choice:resolved:${pending.pendingId}:${chosenHost ?? "spirit-state"}`,
        ...(enterFieldLog === null ? [] : [enterFieldLog]),
      ],
    };
    state = openEntryBraveCombineChoice(state, options.getCardDefinitionById);
    if (
      !state.pendingBraveCombineChoice &&
      state.pendingMultiPlacement?.targets.length === 0
    ) {
      return applyPendingMultiPlacementAction({
        ...options,
        state,
        multiPlacementAllocations: [],
      });
    }
    return { state };
  }

  if (pending.effectSummon) {
    const battleEndAttackId =
      pending.battleEndDeferralAttackId ??
      pending.effectSummon.continuation?.battleEndDeferralAttackId;
    const resolution = createEffectResolutionScope(
      pending.effectSummon.continuation ?? {
        chainId: `effect-brave-combine-choice:${pending.pendingId}`,
      },
      battleEndAttackId
    );
    let resolvedState: GameState = {
      ...options.state,
      pendingBraveCombineChoice: null,
      log: [
        ...options.state.log,
        `brave:combine-choice:resolved:${pending.pendingId}:${chosenHost ?? "spirit-state"}`,
      ],
    };

    if (chosenHost !== null) {
      const braveId = pending.braveInstanceId;
      const braveCard = getCardById(resolvedState, braveId);
      const hostCard = getCardById(resolvedState, chosenHost);
      const braveCores = braveCard?.normalCoreCount ?? 0;
      const braveSoul = braveCard
        ? isSoulCoreOn(resolvedState, braveId)
        : false;
      const combinedExhausted =
        braveCard?.exhaustState !== undefined &&
        braveCard.exhaustState !== "recovered"
          ? true
          : hostCard?.exhaustState !== undefined &&
            hostCard.exhaustState !== "recovered";

      const afterCoreTransfer = moveBraveCombineCoresToHost(
        resolvedState,
        pending.actingPlayerId,
        braveId,
        chosenHost,
        options.getCardDefinitionById
      );
      if (afterCoreTransfer === null) {
        return {
          state: {
            ...resolvedState,
            log: [
              ...resolvedState.log,
              `brave:combine-effect-summon:blocked-core-transfer:${pending.actingPlayerId}:${braveId}:${chosenHost}:cores:${braveCores}${braveSoul ? "+soul" : ""}`,
            ],
          },
        };
      }
      resolvedState = afterCoreTransfer;
      resolvedState = updateCard(resolvedState, braveId, (c) => ({
        ...c,
        attachedToInstanceId: chosenHost,
      }));
      resolvedState = updateCard(resolvedState, chosenHost, (c) => ({
        ...c,
        attachedChildrenIds: c.attachedChildrenIds.includes(braveId)
          ? c.attachedChildrenIds
          : [...c.attachedChildrenIds, braveId],
        exhaustState: combinedExhausted ? "exhausted" : c.exhaustState,
      }));
      resolvedState = recordSemanticTriggerEvent(resolvedState, {
        eventKind: "brave_combined",
        relatedInstanceId: braveId,
        triggerRelatedCombinedHostInstanceId: chosenHost,
      });
      resolvedState = {
        ...resolvedState,
        log: [
          ...resolvedState.log,
          `brave:combine-effect-summon:${resolvedState.turnNumber}:${pending.actingPlayerId}:${braveId}:${chosenHost}:cores:${braveCores}${braveSoul ? "+soul" : ""}`,
        ],
      };
      resolvedState = rebuildContinuousAndApplyStateBasedActions(
        resolvedState,
        options.getCardDefinitionById
      );
    } else {
      // 効果召喚したブレイヴをスピリット状態で残す場合も、通常召喚と同様に
      // 合体選択の後で維持コアを配置する。ここで finalize/SBA へ進むと、0 コアの
      // ブレイヴが配置選択前に消滅し、元効果の continuation も失われる。
      const brave = getCardById(resolvedState, pending.braveInstanceId);
      const braveDef = brave
        ? options.getCardDefinitionById(brave.definitionId)
        : undefined;
      if (!brave || !braveDef || brave.zone !== "field") {
        throw new Error(
          `applyResolveBraveCombineChoiceAction: effect-summoned brave missing: ${pending.braveInstanceId}`
        );
      }
      const policy = getEnterFieldCorePlacementPolicy({
        card: brave,
        definition: braveDef,
      });
      if (policy.maximumCoreCount !== 0) {
        const existingCoreCount = getTotalCoresOnCardById(
          resolvedState,
          brave.instanceId
        );
        const continuation = pending.effectSummon.continuation;
        const pendingId = nextPendingSelectionId("mp");
        return {
          state: {
            ...resolvedState,
            pendingMultiPlacement: {
              pendingId,
              actingPlayerId: pending.actingPlayerId,
              sourceInstanceId: pending.effectSummon.sourceInstanceId,
              sourceDefinitionId: pending.effectSummon.sourceDefinitionId,
              targets: [
                {
                  instanceId: brave.instanceId,
                  definitionId: brave.definitionId,
                  minimumCoreCount: Math.max(
                    0,
                    policy.minimumCoreCount - existingCoreCount
                  ),
                  maximumCoreCount:
                    policy.maximumCoreCount === null
                      ? null
                      : Math.max(
                          0,
                          policy.maximumCoreCount - existingCoreCount
                        ),
                  enterFieldEventKind: "summon",
                },
              ],
              effectTiming: { kind: "activated", mode: "main" },
              ...(continuation !== undefined ? { continuation } : {}),
              ...(continuation !== undefined &&
              continuation.divineSkillIndex === undefined &&
              continuation.isAccelData !== true &&
              continuation.isChangeData !== true
                ? { sourceEffectIndex: continuation.effectIndex }
                : {}),
              ...(battleEndAttackId !== undefined
                ? { battleEndDeferralAttackId: battleEndAttackId }
                : {}),
              priorStateSnapshot: pending.effectSummon.triggerBeforeState,
            },
            log: [
              ...resolvedState.log,
              `effect:brave-combine-spirit-placement:pending:${pendingId}:${brave.instanceId}`,
            ],
          },
        };
      }
    }

    // ENGINE-brave-combine-multistep-continuation: 同一 effect 内に後続 summon step が
    // ある場合 (BSTH01-X02 等)、finalize 前に executeEffect を再開して残り step を実行する
    // (pendingMultiPlacement と同型パターン)。
    const effectSummonContinuation = pending.effectSummon.continuation;
    if (effectSummonContinuation) {
      const cont = effectSummonContinuation;
      const def = options.getCardDefinitionById(cont.sourceDefinitionId);
      const effect = resolveContinuationEffect(def, cont);
      if (!effect) {
        throw new Error(
          `applyResolveBraveCombineChoiceAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
        );
      }
      resolvedState = resolution.execute({
        state: resolvedState,
        effect,
        effectIndex: cont.effectIndex,
        ...(cont.divineSkillIndex !== undefined
          ? { divineSkillIndex: cont.divineSkillIndex }
          : {}),
        ...(cont.isAccelData !== undefined
          ? { isAccelData: cont.isAccelData }
          : {}),
        ...(cont.isChangeData !== undefined
          ? { isChangeData: cont.isChangeData }
          : {}),
        sourceInstanceId: cont.sourceInstanceId,
        actingPlayerId: cont.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        startFromStepIndex: cont.resumeStepIndex,
        restoredStepContext: cont.stepContext,
        ...(cont.choiceIndex !== undefined
          ? { choiceIndex: cont.choiceIndex }
          : {}),
        ...(cont.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: cont.sourcePreventionLevel }
          : {}),
        ...(cont.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: cont.sourcePreventionBypass }
          : {}),
        ...(cont.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: cont.costPaidThisEffect }
          : {}),
        ...(cont.postResolutionOracle !== undefined
          ? { postResolutionOracle: cont.postResolutionOracle }
          : {}),
        ...(battleEndAttackId !== undefined
          ? { battleEndDeferralAttackId: battleEndAttackId }
          : {}),
      });
    }

    resolvedState = resolution.finalize({
      state: resolvedState,
      beforeState: pending.effectSummon.triggerBeforeState,
      endLogs: [],
      actingPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      causedBySourceInstanceId: pending.effectSummon.sourceInstanceId,
      enterFieldCausedByPlayerId: pending.actingPlayerId,
      ...(battleEndAttackId !== undefined
        ? { battleEndDeferralAttackId: battleEndAttackId }
        : {}),
    });

    let finalState = checkAndQueuePostResolutionOracleIfReady(
      resolvedState,
      pending.postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
    if (battleEndAttackId !== undefined) {
      finalState = maybeFinalizeBattleEndScopeAfterPendingDrain(
        finalState,
        options
      );
    }
    return {
      state: finalState,
    };
  }

  if (!pending.deferredStack) {
    throw new Error("No deferred stack for brave combine choice");
  }

  const resumedStack: ActiveStack = {
    ...pending.deferredStack,
    braveCombineChoiceResolved: true,
    ...(chosenHost !== null ? { combineHostInstanceId: chosenHost } : {}),
  };
  const remainingStacks = pending.remainingStacks ?? [];
  const stateWithoutPending: GameState = {
    ...options.state,
    pendingBraveCombineChoice: null,
    log: [
      ...options.state.log,
      `brave:combine-choice:resolved:${resumedStack.chainId}:${chosenHost ?? "spirit-state"}`,
    ],
  };
  const postResolutionOracle =
    pending.postResolutionOracle ?? pending.deferredStack.postResolutionOracle;
  const afterResumed = resolveDeferredStackAction(
    stateWithoutPending,
    resumedStack,
    options
  );
  if (
    shouldDiscardRemainingStacksAfterBattleEnded(
      stateWithoutPending,
      afterResumed,
      remainingStacks
    )
  ) {
    return {
      state: checkAndQueuePostResolutionOracleIfReady(
        { ...afterResumed, pendingStackCascade: null },
        postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      ),
    };
  }
  const afterCascade = resolveStackCascade(
    afterResumed,
    remainingStacks,
    options
  );
  return {
    state: checkAndQueuePostResolutionOracleIfReady(
      afterCascade,
      postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    ),
  };
}

/**
 * 転召（召喚手順内ステップ）の強制コア消費を解決する。
 * 選んだ対象1体の上のコアすべてを送り先（ボイド等）へ移し、tenshoResolved=true で
 * 召喚解決（維持コア配置→場入り）を再開する。コストは召喚宣言時に支払い済み。
 * ルール正源: 10_rules/07b 転召節 + 02:188。
 */
export function applyResolveTenshoSummonAction(
  options: ApplyLegalActionOptions
): ResolveTenshoSummonResult {
  if (options.action.kind !== "resolve_tensho_summon") {
    throw new Error("Expected resolve_tensho_summon action");
  }
  const pending = options.state.pendingTenshoSummon;
  if (!pending) {
    throw new Error("No pending tensho summon to resolve");
  }
  const chosen = options.action.chosenTargetInstanceId;
  if (!pending.targetCandidateInstanceIds.includes(chosen)) {
    throw new Error(`resolve_tensho_summon: invalid target ${chosen}`);
  }

  // 強制コア消費: 対象1体の上の通常コアすべてを送り先へ。
  const targetCard = getCardById(options.state, chosen);
  const amount = targetCard?.normalCoreCount ?? 0;
  let afterConsume: GameState = options.state;
  if (amount > 0) {
    afterConsume = executeCoreMove(
      options.state,
      pending.actingPlayerId,
      { kind: "card_instance", instanceId: chosen },
      { kind: pending.destination, player: "self" },
      amount,
      pending.summoningInstanceId,
      undefined,
      undefined,
      options.getCardDefinitionById
    );
  }

  const resumedStack: ActiveStack = {
    ...pending.deferredStack,
    tenshoResolved: true,
  };
  const remainingStacks = pending.remainingStacks;
  const stateWithoutPending: GameState = {
    ...afterConsume,
    pendingTenshoSummon: null,
    log: [
      ...afterConsume.log,
      `tensho:resolved:${resumedStack.chainId}:target=${chosen}:cores=${amount}->${pending.destination}`,
    ],
  };
  const afterResumed = resolveDeferredStackAction(
    stateWithoutPending,
    resumedStack,
    options
  );
  if (
    shouldDiscardRemainingStacksAfterBattleEnded(
      stateWithoutPending,
      afterResumed,
      remainingStacks
    )
  ) {
    return { state: { ...afterResumed, pendingStackCascade: null } };
  }
  return {
    state: resolveStackCascade(afterResumed, remainingStacks, options),
  };
}

/**
 * 逆転醒 pattern2（裏返して配置/召喚）の解決（P3-98 / 08a §逆転醒）。
 *
 * 場の B 面を表面 def の新 instance として再評価する: コア→リザーブ → 新 instance 化 →
 * コスト支払い（プレイヤー選択 `summonPaymentSources`、無ければ reserve auto-pay）→
 * 維持コア配置（`summonEnterFieldCorePlacements` で選んだ分のみ）。
 * count は不変。通常召喚/配置相当だが離脱イベントは生成しない。
 * （battle entity 再計算は対象が nexus 中心のため本経路では省略。spirit の mid-battle 逆転醒が
 *  必要になった時点で追加する。）
 */
export function applyResolveReverseRebirthSummonAction(
  options: ApplyLegalActionOptions
): ResolveTenshoSummonResult {
  if (options.action.kind !== "resolve_reverse_rebirth_summon") {
    throw new Error("Expected resolve_reverse_rebirth_summon action");
  }
  const pending = options.state.pendingReverseRebirthSummon;
  if (!pending) {
    throw new Error("No pending reverse rebirth summon to resolve");
  }
  const resolution = createEffectResolutionScope(
    pending.continuation ?? { chainId: `reverse-rebirth:${pending.pendingId}` }
  );

  const clearPending = (s: GameState): GameState => ({
    ...s,
    pendingReverseRebirthSummon: null,
  });

  const card = getCardById(options.state, pending.sourceInstanceId);
  const frontDef = options.getCardDefinitionById(pending.frontDefinitionId);
  if (!card || card.zone !== "field" || !frontDef) {
    // 対象消失/定義欠落 → 中断（pending クリアのみ）。
    return {
      state: resolveStackCascade(
        clearPending(options.state),
        pending.remainingStacks,
        options
      ),
    };
  }

  const minCores = pending.minimumCoreCount;
  const costToPay = pending.costToPay;
  const paymentSources = options.summonPaymentSources;
  const placements = options.summonEnterFieldCorePlacements;
  const hostExhaustStateBeforeReplacement = card.exhaustState;
  // 根幻回帰の B 面はスピリットになっているためブレイヴを合体できる。pattern2 は
  // 新しい A 面 instance を作るが、08a の「離脱の置換」は合体ブレイヴの 05:99-111 の
  // 選択を消さない。先に旧 host に結び付いたブレイヴをスナップショットする。
  const attachedBraveInstanceIds = card.attachedChildrenIds.filter((id) => {
    const attached = getCardById(options.state, id);
    return (
      attached?.attachedToInstanceId === pending.sourceInstanceId &&
      options.getCardDefinitionById(attached.definitionId)?.printedCategory ===
        "brave"
    );
  });

  let next = reverseRebirthSummonSourceReturnedState(options.state, pending);

  // 2. 表面 def の新 instance として再評価。normalCoreCount は手順1で 0 化済み。
  // 「相手の効果でフィールドを離れるとき、裏返して配置できる」型の逆転醒は、
  // 同じ離脱待機を置換してフィールドに残る。旧 instanceId を新規 summon instance に
  // 変えるだけでは pendingLeaveEntities が旧 ID を参照し続け、finalizeEffectResolution
  // 後の flush で Unknown card instance になる。前方転醒の executeRebirth と同じく、
  // このカード自身の離脱待機をここで解除する（08a §2 の離脱誘発転醒置換）。
  const pendingLeaveReplacementChainIds = new Set(
    next.pendingLeaveEntities
      .filter(
        (pendingLeave) => pendingLeave.instanceId === pending.sourceInstanceId
      )
      .map((pendingLeave) => pendingLeave.chainId)
  );
  const replacedPendingLeave = next.pendingLeaveEntities.find(
    (pendingLeave) => pendingLeave.instanceId === pending.sourceInstanceId
  );
  const replacesPendingLeave = pendingLeaveReplacementChainIds.size > 0;
  // pattern2 は実移動を伴わない離脱置換なので、待機入りから派生した反応キューも
  // 成立しない。remove_from_game を含む leave event の列挙ではなく、既存の pending
  // leave 遷移と同じ「旧 instanceId + PendingLeaveEntity.chainId」で紐付ける。これにより
  // 同じ旧 instance に対する別チェーンの非離脱イベントは維持される。
  const isPendingLeaveReplacementReaction = (reaction: {
    chainId: string | null;
    relatedInstanceId?: string | null;
  }) =>
    replacesPendingLeave &&
    reaction.relatedInstanceId === pending.sourceInstanceId &&
    reaction.chainId !== null &&
    pendingLeaveReplacementChainIds.has(reaction.chainId);
  const newInstanceId = `${pending.sourceInstanceId}:reverse-rebirth:${pending.pendingId}`;
  const zoneRoleName =
    frontDef.printedCategory === "spirit"
      ? "spirit"
      : frontDef.printedCategory === "ultimate"
        ? "ultimate"
        : frontDef.printedCategory === "nexus"
          ? "nexus"
          : frontDef.printedCategory === "brave"
            ? "brave"
            : "spirit";
  next = replaceCardInstances(
    {
      ...next,
      activeContinuousEffects: next.activeContinuousEffects.filter(
        (ce) => ce.sourceInstanceId !== pending.sourceInstanceId
      ),
      effectUsageRecords: next.effectUsageRecords.filter(
        (record) => record.sourceInstanceId !== pending.sourceInstanceId
      ),
      pendingLeaveEntities: next.pendingLeaveEntities.filter(
        (pendingLeave) => pendingLeave.instanceId !== pending.sourceInstanceId
      ),
      // 実移動が起きない置換なので、待機入り時に積まれた通常/遅延誘発、非公開
      // 宣言、バースト発動確認も撤回する。SBA の pending-leave 遷移と同じ境界を使う。
      pendingTriggeredEffects: replacesPendingLeave
        ? next.pendingTriggeredEffects.filter(
            (pendingEffect) => !isPendingLeaveReplacementReaction(pendingEffect)
          )
        : next.pendingTriggeredEffects,
      pendingDeferredTriggeredEffects: replacesPendingLeave
        ? next.pendingDeferredTriggeredEffects.filter(
            (pendingEffect) => !isPendingLeaveReplacementReaction(pendingEffect)
          )
        : next.pendingDeferredTriggeredEffects,
      pendingPrivateDeclarations: replacesPendingLeave
        ? next.pendingPrivateDeclarations.filter(
            (declaration) => !isPendingLeaveReplacementReaction(declaration)
          )
        : next.pendingPrivateDeclarations,
      pendingBurstChecks: replacesPendingLeave
        ? next.pendingBurstChecks.filter(
            (burstCheck) => !isPendingLeaveReplacementReaction(burstCheck)
          )
        : next.pendingBurstChecks,
      ...(replacesPendingLeave &&
      attachedBraveInstanceIds.length > 0 &&
      next.pendingBraveLeaveChoice === null
        ? {
            pendingBraveLeaveChoice: {
              choosingPlayerId: card.controllerPlayerId,
              hostInstanceId: newInstanceId,
              braveInstanceIds: attachedBraveInstanceIds,
              hostExhaustState: hostExhaustStateBeforeReplacement,
              // replacesPendingLeave は sourceInstanceId を含む pending leave が
              // 見つかったことから導出しているため、ここでは必ず存在する。
              leaveKind: replacedPendingLeave!.kind,
              leaveCause: replacedPendingLeave!.cause,
              ...(replacedPendingLeave!.leaveDestination
                ? {
                    leaveDestination: replacedPendingLeave!.leaveDestination,
                  }
                : {}),
            },
          }
        : {}),
      log: [
        ...next.log,
        `reverse_rebirth:resolve:${pending.sourceInstanceId}:new=${newInstanceId}:to=${pending.frontDefinitionId}:cost=${costToPay}:cores=${minCores}`,
        ...(replacesPendingLeave
          ? [`reverse_rebirth:stay-on-field:${pending.sourceInstanceId}`]
          : []),
        ...(replacesPendingLeave && attachedBraveInstanceIds.length > 0
          ? [
              `reverse_rebirth:brave-leave-choice:${newInstanceId}:braves:${attachedBraveInstanceIds.join(",")}`,
            ]
          : []),
      ],
    },
    next.cardInstances.map((c) =>
      c.instanceId === pending.sourceInstanceId
        ? {
            ...c,
            instanceId: newInstanceId,
            definitionId: pending.frontDefinitionId,
            originalDefinitionId: pending.frontDefinitionId,
            zoneRoleName,
            normalCoreCount: 0,
            minimumRequiredCores: minCores,
            exhaustState: "recovered" as const,
            pendingLeaveKind: null,
            pendingLeaveCause: null,
            pendingLeaveChainId: null,
            deferZoneMoveUntilChainEnd: false,
            attachedToInstanceId: null,
            // 直後に pendingBraveLeaveChoice を提示する間だけ、新 instance を host
            // として維持する。keep / send_with_host の既存 SSOT がリンクを解除する。
            attachedChildrenIds: attachedBraveInstanceIds,
            pendingLeaveLvSnapshot: null,
            underCards: [],
            divineTransformState: null,
            faceDown: false,
          }
        : attachedBraveInstanceIds.includes(c.instanceId) &&
            c.attachedToInstanceId === pending.sourceInstanceId
          ? { ...c, attachedToInstanceId: newInstanceId }
          : c
    )
  );

  // 離脱置換の有無にかかわらず、B 面から A 面へ変換した時点で合体条件を失う
  // ブレイヴは「変換前 host から分離する」。通常変換には leave-choice がないため、
  // 実際に SBA 分離される child だけへ旧 host の疲労 snapshot を渡す。
  if (!replacesPendingLeave && attachedBraveInstanceIds.length > 0) {
    const forcedSeparationBraveIds = collectStateBasedActions(
      next,
      options.getCardDefinitionById
    )
      .filter(
        (check) =>
          check.kind === "brave_forced_separation" &&
          attachedBraveInstanceIds.includes(check.instanceId)
      )
      .map((check) => check.instanceId);
    if (forcedSeparationBraveIds.length > 0) {
      next = {
        ...next,
        reverseRebirthBraveSeparationExhaustSnapshots: {
          ...next.reverseRebirthBraveSeparationExhaustSnapshots,
          ...Object.fromEntries(
            forcedSeparationBraveIds.map((braveId) => [
              braveId,
              hostExhaustStateBeforeReplacement,
            ])
          ),
        },
      };
    }
  }

  // 3. コスト支払い: プレイヤー選択ソースがあれば applyCardCostPayments、無ければ reserve auto-pay。
  if (costToPay > 0) {
    if (paymentSources !== undefined && paymentSources.length > 0) {
      const total = getTotalPaymentAmount(paymentSources);
      if (total !== costToPay) {
        throw new Error(
          `reverse_rebirth payment mismatch: expected=${costToPay} got=${total}`
        );
      }
      next = applyCardCostPayments({
        state: next,
        actingPlayerId: pending.actingPlayerId,
        chainId:
          pending.continuation?.chainId ??
          `reverse-rebirth:${pending.pendingId}`,
        paymentSources,
        getCardDefinitionById: options.getCardDefinitionById,
      });
    } else {
      next = moveNormalCores(
        next,
        { kind: "reserve", playerId: pending.actingPlayerId },
        { kind: "trash", playerId: pending.actingPlayerId },
        costToPay
      );
    }
  }

  // 4. 維持コア配置: 未入力を自動補完せず、共通ポリシーで選択内容を検証する。
  {
    const newCard = getCardById(next, newInstanceId);
    if (!newCard) {
      throw new Error(
        `reverse_rebirth placement target missing: ${newInstanceId}`
      );
    }
    const policy = getEnterFieldCorePlacementPolicy({
      card: newCard,
      definition: frontDef,
    });
    const selectedPlacements = placements ?? [];
    assertEnterFieldCorePlacementsAllowed(policy, selectedPlacements);
    if (getPlacedCoreCount(selectedPlacements) < policy.minimumCoreCount) {
      throw new Error(
        `reverse_rebirth placement below minimum: required=${policy.minimumCoreCount} got=${getPlacedCoreCount(selectedPlacements)}`
      );
    }
    next = applyEnterFieldCorePlacements({
      state: next,
      actingPlayerId: pending.actingPlayerId,
      destinationInstanceId: newInstanceId,
      placements: selectedPlacements,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  const newCardAfterPlacement = getCardById(next, newInstanceId);
  if (!newCardAfterPlacement) {
    throw new Error(
      `reverse_rebirth finalized target missing: ${newInstanceId}`
    );
  }
  const beforeFinalize: GameState = replaceCardInstances(
    {
      ...next,
      pendingReverseRebirthSummon: null,
    },
    [
      ...next.cardInstances.filter((c) => c.instanceId !== newInstanceId),
      {
        ...newCardAfterPlacement,
        zone: "set_aside",
        normalCoreCount: 0,
      },
    ]
  );
  let resolvedState = appendPublicDisclosuresForStateTransition({
    before: options.state,
    after: clearPending(next),
    actorPlayerId: pending.actingPlayerId,
    action: {
      kind: frontDef.printedCategory === "nexus" ? "place_nexus" : "summon",
      cardInstanceId: newInstanceId,
    },
  });
  // Deferred reverse-rebirth is an effect resolution in its own right.  Its final
  // state delta (including SBA) must use the post-replacement effect source rather
  // than the B-face instance which has just been removed.
  let finalizationSourceInstanceId = newInstanceId;
  if (pending.continuation) {
    const continuationSourceInstanceId =
      pending.continuation.sourceInstanceId === pending.sourceInstanceId
        ? newInstanceId
        : pending.continuation.sourceInstanceId;
    const continuationEffectSourceInstanceId =
      pending.continuation.effectSourceInstanceId === pending.sourceInstanceId
        ? newInstanceId
        : pending.continuation.effectSourceInstanceId;
    const continuationSourceCardReferenceInstanceId =
      pending.continuation.sourceCardReferenceInstanceId ===
      pending.sourceInstanceId
        ? newInstanceId
        : pending.continuation.sourceCardReferenceInstanceId;
    const cont = {
      ...pending.continuation,
      // pattern2 は B 面を新しい A 面 instance に置換する。B 面を指していた source /
      // effectSource / source_card 参照だけを差し替え、継承・付与元として別カードを
      // 指していた参照はそのまま保持する。
      sourceInstanceId: continuationSourceInstanceId,
      ...(continuationEffectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: continuationEffectSourceInstanceId }
        : {}),
      ...(continuationSourceCardReferenceInstanceId !== undefined
        ? {
            sourceCardReferenceInstanceId:
              continuationSourceCardReferenceInstanceId,
          }
        : {}),
      stepContext: withSerializedStepResult(pending.continuation.stepContext, {
        stepId: pending.continuation.stepResultId,
        affectedCardInstanceIds: [newInstanceId],
        succeeded: true,
        executed: true,
        ...(pending.continuation.choiceIndex !== undefined
          ? { chosenChoiceIndex: pending.continuation.choiceIndex }
          : {}),
      }),
    };
    finalizationSourceInstanceId =
      cont.effectSourceInstanceId ?? cont.sourceInstanceId;
    const def = options.getCardDefinitionById(cont.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, cont);
    if (!effect) {
      throw new Error(
        `applyResolveReverseRebirthSummonAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
      );
    }
    resolvedState = resolution.execute({
      state: resolvedState,
      effect,
      effectIndex: cont.effectIndex,
      ...(cont.divineSkillIndex !== undefined
        ? { divineSkillIndex: cont.divineSkillIndex }
        : {}),
      ...(cont.isAccelData !== undefined
        ? { isAccelData: cont.isAccelData }
        : {}),
      ...(cont.isChangeData !== undefined
        ? { isChangeData: cont.isChangeData }
        : {}),
      sourceInstanceId: cont.sourceInstanceId,
      actingPlayerId: cont.actingPlayerId,
      ...(cont.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: cont.effectSourceInstanceId }
        : {}),
      ...(cont.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
        : {}),
      ...(cont.sourceCardReferenceInstanceId !== undefined
        ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext: cont.stepContext,
      ...(cont.effectActionKind !== undefined
        ? { effectActionKind: cont.effectActionKind }
        : {}),
      ...(cont.choiceIndex !== undefined
        ? { choiceIndex: cont.choiceIndex }
        : {}),
      ...(cont.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: cont.sourcePreventionLevel }
        : {}),
      ...(cont.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: cont.sourcePreventionBypass }
        : {}),
      ...(cont.costPaidThisEffect !== undefined
        ? { costPaidThisEffect: cont.costPaidThisEffect }
        : {}),
      ...(cont.postResolutionOracle !== undefined
        ? { postResolutionOracle: cont.postResolutionOracle }
        : {}),
      ...(cont.battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
        : {}),
    });
  }
  const finalized = resolution.finalize({
    state: resolvedState,
    beforeState: beforeFinalize,
    endLogs: [],
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: beforeFinalize,
      sourceInstanceId: finalizationSourceInstanceId,
      sourceDefinitionId: pending.frontDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId: finalizationSourceInstanceId,
  });
  if (
    shouldDiscardRemainingStacksAfterBattleEnded(
      beforeFinalize,
      finalized,
      pending.remainingStacks
    )
  ) {
    return { state: { ...finalized, pendingStackCascade: null } };
  }
  const hasPendingReactions =
    finalized.pendingPrivateDeclarations.length > 0 ||
    finalized.pendingTriggeredEffects.length > 0 ||
    finalized.pendingBurstChecks.length > 0;
  if (hasPendingReactions && pending.remainingStacks.length > 0) {
    return {
      state: {
        ...finalized,
        pendingStackCascade: {
          remainingStacks: [...pending.remainingStacks],
          waitForTriggeredEffects: true,
        },
      },
    };
  }

  return {
    state: resolveStackCascade(finalized, pending.remainingStacks, options),
  };
}

function getMultiPlacementEnterFieldEventLogEntry(
  state: GameState,
  pending: PendingMultiPlacement,
  target: PendingMultiPlacement["targets"][number]
): string | null {
  if (target.enterFieldEventKind === null) return null;
  const card = state.cardInstances.find(
    (instance) => instance.instanceId === target.instanceId
  );
  const relation =
    card?.controllerPlayerId === pending.actingPlayerId ? "self" : "other";
  const scopeSuffix =
    target.effectScope !== undefined ? `:scope=${target.effectScope}` : "";
  switch (target.enterFieldEventKind ?? "summon") {
    case "place":
      return `effect:field_place:multi_placement:${pending.actingPlayerId}:${target.instanceId}${scopeSuffix}`;
    case "put":
      return `effect:field_put:multi_placement:${pending.actingPlayerId}:${target.instanceId}${scopeSuffix}`;
    case "summon":
      return `effect:summon:${target.instanceId}:${relation}:multi-placement${scopeSuffix}`;
  }
}

/**
 * P3-49 placement_multi: 複数体同時召喚の per-target 配置を解決する。
 *
 * 検証:
 * - 各 placement entry の destinationInstanceId は pending.targets のいずれか
 * - 同一 destination は 1 entry のみ
 * - 各 target の minimumCoreCount を満たす (placements 未指定の target は min=0 必須)
 * - 各 target の maximumCoreCount を超えない (policy 検証経由)
 *
 * 完了後 continuation があれば executeEffect を resume する。
 */
export function applyPendingMultiPlacementAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingMultiPlacementResult {
  const pending = options.state.pendingMultiPlacement;
  if (!pending) {
    throw new Error("No pending multi placement to resolve");
  }
  const battleEndAttackId =
    pending.battleEndDeferralAttackId ??
    pending.continuation?.battleEndDeferralAttackId;
  const resolution = createEffectResolutionScope(
    pending.continuation ?? { chainId: `multi-placement:${pending.pendingId}` },
    battleEndAttackId
  );
  const chainId = resolution.chainId;

  const allocations = options.multiPlacementAllocations ?? [];
  const targetById = new Map(pending.targets.map((t) => [t.instanceId, t]));
  const seenDestinations = new Set<string>();
  let totalTrashNormalAmount = 0;
  let totalTrashSoulAmount = 0;

  // 検証
  for (const entry of allocations) {
    if (seenDestinations.has(entry.destinationInstanceId)) {
      throw new Error(
        `applyPendingMultiPlacementAction: duplicate destination ${entry.destinationInstanceId}`
      );
    }
    seenDestinations.add(entry.destinationInstanceId);
    const target = targetById.get(entry.destinationInstanceId);
    if (!target) {
      throw new Error(
        `applyPendingMultiPlacementAction: destination ${entry.destinationInstanceId} not in pending.targets`
      );
    }
    for (const placement of entry.placements) {
      if (
        (placement.kind === "card_normal" || placement.kind === "card_soul") &&
        (targetById.has(placement.instanceId) ||
          pending.excludedFieldSourceIds?.includes(placement.instanceId))
      ) {
        throw new Error(
          `applyPendingMultiPlacementAction: pending target ${placement.instanceId} cannot be used as placement source`
        );
      }
    }
    const voidNormalAmount = entry.placements.reduce(
      (sum, placement) =>
        placement.kind === "void_normal" ? sum + placement.amount : sum,
      0
    );
    totalTrashNormalAmount += entry.placements.reduce(
      (sum, placement) =>
        placement.kind === "trash_normal" ? sum + placement.amount : sum,
      0
    );
    totalTrashSoulAmount += entry.placements.reduce(
      (sum, placement) => (placement.kind === "trash_soul" ? sum + 1 : sum),
      0
    );
    if (voidNormalAmount > (target.voidNormalCoreMax ?? 0)) {
      throw new Error(
        `applyPendingMultiPlacementAction: ${target.instanceId} exceeds void normal core max: max=${target.voidNormalCoreMax ?? 0} got=${voidNormalAmount}`
      );
    }
    const card = options.state.cardInstances.find(
      (c) => c.instanceId === target.instanceId
    );
    const def = card
      ? options.getCardDefinitionById(card.definitionId)
      : undefined;
    if (!card || !def) {
      throw new Error(
        `applyPendingMultiPlacementAction: card or definition missing for ${target.instanceId}`
      );
    }
    const policy = getEnterFieldCorePlacementPolicy({ card, definition: def });
    assertEnterFieldCorePlacementsAllowed(policy, entry.placements);
    if (getPlacedCoreCount(entry.placements) < target.minimumCoreCount) {
      throw new Error(
        `applyPendingMultiPlacementAction: ${target.instanceId} below minimum: required=${target.minimumCoreCount} got=${getPlacedCoreCount(entry.placements)}`
      );
    }
  }
  if (
    totalTrashNormalAmount + totalTrashSoulAmount >
    (pending.trashCoreMax ?? 0) + (pending.trashNormalCoreMax ?? 0)
  ) {
    throw new Error(
      `applyPendingMultiPlacementAction: exceeds trash core max: max=${(pending.trashCoreMax ?? 0) + (pending.trashNormalCoreMax ?? 0)} got=${totalTrashNormalAmount + totalTrashSoulAmount}`
    );
  }
  if (totalTrashSoulAmount > (pending.trashCoreMax ?? 0)) {
    throw new Error(
      `applyPendingMultiPlacementAction: exceeds trash soul core max: max=${pending.trashCoreMax ?? 0} got=${totalTrashSoulAmount}`
    );
  }
  if (
    totalTrashNormalAmount >
    (pending.trashNormalCoreMax ?? 0) + (pending.trashCoreMax ?? 0)
  ) {
    throw new Error(
      `applyPendingMultiPlacementAction: exceeds trash normal core max: max=${(pending.trashNormalCoreMax ?? 0) + (pending.trashCoreMax ?? 0)} got=${totalTrashNormalAmount}`
    );
  }
  // 未指定 target は min=0 必須
  for (const target of pending.targets) {
    if (seenDestinations.has(target.instanceId)) continue;
    if (target.minimumCoreCount > 0) {
      throw new Error(
        `applyPendingMultiPlacementAction: ${target.instanceId} requires at least ${target.minimumCoreCount} cores but no placement was provided`
      );
    }
  }

  // 適用
  let currentState: GameState = {
    ...options.state,
    pendingMultiPlacement: null,
    log: [
      ...options.state.log,
      `effect:multi-placement:apply:${pending.pendingId}:targets=${allocations.length}`,
      ...pending.targets
        .map((target) =>
          getMultiPlacementEnterFieldEventLogEntry(
            options.state,
            pending,
            target
          )
        )
        .filter((entry) => entry !== null),
    ],
  };
  for (const entry of allocations) {
    if (entry.placements.length === 0) continue;
    const target = targetById.get(entry.destinationInstanceId);
    currentState = applyEnterFieldCorePlacements({
      ...(pending.fieldCoreSourceMinimum !== undefined
        ? { fieldCoreSourceMinimum: pending.fieldCoreSourceMinimum }
        : {}),
      state: currentState,
      actingPlayerId: pending.actingPlayerId,
      destinationInstanceId: entry.destinationInstanceId,
      placements: entry.placements as readonly EnterFieldCorePlacement[],
      getCardDefinitionById: options.getCardDefinitionById,
      allowTrashNormal:
        (pending.trashNormalCoreMax ?? 0) > 0 ||
        (pending.trashCoreMax ?? 0) > 0,
      allowTrashSoul: (pending.trashCoreMax ?? 0) > 0,
      allowVoidNormal: (target?.voidNormalCoreMax ?? 0) > 0,
    });
  }
  for (const target of pending.targets) {
    const combinedBrave = getCardById(currentState, target.instanceId);
    if (
      pending.resolvedBraveCombineInstanceIds?.includes(target.instanceId) &&
      combinedBrave?.attachedToInstanceId
    ) {
      const transferred = moveBraveCombineCoresToHost(
        currentState,
        pending.actingPlayerId,
        target.instanceId,
        combinedBrave.attachedToInstanceId,
        options.getCardDefinitionById
      );
      if (!transferred)
        throw new Error(
          "Cannot transfer direct-combine placement cores to host"
        );
      currentState = transferred;
      continue;
    }
    const finalCoreCount = getTotalCoresOnCardById(
      currentState,
      target.instanceId
    );
    const finalCard = getCardById(currentState, target.instanceId);
    const finalDef = finalCard
      ? options.getCardDefinitionById(finalCard.definitionId)
      : undefined;
    const finalMinimumCoreCount =
      finalCard && finalDef
        ? getEnterFieldCorePlacementPolicy({
            card: finalCard,
            definition: finalDef,
          }).minimumCoreCount
        : target.minimumCoreCount;
    if (finalCoreCount < finalMinimumCoreCount) {
      throw new Error(
        `applyPendingMultiPlacementAction: ${target.instanceId} final core count below minimum: required=${finalMinimumCoreCount} got=${finalCoreCount}`
      );
    }
  }

  if (pending.preCostEffectContinuation) {
    const { chainId: _preCostChain, ...cont } =
      pending.preCostEffectContinuation;
    const effect = resolveContinuationEffect(
      options.getCardDefinitionById(cont.sourceDefinitionId),
      cont
    );
    if (!effect) throw new Error("Pre-cost effect continuation is missing");
    const preCostResolution = createEffectResolutionScope(
      pending.preCostEffectContinuation
    );
    currentState = preCostResolution.execute({
      ...cont,
      state: currentState,
      effect,
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext: cont.stepContext,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
    });
  }
  if (pending.combineAfterPlacement) {
    currentState = executeBraveCombine(
      currentState,
      pending.actingPlayerId,
      pending.combineAfterPlacement.braveInstanceId,
      pending.combineAfterPlacement.hostInstanceId,
      options.getCardDefinitionById
    );
    currentState = recomputeAndRebuildContinuousEffects(
      currentState,
      options.getCardDefinitionById
    );
  }
  if (pending.summonDeclaration) {
    currentState = recomputeAndRebuildContinuousEffects(
      currentState,
      options.getCardDefinitionById
    );
    return resumeSummonDeclaration(
      { ...options, state: currentState },
      pending.summonDeclaration
    );
  }
  const [nextPlacement, ...remainingPlacements] =
    pending.remainingPlacements ?? [];
  if (nextPlacement) {
    return {
      state: openEntryBraveCombineChoice(
        {
          ...currentState,
          pendingMultiPlacement: {
            ...pending,
            ...nextPlacement,
            completedTargets: [
              ...(pending.completedTargets ?? []),
              ...pending.targets,
            ],
            pendingId: nextPendingSelectionId("mp"),
            remainingPlacements,
          },
        },
        options.getCardDefinitionById
      ),
    };
  }
  if (pending.deckRevealResume) {
    const resume = pending.deckRevealResume;
    currentState =
      resume.remainderOrder !== undefined
        ? finalizeDeckReveal(
            currentState,
            resume.reveal,
            resume.remainderOrder,
            options.getCardDefinitionById,
            resume.placement,
            {
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
              getRegisteredBurstActions: options.getRegisteredBurstActions,
              ...(resume.remainderPlacementById !== undefined
                ? { remainderPlacementById: resume.remainderPlacementById }
                : {}),
            }
          )
        : continueDeckRevealAfterPicks(currentState, resume.reveal, options);
    currentState = finalizeDeckRevealTransition(
      currentState,
      pending.priorStateSnapshot ?? options.state,
      resume.reveal,
      options
    );
    return { state: currentState };
  }

  // continuation がある場合は元効果の後続ステップを再実行する。
  const afterTriggersContinuationCountBeforeResume =
    currentState.pendingAfterTriggersContinuations.length;
  if (pending.continuation) {
    const cont = pending.continuation;
    const def = options.getCardDefinitionById(cont.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, cont);
    if (!effect) {
      throw new Error(
        `applyPendingMultiPlacementAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
      );
    }
    const { chainId: _placementChainId, ...placementContext } = cont;
    currentState = resolution.execute({
      ...placementContext,
      state: cont.targetedDisclosureContinuation
        ? {
            ...currentState,
            pendingTargetedDisclosureContinuation:
              cont.targetedDisclosureContinuation,
          }
        : currentState,
      effect,
      effectIndex: cont.effectIndex,
      ...(cont.divineSkillIndex !== undefined
        ? { divineSkillIndex: cont.divineSkillIndex }
        : {}),
      ...(cont.isAccelData !== undefined
        ? { isAccelData: cont.isAccelData }
        : {}),
      ...(cont.isChangeData !== undefined
        ? { isChangeData: cont.isChangeData }
        : {}),
      sourceInstanceId: cont.sourceInstanceId,
      targetedDisclosureSourceDefinitionId: cont.sourceDefinitionId,
      actingPlayerId: cont.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext: cont.stepContext,
      ...(pending.resumeEffectSummon
        ? {
            summonPreCostCombineHostInstanceId:
              pending.resumeEffectSummon.combineHostInstanceId,
            ...(pending.resumeEffectSummon.paymentSources !== undefined
              ? {
                  summonPaymentSources:
                    pending.resumeEffectSummon.paymentSources,
                }
              : {}),
          }
        : {}),
      ...(pending.resumeEffectSummon ? { skipStepUsageAtResume: true } : {}),
      ...(cont.activationZone !== undefined
        ? { activationZone: cont.activationZone }
        : {}),
      ...(cont.optionalExecuteResumeStepIndex !== undefined
        ? {
            optionalExecuteResumeStepIndex: cont.optionalExecuteResumeStepIndex,
          }
        : {}),
      ...(cont.targetInstanceIds !== undefined
        ? { targetInstanceIds: cont.targetInstanceIds }
        : {}),
      ...(cont.targetStepId !== undefined
        ? { targetStepId: cont.targetStepId }
        : {}),
      ...(cont.targetSelectionResolved !== undefined
        ? { targetSelectionResolved: cont.targetSelectionResolved }
        : {}),
      ...(cont.recordedUsage !== undefined
        ? { recordedUsage: cont.recordedUsage }
        : {}),
      ...(cont.repeatResume !== undefined
        ? { repeatResume: cont.repeatResume }
        : {}),
      ...(cont.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: cont.effectSourceInstanceId }
        : {}),
      ...(cont.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
        : {}),
      ...(cont.sourceCardReferenceInstanceId !== undefined
        ? { sourceCardReferenceInstanceId: cont.sourceCardReferenceInstanceId }
        : {}),
      ...(pending.priorStateSnapshot !== undefined
        ? { resumePreviousStepPreState: pending.priorStateSnapshot }
        : {}),
      ...(cont.effectActionKind !== undefined
        ? { effectActionKind: cont.effectActionKind }
        : {}),
      ...(cont.choiceIndex !== undefined
        ? { choiceIndex: cont.choiceIndex }
        : {}),
      ...(cont.sourcePreventionLevel !== undefined
        ? { sourcePreventionLevel: cont.sourcePreventionLevel }
        : {}),
      ...(cont.sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass: cont.sourcePreventionBypass }
        : {}),
      ...(cont.costPaidThisEffect !== undefined
        ? { costPaidThisEffect: cont.costPaidThisEffect }
        : {}),
      ...(cont.postResolutionOracle !== undefined
        ? { postResolutionOracle: cont.postResolutionOracle }
        : {}),
      ...(battleEndAttackId !== undefined
        ? { battleEndDeferralAttackId: battleEndAttackId }
        : {}),
    });
  }
  const resumedIntoAfterTriggers =
    currentState.pendingAfterTriggersContinuations.length >
    afterTriggersContinuationCountBeforeResume;

  // P3-47 F-6: コア配置 (+ continuation resume) 後に通常解決と同じ finalization を通す。
  // core_distribute 継続経路と同じく、resume したステップ列の終端で SBA / トリガー収集 /
  // pending-leave flush が走らない取りこぼしを防ぐ。
  currentState = resolution.finalize({
    state: currentState,
    // resume 先の after_triggers が直前 step の差分を既に正式収集した場合、
    // priorStateSnapshot を再利用すると同じ召喚/配置誘発を二重に積む。
    // 現在盤面を基準にすれば、ここで新たに起きる SBA 差分だけを収集できる。
    beforeState: resumedIntoAfterTriggers
      ? currentState
      : (pending.priorStateSnapshot ?? options.state),
    endLogs: [],
    actingPlayerId:
      pending.continuation?.actingPlayerId ?? pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getPendingSourceColors({
      state: currentState,
      sourceInstanceId: pending.sourceInstanceId,
      sourceDefinitionId: pending.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
    }),
    causedBySourceInstanceId:
      pending.continuation?.effectSourceInstanceId ?? pending.sourceInstanceId,
    enterFieldCausedByPlayerId:
      pending.continuation?.actingPlayerId ??
      pending.effectActingPlayerId ??
      pending.actingPlayerId,
    ...(pending.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: pending.sourceEffectIndex }
      : {}),
    ...(battleEndAttackId !== undefined
      ? { battleEndDeferralAttackId: battleEndAttackId }
      : {}),
  });
  currentState = checkAndQueuePostResolutionOracleIfReady(
    currentState,
    pending.continuation?.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  if (pending.drawStepResume) {
    currentState = resumeDrawStepAfterPlacement(
      currentState,
      pending.drawStepResume,
      options
    );
  }
  if (battleEndAttackId !== undefined) {
    currentState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      currentState,
      options
    );
  }
  const cleanupSourceIds = [
    pending.continuation?.effectSourceInstanceId,
    pending.continuation?.sourceInstanceId,
    pending.sourceInstanceId,
  ].filter((id): id is string => id !== undefined);
  for (const sourceInstanceId of cleanupSourceIds) {
    currentState = cleanupCompletedInUseMagicSourceIfReady({
      state: currentState,
      sourceInstanceId,
      chainId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }
  currentState = resumeStackCascadeIfReady(currentState, options);
  return { state: currentState };
}

/**
 * P3-49 placement_multi: pendingMultiPlacement を中止して priorStateSnapshot に巻き戻す。
 * effect chain の continuation は呼ばれない (= 該当 effect の以降のステップは未実行)。
 */
export function applyAbortPendingMultiPlacementAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolvePendingMultiPlacementResult {
  const pending = options.state.pendingMultiPlacement;
  if (!pending) {
    throw new Error(
      "applyAbortPendingMultiPlacementAction: no pending multi placement to abort"
    );
  }
  if (!pending.priorStateSnapshot) {
    throw new Error(
      `applyAbortPendingMultiPlacementAction: pending ${pending.pendingId} has no priorStateSnapshot`
    );
  }
  if (pending.canAbort === false)
    throw new Error("This field-entry placement cannot be aborted");
  const restored: GameState = {
    ...pending.priorStateSnapshot,
    log: [
      ...pending.priorStateSnapshot.log,
      `effect:multi-placement:aborted:${pending.pendingId}:source=${pending.sourceDefinitionId}`,
    ],
  };
  return finalizeAbortedCoreSelection(
    options,
    restoreAbortedEffectState(restored, options.state),
    pending,
    `multi-placement:${pending.pendingId}:aborted`
  );
}
