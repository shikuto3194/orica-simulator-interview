import {
  consumeImmediateAttackJoin,
  getImmediateAttackJoinDecisions,
  pruneImmediateAttackJoins,
} from "./immediate-attack-join";
import { replaceCardInstances } from "../zone/card-instance-state";
import { getObservedTriggerConditionResults } from "../effect/trigger-condition-observation";
import { getAvailableCardCostPaymentSources } from "../core/payment-system";
import { resolveEffectSummonPaymentChoice } from "../effect/summon-payment-choice";
import { executeSpiritHandSwap } from "../mechanics/accel-change-system";
import { resumeEffectAfterCardChoice } from "./pending-action-handlers";
import { createEffectResolutionScope } from "../effect/effect-resolution-scope";
import { flushReadyEffectCompletions } from "../effect/effect-completion";
import { trackPendingLeaveReactionChain } from "../state-based-actions";
import { isTriggeredSourceUsageAvailable } from "../effect/triggered-source-usage";
import { cloneStateForTriggerDelta } from "../effect/native-effect-front-helpers";
import { scopeInnermostTriggerReactions } from "../effect/trigger-resolution-scope";
import { getPendingTriggeredRebirthTimingWindowId } from "../effect/structured-card-replacement";
import { recordHandExchange } from "../zone/hand-increase";
import {
  getOwnEffectSourceZone,
  isCardInEffectZone,
} from "../effect/card-access-rules";
import {
  useBattleImmediateEffectAsAction,
  pruneConsumedRebirthBattleImmediateEffects,
} from "../battle/battle-immediate-effect-system";
import {
  assertPendingTriggerChainIds,
  requireTriggerChainId,
  isChainAtOrUnder,
} from "../chain-id";
import {
  confirmAttackDeclarationAsAction,
  confirmBlockDeclarationAsAction,
  confirmJoinActiveAttackDeclarationAsAction,
  executeBattleResolution,
  useAttackAsAction,
  useBlockAsAction,
  useDeclineBlockAsAction,
  useJoinActiveAttackAsAction,
  useOpenBattleFlashAsAction,
  usePassBattleFlashAsAction,
  usePassPreDeclarationStackAsAction,
} from "../battle/battle-system";
import {
  finalizeResolvedBurstCard,
  getBurstPostResolutionDestination,
  playBurstFollowUpCardWithoutPayingCost,
  useBurstFollowUpMagicCardWithoutPayingCost,
  playBurstSourceCardWithoutPayingCost,
  useBurstSourceMagicCardWithoutPayingCost,
  hasPendingBurstActivationSelections,
  hasPendingEffectsBeforeBurstEffect,
  markBurstActivationSelected,
  markBurstActivationEstablished,
  queueDelayedBurstActivationStack,
  queueDelayedBurstEffectDeclarationStack,
  revealBurstCardForResolution,
  useSetBurstAsAction,
} from "../mechanics/burst-system";
import { useSetMirageInStackContextAsAction } from "../mechanics/mirage-system";
import {
  canActivateGrantedEffect,
  getGrantedEffectUsageLabel,
} from "../mechanics/grant-effect-system";
import { useSetQuartzInStackContextAsAction } from "../mechanics/quartz-system";

import {
  applyLifeZeroDefeat,
  isSoulCoreOn,
  moveCardZone,
  moveLifeCoreByEffect,
  moveNormalCores,
  updateCard,
} from "../core/core-system";
import { recomputeAndRebuildContinuousEffects } from "../effect/continuous-effect-rebuild";
import {
  rebuildContinuousAndApplyStateBasedActions,
  moveNormalCoresForBraveSeparation,
  executeBraveCombine,
  executeImaginBraveSecondCombine,
} from "./brave-combine-state-helpers";
import { resolveSeparatedBraveExhaustState } from "../mechanics/brave-spirit-state-recovery";
import { allocateRootTriggerChain } from "../chain-id";
import {
  getBattleEndDeferralChainId,
  getBattleEndFinalizeAttackIdForPending,
  maybeFinalizeBattleEndScopeExpirations,
} from "../battle/battle-end-scope-finalize";
import { flushPendingLeavesAndQueueReactions } from "../zone/pending-leave-flush";

import {
  useFieldCardEffectAsAction,
  useFieldCardEffectInFlashContextAsAction,
} from "../card/card-effect-system";
import {
  applyResolveFieldMagicPreCostTriggerAction,
  resumeFieldMagicPreCostTriggerIfReady,
  tryInterceptFieldMagicPreCostTrigger,
} from "./field-magic-pre-cost-trigger";
import { applyTokenPoolPreCostForcedCombineDeclarationSideEffect } from "./token-pool-pre-cost-forced-combine";
import {
  buildComposedResolverFromComposition,
  executeHandWrittenEffectResolver,
  moveCompletedInUseMagicCardToTrashIfReady,
  processPendingImmediateBattleEnds,
  type HandWrittenEffectResolverLookup,
} from "../effect/effect-resolution";
import {
  playMagicCardAsAction,
  useMagicCardInFlashContextAsAction,
} from "../mechanics/magic-system";
import { hasPreventBraveSeparationRestriction } from "../mechanics/brave-separation-restriction";
import {
  finalizePendingAccelCleanups,
  startAccelCostOverride,
  resolvePendingChangeCleanupChoice,
  useAccelCardAsAction,
  useAccelCardInFlashContextAsAction,
  useChangeCardInFlashContextAsAction,
} from "../mechanics/accel-change-system";
import type {
  ActiveStack,
  CardCategory,
  CardDefinition,
  CardInstance,
  EffectPreventionLevel,
  EffectReevaluationPoint,
  GameState,
  PendingCoreDistribution,
  PendingPrivateDeclaration,
  SuppressionEffectDescriptor,
  PendingTargetRedirect,
  PendingTriggeredEffect,
  TargetRedirectReplacementMode,
  TriggerPriority,
  EffectActivationSourceZone,
} from "../model";
import {
  getPaidPreventionImmunityCardCostCandidates,
  getPaidPreventionImmunityCost,
} from "../effect/effect-resistance-check";
import { getEffectRegistrationSourceKindForPrintedCategory } from "../source-kinds";

import { peelResolvedStack } from "../stack/stack-window-shared";
import { advanceStep } from "../turn-system";
import { appendPublicDisclosuresForStateTransition } from "../public-disclosure";

import {
  applyBurstActivationImmunity,
  collectAndQueueTriggerReactions,
  finalizeCardUsageAndQueueTriggers,
  getAvailableBurstSourceChoices,
  getAvailableTriggeredEffectSourceChoices,
  pruneIllegalPendingTriggeredEffects,
  isRegisteredLeaveFieldPreFlushEffect,
  makeResolvedTriggeredSourceKey,
  queueFlashUsedTriggers,
  queuePendingReactionsFromTriggerEvents,
  useResolvePendingBurstCheckAsAction,
  useResolvePendingTriggeredEffectAsAction,
} from "../effect/trigger-system";
import type {
  ApplyLegalActionOptions,
  ApplyLegalActionResult,
  LegalAction,
  SafeActionResult,
} from "./legal-actions-types";
import {
  getAvailablePendingTriggeredEffectLegalActions,
  pruneUnavailableBattleImmediateEffects,
} from "./legal-actions-availability";

import {
  getEffectTribeGrants,
  materializeDeferredTrashOptionalAdds,
} from "../effect/structured-effect-interpreter";
import {
  finalizePendingEndFinalizations,
  startDeferredExtraTurnIfReady,
} from "../effect/structured-state-grants";

import { getCombinedUnitSymbolCount } from "../battle/battle-shared";
import { executeEffect } from "../effect/effect-interpreter";
import { getHandSummonPermissionSpec } from "../effect/structured-effect-registrations";
import { evaluateAttackStepEndBlockedRetryCondition } from "../effect/attack-step-end-blocked-retry";
import {
  applyRedirectReselectionToResolvedTargets,
  applyRedirectToResolvedTargets,
  getRedirectEffectTargetMetadata,
} from "../effect/redirect-effect-target";
import { executeSelectedBorrowedCardEventEffect } from "../effect/effect-borrowing";
import { resolveHandTrashSearchCandidates } from "../effect/zone-search-candidates";

import {
  buildReevaluationConfig,
  composeRecordedUsage,
  getChoiceVariantUsageLabel,
  getDeclaredSummonAltCostGrant,
  getStableEffectLabel,
  getCombinedUnitBp,
  getCombinedUnitEffectiveOrAdditionalCost,
  recordEffectUsageIfLimited,
  resolveChosenLifeCoreKind,
  resolveLegalActionTargets,
  resolvePaymentSources,
  isBurstEffectNullifiedByOpponent,
  getEffectSourceTribePreventionBypass,
  isEffectSourceTribeStackNegateImmune,
  resolveDynamicStackNegatePreventionLevel,
  executeReevaluationCheck,
  getEffectiveColors,
  getEffectiveTribes,
  getMandatoryForcedTargetInclusionIds,
  getBurstActivationRequiredLifeCoreCost,
} from "./legal-actions-shared";

import {
  hasOutstandingEffectResolutionContinuation,
  resolveAdventSourceReplacement,
  resolveBraveAttackContinuation,
  resolveBraveLeaveChoice,
  resolveSoulStateReplacement,
} from "../state-based-actions";
import { executeRemoveFromGame } from "../effect/structured-card-replacement";
import { queuePreFlushGrantedEffectsAndFlushPendingLeaves } from "../zone/pending-leave-flush";
import {
  usePlaceNexusInStackContextAsAction,
  placeNexusAsAction,
  useSummonInStackContextAsAction,
  playSummonAsAction,
} from "../play/play-card-system";
import { captureNormalHandPlayDeclarationRollbackDelta } from "../play/play-card-resolution";

import { getCardById } from "../card/card-lookup";
import { isMagicLikeCardForm } from "../card/card-filter";
import { getDefaultZoneRoleName } from "../factories";

import type { AdditionalCostModifier } from "../core/cost-system";

import { hasPendingNegateRequestForEffectDeclarationTarget } from "./stack-collection-helpers";
import {
  getRegisteredMagicActionAllowedZones,
  isPrivateTriggeredDeclarationConditionMet,
} from "./legal-actions-availability";
import {
  advanceAttackDeclarationStateIfReady,
  maybeQueueEffectActivationBurstCheck,
} from "./attack-burst-flow";
import {
  getBurstIgnoresOpponentCannotActivateBurst,
  getStackTargetSelection,
} from "./stack-target-resolution";
import {
  mergeTargetLockBypassProfiles,
  type TargetLockBypassProfile,
} from "../effect/target-affect-gate";
import {
  applyAbortPendingCoreDistributionAction,
  applyAbortPendingMultiPlacementAction,
  applyPendingCoreCountAction,
  applyPendingCountSelectionAction,
  applyPendingDiscardSetBurstCountSelectionAction,
  applyPendingCoreDistributionAction,
  applyPendingCoreSplitAction,
  applyPendingSplitSummonChoiceAction,
  applyPendingDeckRevealAction,
  applyPendingDrawStepCostChoiceAction,
  applyPendingEnterFieldPlacementAction,
  applyPendingLifeCoreSelectionAction,
  applyPendingLinkAidCostSourceChoiceAction,
  applyPendingGroupedSummonCostOverrideChoiceAction,
  applyPendingLifeDamageDiscardChoiceAction,
  applyPendingLifeGainReplacementChoiceAction,
  applyPendingMultiPlacementAction,
  applyPendingStepChoiceAction,
  applyPendingStepOptionalChoiceAction,
  applyConnectBattleDecisionAction,
  applyPendingDeckRevealCountBoostChoiceAction,
  applyPendingStepOptionalTargetSelectionAction,
  applyPendingSummonCostExcludeChoiceAction,
  applyPendingSummonCostCoreMoveChoiceAction,
  applyPendingZoneSelectionAction,
  applyResolveBraveCombineChoiceAction,
  applyResolveCoreSourceAllocationAction,
  applySetAsideExitReplacementChoiceAction,
  applyResolvePendingEffectSummonCostPaymentAction,
  applyResolveReverseRebirthSummonAction,
  applyResolveTenshoSummonAction,
  checkAndQueuePostResolutionOracleIfReady,
  resolveContinuationEffect,
} from "./pending-action-handlers";
import {
  applyPendingAsIfSoulCoreChoiceAction,
  applyPendingCoreShootAction,
  applyPendingEffectTargetAction,
  applyPendingEffectOptionalRepeatChoiceAction,
  applyPendingEffectOptionalRepeatCountAction,
  applyPendingPayToActCoreGateAction,
  applyPendingPayToActHandDiscardGateAction,
} from "./effect-target-handlers";
import {
  applyDivineSkillAction,
  applyMechanicTriggeredEffect,
} from "./mechanic-trigger-handlers";
import {
  finalizeOneShotStackNegateRequestsAtStableBoundary,
  resolveDeferredStackAction,
  resolveStackCascade,
  resumeStackCascadeIfReady,
} from "./stack-resolution-core";

function getTriggerPriority(value: {
  triggerPriority?: TriggerPriority;
}): TriggerPriority {
  return value.triggerPriority ?? "normal";
}

/**
 * Non-public triggered declarations are held by their simultaneous-event
 * bucket until every sibling has been declared, declined, or pruned.
 */
function isSameDeferredTriggerBucket(
  left: {
    simultaneousGroupId?: string | undefined;
    triggerPriority?: TriggerPriority;
  },
  right: {
    simultaneousGroupId?: string | undefined;
    triggerPriority?: TriggerPriority;
  }
): boolean {
  return (
    left.simultaneousGroupId === right.simultaneousGroupId &&
    getTriggerPriority(left) === getTriggerPriority(right)
  );
}

export function getCardInstanceOrThrow(
  state: GameState,
  instanceId: string,
  detail: string
): CardInstance {
  const cardInstance = getCardById(state, instanceId);

  if (!cardInstance) {
    throw new Error(`${detail}: ${instanceId}`);
  }

  return cardInstance;
}

export function getCardDefinitionOrThrow(
  definitionId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): CardDefinition {
  const definition = getCardDefinitionById(definitionId);

  if (!definition) {
    throw new Error(`Unknown card definition: ${definitionId}`);
  }

  return definition;
}

function isPrivateTriggeredMagicActivationZone(
  zone: string | undefined
): zone is EffectActivationSourceZone {
  return zone === "hand" || zone === "set_aside" || zone === "trash";
}

export function movePrivateTriggeredMagicSourceToInUseIfReady(args: {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): { state: GameState; activationZone?: EffectActivationSourceZone } {
  const { state, pendingEffect, sourceInstanceId, getCardDefinitionById } =
    args;
  if (pendingEffect.declaredFromPrivateZone !== true) return { state };

  const sourceCard = getCardById(state, sourceInstanceId);
  if (!sourceCard) return { state };

  const activationZoneCandidate = pendingEffect.fromZone ?? sourceCard.zone;
  if (!isPrivateTriggeredMagicActivationZone(activationZoneCandidate)) {
    return { state };
  }

  const sourceDefinition = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDefinition || !isMagicLikeCardForm(sourceCard, sourceDefinition)) {
    return { state };
  }

  if (sourceCard.zone === "in_use") {
    return { state, activationZone: activationZoneCandidate };
  }
  if (sourceCard.zone !== activationZoneCandidate) {
    return { state, activationZone: activationZoneCandidate };
  }

  return {
    state: moveCardZone(state, sourceInstanceId, "in_use"),
    activationZone: activationZoneCandidate,
  };
}

function resolveDynamicSourcePreventionLevel(options: {
  state: GameState;
  sourceInstanceId: string | undefined;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  registrationPreventionLevel: EffectPreventionLevel | undefined;
}): EffectPreventionLevel | undefined {
  const bypass = getEffectSourceTribePreventionBypass(
    options.state,
    options.sourceInstanceId,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  if (bypass?.kind === "all_effects") {
    return "unpreventable";
  }

  return options.registrationPreventionLevel;
}

function resolveDynamicSourcePreventionBypass(options: {
  state: GameState;
  sourceInstanceId: string | undefined;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  registrationPreventionBypass?: TargetLockBypassProfile | undefined;
}): TargetLockBypassProfile | undefined {
  const bypass = getEffectSourceTribePreventionBypass(
    options.state,
    options.sourceInstanceId,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  if (bypass?.kind === "all_effects") return undefined;
  return mergeTargetLockBypassProfiles(
    options.registrationPreventionBypass,
    bypass
  );
}

function hasEffectSuppressionReevaluation(
  registration:
    | { reevaluationPoints?: readonly EffectReevaluationPoint[] }
    | undefined
): boolean {
  return (
    registration?.reevaluationPoints?.some((point) =>
      point.checks.includes("effect_suppression")
    ) === true
  );
}

function isEffectSuppressedBeforeDeclaration(options: {
  state: GameState;
  sourceInstanceId: string | undefined;
  registration:
    | {
        reevaluationPoints?: readonly EffectReevaluationPoint[];
        preventionLevel?: EffectPreventionLevel;
        suppressionEffectDescriptor?: SuppressionEffectDescriptor;
      }
    | undefined;
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  if (
    options.sourceInstanceId === undefined ||
    !hasEffectSuppressionReevaluation(options.registration)
  ) {
    return false;
  }
  return !executeReevaluationCheck({
    state: options.state,
    checkKind: "effect_suppression",
    sourceInstanceId: options.sourceInstanceId,
    targetInstanceIds: [],
    sourcePreventionLevel:
      options.sourcePreventionLevel ??
      options.registration?.preventionLevel ??
      "none",
    ...(options.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: options.sourcePreventionBypass }
      : {}),
    ...(options.registration?.suppressionEffectDescriptor !== undefined
      ? {
          suppressionEffectDescriptor:
            options.registration.suppressionEffectDescriptor,
        }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

function getZoneCostPaymentForMagic(
  action: import("./legal-actions-types").UseMagicLegalAction,
  selectedZoneCardIds?: string[]
):
  | {
      modifiers: AdditionalCostModifier[];
      cardIds: string[];
    }
  | undefined {
  if (action.costMode === "zone_discount_variable") {
    // BSAZ03-M01 effects[1b]: 手札を maxCount 枚まで破棄、破棄1枚につき
    // discountPerCard 分コストを軽減する可変枚数版 (return_to_deck_top_bottom の
    // exact 固定枚数と異なり 0〜maxCount のどの枚数でも選べる)。
    const perCard = action.zoneCostDiscountPerCard;
    const maxCount = action.zoneCostPaymentMaxCount;
    const candidates = action.zoneCostPaymentCandidateIds ?? [];
    if (perCard === undefined || maxCount === undefined || maxCount <= 0) {
      throw new Error("Invalid variable zone discount cost metadata");
    }
    const cardIds = selectedZoneCardIds ?? [];
    if (cardIds.length > maxCount) {
      throw new Error(
        `Zone cost payment count exceeds max: selected=${cardIds.length} max=${maxCount}`
      );
    }
    if (new Set(cardIds).size !== cardIds.length) {
      throw new Error("Zone cost payment cards must be unique");
    }
    const candidateSet = new Set(candidates);
    const invalid = cardIds.find((id) => !candidateSet.has(id));
    if (invalid) {
      throw new Error(`Selected zone cost card is not a candidate: ${invalid}`);
    }
    if (cardIds.length === 0) {
      return { modifiers: [], cardIds: [] };
    }
    return {
      modifiers: [
        {
          amount: perCard * cardIds.length,
          reason: `zone_cost:${action.sourceCardNo}`,
        },
      ],
      cardIds,
    };
  }
  if (action.costMode !== "zone_discount") return undefined;
  const amount = action.zoneCostDiscountAmount;
  const count = action.zoneCostPaymentCount;
  const candidates = action.zoneCostPaymentCandidateIds ?? [];
  if (amount === undefined || count === undefined || count <= 0) {
    throw new Error("Invalid zone discount cost metadata");
  }
  if (count !== 2) {
    throw new Error(
      "Zone discount top/bottom payment requires exactly 2 cards"
    );
  }
  const cardIds = selectedZoneCardIds ?? [];
  if (cardIds.length === 0) {
    throw new Error("Zone discount cost payment requires selected zone cards");
  }
  if (cardIds.length !== count) {
    throw new Error(
      `Zone cost payment count mismatch: selected=${cardIds.length} required=${count}`
    );
  }
  if (new Set(cardIds).size !== cardIds.length) {
    throw new Error("Zone cost payment cards must be unique");
  }
  const candidateSet = new Set(candidates);
  const invalid = cardIds.find((id) => !candidateSet.has(id));
  if (invalid) {
    throw new Error(`Selected zone cost card is not a candidate: ${invalid}`);
  }
  return {
    modifiers: [
      {
        amount,
        reason: `zone_cost:${action.sourceCardNo}`,
      },
    ],
    cardIds,
  };
}

export function buildCompositionAwareResolverLookup(options: {
  baseLookup: ApplyLegalActionOptions["getHandWrittenEffectResolver"];
  cardNo: string;
  composition: ActiveStack["composition"];
  getConditionalCostCanExecuteCheck?: ApplyLegalActionOptions["getConditionalCostCanExecuteCheck"];
  getConditionalResultSuccessCheck?: ApplyLegalActionOptions["getConditionalResultSuccessCheck"];
}): ApplyLegalActionOptions["getHandWrittenEffectResolver"] | undefined {
  if (!options.baseLookup || !options.composition) {
    return undefined;
  }

  const composed = buildComposedResolverFromComposition(
    options.baseLookup,
    options.cardNo,
    options.composition,
    options.getConditionalCostCanExecuteCheck,
    options.getConditionalResultSuccessCheck
  );

  if (!composed) {
    return undefined;
  }

  const fallbackLookup = options.baseLookup;
  const composedCardNo = options.cardNo;
  return (cardNo: string) =>
    cardNo === composedCardNo ? composed : fallbackLookup(cardNo);
}

/**
 * follow-up カードの composition メタデータを解決して、
 * composition-aware な resolver lookup を返す。
 * composition がない場合は baseLookup をそのまま返す。
 */
export function buildFollowUpResolverLookup(options: {
  state: GameState;
  followUpInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  baseLookup: (
    cardNo: string
  ) => ReturnType<typeof buildComposedResolverFromComposition>;
  getRegisteredFieldCardEffectActions?: ApplyLegalActionOptions["getRegisteredFieldCardEffectActions"];
  getRegisteredMagicActions?: ApplyLegalActionOptions["getRegisteredMagicActions"];
  getConditionalCostCanExecuteCheck?: ApplyLegalActionOptions["getConditionalCostCanExecuteCheck"];
  getConditionalResultSuccessCheck?: ApplyLegalActionOptions["getConditionalResultSuccessCheck"];
}): typeof options.baseLookup {
  const followUpCard = getCardById(options.state, options.followUpInstanceId);
  if (!followUpCard) return options.baseLookup;

  const followUpDef = options.getCardDefinitionById(followUpCard.definitionId);
  if (!followUpDef) return options.baseLookup;

  const followUpCardNo = followUpDef.cardNo;

  // field card effect registration の composition を確認
  const fieldRegs =
    options.getRegisteredFieldCardEffectActions?.(followUpCardNo);
  const fieldComposition = fieldRegs?.[0]?.composition;

  // magic registration の composition を確認
  const magicRegs = options.getRegisteredMagicActions?.(followUpCardNo);
  const magicComposition = magicRegs?.[0]?.composition;

  const composition = fieldComposition ?? magicComposition;
  if (!composition) return options.baseLookup;

  const composed = buildComposedResolverFromComposition(
    options.baseLookup,
    followUpCardNo,
    composition,
    options.getConditionalCostCanExecuteCheck,
    options.getConditionalResultSuccessCheck
  );
  if (!composed) return options.baseLookup;

  const fallback = options.baseLookup;
  return (cardNo: string) =>
    cardNo === followUpCardNo ? composed : fallback(cardNo);
}

export function maybeFinalizeBattleEndScopeAfterPendingDrain(
  state: GameState,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  const afterImmediateBattleEnds = processPendingImmediateBattleEnds({
    state,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  return maybeFinalizeBattleEndScopeExpirations(
    afterImmediateBattleEnds,
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

import {
  openStackWindow,
  openBurstActivationStackWindow,
  openBurstEffectDeclarationStackWindow,
  openStackSubWindowInStack,
  openStackSubWindow,
  openPreDeclarationStackSubWindow,
} from "./stack-window-openers";

// P3-112: contract_combine/link_aid/declare_advent の発揮宣言 chainId 一意化用カウンタ。
// divine_skill の divineSkillStackSequence (mechanic-trigger-handlers.ts) と同型。
let contractCombineStackSequence = 0;
let linkAidStackSequence = 0;
let adventStackSequence = 0;
let manifestStackSequence = 0;
let flipInsteadOfAttackStackSequence = 0;

function clearPendingTriggeredEffectTurnSelection(
  pendingEffect: PendingTriggeredEffect
): PendingTriggeredEffect {
  const {
    selectedByTurnPlayer: _selectedByTurnPlayer,
    selectedSourceInstanceId: _selectedSourceInstanceId,
    selectedSourceEffectInstanceId: _selectedSourceEffectInstanceId,
    selectedRegistrationIndex: _selectedRegistrationIndex,
    ...rest
  } = pendingEffect;
  return rest;
}

function selectPendingTriggeredEffectForTurnPlayer(
  pendingEffect: PendingTriggeredEffect,
  action: Extract<LegalAction, { kind: "select_pending_to_resolve" }>
): PendingTriggeredEffect {
  return {
    ...clearPendingTriggeredEffectTurnSelection(pendingEffect),
    selectedByTurnPlayer: true,
    ...(action.sourceInstanceId !== undefined
      ? { selectedSourceInstanceId: action.sourceInstanceId }
      : {}),
    ...(action.sourceEffectInstanceId !== undefined
      ? { selectedSourceEffectInstanceId: action.sourceEffectInstanceId }
      : {}),
    ...(action.registrationIndex !== undefined
      ? { selectedRegistrationIndex: action.registrationIndex }
      : {}),
  };
}

function resolveActionMatchesOwnerOptionalSelect(
  resolveAction: Extract<
    LegalAction,
    { kind: "resolve_pending_triggered_effect" }
  >,
  selectAction: Extract<LegalAction, { kind: "select_pending_to_resolve" }>
): boolean {
  if (resolveAction.pendingId !== selectAction.pendingId) return false;
  if (resolveAction.skipOnly === true) return false;
  if (resolveAction.choiceIndex !== undefined) return false;
  if (
    selectAction.sourceInstanceId !== undefined &&
    resolveAction.sourceInstanceId !== selectAction.sourceInstanceId
  ) {
    return false;
  }
  if (
    selectAction.sourceEffectInstanceId !== undefined &&
    resolveAction.sourceEffectInstanceId !== selectAction.sourceEffectInstanceId
  ) {
    return false;
  }
  if (
    selectAction.registrationIndex !== undefined &&
    resolveAction.registrationIndex !== selectAction.registrationIndex
  ) {
    return false;
  }
  return true;
}

function resolveOwnerOptionalSelectIfUnambiguous(
  options: ApplyLegalActionOptions,
  action: Extract<LegalAction, { kind: "select_pending_to_resolve" }>,
  selectedState: GameState
): ApplyLegalActionResult | null {
  if (options.skipOptionalEffect === true) return null;
  if (action.executionMode !== "optional") return null;
  if (action.ownerPlayerId !== action.actingPlayerId) return null;

  const matchingResolveActions = getAvailablePendingTriggeredEffectLegalActions(
    {
      state: selectedState,
      actingPlayerId: action.ownerPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        options.getRegisteredFieldCardEffectActions ?? (() => undefined),
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      ...(options.getRegisteredBattleImmediateEffectActions !== undefined
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      ...(options.getRegisteredHandActivatedEffectActions !== undefined
        ? {
            getRegisteredHandActivatedEffectActions:
              options.getRegisteredHandActivatedEffectActions,
          }
        : {}),
      ...(options.getRegisteredMagicActions !== undefined
        ? { getRegisteredMagicActions: options.getRegisteredMagicActions }
        : {}),
      ...(options.getConditionalCostCanExecuteCheck !== undefined
        ? {
            getConditionalCostCanExecuteCheck:
              options.getConditionalCostCanExecuteCheck,
          }
        : {}),
    }
  ).filter(
    (
      candidate
    ): candidate is Extract<
      LegalAction,
      { kind: "resolve_pending_triggered_effect" }
    > =>
      candidate.kind === "resolve_pending_triggered_effect" &&
      resolveActionMatchesOwnerOptionalSelect(candidate, action)
  );

  if (matchingResolveActions.length !== 1) return null;
  const resolveAction = matchingResolveActions[0]!;
  return applyLegalActionCore({
    ...options,
    state: selectedState,
    action: resolveAction,
  });
}

export function applyPostResolveTriggeredEffectHandling(args: {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  resolvedSourceInstanceId: string | undefined;
  resolvedSourceRegistrationIndex: number | undefined;
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredBurstActions"
    | "getRegisteredBattleImmediateEffectActions"
    | "getRegisteredTriggeredEffectActions"
  >;
}): GameState {
  const {
    state,
    pendingEffect,
    resolvedSourceInstanceId,
    resolvedSourceRegistrationIndex,
    options,
  } = args;

  if (pendingEffect.declaredFromPrivateZone === true) {
    const privateSourceInstanceId =
      pendingEffect.declaredSourceInstanceId ?? resolvedSourceInstanceId;
    const cleanedState =
      privateSourceInstanceId !== undefined
        ? moveCompletedInUseMagicCardToTrashIfReady({
            state,
            sourceInstanceId: privateSourceInstanceId,
            getCardDefinitionById: options.getCardDefinitionById,
            logLabel: `trigger:${pendingEffect.pendingId}`,
          })
        : state;
    return advanceAttackDeclarationStateIfReady(cleanedState, options);
  }

  if (
    !resolvedSourceInstanceId ||
    !options.getRegisteredTriggeredEffectActions
  ) {
    return advanceAttackDeclarationStateIfReady(state, options);
  }

  // 解決済みを effect 単位 (instanceId, registrationIndex) で記録する。同一カードが
  // 同タイミングの誘発効果を複数持つ場合 (例: BSTH06-C01 の 2 つの『召喚時』)、片方を
  // 解決しても他方を残すため、instanceId 単位ではなく registration 単位で除外する。
  const resolvedSourceKey = makeResolvedTriggeredSourceKey(
    resolvedSourceInstanceId,
    resolvedSourceRegistrationIndex
  );
  const stayedRelatedInstanceIds =
    getStayedRelatedInstanceIdsAfterStayResolution(
      state,
      pendingEffect,
      resolvedSourceKey
    );
  const resolvedSourceRegistrationKeys = Array.from(
    new Set([
      ...(pendingEffect.resolvedSourceRegistrationKeys ?? []),
      resolvedSourceKey,
      ...getSourceKeysForRelatedInstances(
        pendingEffect,
        stayedRelatedInstanceIds
      ),
    ])
  );
  const updatedPendingEffect: PendingTriggeredEffect = {
    ...clearPendingTriggeredEffectTurnSelection(pendingEffect),
    resolvedSourceRegistrationKeys,
  };
  if (
    hasPendingNegateRequestForEffectDeclarationTarget(
      state,
      updatedPendingEffect,
      options.getCardDefinitionById
    )
  ) {
    return advanceAttackDeclarationStateIfReady(state, options);
  }
  const remainingSourceChoices = getAvailableTriggeredEffectSourceChoices({
    state,
    pendingEffect: updatedPendingEffect,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  }).filter((choice) =>
    isTriggeredSourceUsageAvailable({
      state,
      pendingEffect: updatedPendingEffect,
      choice,
      getCardDefinitionById: options.getCardDefinitionById,
    })
  );

  if (
    remainingSourceChoices.length === 0 &&
    !(updatedPendingEffect.dormantSourceRegistrationKeys ?? []).some(
      (key) => !resolvedSourceRegistrationKeys.includes(key)
    )
  ) {
    return advanceAttackDeclarationStateIfReady(
      {
        ...state,
        pendingTriggeredEffects: state.pendingTriggeredEffects.filter(
          (p) => p.pendingId !== pendingEffect.pendingId
        ),
      },
      options
    );
  }

  const requeuedState = {
    ...state,
    pendingTriggeredEffects: [
      updatedPendingEffect,
      ...state.pendingTriggeredEffects.filter(
        (p) => p.pendingId !== pendingEffect.pendingId
      ),
    ],
    log: [
      ...state.log,
      `trigger:requeued:${updatedPendingEffect.pendingId}:${resolvedSourceRegistrationKeys.join(",")}`,
    ],
  };
  return pruneIllegalPendingTriggeredEffects({
    state: requeuedState,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
}

function triggeredEffectSourceHasStayOnFieldStep(args: {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  action: Extract<LegalAction, { kind: "resolve_pending_triggered_effect" }>;
  getCardDefinitionById: ApplyLegalActionOptions["getCardDefinitionById"];
  getRegisteredTriggeredEffectActions: ApplyLegalActionOptions["getRegisteredTriggeredEffectActions"];
}): boolean {
  const triggeredLookup = args.getRegisteredTriggeredEffectActions;
  if (typeof triggeredLookup !== "function") return false;
  return getAvailableTriggeredEffectSourceChoices({
    state: args.state,
    pendingEffect: args.pendingEffect,
    getCardDefinitionById: args.getCardDefinitionById,
    getRegisteredTriggeredEffectActions: triggeredLookup,
  }).some((sourceChoice) => {
    if (
      args.action.sourceInstanceId &&
      sourceChoice.sourceCard.instanceId !== args.action.sourceInstanceId
    ) {
      return false;
    }
    if (
      args.action.sourceEffectInstanceId &&
      sourceChoice.sourceEffectInstanceId !== args.action.sourceEffectInstanceId
    ) {
      return false;
    }
    const effectIndex =
      sourceChoice.actionRegistration.effectIndex ??
      sourceChoice.registrationIndex;
    if (
      args.action.registrationIndex !== undefined &&
      sourceChoice.registrationIndex !== args.action.registrationIndex
    ) {
      return false;
    }
    return (
      sourceChoice.sourceEffectDefinition.effects?.[effectIndex]?.steps.some(
        (step) => step.action.kind === "stay_on_field"
      ) ?? false
    );
  });
}

function getDeclinedBattleDestroyStayPending(
  state: GameState,
  action: LegalAction,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "skipOptionalEffect"
  >
): PendingTriggeredEffect | undefined {
  if (
    action.kind !== "resolve_pending_triggered_effect" ||
    (action.executionMode !== "optional" && !action.canSkipDuplicate) ||
    (options.skipOptionalEffect !== true && action.skipOnly !== true)
  ) {
    return undefined;
  }
  const pendingEffect = state.pendingTriggeredEffects.find(
    (pending) => pending.pendingId === action.pendingId
  );
  if (
    !pendingEffect ||
    pendingEffect.eventKind !== "battle_destroy_opponent_only" ||
    (pendingEffect.relatedInstanceIds ?? []).length === 0
  ) {
    return undefined;
  }
  return triggeredEffectSourceHasStayOnFieldStep({
    state,
    pendingEffect,
    action,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  })
    ? pendingEffect
    : undefined;
}

export function getRelatedInstanceIdsForPendingStayChoice(
  pendingEffect: PendingTriggeredEffect
): string[] {
  if (
    pendingEffect.relatedInstanceIds !== undefined &&
    pendingEffect.relatedInstanceIds.length > 0
  ) {
    return pendingEffect.relatedInstanceIds;
  }
  return pendingEffect.relatedInstanceId
    ? [pendingEffect.relatedInstanceId]
    : [];
}

function getRelatedInstanceIdsForPrivateLeaveDeclaration(
  declaration: PendingPrivateDeclaration
): string[] {
  if (
    declaration.relatedInstanceIds !== undefined &&
    declaration.relatedInstanceIds.length > 0
  ) {
    return [...declaration.relatedInstanceIds];
  }
  return declaration.relatedInstanceId ? [declaration.relatedInstanceId] : [];
}

function privateDeclarationRequiresPreFlushLeaveResolution(
  declaration: PendingPrivateDeclaration
): boolean {
  return (
    (declaration.registeredLeaveFieldStayOnFieldSourceKeys?.length ?? 0) > 0 ||
    (declaration.registeredLeaveFieldPreFlushSourceKeys?.length ?? 0) > 0
  );
}

function getDeclinedPrivateLeaveFieldDeclaration(
  state: GameState,
  action: LegalAction
): PendingPrivateDeclaration | undefined {
  if (
    action.kind !== "skip_private_triggered_effect" &&
    action.kind !== "declare_private_triggered_effect"
  ) {
    return undefined;
  }
  const declaration = state.pendingPrivateDeclarations.find(
    (pending) => pending.declarationId === action.declarationId
  );
  if (!declaration) return undefined;
  if (!privateDeclarationRequiresPreFlushLeaveResolution(declaration)) {
    return undefined;
  }
  return getRelatedInstanceIdsForPrivateLeaveDeclaration(declaration).length > 0
    ? declaration
    : undefined;
}

function isDeclinedRegisteredLeaveFieldStaySource(
  pendingEffect: PendingTriggeredEffect,
  action: Extract<LegalAction, { kind: "resolve_pending_triggered_effect" }>
): boolean {
  const sourceKeys = [
    ...(pendingEffect.registeredLeaveFieldStayOnFieldSourceKeys ?? []),
    ...(pendingEffect.registeredLeaveFieldPreFlushSourceKeys ?? []),
  ];
  if (!sourceKeys || sourceKeys.length === 0) return false;
  const sourceInstanceId =
    action.sourceEffectInstanceId ?? action.sourceInstanceId;
  if (!sourceInstanceId) return action.skipOnly === true;
  const sourceKey = makeResolvedTriggeredSourceKey(
    sourceInstanceId,
    action.registrationIndex
  );
  return (
    sourceKeys.includes(sourceKey) || sourceKeys.includes(sourceInstanceId)
  );
}

function getDeclinedRegisteredLeaveFieldStayPending(
  state: GameState,
  action: LegalAction,
  options: Pick<ApplyLegalActionOptions, "skipOptionalEffect">
): PendingTriggeredEffect | undefined {
  if (
    action.kind !== "resolve_pending_triggered_effect" ||
    (action.executionMode !== "optional" && !action.canSkipDuplicate) ||
    (options.skipOptionalEffect !== true && action.skipOnly !== true)
  ) {
    return undefined;
  }
  const pendingEffect = state.pendingTriggeredEffects.find(
    (pending) => pending.pendingId === action.pendingId
  );
  if (!pendingEffect) return undefined;
  if (getRelatedInstanceIdsForPendingStayChoice(pendingEffect).length === 0) {
    return undefined;
  }
  return isDeclinedRegisteredLeaveFieldStaySource(pendingEffect, action)
    ? pendingEffect
    : undefined;
}

function resolvedSourceKeysContain(
  resolvedKeys: Set<string>,
  sourceKey: string
): boolean {
  if (resolvedKeys.has(sourceKey)) return true;
  const sourceInstanceId = sourceKey.split("#", 1)[0];
  return sourceInstanceId !== undefined && resolvedKeys.has(sourceInstanceId);
}

function hasUnresolvedRegisteredLeaveFieldStaySource(
  pendingEffect: PendingTriggeredEffect
): boolean {
  const sourceKeys = [
    ...(pendingEffect.registeredLeaveFieldStayOnFieldSourceKeys ?? []),
    ...(pendingEffect.registeredLeaveFieldPreFlushSourceKeys ?? []),
  ];
  if (!sourceKeys || sourceKeys.length === 0) return false;
  const resolvedKeys = new Set(
    pendingEffect.resolvedSourceRegistrationKeys ?? []
  );
  return sourceKeys.some(
    (sourceKey) => !resolvedSourceKeysContain(resolvedKeys, sourceKey)
  );
}

function getStayedRelatedInstanceIdsAfterStayResolution(
  state: GameState,
  pendingEffect: PendingTriggeredEffect,
  resolvedSourceKey: string
): string[] {
  const staySourceKeys =
    pendingEffect.registeredLeaveFieldStayOnFieldSourceKeys;
  if (!staySourceKeys || staySourceKeys.length === 0) return [];
  const resolvedOnly = new Set([resolvedSourceKey]);
  if (
    !staySourceKeys.some((sourceKey) =>
      resolvedSourceKeysContain(resolvedOnly, sourceKey)
    )
  ) {
    return [];
  }

  const relatedIds =
    pendingEffect.relatedInstanceIdsBySourceRegistrationKey?.[
      resolvedSourceKey
    ] ?? getRelatedInstanceIdsForPendingStayChoice(pendingEffect);
  const pendingLeaveIds = new Set(
    state.pendingLeaveEntities.map((pending) => pending.instanceId)
  );
  return relatedIds.filter((instanceId) => {
    const card = getCardById(state, instanceId);
    return (
      card?.zone === "field" &&
      card.pendingLeaveKind === null &&
      !pendingLeaveIds.has(instanceId)
    );
  });
}

function getSourceKeysForRelatedInstances(
  pendingEffect: PendingTriggeredEffect,
  relatedInstanceIds: readonly string[]
): string[] {
  if (relatedInstanceIds.length === 0) return [];
  const relatedSet = new Set(relatedInstanceIds);
  const bySourceKey = pendingEffect.relatedInstanceIdsBySourceRegistrationKey;
  if (bySourceKey === undefined) return [];
  return Object.entries(bySourceKey)
    .filter(([, sourceRelatedIds]) =>
      sourceRelatedIds.some((relatedId) => relatedSet.has(relatedId))
    )
    .map(([sourceKey]) => sourceKey);
}

/**
 * 効果の発揮宣言に対するスタック窓を開く（02:200「常時以外の効果発揮」）。
 * 既存の親窓があればその下にサブスタックを積み、なければ新規 stack window を開く。
 * 誘発効果 (P3-34, card-backed / mechanic P3-92)、battle_immediate 効果
 * (アタック時/ブロック時/バトル終了時等。flash 窓前は新規 stack window)、
 * カードプレイ宣言（召喚許可・ネクサス自己配置許可）で共有する
 * （P3-113: 旧 `openPlayCardStackWindow` はこの関数と完全に同一の分岐ロジックだったため統合）。
 */
export function openEffectDeclarationStackWindow(args: {
  /** 窓種別の判定に使う宣言前 state */
  baseState: GameState;
  /** 通常召喚許可の宣言内 step より前。窓の選択には baseState を使う。 */
  rollbackBeforeState?: GameState;
  rollbackExcludedCardIds?: readonly string[];
  /** pending 除去 + 宣言ログ追加済みの state */
  stateAfterDeclaration: GameState;
  activeStack: ActiveStack;
  actingPlayerId: string;
}): GameState {
  const { baseState, stateAfterDeclaration, activeStack, actingPlayerId } =
    args;
  const stackWithDeclarationRollbackDelta =
    activeStack.normalHandPlayRollback !== undefined
      ? {
          ...activeStack,
          normalHandPlayRollback: {
            ...activeStack.normalHandPlayRollback,
            ...captureNormalHandPlayDeclarationRollbackDelta({
              beforeState: args.rollbackBeforeState ?? baseState,
              afterState: stateAfterDeclaration,
              ...(args.rollbackExcludedCardIds !== undefined
                ? { excludedCardInstanceIds: args.rollbackExcludedCardIds }
                : {}),
            }),
          },
        }
      : activeStack;
  if (baseState.stackWindow !== null) {
    return openStackSubWindowInStack(
      stateAfterDeclaration,
      stackWithDeclarationRollbackDelta,
      actingPlayerId
    );
  }
  if (baseState.preDeclarationStackWindow !== null) {
    return openPreDeclarationStackSubWindow(
      stateAfterDeclaration,
      stackWithDeclarationRollbackDelta,
      actingPlayerId
    );
  }
  if (baseState.activeAttack?.flashWindowState != null) {
    return openStackSubWindow(
      stateAfterDeclaration,
      stackWithDeclarationRollbackDelta,
      actingPlayerId
    );
  }
  // それ以外（main/start/draw/core/refresh/end の通常 window 配下）: 新規 stack window
  return openStackWindow(
    stateAfterDeclaration,
    stackWithDeclarationRollbackDelta,
    actingPlayerId
  );
}

/**
 * 保留 (deferred) 済み効果解決に対するスタック窓を開く。field 起動効果 / マジック / アクセル /
 * チェンジ等、`useXInFlashContextAsAction` 系で一度 deferred してから窓を開く機構が共有する
 * 分岐（P3-113 スライス2）。
 *
 * `openEffectDeclarationStackWindow` とは分岐順序が異なる（メインステップで能動的に使用した
 * 場合を preDeclarationStackWindow より先に判定し、新規 stack window を優先して開く）ため、
 * 単純合流はできず別エントリポイントとして共通化する。
 */
export function openDeferredDeclarationStackWindow(args: {
  /** 窓種別の判定に使う、deferred 処理適用前の state */
  baseState: GameState;
  /** deferred 処理適用済みの、実際に窓を開く対象 state */
  stateForWindow: GameState;
  activeStack: ActiveStack;
  actingPlayerId: string;
}): GameState {
  const { baseState, stateForWindow, activeStack, actingPlayerId } = args;
  if (baseState.stackWindow !== null) {
    return openStackSubWindowInStack(
      stateForWindow,
      activeStack,
      actingPlayerId
    );
  }
  if (
    baseState.step === "main" &&
    baseState.activePlayerId === actingPlayerId
  ) {
    return openStackWindow(stateForWindow, activeStack, actingPlayerId);
  }
  if (baseState.preDeclarationStackWindow !== null) {
    return openPreDeclarationStackSubWindow(
      stateForWindow,
      activeStack,
      actingPlayerId
    );
  }
  return openStackSubWindow(stateForWindow, activeStack, actingPlayerId);
}

/**
 * 遅延していたバースト発動宣言窓を再開する入口。
 * P3-113 の SSOT に合わせ、stack-resolution-core から低レベル opener を直接呼ばない。
 */
export function openQueuedBurstActivationDeclarationWindow(args: {
  stateForWindow: GameState;
  activeStack: ActiveStack;
  actingPlayerId: string;
}): GameState {
  return openBurstActivationStackWindow(
    args.stateForWindow,
    args.activeStack,
    args.actingPlayerId
  );
}

/**
 * 遅延していたバースト効果発揮宣言窓を再開する入口。
 * バースト効果は他の効果解決後に開くため、再開前 window を明示して復元する。
 */
export function openQueuedBurstEffectDeclarationWindow(args: {
  stateForWindow: GameState;
  activeStack: ActiveStack;
  actingPlayerId: string;
  previousWindow: GameState["window"];
  getCardDefinitionById: ApplyLegalActionOptions["getCardDefinitionById"];
}): GameState {
  return openBurstEffectDeclarationStackWindow(
    args.stateForWindow,
    args.activeStack,
    args.actingPlayerId,
    args.previousWindow,
    args.getCardDefinitionById
  );
}

export function getEffectResolutionSourceColors(
  state: GameState,
  sourceInstanceId: string,
  sourceDefinition: CardDefinition
): readonly CardDefinition["colors"][number][] {
  const sourceCard = getCardById(state, sourceInstanceId);
  return sourceCard
    ? getEffectiveColors(state, sourceCard, sourceDefinition)
    : sourceDefinition.colors;
}

type PendingTriggerSourceCarrier = Pick<
  PendingTriggeredEffect,
  "effectSourceInstanceId" | "effectSourceInstanceIds" | "relatedInstanceId"
>;

export function getPendingTriggerSourceInstanceIds(
  pendingEffect: PendingTriggerSourceCarrier
): string[] {
  const sourceIds = new Set<string>();
  if (pendingEffect.effectSourceInstanceId !== undefined) {
    sourceIds.add(pendingEffect.effectSourceInstanceId);
  }
  for (const sourceId of pendingEffect.effectSourceInstanceIds ?? []) {
    sourceIds.add(sourceId);
  }
  if (sourceIds.size === 0 && pendingEffect.relatedInstanceId) {
    sourceIds.add(pendingEffect.relatedInstanceId);
  }
  return [...sourceIds];
}

export function getPendingTriggerSourcePlayerId(
  state: GameState,
  pendingEffect: PendingTriggerSourceCarrier
): string | undefined {
  for (const sourceInstanceId of getPendingTriggerSourceInstanceIds(
    pendingEffect
  )) {
    const sourceCard = getCardById(state, sourceInstanceId);
    if (sourceCard) return sourceCard.controllerPlayerId;
  }
  return undefined;
}

/**
 * pending triggered effect の原因カード (`effectSourceInstanceId(s)`) の実効系統を、
 * `trigger_tribes`/`trigger_source_match` 条件評価用の `TriggerContext.sourceTribes`
 * として導出する。カード印字/CE 由来の実効系統 (`getEffectiveTribes`) と、
 * 効果メタ属性としての系統タグ (`Effect.effectTribes`、`getEffectTribeGrants`) を
 * union する（BSTH03-C03『相手のカウント1以上のとき、この効果は系統：「蓬莱」を持つ』が
 * BSTH03-X02『自分の系統：「蓬莱」を持つ効果で、自分のライフが増えたとき』から
 * 観測可能になる）。効果発生源を持たない旧式イベントは `relatedInstanceId` に fallback し、
 * 原因カードが特定できない場合は undefined。
 */
export function getPendingTriggerSourceTribes(
  state: GameState,
  pendingEffect: PendingTriggerSourceCarrier,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): readonly string[] | undefined {
  const sourceInstanceId = getPendingTriggerSourceInstanceIds(pendingEffect)[0];
  if (!sourceInstanceId) return undefined;
  const sourceCard = getCardById(state, sourceInstanceId);
  const sourceDef = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (!sourceCard || !sourceDef) return undefined;
  const effective = getEffectiveTribes(
    state,
    sourceCard,
    sourceDef,
    getCardDefinitionById
  );
  const grants = getEffectTribeGrants(
    state,
    sourceCard.instanceId,
    sourceDef,
    sourceCard.controllerPlayerId,
    getCardDefinitionById
  );
  if (grants.length === 0) return effective;
  const result = [...effective];
  for (const tribe of grants) {
    if (!result.includes(tribe)) result.push(tribe);
  }
  return result;
}

/**
 * 通常の effect finalize を経由しない action のうち、解決済みの pending leave を
 * stable point で flush できるもの。DeckReveal / TargetRedirect の継続再開に加え、
 * multi placement の abort も元 effect を閉じるためここへ含める。
 */
const PENDING_LEAVE_FLUSH_STABLE_ACTION_KINDS: ReadonlySet<string> = new Set([
  "resolve_pending_deck_reveal_pick",
  "resolve_pending_deck_reveal_order",
  "confirm_target_redirect",
  "decline_target_redirect",
  "abort_pending_multi_placement",
]);

function getPendingLeaveSourceContext(
  state: GameState,
  pendingLeaves: readonly GameState["pendingLeaveEntities"][number][],
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): {
  causedBySourceInstanceId?: string | null;
  sourceColors?: readonly CardDefinition["colors"][number][];
  sourceCategory?: CardCategory;
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
  const sourceCard = getCardById(state, sourceInstanceIds[0]!);
  const sourceDefinition = sourceCard
    ? getCardDefinitionById(sourceCard.definitionId)
    : undefined;
  if (sourceCard === undefined || sourceDefinition === undefined) {
    return { causedBySourceInstanceId };
  }
  return {
    causedBySourceInstanceId,
    sourceColors: getEffectResolutionSourceColors(
      state,
      sourceCard.instanceId,
      sourceDefinition
    ),
    sourceCategory: sourceDefinition.printedCategory,
  };
}

function flushPendingLeavesAndCollectReactionsAfterChoice(options: {
  state: GameState;
  pendingLeaveInstanceIds: ReadonlySet<string>;
  chainId: string | null;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: ApplyLegalActionOptions["getRegisteredTriggeredEffectActions"];
  getRegisteredBurstActions: ApplyLegalActionOptions["getRegisteredBurstActions"];
  /**
   * 既存の pending leave を選択解決後に実移動する場合、差分収集では leave event を
   * 再発見できないため、登録済み反応も pre-flush で queue する。
   */
  queueRegisteredPreFlush?: boolean;
  ignoredPrivateDeclarationSourceKeys?: readonly string[];
  preserveContinuations?: true;
}): GameState {
  const scopedPendingLeaves = options.state.pendingLeaveEntities.filter(
    (pendingLeave) =>
      options.pendingLeaveInstanceIds.has(pendingLeave.instanceId)
  );
  if (scopedPendingLeaves.length === 0) return options.state;

  // 全原因の flush でも、実移動に伴う手札増加・魂状態・トラッシュ増加は
  // 離脱を発生させた原因ごとに収集する。null は探索範囲であり誘発の原因ではない。
  if (options.chainId === null) {
    const groups = new Map<string, Set<string>>();
    for (const leave of scopedPendingLeaves) {
      const chainId = requireTriggerChainId(leave.chainId);
      const ids = groups.get(chainId) ?? new Set<string>();
      ids.add(leave.instanceId);
      groups.set(chainId, ids);
    }
    let state = options.state;
    for (const [chainId, pendingLeaveInstanceIds] of groups) {
      state = flushPendingLeavesAndCollectReactionsAfterChoice({
        ...options,
        state,
        chainId,
        pendingLeaveInstanceIds,
      });
    }
    return state;
  }

  const otherPendingLeaves = options.state.pendingLeaveEntities.filter(
    (pendingLeave) =>
      !options.pendingLeaveInstanceIds.has(pendingLeave.instanceId)
  );
  // 選択済み離脱の実移動は、退避中の外側スタックを再開するより先。
  // 次候補の探索 (preserveContinuations) では元の継続ゲートを維持する。
  const pendingStackCascade =
    options.preserveContinuations &&
    options.state.pendingStackCascade?.remainingStacks.length !== 0
      ? options.state.pendingStackCascade
      : null;
  const scopedState: GameState = {
    ...options.state,
    pendingLeaveEntities: scopedPendingLeaves,
    pendingAfterTriggersContinuations: options.preserveContinuations
      ? options.state.pendingAfterTriggersContinuations
      : [],
    pendingStackCascade,
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
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    queueRegisteredPreFlush: options.queueRegisteredPreFlush ?? false,
    ...(options.queueRegisteredPreFlush
      ? {
          registeredPreFlushPendingLeaveInstanceIds:
            options.pendingLeaveInstanceIds,
        }
      : {}),
    ...flushSourceContext,
  });
  if (scopedAfterFlush === scopedState) return options.state;

  const afterFlush: GameState = {
    ...scopedAfterFlush,
    pendingAfterTriggersContinuations:
      options.state.pendingAfterTriggersContinuations,
    pendingStackCascade: options.state.pendingStackCascade,
    pendingLeaveEntities: [
      ...otherPendingLeaves,
      ...scopedAfterFlush.pendingLeaveEntities,
    ],
  };

  const queued = collectAndQueueTriggerReactions({
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
  const ignoredPrivateDeclarationSourceKeys = new Set(
    options.ignoredPrivateDeclarationSourceKeys ?? []
  );
  if (ignoredPrivateDeclarationSourceKeys.size === 0) return queued;

  const pendingPrivateDeclarations = queued.pendingPrivateDeclarations.filter(
    (declaration) => {
      const declarationSourceKey = makeResolvedTriggeredSourceKey(
        declaration.sourceInstanceId,
        declaration.registrationIndex
      );
      if (!ignoredPrivateDeclarationSourceKeys.has(declarationSourceKey)) {
        return true;
      }
      const relatedInstanceIds =
        getRelatedInstanceIdsForPrivateLeaveDeclaration(declaration);
      return !relatedInstanceIds.some((instanceId) =>
        options.pendingLeaveInstanceIds.has(instanceId)
      );
    }
  );

  if (
    pendingPrivateDeclarations.length ===
    queued.pendingPrivateDeclarations.length
  ) {
    return queued;
  }

  // registeredLeaveFieldStayOnFieldSourceKeys による離脱確定では、同じ source
  // の未選択 private declaration をまとめて除去する。この時に同時誘発 group の
  // 最後の sibling も除去された場合、既に宣言済みで deferred に置いた効果を
  // publish しないと private queue は空なのに deferred だけが orphan する。
  // この分岐で prune した bucket だけを flush し、別経路の invariant 違反を
  // 自動救済しないようにする。
  const remainingDeclarationIds = new Set(
    pendingPrivateDeclarations.map((declaration) => declaration.declarationId)
  );
  const prunedPrivateDeclarations = queued.pendingPrivateDeclarations.filter(
    (declaration) => !remainingDeclarationIds.has(declaration.declarationId)
  );
  const deferredToFlush = queued.pendingDeferredTriggeredEffects.filter(
    (pending) =>
      pending.simultaneousGroupId !== undefined &&
      prunedPrivateDeclarations.some((declaration) =>
        isSameDeferredTriggerBucket(pending, declaration)
      ) &&
      !pendingPrivateDeclarations.some((declaration) =>
        isSameDeferredTriggerBucket(pending, declaration)
      )
  );
  if (deferredToFlush.length === 0) {
    return { ...queued, pendingPrivateDeclarations };
  }
  const deferredIdsToFlush = new Set(
    deferredToFlush.map((pending) => pending.pendingId)
  );
  return {
    ...queued,
    pendingPrivateDeclarations,
    // The deferred declaration predates reactions collected by this leave
    // flush, so retain that resolution order.
    pendingTriggeredEffects: [
      ...deferredToFlush,
      ...queued.pendingTriggeredEffects,
    ],
    pendingDeferredTriggeredEffects:
      queued.pendingDeferredTriggeredEffects.filter(
        (pending) => !deferredIdsToFlush.has(pending.pendingId)
      ),
  };
}

/** 宣言・解決・辞退・継続の共通出口。外側の after_triggers 再開より先に離脱を再判定する。 */
export function flushPendingLeavesAfterReactionProgress(
  state: GameState,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  const reactionBoundLeaveIds = new Set(
    state.pendingLeaveEntities
      .filter((leave) => (leave.reactionChainIds?.length ?? 0) > 0)
      .map((leave) => leave.instanceId)
  );
  if (reactionBoundLeaveIds.size === 0) return state;
  return flushPendingLeavesAndCollectReactionsAfterChoice({
    state,
    pendingLeaveInstanceIds: reactionBoundLeaveIds,
    chainId: null,
    // 発生時に収集した反応を再生成しない。未解決反応・継続・スタックは共通 gate が判定する。
    preserveContinuations: true,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

export function flushPendingLeavesAfterRegisteredStayOnFieldChoiceResolved(options: {
  state: GameState;
  pendingEffect: PendingTriggeredEffect;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: ApplyLegalActionOptions["getRegisteredTriggeredEffectActions"];
  getRegisteredBurstActions: ApplyLegalActionOptions["getRegisteredBurstActions"];
}): GameState {
  const staySourceKeys =
    options.pendingEffect.registeredLeaveFieldStayOnFieldSourceKeys;
  const preFlushSourceKeys =
    options.pendingEffect.registeredLeaveFieldPreFlushSourceKeys;
  if (
    (!staySourceKeys || staySourceKeys.length === 0) &&
    (!preFlushSourceKeys || preFlushSourceKeys.length === 0)
  ) {
    return options.state;
  }
  const relatedInstanceIds = getRelatedInstanceIdsForPendingStayChoice(
    options.pendingEffect
  );
  if (relatedInstanceIds.length === 0) return options.state;
  return flushPendingLeavesAndCollectReactionsAfterChoice({
    state: options.state,
    pendingLeaveInstanceIds: new Set(relatedInstanceIds),
    chainId: options.pendingEffect.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

function hasPendingPreDeclarationConfirmationBlocker(
  state: GameState
): boolean {
  // 1-pass で閉じた宣言前 stack は、残っていたバーストの effect-declaration
  // stack を開く前に declaration を確定してはならない。ここで stackWindow を
  // blocker に含めないと、outer apply の cascade resume が burst 窓を開いた直後に
  // forced_block を確定し、window=declare_block と stackWindow が共存する
  // 不整合になる (EDH-0008-00)。
  return (
    state.stackWindow !== null ||
    hasOutstandingEffectResolutionContinuation({
      ...state,
      pendingPreDeclarationConfirmation: null,
    })
  );
}

function finalizePendingPreDeclarationConfirmationIfReady(
  state: GameState,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredBattleImmediateEffectActions"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  const closedWin = state.pendingPreDeclarationConfirmation;
  if (closedWin === null) return state;
  if (hasPendingPreDeclarationConfirmationBlocker(state)) return state;

  const stateWithoutContinuation: GameState = {
    ...state,
    pendingPreDeclarationConfirmation: null,
  };

  if (closedWin.kind === "attack") {
    const confirmResult = confirmAttackDeclarationAsAction(
      closedWin,
      stateWithoutContinuation,
      {
        ...options,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }
    );
    return advanceAttackDeclarationStateIfReady(confirmResult.state, options);
  }

  if (closedWin.kind === "block" || closedWin.kind === "forced_block") {
    return confirmBlockDeclarationAsAction(
      closedWin,
      stateWithoutContinuation,
      options
    ).state;
  }

  if (closedWin.kind === "join_active_attack") {
    const confirmResult = confirmJoinActiveAttackDeclarationAsAction(
      closedWin,
      stateWithoutContinuation,
      options
    );
    return advanceAttackDeclarationStateIfReady(confirmResult.state, options);
  }

  return stateWithoutContinuation;
}

export function applyLegalAction(
  options: ApplyLegalActionOptions
): ApplyLegalActionResult {
  assertPendingTriggerChainIds(options.state);
  // 配送用ロックは入力前の操作主体を守る。解決後まで持ち越すと、同じ action 内の
  // ステップ/ターン終了が「未解決の選択」と誤認する。実際の pending はそのまま
  // 残し、選択を解決する前に配送時点のロックだけを消費する。
  const promptLock = options.state.pendingPromptLock;
  if (promptLock) {
    if (!promptLock.resolverPlayerIds.includes(options.action.actingPlayerId)) {
      throw new Error(
        "applyLegalAction blocked: waiting for another player's choice"
      );
    }
    options = {
      ...options,
      state: { ...options.state, pendingPromptLock: null },
    };
  }
  const checkedState = applyLifeZeroDefeat(options.state);
  if (checkedState !== options.state) {
    return {
      state: checkedState,
      outcome: "priority_transferred",
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  }
  const declinedRegisteredLeaveFieldStayPending =
    getDeclinedRegisteredLeaveFieldStayPending(
      options.state,
      options.action,
      options
    );
  const declinedBattleDestroyStayPending = getDeclinedBattleDestroyStayPending(
    options.state,
    options.action,
    options
  );
  const declinedPrivateLeaveDeclaration =
    getDeclinedPrivateLeaveFieldDeclaration(options.state, options.action);
  const result = applyLegalActionCore(options);
  let state = applyLifeZeroDefeat(result.state);
  if (state.gameResult !== null) {
    return {
      ...result,
      state: appendPublicDisclosuresForStateTransition({
        before: options.state,
        after: state,
        actorPlayerId: options.action.actingPlayerId,
        action: options.action,
      }),
    };
  }

  // 03f: 召喚後の最後の任意誘発を辞退しても、支払い由来の待機はチェーン終端で実移動する。
  state = pruneIllegalPendingTriggeredEffects({
    state,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
  const beforeBattlePruning = state;
  state = pruneUnavailableBattleImmediateEffects({
    ...options,
    state,
    actingPlayerId: options.action.actingPlayerId,
    getRegisteredFieldCardEffectActions:
      options.getRegisteredFieldCardEffectActions ?? (() => []),
  });
  if (state !== beforeBattlePruning)
    state = pruneIllegalPendingTriggeredEffects({
      state,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    });
  // 無関係な離脱には触れず、継続/子チェーンの終了判定は共通 flush の gate に委ねる。
  if (
    options.action.kind === "resolve_pending_triggered_effect" &&
    (options.skipOptionalEffect || options.action.skipOnly)
  ) {
    const declinedId = options.action.pendingId;
    const declined = options.state.pendingTriggeredEffects.find(
      (p) => p.pendingId === declinedId
    );
    if (
      declined?.chainId &&
      !state.pendingTriggeredEffects.some((p) => p.pendingId === declinedId)
    ) {
      const declinedChainId = declined.chainId;
      const paymentLeaves = state.pendingLeaveEntities.filter(
        (p) =>
          p.cause === "cost_payment" &&
          p.chainId !== null &&
          isChainAtOrUnder(declinedChainId, p.chainId)
      );
      if (paymentLeaves.length > 0) {
        state = flushPendingLeavesAndCollectReactionsAfterChoice({
          state,
          pendingLeaveInstanceIds: new Set(
            paymentLeaves.map((p) => p.instanceId)
          ),
          chainId: declined.chainId,
          preserveContinuations: true,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
        });
      }
    }
  }

  // P3-108 Item3 (根治計画 Stage1): effect finalize を通らない継続再開/abort は、
  // 同一チェーンで消滅した待機 (例: コスト支払い消滅) を stranded させうる。継続が
  // 完了 (= pending クリア) し、かつバトルフラッシュ窓中でない (activeAttack === null) ときに
  // flushPendingLeaves を呼ぶ。flush 自体は canFlushPendingLeaveEntity で per-leave に
  // sub-chain 閉鎖を判定するため、まだ別継続が pending なら no-op で安全。
  // バトル窓中 (p3-76: activeAttack 非 null) はバトル解決側の flush に委ねる (= 据置)。
  if (
    PENDING_LEAVE_FLUSH_STABLE_ACTION_KINDS.has(options.action.kind) &&
    state.activeAttack === null &&
    state.pendingDeckReveal === null &&
    state.pendingTargetRedirects.length === 0
  ) {
    state = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
      state,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  // 煌臨元置換で「トラッシュ」を選択済みの離脱は、battle_end の後続 optional が
  // 閉じるまで flush gate により保留され得る。既存 pending をこの時点で実移動した
  // 差分は通常の reaction collector では新規 pending leave として観測できないため、
  // optional 解決のうちこの marker を持つものだけ pre-flush で登録済み card_event /
  // burst 反応も queue する。通常の optional 解決へ flush timing を広げない。
  if (
    options.action.kind === "resolve_pending_step_optional_choice" &&
    state.activeAttack === null &&
    state.pendingDeckReveal === null &&
    state.pendingTargetRedirects.length === 0
  ) {
    const adventReplacementDeclinedLeaveIds = new Set(
      state.pendingLeaveEntities
        .filter(
          (pendingLeave) =>
            pendingLeave.adventSourceReplacementDeclined === true
        )
        .map((pendingLeave) => pendingLeave.instanceId)
    );
    if (adventReplacementDeclinedLeaveIds.size > 0) {
      state = flushPendingLeavesAndCollectReactionsAfterChoice({
        state,
        pendingLeaveInstanceIds: adventReplacementDeclinedLeaveIds,
        chainId: null,
        queueRegisteredPreFlush: true,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      });
    }
  }

  // battle_end 由来の「アタックステップを終了する。その後〜できる。」の後段 optional
  // が閉じた時点では、deferred chain 自身だけを対象にした finalizeEffectResolution の
  // flush が既に済んでいる。一方で、そのバトル中に SBA で生じた通常の pending leave は
  // battle_end chain の外側なので残り得る。このまま end-attack reservation を finalize
  // すると、待機離脱が blocker のまま次の advanceStep が永久に止まる。
  //
  // この経路は (1) battle_end deferred optional を実際に解決した action、(2) その終了
  // 予約が残っている、の両方に限定する。任意効果一般やバトルフラッシュ中の継続へ flush
  // timing を広げず、canFlushPendingLeaveEntity の chain-closure gate も維持する。
  const resolvedBattleEndDeferredOptional =
    options.action.kind === "resolve_pending_step_optional_choice" &&
    options.state.pendingStepOptionalChoice?.continuation
      .battleEndDeferralAttackId !== undefined;
  // `end_attack_step` は deferred optional だけでなく、転醒に必要なコア配置の
  // continuation が終端まで進んだときにもここで予約される。後者は
  // `resolve_pending_core_distribution` が effect の残り step（battle_end の
  // end_attack_step）まで同期実行するため、optional 専用の判定では取りこぼす。
  // 新たに予約された上で他の effect continuation がなければ、同じバトル由来の
  // pending leave を drain してから attack-step finalization を許可する。
  const openedAttackStepEndFinalization =
    state.pendingAttackStepEndFinalizations.length >
    options.state.pendingAttackStepEndFinalizations.length;
  const resolvedBattleEndDeferredEndAttack =
    resolvedBattleEndDeferredOptional ||
    (openedAttackStepEndFinalization &&
      !hasOutstandingEffectResolutionContinuation(state));
  if (
    resolvedBattleEndDeferredEndAttack &&
    state.pendingAttackStepEndFinalizations.length > 0 &&
    state.pendingLeaveEntities.length > 0
  ) {
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set(
        state.pendingLeaveEntities.map(
          (pendingLeave) => pendingLeave.instanceId
        )
      ),
      chainId: null,
      queueRegisteredPreFlush: true,
      preserveContinuations: true,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  // ENGINE-grant-effect-pre-flush-window: granted_effect 残置選択 (stay_on_field 等) を
  // 辞退した場合、辞退の skip 経路は finalize/flush を通らない (accept 経路は
  // executeEffect → finalizeEffectResolution が既に flush 済み)。
  // canFlushPendingLeaveEntity の hasPendingGrantedEffectLeaveReactionForLeaver ゲートが
  // 解消された時点で flushPendingLeaves を呼び直し、待機を stranded させない。
  // scope を「解決対象が granted_effect mechanic pending だった場合」に限定する — 通常の
  // 登録済み誘発 (count+1 等) 辞退後に無条件で再 flush すると、そのタイミングで偶然
  // canFlushPendingLeaveEntity が真になる無関係な待機 (例1: コスト支払い消滅の
  // deferZoneMoveUntilChainEnd 待ち) まで意図しない時点で flush してしまい、
  // 「破壊 → 誘発 → この効果発揮後ドロー」順序 (P3-84 統合) を崩す
  // (実測: 2026-07-02 に無条件版を試して該当 e2e が回帰・revert)。
  if (options.action.kind === "resolve_pending_triggered_effect") {
    const resolvedPendingId = options.action.pendingId;
    const resolvedWasGrantedEffect =
      options.state.pendingTriggeredEffects.find(
        (p) => p.pendingId === resolvedPendingId
      )?.mechanic?.kind === "granted_effect";
    // 受諾時はここでは宣言だけで stack 窓が開く。解決前に flush すると
    // stay_on_field 等の付与効果が間に合わないため、辞退/no-op の同期 drain のみ対象。
    if (
      resolvedWasGrantedEffect &&
      state.activeAttack === null &&
      state.stackWindow === null
    ) {
      state = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
        state,
        getCardDefinitionById: options.getCardDefinitionById,
        queueGrantedEffects: false,
      });
    }
  }

  const declinedStayPending =
    declinedRegisteredLeaveFieldStayPending ?? declinedBattleDestroyStayPending;
  if (
    declinedStayPending &&
    !state.pendingTriggeredEffects.some(
      (pending) =>
        pending.pendingId === declinedStayPending.pendingId &&
        (declinedRegisteredLeaveFieldStayPending
          ? hasUnresolvedRegisteredLeaveFieldStaySource(pending)
          : true)
    )
  ) {
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set(
        getRelatedInstanceIdsForPendingStayChoice(declinedStayPending)
      ),
      chainId: declinedStayPending.chainId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  if (
    declinedPrivateLeaveDeclaration &&
    (options.action.kind === "skip_private_triggered_effect" ||
      ("declared" in result && result.declared === false)) &&
    !state.pendingPrivateDeclarations.some(
      (declaration) =>
        declaration.declarationId ===
        declinedPrivateLeaveDeclaration.declarationId
    )
  ) {
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set(
        getRelatedInstanceIdsForPrivateLeaveDeclaration(
          declinedPrivateLeaveDeclaration
        )
      ),
      chainId: declinedPrivateLeaveDeclaration.chainId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ignoredPrivateDeclarationSourceKeys: [
        makeResolvedTriggeredSourceKey(
          declinedPrivateLeaveDeclaration.sourceInstanceId,
          declinedPrivateLeaveDeclaration.registrationIndex
        ),
      ],
    });
  }

  if (
    options.action.kind === "resolve_brave_leave_choice" &&
    options.action.choice !== "inherit_soul_state" &&
    state.pendingBraveLeaveChoice === null &&
    options.state.pendingBraveLeaveChoice !== null &&
    state.pendingSoulStateReplacement?.cardInstanceId !==
      options.state.pendingBraveLeaveChoice.hostInstanceId
  ) {
    const choicePending = options.state.pendingBraveLeaveChoice;
    const choiceChainId =
      state.pendingLeaveEntities.find(
        (pendingLeave) =>
          pendingLeave.instanceId === choicePending.hostInstanceId
      )?.chainId ?? null;
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set([
        choicePending.hostInstanceId,
        ...choicePending.braveInstanceIds,
      ]),
      chainId: choiceChainId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  // 1つ目の選択後、残る合体ホストのブレイヴ選択を同じ操作内で再開する。
  // 魂状態の確定を先に待ち、他の離脱者や未解決効果の継続は進めない。
  if (
    options.action.kind === "resolve_brave_leave_choice" &&
    options.action.choice !== "inherit_soul_state" &&
    state.pendingBraveLeaveChoice === null &&
    state.pendingSoulStateReplacement === null &&
    state.pendingLeaveEntities.length > 0
  ) {
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set(
        state.pendingLeaveEntities
          .filter(
            (leave) =>
              (getCardById(state, leave.instanceId)?.attachedChildrenIds
                .length ?? 0) > 0
          )
          .map((leave) => leave.instanceId)
      ),
      chainId: null,
      preserveContinuations: true,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  if (
    options.action.kind === "resolve_soul_state_replacement" &&
    options.action.choice === "keep" &&
    state.pendingBraveLeaveChoice === null &&
    state.pendingLeaveEntities.length > 0
  ) {
    const replacementCardInstanceId =
      options.state.pendingSoulStateReplacement?.leavingCardInstanceId ??
      options.action.cardInstanceId;
    const replacementChainId =
      options.state.pendingLeaveEntities.find(
        (pendingLeave) => pendingLeave.instanceId === replacementCardInstanceId
      )?.chainId ?? null;
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set(
        state.pendingLeaveEntities.map(
          (pendingLeave) => pendingLeave.instanceId
        )
      ),
      chainId: replacementChainId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  if (
    options.action.kind === "resolve_soul_state_replacement" &&
    options.action.choice === "decline" &&
    state.pendingBraveLeaveChoice === null &&
    options.state.pendingSoulStateReplacement?.cardInstanceId ===
      options.action.cardInstanceId
  ) {
    const replacementCardInstanceId =
      options.state.pendingSoulStateReplacement?.leavingCardInstanceId ??
      options.action.cardInstanceId;
    const replacementChainId =
      options.state.pendingLeaveEntities.find(
        (pendingLeave) => pendingLeave.instanceId === replacementCardInstanceId
      )?.chainId ?? null;
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      // 同行ブレイヴを含め、魂状態選択を待っていた同じ離脱チェーンを確定する。
      pendingLeaveInstanceIds: new Set(
        state.pendingLeaveEntities
          .filter(
            (leave) =>
              leave.instanceId === replacementCardInstanceId ||
              (replacementChainId !== null &&
                leave.chainId === replacementChainId)
          )
          .map((leave) => leave.instanceId)
      ),
      chainId: replacementChainId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  if (
    options.action.kind === "resolve_advent_source_replacement" &&
    options.state.pendingAdventSourceReplacement?.cardInstanceId ===
      options.action.cardInstanceId
  ) {
    const replacementCardInstanceId = options.action.cardInstanceId;
    const replacementChainId =
      options.state.pendingLeaveEntities.find(
        (pendingLeave) => pendingLeave.instanceId === replacementCardInstanceId
      )?.chainId ?? null;
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set([replacementCardInstanceId]),
      chainId: replacementChainId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  // 個別の離脱確定後、別チェーンも含む未選択カードの次の選択を開く。
  // 原因効果・派生効果の継続は保持し、flush の既存ゲートで可否を判定する。
  if (
    (options.action.kind === "resolve_soul_state_replacement" ||
      options.action.kind === "resolve_advent_source_replacement") &&
    state.pendingLeaveEntities.length > 0
  ) {
    state = flushPendingLeavesAndCollectReactionsAfterChoice({
      state,
      pendingLeaveInstanceIds: new Set(
        state.pendingLeaveEntities.map((leave) => leave.instanceId)
      ),
      chainId: null,
      preserveContinuations: true,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }
  state = flushPendingLeavesAfterReactionProgress(state, options);

  // A stack cascade can finish while an effect continuation was resolving and
  // leave its empty marker behind. It is not a player-facing pending action,
  // but it blocks a deferred pre-declaration confirmation until the common
  // cascade resume path clears it (EDH-0007 forced-block replay).
  if (
    state.pendingAfterTriggersContinuations.length > 0 ||
    state.pendingStackCascade !== null ||
    state.pendingTargetedDisclosureContinuation?.bodyResolutionCompleted ===
      true
  ) {
    state = resumeStackCascadeIfReady(state, options);
  }
  state = finalizePendingPreDeclarationConfirmationIfReady(state, options);

  const afterCompletions = flushReadyEffectCompletions(state, options);
  if (afterCompletions !== state)
    state = resumeStackCascadeIfReady(afterCompletions, options);

  // moved_to_trash 任意手札追加の発火待ちを、安定点（他 pending 無し）で pendingDeckReveal に変換する。
  // ソース効果（とその pending）が解決し切った後に R12 等の任意追加プロンプトを出すためのフック。
  // finalizePendingAccelCleanups を先に呼ぶ: アクセル/チェンジ自身の使用後 cleanup
  // (pendingAccelCleanups) がこの時点でまだ残っていると materializeDeferredTrashOptionalAdds の
  // ガードでブロックされ、同じ安定点で発火し損ねて次の無関係な合法手まで持ち越されてしまう
  // (実戦バグ 2026-07-20: 小悪魔アクセルで落ちたルナクロックの任意追加が紅魔館配置時まで遅延)。
  const hadPendingAccelCleanups = (state.pendingAccelCleanups ?? []).length > 0;
  let afterAccelCleanups = finalizePendingAccelCleanups(
    state,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  if (hadPendingAccelCleanups && afterAccelCleanups.pendingStackCascade) {
    afterAccelCleanups = resumeStackCascadeIfReady(afterAccelCleanups, options);
  }
  let finalState = materializeDeferredTrashOptionalAdds(afterAccelCleanups);
  finalState = applyLifeZeroDefeat(finalState);

  // P3-108 Item3 (Stage 3): mid-effect 継続で中断していた効果の endLogs を、継続が全て解決し
  // 効果が真に閉じた時点で log へ流す (early endLog 表示の是正)。materialize が新たな
  // pendingDeckReveal を立てた場合は hasOutstanding が真のままで drain しない (次の閉鎖まで持ち越し)。
  const stashedEndLogs = finalState.pendingResolutionEndLogs ?? [];
  if (
    stashedEndLogs.length > 0 &&
    !hasOutstandingEffectResolutionContinuation(finalState)
  ) {
    finalState = {
      ...finalState,
      log: [...finalState.log, ...stashedEndLogs],
      pendingResolutionEndLogs: [],
    };
  }

  const afterRebirthPrune = pruneConsumedRebirthBattleImmediateEffects(
    finalState,
    options
  );
  if (afterRebirthPrune !== finalState) {
    finalState = advanceAttackDeclarationStateIfReady(
      afterRebirthPrune,
      options
    );
  }
  // 全アクション共通の安定点。個別 kind の列挙では、入力・離脱選択の追加時に
  // 最後の再開だけが漏れてバトル寿命の終了予約を取り残す。待機判定は共通 drain が担う。
  if (
    finalState.stackWindow === null &&
    (finalState.pendingImmediateBattleEnds.length > 0 ||
      finalState.pendingBattleEndFinalizeAttackIds.length > 0)
  ) {
    finalState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      finalState,
      options
    );
  }
  // duration 無し negate request は既に解決済み stack だけを対象とする one-shot なので、
  // action の安定点で先に落とす。先に attack-step finalization を試すと blocker 扱いで
  // pending entry を残し、cleanup 後に再試行されないまま次の advanceStep を塞いでしまう。
  finalState = finalizeOneShotStackNegateRequestsAtStableBoundary(finalState);
  finalState = finalizeCardUsageAndQueueTriggers(finalState, {
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  finalState = finalizePendingEndFinalizations(
    finalState,
    options.getCardDefinitionById,
    (args) =>
      evaluateAttackStepEndBlockedRetryCondition({
        ...args,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
    options
  );
  // 任意ステップや発揮後継続が最後の攻撃時効果を閉じた場合も、
  // 全効果の安定点で指定アタックのブロック前窓を進める。
  if (
    finalState.step === "attack" &&
    finalState.window === "declare_attack" &&
    !hasOutstandingEffectResolutionContinuation(finalState) &&
    (finalState.pendingEffectCompletions ?? []).length === 0
  ) {
    finalState = advanceAttackDeclarationStateIfReady(finalState, options);
  }
  // 宣言確定と派生反応の完了後に、同じ待機判定で追加ターンを開始する。
  // 空の宣言前 stack でも、確定前に復帰文脈を保存してはならない。
  if (finalState.gameResult === null)
    finalState = startDeferredExtraTurnIfReady(finalState, options);
  // 公開情報は action 全体が確定した出口で state 差分から採取する。
  // 個別ハンドラやデバッグ log の記法に依存せず、対象宣言が先に emit 済みなら
  // 同一 record の results として補完する。
  finalState = pruneImmediateAttackJoins({
    ...options,
    state: finalState,
    actingPlayerId: options.action.actingPlayerId,
    getRegisteredFieldCardEffectActions:
      options.getRegisteredFieldCardEffectActions ?? (() => []),
  });
  finalState = appendPublicDisclosuresForStateTransition({
    before: options.state,
    after: finalState,
    actorPlayerId: options.action.actingPlayerId,
    action: options.action,
  });

  return { ...result, state: applyLifeZeroDefeat(finalState) };
}

/**
 * action.kind → handler の唯一の dispatch 正源 (P2-11 phase6 根治)。
 * `LegalActionHandlerMap` のマップ型で「全 kind に handler」をコンパイラに強制する
 * (移行完了後に `Partial` を外すと未登録 kind がコンパイルエラーになる)。
 * `check:wiring` は `["<kind>"]:` テーブル dispatch を consumer として認識する。
 */
// キー型は LegalAction["kind"] を正源とする (手動 union LegalActionKind は乖離があり使わない)。
type LegalActionHandler<K extends LegalAction["kind"]> = (
  options: ApplyLegalActionOptions,
  action: Extract<LegalAction, { kind: K }>
) => ApplyLegalActionResult;

// 非 optional: 全 LegalAction["kind"] に handler が無いとコンパイルエラー
// (= dispatch の網羅性をコンパイラが強制する。根治の中核)。
type LegalActionHandlerMap = {
  [K in LegalAction["kind"]]: LegalActionHandler<K>;
};

function hasUnblockedAttackParticipantStillOnField(state: GameState): boolean {
  const activeAttack = state.activeAttack;
  if (activeAttack === null) return false;

  for (const assignment of activeAttack.blockAssignments) {
    if (assignment.blockedByEntityIds.length > 0) continue;

    const battleEntity = state.battleEntities.find(
      (entity) => entity.entityId === assignment.participantEntityId
    );
    if (!battleEntity) continue;

    if (
      battleEntity.memberInstanceIds.some((instanceId) => {
        const card = getCardById(state, instanceId);
        return card?.zone === "field" && card.pendingLeaveKind === null;
      })
    ) {
      return true;
    }
  }

  return false;
}

function applyFallthroughHandler_declare_private_triggered_effect_skip_private_triggered_effect(
  options: ApplyLegalActionOptions,
  action: Extract<
    LegalAction,
    | { kind: "declare_private_triggered_effect" }
    | { kind: "skip_private_triggered_effect" }
  >
): ApplyLegalActionResult {
  const declaration = options.state.pendingPrivateDeclarations.find(
    (current) => current.declarationId === action.declarationId
  );

  if (!declaration) {
    throw new Error(
      `Unknown private triggered declaration: declarationId=${action.declarationId}`
    );
  }

  if (declaration.ownerPlayerId !== action.actingPlayerId) {
    throw new Error(
      `Private triggered declaration owner mismatch: declarationId=${action.declarationId}`
    );
  }

  const remainingDeclarations = options.state.pendingPrivateDeclarations.filter(
    (current) => current.declarationId !== action.declarationId
  );
  const stateWithoutDeclaration: GameState = {
    ...options.state,
    pendingPrivateDeclarations: remainingDeclarations,
  };

  // 同 simultaneousGroupId の declaration が他に残っているか判定。
  // immediate と通常誘発は同じ原因由来でも別の解決優先度なので、
  // deferred の待機/flush は simultaneousGroupId + triggerPriority 単位で扱う。
  const groupId = declaration.simultaneousGroupId;
  const declarationPriority = getTriggerPriority(declaration);
  const isSameDeferredDeclarationBucket = (
    current: Pick<
      PendingPrivateDeclaration,
      "simultaneousGroupId" | "triggerPriority"
    >
  ): boolean =>
    isSameDeferredTriggerBucket(current, {
      simultaneousGroupId: groupId,
      triggerPriority: declarationPriority,
    });
  const hasSiblingDeclaration =
    groupId !== undefined &&
    remainingDeclarations.some(isSameDeferredDeclarationBucket);
  const flushDeferredForGroup = (state: GameState): GameState => {
    if (groupId === undefined) return state;
    const flushed = state.pendingDeferredTriggeredEffects.filter((e) =>
      isSameDeferredDeclarationBucket(e)
    );
    if (flushed.length === 0) return state;
    return {
      ...state,
      pendingTriggeredEffects: [...state.pendingTriggeredEffects, ...flushed],
      pendingDeferredTriggeredEffects:
        state.pendingDeferredTriggeredEffects.filter(
          (e) => !isSameDeferredDeclarationBucket(e)
        ),
    };
  };

  if (action.kind === "skip_private_triggered_effect") {
    const stateAfterSkip = hasSiblingDeclaration
      ? stateWithoutDeclaration
      : flushDeferredForGroup(stateWithoutDeclaration);
    const loggedState: GameState = {
      ...stateAfterSkip,
      log: [
        ...stateAfterSkip.log,
        `trigger:private-declaration:skipped:${action.declarationId}`,
      ],
    };
    // P3-86 案X: 発揮前チェックポイントで中断したカスケードを、消化済みなら再開する。
    const drainedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      loggedState,
      options
    );
    return {
      state: resumeStackCascadeIfReady(drainedState, options),
      declarationId: action.declarationId,
      declared: false,
    };
  }

  const sourceDefinition = options.getCardDefinitionById(
    declaration.sourceDefinitionId
  );
  const triggeredRegistration =
    sourceDefinition !== undefined
      ? options.getRegisteredTriggeredEffectActions?.(
          sourceDefinition.cardNo
        )?.[declaration.registrationIndex]
      : undefined;
  if (
    sourceDefinition !== undefined &&
    !isPrivateTriggeredDeclarationConditionMet({
      state: stateWithoutDeclaration,
      declaration,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    })
  ) {
    const stateAfterConditionUnmet = hasSiblingDeclaration
      ? stateWithoutDeclaration
      : flushDeferredForGroup(stateWithoutDeclaration);
    const loggedState: GameState = {
      ...stateAfterConditionUnmet,
      log: [
        ...stateAfterConditionUnmet.log,
        `trigger:private-declaration:condition-unmet:${action.declarationId}`,
      ],
    };
    const drainedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      loggedState,
      options
    );
    return {
      state: resumeStackCascadeIfReady(drainedState, options),
      declarationId: action.declarationId,
      declared: false,
    };
  }
  const stateAfterUsageRecord =
    triggeredRegistration?.usageLimit !== undefined
      ? recordEffectUsageIfLimited({
          state: stateWithoutDeclaration,
          sourceInstanceId: declaration.sourceInstanceId,
          sourceDefinitionId: declaration.sourceDefinitionId,
          effectLabel: getStableEffectLabel(
            "triggered",
            declaration.registrationIndex,
            triggeredRegistration
          ),
          usageLimit: triggeredRegistration.usageLimit,
          ...(triggeredRegistration.limitGroupId
            ? { groupId: triggeredRegistration.limitGroupId }
            : {}),
        })
      : stateWithoutDeclaration;
  const declaredEffectIndex =
    triggeredRegistration?.effectIndex ?? declaration.registrationIndex;
  const preFlushDeclaredEffect =
    sourceDefinition?.effects?.[declaredEffectIndex];
  const registeredLeaveFieldPreFlushSourceKeys =
    declaration.registeredLeaveFieldPreFlushSourceKeys !== undefined
      ? [...declaration.registeredLeaveFieldPreFlushSourceKeys]
      : preFlushDeclaredEffect !== undefined &&
          isRegisteredLeaveFieldPreFlushEffect(
            preFlushDeclaredEffect,
            declaration.eventKind
          )
        ? [
            makeResolvedTriggeredSourceKey(
              declaration.sourceInstanceId,
              declaration.registrationIndex
            ),
          ]
        : [];
  const registeredLeaveFieldStayOnFieldSourceKeys =
    declaration.registeredLeaveFieldStayOnFieldSourceKeys !== undefined
      ? [...declaration.registeredLeaveFieldStayOnFieldSourceKeys]
      : [];
  const pendingEffect: PendingTriggeredEffect = {
    pendingId: declaration.pendingId,
    actingPlayerId: declaration.actingPlayerId,
    eventKind: declaration.eventKind,
    ...(declaration.event ? { event: declaration.event } : {}),
    source: declaration.source,
    chainId: declaration.chainId,
    attackId: declaration.attackId,
    relatedPlayerId: declaration.relatedPlayerId,
    relatedInstanceId: declaration.relatedInstanceId,
    ...(declaration.triggerRelatedCombinedHostInstanceId !== undefined
      ? {
          triggerRelatedCombinedHostInstanceId:
            declaration.triggerRelatedCombinedHostInstanceId,
        }
      : {}),
    ...(declaration.relatedInstanceIds !== undefined
      ? { relatedInstanceIds: declaration.relatedInstanceIds }
      : {}),
    ...(declaration.relatedInstanceIdsBySourceRegistrationKey !== undefined
      ? {
          relatedInstanceIdsBySourceRegistrationKey:
            declaration.relatedInstanceIdsBySourceRegistrationKey,
        }
      : {}),
    amount: declaration.amount,
    step: declaration.step,
    window: declaration.window,
    resolvedSourceInstanceIds: [declaration.sourceInstanceId],
    ...(registeredLeaveFieldStayOnFieldSourceKeys.length > 0
      ? { registeredLeaveFieldStayOnFieldSourceKeys }
      : {}),
    ...(registeredLeaveFieldPreFlushSourceKeys.length > 0
      ? { registeredLeaveFieldPreFlushSourceKeys }
      : {}),
    ...(declaration.fromZone !== undefined
      ? { fromZone: declaration.fromZone }
      : {}),
    ...(declaration.cause !== undefined ? { cause: declaration.cause } : {}),
    ...(declaration.simultaneousGroupId !== undefined
      ? { simultaneousGroupId: declaration.simultaneousGroupId }
      : {}),
    ...(declaration.triggerPriority !== undefined
      ? { triggerPriority: declaration.triggerPriority }
      : {}),
    ...(declaration.suppressedSourceInstanceIds?.length
      ? {
          suppressedSourceInstanceIds: declaration.suppressedSourceInstanceIds,
        }
      : {}),
    ...(declaration.effectSuppressed
      ? { effectSuppressed: declaration.effectSuppressed }
      : {}),
    ...(declaration.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: declaration.effectSourceInstanceId }
      : {}),
    ...(declaration.effectSourceInstanceIds !== undefined
      ? { effectSourceInstanceIds: [...declaration.effectSourceInstanceIds] }
      : {}),
    ...(declaration.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: declaration.effectSourceDefinitionId }
      : {}),
    ...(declaration.effectActionKind !== undefined
      ? { effectActionKind: declaration.effectActionKind }
      : {}),
    ...(declaration.effectActivationTiming !== undefined
      ? { effectActivationTiming: declaration.effectActivationTiming }
      : {}),
    ...(declaration.effectSourceTotalReduction !== undefined
      ? { effectSourceTotalReduction: declaration.effectSourceTotalReduction }
      : {}),
    ...(declaration.effectSourceSatisfiedReductionSymbolCount !== undefined
      ? {
          effectSourceSatisfiedReductionSymbolCount:
            declaration.effectSourceSatisfiedReductionSymbolCount,
        }
      : {}),
    ...(declaration.effectSourceRequiredReductionSymbolCount !== undefined
      ? {
          effectSourceRequiredReductionSymbolCount:
            declaration.effectSourceRequiredReductionSymbolCount,
        }
      : {}),
    ...(declaration.eligibleSourceInstanceIds !== undefined
      ? {
          eligibleSourceInstanceIds: [...declaration.eligibleSourceInstanceIds],
        }
      : {}),
    declaredFromPrivateZone: true,
    declaredSourceInstanceId: declaration.sourceInstanceId,
    declaredSourceDefinitionId: declaration.sourceDefinitionId,
    declaredSourceKind: declaration.sourceKind,
    declaredRegistrationIndex: declaration.registrationIndex,
    ...(triggeredRegistration?.usageLimit !== undefined
      ? { usageLimitConsumedOnPrivateDeclaration: true }
      : {}),
  };

  // 同 simultaneousGroup の他 declaration が残っていれば deferred バッファに積む。
  // 自分が最後 (or 単独宣言) なら即時 publish + 同 group の deferred 群もまとめて flush。
  const stateAfterDeclaration: GameState = hasSiblingDeclaration
    ? {
        ...stateAfterUsageRecord,
        pendingDeferredTriggeredEffects: [
          ...stateAfterUsageRecord.pendingDeferredTriggeredEffects,
          pendingEffect,
        ],
      }
    : (() => {
        const flushed = flushDeferredForGroup(stateAfterUsageRecord);
        return {
          ...flushed,
          pendingTriggeredEffects: [
            ...flushed.pendingTriggeredEffects,
            pendingEffect,
          ],
        };
      })();
  // Declaration publishes an intention, not the result of its unpaid body.
  // The common pre-effect stack checkpoint waits for this triggered resolution;
  // its native negate consumer runs only after the conditional cost completes.
  const loggedState: GameState = {
    ...stateAfterDeclaration,
    log: [
      ...stateAfterDeclaration.log,
      `trigger:private-declaration:declared:${action.declarationId}:${pendingEffect.pendingId}${hasSiblingDeclaration ? ":deferred" : ""}`,
    ],
  };
  return {
    state: resumeStackCascadeIfReady(loggedState, options),
    declarationId: action.declarationId,
    declared: true,
  };
}

/**
 * use_magic legal action の本処理 (宣言 usageLimit 記録 → コスト支払い → スタック窓 or
 * 即時解決)。engine-magic-field-pre-cost-payment-trigger (BSAZ01-C12「戦力投入」) が
 * コスト支払い直前に呼び出しを中断・再開するため、`LEGAL_ACTION_HANDLERS.use_magic` から
 * 名前付き関数として切り出す (field-magic-pre-cost-trigger.ts の resume 経路からも呼ぶ)。
 */
export function applyUseMagicAction(
  options: ApplyLegalActionOptions,
  action: import("./legal-actions-types").UseMagicLegalAction
): ApplyLegalActionResult {
  const magicAction = action;
  const zoneCostPayment = getZoneCostPaymentForMagic(
    magicAction,
    options.selectedZoneCardIds
  );
  const resolvedChosenLifeCoreKind = resolveChosenLifeCoreKind(
    magicAction,
    options.chosenLifeCoreKind
  );

  // 宣言時に usageLimit の使用回数を記録する。
  // choice 変種は use_magic action の choiceIndex で宣言時に確定するため、
  // 変種別制限 (「ゲーム中に1回ずつ」C21) もここで変種別ラベルに記録する。
  const magicRegistrations = options.getRegisteredMagicActions?.(
    magicAction.sourceCardNo
  );
  const magicRegistration = magicRegistrations?.find(
    (r) =>
      r.timing === magicAction.timing &&
      (magicAction.effectIndex === undefined ||
        r.effectIndex === magicAction.effectIndex)
  );
  const magicPreventionLevel = resolveDynamicSourcePreventionLevel({
    state: options.state,
    sourceInstanceId: action.sourceInstanceId,
    actingPlayerId: action.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    registrationPreventionLevel: magicRegistration?.preventionLevel,
  });
  const magicPreventionBypass = resolveDynamicSourcePreventionBypass({
    state: options.state,
    sourceInstanceId: action.sourceInstanceId,
    actingPlayerId: action.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    registrationPreventionBypass: magicRegistration?.targetLockBypass,
  });
  const magicNegatePreventionLevel = resolveDynamicStackNegatePreventionLevel({
    state: options.state,
    sourceInstanceId: action.sourceInstanceId,
    actingPlayerId: action.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const magicUsageLimit = magicRegistration?.usageLimit;
  const magicChoiceIndex = magicAction.choiceIndex;
  const magicVariantUsageLimit =
    magicChoiceIndex !== undefined
      ? magicRegistration?.choices?.[magicChoiceIndex]?.usageLimit
      : undefined;
  const magicVariantLabel =
    magicChoiceIndex !== undefined
      ? getChoiceVariantUsageLabel("magic", magicChoiceIndex)
      : undefined;
  let stateAfterMagicUsageRecord = recordEffectUsageIfLimited({
    state: options.state,
    sourceInstanceId: action.sourceInstanceId,
    sourceDefinitionId: action.sourceDefinitionId,
    effectLabel: "magic",
    usageLimit: magicUsageLimit,
    ...(magicRegistration?.limitGroupId
      ? { groupId: magicRegistration.limitGroupId }
      : {}),
  });
  if (magicVariantUsageLimit && magicVariantLabel) {
    stateAfterMagicUsageRecord = recordEffectUsageIfLimited({
      state: stateAfterMagicUsageRecord,
      sourceInstanceId: action.sourceInstanceId,
      sourceDefinitionId: action.sourceDefinitionId,
      effectLabel: magicVariantLabel,
      usageLimit: magicVariantUsageLimit,
    });
  }
  if (action.costOverrideUsageLimit && action.costOverrideSourceInstanceId) {
    stateAfterMagicUsageRecord = recordEffectUsageIfLimited({
      state: stateAfterMagicUsageRecord,
      sourceInstanceId: action.costOverrideSourceInstanceId,
      sourceDefinitionId:
        magicAction.costOverrideSourceInstanceId === action.sourceInstanceId
          ? action.sourceDefinitionId
          : (options.state.cardInstances.find(
              (card) => card.instanceId === action.costOverrideSourceInstanceId
            )?.definitionId ?? action.sourceDefinitionId),
      effectLabel: action.costOverrideEffectLabel ?? "magic_cost_override",
      usageLimit: action.costOverrideUsageLimit,
      ...(action.costOverrideLimitGroupId
        ? { groupId: action.costOverrideLimitGroupId }
        : {}),
    });
  }

  if (
    action.timing === "main" ||
    action.timing === "flash" ||
    action.timing === "stack"
  ) {
    // main/flash/stack timing: 宣言+支払い後にスタック窓を開いて解決を延期する
    const isFreeUse = action.costMode === "free";
    // P2-05 Phase 4a: cost_override CE (amount>0) による上書きコスト使用
    const overrideCostAmount =
      action.costMode === "override"
        ? (action.overrideCost ?? undefined)
        : undefined;
    // deferred 解決時に正しい DSL effect timing/effectIndex が走るよう activeStack に伝搬。
    // action.timing === "stack" でも、flash 効果から派生した stack 応答 registration は
    // effect 本体の timing.mode === "flash" を解決する。
    const magicSourceDefinition = options.getCardDefinitionById(
      action.sourceDefinitionId
    );
    const registeredMagicEffect =
      magicRegistration?.effectIndex !== undefined
        ? magicSourceDefinition?.effects?.[magicRegistration.effectIndex]
        : undefined;
    const chosenMagicTiming: "main" | "flash" | "stack" =
      registeredMagicEffect?.timing.kind === "activated" &&
      registeredMagicEffect.timing.mode !== "any"
        ? registeredMagicEffect.timing.mode
        : action.timing;
    // engine-magic-trash-use-permission (adversarial verifier round1 指摘反映):
    // 実行時のゾーン検証を、宣言時に availability 側が使ったのと同じ
    // registration.applicability から導出する。これにより、トラッシュ許可を
    // 宣言していない registration の effectIndex を使って別ゾーンのカードを
    // 実行時にすり抜けさせることができなくなる。
    const magicAllowedSourceZones =
      magicAction.allowedSourceZones ??
      (magicRegistration
        ? getRegisteredMagicActionAllowedZones(magicRegistration)
        : undefined);
    const deferredResult = useMagicCardInFlashContextAsAction({
      state: stateAfterMagicUsageRecord,
      actingPlayerId: action.actingPlayerId,
      magicInstanceId: action.sourceInstanceId,
      ...(magicAllowedSourceZones !== undefined
        ? { allowedSourceZones: magicAllowedSourceZones }
        : {}),
      // ルール正源: スタック窓はコスト支払い後・対象選択前に開く (03a 標準パイプライン)。
      // GUI 経路は対象を渡さない (= 窓クローズ後の解決時に pendingMagicTargetSelection で
      // 選ぶ)。宣言時に対象が渡された場合 (後方互換: テスト/AI) のみ従来どおり検証して焼き込む。
      targetInstanceIds:
        options.targetInstanceIds && options.targetInstanceIds.length > 0
          ? resolveLegalActionTargets(action, options.targetInstanceIds)
          : [],
      targetEffectFilterTags: action.targetEffectFilterTags,
      paymentSources:
        isFreeUse && action.finalCost === 0
          ? []
          : resolvePaymentSources(action, options.paymentSources),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(resolvedChosenLifeCoreKind !== undefined
        ? { chosenLifeCoreKind: resolvedChosenLifeCoreKind }
        : {}),
      ...(isFreeUse ? { withoutCost: true } : {}),
      ...(overrideCostAmount !== undefined
        ? { costOverrideAmount: overrideCostAmount }
        : {}),
      ...(zoneCostPayment !== undefined
        ? { additionalCostModifiers: zoneCostPayment.modifiers }
        : {}),
      ...(zoneCostPayment !== undefined
        ? { zoneCostPaymentCardIds: zoneCostPayment.cardIds }
        : {}),
      ...(magicPreventionLevel !== undefined
        ? { sourcePreventionLevel: magicPreventionLevel }
        : {}),
      ...(magicPreventionBypass !== undefined
        ? { sourcePreventionBypass: magicPreventionBypass }
        : {}),
      chosenTiming: chosenMagicTiming,
      ...(magicRegistration?.activationLabel
        ? { activationLabel: magicRegistration.activationLabel }
        : {}),
      ...(action.effectIndex !== undefined
        ? { effectIndex: action.effectIndex }
        : {}),
      // choice 変種: 宣言時に確定した choiceIndex を activeStack.magicChoiceIndex に
      // 保存し、deferred 解決時の executeEffect / 窓後対象選択の変種マージに使う。
      ...(magicChoiceIndex !== undefined
        ? { choiceIndex: magicChoiceIndex }
        : {}),
      ...(action.deferredChoiceIndexes !== undefined
        ? { deferredChoiceIndexes: action.deferredChoiceIndexes }
        : {}),
      ...(action.targetStepId !== undefined
        ? { targetStepId: action.targetStepId }
        : {}),
      ...(action.candidateTargetZones !== undefined
        ? { candidateTargetZones: action.candidateTargetZones }
        : {}),
      ...(action.targetGroups !== undefined
        ? { targetGroups: action.targetGroups }
        : {}),
      ...(action.allowDuplicateTargets !== undefined
        ? { allowDuplicateTargets: action.allowDuplicateTargets }
        : {}),
      ...(options.payCostPaymentSources !== undefined
        ? { payCostPaymentSources: options.payCostPaymentSources }
        : {}),
      ...(action.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
        : {}),
    });

    // deferred stack に reevaluation / composition 情報を付与
    // P3-62: 宣言時に記録した usageLimit を deferred 解決時の
    //   condition unmet / conditional_cost rollback で払い戻せるよう activeStack に保持
    //   (共有ラベル "magic" + 変種別ラベル "magic:choice:N" の全記録)。
    const magicRecordedUsage = composeRecordedUsage([
      magicUsageLimit
        ? {
            effectLabel: "magic",
            usageLimit: magicUsageLimit,
            ...(magicRegistration?.limitGroupId
              ? { groupId: magicRegistration.limitGroupId }
              : {}),
          }
        : undefined,
      magicVariantUsageLimit && magicVariantLabel
        ? {
            effectLabel: magicVariantLabel,
            usageLimit: magicVariantUsageLimit,
          }
        : undefined,
    ]);
    const magicDeferredStack: ActiveStack =
      magicRegistration?.reevaluationPoints?.length ||
      magicRegistration?.suppressionEffectDescriptor ||
      magicPreventionLevel !== undefined ||
      magicPreventionBypass !== undefined ||
      magicNegatePreventionLevel !== undefined ||
      magicRegistration?.composition ||
      magicRecordedUsage
        ? {
            ...deferredResult.activeStack,
            ...(magicRegistration?.reevaluationPoints?.length
              ? {
                  reevaluationPoints: magicRegistration.reevaluationPoints,
                }
              : {}),
            ...(magicRegistration?.suppressionEffectDescriptor
              ? {
                  suppressionEffectDescriptor:
                    magicRegistration.suppressionEffectDescriptor,
                }
              : {}),
            ...(magicPreventionLevel !== undefined
              ? { preventionLevel: magicPreventionLevel }
              : {}),
            ...(magicPreventionBypass !== undefined
              ? { preventionBypass: magicPreventionBypass }
              : {}),
            ...(magicNegatePreventionLevel !== undefined
              ? { negatePreventionLevel: magicNegatePreventionLevel }
              : {}),
            ...(magicRegistration?.composition
              ? { composition: magicRegistration.composition }
              : {}),
            ...(magicRecordedUsage
              ? { recordedUsage: magicRecordedUsage }
              : {}),
          }
        : deferredResult.activeStack;

    return {
      state: openDeferredDeclarationStackWindow({
        baseState: options.state,
        stateForWindow: deferredResult.state,
        activeStack: magicDeferredStack,
        actingPlayerId: action.actingPlayerId,
      }),
      chainId: magicDeferredStack.chainId,
    };
  }

  const magicResolvedTargets = resolveLegalActionTargets(
    action,
    options.targetInstanceIds
  );

  // composition メタデータから同時解決 resolver を構築
  let effectiveMagicResolverLookup = options.getHandWrittenEffectResolver;
  if (magicRegistration?.composition && options.getHandWrittenEffectResolver) {
    const composed = buildComposedResolverFromComposition(
      options.getHandWrittenEffectResolver,
      action.sourceCardNo,
      magicRegistration.composition,
      options.getConditionalCostCanExecuteCheck,
      options.getConditionalResultSuccessCheck
    );
    if (composed) {
      const fallbackLookup = options.getHandWrittenEffectResolver;
      const sourceCardNo = action.sourceCardNo;
      effectiveMagicResolverLookup = (cardNo: string) =>
        cardNo === sourceCardNo ? composed : fallbackLookup(cardNo);
    }
  }

  const result = playMagicCardAsAction({
    state: stateAfterMagicUsageRecord,
    actingPlayerId: action.actingPlayerId,
    magicInstanceId: action.sourceInstanceId,
    targetInstanceIds: magicResolvedTargets,
    targetEffectFilterTags: action.targetEffectFilterTags,
    ...(magicPreventionLevel !== undefined
      ? { sourcePreventionLevel: magicPreventionLevel }
      : {}),
    ...(magicPreventionBypass !== undefined
      ? { sourcePreventionBypass: magicPreventionBypass }
      : {}),
    ...(magicRegistration?.activationLabel
      ? { activationLabel: magicRegistration.activationLabel }
      : {}),
    paymentSources: resolvePaymentSources(action, options.paymentSources),
    ...(zoneCostPayment !== undefined
      ? { additionalCostModifiers: zoneCostPayment.modifiers }
      : {}),
    ...(zoneCostPayment !== undefined
      ? { zoneCostPaymentCardIds: zoneCostPayment.cardIds }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(resolvedChosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: resolvedChosenLifeCoreKind,
        }
      : {}),
    ...(effectiveMagicResolverLookup
      ? {
          getHandWrittenEffectResolver: effectiveMagicResolverLookup,
        }
      : {}),
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
    ...(action.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
      : {}),
    ...(magicRegistration?.reevaluationPoints?.length
      ? {
          reevaluation: buildReevaluationConfig(
            magicRegistration,
            action.sourceInstanceId,
            magicResolvedTargets
          )!,
        }
      : {}),
  });

  return result;
}

/**
 * engine-burst-activation-paid-cost-gate (BSTH02-M02): バースト発動宣言時、
 * 対価が設定された `cannot_activate_opponent_burst` CE があれば、ライフの通常コアを
 * amount 分ボイドへ強制移動する (宣言時支払い、stack window を開く前)。
 * isBurstActivationRestricted が既に「資力が足りないときのみ禁止」を保証しているため、
 * この呼び出し時点では必ず支払い可能。
 */
function applyBurstActivationPaidCost(
  state: GameState,
  playerId: string
): GameState {
  const cost = getBurstActivationRequiredLifeCoreCost(state, playerId);
  if (cost === null) return state;
  let current = state;
  for (let i = 0; i < cost.amount; i += 1) {
    current = moveLifeCoreByEffect({
      state: current,
      playerId,
      destination: { kind: "void", playerId },
      effectKind: "generic",
    });
  }
  current.log.push(
    `burst:paid-activation-cost:${playerId}:life_core:${cost.amount}`
  );
  return current;
}

const LEGAL_ACTION_HANDLERS: LegalActionHandlerMap = {
  resolve_pending_deck_reveal_pick: (options) => {
    const postResolutionOracle =
      options.state.pendingDeckReveal?.postResolutionOracle;
    const result = applyPendingDeckRevealAction(options);
    const stateAfterOracle = checkAndQueuePostResolutionOracleIfReady(
      result.state,
      postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
    // adversarial verifier round1 (2026-07-19) 発見: deck_reveal 経由の targeted
    // disclosure (BSLH01-C01/R06) が effect_immunity を発揮しない分岐で
    // pendingTargetedDisclosureContinuation が再開されず盤面が停止するバグ。
    // resumeStepOptional 等の他 pending resolve handler と同様に
    // resumeStackCascadeIfReady を呼ぶ (ENGINE-battle-reduce-life-source-instance
    // とは無関係、deck_reveal handler 自体の resume 経路欠落)。
    return {
      ...result,
      state: resumeStackCascadeIfReady(
        maybeFinalizeBattleEndScopeAfterPendingDrain(stateAfterOracle, options),
        options
      ),
    };
  },
  resolve_pending_deck_reveal_order: (options) => {
    const postResolutionOracle =
      options.state.pendingDeckReveal?.postResolutionOracle;
    const result = applyPendingDeckRevealAction(options);
    const stateAfterOracle = checkAndQueuePostResolutionOracleIfReady(
      result.state,
      postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
    return {
      ...result,
      state: resumeStackCascadeIfReady(
        maybeFinalizeBattleEndScopeAfterPendingDrain(stateAfterOracle, options),
        options
      ),
    };
  },
  resolve_pending_zone_selection: (options) =>
    applyPendingZoneSelectionAction(options),
  resolve_pending_step_optional_choice: (options) =>
    applyPendingStepOptionalChoiceAction(options),
  resolve_pending_step_choice: (options) =>
    applyPendingStepChoiceAction(options),
  resolve_connect_battle_decision: (options) =>
    applyConnectBattleDecisionAction(options),
  resolve_pending_deck_reveal_count_boost_choice: (options) =>
    applyPendingDeckRevealCountBoostChoiceAction(options),
  resolve_pending_step_optional_target_selection: (options) =>
    applyPendingStepOptionalTargetSelectionAction(options),
  resolve_pending_draw_step_cost_choice: (options) =>
    applyPendingDrawStepCostChoiceAction(options),
  resolve_pending_summon_cost_exclude_choice: (options) =>
    applyPendingSummonCostExcludeChoiceAction(options),
  resolve_pending_summon_cost_core_move_choice: (options) =>
    applyPendingSummonCostCoreMoveChoiceAction(options),
  resolve_pending_grouped_summon_cost_override_choice: (options) =>
    applyPendingGroupedSummonCostOverrideChoiceAction(options),
  resolve_pending_life_damage_discard_choice: (options) =>
    applyPendingLifeDamageDiscardChoiceAction(options),
  resolve_pending_life_gain_replacement_choice: (options) =>
    applyPendingLifeGainReplacementChoiceAction(options),
  resolve_pending_core_shoot: (options) => {
    const pending = options.state.pendingCoreShootSelection;
    const postResolutionOracle =
      options.state.pendingCoreShootSelection?.postResolutionOracle;
    const battleEndAttackId =
      options.state.pendingCoreShootSelection?.battleEndDeferralAttackId;
    const result = applyPendingCoreShootAction(options);
    // コア選択で中断したマジックも、本文完了後に通常の解決後処理へ戻す。
    const afterMagicCleanup = pending
      ? moveCompletedInUseMagicCardToTrashIfReady({
          state: result.state,
          sourceInstanceId: pending.sourceInstanceId,
          getCardDefinitionById: options.getCardDefinitionById,
          logLabel: pending.pendingId,
        })
      : result.state;
    let state = checkAndQueuePostResolutionOracleIfReady(
      afterMagicCleanup,
      postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
    if (battleEndAttackId !== undefined) {
      state = maybeFinalizeBattleEndScopeAfterPendingDrain(state, options);
    }
    return {
      ...result,
      state,
    };
  },
  resolve_pending_effect_target: (options) =>
    applyPendingEffectTargetAction(options),
  resolve_pending_as_if_soul_core_choice: (options) =>
    applyPendingAsIfSoulCoreChoiceAction(options),
  resolve_pending_effect_optional_repeat_choice: (options) =>
    applyPendingEffectOptionalRepeatChoiceAction(options),
  resolve_pending_effect_optional_repeat_count: (options) =>
    applyPendingEffectOptionalRepeatCountAction(options),
  resolve_borrowed_effect_choice: (options, action) => {
    if (action.kind !== "resolve_borrowed_effect_choice") {
      throw new Error("Unexpected action kind for borrowed effect choice");
    }
    const pending = options.state.pendingBorrowedEffectChoice;
    if (!pending || pending.pendingId !== action.pendingId) {
      throw new Error(
        `Unknown pendingBorrowedEffectChoice: pendingId=${action.pendingId}`
      );
    }
    if (pending.actingPlayerId !== action.actingPlayerId) {
      throw new Error(
        `resolve_borrowed_effect_choice acting player mismatch: ${action.actingPlayerId}`
      );
    }
    if (
      !pending.candidates.some(
        (candidate) =>
          candidate.effectIndex === action.borrowedEffectIndex &&
          candidate.grantedEffectCeId === action.grantedEffectCeId &&
          candidate.effectSourceInstanceId === action.effectSourceInstanceId &&
          candidate.effectSourceDefinitionId === action.effectSourceDefinitionId
      )
    ) {
      throw new Error(
        `borrowedEffectIndex ${action.borrowedEffectIndex} is not a candidate`
      );
    }
    const stateWithoutPending = {
      ...options.state,
      pendingBorrowedEffectChoice: null,
    };
    const battleEndAttackId = pending.battleEndDeferralAttackId;
    const resolution = createEffectResolutionScope(pending);
    const beforeBorrowedState = cloneStateForTriggerDelta(stateWithoutPending);
    const borrowedState = executeSelectedBorrowedCardEventEffect(
      stateWithoutPending,
      resolution.chainId,
      pending.actingPlayerId,
      pending.sourceInstanceId,
      pending.targetInstanceId,
      action.borrowedEffectIndex,
      options.getCardDefinitionById,
      executeEffect,
      options.getRegisteredTriggeredEffectActions,
      undefined,
      undefined,
      undefined,
      pending.suppressBorrowedEffect,
      pending.sourcePreventionLevel,
      pending.sourcePreventionBypass,
      undefined,
      action.effectSourceInstanceId,
      action.effectSourceDefinitionId,
      pending.ignoreLevelCondition,
      pending.attributeToBorrowedCard,
      battleEndAttackId,
      pending.suppressResponseStack,
      action.grantedEffectCeId,
      options.getRegisteredBurstActions
    );
    const finalized = resolution.finalize({
      state: borrowedState,
      beforeState: beforeBorrowedState,
      endLogs: [],
      actingPlayerId: pending.actingPlayerId,
      causedBySourceInstanceId: pending.sourceInstanceId,
      enterFieldCausedByPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(battleEndAttackId !== undefined
        ? { battleEndDeferralAttackId: battleEndAttackId }
        : {}),
    });
    const drainedState =
      battleEndAttackId === undefined
        ? finalized
        : maybeFinalizeBattleEndScopeAfterPendingDrain(finalized, options);
    return {
      state: resumeStackCascadeIfReady(drainedState, options),
    };
  },
  resolve_borrowed_effect_target: (options, action) => {
    if (action.kind !== "resolve_borrowed_effect_target") {
      throw new Error("Unexpected action kind for borrowed effect target");
    }
    const pending = options.state.pendingBorrowedEffectTargetSelection;
    if (!pending || pending.pendingId !== action.pendingId) {
      throw new Error(
        `Unknown pendingBorrowedEffectTargetSelection: pendingId=${action.pendingId}`
      );
    }
    if (pending.choosingPlayerId !== action.actingPlayerId) {
      throw new Error(
        `resolve_borrowed_effect_target choosing player mismatch: ${action.actingPlayerId}`
      );
    }
    const selected = options.targetInstanceIds ?? [];
    if (
      selected.length < pending.requiredTargetCount ||
      selected.length > pending.maxTargetCount
    ) {
      throw new Error(
        `Borrowed effect target count ${selected.length} out of range [${pending.requiredTargetCount}, ${pending.maxTargetCount}]`
      );
    }
    const candidateSet = new Set(pending.candidateInstanceIds);
    const seen = new Set<string>();
    for (const id of selected) {
      if (!candidateSet.has(id)) {
        throw new Error(`Borrowed effect target ${id} is not a candidate`);
      }
      if (seen.has(id)) {
        throw new Error(`Borrowed effect target list contains duplicate ${id}`);
      }
      seen.add(id);
    }
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
          `Borrowed effect target selection must include forced target inclusion candidate(s): ${missing.join(",")}`
        );
      }
    }
    if (pending.bpBudgetAmount !== undefined) {
      const selectedBpTotal = selected.reduce((sum, id) => {
        const card = options.state.cardInstances.find(
          (c) => c.instanceId === id
        );
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
          `Borrowed effect target BP total ${selectedBpTotal} exceeds budget ${pending.bpBudgetAmount} (pendingId=${pending.pendingId})`
        );
      }
    }
    if (pending.costBudgetAmount !== undefined) {
      const selectedCostTotal = selected.reduce((sum, id) => {
        const card = options.state.cardInstances.find(
          (c) => c.instanceId === id
        );
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
          `Borrowed effect target cost total ${selectedCostTotal} exceeds budget ${pending.costBudgetAmount} (pendingId=${pending.pendingId})`
        );
      }
    }
    if (pending.symbolBudgetAmount !== undefined) {
      const selectedSymbolTotal = selected.reduce((sum, id) => {
        const card = options.state.cardInstances.find(
          (c) => c.instanceId === id
        );
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
          `Borrowed effect target symbol total ${selectedSymbolTotal} exceeds budget ${pending.symbolBudgetAmount} (pendingId=${pending.pendingId})`
        );
      }
    }
    const stateWithoutPending = {
      ...options.state,
      pendingBorrowedEffectTargetSelection: null,
    };
    const battleEndAttackId = pending.battleEndDeferralAttackId;
    const resolution = createEffectResolutionScope(pending);
    const beforeBorrowedState = cloneStateForTriggerDelta(stateWithoutPending);
    const borrowedState = executeSelectedBorrowedCardEventEffect(
      stateWithoutPending,
      resolution.chainId,
      pending.actingPlayerId,
      pending.sourceInstanceId,
      pending.targetInstanceId,
      pending.borrowedEffectIndex,
      options.getCardDefinitionById,
      executeEffect,
      options.getRegisteredTriggeredEffectActions,
      [...selected],
      pending.targetStepId,
      {
        startFromStepIndex: pending.targetStepIndex,
        restoredStepContext: pending.stepContext,
        ...(pending.recordedUsage !== undefined
          ? { recordedUsage: pending.recordedUsage }
          : {}),
      },
      undefined,
      pending.sourcePreventionLevel,
      pending.sourcePreventionBypass,
      undefined,
      pending.effectSourceInstanceId,
      pending.effectSourceDefinitionId,
      undefined,
      pending.attributeToBorrowedCard,
      battleEndAttackId,
      undefined,
      pending.grantedEffectCeId,
      options.getRegisteredBurstActions
    );
    const finalized = resolution.finalize({
      state: borrowedState,
      beforeState: beforeBorrowedState,
      endLogs: [],
      actingPlayerId: pending.actingPlayerId,
      causedBySourceInstanceId: pending.sourceInstanceId,
      enterFieldCausedByPlayerId: pending.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(battleEndAttackId !== undefined
        ? { battleEndDeferralAttackId: battleEndAttackId }
        : {}),
    });
    const drainedState =
      battleEndAttackId === undefined
        ? finalized
        : maybeFinalizeBattleEndScopeAfterPendingDrain(finalized, options);
    return {
      state: resumeStackCascadeIfReady(drainedState, options),
    };
  },
  resolve_pay_to_act_core_gate: (options) =>
    applyPendingPayToActCoreGateAction(options),
  resolve_pay_to_act_hand_discard_gate: (options) =>
    applyPendingPayToActHandDiscardGateAction(options),
  resolve_pending_core_split: (options) => {
    const postResolutionOracle =
      options.state.pendingCoreSplitSelection?.postResolutionOracle;
    const result = applyPendingCoreSplitAction(options);
    return {
      ...result,
      state: checkAndQueuePostResolutionOracleIfReady(
        result.state,
        postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      ),
    };
  },
  resolve_pending_split_summon_choice: (options) => {
    const postResolutionOracle =
      options.state.pendingSplitSummonChoice?.postResolutionOracle;
    const result = applyPendingSplitSummonChoiceAction(options);
    return {
      ...result,
      state: checkAndQueuePostResolutionOracleIfReady(
        result.state,
        postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      ),
    };
  },
  resolve_pending_core_count: (options) => {
    const postResolutionOracle =
      options.state.pendingCoreCountSelection?.postResolutionOracle;
    const result = applyPendingCoreCountAction(options);
    return {
      ...result,
      state: checkAndQueuePostResolutionOracleIfReady(
        result.state,
        postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      ),
    };
  },
  resolve_pending_count_decrease: (options) => {
    const postResolutionOracle =
      options.state.pendingCountSelection?.postResolutionOracle;
    const result = applyPendingCountSelectionAction(options);
    return {
      ...result,
      state: checkAndQueuePostResolutionOracleIfReady(
        result.state,
        postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      ),
    };
  },
  resolve_pending_discard_set_burst_count: (options) => {
    const postResolutionOracle =
      options.state.pendingDiscardSetBurstCountSelection?.postResolutionOracle;
    const result = applyPendingDiscardSetBurstCountSelectionAction(options);
    return {
      ...result,
      state: checkAndQueuePostResolutionOracleIfReady(
        result.state,
        postResolutionOracle,
        options.getCardDefinitionById,
        options.getRegisteredTriggeredEffectActions,
        options.getRegisteredBurstActions
      ),
    };
  },
  resolve_pending_life_core_selection: (options) =>
    applyPendingLifeCoreSelectionAction(options),
  resolve_core_source_allocation: (options) =>
    applyResolveCoreSourceAllocationAction(options),
  resolve_pending_link_aid_cost_source_choice: (options, action) =>
    applyPendingLinkAidCostSourceChoiceAction(options, action),
  resolve_pending_effect_summon_cost_payment: (options) =>
    applyResolvePendingEffectSummonCostPaymentAction(options),
  resolve_pending_core_distribution: (options) => {
    const result = applyPendingCoreDistributionAction(options);
    // engine-magic-field-pre-cost-payment-trigger (BSAZ01-C12「戦力投入」):
    // applyPendingCoreDistributionAction は continuation resume (effects[1] 残りステップ)
    // を finalizeEffectResolution までこの呼び出し内で完結させ、resumeStackCascadeIfReady
    // を経由しない。trigger 済みの pendingFieldMagicPreCostTrigger をここで明示的に
    // 再開チェックする (他の resume 経路は resumeStackCascadeIfReady 側で担保済み)。
    const afterStackCascade =
      result.state.pendingFieldMagicPreCostTrigger?.triggered === true
        ? resumeStackCascadeIfReady(result.state, options)
        : result.state;
    return {
      ...result,
      state: resumeFieldMagicPreCostTriggerIfReady(afterStackCascade, options),
    };
  },
  abort_pending_core_distribution: (options) =>
    applyAbortPendingCoreDistributionAction(options),
  resolve_pending_change_cleanup_choice: (options, action) => ({
    state: resumeStackCascadeIfReady(
      resolvePendingChangeCleanupChoice({
        state: options.state,
        pendingId: action.pendingId,
        outcome: action.outcome,
        ...(action.outcome === "swap"
          ? {
              swapTargetInstanceId:
                action.swapTargetInstanceId ?? options.swapTargetInstanceId,
            }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
      }),
      options
    ),
  }),
  resolve_pending_enter_field_placement: (options) =>
    applyPendingEnterFieldPlacementAction(options),
  resolve_pending_multi_placement: (options) => {
    const result = applyPendingMultiPlacementAction(options);
    return {
      ...result,
      state: resumeStackCascadeIfReady(result.state, options),
    };
  },
  abort_pending_multi_placement: (options) =>
    applyAbortPendingMultiPlacementAction(options),
  use_divine_skill: (options) => applyDivineSkillAction(options),
  confirm_target_redirect: (options) => applyTargetRedirectAction(options),
  decline_target_redirect: (options) => applyTargetRedirectAction(options),
  resolve_brave_leave_choice: (options, action) => {
    const resultState = resolveBraveLeaveChoice(
      options.state,
      action.choice,
      options.separateCoreDistribution as Record<string, number> | undefined,
      options.getCardDefinitionById
    );
    return {
      state: resultState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  resolve_advent_source_replacement: (options, action) => {
    const resultState = resolveAdventSourceReplacement(
      options.state,
      action.choice,
      action.hostInstanceId
    );
    return { state: resultState };
  },
  resolve_soul_state_replacement: (options, action) => {
    // keep → accept=true (魂状態で残す) / decline → accept=false (通常通り離れる)。
    const resultState = resolveSoulStateReplacement(
      options.state,
      action.choice === "keep",
      options.getCardDefinitionById
    );
    // 離脱の実移動・次の選択を確定した外側の共通出口で battle-end を再開する。
    return { state: resultState };
  },
  resolve_set_aside_exit_replacement_choice:
    applySetAsideExitReplacementChoiceAction,
  resolve_brave_attack_continuation: (options, action) => {
    const resultState = resolveBraveAttackContinuation(
      options.state,
      action.choice,
      options.getCardDefinitionById
    );
    return {
      state: resultState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  select_pending_to_resolve: (options, action) => {
    const target = options.state.pendingTriggeredEffects.find(
      (p) => p.pendingId === action.pendingId
    );
    if (!target) {
      throw new Error(
        `Unknown pending triggered effect for selection: pendingId=${action.pendingId}`
      );
    }
    if (action.actingPlayerId !== options.state.activePlayerId) {
      throw new Error(
        `select_pending_to_resolve must be invoked by turn player: actingPlayerId=${action.actingPlayerId} vs activePlayerId=${options.state.activePlayerId}`
      );
    }
    const currentQueue = scopeInnermostTriggerReactions(
      options.state
    ).pendingTriggeredEffects;
    if (
      !currentQueue.some((pending) => pending.pendingId === target.pendingId)
    ) {
      throw new Error(
        `Cannot select outer trigger while inner derived reactions remain: ${target.pendingId}`
      );
    }
    const highestPriority = currentQueue.some(
      (pending) => getTriggerPriority(pending) === "immediate"
    )
      ? "immediate"
      : "normal";
    if (getTriggerPriority(target) !== highestPriority) {
      throw new Error(
        `Cannot select pending triggered effect while higher priority triggered effects remain: pendingId=${action.pendingId}`
      );
    }
    // GUI では「自分の optional pending/source」を順番選択の段階から
    // 「発揮する / 発揮しない」として表示する。source metadata 付きの skip は
    // optional source だけを辞退し、残り source があれば pending を再キューする。
    if (
      options.skipOptionalEffect === true &&
      (action.executionMode === "optional" ||
        action.canSkipDuplicate === true) &&
      action.ownerPlayerId === action.actingPlayerId
    ) {
      const stateWithoutPending: GameState = {
        ...options.state,
        pendingTriggeredEffects: options.state.pendingTriggeredEffects.filter(
          (p) => p.pendingId !== action.pendingId
        ),
      };
      const declinedSourceInstanceId = action.sourceInstanceId;
      const resolvedSourceRegistrationKeys = declinedSourceInstanceId
        ? [
            ...(target.resolvedSourceRegistrationKeys ?? []),
            makeResolvedTriggeredSourceKey(
              action.sourceEffectInstanceId ?? declinedSourceInstanceId,
              action.registrationIndex
            ),
          ]
        : (target.resolvedSourceRegistrationKeys ?? []);
      const triggeredLookup = options.getRegisteredTriggeredEffectActions;
      const remainingSourceChoices =
        declinedSourceInstanceId &&
        typeof triggeredLookup === "function" &&
        target.declaredFromPrivateZone !== true
          ? getAvailableTriggeredEffectSourceChoices({
              state: stateWithoutPending,
              pendingEffect: {
                ...target,
                resolvedSourceRegistrationKeys,
              },
              getCardDefinitionById: options.getCardDefinitionById,
              getRegisteredTriggeredEffectActions: triggeredLookup,
            }).filter((choice) =>
              isTriggeredSourceUsageAvailable({
                state: stateWithoutPending,
                pendingEffect: target,
                choice,
                getCardDefinitionById: options.getCardDefinitionById,
              })
            )
          : [];

      if (remainingSourceChoices.length > 0 && declinedSourceInstanceId) {
        const updatedPendingEffect: PendingTriggeredEffect = {
          ...clearPendingTriggeredEffectTurnSelection(target),
          resolvedSourceRegistrationKeys,
        };
        return {
          state: {
            ...stateWithoutPending,
            pendingTriggeredEffects: [
              updatedPendingEffect,
              ...stateWithoutPending.pendingTriggeredEffects,
            ],
            log: [
              ...stateWithoutPending.log,
              `skip_optional_triggered_effect:${action.pendingId}:${declinedSourceInstanceId}`,
              `trigger:requeued:${updatedPendingEffect.pendingId}:${resolvedSourceRegistrationKeys.join(",")}`,
            ],
          },
          pendingId: action.pendingId,
          skipped: true,
        };
      }

      const skippedState: GameState = {
        ...stateWithoutPending,
        log: [
          ...stateWithoutPending.log,
          `skip_optional_triggered_effect:${action.pendingId}`,
        ],
      };
      const drainedSkippedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
        skippedState,
        options
      );
      return {
        // 任意誘発の辞退も、通常の誘発解決と同じくアタック宣言の後処理へ戻す。
        // 指定アタックでは、最後の pending を drain した時点で強制ブロック宣言窓を
        // 開く必要がある。ここを通さないと activeAttack が declare_attack のまま残り、
        // advanceStep が permanent に blocked になる。
        state: advanceAttackDeclarationStateIfReady(
          resumeStackCascadeIfReady(drainedSkippedState, options),
          options
        ),
        pendingId: action.pendingId,
        skipped: true,
      };
    }
    // 既選択の pending があれば flag を一旦 clear し、対象だけ立てる
    const updated = options.state.pendingTriggeredEffects.map((p) =>
      p.pendingId === action.pendingId
        ? selectPendingTriggeredEffectForTurnPlayer(p, action)
        : p.selectedByTurnPlayer === true
          ? {
              ...clearPendingTriggeredEffectTurnSelection(p),
              selectedByTurnPlayer: false,
            }
          : p
    );
    const stateAfter: GameState = {
      ...options.state,
      pendingTriggeredEffects: updated,
      log: [
        ...options.state.log,
        `trigger:pending:selected:${action.pendingId}:by:${action.actingPlayerId}`,
      ],
    };
    return (
      resolveOwnerOptionalSelectIfUnambiguous(options, action, stateAfter) ?? {
        state: stateAfter,
      }
    );
  },
  declare_private_triggered_effect: (options, action) =>
    applyFallthroughHandler_declare_private_triggered_effect_skip_private_triggered_effect(
      options,
      action
    ),
  skip_private_triggered_effect: (options, action) =>
    applyFallthroughHandler_declare_private_triggered_effect_skip_private_triggered_effect(
      options,
      action
    ),
  resolve_pending_triggered_effect: (options, action) => {
    if (
      !scopeInnermostTriggerReactions(
        options.state
      ).pendingTriggeredEffects.some(
        (pending) => pending.pendingId === action.pendingId
      )
    ) {
      throw new Error(
        `Cannot resolve outer trigger while inner derived reactions remain: ${action.pendingId}`
      );
    }
    const pendingEffect = options.state.pendingTriggeredEffects.find(
      (currentPendingEffect) =>
        currentPendingEffect.pendingId === action.pendingId
    );

    if (!pendingEffect) {
      throw new Error(
        `Unknown pending triggered effect: pendingId=${action.pendingId}`
      );
    }

    // P3-92: mechanic 付き pending (神託/解封/創界石転醒) はカード効果 registration を
    // 持たないため、stack window deferral / resolver lookup を経由せず同期解決する。
    if (pendingEffect.mechanic) {
      // バースト発動後は、先行する誘発をすべて drain してから effect-declaration
      // stack を再開する。mechanic 経路だけここを通らず return していたため、任意の
      // 解封を辞退すると activationSelected 済みの burst check が stranded した。
      // ただし受諾した mechanic は自身の effect-declaration stack を開く。
      // resumeStackCascadeIfReady は全 response window (通常 / 宣言前 / battle flash)
      // が閉じるまで cascade を再開しないため、ここでは経路を分けず共通 resume に委ねる。
      const result = applyMechanicTriggeredEffect(
        options,
        pendingEffect,
        action
      );
      return {
        ...result,
        state: resumeStackCascadeIfReady(result.state, options),
      };
    }

    // optional 効果のスキップ（発揮辞退）。
    // 同一イベントに複数カードが反応している場合 (例: 召喚イベントに対する
    // BSTH01-X03『召喚時』＋ BSTH01-R21 responder)、pending は 1 個を source 複数で
    // 共有する。ここで pendingId 単位に丸ごと削除すると、辞退していない別カードの
    // 誘発まで巻き添えで消える。accept 経路 (applyPostResolveTriggeredEffectHandling)
    // と対称に「辞退した effect を resolvedSourceRegistrationKeys に積み、残り source が
    // あれば pending を再キュー」して effect 単位の辞退にする。
    // P3-91 移植: skipOnly action (全 variant が発揮不能で drain 専用) は
    // skipOptionalEffect の明示が無くても辞退として処理する。
    if (
      (options.skipOptionalEffect || action.skipOnly === true) &&
      (action.executionMode === "optional" || action.canSkipDuplicate === true)
    ) {
      const stateWithoutPending: GameState = {
        ...options.state,
        pendingTriggeredEffects: options.state.pendingTriggeredEffects.filter(
          (p) => p.pendingId !== action.pendingId
        ),
      };
      const declinedSourceInstanceId = action.sourceInstanceId;

      // source 単位の辞退が成立する経路 (source バック・非 private・lookup あり) では、
      // 辞退した effect (instanceId, registrationIndex) を resolvedSourceRegistrationKeys に
      // 積んだうえで残り source を再評価する。同一カードが同タイミングの誘発を複数持つ場合
      // (例: BSTH06-C01 の 2 つの『召喚時』) も effect 単位で辞退し他方を残す。
      const resolvedSourceRegistrationKeys = declinedSourceInstanceId
        ? [
            ...(pendingEffect.resolvedSourceRegistrationKeys ?? []),
            makeResolvedTriggeredSourceKey(
              action.sourceEffectInstanceId ?? declinedSourceInstanceId,
              action.registrationIndex
            ),
          ]
        : (pendingEffect.resolvedSourceRegistrationKeys ?? []);
      // 型上は非 optional だが、テスト等で lookup 未指定で呼ばれる経路があるため
      // 実体が関数のときだけ source 再評価する (未指定なら従来どおり全体辞退)。
      const triggeredLookup = options.getRegisteredTriggeredEffectActions;
      const remainingSourceChoices =
        declinedSourceInstanceId &&
        typeof triggeredLookup === "function" &&
        pendingEffect.declaredFromPrivateZone !== true
          ? getAvailableTriggeredEffectSourceChoices({
              state: stateWithoutPending,
              pendingEffect: {
                ...pendingEffect,
                resolvedSourceRegistrationKeys,
              },
              getCardDefinitionById: options.getCardDefinitionById,
              getRegisteredTriggeredEffectActions: triggeredLookup,
            }).filter((choice) =>
              isTriggeredSourceUsageAvailable({
                state: stateWithoutPending,
                pendingEffect,
                choice,
                getCardDefinitionById: options.getCardDefinitionById,
              })
            )
          : [];

      if (remainingSourceChoices.length > 0 && declinedSourceInstanceId) {
        const updatedPendingEffect: PendingTriggeredEffect = {
          ...clearPendingTriggeredEffectTurnSelection(pendingEffect),
          resolvedSourceRegistrationKeys,
        };
        return {
          state: {
            ...stateWithoutPending,
            pendingTriggeredEffects: [
              updatedPendingEffect,
              ...stateWithoutPending.pendingTriggeredEffects,
            ],
            log: [
              ...stateWithoutPending.log,
              `skip_optional_triggered_effect:${action.pendingId}:${declinedSourceInstanceId}`,
              `trigger:requeued:${updatedPendingEffect.pendingId}:${resolvedSourceRegistrationKeys.join(",")}`,
            ],
          },
          pendingId: action.pendingId,
          skipped: true,
        };
      }

      // 残り source なし (= この pending の最後の source を辞退) / source 非バック経路:
      // 従来どおり pending を削除する。
      const skippedState: GameState = {
        ...stateWithoutPending,
        log: [
          ...stateWithoutPending.log,
          `skip_optional_triggered_effect:${action.pendingId}`,
        ],
      };
      // ENGINE-battle-end-pending-triggered-vs-scope-battle-ce: 辞退で battle_end 由来
      // pendingTriggeredEffects が尽きた attackId があれば、予約された scope:"battle" CE
      // 失効をここで発火する。
      const drainedSkippedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
        skippedState,
        options
      );
      return {
        // 任意誘発の辞退も、通常の誘発解決と同じくアタック宣言の後処理へ戻す。
        // 指定アタックでは、最後の pending を drain した時点で強制ブロック宣言窓を
        // 開く必要がある。ここを通さないと activeAttack が declare_attack のまま残り、
        // advanceStep が permanent に blocked になる。
        state: advanceAttackDeclarationStateIfReady(
          resumeStackCascadeIfReady(drainedSkippedState, options),
          options
        ),
        pendingId: action.pendingId,
        skipped: true,
      };
    }

    // 対象は窓クローズ後の解決時に選ぶ (種別非依存延期)。宣言時に対象が渡されたとき
    // (後方互換: テスト/即時解決経路) のみ検証して焼き込む。無ければ空のまま窓へ。
    const resolvedTargetInstanceIds =
      options.targetInstanceIds && options.targetInstanceIds.length > 0
        ? resolveLegalActionTargets(action, options.targetInstanceIds)
        : [];
    const resolvedChosenLifeCoreKind = resolveChosenLifeCoreKind(
      action,
      options.chosenLifeCoreKind
    );
    // 誘発効果の登録メタデータを取得 (composition 判定に先行して必要)
    const triggeredRegistration =
      action.sourceCardNo && action.registrationIndex !== undefined
        ? options.getRegisteredTriggeredEffectActions?.(action.sourceCardNo)?.[
            action.registrationIndex
          ]
        : undefined;

    // ENGINE-conditional-free-magic-use-target-selection: use_magic_without_cost
    // (条件付き無償マジック使用) の同期解決経路から、対象選択が必要な場合に本物の
    // pendingEffectTargetSelection を生成できるようにする窓口。resolveDeferredStackAction は
    // 種別非依存 (actionKind:"magic") に「対象未確定なら pending を立てる、確定/不要なら
    // resolveDeferredMagicStack まで解決する」を行うため、synthetic ActiveStack を1つ渡すだけで
    // 通常の flash 使用と同じ対象選択機構を、新たなスタック窓を開かずに (この
    // resolve_pending_triggered_effect 自体が既に窓クローズ後の解決呼び出しであるため二重窓なし)
    // 再利用できる。options は DeferredStackResolverOptions の Pick 元とフィールドが一致するため
    // 構造的にそのまま渡せる (SSOT: 対象選択ロジックを重複実装しない)。
    const resolveDeferredStackForFreeMagicUse = (
      freeUseState: GameState,
      syntheticStack: ActiveStack
    ): GameState =>
      resolveDeferredStackAction(freeUseState, syntheticStack, options);

    // resource:"card" の paid prevention だけは既存の宣言 variant として処理する。
    // BSGE01-R04 型の count cost は stack 窓後の pendingStepChoice で処理する。
    const paidPreventionImmunityOfferCost =
      action.payPreventionImmunityCost === true &&
      action.sourceInstanceId !== undefined
        ? getPaidPreventionImmunityCost(
            options.state,
            action.sourceInstanceId,
            triggeredRegistration?.effectIndex
          )
        : null;
    const paidPreventionImmunityCost =
      paidPreventionImmunityOfferCost?.resource === "card"
        ? paidPreventionImmunityOfferCost
        : null;
    // engine-effect-prevention-immunity-tribes: 「自分の系統：「○○」を持つ効果は、
    // 相手の効果では防げない」(BSSL01-X02[9,10])。paid variant と異なり対価不要。
    // blanket CE は preventionLevel を unpreventable に焼き、restricted CE は
    // sourcePreventionBypass として防止元 CE ごとに評価する。
    const triggeredDynamicPreventionSourceInstanceId =
      action.sourceEffectInstanceId ?? action.sourceInstanceId;
    const triggeredDynamicPreventionBypass =
      triggeredDynamicPreventionSourceInstanceId !== undefined
        ? getEffectSourceTribePreventionBypass(
            options.state,
            triggeredDynamicPreventionSourceInstanceId,
            action.actingPlayerId,
            options.getCardDefinitionById
          )
        : undefined;
    const isSourceTribeStackNegateImmune =
      triggeredDynamicPreventionSourceInstanceId !== undefined
        ? isEffectSourceTribeStackNegateImmune(
            options.state,
            triggeredDynamicPreventionSourceInstanceId,
            action.actingPlayerId,
            options.getCardDefinitionById
          )
        : false;
    const effectivePreventionLevel: EffectPreventionLevel | undefined =
      paidPreventionImmunityCost !== null ||
      triggeredDynamicPreventionBypass?.kind === "all_effects"
        ? "unpreventable"
        : triggeredRegistration?.preventionLevel;
    const effectivePreventionBypass =
      paidPreventionImmunityCost === null
        ? triggeredDynamicPreventionBypass?.kind === "all_effects"
          ? undefined
          : mergeTargetLockBypassProfiles(
              triggeredRegistration?.targetLockBypass,
              triggeredDynamicPreventionBypass
            )
        : undefined;
    const effectiveNegatePreventionLevel: EffectPreventionLevel | undefined =
      isSourceTribeStackNegateImmune ? "unpreventable" : undefined;

    const pendingBattleEndDeferralAttackId =
      getBattleEndFinalizeAttackIdForPending(pendingEffect);

    // composition メタデータから同時解決 resolver を構築
    let handWrittenEffectResolverLookup = options.getHandWrittenEffectResolver;
    if (
      triggeredRegistration?.composition &&
      action.sourceCardNo &&
      options.getHandWrittenEffectResolver
    ) {
      const composed = buildComposedResolverFromComposition(
        options.getHandWrittenEffectResolver,
        action.sourceCardNo,
        triggeredRegistration.composition,
        options.getConditionalCostCanExecuteCheck,
        options.getConditionalResultSuccessCheck
      );
      if (composed) {
        const fallbackLookup = options.getHandWrittenEffectResolver;
        const sourceCardNo = action.sourceCardNo;
        handWrittenEffectResolverLookup = (cardNo: string) =>
          cardNo === sourceCardNo ? composed : fallbackLookup(cardNo);
      }
    }

    let sourceBackedResolver:
      | ((currentState: GameState, context: { chainId: string }) => GameState)
      | undefined;

    if (action.sourceInstanceId && action.sourceKind) {
      const sourceInstanceId = action.sourceInstanceId;
      const sourceKind = action.sourceKind;

      sourceBackedResolver = (
        currentState: GameState,
        context: { chainId: string }
      ) => {
        const preparedSource = movePrivateTriggeredMagicSourceToInUseIfReady({
          state: currentState,
          pendingEffect,
          sourceInstanceId,
          getCardDefinitionById: options.getCardDefinitionById,
        });
        const resolutionState = preparedSource.state;
        const sourceCard = getCardInstanceOrThrow(
          resolutionState,
          sourceInstanceId,
          "Unknown pending trigger source card"
        );
        const sourceDefinition = getCardDefinitionOrThrow(
          sourceCard.definitionId,
          options.getCardDefinitionById
        );
        const effectSourceDefinition =
          action.sourceEffectDefinitionId !== undefined
            ? getCardDefinitionOrThrow(
                action.sourceEffectDefinitionId,
                options.getCardDefinitionById
              )
            : undefined;

        // hand-written resolver があればそちら、なければ structured effects fallback
        if (handWrittenEffectResolverLookup) {
          return executeHandWrittenEffectResolver({
            state: resolutionState,
            context: {
              chainId: context.chainId,
              resolutionKind: "pending_triggered_effect",
              actingPlayerId: action.actingPlayerId,
              sourceKind,
              sourceCard,
              sourceDefinition,
              ...(effectSourceDefinition !== undefined
                ? { effectSourceDefinition }
                : {}),
              ...(action.sourceEffectInstanceId !== undefined
                ? { effectSourceInstanceId: action.sourceEffectInstanceId }
                : {}),
              ...(action.sourceEffectDefinitionId !== undefined
                ? {
                    effectSourceDefinitionId: action.sourceEffectDefinitionId,
                  }
                : {}),
              targetInstanceIds: resolvedTargetInstanceIds,
              ...(action.targetStepId !== undefined
                ? { targetStepId: action.targetStepId }
                : {}),
              ...(action.targetGroups !== undefined
                ? { targetGroups: action.targetGroups }
                : {}),
              ...(action.choiceIndex !== undefined &&
              resolvedTargetInstanceIds.length > 1
                ? { sequentialTargetConsumption: true }
                : {}),
              getCardDefinitionById: options.getCardDefinitionById,
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
              getRegisteredBurstActions: options.getRegisteredBurstActions,
              resolveDeferredStackForFreeMagicUse,
              ...(options.getRegisteredMagicActions !== undefined
                ? {
                    getRegisteredMagicActions:
                      options.getRegisteredMagicActions,
                  }
                : {}),
              ...(resolvedChosenLifeCoreKind !== undefined
                ? {
                    chosenLifeCoreKind: resolvedChosenLifeCoreKind,
                  }
                : {}),
              ...(action.choiceIndex !== undefined
                ? { choiceIndex: action.choiceIndex }
                : {}),
              ...(pendingEffect.simultaneousGroupId !== undefined
                ? {
                    pendingEffectSimultaneousGroupId:
                      pendingEffect.simultaneousGroupId,
                  }
                : {}),
              pendingEffectPendingId: pendingEffect.pendingId,
              triggeredRootConditionResults: getObservedTriggerConditionResults(
                pendingEffect.timingSourceRegistrations?.[
                  makeResolvedTriggeredSourceKey(
                    action.sourceEffectInstanceId ?? sourceCard.instanceId,
                    action.registrationIndex
                  )
                ]
              ),
              rebirthTimingWindowId: getPendingTriggeredRebirthTimingWindowId(
                pendingEffect,
                sourceCard.controllerPlayerId
              ),
              // P3-14 C-5: イベント量を DynamicCount.event_amount へ伝播。
              ...(pendingEffect.amount !== null
                ? { eventAmount: pendingEffect.amount }
                : {}),
              // 三者観測 game_event の主語 Y を TargetSpec.trigger_related_instance に伝播。
              ...(pendingEffect.relatedInstanceId
                ? {
                    triggerRelatedInstanceId: pendingEffect.relatedInstanceId,
                  }
                : {}),
              ...(pendingEffect.triggerRelatedCombinedHostInstanceId !==
              undefined
                ? {
                    triggerRelatedCombinedHostInstanceId:
                      pendingEffect.triggerRelatedCombinedHostInstanceId,
                  }
                : {}),
              ...(triggeredRelatedInstanceIds !== undefined
                ? { triggerRelatedInstanceIds: triggeredRelatedInstanceIds }
                : {}),
              // engine-advent-source-leave-summon (BSSG01-C08 Lv2): 離脱トリガーが保持する
              // 煌臨元スナップショットを SummonAction.restrictToInstanceIds へ伝播。
              ...(pendingEffect.adventSourceInstanceIds !== undefined
                ? {
                    triggerAdventSourceInstanceIds:
                      pendingEffect.adventSourceInstanceIds,
                  }
                : {}),
              ...(pendingBattleEndDeferralAttackId !== undefined
                ? {
                    battleEndDeferralAttackId: pendingBattleEndDeferralAttackId,
                  }
                : {}),
              ...(pendingEffect.fromZone !== undefined
                ? { triggerFromZone: pendingEffect.fromZone }
                : {}),
              ...(pendingEffect.cause !== undefined
                ? { triggerCause: pendingEffect.cause }
                : {}),
              ...(preparedSource.activationZone !== undefined
                ? { activationZone: preparedSource.activationZone }
                : {}),
              // ENGINE-targeted-disclosure-offfield-source: relatedInstanceId の
              // 現在ゾーンを trigger_related_instance_off_field 条件の解決時再評価へ
              // 渡す (BSLH01-T14「フィールド以外で発揮中の…」)。宣言時 listing 段階
              // (trigger-system.ts) と同じ導出だが、こちらは解決時点の state から
              // 都度引き直す (declare-time snapshot ではない)。
              ...(pendingEffect.relatedInstanceId
                ? (() => {
                    const relatedCard = getCardById(
                      resolutionState,
                      pendingEffect.relatedInstanceId
                    );
                    return relatedCard !== undefined
                      ? { triggerRelatedInstanceZone: relatedCard.zone }
                      : {};
                  })()
                : {}),
              ...(triggerSourceTribes !== undefined
                ? { triggerSourceTribes }
                : {}),
              ...(triggerSourcePlayerId !== undefined
                ? { triggerSourcePlayerId }
                : {}),
              ...(triggerSourceInstanceId !== undefined
                ? { triggerSourceInstanceId }
                : {}),
              ...(options.payCostPaymentSources !== undefined
                ? { payCostPaymentSources: options.payCostPaymentSources }
                : {}),
              ...(options.summonPaymentSources !== undefined
                ? { summonPaymentSources: options.summonPaymentSources }
                : {}),
              ...(options.summonEnterFieldCorePlacements !== undefined
                ? {
                    summonEnterFieldCorePlacements:
                      options.summonEnterFieldCorePlacements,
                  }
                : {}),
              // P3-43: triggered registration の preventionLevel を伝搬。
              // ENGINE-bsge01-r04-paid-prevention-immunity: 対価支払い時は unpreventable 上書き。
              ...(effectivePreventionLevel !== undefined
                ? {
                    sourcePreventionLevel: effectivePreventionLevel,
                  }
                : {}),
              ...(effectivePreventionBypass !== undefined
                ? {
                    sourcePreventionBypass: effectivePreventionBypass,
                  }
                : {}),
              // P3-51: triggered registration の effectIndex を伝搬。
              ...(triggeredRegistration?.effectIndex !== undefined
                ? {
                    targetEffectIndex: triggeredRegistration.effectIndex,
                  }
                : {}),
            },
            getResolver: handWrittenEffectResolverLookup,
          });
        }

        // structured effects fallback（hand-written resolver なし）
        return executeHandWrittenEffectResolver({
          state: resolutionState,
          context: {
            chainId: context.chainId,
            resolutionKind: "pending_triggered_effect",
            actingPlayerId: action.actingPlayerId,
            sourceKind,
            sourceCard,
            sourceDefinition,
            ...(effectSourceDefinition !== undefined
              ? { effectSourceDefinition }
              : {}),
            ...(action.sourceEffectInstanceId !== undefined
              ? { effectSourceInstanceId: action.sourceEffectInstanceId }
              : {}),
            ...(action.sourceEffectDefinitionId !== undefined
              ? { effectSourceDefinitionId: action.sourceEffectDefinitionId }
              : {}),
            targetInstanceIds: resolvedTargetInstanceIds,
            ...(action.targetStepId !== undefined
              ? { targetStepId: action.targetStepId }
              : {}),
            ...(action.targetGroups !== undefined
              ? { targetGroups: action.targetGroups }
              : {}),
            getCardDefinitionById: options.getCardDefinitionById,
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
            resolveDeferredStackForFreeMagicUse,
            ...(options.getRegisteredMagicActions !== undefined
              ? { getRegisteredMagicActions: options.getRegisteredMagicActions }
              : {}),
            ...(resolvedChosenLifeCoreKind !== undefined
              ? {
                  chosenLifeCoreKind: resolvedChosenLifeCoreKind,
                }
              : {}),
            ...(action.choiceIndex !== undefined
              ? { choiceIndex: action.choiceIndex }
              : {}),
            ...(pendingEffect.simultaneousGroupId !== undefined
              ? {
                  pendingEffectSimultaneousGroupId:
                    pendingEffect.simultaneousGroupId,
                }
              : {}),
            pendingEffectPendingId: pendingEffect.pendingId,
            rebirthTimingWindowId: getPendingTriggeredRebirthTimingWindowId(
              pendingEffect,
              sourceCard.controllerPlayerId
            ),
            // P3-14 C-5: イベント量を DynamicCount.event_amount へ伝播。
            ...(pendingEffect.amount !== null
              ? { eventAmount: pendingEffect.amount }
              : {}),
            // 三者観測 game_event の主語 Y を TargetSpec.trigger_related_instance に伝播。
            ...(pendingEffect.relatedInstanceId
              ? {
                  triggerRelatedInstanceId: pendingEffect.relatedInstanceId,
                }
              : {}),
            ...(pendingEffect.triggerRelatedCombinedHostInstanceId !== undefined
              ? {
                  triggerRelatedCombinedHostInstanceId:
                    pendingEffect.triggerRelatedCombinedHostInstanceId,
                }
              : {}),
            ...(triggeredRelatedInstanceIds !== undefined
              ? { triggerRelatedInstanceIds: triggeredRelatedInstanceIds }
              : {}),
            // engine-advent-source-leave-summon (BSSG01-C08 Lv2)
            ...(pendingEffect.adventSourceInstanceIds !== undefined
              ? {
                  triggerAdventSourceInstanceIds:
                    pendingEffect.adventSourceInstanceIds,
                }
              : {}),
            ...(pendingBattleEndDeferralAttackId !== undefined
              ? {
                  battleEndDeferralAttackId: pendingBattleEndDeferralAttackId,
                }
              : {}),
            ...(pendingEffect.fromZone !== undefined
              ? { triggerFromZone: pendingEffect.fromZone }
              : {}),
            ...(pendingEffect.cause !== undefined
              ? { triggerCause: pendingEffect.cause }
              : {}),
            ...(preparedSource.activationZone !== undefined
              ? { activationZone: preparedSource.activationZone }
              : {}),
            // ENGINE-targeted-disclosure-offfield-source: 対応する hand-written
            // resolver 分岐 (上記) と同じ derivation。
            ...(pendingEffect.relatedInstanceId
              ? (() => {
                  const relatedCard = getCardById(
                    resolutionState,
                    pendingEffect.relatedInstanceId
                  );
                  return relatedCard !== undefined
                    ? { triggerRelatedInstanceZone: relatedCard.zone }
                    : {};
                })()
              : {}),
            ...(triggerSourceTribes !== undefined
              ? { triggerSourceTribes }
              : {}),
            ...(triggerSourcePlayerId !== undefined
              ? { triggerSourcePlayerId }
              : {}),
            ...(triggerSourceInstanceId !== undefined
              ? { triggerSourceInstanceId }
              : {}),
            ...(options.payCostPaymentSources !== undefined
              ? { payCostPaymentSources: options.payCostPaymentSources }
              : {}),
            ...(options.summonPaymentSources !== undefined
              ? { summonPaymentSources: options.summonPaymentSources }
              : {}),
            ...(options.summonEnterFieldCorePlacements !== undefined
              ? {
                  summonEnterFieldCorePlacements:
                    options.summonEnterFieldCorePlacements,
                }
              : {}),
            // P3-43: triggered registration の preventionLevel を伝搬。
            // ENGINE-bsge01-r04-paid-prevention-immunity: 対価支払い時は unpreventable 上書き。
            ...(effectivePreventionLevel !== undefined
              ? {
                  sourcePreventionLevel: effectivePreventionLevel,
                }
              : {}),
            ...(effectivePreventionBypass !== undefined
              ? {
                  sourcePreventionBypass: effectivePreventionBypass,
                }
              : {}),
            // P3-51: triggered registration の effectIndex を伝搬。
            ...(triggeredRegistration?.effectIndex !== undefined
              ? {
                  targetEffectIndex: triggeredRegistration.effectIndex,
                }
              : {}),
          },
          getResolver: () => undefined,
        });
      };
    }
    const isTriggeredEffectSuppressed =
      pendingEffect.effectSuppressed === true ||
      (action.sourceInstanceId !== undefined &&
        pendingEffect.suppressedSourceInstanceIds?.includes(
          action.sourceInstanceId
        ) === true) ||
      isEffectSuppressedBeforeDeclaration({
        state: options.state,
        sourceInstanceId: action.sourceInstanceId,
        registration: triggeredRegistration,
        ...(effectivePreventionLevel !== undefined
          ? { sourcePreventionLevel: effectivePreventionLevel }
          : {}),
        ...(effectivePreventionBypass !== undefined
          ? { sourcePreventionBypass: effectivePreventionBypass }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
      });
    const triggeredUsageLimit =
      isTriggeredEffectSuppressed ||
      pendingEffect.usageLimitConsumedOnPrivateDeclaration === true
        ? undefined
        : triggeredRegistration?.usageLimit;
    const triggeredBaseLabel = getStableEffectLabel(
      "triggered",
      action.registrationIndex ?? 0,
      triggeredRegistration
    );
    // 変種別 usageLimit (「ターンに1回ずつ」C05)。effect 共有制限とは別ラベルで独立に消費する。
    // private 宣言は choice 未確定のまま共有制限のみ消費するため、変種別はここで必ず記録する。
    const triggeredVariantUsageLimit =
      !isTriggeredEffectSuppressed && action.choiceIndex !== undefined
        ? triggeredRegistration?.choices?.[action.choiceIndex]?.usageLimit
        : undefined;
    const triggeredVariantLabel =
      action.choiceIndex !== undefined
        ? getChoiceVariantUsageLabel(triggeredBaseLabel, action.choiceIndex)
        : undefined;
    const triggeredRelatedInstanceId =
      pendingEffect.relatedInstanceId ?? undefined;
    // engine-effect-tribe-tag-life-increase-trigger: 原因カードの実効系統 (+ 効果メタ
    // 系統タグ) を trigger_tribes/trigger_source_match 条件評価用に伝搬する
    // (BSTH03-X02「自分の系統：「蓬莱」を持つ効果で、自分のライフが増えたとき」)。
    const triggerSourceTribes = getPendingTriggerSourceTribes(
      options.state,
      pendingEffect,
      options.getCardDefinitionById
    );
    // engine-effect-tribe-tag-life-increase-trigger: 原因カードのコントローラーを
    // trigger_source_player 条件評価用に伝搬する（系統一致だけでは相手由来の発生源も
    // 通ってしまうため、「自分の」限定には必須）。
    const triggerSourcePlayerId = getPendingTriggerSourcePlayerId(
      options.state,
      pendingEffect
    );
    // BSTH07-転醒R01(A)「このネクサス以外の」等、発生源が自カード自身かどうかの
    // 判定用 (trigger_tribes.excludeSelfSource)。
    const triggerSourceInstanceId = getPendingTriggerSourceInstanceIds(
      pendingEffect
    )[0] as string | undefined;
    const triggeredSourceRegistrationKey =
      action.sourceInstanceId !== undefined
        ? makeResolvedTriggeredSourceKey(
            action.sourceEffectInstanceId ?? action.sourceInstanceId,
            action.registrationIndex ?? 0
          )
        : undefined;
    const triggeredRelatedInstanceIds =
      triggeredSourceRegistrationKey !== undefined
        ? (pendingEffect.relatedInstanceIdsBySourceRegistrationKey?.[
            triggeredSourceRegistrationKey
          ] ?? pendingEffect.relatedInstanceIds)
        : pendingEffect.relatedInstanceIds;
    let stateAfterTriggeredUsageRecord = options.state;
    if (
      !isTriggeredEffectSuppressed &&
      action.sourceInstanceId &&
      action.sourceDefinitionId
    ) {
      stateAfterTriggeredUsageRecord = recordEffectUsageIfLimited({
        state: options.state,
        sourceInstanceId:
          action.sourceEffectInstanceId ?? action.sourceInstanceId,
        sourceDefinitionId:
          action.sourceEffectDefinitionId ?? action.sourceDefinitionId,
        effectLabel: triggeredBaseLabel,
        usageLimit: triggeredUsageLimit,
        ...(triggeredRegistration?.limitGroupId
          ? { groupId: triggeredRegistration.limitGroupId }
          : {}),
        ...(triggeredRelatedInstanceId
          ? { relatedInstanceId: triggeredRelatedInstanceId }
          : {}),
        // ENGINE-no-duplicate-per-event-scope: 〔重複不可〕の per-event scope key として
        // 現 pending の pendingId を渡す。同 pending 内の他 source 評価で match させる。
        triggerEventScopeKey: pendingEffect.pendingId,
        // ENGINE-trigger-per-effect-activation-dedup: per_trigger_activation 用 chainId キー。
        // 同 activation 内 (同 chainId) の複数 emit を listener 1 回に dedup する。
        ...(pendingEffect.chainId
          ? { triggerActivationKey: pendingEffect.chainId }
          : {}),
      });
    }
    if (
      action.sourceInstanceId &&
      action.sourceDefinitionId &&
      triggeredVariantUsageLimit &&
      triggeredVariantLabel
    ) {
      stateAfterTriggeredUsageRecord = recordEffectUsageIfLimited({
        state: stateAfterTriggeredUsageRecord,
        sourceInstanceId:
          action.sourceEffectInstanceId ?? action.sourceInstanceId,
        sourceDefinitionId:
          action.sourceEffectDefinitionId ?? action.sourceDefinitionId,
        effectLabel: triggeredVariantLabel,
        usageLimit: triggeredVariantUsageLimit,
        ...(triggeredRelatedInstanceId
          ? { relatedInstanceId: triggeredRelatedInstanceId }
          : {}),
        triggerEventScopeKey: pendingEffect.pendingId,
        ...(pendingEffect.chainId
          ? { triggerActivationKey: pendingEffect.chainId }
          : {}),
      });
    }
    // P3-62 払い戻し情報 (共有 + 変種別の全記録を対称に保持)
    const triggeredRecordedUsage = composeRecordedUsage([
      triggeredUsageLimit !== undefined
        ? {
            effectLabel: triggeredBaseLabel,
            usageLimit: triggeredUsageLimit,
            ...(triggeredRegistration?.limitGroupId
              ? { groupId: triggeredRegistration.limitGroupId }
              : {}),
            ...(triggeredRelatedInstanceId
              ? { relatedInstanceId: triggeredRelatedInstanceId }
              : {}),
          }
        : undefined,
      triggeredVariantUsageLimit !== undefined &&
      triggeredVariantLabel !== undefined
        ? {
            effectLabel: triggeredVariantLabel,
            usageLimit: triggeredVariantUsageLimit,
            ...(triggeredRelatedInstanceId
              ? { relatedInstanceId: triggeredRelatedInstanceId }
              : {}),
          }
        : undefined,
    ]);

    // resource:"card" の scoped paid prevention は既存互換として宣言時に支払う。
    // BSGE01-R04/R02 型の count cost は stack 窓後・対象選択前の
    // pendingStepChoice で支払うため、この宣言 variant 経路では扱わない。
    // ENGINE-paid-prevention-immunity-card-cost Step3: resource:"card" は countValue
    // ではなく cost.zone 内の候補カードを removed_from_game へ移動して支払う。候補数が
    // amount と一致するときは選択不要 (全候補確定除外、後方互換)。候補数が amount を
    // 超えるときは `options.paidPreventionImmunityCardSelection` で player が選んだ
    // instanceId 群 (要 length===amount、候補の部分集合) を使う。省略/不正選択は
    // 「宣言と同時に対価を支払う」variant の前提を満たせないためエラーにする
    // (誤った資源消費/不成立な支払いを黙って通す regression を避ける)。
    if (!isTriggeredEffectSuppressed && paidPreventionImmunityCost !== null) {
      const cardCostCandidates = getPaidPreventionImmunityCardCostCandidates(
        stateAfterTriggeredUsageRecord,
        action.actingPlayerId,
        paidPreventionImmunityCost,
        options.getCardDefinitionById
      );
      const explicitSelection = options.paidPreventionImmunityCardSelection;
      let selectedCandidates: CardInstance[];
      if (explicitSelection !== undefined) {
        const uniqueSelected = Array.from(new Set(explicitSelection));
        if (uniqueSelected.length !== explicitSelection.length) {
          throw new Error(
            "Paid prevention immunity card cost: duplicate card selection"
          );
        }
        if (uniqueSelected.length !== paidPreventionImmunityCost.amount) {
          throw new Error(
            `Paid prevention immunity card cost: selected ${uniqueSelected.length} does not match required amount ${paidPreventionImmunityCost.amount}`
          );
        }
        const candidateMap = new Map(
          cardCostCandidates.map((c) => [c.instanceId, c] as const)
        );
        selectedCandidates = uniqueSelected.map((id) => {
          const candidate = candidateMap.get(id);
          if (!candidate) {
            throw new Error(
              `Paid prevention immunity card cost: selected card is not a candidate: ${id}`
            );
          }
          return candidate;
        });
      } else if (
        cardCostCandidates.length < paidPreventionImmunityCost.amount
      ) {
        throw new Error(
          `Paid prevention immunity card cost: insufficient candidates (${cardCostCandidates.length} < ${paidPreventionImmunityCost.amount})`
        );
      } else if (
        cardCostCandidates.length === paidPreventionImmunityCost.amount
      ) {
        selectedCandidates = cardCostCandidates;
      } else {
        throw new Error(
          `Paid prevention immunity card cost: candidate count ${cardCostCandidates.length} exceeds required amount ${paidPreventionImmunityCost.amount}; explicit paidPreventionImmunityCardSelection is required`
        );
      }
      // engine-alt-cost-summon-multizone (summon-cost-exclude-choice.ts) と同じ理由:
      // cost.zone === "field" のカードは素の moveCardZone だと cannot_leave_field /
      // cannot_be_removed_from_game 耐性チェックと離脱誘発をどちらもスキップしてしまう。
      // trash 等の非フィールドゾーンは従来どおり素の moveCardZone で確定除外する。
      if (paidPreventionImmunityCost.zone === "field") {
        for (const candidate of selectedCandidates) {
          stateAfterTriggeredUsageRecord = executeRemoveFromGame(
            stateAfterTriggeredUsageRecord,
            action.actingPlayerId,
            {
              kind: "remove_from_game",
              target: { player: "self", filter: {}, count: 1 },
            },
            options.getCardDefinitionById,
            action.sourceInstanceId,
            [candidate.instanceId]
          );
        }
        stateAfterTriggeredUsageRecord =
          queuePreFlushGrantedEffectsAndFlushPendingLeaves({
            state: stateAfterTriggeredUsageRecord,
            getCardDefinitionById: options.getCardDefinitionById,
          });
      } else {
        for (const candidate of selectedCandidates) {
          stateAfterTriggeredUsageRecord = moveCardZone(
            stateAfterTriggeredUsageRecord,
            candidate.instanceId,
            "removed_from_game"
          );
        }
      }
    }

    if (isTriggeredEffectSuppressed) {
      const stateWithoutPending: GameState = {
        ...stateAfterTriggeredUsageRecord,
        pendingTriggeredEffects:
          stateAfterTriggeredUsageRecord.pendingTriggeredEffects.filter(
            (p) => p.pendingId !== pendingEffect.pendingId
          ),
        log: [
          ...stateAfterTriggeredUsageRecord.log,
          `trigger:effect-suppressed:${action.pendingId}:${action.sourceInstanceId ?? "all"}`,
        ],
      };
      const stateAfterSuppressedDrain = applyPostResolveTriggeredEffectHandling(
        {
          state: stateWithoutPending,
          pendingEffect,
          resolvedSourceInstanceId:
            action.sourceEffectInstanceId ?? action.sourceInstanceId,
          resolvedSourceRegistrationIndex: action.registrationIndex,
          options,
        }
      );
      return {
        state: resumeStackCascadeIfReady(stateAfterSuppressedDrain, options),
        pendingId: action.pendingId,
      };
    }

    // P3-29 Phase 1: 効果発揮宣言時に stack window を開いて resolver を deferred 化する。
    // オーバーライド resolver / 発揮可能なソース未保有 などは従来通り同期解決する。
    const canDeferTriggeredEffect =
      action.sourceInstanceId !== undefined &&
      action.sourceDefinitionId !== undefined &&
      options.resolvePendingTriggeredEffect === undefined &&
      options.getPendingTriggeredEffectResolver === undefined;

    if (canDeferTriggeredEffect) {
      const triggeredSource = getCardById(
        options.state,
        action.sourceInstanceId!
      );
      const hasDeckHandSource =
        triggeredSource !== undefined &&
        triggeredSource.zone !== "hand" &&
        getOwnEffectSourceZone(
          options.state,
          triggeredSource,
          action.actingPlayerId,
          options.getCardDefinitionById
        ) === "hand";
      const triggeredChainId = `trigger:${pendingEffect.pendingId}`;
      const relatedLeaveIds = new Set([
        ...(triggeredRelatedInstanceIds ?? []),
        ...(triggeredRelatedInstanceId ? [triggeredRelatedInstanceId] : []),
      ]);
      stateAfterTriggeredUsageRecord = trackPendingLeaveReactionChain(
        stateAfterTriggeredUsageRecord,
        pendingEffect,
        triggeredChainId,
        relatedLeaveIds
      );
      const triggeredActiveStack: ActiveStack = {
        stackId: `stack:${triggeredChainId}`,
        actionKind: "triggered_effect",
        chainId: triggeredChainId,
        actingPlayerId: action.actingPlayerId,
        cardInstanceId: action.sourceInstanceId!,
        cardDefinitionId: action.sourceDefinitionId!,
        ...(hasDeckHandSource
          ? {
              sourceActivationZone: "hand" as const,
              sourcePhysicalZone: "deck" as const,
            }
          : {}),
        ...(action.sourceEffectInstanceId !== undefined
          ? { effectSourceInstanceId: action.sourceEffectInstanceId }
          : {}),
        ...(action.sourceEffectDefinitionId !== undefined
          ? { effectSourceDefinitionId: action.sourceEffectDefinitionId }
          : {}),
        targetInstanceIds: [...resolvedTargetInstanceIds],
        ...(action.targetStepId !== undefined
          ? { targetStepId: action.targetStepId }
          : {}),
        ...(action.targetGroups !== undefined
          ? { targetGroups: action.targetGroups }
          : {}),
        ...(resolvedChosenLifeCoreKind !== undefined
          ? { chosenLifeCoreKind: resolvedChosenLifeCoreKind }
          : {}),
        targetEffectFilterTags: [],
        triggeredPendingSnapshot: pendingEffect,
        ...(action.registrationIndex !== undefined
          ? { triggeredRegistrationIndex: action.registrationIndex }
          : {}),
        ...(action.sourceCardNo !== undefined
          ? { triggeredSourceCardNo: action.sourceCardNo }
          : {}),
        ...(action.sourceKind !== undefined
          ? { triggeredSourceKind: action.sourceKind }
          : {}),
        ...(action.choiceIndex !== undefined
          ? { triggeredChoiceIndex: action.choiceIndex }
          : {}),
        ...(action.deferredChoiceIndexes !== undefined
          ? { deferredChoiceIndexes: action.deferredChoiceIndexes }
          : {}),
        ...(triggeredRegistration?.composition
          ? { composition: triggeredRegistration.composition }
          : {}),
        ...(triggeredRegistration?.reevaluationPoints?.length
          ? { reevaluationPoints: triggeredRegistration.reevaluationPoints }
          : {}),
        ...(triggeredRegistration?.suppressionEffectDescriptor
          ? {
              suppressionEffectDescriptor:
                triggeredRegistration.suppressionEffectDescriptor,
            }
          : {}),
        // ENGINE-bsge01-r04-paid-prevention-immunity: 対価支払い時は unpreventable 上書き。
        ...(effectivePreventionLevel !== undefined
          ? { preventionLevel: effectivePreventionLevel }
          : {}),
        ...(effectivePreventionBypass !== undefined
          ? { preventionBypass: effectivePreventionBypass }
          : {}),
        ...(effectiveNegatePreventionLevel !== undefined
          ? { negatePreventionLevel: effectiveNegatePreventionLevel }
          : {}),
        // engine-generic-effect-activation-causal-trigger: 対価支払い時、この
        // triggered effect の解決による離脱誘発効果を抑制する (BSGE01-R02)。
        ...(options.payCostPaymentSources !== undefined
          ? { payCostPaymentSources: options.payCostPaymentSources }
          : {}),
        ...(options.deferPayCostSourceSelection === true
          ? { deferPayCostSourceSelection: true }
          : {}),
        ...(options.summonPaymentSources !== undefined
          ? { summonPaymentSources: options.summonPaymentSources }
          : {}),
        ...(options.summonEnterFieldCorePlacements !== undefined
          ? {
              summonEnterFieldCorePlacements:
                options.summonEnterFieldCorePlacements,
            }
          : {}),
        // P3-62: 宣言時に usageLimit を記録した場合、deferred 解決時の
        //   condition unmet / conditional_cost rollback で払い戻せるよう activeStack に保持。
        //   共有制限 + 変種別制限 (「1回ずつ」) の全記録を対称に持つ。
        ...(triggeredRecordedUsage !== undefined
          ? { recordedUsage: triggeredRecordedUsage }
          : {}),
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      };

      // 宣言段階: pending を一時的に state から外して stack 窓中の二重発揮を防ぐ。
      // deferred resolver で再 insert してから useResolvePendingTriggeredEffectAsAction を呼ぶ。
      const stateAfterDeclaration: GameState = {
        ...stateAfterTriggeredUsageRecord,
        pendingTriggeredEffects:
          stateAfterTriggeredUsageRecord.pendingTriggeredEffects.filter(
            (p) => p.pendingId !== pendingEffect.pendingId
          ),
        log: [
          ...stateAfterTriggeredUsageRecord.log,
          `trigger:declared:${pendingEffect.pendingId}:${pendingEffect.eventKind}:${action.actingPlayerId}`,
        ],
      };

      // P3-34: 全ステップで誘発効果発揮にスタック窓を開く。
      //
      // 既存の親窓があればその下にサブスタックを積む。なければ新規 stack window を開く。
      // 同期解決フォールスルーは廃止 — start/draw/core/refresh/end でも誘発効果発揮には
      // 1-pass cascade スタック窓が必ず開く（2026-05-02 ユーザー裁定）。
      return {
        state: openEffectDeclarationStackWindow({
          baseState: stateAfterTriggeredUsageRecord,
          stateAfterDeclaration,
          activeStack: triggeredActiveStack,
          actingPlayerId: action.actingPlayerId,
        }),
        chainId: triggeredChainId,
        pendingId: pendingEffect.pendingId,
      };
    }

    const result = useResolvePendingTriggeredEffectAsAction({
      state: stateAfterTriggeredUsageRecord,
      actingPlayerId: action.actingPlayerId,
      pendingId: action.pendingId,
      ...(options.resolvePendingTriggeredEffect
        ? {
            resolveEffect: options.resolvePendingTriggeredEffect,
          }
        : sourceBackedResolver
          ? {
              resolveEffect: sourceBackedResolver,
            }
          : {}),
      ...(options.resolvePendingTriggeredEffect || sourceBackedResolver
        ? {}
        : options.getPendingTriggeredEffectResolver
          ? {
              getResolver: options.getPendingTriggeredEffectResolver,
            }
          : {}),
      ...(action.sourceInstanceId &&
      triggeredRegistration?.reevaluationPoints?.length
        ? {
            reevaluation: buildReevaluationConfig(
              triggeredRegistration,
              action.sourceInstanceId,
              resolvedTargetInstanceIds
            )!,
          }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      causedBySourceInstanceId:
        action.sourceEffectInstanceId ?? action.sourceInstanceId ?? null,
    });

    const stateAfterTriggered = maybeQueueEffectActivationBurstCheck({
      state: applyPostResolveTriggeredEffectHandling({
        state: result.state,
        pendingEffect,
        resolvedSourceInstanceId:
          action.sourceEffectInstanceId ?? action.sourceInstanceId,
        resolvedSourceRegistrationIndex: action.registrationIndex,
        options,
      }),
      pendingEffect,
      resolvedSourceInstanceId: action.sourceInstanceId,
      options,
    });

    return {
      ...result,
      state: resumeStackCascadeIfReady(stateAfterTriggered, options),
    };
  },
  resolve_pending_burst_check: (options, action) => {
    const pendingBurstCheck = options.state.pendingBurstChecks.find(
      (currentPendingBurstCheck) =>
        currentPendingBurstCheck.checkId === action.checkId
    );

    if (!pendingBurstCheck) {
      throw new Error(`Unknown pending burst check: checkId=${action.checkId}`);
    }

    if (
      pendingBurstCheck.activationSelected === true ||
      (action.sourceInstanceId &&
        options.state.revealedBurstStates.some(
          (burst) => burst.cardInstanceId === action.sourceInstanceId
        ))
    ) {
      throw new Error(
        `Burst activation already selected: checkId=${action.checkId}`
      );
    }

    // 対象は 2 段階 stack window クローズ後の解決時に選ぶ。
    // resolve_pending_burst_check では宣言時 target を受け付けない。
    if (options.targetInstanceIds && options.targetInstanceIds.length > 0) {
      throw new Error(
        `Burst targets are selected after stack windows: checkId=${action.checkId}`
      );
    }
    const resolvedTargetInstanceIds: string[] = [];
    const resolvedChosenLifeCoreKind = resolveChosenLifeCoreKind(
      action,
      options.chosenLifeCoreKind
    );
    // バースト登録メタデータを取得 (composition 判定に先行して必要)
    const burstRegistration =
      action.sourceCardNo && action.registrationIndex !== undefined
        ? options.getRegisteredBurstActions?.(action.sourceCardNo)?.[
            action.registrationIndex
          ]
        : undefined;
    // P3-62 / P3-63: 「発揮できない」(condition unmet / conditional_cost rollback) と判定された
    //   場合に usageLimit を払い戻すため、sync / deferred 双方の経路で resolver context へ
    //   recordedUsage を伝搬する。RegisteredBurstAction には effectIndex が無いので
    //   fallback の "burst:N" 形式 (既存 recordEffectUsageIfLimited と同一) で固定する。
    const burstEffectLabel = getStableEffectLabel(
      "burst",
      action.registrationIndex ?? 0,
      undefined
    );
    const burstRecordedUsage =
      burstRegistration?.usageLimit !== undefined
        ? {
            effectLabel: burstEffectLabel,
            usageLimit: burstRegistration.usageLimit,
          }
        : undefined;

    // composition メタデータから同時解決 resolver を構築。
    // P3-72: resolver 未配線でも structured effects へ fall back させるため
    //   `() => undefined` を既定とする (executeHandWrittenEffectResolver が
    //   resolver 未登録時に DSL fallback する。誘発効果経路と対称化)。
    let handWrittenEffectResolverLookup: HandWrittenEffectResolverLookup =
      options.getHandWrittenEffectResolver ?? ((_: string) => undefined);
    if (
      burstRegistration?.composition &&
      action.sourceCardNo &&
      options.getHandWrittenEffectResolver
    ) {
      const composed = buildComposedResolverFromComposition(
        options.getHandWrittenEffectResolver,
        action.sourceCardNo,
        burstRegistration.composition,
        options.getConditionalCostCanExecuteCheck,
        options.getConditionalResultSuccessCheck
      );
      if (composed) {
        const fallbackLookup = options.getHandWrittenEffectResolver;
        const sourceCardNo = action.sourceCardNo;
        handWrittenEffectResolverLookup = (cardNo: string) =>
          cardNo === sourceCardNo ? composed : fallbackLookup(cardNo);
      }
    }

    let sourceBackedResolver:
      | ((currentState: GameState, context: { chainId: string }) => GameState)
      | undefined;

    if (
      action.sourceInstanceId &&
      action.sourceKind &&
      (handWrittenEffectResolverLookup ||
        action.playsSourceCardWithoutCostAfterResolve ||
        action.usesSourceCardWithoutCostAfterResolve ||
        action.playsTargetCardWithoutCostAfterResolve ||
        action.usesTargetCardWithoutCostAfterResolve)
    ) {
      const sourceInstanceId = action.sourceInstanceId;
      const sourceKind = action.sourceKind;

      sourceBackedResolver = (
        currentState: GameState,
        context: { chainId: string }
      ) => {
        let resolvedState = currentState;

        if (handWrittenEffectResolverLookup) {
          const sourceCardBeforeResolution = getCardInstanceOrThrow(
            currentState,
            sourceInstanceId,
            "Unknown burst source card"
          );
          const sourceDefinitionBeforeResolution = getCardDefinitionOrThrow(
            sourceCardBeforeResolution.definitionId,
            options.getCardDefinitionById
          );

          resolvedState = executeHandWrittenEffectResolver({
            state: currentState,
            context: {
              chainId: context.chainId,
              resolutionKind: "pending_burst_check",
              burstPostResolutionDestination: getBurstPostResolutionDestination(
                sourceDefinitionBeforeResolution,
                options.getHandWrittenBurstPostResolutionPolicy
              ),
              actingPlayerId: action.actingPlayerId,
              sourceKind,
              sourceCard: sourceCardBeforeResolution,
              sourceDefinition: sourceDefinitionBeforeResolution,
              targetInstanceIds: resolvedTargetInstanceIds,
              ...(burstRegistration?.effectIndex !== undefined
                ? { targetEffectIndex: burstRegistration.effectIndex }
                : {}),
              ...(action.targetStepId !== undefined
                ? { targetStepId: action.targetStepId }
                : {}),
              ...(action.targetGroups !== undefined
                ? { targetGroups: action.targetGroups }
                : {}),
              ...(action.choiceIndex !== undefined &&
              resolvedTargetInstanceIds.length > 1
                ? { sequentialTargetConsumption: true }
                : {}),
              getCardDefinitionById: options.getCardDefinitionById,
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
              getRegisteredBurstActions: options.getRegisteredBurstActions,
              ...(resolvedChosenLifeCoreKind !== undefined
                ? {
                    chosenLifeCoreKind: resolvedChosenLifeCoreKind,
                  }
                : {}),
              ...(action.choiceIndex !== undefined
                ? { choiceIndex: action.choiceIndex }
                : {}),
              // P3-62 / P3-63: 発揮不能判定時の usageLimit refund 情報。
              ...(burstRecordedUsage !== undefined
                ? { recordedUsage: burstRecordedUsage }
                : {}),
            },
            getResolver: handWrittenEffectResolverLookup,
          });
        }

        if (!action.playsSourceCardWithoutCostAfterResolve) {
          if (!action.usesSourceCardWithoutCostAfterResolve) {
            if (action.playsTargetCardWithoutCostAfterResolve) {
              if (resolvedTargetInstanceIds.length === 0) {
                throw new Error(
                  `Burst follow-up card target is missing: checkId=${action.checkId}`
                );
              }

              for (const followUpCardInstanceId of resolvedTargetInstanceIds) {
                const perTargetInput = options.followUpPerTargetInputs?.find(
                  (i) => i.targetInstanceId === followUpCardInstanceId
                );
                const placements =
                  perTargetInput?.enterFieldCorePlacements ??
                  options.enterFieldCorePlacements ??
                  [];

                const deferredFollowUpPlayLookup =
                  options.getHandWrittenEffectResolver
                    ? buildFollowUpResolverLookup({
                        state: resolvedState,
                        followUpInstanceId: followUpCardInstanceId,
                        getCardDefinitionById: options.getCardDefinitionById,
                        baseLookup: options.getHandWrittenEffectResolver,
                        getRegisteredFieldCardEffectActions:
                          options.getRegisteredFieldCardEffectActions,
                        getConditionalCostCanExecuteCheck:
                          options.getConditionalCostCanExecuteCheck,
                      })
                    : undefined;

                resolvedState = playBurstFollowUpCardWithoutPayingCost({
                  state: resolvedState,
                  actingPlayerId: action.actingPlayerId,
                  sourceInstanceId,
                  targetInstanceId: followUpCardInstanceId,
                  getCardDefinitionById: options.getCardDefinitionById,
                  getRegisteredTriggeredEffectActions:
                    options.getRegisteredTriggeredEffectActions,
                  getRegisteredBurstActions: options.getRegisteredBurstActions,
                  enterFieldCorePlacements: placements,
                  chainId: context.chainId,
                  ...(deferredFollowUpPlayLookup
                    ? {
                        getHandWrittenEffectResolver:
                          deferredFollowUpPlayLookup,
                      }
                    : {}),
                }).state;
              }

              return resolvedState;
            }

            if (!action.usesTargetCardWithoutCostAfterResolve) {
              return resolvedState;
            }

            if (resolvedTargetInstanceIds.length === 0) {
              throw new Error(
                `Burst follow-up magic target is missing: checkId=${action.checkId}`
              );
            }

            for (const followUpMagicInstanceId of resolvedTargetInstanceIds) {
              const perTargetInput = options.followUpPerTargetInputs?.find(
                (i) => i.targetInstanceId === followUpMagicInstanceId
              );
              const targetFollowUpMagicOption =
                action.targetFollowUpMagicOptions.find(
                  (targetOption) =>
                    targetOption.targetInstanceId === followUpMagicInstanceId
                );

              if (!targetFollowUpMagicOption) {
                throw new Error(
                  `Burst follow-up magic metadata is missing: checkId=${action.checkId} targetInstanceId=${followUpMagicInstanceId}`
                );
              }
              const followUpSelectionAction = {
                ...targetFollowUpMagicOption,
                actionId: `${action.actionId}:follow-up:${followUpMagicInstanceId}`,
              };
              const resolvedFollowUpTargetInstanceIds =
                resolveLegalActionTargets(
                  followUpSelectionAction,
                  perTargetInput?.followUpTargetInstanceIds ??
                    options.followUpTargetInstanceIds
                );
              const resolvedFollowUpChosenLifeCoreKind =
                resolveChosenLifeCoreKind(
                  followUpSelectionAction,
                  perTargetInput?.followUpChosenLifeCoreKind ??
                    options.followUpChosenLifeCoreKind
                );

              const deferredFollowUpMagicLookup =
                options.getHandWrittenEffectResolver
                  ? buildFollowUpResolverLookup({
                      state: resolvedState,
                      followUpInstanceId: followUpMagicInstanceId,
                      getCardDefinitionById: options.getCardDefinitionById,
                      baseLookup: options.getHandWrittenEffectResolver,
                      getRegisteredMagicActions:
                        options.getRegisteredMagicActions,
                      getConditionalCostCanExecuteCheck:
                        options.getConditionalCostCanExecuteCheck,
                    })
                  : undefined;

              resolvedState = useBurstFollowUpMagicCardWithoutPayingCost({
                state: resolvedState,
                actingPlayerId: action.actingPlayerId,
                sourceInstanceId,
                magicInstanceId: followUpMagicInstanceId,
                getCardDefinitionById: options.getCardDefinitionById,
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
                getRegisteredBurstActions: options.getRegisteredBurstActions,
                ...(resolvedFollowUpTargetInstanceIds.length > 0
                  ? {
                      targetInstanceIds: resolvedFollowUpTargetInstanceIds,
                    }
                  : {}),
                ...(targetFollowUpMagicOption.targetEffectFilterTags
                  ? {
                      targetEffectFilterTags:
                        targetFollowUpMagicOption.targetEffectFilterTags,
                    }
                  : {}),
                ...(resolvedFollowUpChosenLifeCoreKind !== undefined
                  ? {
                      chosenLifeCoreKind: resolvedFollowUpChosenLifeCoreKind,
                    }
                  : {}),
                chainId: context.chainId,
                ...(deferredFollowUpMagicLookup
                  ? {
                      getHandWrittenEffectResolver: deferredFollowUpMagicLookup,
                    }
                  : {}),
              }).state;
            }

            return resolvedState;
          }

          resolvedState = useBurstSourceMagicCardWithoutPayingCost({
            state: resolvedState,
            actingPlayerId: action.actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById: options.getCardDefinitionById,
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
            ...(resolvedTargetInstanceIds.length > 0
              ? {
                  targetInstanceIds: resolvedTargetInstanceIds,
                }
              : {}),
            ...(action.targetEffectFilterTags
              ? {
                  targetEffectFilterTags: action.targetEffectFilterTags,
                }
              : {}),
            ...(resolvedChosenLifeCoreKind !== undefined
              ? {
                  chosenLifeCoreKind: resolvedChosenLifeCoreKind,
                }
              : {}),
            chainId: context.chainId,
            ...(options.getHandWrittenEffectResolver
              ? {
                  getHandWrittenEffectResolver:
                    options.getHandWrittenEffectResolver,
                }
              : {}),
          }).state;

          return resolvedState;
        }

        resolvedState = playBurstSourceCardWithoutPayingCost({
          state: resolvedState,
          actingPlayerId: action.actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
          enterFieldCorePlacements: options.enterFieldCorePlacements ?? [],
          ...(resolvedTargetInstanceIds.length > 0
            ? {
                targetInstanceIds: resolvedTargetInstanceIds,
              }
            : {}),
          ...(action.targetEffectFilterTags
            ? {
                targetEffectFilterTags: action.targetEffectFilterTags,
              }
            : {}),
          ...(resolvedChosenLifeCoreKind !== undefined
            ? {
                chosenLifeCoreKind: resolvedChosenLifeCoreKind,
              }
            : {}),
          chainId: context.chainId,
        }).state;

        return resolvedState;
      };
    }

    // バースト発動: stack window を開いて相手に stack 応答権を与えてから解決する。
    // 10_rules/02 の 2 段階窓は eventKind / step に依存しない。
    const hasFollowUp =
      action.playsSourceCardWithoutCostAfterResolve ||
      action.usesSourceCardWithoutCostAfterResolve ||
      action.playsTargetCardWithoutCostAfterResolve ||
      action.usesTargetCardWithoutCostAfterResolve;

    if (action.sourceInstanceId) {
      const sourceCardForStack = getCardInstanceOrThrow(
        options.state,
        action.sourceInstanceId,
        "Unknown burst source card for deferred stack activation"
      );
      // P3-62 / P3-63: deferred (main step) burst も declaration 時点で usageLimit を記録する。
      // 既存実装は sync 経路でしか recordEffectUsageIfLimited を呼んでおらず、
      // 主ステップ burst では発動制限が機能していなかった。refund と整合させるため
      // 宣言時 record + activeStack.recordedUsage で deferred 解決時 refund 可能にする。
      const stateBeforeStackOpen =
        action.sourceDefinitionId && burstRegistration?.usageLimit !== undefined
          ? recordEffectUsageIfLimited({
              state: options.state,
              sourceInstanceId: action.sourceInstanceId,
              sourceDefinitionId: action.sourceDefinitionId,
              effectLabel: burstEffectLabel,
              usageLimit: burstRegistration.usageLimit,
            })
          : options.state;
      // engine-burst-activation-paid-cost-gate: stack window を開く前 (宣言時) に
      // 対価があれば強制支払いする (BSTH02-M02)。
      const statePaidBurstActivationCost = applyBurstActivationPaidCost(
        stateBeforeStackOpen,
        action.actingPlayerId
      );
      const revealedStateForStack = revealBurstCardForResolution({
        state: statePaidBurstActivationCost,
        activationPending: true,
        actingPlayerId: action.actingPlayerId,
        sourceInstanceId: action.sourceInstanceId,
        checkId: action.checkId,
        getCardDefinitionById: options.getCardDefinitionById,
      });
      const chainId = `burst:${options.state.turnNumber}:${action.actingPlayerId}:${options.state.step}:${action.sourceInstanceId}`;
      const burstNegatePreventionLevel =
        resolveDynamicStackNegatePreventionLevel({
          state: revealedStateForStack,
          sourceInstanceId: action.sourceInstanceId,
          actingPlayerId: action.actingPlayerId,
          getCardDefinitionById: options.getCardDefinitionById,
        });
      const burstActiveStack: ActiveStack = {
        stackId: `stack:${chainId}`,
        actionKind: "burst_activation",
        chainId,
        actingPlayerId: action.actingPlayerId,
        cardInstanceId: action.sourceInstanceId,
        cardDefinitionId: sourceCardForStack.definitionId,
        burstActivationSourceZone: sourceCardForStack.zone,
        targetInstanceIds: [],
        targetEffectFilterTags: [],
        burstCheckId: action.checkId,
        burstPendingSnapshot: pendingBurstCheck,
        ...(burstRegistration?.suppressionEffectDescriptor
          ? {
              suppressionEffectDescriptor:
                burstRegistration.suppressionEffectDescriptor,
            }
          : {}),
        ...(burstNegatePreventionLevel !== undefined
          ? { negatePreventionLevel: burstNegatePreventionLevel }
          : {}),
        ...(action.sourceKind !== undefined
          ? { burstSourceKind: action.sourceKind }
          : {}),
        ...(action.registrationIndex !== undefined
          ? { burstRegistrationIndex: action.registrationIndex }
          : {}),
        ...(action.choiceIndex !== undefined
          ? { burstChoiceIndex: action.choiceIndex }
          : {}),
        ...(action.deferredChoiceIndexes !== undefined
          ? { deferredChoiceIndexes: action.deferredChoiceIndexes }
          : {}),
        ...(hasFollowUp
          ? {
              burstFollowUpInfo: {
                playsSourceCardWithoutCostAfterResolve:
                  action.playsSourceCardWithoutCostAfterResolve,
                usesSourceCardWithoutCostAfterResolve:
                  action.usesSourceCardWithoutCostAfterResolve,
                playsTargetCardWithoutCostAfterResolve:
                  action.playsTargetCardWithoutCostAfterResolve,
                usesTargetCardWithoutCostAfterResolve:
                  action.usesTargetCardWithoutCostAfterResolve,
                targetMagicEffectFilterTagsByInstanceId:
                  action.targetFollowUpMagicOptions.map((opt) => ({
                    instanceId: opt.targetInstanceId,
                    targetEffectFilterTags: opt.targetEffectFilterTags ?? [],
                  })),
                perTargetFollowUpInputs: (
                  options.followUpPerTargetInputs ?? []
                ).map((i) => ({
                  targetInstanceId: i.targetInstanceId,
                  ...(i.enterFieldCorePlacements !== undefined
                    ? { enterFieldCorePlacements: i.enterFieldCorePlacements }
                    : {}),
                  ...(i.followUpTargetInstanceIds !== undefined
                    ? {
                        followUpTargetInstanceIds: i.followUpTargetInstanceIds,
                      }
                    : {}),
                  ...(i.followUpChosenLifeCoreKind !== undefined
                    ? {
                        followUpChosenLifeCoreKind:
                          i.followUpChosenLifeCoreKind,
                      }
                    : {}),
                })),
                ...(options.followUpTargetInstanceIds !== undefined
                  ? {
                      followUpTargetInstanceIds:
                        options.followUpTargetInstanceIds,
                    }
                  : {}),
                ...(options.followUpChosenLifeCoreKind !== undefined
                  ? {
                      followUpChosenLifeCoreKind:
                        options.followUpChosenLifeCoreKind,
                    }
                  : {}),
              },
            }
          : {}),
        ...(action.playsSourceCardWithoutCostAfterResolve &&
        options.enterFieldCorePlacements
          ? { enterFieldCorePlacements: options.enterFieldCorePlacements }
          : {}),
        ...(resolvedChosenLifeCoreKind !== undefined
          ? { chosenLifeCoreKind: resolvedChosenLifeCoreKind }
          : {}),
        // P3-62 / P3-63: deferred 解決時に refund できるよう activeStack に保持。
        ...(burstRecordedUsage !== undefined
          ? { recordedUsage: burstRecordedUsage }
          : {}),
        previousResponseSourcePlayerId: null,
        previousPendingStackAction: null,
      };

      const stateAfterActivationSelection = markBurstActivationSelected({
        state: {
          ...revealedStateForStack,
          pendingBurstChecks: revealedStateForStack.pendingBurstChecks.filter(
            (pending) => {
              if (
                pending.checkId === action.checkId ||
                pending.activationSelected === true ||
                pending.actingPlayerId !== action.actingPlayerId ||
                !options.getRegisteredBurstActions
              ) {
                return true;
              }
              // 今回宣言したカードだけを候補に持つ別の条件事象は消費する。
              // 宣言前の候補を調べ、他カードの手札バーストや従来の空チェックは残す。
              // chainId を記憶してまとめないので、後から生じる事象には影響しない。
              const sources = getAvailableBurstSourceChoices({
                state: options.state,
                pendingBurstCheck: pending,
                getCardDefinitionById: options.getCardDefinitionById,
                getRegisteredBurstActions: options.getRegisteredBurstActions,
              });
              return (
                sources.length === 0 ||
                sources.some(
                  ({ sourceCard }) =>
                    sourceCard.instanceId !== action.sourceInstanceId
                )
              );
            }
          ),
        },
        activeStack: burstActiveStack,
      });
      if (
        stateAfterActivationSelection.pendingPrivateDeclarations.length > 0 ||
        hasPendingBurstActivationSelections(stateAfterActivationSelection)
      ) {
        return {
          state: queueDelayedBurstActivationStack({
            state: stateAfterActivationSelection,
            activeStack: burstActiveStack,
            previousWindow: options.state.window,
          }),
          chainId,
        };
      }

      return {
        state: openBurstActivationStackWindow(
          stateAfterActivationSelection,
          burstActiveStack,
          action.actingPlayerId
        ),
        chainId,
      };
    }

    // バースト解決の usageLimit / reevaluation 記録
    // P3-62 / P3-63: effectLabel は burstEffectLabel と一致させる (refund 時の対応)。
    const burstUsageLimit = burstRegistration?.usageLimit;
    const stateAfterBurstUsageRecord =
      action.sourceInstanceId && action.sourceDefinitionId
        ? recordEffectUsageIfLimited({
            state: options.state,
            sourceInstanceId: action.sourceInstanceId,
            sourceDefinitionId: action.sourceDefinitionId,
            effectLabel: burstEffectLabel,
            usageLimit: burstUsageLimit,
          })
        : options.state;

    // engine-burst-activation-paid-cost-gate: sourceInstanceId 無しの同期解決経路でも
    // 宣言時支払いを同様に適用する (上の deferred 経路と対称)。
    const statePaidBurstActivationCostSync = applyBurstActivationPaidCost(
      stateAfterBurstUsageRecord,
      action.actingPlayerId
    );

    const stateBeforeBurstResolution = action.sourceInstanceId
      ? revealBurstCardForResolution({
          state: statePaidBurstActivationCostSync,
          actingPlayerId: action.actingPlayerId,
          sourceInstanceId: action.sourceInstanceId,
          checkId: action.checkId,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      : statePaidBurstActivationCostSync;

    // P3-77 節②: 無効/発揮できない判定の「前」に発動中窓免疫を登録する (冪等)。
    // これにより節②(発動中受けない=burstActivationWindow 付き defense_immune)が
    // 無効も回避でき、判定が useResolvePendingBurstCheckAsAction 内と一致する。
    // セット束縛(節①)の defense_immune は窓免疫でないため回避源にならない。
    const stateWithBurstImmunity = action.sourceInstanceId
      ? applyBurstActivationImmunity(
          stateBeforeBurstResolution,
          action.checkId,
          options.getCardDefinitionById
        ).state
      : stateBeforeBurstResolution;

    // BSTH01-M13: 「この効果は、相手の『バースト効果を発揮できない』効果を無視して発揮できる」。
    // バーストの Effect.ignoresOpponentCannotActivateBurst を読み、"cannot_activate" のみ
    // バイパスする (無効=nullify は受ける)。
    const burstDefForSuppress = action.sourceDefinitionId
      ? options.getCardDefinitionById(action.sourceDefinitionId)
      : undefined;
    const ignoresOpponentCannotActivateBurst =
      getBurstIgnoresOpponentCannotActivateBurst(
        burstDefForSuppress,
        burstRegistration?.effectIndex,
        burstRegistration?.effectIndex === undefined
      );

    // 効果抑制判定: バーストは発動できるが、バースト効果は発揮されない。
    // P3-77 Step B/C: 相手の「バースト効果を無効/発揮できない」効果でも抑制される。
    const isBurstEffectSuppressed =
      pendingBurstCheck.effectSuppressed ||
      (action.sourceInstanceId !== undefined &&
        isBurstEffectNullifiedByOpponent(
          stateWithBurstImmunity,
          action.sourceInstanceId,
          action.actingPlayerId,
          {
            ignoresOpponentCannotActivateBurst,
            getCardDefinitionById: options.getCardDefinitionById,
          }
        ));
    if (isBurstEffectSuppressed) {
      stateWithBurstImmunity.log.push(
        `burst:effect-suppressed:${action.checkId}:${action.sourceInstanceId ?? "all"}`
      );
    }

    const result = useResolvePendingBurstCheckAsAction({
      state: stateWithBurstImmunity,
      actingPlayerId: action.actingPlayerId,
      checkId: action.checkId,
      ...(burstRegistration?.effectIndex !== undefined
        ? { burstEffectIndex: burstRegistration.effectIndex }
        : {}),
      // 効果抑制時は resolver を渡さない → 空の解決（バースト発動はするが効果は発揮しない）
      ...(isBurstEffectSuppressed
        ? {}
        : options.resolvePendingBurstCheck
          ? {
              resolveEffect: options.resolvePendingBurstCheck,
            }
          : sourceBackedResolver
            ? {
                resolveEffect: sourceBackedResolver,
              }
            : {}),
      ...(isBurstEffectSuppressed ||
      options.resolvePendingBurstCheck ||
      sourceBackedResolver
        ? {}
        : options.getPendingBurstCheckResolver
          ? {
              getResolver: options.getPendingBurstCheckResolver,
            }
          : {}),
      ...(action.sourceInstanceId &&
      burstRegistration?.reevaluationPoints?.length
        ? {
            reevaluation: buildReevaluationConfig(
              burstRegistration,
              action.sourceInstanceId,
              resolvedTargetInstanceIds
            )!,
          }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    if (!action.sourceInstanceId || !options.getRegisteredBurstActions) {
      const drainedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
        result.state,
        options
      );
      return {
        ...result,
        state: resumeStackCascadeIfReady(
          advanceAttackDeclarationStateIfReady(drainedState, options),
          options
        ),
      };
    }

    const resolvedBurstCardInstanceIds = [
      ...pendingBurstCheck.resolvedBurstCardInstanceIds,
      action.sourceInstanceId,
    ];
    const updatedPendingBurstCheck = {
      ...pendingBurstCheck,
      resolvedBurstCardInstanceIds,
    };
    const stateBeforeBurstFinalize = result.state;
    const stateAfterBurstConsumption = collectAndQueueTriggerReactions({
      beforeState: stateBeforeBurstFinalize,
      afterState: finalizeResolvedBurstCard({
        state: stateBeforeBurstFinalize,
        actingPlayerId: action.actingPlayerId,
        sourceInstanceId: action.sourceInstanceId,
        checkId: action.checkId,
        getCardDefinitionById: options.getCardDefinitionById,
        ...(options.getHandWrittenBurstPostResolutionPolicy
          ? {
              getHandWrittenBurstPostResolutionPolicy:
                options.getHandWrittenBurstPostResolutionPolicy,
            }
          : {}),
      }),
      source: "burst_post_resolution",
      chainId: `burst:${action.checkId}`,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      causedByPlayerId: action.actingPlayerId,
      causedBySourceInstanceId: null,
    });
    const remainingSourceChoices = getAvailableBurstSourceChoices({
      state: stateAfterBurstConsumption,
      pendingBurstCheck: updatedPendingBurstCheck,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    if (remainingSourceChoices.length === 0) {
      const drainedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
        stateAfterBurstConsumption,
        options
      );
      return {
        ...result,
        state: resumeStackCascadeIfReady(
          advanceAttackDeclarationStateIfReady(drainedState, options),
          options
        ),
      };
    }

    return {
      ...result,
      state: {
        ...stateAfterBurstConsumption,
        pendingBurstChecks: [
          updatedPendingBurstCheck,
          ...stateAfterBurstConsumption.pendingBurstChecks,
        ],
        log: [
          ...stateAfterBurstConsumption.log,
          `burst:requeued:${updatedPendingBurstCheck.checkId}:${resolvedBurstCardInstanceIds.join(",")}`,
        ],
      },
    };
  },
  decline_pending_burst_check: (options, action) => {
    // P3-71: バースト発動は任意。「発動しない」を選んだ場合は当該
    //   pendingBurstCheck を発火せず破棄する。バーストカードはセットされた
    //   まま残り (zone/burst・setBurstStates 不変)、後続トリガーで再度発動可能。
    const pendingBurstCheck = options.state.pendingBurstChecks.find(
      (currentPendingBurstCheck) =>
        currentPendingBurstCheck.checkId === action.checkId
    );

    if (!pendingBurstCheck) {
      throw new Error(`Unknown pending burst check: checkId=${action.checkId}`);
    }

    if (pendingBurstCheck.actingPlayerId !== action.actingPlayerId) {
      throw new Error(
        `Pending burst check belongs to ${pendingBurstCheck.actingPlayerId}, not ${action.actingPlayerId}`
      );
    }

    // resolveEffect を渡さない = 効果不発で当該チェックを消費 (= 発動しない)。
    const result = useResolvePendingBurstCheckAsAction({
      state: {
        ...options.state,
        log: [
          ...options.state.log,
          `burst:declined:${action.checkId}:${action.actingPlayerId}`,
        ],
      },
      actingPlayerId: action.actingPlayerId,
      checkId: action.checkId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    const drainedState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      result.state,
      options
    );
    return {
      ...result,
      state: resumeStackCascadeIfReady(
        advanceAttackDeclarationStateIfReady(drainedState, options),
        options
      ),
    };
  },
  set_burst: (options, action) => {
    return useSetBurstAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
      sourceInstanceId: action.sourceInstanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  },
  set_mirage: (options, action) => {
    const beforeMirageState = options.state;
    const mirageResult = useSetMirageInStackContextAsAction({
      state: beforeMirageState,
      actingPlayerId: action.actingPlayerId,
      sourceInstanceId: action.sourceInstanceId,
      paymentSources: options.paymentSources ?? [],
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      replacedMirageInstanceIds: action.replacedMirageInstanceIds,
    });
    const { activeStack, ...result } = mirageResult;
    return {
      ...result,
      state: openDeferredDeclarationStackWindow({
        baseState: beforeMirageState,
        stateForWindow: mirageResult.state,
        activeStack,
        actingPlayerId: action.actingPlayerId,
      }),
      chainId: activeStack.chainId,
    };
  },
  set_quartz: (options, action) => {
    const beforeQuartzState = options.state;
    const quartzResult = useSetQuartzInStackContextAsAction({
      state: beforeQuartzState,
      actingPlayerId: action.actingPlayerId,
      quartzInstanceId: action.sourceInstanceId,
      hostInstanceId: action.hostInstanceId,
      slot: action.slot,
      ...(action.replacedQuartzInstanceId !== undefined
        ? { replacedQuartzInstanceId: action.replacedQuartzInstanceId }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
    });
    return {
      state: openDeferredDeclarationStackWindow({
        baseState: beforeQuartzState,
        stateForWindow: quartzResult.state,
        activeStack: quartzResult.activeStack,
        actingPlayerId: action.actingPlayerId,
      }),
      quartzInstanceId: action.sourceInstanceId,
      hostInstanceId: action.hostInstanceId,
      slot: action.slot,
    };
  },
  activate_soul_state: (options, action) => {
    const sourceCard = getCardById(options.state, action.sourceInstanceId);
    if (!sourceCard) {
      throw new Error(
        `Cannot activate soul state: source_card_not_found: ${action.sourceInstanceId}`
      );
    }
    const chainId = `soul_state:${action.sourceInstanceId}`;
    const activeStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "activate_soul_state",
      chainId,
      actingPlayerId: action.actingPlayerId,
      cardInstanceId: action.sourceInstanceId,
      cardDefinitionId: sourceCard.definitionId,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      sourceActivationZone:
        sourceCard.zone === "set_aside" ? "set_aside" : "hand",
      sourceEffectIndex: action.effectIndex,
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };
    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `soul_state:declare:${chainId}:${action.sourceInstanceId}:${action.sourceCardNo}`,
      ],
    };
    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack,
        actingPlayerId: action.actingPlayerId,
      }),
    };
  },
  use_field_card_effect: (options, action) => {
    // P3-99 起動権 variant: grant_effect で付与された起動効果の能動発揮。
    // registration ではなく付与 CE.metadata.grantedEffect を被付与カード (grantee) の
    // 起動効果として宣言する。registration 参照 (sourceCardNo+index) は grantee 自身の
    // 効果を誤って引くため、専用ブロックで処理して return する。解決は
    // resolveDeferredGrantedActivatedEffectStack (mechanic-trigger-handlers.ts) の
    // grantedEffectCeId 分岐。
    if (action.grantedEffectCeId !== undefined) {
      const grantCeId = action.grantedEffectCeId;
      const grantCe = options.state.activeContinuousEffects.find(
        (ce) => ce.effectId === grantCeId
      );
      const grantedEffect = grantCe?.metadata?.grantedEffect as
        | import("../dsl-types").Effect
        | undefined;
      // CE が消えている (発揮元離脱で while_on_field 停止 / turn 満了) 場合は no-op。
      // 列挙時には active だった CE が宣言までに消えた場合の防御 (実質発生しない)。
      const grantee = getCardById(options.state, action.sourceInstanceId);
      if (
        !grantCe ||
        !grantedEffect ||
        !grantee ||
        !canActivateGrantedEffect(
          options.state,
          grantCe,
          grantee,
          options.getCardDefinitionById
        )
      ) {
        return {
          state: options.state,
          chainId: `granted-activated:noop:${grantCeId}`,
        };
      }
      // usageLimit は対象ごとの CE.effectId ではなく、付与元本文の stable identity で消費する。
      const stateAfterGrantUsage = recordEffectUsageIfLimited({
        state: options.state,
        sourceInstanceId: action.sourceInstanceId,
        sourceDefinitionId: action.sourceDefinitionId,
        effectLabel: getGrantedEffectUsageLabel(grantCe, "activated"),
        ...(grantedEffect.limitGroupId
          ? { groupId: grantedEffect.limitGroupId }
          : {}),
        usageLimit: grantedEffect.usageLimit,
      });
      const grantedEffectTimingFilter: "main" | "flash" | "stack" =
        action.timing === "normal" ? "main" : action.timing;
      const grantedDeferred = useFieldCardEffectInFlashContextAsAction({
        state: stateAfterGrantUsage,
        actingPlayerId: action.actingPlayerId,
        sourceInstanceId: action.sourceInstanceId,
        sourceKind: action.sourceKind,
        targetInstanceIds: [],
        targetEffectFilterTags: action.targetEffectFilterTags,
        getCardDefinitionById: options.getCardDefinitionById,
        effectTimingFilter: grantedEffectTimingFilter,
        ...(action.activationLabel !== undefined
          ? { activationLabel: action.activationLabel }
          : {}),
      });
      const grantedStack: ActiveStack = {
        ...grantedDeferred.activeStack,
        grantedEffectCeId: grantCeId,
      };
      return {
        state: openDeferredDeclarationStackWindow({
          baseState: options.state,
          stateForWindow: grantedDeferred.state,
          activeStack: grantedStack,
          actingPlayerId: action.actingPlayerId,
        }),
        chainId: grantedStack.chainId,
      };
    }

    const resolvedChosenLifeCoreKind = resolveChosenLifeCoreKind(
      action,
      options.chosenLifeCoreKind
    );

    // 宣言時に usageLimit の使用回数を記録する
    const fieldEffectRegistrations =
      options.getRegisteredFieldCardEffectActions?.(action.sourceCardNo);
    const fieldEffectRegistration =
      fieldEffectRegistrations?.[action.registrationIndex];
    const fieldEffectPreventionLevel = resolveDynamicSourcePreventionLevel({
      state: options.state,
      sourceInstanceId:
        action.sourceEffectInstanceId ?? action.sourceInstanceId,
      actingPlayerId: action.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      registrationPreventionLevel: fieldEffectRegistration?.preventionLevel,
    });
    const fieldEffectPreventionBypass = resolveDynamicSourcePreventionBypass({
      state: options.state,
      sourceInstanceId:
        action.sourceEffectInstanceId ?? action.sourceInstanceId,
      actingPlayerId: action.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      registrationPreventionBypass: fieldEffectRegistration?.targetLockBypass,
    });
    const fieldEffectNegatePreventionLevel =
      resolveDynamicStackNegatePreventionLevel({
        state: options.state,
        sourceInstanceId:
          action.sourceEffectInstanceId ?? action.sourceInstanceId,
        actingPlayerId: action.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
      });
    if (
      fieldEffectRegistration?.reevaluationPoints?.some((point) =>
        point.checks.includes("effect_suppression")
      ) &&
      !executeReevaluationCheck({
        state: options.state,
        checkKind: "effect_suppression",
        sourceInstanceId: action.sourceInstanceId,
        targetInstanceIds: [],
        ...(fieldEffectPreventionLevel !== undefined
          ? { sourcePreventionLevel: fieldEffectPreventionLevel }
          : {}),
        ...(fieldEffectPreventionBypass !== undefined
          ? { sourcePreventionBypass: fieldEffectPreventionBypass }
          : {}),
        ...(fieldEffectRegistration.suppressionEffectDescriptor !== undefined
          ? {
              suppressionEffectDescriptor:
                fieldEffectRegistration.suppressionEffectDescriptor,
            }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
      })
    ) {
      return {
        state: {
          ...options.state,
          log: [
            ...options.state.log,
            `effect:declaration-suppressed:${action.sourceInstanceId}:${action.registrationIndex}`,
          ],
        },
        chainId: `field_effect:suppressed:${action.sourceInstanceId}:${action.registrationIndex}`,
      };
    }
    const fieldEffectRegistrationForUsage =
      fieldEffectRegistrations?.[action.registrationIndex];
    const fieldEffectUsageLimit = fieldEffectRegistrationForUsage?.usageLimit;
    const fieldEffectUsageSourceDefinitionId =
      action.sourceEffectDefinitionId ?? action.sourceDefinitionId;
    const stateAfterFieldUsageRecord = recordEffectUsageIfLimited({
      state: options.state,
      sourceInstanceId:
        action.sourceEffectInstanceId ?? action.sourceInstanceId,
      sourceDefinitionId: fieldEffectUsageSourceDefinitionId,
      effectLabel: `${action.sourceKind}:${action.registrationIndex}`,
      usageLimit: fieldEffectUsageLimit,
      ...(fieldEffectRegistrationForUsage?.limitGroupId
        ? { groupId: fieldEffectRegistrationForUsage.limitGroupId }
        : {}),
    });

    // legal action.timing → DSL effects のタイミングフィルタ。
    // ActiveStack.chosenTiming は negate(targetEffectTiming) の照合にも使うため、
    // mode:"stack" の効果は "stack" のまま保持する。
    const fieldEffectTimingFilter: "main" | "flash" | "stack" | undefined =
      action.timing === "normal"
        ? "main"
        : action.timing === "flash" || action.timing === "stack"
          ? action.timing
          : undefined;

    if (
      action.timing === "normal" ||
      action.timing === "flash" ||
      action.timing === "stack"
    ) {
      // normal/flash/stack timing: 宣言後にスタック窓を開いて解決を延期する。
      // 対象は窓クローズ後の解決時に選ぶ (種別非依存延期)。宣言時に対象が渡されたとき
      // (後方互換) のみ検証して焼き込む。無ければ空のまま窓へ。
      const deferredResult = useFieldCardEffectInFlashContextAsAction({
        state: stateAfterFieldUsageRecord,
        actingPlayerId: action.actingPlayerId,
        sourceInstanceId: action.sourceInstanceId,
        sourceKind: action.sourceKind,
        ...(action.sourceEffectInstanceId !== undefined
          ? { effectSourceInstanceId: action.sourceEffectInstanceId }
          : {}),
        ...(action.sourceEffectDefinitionId !== undefined
          ? {
              effectSourceDefinitionId: action.sourceEffectDefinitionId,
            }
          : {}),
        targetInstanceIds:
          options.targetInstanceIds && options.targetInstanceIds.length > 0
            ? resolveLegalActionTargets(action, options.targetInstanceIds)
            : [],
        targetEffectFilterTags: action.targetEffectFilterTags,
        ...(action.targetStepId !== undefined
          ? { targetStepId: action.targetStepId }
          : {}),
        ...(action.targetGroups !== undefined
          ? { targetGroups: action.targetGroups }
          : {}),
        ...(fieldEffectPreventionLevel !== undefined
          ? { sourcePreventionLevel: fieldEffectPreventionLevel }
          : {}),
        ...(fieldEffectPreventionBypass !== undefined
          ? { sourcePreventionBypass: fieldEffectPreventionBypass }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
        ...(resolvedChosenLifeCoreKind !== undefined
          ? { chosenLifeCoreKind: resolvedChosenLifeCoreKind }
          : {}),
        ...(fieldEffectTimingFilter
          ? { effectTimingFilter: fieldEffectTimingFilter }
          : {}),
        ...(fieldEffectRegistration?.activationLabel
          ? { activationLabel: fieldEffectRegistration.activationLabel }
          : {}),
        ...(options.payCostPaymentSources !== undefined
          ? { payCostPaymentSources: options.payCostPaymentSources }
          : {}),
        ...(options.deferPayCostSourceSelection === true
          ? { deferPayCostSourceSelection: true }
          : {}),
        ...(options.summonPaymentSources !== undefined
          ? { summonPaymentSources: options.summonPaymentSources }
          : {}),
        ...(options.summonEnterFieldCorePlacements !== undefined
          ? {
              summonEnterFieldCorePlacements:
                options.summonEnterFieldCorePlacements,
            }
          : {}),
        registrationIndex: action.registrationIndex,
        ...(fieldEffectRegistration?.effectIndex !== undefined
          ? { fieldEffectIndex: fieldEffectRegistration.effectIndex }
          : {}),
      });

      // deferred stack に reevaluation / composition 情報を付与
      // P3-62: 宣言時の usageLimit を deferred 解決時の発揮不能判定で
      //   払い戻せるよう activeStack に保持。
      const fieldRecordedUsage = fieldEffectUsageLimit
        ? {
            effectLabel: `${action.sourceKind}:${action.registrationIndex}`,
            usageLimit: fieldEffectUsageLimit,
            ...(fieldEffectRegistrationForUsage?.limitGroupId
              ? { groupId: fieldEffectRegistrationForUsage.limitGroupId }
              : {}),
          }
        : undefined;
      const fieldChoiceStackFields =
        action.choiceIndex !== undefined ||
        action.deferredChoiceIndexes !== undefined
          ? {
              ...(action.choiceIndex !== undefined
                ? { fieldEffectChoiceIndex: action.choiceIndex }
                : {}),
              ...(action.deferredChoiceIndexes !== undefined
                ? { deferredChoiceIndexes: action.deferredChoiceIndexes }
                : {}),
            }
          : {};
      const fieldDeferredStack: ActiveStack =
        fieldEffectRegistration?.reevaluationPoints?.length ||
        fieldEffectRegistration?.suppressionEffectDescriptor ||
        fieldEffectPreventionLevel !== undefined ||
        fieldEffectPreventionBypass !== undefined ||
        fieldEffectNegatePreventionLevel !== undefined ||
        fieldEffectRegistration?.composition ||
        fieldRecordedUsage
          ? {
              ...deferredResult.activeStack,
              ...fieldChoiceStackFields,
              ...(fieldEffectRegistration?.reevaluationPoints?.length
                ? {
                    reevaluationPoints:
                      fieldEffectRegistration.reevaluationPoints,
                  }
                : {}),
              ...(fieldEffectRegistration?.suppressionEffectDescriptor
                ? {
                    suppressionEffectDescriptor:
                      fieldEffectRegistration.suppressionEffectDescriptor,
                  }
                : {}),
              ...(fieldEffectPreventionLevel !== undefined
                ? { preventionLevel: fieldEffectPreventionLevel }
                : {}),
              ...(fieldEffectPreventionBypass !== undefined
                ? { preventionBypass: fieldEffectPreventionBypass }
                : {}),
              ...(fieldEffectNegatePreventionLevel !== undefined
                ? { negatePreventionLevel: fieldEffectNegatePreventionLevel }
                : {}),
              ...(fieldEffectRegistration?.composition
                ? { composition: fieldEffectRegistration.composition }
                : {}),
              ...(fieldRecordedUsage
                ? { recordedUsage: fieldRecordedUsage }
                : {}),
            }
          : {
              ...deferredResult.activeStack,
              ...fieldChoiceStackFields,
            };

      return {
        state: openDeferredDeclarationStackWindow({
          baseState: options.state,
          stateForWindow: deferredResult.state,
          activeStack: fieldDeferredStack,
          actingPlayerId: action.actingPlayerId,
        }),
        chainId: fieldDeferredStack.chainId,
      };
    }

    // 対象は窓クローズ後の解決時に選ぶ (種別非依存延期)。宣言時に対象が渡されたとき
    // (後方互換) のみ検証して焼き込む。無ければ空のまま窓へ。
    const fieldResolvedTargets =
      options.targetInstanceIds && options.targetInstanceIds.length > 0
        ? resolveLegalActionTargets(action, options.targetInstanceIds)
        : [];

    // composition メタデータから同時解決 resolver を構築
    const fieldComposedResolver =
      fieldEffectRegistration?.composition &&
      options.getHandWrittenEffectResolver
        ? buildComposedResolverFromComposition(
            options.getHandWrittenEffectResolver,
            action.sourceCardNo,
            fieldEffectRegistration.composition,
            options.getConditionalCostCanExecuteCheck,
            options.getConditionalResultSuccessCheck
          )
        : undefined;

    const fieldCardEffectOptions = {
      state: stateAfterFieldUsageRecord,
      actingPlayerId: action.actingPlayerId,
      sourceInstanceId: action.sourceInstanceId,
      sourceKind: action.sourceKind,
      targetInstanceIds: fieldResolvedTargets,
      targetEffectFilterTags: action.targetEffectFilterTags,
      ...(action.targetStepId !== undefined
        ? { targetStepId: action.targetStepId }
        : {}),
      ...(fieldEffectPreventionLevel !== undefined
        ? { sourcePreventionLevel: fieldEffectPreventionLevel }
        : {}),
      ...(fieldEffectPreventionBypass !== undefined
        ? { sourcePreventionBypass: fieldEffectPreventionBypass }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(resolvedChosenLifeCoreKind !== undefined
        ? {
            chosenLifeCoreKind: resolvedChosenLifeCoreKind,
          }
        : {}),
      ...(options.resolveFieldCardEffect
        ? {
            resolveEffect: options.resolveFieldCardEffect,
          }
        : fieldComposedResolver
          ? {
              resolveEffect: fieldComposedResolver,
            }
          : {}),
      ...(options.getHandWrittenEffectResolver
        ? {
            getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
          }
        : {}),
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      ...(fieldEffectRegistration?.reevaluationPoints?.length
        ? {
            reevaluation: buildReevaluationConfig(
              fieldEffectRegistration,
              action.sourceInstanceId,
              fieldResolvedTargets
            )!,
          }
        : {}),
      ...(fieldEffectTimingFilter
        ? { effectTimingFilter: fieldEffectTimingFilter }
        : {}),
      ...(fieldEffectRegistration?.effectIndex !== undefined
        ? { targetEffectIndex: fieldEffectRegistration.effectIndex }
        : {}),
      ...(action.sourceEffectInstanceId !== undefined
        ? { effectSourceInstanceId: action.sourceEffectInstanceId }
        : {}),
      ...(action.sourceEffectDefinitionId !== undefined
        ? {
            effectSourceDefinitionId: action.sourceEffectDefinitionId,
          }
        : {}),
      ...(action.choiceIndex !== undefined
        ? { choiceIndex: action.choiceIndex }
        : {}),
      ...(options.payCostPaymentSources !== undefined
        ? { payCostPaymentSources: options.payCostPaymentSources }
        : {}),
      ...(options.summonPaymentSources !== undefined
        ? { summonPaymentSources: options.summonPaymentSources }
        : {}),
      ...(options.summonEnterFieldCorePlacements !== undefined
        ? {
            summonEnterFieldCorePlacements:
              options.summonEnterFieldCorePlacements,
          }
        : {}),
    };

    return useFieldCardEffectAsAction(fieldCardEffectOptions);
  },
  use_hand_card_effect: (options, action) => {
    const resolvedChosenLifeCoreKind = resolveChosenLifeCoreKind(
      action,
      options.chosenLifeCoreKind
    );

    // 宣言時に usageLimit を記録する（ターン内再起動を抑止）。
    const handRegistrations = options.getRegisteredHandActivatedEffectActions?.(
      action.sourceCardNo
    );
    const handRegistration = handRegistrations?.[action.registrationIndex];
    const handUsageLimit = handRegistration?.usageLimit;
    const handEffectLabel = `hand_activated:${action.registrationIndex}`;
    const handNegatePreventionLevel = resolveDynamicStackNegatePreventionLevel({
      state: options.state,
      sourceInstanceId: action.sourceInstanceId,
      actingPlayerId: action.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    let stateAfterHandUsageRecord = recordEffectUsageIfLimited({
      state: options.state,
      sourceInstanceId: action.sourceInstanceId,
      sourceDefinitionId: action.sourceDefinitionId,
      effectLabel: handEffectLabel,
      usageLimit: handUsageLimit,
      ...(handRegistration?.limitGroupId
        ? { groupId: handRegistration.limitGroupId }
        : {}),
    });
    const handSourceBeforeDeclaration = getCardById(
      stateAfterHandUsageRecord,
      action.sourceInstanceId
    );
    const handChainId = `hand-effect:${action.sourceInstanceId}:${action.registrationIndex}`;
    if (
      (action.activationLabel ?? action.chosenTiming) === "flash" &&
      handSourceBeforeDeclaration !== undefined
    ) {
      stateAfterHandUsageRecord = queueFlashUsedTriggers({
        chainId: handChainId,
        state: stateAfterHandUsageRecord,
        flashSourceInstanceId: action.sourceInstanceId,
        userPlayerId: action.actingPlayerId,
        flashSourceFromZone: handSourceBeforeDeclaration.zone,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      });
    }

    // 対象は窓クローズ後の解決時に選ぶ (種別非依存延期)。宣言時に対象が渡されたとき
    // (後方互換) のみ検証して焼き込む。無ければ空のまま窓へ。
    const handResolvedTargets =
      options.targetInstanceIds && options.targetInstanceIds.length > 0
        ? resolveLegalActionTargets(action, options.targetInstanceIds)
        : [];

    const handSourceDefinition = options.getCardDefinitionById(
      action.sourceDefinitionId
    );
    const handFieldEffectSourceKind = handSourceDefinition
      ? getEffectRegistrationSourceKindForPrintedCategory(
          handSourceDefinition.printedCategory
        )
      : "spirit";
    const handActiveStack: ActiveStack = {
      stackId: `stack:${handChainId}`,
      actionKind: "hand_card_effect",
      chainId: handChainId,
      actingPlayerId: action.actingPlayerId,
      cardInstanceId: action.sourceInstanceId,
      cardDefinitionId: action.sourceDefinitionId,
      targetInstanceIds: [...handResolvedTargets],
      ...(action.targetStepId !== undefined
        ? { targetStepId: action.targetStepId }
        : {}),
      ...(action.targetGroups !== undefined
        ? { targetGroups: action.targetGroups }
        : {}),
      ...(resolvedChosenLifeCoreKind !== undefined
        ? { chosenLifeCoreKind: resolvedChosenLifeCoreKind }
        : {}),
      targetEffectFilterTags: action.targetEffectFilterTags,
      // 手札起動効果: ソースは手札/手元/トラッシュの印字カテゴリに従う。
      fieldEffectSourceKind: handFieldEffectSourceKind,
      handActivatedEffectIndex: action.effectIndex,
      ...(action.choiceIndex !== undefined
        ? { handActivatedChoiceIndex: action.choiceIndex }
        : {}),
      ...(action.deferredChoiceIndexes !== undefined
        ? { deferredChoiceIndexes: action.deferredChoiceIndexes }
        : {}),
      chosenTiming: action.chosenTiming,
      ...(action.activationLabel
        ? { activationLabel: action.activationLabel }
        : {}),
      sourceActivationZone: action.sourceActivationZone,
      ...(handSourceBeforeDeclaration?.zone === "deck"
        ? { sourcePhysicalZone: "deck" as const }
        : {}),
      ...(handRegistration?.reevaluationPoints?.length
        ? { reevaluationPoints: handRegistration.reevaluationPoints }
        : {}),
      ...(handRegistration?.suppressionEffectDescriptor
        ? {
            suppressionEffectDescriptor:
              handRegistration.suppressionEffectDescriptor,
          }
        : {}),
      ...(handRegistration?.preventionLevel !== undefined
        ? { preventionLevel: handRegistration.preventionLevel }
        : {}),
      ...(handNegatePreventionLevel !== undefined
        ? { negatePreventionLevel: handNegatePreventionLevel }
        : {}),
      ...(options.payCostPaymentSources !== undefined
        ? { payCostPaymentSources: options.payCostPaymentSources }
        : {}),
      ...(options.deferPayCostSourceSelection === true
        ? { deferPayCostSourceSelection: true }
        : {}),
      ...(options.summonPaymentSources !== undefined
        ? { summonPaymentSources: options.summonPaymentSources }
        : {}),
      ...(options.summonEnterFieldCorePlacements !== undefined
        ? {
            summonEnterFieldCorePlacements:
              options.summonEnterFieldCorePlacements,
          }
        : {}),
      ...(handUsageLimit !== undefined
        ? {
            recordedUsage: {
              effectLabel: handEffectLabel,
              usageLimit: handUsageLimit,
              ...(handRegistration?.limitGroupId
                ? { groupId: handRegistration.limitGroupId }
                : {}),
            },
          }
        : {}),
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    let stateAfterHandDeclaration = stateAfterHandUsageRecord;
    const handSourceForInUse = getCardById(
      stateAfterHandDeclaration,
      action.sourceInstanceId
    );
    if (
      handSourceForInUse !== undefined &&
      handSourceForInUse.zone !== "field" &&
      handSourceForInUse.zone !== "in_use"
    ) {
      stateAfterHandDeclaration = moveCardZone(
        stateAfterHandDeclaration,
        action.sourceInstanceId,
        "in_use",
        undefined
      );
    }

    // B 型: コスト入力確定後に通常どおりスタック窓を開く（誘発効果発揮と同じ開き方、
    // 全ステップ対応。メイン限定ではない）。解決は fallthrough で
    // resolveDeferredFieldEffectStack（hand_card_effect 対応済み）が行う。
    // P3-113 スライス2: 誘発効果発揮宣言と分岐順序が完全一致するため
    // openEffectDeclarationStackWindow をそのまま再利用する。
    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration: stateAfterHandDeclaration,
        activeStack: handActiveStack,
        actingPlayerId: action.actingPlayerId,
      }),
      chainId: handChainId,
    };
  },
  resolve_battle_immediate_effect: (options, action) => {
    // optional 効果のスキップ: prompt から除去して resolver をスキップ。
    // P3-91: skipOnly action (全 variant が発揮不能で drain 専用) は
    // skipOptionalEffect 指定が無くても常にスキップ経路で prompt を除去する。
    if (
      action.skipOnly === true ||
      (options.skipOptionalEffect &&
        (action.executionMode === "optional" ||
          action.canSkipDuplicate === true))
    ) {
      const promptId = action.promptId;
      options.state.log.push(
        `skip_optional_battle_immediate_effect:${promptId}`
      );
      const stateAfterSkip: GameState = {
        ...options.state,
        battleImmediateEffects: options.state.battleImmediateEffects.filter(
          (p) => p.promptId !== promptId
        ),
      };
      return {
        // バースト発動後は他の誘発/即時効果をすべて解決してから、効果発揮
        // 宣言のスタック窓へ進む。最後の即時効果を辞退して drain した時点で
        // cascade を再開しないと、activationSelected 済みの burst check が
        // 残ったまま end_attack_step へ進もうとして stranded する。
        state: resumeStackCascadeIfReady(
          advanceAttackDeclarationStateIfReady(stateAfterSkip, options),
          options
        ),
        promptId,
        skipped: true,
      };
    }

    resolveChosenLifeCoreKind(action, options.chosenLifeCoreKind);

    // P3-24 Phase 2: choice 変種は単一 registration の choices[] に集約済みのため、
    // 元の registration をそのまま使用する。choiceIndex は EffectActionContext に伝播し、
    // effect-interpreter 側で step.choice[choiceIndex - 1] を選択する。
    const actionPromptId = action.promptId;
    const battleImmPrompt = options.state.battleImmediateEffects.find(
      (p) => p.promptId === actionPromptId
    );
    const battleImmAllRegistrations =
      battleImmPrompt && options.getRegisteredBattleImmediateEffectActions
        ? options.getRegisteredBattleImmediateEffectActions(action.sourceCardNo)
        : undefined;
    const battleImmRegistration =
      battleImmAllRegistrations?.[battleImmPrompt?.registrationIndex ?? 0];
    const actionChoiceIndex = (action as { choiceIndex?: number }).choiceIndex;
    const battleImmUsageSourceDefinitionId =
      action.sourceEffectDefinitionId ?? action.sourceDefinitionId;
    const battleImmUsageSourceInstanceId =
      action.sourceEffectInstanceId ?? action.sourceInstanceId;
    const battleImmPreventionLevel = resolveDynamicSourcePreventionLevel({
      state: options.state,
      sourceInstanceId: battleImmUsageSourceInstanceId,
      actingPlayerId: action.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      registrationPreventionLevel: battleImmRegistration?.preventionLevel,
    });
    const battleImmPreventionBypass = resolveDynamicSourcePreventionBypass({
      state: options.state,
      sourceInstanceId: battleImmUsageSourceInstanceId,
      actingPlayerId: action.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      registrationPreventionBypass: battleImmRegistration?.targetLockBypass,
    });
    const battleImmNegatePreventionLevel =
      resolveDynamicStackNegatePreventionLevel({
        state: options.state,
        sourceInstanceId: battleImmUsageSourceInstanceId,
        actingPlayerId: action.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
      });
    const isBattleImmediateEffectSuppressed =
      isEffectSuppressedBeforeDeclaration({
        state: options.state,
        sourceInstanceId: action.sourceInstanceId,
        registration: battleImmRegistration,
        ...(battleImmPreventionLevel !== undefined
          ? { sourcePreventionLevel: battleImmPreventionLevel }
          : {}),
        ...(battleImmPreventionBypass !== undefined
          ? { sourcePreventionBypass: battleImmPreventionBypass }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
      });
    if (isBattleImmediateEffectSuppressed) {
      const promptId = action.promptId;
      const stateAfterSuppressedDrain: GameState = {
        ...options.state,
        battleImmediateEffects: options.state.battleImmediateEffects.filter(
          (p) => p.promptId !== promptId
        ),
        log: [
          ...options.state.log,
          `battle:immediate:effect-suppressed:${promptId}:${action.sourceInstanceId}`,
        ],
      };
      return {
        state: resumeStackCascadeIfReady(
          advanceAttackDeclarationStateIfReady(
            stateAfterSuppressedDrain,
            options
          ),
          options
        ),
        promptId,
      };
    }

    // 発揮時に usageLimit の使用回数を記録する（選択された registration の effectLabel を使用）
    const battleImmBaseLabel = getStableEffectLabel(
      "battle_immediate",
      battleImmPrompt?.registrationIndex ?? 0,
      battleImmRegistration
    );
    const battleImmTriggerEventScopeKey = battleImmPrompt
      ? `battle_immediate:${battleImmPrompt.attackId}:${battleImmPrompt.timing}:${battleImmPrompt.sourceEffectDefinitionId ?? battleImmPrompt.sourceDefinitionId}:${battleImmPrompt.registrationIndex}`
      : undefined;
    // 変種別 usageLimit (「ターンに1回ずつ」C05 アタック時)。共有制限とは別ラベルで独立消費。
    const battleImmVariantUsageLimit =
      actionChoiceIndex !== undefined
        ? battleImmRegistration?.choices?.[actionChoiceIndex]?.usageLimit
        : undefined;
    const battleImmVariantLabel =
      actionChoiceIndex !== undefined
        ? getChoiceVariantUsageLabel(battleImmBaseLabel, actionChoiceIndex)
        : undefined;
    let stateAfterBattleImmUsageRecord = recordEffectUsageIfLimited({
      state: options.state,
      sourceInstanceId: battleImmUsageSourceInstanceId,
      sourceDefinitionId: battleImmUsageSourceDefinitionId,
      effectLabel: battleImmBaseLabel,
      usageLimit: battleImmRegistration?.usageLimit,
      ...(battleImmTriggerEventScopeKey !== undefined
        ? { triggerEventScopeKey: battleImmTriggerEventScopeKey }
        : {}),
      ...(battleImmRegistration?.limitGroupId
        ? { groupId: battleImmRegistration.limitGroupId }
        : {}),
    });
    if (battleImmVariantUsageLimit && battleImmVariantLabel) {
      stateAfterBattleImmUsageRecord = recordEffectUsageIfLimited({
        state: stateAfterBattleImmUsageRecord,
        sourceInstanceId: battleImmUsageSourceInstanceId,
        sourceDefinitionId: battleImmUsageSourceDefinitionId,
        effectLabel: battleImmVariantLabel,
        usageLimit: battleImmVariantUsageLimit,
        ...(battleImmTriggerEventScopeKey !== undefined
          ? { triggerEventScopeKey: battleImmTriggerEventScopeKey }
          : {}),
      });
    }
    // P3-62 払い戻し情報 (共有 + 変種別の全記録を対称に保持)
    const battleImmRecordedUsage = composeRecordedUsage([
      battleImmRegistration?.usageLimit !== undefined
        ? {
            sourceInstanceId: battleImmUsageSourceInstanceId,
            effectLabel: battleImmBaseLabel,
            usageLimit: battleImmRegistration.usageLimit,
            ...(battleImmTriggerEventScopeKey !== undefined
              ? { triggerEventScopeKey: battleImmTriggerEventScopeKey }
              : {}),
            ...(battleImmRegistration.limitGroupId
              ? { groupId: battleImmRegistration.limitGroupId }
              : {}),
          }
        : undefined,
      battleImmVariantUsageLimit !== undefined &&
      battleImmVariantLabel !== undefined
        ? {
            sourceInstanceId: battleImmUsageSourceInstanceId,
            effectLabel: battleImmVariantLabel,
            usageLimit: battleImmVariantUsageLimit,
            ...(battleImmTriggerEventScopeKey !== undefined
              ? { triggerEventScopeKey: battleImmTriggerEventScopeKey }
              : {}),
          }
        : undefined,
    ]);
    // 対象は窓クローズ後の解決時に選ぶ (種別非依存延期)。宣言時に対象が渡されたとき
    // (後方互換) のみ検証して焼き込む。無ければ空のまま窓へ。
    const battleImmResolvedTargets =
      options.targetInstanceIds && options.targetInstanceIds.length > 0
        ? resolveLegalActionTargets(action, options.targetInstanceIds)
        : [];

    // composition メタデータから同時解決 resolver を構築
    const battleImmComposedResolver =
      battleImmRegistration?.composition && options.getHandWrittenEffectResolver
        ? buildComposedResolverFromComposition(
            options.getHandWrittenEffectResolver,
            action.sourceCardNo,
            battleImmRegistration.composition,
            options.getConditionalCostCanExecuteCheck,
            options.getConditionalResultSuccessCheck
          )
        : undefined;

    // 効果発揮宣言時にスタック窓を開いて resolver を deferred 化する（02:200「常時以外の
    // 効果発揮」）。flash 窓中はそのサブスタック、flash 窓前のアタック時等は新規 stack window
    // を開く (openEffectDeclarationStackWindow が窓種別を選択)。誘発効果 (P3-34) と同じく
    // 宣言→窓→クローズ→解決(対象選択含む) の順に統一する。窓クローズ後は cascade が
    // resolveDeferredBattleImmediateEffectStack を呼び、対象選択 (pendingEffectTargetSelection)
    // と advanceAttackDeclarationStateIfReady を行う。
    // resolveFieldCardEffect override (test 用) のときのみ従来の同期解決を維持する。
    const deferBattleImmediateViaStackWindow =
      battleImmPrompt !== undefined &&
      options.resolveFieldCardEffect === undefined;

    // battle_immediate ActiveStack は 2 経路で使う:
    //   defer 経路 (発揮宣言→スタック窓) = openEffectDeclarationStackWindow の対象。
    //   同期経路 (resolveFieldCardEffect override) = pendingEffectTargetSelection の deferredStack。
    const battleImmediateChainId = battleImmPrompt
      ? `battle:immediate:${battleImmPrompt.promptId}`
      : undefined;
    const battleImmediateActiveStack: ActiveStack | undefined =
      battleImmPrompt && battleImmediateChainId
        ? {
            stackId: `stack:${battleImmediateChainId}`,
            actionKind: "battle_immediate_effect",
            chainId: battleImmediateChainId,
            actingPlayerId: action.actingPlayerId,
            cardInstanceId: action.sourceInstanceId,
            cardDefinitionId: action.sourceDefinitionId,
            ...(battleImmPrompt.sourceEffectInstanceId !== undefined
              ? {
                  effectSourceInstanceId:
                    battleImmPrompt.sourceEffectInstanceId,
                }
              : {}),
            ...(battleImmPrompt.sourceEffectDefinitionId !== undefined
              ? {
                  effectSourceDefinitionId:
                    battleImmPrompt.sourceEffectDefinitionId,
                }
              : {}),
            targetInstanceIds: [...battleImmResolvedTargets],
            ...(action.targetStepId !== undefined
              ? { targetStepId: action.targetStepId }
              : {}),
            ...(action.targetGroups !== undefined
              ? { targetGroups: action.targetGroups }
              : {}),
            ...(action.candidateTargetZones !== undefined
              ? { candidateTargetZones: action.candidateTargetZones }
              : {}),
            targetEffectFilterTags: action.targetEffectFilterTags,
            battleImmediatePromptSnapshot: battleImmPrompt,
            battleImmediateRegistrationIndex: battleImmPrompt.registrationIndex,
            battleImmediateSourceCardNo: action.sourceCardNo,
            battleImmediateSourceKind: action.sourceKind,
            ...(actionChoiceIndex !== undefined
              ? { battleImmediateChoiceIndex: actionChoiceIndex }
              : {}),
            ...(action.deferredChoiceIndexes !== undefined
              ? { deferredChoiceIndexes: action.deferredChoiceIndexes }
              : {}),
            ...(options.payCostPaymentSources !== undefined
              ? { payCostPaymentSources: options.payCostPaymentSources }
              : {}),
            ...(battleImmPreventionLevel !== undefined
              ? {
                  battleImmediatePreventionLevel: battleImmPreventionLevel,
                }
              : {}),
            ...(battleImmPreventionBypass !== undefined
              ? { preventionBypass: battleImmPreventionBypass }
              : {}),
            ...(battleImmRegistration?.composition
              ? { composition: battleImmRegistration.composition }
              : {}),
            ...(battleImmRegistration?.reevaluationPoints?.length
              ? {
                  reevaluationPoints: battleImmRegistration.reevaluationPoints,
                }
              : {}),
            ...(battleImmRegistration?.suppressionEffectDescriptor
              ? {
                  suppressionEffectDescriptor:
                    battleImmRegistration.suppressionEffectDescriptor,
                }
              : {}),
            ...(battleImmPreventionLevel !== undefined
              ? { preventionLevel: battleImmPreventionLevel }
              : {}),
            ...(battleImmPreventionBypass !== undefined
              ? { preventionBypass: battleImmPreventionBypass }
              : {}),
            ...(battleImmNegatePreventionLevel !== undefined
              ? { negatePreventionLevel: battleImmNegatePreventionLevel }
              : {}),
            // P3-62: 宣言時に usageLimit を記録した場合、deferred 解決時の発揮不能判定で
            //   払い戻せるよう activeStack に保持 (共有 + 変種別の全記録)。
            ...(battleImmRecordedUsage !== undefined
              ? { recordedUsage: battleImmRecordedUsage }
              : {}),
            previousResponseSourcePlayerId: null,
            previousPendingStackAction: null,
          }
        : undefined;

    if (
      deferBattleImmediateViaStackWindow &&
      battleImmPrompt &&
      battleImmediateActiveStack &&
      battleImmediateChainId
    ) {
      // 宣言段階: prompt を一時的に state から外して stack 窓中の二重発揮を防ぐ。
      // deferred resolver で再 insert してから useBattleImmediateEffectAsAction を呼ぶ。
      const stateAfterDeclaration: GameState = {
        ...stateAfterBattleImmUsageRecord,
        battleImmediateEffects:
          stateAfterBattleImmUsageRecord.battleImmediateEffects.filter(
            (p) => p.promptId !== battleImmPrompt.promptId
          ),
        log: [
          ...stateAfterBattleImmUsageRecord.log,
          `battle:immediate:declared:${battleImmPrompt.promptId}:${battleImmPrompt.timing}:${action.actingPlayerId}`,
        ],
      };

      // flash 窓中ならそのサブスタック、flash 窓前 (アタック時等) なら新規 stack window。
      return {
        state: openEffectDeclarationStackWindow({
          baseState: options.state,
          stateAfterDeclaration,
          activeStack: battleImmediateActiveStack,
          actingPlayerId: action.actingPlayerId,
        }),
        chainId: battleImmediateChainId,
        promptId: battleImmPrompt.promptId,
      };
    }

    // 同期解決経路 (resolveFieldCardEffect override の test 用のみ)。
    // 対象選択を要し宣言時に対象未指定なら、resolveTargetCards の fallback 自動選択
    // (AI/テスト用、候補先頭を機械選択) に落とさず、pendingEffectTargetSelection を立てて
    // 対象選択 UI を経由させる (magic/triggered 等と同じ種別非依存延期に統一)。
    if (
      battleImmPrompt &&
      battleImmediateActiveStack &&
      battleImmediateChainId &&
      battleImmResolvedTargets.length === 0
    ) {
      const sel = getStackTargetSelection(
        stateAfterBattleImmUsageRecord,
        battleImmediateActiveStack,
        options
      );
      if (sel) {
        const stateAfterTargetPending: GameState = {
          ...stateAfterBattleImmUsageRecord,
          // 宣言段階: prompt を一時的に外す。deferred resolver が再 insert する。
          battleImmediateEffects:
            stateAfterBattleImmUsageRecord.battleImmediateEffects.filter(
              (p) => p.promptId !== battleImmPrompt.promptId
            ),
          pendingEffectTargetSelection: {
            pendingId: `effect-target:${battleImmediateChainId}`,
            actingPlayerId: battleImmediateActiveStack.actingPlayerId,
            sourceInstanceId: battleImmediateActiveStack.cardInstanceId,
            sourceDefinitionId: battleImmediateActiveStack.cardDefinitionId,
            ...(battleImmediateActiveStack.effectSourceInstanceId !== undefined
              ? {
                  effectSourceInstanceId:
                    battleImmediateActiveStack.effectSourceInstanceId,
                }
              : {}),
            ...(battleImmediateActiveStack.effectSourceDefinitionId !==
            undefined
              ? {
                  effectSourceDefinitionId:
                    battleImmediateActiveStack.effectSourceDefinitionId,
                }
              : {}),
            deferredStack: battleImmediateActiveStack,
            remainingStacks: [],
            requiredTargetCount: sel.requiredTargetCount,
            maxTargetCount: sel.maxTargetCount,
            ...(sel.allowDuplicateTargets === true
              ? { allowDuplicateTargets: true }
              : {}),
            ...((sel.targetStepId ??
              battleImmediateActiveStack.targetStepId) !== undefined
              ? {
                  targetStepId:
                    sel.targetStepId ?? battleImmediateActiveStack.targetStepId,
                }
              : {}),
            candidateInstanceIds: sel.candidateInstanceIds,
            ...(sel.targetGroups !== undefined
              ? { targetGroups: sel.targetGroups }
              : {}),
            targetEffectFilterTags: sel.targetEffectFilterTags,
          },
          log: [
            ...stateAfterBattleImmUsageRecord.log,
            `effect:target-selection:pending:${battleImmediateChainId}:${sel.candidateInstanceIds.length}candidates`,
          ],
        };
        return {
          state: stateAfterTargetPending,
          chainId: battleImmediateChainId,
          promptId: battleImmPrompt.promptId,
        };
      }
    }

    const result = useBattleImmediateEffectAsAction({
      state: stateAfterBattleImmUsageRecord,
      actingPlayerId: action.actingPlayerId,
      promptId: action.promptId,
      sourceInstanceId: action.sourceInstanceId,
      sourceKind: action.sourceKind,
      targetInstanceIds: battleImmResolvedTargets,
      ...(action.targetStepId !== undefined
        ? { targetStepId: action.targetStepId }
        : {}),
      ...(action.targetGroups !== undefined
        ? { targetGroups: action.targetGroups }
        : {}),
      targetEffectFilterTags: action.targetEffectFilterTags,
      ...(battleImmPreventionLevel !== undefined
        ? { sourcePreventionLevel: battleImmPreventionLevel }
        : {}),
      ...(battleImmPreventionBypass !== undefined
        ? { sourcePreventionBypass: battleImmPreventionBypass }
        : {}),
      ...(actionChoiceIndex !== undefined
        ? { choiceIndex: actionChoiceIndex }
        : {}),
      ...(options.payCostPaymentSources !== undefined
        ? { payCostPaymentSources: options.payCostPaymentSources }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(options.resolveFieldCardEffect
        ? {
            resolveEffect: options.resolveFieldCardEffect,
          }
        : battleImmComposedResolver
          ? {
              resolveEffect: battleImmComposedResolver,
            }
          : {}),
      ...(options.getHandWrittenEffectResolver
        ? {
            getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
          }
        : {}),
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      ...(battleImmRegistration?.reevaluationPoints?.length
        ? {
            reevaluation: buildReevaluationConfig(
              battleImmRegistration,
              action.sourceInstanceId,
              battleImmResolvedTargets
            )!,
          }
        : {}),
      // P3-62: 発揮不能時の usageLimit 払戻情報を伝搬 (同期解決経路、共有 + 変種別)。
      ...(battleImmRecordedUsage !== undefined
        ? { recordedUsage: battleImmRecordedUsage }
        : {}),
    });

    return {
      ...result,
      state: resumeStackCascadeIfReady(
        advanceAttackDeclarationStateIfReady(result.state, options),
        options
      ),
    };
  },
  use_magic: (options, action) => {
    const pending = options.state.pendingFieldMagicPreCostTrigger;
    const interruptedAction = pending?.interruptedMagicUse.action;
    if (
      pending?.triggered === true &&
      interruptedAction?.kind === "use_magic" &&
      interruptedAction.sourceInstanceId === action.sourceInstanceId &&
      interruptedAction.timing === action.timing &&
      interruptedAction.effectIndex === action.effectIndex
    ) {
      return applyUseMagicAction(
        {
          ...options,
          state: { ...options.state, pendingFieldMagicPreCostTrigger: null },
        },
        action
      );
    }
    // engine-magic-field-pre-cost-payment-trigger (BSAZ01-C12「戦力投入」): コスト支払い前に
    // 割り込む cross-card トリガーの対象なら、支払いを含む呼び出し全体を中断して pending を
    // 立てる。対象外 (通常経路) なら applyUseMagicAction をそのまま呼ぶ。
    const intercepted = tryInterceptFieldMagicPreCostTrigger(options, action);
    if (intercepted) return intercepted;
    return applyUseMagicAction(options, action);
  },
  resolve_field_magic_pre_cost_trigger: (options, action) =>
    applyResolveFieldMagicPreCostTriggerAction(options, action),
  use_accel: (options, action) => {
    const accelAction = action;
    const accelDef = options.getCardDefinitionById(
      accelAction.sourceDefinitionId
    );
    if (!accelDef?.accelData) {
      throw new Error(
        `Card does not have accelData: ${accelAction.sourceCardNo}`
      );
    }

    // 使用枠は継続付与の開始時だけ消費し、継続中の再使用では消費しない。
    const stateAfterAccelUsageRecord =
      accelAction.costMode === "free"
        ? startAccelCostOverride({
            state: options.state,
            actingPlayerId: accelAction.actingPlayerId,
            accelCard: getCardById(
              options.state,
              accelAction.sourceInstanceId
            )!,
            accelDefinition: accelDef,
            getCardDefinitionById: options.getCardDefinitionById,
            expectedSourceInstanceId: accelAction.costOverrideSourceInstanceId,
          })
        : options.state;

    // スタック窓を開くコンテキスト判定
    const shouldDeferAccel =
      (stateAfterAccelUsageRecord.step === "main" &&
        stateAfterAccelUsageRecord.activePlayerId ===
          accelAction.actingPlayerId) ||
      stateAfterAccelUsageRecord.stackWindow !== null ||
      stateAfterAccelUsageRecord.preDeclarationStackWindow !== null ||
      stateAfterAccelUsageRecord.activeAttack?.flashWindowState !== undefined;

    if (shouldDeferAccel) {
      const deferredResult = useAccelCardInFlashContextAsAction({
        state: stateAfterAccelUsageRecord,
        actingPlayerId: accelAction.actingPlayerId,
        cardInstanceId: accelAction.sourceInstanceId,
        accelData: accelDef.accelData,
        paymentSources: resolvePaymentSources(
          accelAction,
          options.paymentSources
        ),
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        targetInstanceIds: resolveLegalActionTargets(
          accelAction,
          options.targetInstanceIds
        ),
        targetEffectFilterTags: accelAction.targetEffectFilterTags,
        withoutCost: accelAction.costMode === "free",
      });

      return {
        state: openDeferredDeclarationStackWindow({
          baseState: stateAfterAccelUsageRecord,
          stateForWindow: deferredResult.state,
          activeStack: deferredResult.activeStack,
          actingPlayerId: accelAction.actingPlayerId,
        }),
        chainId: deferredResult.activeStack.chainId,
      };
    }

    // 非スタックコンテキスト: 即時解決
    return useAccelCardAsAction({
      state: stateAfterAccelUsageRecord,
      actingPlayerId: accelAction.actingPlayerId,
      cardInstanceId: accelAction.sourceInstanceId,
      accelData: accelDef.accelData,
      paymentSources: resolvePaymentSources(
        accelAction,
        options.paymentSources
      ),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      targetInstanceIds: resolveLegalActionTargets(
        accelAction,
        options.targetInstanceIds
      ),
      targetEffectFilterTags: accelAction.targetEffectFilterTags,
      withoutCost: accelAction.costMode === "free",
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      ...(options.getHandWrittenEffectResolver
        ? {
            getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
          }
        : {}),
    });
  },
  use_change: (options, action) => {
    const changeAction = action;
    const changeDef = options.getCardDefinitionById(
      changeAction.sourceDefinitionId
    );
    if (!changeDef?.changeData) {
      throw new Error(
        `Card does not have changeData: ${changeAction.sourceCardNo}`
      );
    }

    // チェンジはフラッシュタイミングのみ → 常にスタック窓を開く
    const deferredResult = useChangeCardInFlashContextAsAction({
      state: options.state,
      actingPlayerId: changeAction.actingPlayerId,
      cardInstanceId: changeAction.sourceInstanceId,
      changeData: changeDef.changeData,
      paymentSources: resolvePaymentSources(
        changeAction,
        options.paymentSources
      ),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      targetInstanceIds: resolveLegalActionTargets(
        changeAction,
        options.targetInstanceIds
      ),
      targetEffectFilterTags: changeAction.targetEffectFilterTags,
    });

    return {
      state: openDeferredDeclarationStackWindow({
        baseState: options.state,
        stateForWindow: deferredResult.state,
        activeStack: deferredResult.activeStack,
        actingPlayerId: changeAction.actingPlayerId,
      }),
      chainId: deferredResult.activeStack.chainId,
    };
  },
  declare_advent: (options, action) => {
    // P3-112: 煌臨は「常時以外の効果発揮」(02:190、03c:44 でフラッシュ効果の実例と明記) に
    // つき発揮宣言でスタック窓を開く。ソウルコア消費・重ねはいずれも効果文内につき
    // 窓クローズ後の deferred 解決 (resolveDeferredAdventStack) で行う
    // (divine_skill と同型)。adventMode 等はカードの adventData から窓後に再導出する
    // (adventData.adventVariant 由来、legal-actions-availability.ts 参照) ため
    // ActiveStack へ追加のミラーフィールドは持たない。代替コスト経路
    // (「ソウルコアを置いたものとして」) は窓後・対象選択前の pending で選ぶ。
    const adventAction = action;
    const adventDef = options.getCardDefinitionById(
      adventAction.sourceDefinitionId
    );
    if (!adventDef) {
      throw new Error(
        `Card does not have adventData: ${adventAction.sourceCardNo}`
      );
    }

    const chainId = `advent:${adventAction.sourceInstanceId}:${adventStackSequence++}`;
    const adventActiveStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "declare_advent",
      chainId,
      actingPlayerId: adventAction.actingPlayerId,
      cardInstanceId: adventAction.sourceInstanceId,
      cardDefinitionId: adventAction.sourceDefinitionId,
      activationLabel: "flash",
      sourceActivationZone: adventAction.adventSourceZone,
      ...(getCardById(options.state, adventAction.sourceInstanceId)?.zone ===
      "deck"
        ? { sourcePhysicalZone: "deck" as const }
        : {}),
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `[Advent] ${adventAction.actingPlayerId} が煌臨を発揮宣言（${adventAction.sourceDefinitionId}）`,
      ],
    };

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack: adventActiveStack,
        actingPlayerId: adventAction.actingPlayerId,
      }),
    };
  },
  declare_host_dual_advent: (options, action) => {
    // BSDB01-CX01【真バディ】: host 側 (被煌臨側) が手札カード1枚を自身へ重ねる
    // (1宣言=1体、裁定確定 2026-07-13、issues/P3-117)。declare_advent と同型の
    // スタック窓化 (P3-112) を使う。resolveDeferredHostDualAdventStack
    // (mechanics/host-dual-advent.ts) は stack.cardInstanceId = host、
    // targetInstanceIds = [選ばれた手札カード] (単一) を読む。
    const dualAction = action;
    const hostDef = options.getCardDefinitionById(
      dualAction.sourceDefinitionId
    );
    if (!hostDef?.hostDualAdventGrant) {
      throw new Error(
        `Card does not have hostDualAdventGrant: ${dualAction.sourceCardNo}`
      );
    }

    const chainId = `host_dual_advent:${dualAction.sourceInstanceId}:${adventStackSequence++}`;
    const dualAdventActiveStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "declare_host_dual_advent",
      chainId,
      actingPlayerId: dualAction.actingPlayerId,
      cardInstanceId: dualAction.sourceInstanceId,
      cardDefinitionId: dualAction.sourceDefinitionId,
      targetInstanceIds: [],
      activationLabel: "flash",
      sourceActivationZone: "field",
      targetEffectFilterTags: ["general"],
      candidateTargetZones: ["hand"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `[HostDualAdvent] ${dualAction.actingPlayerId} が同時2体煌臨(片側)を発揮宣言（${dualAction.sourceDefinitionId}）`,
      ],
    };

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack: dualAdventActiveStack,
        actingPlayerId: dualAction.actingPlayerId,
      }),
    };
  },
  declare_dual_host_advent: (options, action) => {
    // BSSG01-X03 多重煌臨 (裁定確定 2026-08-01): 対象2体を選び、選択順序で
    // [0]=上(状態引き継ぎ側)/[1]=下(コアのみ統合先へ合算) を表す。declare_advent と
    // 同型のスタック窓化 (P3-112) を使う。組み合わせの妥当性 (各スロット条件を
    // 1体ずつ満たすか) は窓クローズ後の deferred 解決 (resolveDeferredDualHostAdventStack、
    // mechanics/multi-host-advent.ts) で再判定する (宣言時点では固定しない)。
    const dualHostAction = action;
    const dualHostDef = options.getCardDefinitionById(
      dualHostAction.sourceDefinitionId
    );
    if (!dualHostDef?.dualHostAdventData) {
      throw new Error(
        `Card does not have dualHostAdventData: ${dualHostAction.sourceCardNo}`
      );
    }

    const chainId = `dual_host_advent:${dualHostAction.sourceInstanceId}:${adventStackSequence++}`;
    const dualHostAdventActiveStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "declare_dual_host_advent",
      chainId,
      actingPlayerId: dualHostAction.actingPlayerId,
      cardInstanceId: dualHostAction.sourceInstanceId,
      cardDefinitionId: dualHostAction.sourceDefinitionId,
      activationLabel: "flash",
      sourceActivationZone: "hand",
      ...(getCardById(options.state, dualHostAction.sourceInstanceId)?.zone ===
      "deck"
        ? { sourcePhysicalZone: "deck" as const }
        : {}),
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `[DualHostAdvent] ${dualHostAction.actingPlayerId} が多重煌臨を発揮宣言（${dualHostAction.sourceDefinitionId}）`,
      ],
    };

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack: dualHostAdventActiveStack,
        actingPlayerId: dualHostAction.actingPlayerId,
      }),
    };
  },
  declare_manifest: (options, action) => {
    // declare_advent と同型のスタック窓化 (P3-112)。ソウルコア消費・対象ネクサスからの
    // 1コスト支払い・場入りはいずれも効果文内につき窓クローズ後の deferred 解決
    // (resolveDeferredManifestStack) で行う。
    const manifestAction = action;
    const manifestDef = options.getCardDefinitionById(
      manifestAction.sourceDefinitionId
    );
    if (!manifestDef?.manifestData) {
      throw new Error(
        `Card does not have manifestData: ${manifestAction.sourceCardNo}`
      );
    }

    const [targetInstanceId] = resolveLegalActionTargets(
      manifestAction,
      options.targetInstanceIds
    );
    if (targetInstanceId === undefined) {
      throw new Error(
        `declare_manifest requires a target: ${manifestAction.actionId}`
      );
    }

    const chainId = `manifest:${manifestAction.sourceInstanceId}:${manifestStackSequence++}`;
    const manifestActiveStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "declare_manifest",
      chainId,
      actingPlayerId: manifestAction.actingPlayerId,
      cardInstanceId: manifestAction.sourceInstanceId,
      cardDefinitionId: manifestAction.sourceDefinitionId,
      activationLabel: "flash",
      sourceActivationZone: "hand",
      ...(getCardById(options.state, manifestAction.sourceInstanceId)?.zone ===
      "deck"
        ? { sourcePhysicalZone: "deck" as const }
        : {}),
      targetInstanceIds: [targetInstanceId],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `[Manifest] ${manifestAction.actingPlayerId} が顕現を発揮宣言（${manifestAction.sourceDefinitionId} → ${targetInstanceId}）`,
      ],
    };

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack: manifestActiveStack,
        actingPlayerId: manifestAction.actingPlayerId,
      }),
    };
  },
  summon: (rawOptions, action) => {
    // BSAZ02-C08【月面基地】: declaredSummonAltCostGrantSourceInstanceId が設定されて
    // いれば、この summon action を選んだ時点で発揮元(ネクサス)を疲労させる
    // (代替コストの支払い。baseCostOverride は legal action 生成側で既に全軽減済みの
    // コストとして計算済みのため、ここでは疲労のみ行う)。
    const optionsAfterAltCostGrant =
      action.declaredSummonAltCostGrantSourceInstanceId
        ? {
            ...rawOptions,
            state: replaceCardInstances(
              {
                ...rawOptions.state,
              },
              rawOptions.state.cardInstances.map((c) =>
                c.instanceId ===
                action.declaredSummonAltCostGrantSourceInstanceId
                  ? { ...c, exhaustState: "exhausted" as const }
                  : c
              )
            ),
          }
        : rawOptions;
    // 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』(BSTH02.7-M01 effects[0] 等)。
    // 即座には召喚せず pendingSummonCostExcludeChoice を開き、除外枚数確定後に
    // additionalCostModifiers 付きで summon を実行する (resolve_pending_summon_cost_exclude_choice)。
    // P3-138 token-pool-pre-cost-forced-combine はこのコスト選択 pending の先には未配線
    // (pendingSummonCostExcludeChoice / applyPendingSummonCostExcludeChoiceAction が
    // combineHostInstanceId を運ばない) ため、下の intercept 呼び出しより前でここに
    // early return する経路には意図的に到達させない (現行 BSES01 の系統「８６」ブレイヴは
    // opensCostExcludeChoice を持たないため未発火。両機構を併せ持つカードが将来追加された
    // 場合は combineHostInstanceId の pending 経由伝播を別途実装する必要がある)。
    if (action.opensCostExcludeChoice) {
      const summonAction = action;
      if (
        summonAction.costExcludeEffectIndex === undefined ||
        summonAction.costExcludeMaxCount === undefined ||
        summonAction.costExcludeDiscountPerCard === undefined ||
        summonAction.costExcludeCandidateInstanceIds === undefined
      ) {
        throw new Error(
          "opensCostExcludeChoice summon action missing costExclude metadata"
        );
      }
      return {
        state: {
          ...optionsAfterAltCostGrant.state,
          pendingSummonCostExcludeChoice: {
            pendingId: `scec-${optionsAfterAltCostGrant.state.turnNumber}-${summonAction.actingPlayerId}-${summonAction.sourceInstanceId}`,
            actingPlayerId: summonAction.actingPlayerId,
            sourceInstanceId: summonAction.sourceInstanceId,
            sourceDefinitionId: summonAction.sourceDefinitionId,
            effectIndex: summonAction.costExcludeEffectIndex,
            candidateCardInstanceIds:
              summonAction.costExcludeCandidateInstanceIds,
            maxCount: summonAction.costExcludeMaxCount,
            discountPerCard: summonAction.costExcludeDiscountPerCard,
            ...(summonAction.costExcludeFullCostPaid
              ? { fullCostPaid: true }
              : {}),
            ...(summonAction.costExcludeSourceZone !== undefined
              ? { sourceZone: summonAction.costExcludeSourceZone }
              : {}),
            ...(summonAction.costExcludeMinCount !== undefined
              ? { minCount: summonAction.costExcludeMinCount }
              : {}),
            ...(summonAction.summonPermissionEffectIndex !== undefined
              ? {
                  summonPermissionEffectIndex:
                    summonAction.summonPermissionEffectIndex,
                  ...(summonAction.summonPermissionUsageLimit !== undefined
                    ? {
                        summonPermissionUsageLimit:
                          summonAction.summonPermissionUsageLimit,
                      }
                    : {}),
                  ...(summonAction.summonPermissionLimitGroupId !== undefined
                    ? {
                        summonPermissionLimitGroupId:
                          summonAction.summonPermissionLimitGroupId,
                      }
                    : {}),
                }
              : {}),
            ...(summonAction.onBoardCoreSourceFilter !== undefined
              ? {
                  onBoardCoreSourceFilter: summonAction.onBoardCoreSourceFilter,
                }
              : {}),
            ...(summonAction.costExcludeFullReduction
              ? { fullReduction: true }
              : {}),
          },
        },
      };
    }

    // 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを
    // 支払わずに召喚する』(BSSL01-M02 effects[0,1])。即座には召喚せず
    // pendingSummonCostCoreMoveChoice を開き、移動枚数+移動先確定後に additionalCostModifiers
    // 付きで summon を実行する (resolve_pending_summon_cost_core_move_choice)。
    if (action.opensCostCoreMoveChoice) {
      const summonAction = action;
      if (
        summonAction.costCoreMoveEffectIndex === undefined ||
        summonAction.costCoreMoveMinCount === undefined ||
        summonAction.costCoreMoveAvailableCoreCount === undefined ||
        summonAction.costCoreMoveOffset === undefined ||
        summonAction.costCoreMoveFieldDestinationCandidateInstanceIds ===
          undefined
      ) {
        throw new Error(
          "opensCostCoreMoveChoice summon action missing costCoreMove metadata"
        );
      }
      return {
        state: {
          ...optionsAfterAltCostGrant.state,
          pendingSummonCostCoreMoveChoice: {
            pendingId: `sccmc-${optionsAfterAltCostGrant.state.turnNumber}-${summonAction.actingPlayerId}-${summonAction.sourceInstanceId}`,
            actingPlayerId: summonAction.actingPlayerId,
            sourceInstanceId: summonAction.sourceInstanceId,
            sourceDefinitionId: summonAction.sourceDefinitionId,
            effectIndex: summonAction.costCoreMoveEffectIndex,
            availableCoreCount: summonAction.costCoreMoveAvailableCoreCount,
            minCount: summonAction.costCoreMoveMinCount,
            costOffset: summonAction.costCoreMoveOffset,
            ...(summonAction.costCoreMoveGrantsFreeSummon
              ? { grantsFreeSummon: true }
              : {}),
            fieldDestinationCandidateInstanceIds:
              summonAction.costCoreMoveFieldDestinationCandidateInstanceIds,
            ...(summonAction.summonPermissionEffectIndex !== undefined
              ? {
                  summonPermissionEffectIndex:
                    summonAction.summonPermissionEffectIndex,
                  ...(summonAction.summonPermissionUsageLimit !== undefined
                    ? {
                        summonPermissionUsageLimit:
                          summonAction.summonPermissionUsageLimit,
                      }
                    : {}),
                  ...(summonAction.summonPermissionLimitGroupId !== undefined
                    ? {
                        summonPermissionLimitGroupId:
                          summonAction.summonPermissionLimitGroupId,
                      }
                    : {}),
                }
              : {}),
            ...(summonAction.onBoardCoreSourceFilter !== undefined
              ? {
                  onBoardCoreSourceFilter: summonAction.onBoardCoreSourceFilter,
                }
              : {}),
          },
        },
      };
    }

    // P3-138 token-pool-pre-cost-forced-combine (BSES01-T01「M1A4 ジャガーノート」型):
    // 印字「召喚コスト支払い前に出し、対象はこのスピリットに直接合体しなければならない」を
    // 満たすため、コスト計算より前にここでトークンをフィールドへ配置する。対象外なら null
    // (通常の召喚宣言をそのまま続行)。上の opensCostExcludeChoice/opensCostCoreMoveChoice
    // early return より後に置く (それらの pending 経路は combineHostInstanceId を運ばないため、
    // 先にトークンだけ配置すると孤立する)。
    // Q54 型の通常行動許可に付随する宣言時 step は、通常召喚コストと同じく
    // stack window より前に確定する。即時効果の executeEffect 直叩きではなく、
    // summon legal action の宣言経路内で明示 permission の step だけを実行する。
    const resolvedTargetInstanceIds = resolveLegalActionTargets(
      action,
      optionsAfterAltCostGrant.targetInstanceIds
    );
    let stateAfterPermissionDeclaration = optionsAfterAltCostGrant.state;
    let permissionDeclarationConsumesTargets = false;
    if (action.summonPermissionEffectIndex !== undefined) {
      const sourceDefinition = optionsAfterAltCostGrant.getCardDefinitionById(
        action.sourceDefinitionId
      );
      const permissionEffect =
        sourceDefinition?.effects?.[action.summonPermissionEffectIndex];
      const permissionSpec = permissionEffect
        ? getHandSummonPermissionSpec(permissionEffect)
        : undefined;
      if (
        permissionEffect !== undefined &&
        permissionSpec?.declarationSteps !== undefined &&
        permissionSpec.declarationSteps.length > 0
      ) {
        permissionDeclarationConsumesTargets = true;
        stateAfterPermissionDeclaration = executeEffect({
          state: stateAfterPermissionDeclaration,
          effect: {
            ...permissionEffect,
            steps: [...permissionSpec.declarationSteps],
          },
          effectIndex: action.summonPermissionEffectIndex,
          chainId: `normal-action-declaration:${action.sourceInstanceId}`,
          sourceInstanceId: action.sourceInstanceId,
          actingPlayerId: action.actingPlayerId,
          targetInstanceIds: resolvedTargetInstanceIds,
          targetSelectionResolved: true,
          getCardDefinitionById: optionsAfterAltCostGrant.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            optionsAfterAltCostGrant.getRegisteredTriggeredEffectActions,
          ...(optionsAfterAltCostGrant.getRegisteredBurstActions !== undefined
            ? {
                getRegisteredBurstActions:
                  optionsAfterAltCostGrant.getRegisteredBurstActions,
              }
            : {}),
        });
      }
    }

    stateAfterPermissionDeclaration = collectAndQueueTriggerReactions({
      beforeState: optionsAfterAltCostGrant.state,
      afterState: stateAfterPermissionDeclaration,
      source: "action_resolution",
      chainId: `normal-action-declaration:${action.sourceInstanceId}`,
      causedByPlayerId: action.actingPlayerId,
      causedBySourceInstanceId: action.sourceInstanceId,
      getCardDefinitionById: optionsAfterAltCostGrant.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        optionsAfterAltCostGrant.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions:
        optionsAfterAltCostGrant.getRegisteredBurstActions,
    });

    const tokenPoolPreCostForcedCombine =
      applyTokenPoolPreCostForcedCombineDeclarationSideEffect(
        stateAfterPermissionDeclaration,
        action.actingPlayerId,
        action.sourceInstanceId,
        optionsAfterAltCostGrant.getCardDefinitionById,
        optionsAfterAltCostGrant
      );
    // P3-EDH: pre-cost token placement is a field-entry path outside the
    // normal play-card resolution. Synchronize its continuous effects before
    // exposing the payment / stack-input state to callers.
    const stateAfterTokenPoolPreCostForcedCombine =
      tokenPoolPreCostForcedCombine === null
        ? stateAfterPermissionDeclaration
        : recomputeAndRebuildContinuousEffects(
            tokenPoolPreCostForcedCombine.state,
            optionsAfterAltCostGrant.getCardDefinitionById
          );
    const options = tokenPoolPreCostForcedCombine
      ? {
          ...optionsAfterAltCostGrant,
          state: stateAfterTokenPoolPreCostForcedCombine,
        }
      : {
          ...optionsAfterAltCostGrant,
          state: stateAfterTokenPoolPreCostForcedCombine,
        };
    if (options.state.pendingMultiPlacement && tokenPoolPreCostForcedCombine) {
      return {
        state: {
          ...options.state,
          pendingMultiPlacement: {
            ...options.state.pendingMultiPlacement,
            summonDeclaration: {
              action,
              combineHostInstanceId:
                tokenPoolPreCostForcedCombine.combineHostInstanceId,
              targetInstanceIds: resolvedTargetInstanceIds,
              permissionDeclarationConsumesTargets,
              originalState: rawOptions.state,
              inputs: {
                ...(rawOptions.paymentSources !== undefined
                  ? { paymentSources: rawOptions.paymentSources }
                  : {}),
                ...(rawOptions.enterFieldCorePlacements !== undefined
                  ? {
                      enterFieldCorePlacements:
                        rawOptions.enterFieldCorePlacements,
                    }
                  : {}),
                ...(rawOptions.chosenLifeCoreKind !== undefined
                  ? { chosenLifeCoreKind: rawOptions.chosenLifeCoreKind }
                  : {}),
              },
            },
          },
        },
        chainId: `summon-placement:${action.sourceInstanceId}`,
      };
    }
    return completeSummonDeclaration(
      rawOptions,
      options,
      action,
      resolvedTargetInstanceIds,
      permissionDeclarationConsumesTargets,
      tokenPoolPreCostForcedCombine
    );
  },
  place_nexus: (options, action) => {
    // クロージャ内では action の絞り込みが失われるため、ローカル const に退避する。
    const placeAction = action;
    const resolvedTargetInstanceIds = resolveLegalActionTargets(
      placeAction,
      options.targetInstanceIds
    );
    const resolvedChosenLifeCoreKind = resolveChosenLifeCoreKind(
      placeAction,
      options.chosenLifeCoreKind
    );
    let stateAfterPermissionDeclaration = options.state;
    let permissionDeclarationConsumesTargets = false;
    if (placeAction.placePermissionEffectIndex !== undefined) {
      const sourceDefinition = options.getCardDefinitionById(
        placeAction.sourceDefinitionId
      );
      const permissionEffect =
        sourceDefinition?.effects?.[placeAction.placePermissionEffectIndex];
      const permissionSpec = permissionEffect
        ? getHandSummonPermissionSpec(permissionEffect)
        : undefined;
      if (
        permissionEffect !== undefined &&
        permissionSpec?.declarationSteps !== undefined &&
        permissionSpec.declarationSteps.length > 0
      ) {
        permissionDeclarationConsumesTargets = true;
        stateAfterPermissionDeclaration = executeEffect({
          state: stateAfterPermissionDeclaration,
          effect: {
            ...permissionEffect,
            steps: [...permissionSpec.declarationSteps],
          },
          effectIndex: placeAction.placePermissionEffectIndex,
          chainId: `normal-action-declaration:${placeAction.sourceInstanceId}`,
          sourceInstanceId: placeAction.sourceInstanceId,
          actingPlayerId: placeAction.actingPlayerId,
          targetInstanceIds: resolvedTargetInstanceIds,
          targetSelectionResolved: true,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          ...(options.getRegisteredBurstActions !== undefined
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
        });
      }
    }
    const cardPlayTargetInstanceIds = permissionDeclarationConsumesTargets
      ? []
      : resolvedTargetInstanceIds;

    stateAfterPermissionDeclaration = collectAndQueueTriggerReactions({
      beforeState: options.state,
      afterState: stateAfterPermissionDeclaration,
      source: "action_resolution",
      chainId: `normal-action-declaration:${placeAction.sourceInstanceId}`,
      causedByPlayerId: placeAction.actingPlayerId,
      causedBySourceInstanceId: placeAction.sourceInstanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    // ネクサス自己配置許可の usageLimit 記録。summon 許可のネクサス版。
    const recordPlacePermissionUsage = (s: GameState): GameState =>
      placeAction.placePermissionEffectIndex !== undefined
        ? recordEffectUsageIfLimited({
            state: s,
            sourceInstanceId: placeAction.sourceInstanceId,
            sourceDefinitionId: placeAction.sourceDefinitionId,
            effectLabel: getStableEffectLabel(
              "summon_permission",
              placeAction.placePermissionEffectIndex,
              { effectIndex: placeAction.placePermissionEffectIndex }
            ),
            usageLimit: placeAction.placePermissionUsageLimit,
            ...(placeAction.placePermissionLimitGroupId
              ? { groupId: placeAction.placePermissionLimitGroupId }
              : {}),
          })
        : s;

    // 自己配置許可（placePermissionEffectIndex）由来の場合は、availability 側で
    // effect.timing / timingScope を gate 済みのため、ここでは play-card スタック窓を開く。
    const opensPlaceNexusStack =
      (options.state.step === "main" &&
        options.state.activePlayerId === action.actingPlayerId) ||
      action.placePermissionEffectIndex !== undefined;

    if (opensPlaceNexusStack) {
      const deferredResult = usePlaceNexusInStackContextAsAction({
        state: stateAfterPermissionDeclaration,
        actingPlayerId: action.actingPlayerId,
        cardInstanceId: action.sourceInstanceId,
        targetInstanceIds: cardPlayTargetInstanceIds,
        targetEffectFilterTags: permissionDeclarationConsumesTargets
          ? ["general"]
          : action.targetEffectFilterTags,
        paymentSources: resolvePaymentSources(action, options.paymentSources),
        ...(action.fixedPaymentCost !== undefined
          ? { fixedPaymentCost: action.fixedPaymentCost }
          : {}),
        ...(action.baseCostOverride !== undefined
          ? { baseCostOverride: action.baseCostOverride }
          : {}),
        ...(action.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
          : {}),
        // 自己配置許可は availability 側の時系 gate を通過済みのため許可。
        ...(action.placePermissionEffectIndex !== undefined
          ? { allowNonMainStep: true }
          : {}),
        ...(action.placePermissionEffectIndex !== undefined
          ? { sourceEffectIndex: action.placePermissionEffectIndex }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        ...(resolvedChosenLifeCoreKind !== undefined
          ? {
              chosenLifeCoreKind: resolvedChosenLifeCoreKind,
            }
          : {}),
        ...(options.enterFieldCorePlacements
          ? {
              enterFieldCorePlacements: options.enterFieldCorePlacements,
            }
          : {}),
      });

      return {
        state: openEffectDeclarationStackWindow({
          baseState: options.state,
          stateAfterDeclaration: recordPlacePermissionUsage(
            deferredResult.state
          ),
          activeStack: deferredResult.activeStack,
          actingPlayerId: action.actingPlayerId,
        }),
        chainId: deferredResult.activeStack.chainId,
      };
    }

    // フォールバック（非スタック）経路は許可由来でないネクサス配置のみ到達する
    // （placePermissionEffectIndex 由来は常に opensPlaceNexusStack=true でスタックを開く）。
    // よって usageLimit 記録は不要。
    return placeNexusAsAction({
      state: stateAfterPermissionDeclaration,
      actingPlayerId: action.actingPlayerId,
      cardInstanceId: action.sourceInstanceId,
      targetInstanceIds: cardPlayTargetInstanceIds,
      targetEffectFilterTags: permissionDeclarationConsumesTargets
        ? ["general"]
        : action.targetEffectFilterTags,
      paymentSources: resolvePaymentSources(action, options.paymentSources),
      ...(action.fixedPaymentCost !== undefined
        ? { fixedPaymentCost: action.fixedPaymentCost }
        : {}),
      ...(action.baseCostOverride !== undefined
        ? { baseCostOverride: action.baseCostOverride }
        : {}),
      ...(action.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(resolvedChosenLifeCoreKind !== undefined
        ? {
            chosenLifeCoreKind: resolvedChosenLifeCoreKind,
          }
        : {}),
      ...(options.getHandWrittenEffectResolver
        ? {
            getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
          }
        : {}),
      ...(options.enterFieldCorePlacements
        ? {
            enterFieldCorePlacements: options.enterFieldCorePlacements,
          }
        : {}),
    });
  },
  attack: (options, action) => {
    const tentativeState = useAttackAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
      sourceInstanceId: action.sourceInstanceId,
      ...(action.targetInstanceId !== undefined
        ? { targetInstanceId: action.targetInstanceId }
        : {}),
      ...(action.attackExhaustCostSourceInstanceId !== undefined
        ? {
            attackExhaustCostSourceInstanceId:
              action.attackExhaustCostSourceInstanceId,
          }
        : {}),
      ...(action.attackExhaustCostSourceInstanceIds !== undefined
        ? {
            attackExhaustCostSourceInstanceIds:
              action.attackExhaustCostSourceInstanceIds,
          }
        : {}),
      ...(action.battleDestroyCostSourceInstanceId !== undefined
        ? {
            battleDestroyCostSourceInstanceId:
              action.battleDestroyCostSourceInstanceId,
          }
        : {}),
      ...(action.battleDestroyCostSourceInstanceIds !== undefined
        ? {
            battleDestroyCostSourceInstanceIds:
              action.battleDestroyCostSourceInstanceIds,
          }
        : {}),
      // 同時アタック宣言 (P2-05): クライアント入力の追加参加カード。
      // options-level (REST passthrough) を優先し、action 埋め込みに fallback。
      ...(() => {
        const additionalIds =
          options.additionalSourceInstanceIds ??
          action.additionalSourceInstanceIds;
        return additionalIds !== undefined && additionalIds.length > 0
          ? { additionalSourceInstanceIds: additionalIds }
          : {};
      })(),
      ...(() => {
        const selections =
          options.additionalAttackExhaustCostSourceInstanceIds ??
          action.additionalAttackExhaustCostSourceInstanceIds;
        return selections !== undefined
          ? { additionalAttackExhaustCostSourceInstanceIds: selections }
          : {};
      })(),
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    return {
      state: tentativeState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  flip_instead_of_attack: (options, action) => {
    // アタック宣言の代替宣言 (declare_manifest と同型のスタック窓化。02:190 の
    // 「アタック/ブロック宣言」カテゴリ = opens_own_window、
    // legal-action-window-classification.ts 参照)。実際の面反転・カウント増加は
    // 窓クローズ後の deferred 解決 (resolveDeferredFlipInsteadOfAttackStack,
    // structured-card-replacement.ts) で行う。裁定確定(2026-08-01): 疲労しない・
    // バトルも発生しない（単なる「裏返せる」任意効果、アタック宣言そのものではない）。
    const flipAction = action;
    const def = options.getCardDefinitionById(flipAction.sourceDefinitionId);
    if (!def?.attackAlternativeFlip) {
      throw new Error(
        `Card does not have attackAlternativeFlip: ${flipAction.sourceCardNo}`
      );
    }

    const chainId = `flip_instead_of_attack:${flipAction.sourceInstanceId}:${flipInsteadOfAttackStackSequence++}`;
    const flipActiveStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "flip_instead_of_attack",
      chainId,
      actingPlayerId: flipAction.actingPlayerId,
      cardInstanceId: flipAction.sourceInstanceId,
      cardDefinitionId: flipAction.sourceDefinitionId,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `[FlipInsteadOfAttack] ${flipAction.actingPlayerId} がアタック宣言の代わりに裏返す宣言（${flipAction.sourceInstanceId}）`,
      ],
    };

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack: flipActiveStack,
        actingPlayerId: flipAction.actingPlayerId,
      }),
    };
  },
  decline_immediate_attack_join: (options, action) => {
    const decisions = getImmediateAttackJoinDecisions({
      ...options,
      actingPlayerId: action.actingPlayerId,
      getRegisteredFieldCardEffectActions:
        options.getRegisteredFieldCardEffectActions ?? (() => []),
    });
    if (
      !decisions.some(
        (candidate) =>
          candidate.actionId === action.actionId &&
          candidate.actingPlayerId === action.actingPlayerId
      )
    ) {
      throw new Error("Immediate attack join decision is no longer available");
    }
    return {
      state: consumeImmediateAttackJoin(options.state, action.sourceInstanceId),
    };
  },
  join_active_attack: (options, action) => {
    const decisions = getImmediateAttackJoinDecisions({
      ...options,
      actingPlayerId: action.actingPlayerId,
      getRegisteredFieldCardEffectActions:
        options.getRegisteredFieldCardEffectActions ?? (() => []),
    });
    if (
      !decisions.some(
        (candidate) =>
          candidate.actionId === action.actionId &&
          candidate.actingPlayerId === action.actingPlayerId
      )
    ) {
      throw new Error("Immediate attack join decision is no longer available");
    }
    options = {
      ...options,
      state: consumeImmediateAttackJoin(options.state, action.sourceInstanceId),
    };

    // P3-115: 途中合流アタックも「アタック宣言」の一種として自分の preDeclarationStackWindow
    // を開く (02:190)。実際の合流処理は窓クローズ後の pass_pre_declaration_stack で
    // confirmJoinActiveAttackDeclarationAsAction へ委譲する。
    const tentativeState = useJoinActiveAttackAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
      sourceInstanceId: action.sourceInstanceId,
      ...(action.attackExhaustCostSourceInstanceId !== undefined
        ? {
            attackExhaustCostSourceInstanceId:
              action.attackExhaustCostSourceInstanceId,
          }
        : {}),
      ...(action.attackExhaustCostSourceInstanceIds !== undefined
        ? {
            attackExhaustCostSourceInstanceIds:
              action.attackExhaustCostSourceInstanceIds,
          }
        : {}),
      ...(action.battleDestroyCostSourceInstanceId !== undefined
        ? {
            battleDestroyCostSourceInstanceId:
              action.battleDestroyCostSourceInstanceId,
          }
        : {}),
      ...(action.battleDestroyCostSourceInstanceIds !== undefined
        ? {
            battleDestroyCostSourceInstanceIds:
              action.battleDestroyCostSourceInstanceIds,
          }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    return {
      state: tentativeState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  block: (options, action) => {
    const tentativeState = useBlockAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
      sourceInstanceId: action.sourceInstanceId,
      participantEntityId: action.participantEntityId,
      ...(action.battleDestroyCostSourceInstanceId !== undefined
        ? {
            battleDestroyCostSourceInstanceId:
              action.battleDestroyCostSourceInstanceId,
          }
        : {}),
      ...(action.battleDestroyCostSourceInstanceIds !== undefined
        ? {
            battleDestroyCostSourceInstanceIds:
              action.battleDestroyCostSourceInstanceIds,
          }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    return {
      state: tentativeState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  open_battle_flash: (options, action) => {
    return useOpenBattleFlashAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
      flashKind: action.flashKind,
    });
  },
  pass_battle_flash: (options, action) => {
    const passResult = usePassBattleFlashAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
    });

    if (
      passResult.outcome === "stack_closed_needs_resolution" &&
      passResult.resolvedStacks.length > 0
    ) {
      // 1-pass cascade: LIFO 順で全 pending スタックを解決 (対象選択待ちで中断・resume 可)
      const cascadedState = resolveStackCascade(
        passResult.state,
        passResult.resolvedStacks,
        options
      );
      return {
        ...passResult,
        state: resumeStackCascadeIfReady(cascadedState, options),
      };
    }

    // アタック後フラッシュは攻撃参加体が消えても通常通り開く。
    // その後、未ブロックの攻撃参加体がフィールドに残っていなければ、防御側の
    // 「ブロックしない」確認を挟まず battle_end 共通テールへ進める。
    if (
      passResult.outcome === "flash_window_closed" &&
      passResult.flashKind === "before_block" &&
      !hasUnblockedAttackParticipantStillOnField(passResult.state)
    ) {
      const resolutionResult = executeBattleResolution({
        state: passResult.state,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      });
      return {
        ...passResult,
        state: resolutionResult.state,
      };
    }

    // P3-55 Phase B: after_block flash が閉じた瞬間にバトル解決まで自動連鎖する。
    // ブロック宣言済の状態で after_block flash close 後は機械的に BP 比較に進むため、
    // 旧 `start_battle_resolution` (アクティブ側 trigger) を経由せず inline 化する。
    if (
      passResult.outcome === "flash_window_closed" &&
      passResult.flashKind === "after_block"
    ) {
      const resolutionResult = executeBattleResolution({
        state: passResult.state,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      });
      return {
        ...passResult,
        state: resolutionResult.state,
      };
    }

    return passResult;
  },
  pass_stack: (options, action) => {
    const win = options.state.stackWindow;

    if (
      !win ||
      options.state.window !== "stack" ||
      win.priorityPlayerId !== action.actingPlayerId
    ) {
      throw new Error(
        `Pass stack is not legal: actingPlayer=${action.actingPlayerId} reason=not_in_stack_window`
      );
    }

    // 1-pass close + LIFO cascade (2026-03-31 user-confirmed rule):
    // 片方がパスした時点でスタック窓は即閉じる。保留スタックは LIFO で全て解決する。
    // 宣言者に優先権を戻すことはしない。
    const resolvedStacks: ActiveStack[] = [];
    let workingWindow = win;
    // BSAZ01-C12 の支払い前使用は、元マジックを支払い前で中断したまま C12 だけを
    // 先に解決する。既存の通常スタックへの応答中なら、C12 の pass で親まで cascade
    // すると、元マジックを親の上へ戻す前に親を解決してしまう。C12 を peel した直後で
    // 止め、復元した親 stackWindow を core_distribute 完了まで保持する（03a の順序）。
    const preCostTriggerStackSourceInstanceId =
      options.state.pendingFieldMagicPreCostTrigger?.triggered === true
        ? options.state.pendingFieldMagicPreCostTrigger.triggerSourceInstanceId
        : null;
    let preservedParentStackForPreCostTrigger = false;
    while (workingWindow.pendingStackAction !== null) {
      const {
        resolvedStack: peeledStack,
        restoredPendingStackAction,
        restoredResponseSourcePlayerId,
        restoredPriorityPlayerId,
      } = peelResolvedStack({ windowState: workingWindow });
      resolvedStacks.push(peeledStack);
      const logKind =
        resolvedStacks.length === 1 ? "stack:closed" : "stack:sub:closed";
      options.state.log.push(
        `${logKind}:${peeledStack.stackId}:${action.actingPlayerId}`
      );
      workingWindow = {
        ...workingWindow,
        pendingStackAction: restoredPendingStackAction,
        stackResponseSourcePlayerId: restoredResponseSourcePlayerId,
        priorityPlayerId: restoredPriorityPlayerId,
        consecutivePassCount: 0,
      };
      if (peeledStack.cardInstanceId === preCostTriggerStackSourceInstanceId) {
        preservedParentStackForPreCostTrigger =
          workingWindow.pendingStackAction !== null;
        break;
      }
    }

    // バースト発動宣言窓がサブスタック未使用でパスクローズされた場合:
    // 効果発揮宣言スタック窓を新たに開く (どちらかでしかスタックタイミングは行えない)。
    // 条件: 外側 burst_activation だけが resolve 対象 かつ subStackEverOpened=false。
    const outermostStack = resolvedStacks[resolvedStacks.length - 1];
    if (
      resolvedStacks.length === 1 &&
      outermostStack !== undefined &&
      outermostStack.actionKind === "burst_activation" &&
      win.burstWindowKind === "activation" &&
      !win.subStackEverOpened
    ) {
      const stateBeforeTransition: GameState = {
        ...options.state,
        window: win.previousWindow,
        stackWindow: null,
      };
      const stateAfterActivationDeclared = markBurstActivationEstablished({
        getCardDefinitionById: options.getCardDefinitionById,
        state: stateBeforeTransition,
        activeStack: outermostStack,
      });
      if (hasPendingEffectsBeforeBurstEffect(stateAfterActivationDeclared)) {
        // 先行する遅延バースト activation があるときは、今回の effect declaration を
        // キューした直後に先頭を再開する。ここで return すると declare_attack のまま
        // battle flash を開けてしまい、後から古い previousWindow へ復帰して
        // flashWindowState だけが孤立する。
        return {
          state: resumeStackCascadeIfReady(
            queueDelayedBurstEffectDeclarationStack({
              state: stateAfterActivationDeclared,
              activeStack: outermostStack,
              previousWindow: win.previousWindow,
            }),
            options
          ),
        };
      }
      return {
        state: openBurstEffectDeclarationStackWindow(
          stateAfterActivationDeclared,
          outermostStack,
          win.actingPlayerId,
          win.previousWindow,
          options.getCardDefinitionById
        ),
      };
    }

    // 通常パス: メインステップスタック窓を閉じて、LIFO 順で全スタック解決。
    const resultState = resolveStackCascade(
      preservedParentStackForPreCostTrigger
        ? {
            ...options.state,
            // `workingWindow` は C12 を 1 枚だけ peel した後の親 stack。ここを閉じると
            // C12 の内部 pending 解決中に親の cascade を再開できなくなる。
            window: "stack",
            stackWindow: workingWindow,
          }
        : {
            ...options.state,
            window: win.previousWindow,
            stackWindow: null,
          },
      resolvedStacks,
      options,
      { allowDuringTargetedDisclosure: true }
    );

    return {
      state: resumeStackCascadeIfReady(
        advanceAttackDeclarationStateIfReady(resultState, options),
        options
      ),
    };
  },
  pass_pre_declaration_stack: (options, action) => {
    const passResult = usePassPreDeclarationStackAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
    });

    // 1-pass cascade: LIFO 順で全 pending スタックを解決してから宣言確定
    const stateForCascade: GameState =
      passResult.closedWindow !== null
        ? {
            ...passResult.state,
            pendingPreDeclarationConfirmation: passResult.closedWindow,
          }
        : passResult.state;
    const cascadedState = resolveStackCascade(
      stateForCascade,
      passResult.resolvedStacks,
      options,
      // A targeted response can open inside this declaration window too.
      // Resolve its closed stacks before resuming the disclosure's parent.
      { allowDuringTargetedDisclosure: true }
    );

    const closedWin = passResult.closedWindow;
    if (closedWin === null) {
      // usePassPreDeclarationStackAsAction は stack_closed で必ず closedWindow を設定するはず
      return { state: cascadedState };
    }
    if (hasOutstandingEffectResolutionContinuation(cascadedState)) {
      return {
        ...passResult,
        state: {
          ...cascadedState,
          pendingPreDeclarationConfirmation: closedWin,
        },
      };
    }

    // `stateForCascade` carries this marker so an interrupted cascade can
    // finalize the declaration after its pending resolution drains. When the
    // cascade completed synchronously here, consume the marker before the
    // direct confirmation below. Otherwise the common post-action finalizer
    // confirms the already-confirmed declaration a second time; the attacker
    // is then exhausted and the second confirmation restores `previousWindow`
    // while leaving the active attack stranded.
    const stateReadyToConfirm: GameState = {
      ...cascadedState,
      pendingPreDeclarationConfirmation: null,
    };

    if (closedWin.kind === "attack") {
      const confirmResult = confirmAttackDeclarationAsAction(
        closedWin,
        stateReadyToConfirm,
        {
          ...options,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
        }
      );
      return {
        ...confirmResult,
        state: advanceAttackDeclarationStateIfReady(
          confirmResult.state,
          options
        ),
      };
    }

    if (closedWin.kind === "block" || closedWin.kind === "forced_block") {
      return confirmBlockDeclarationAsAction(
        closedWin,
        stateReadyToConfirm,
        options
      );
    }

    if (closedWin.kind === "join_active_attack") {
      const confirmResult = confirmJoinActiveAttackDeclarationAsAction(
        closedWin,
        stateReadyToConfirm,
        options
      );
      return {
        ...confirmResult,
        state: advanceAttackDeclarationStateIfReady(
          confirmResult.state,
          options
        ),
      };
    }

    return { state: cascadedState };
  },
  decline_block: (options, action) => {
    return useDeclineBlockAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  },
  end_attack_step: (options) => {
    const nextState = advanceStep(
      options.state,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions,
      options.getRegisteredMagicActions
    );
    return {
      state: nextState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  brave_combine: (options, action) => {
    const braveId = action.braveInstanceId;
    const targetId = action.targetInstanceId;
    const braveBefore = getCardById(options.state, braveId);
    // Both normal slots use the common delta collector. This is a player
    // operation, so it never supplies contract_combine's effect-only cause.
    const queueCombineReactions = (afterState: GameState) => {
      const root = allocateRootTriggerChain(afterState);
      return collectAndQueueTriggerReactions({
        beforeState: options.state,
        afterState: root.state,
        source: "action_resolution",
        chainId: root.chainId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      });
    };

    // 異魔神ブレイヴ (imaginBraveData) の右合体スロット (10_rules/08c §7)。対象ブレイヴが
    // 既に左スロットへ合体済み (attachedToInstanceId !== null) なら、
    // getAvailableBraveCombineLegalActions の右スロット候補生成による2度目の
    // brave_combine と判別し executeImaginBraveSecondCombine へ分岐する
    // (legal action kind を共有し GUI/REST 側の新規配線を不要にする設計)。
    if (braveBefore?.attachedToInstanceId != null) {
      options.state.log.push(
        `brave:combine:imagin-right:${options.state.turnNumber}:${action.actingPlayerId}:${braveId}:${targetId}`
      );

      const dualCombinedState = executeImaginBraveSecondCombine(
        options.state,
        braveId,
        targetId,
        options.getCardDefinitionById
      );

      return {
        state: queueCombineReactions(dualCombinedState),
        outcome: "priority_transferred" as const,
        closedWindow: null,
        resolvedStack: null,
        resolvedStacks: [],
      };
    }

    const braveCores = braveBefore?.normalCoreCount ?? 0;
    const braveSoul = isSoulCoreOn(options.state, braveId);

    options.state.log.push(
      `brave:combine:${options.state.turnNumber}:${action.actingPlayerId}:${braveId}:${targetId}:cores:${braveCores}${braveSoul ? "+soul" : ""}`
    );

    const combinedState = executeBraveCombine(
      options.state,
      action.actingPlayerId,
      braveId,
      targetId,
      options.getCardDefinitionById
    );

    return {
      state: queueCombineReactions(combinedState),
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  contract_combine: (options, action) => {
    // P3-112: 契約合体は「常時以外の効果発揮」につき発揮宣言でスタック窓を開く。
    // 起動コスト（ソウルコアをトラッシュに置く）は効果文内のため、窓クローズ後の
    // deferred 解決 (resolveDeferredContractCombineStack) で支払う（divine_skill と同型）。
    const braveId = action.braveInstanceId;
    const braveCard = getCardInstanceOrThrow(
      options.state,
      braveId,
      "contract_combine brave not found"
    );

    const chainId = `contract-combine:${braveId}:${contractCombineStackSequence++}`;
    const contractCombineActiveStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "contract_combine",
      chainId,
      actingPlayerId: action.actingPlayerId,
      cardInstanceId: braveId,
      cardDefinitionId: braveCard.definitionId,
      activationLabel: "flash",
      sourceActivationZone: "hand",
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `[ContractCombine] ${action.actingPlayerId} が契約合体を発揮宣言（${braveId}）`,
      ],
    };

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack: contractCombineActiveStack,
        actingPlayerId: action.actingPlayerId,
      }),
    };
  },
  link_aid: (options, action) => {
    // P3-112: リンクエイドは「常時以外の効果発揮」につき発揮宣言でスタック窓を開く。
    // 起動コスト（コスト源の通常コア1個をボイドへ）は効果文内のため、
    // 宣言時には支払い元を固定せず、窓クローズ後の deferred 解決
    // (resolveDeferredLinkAidStack) で選択/支払いする。
    const soulStateCard = getCardInstanceOrThrow(
      options.state,
      action.soulStateCardInstanceId,
      "link_aid soul-state card not found"
    );

    const chainId = `link-aid:${action.soulStateCardInstanceId}:${linkAidStackSequence++}`;
    const linkAidActiveStack: ActiveStack = {
      stackId: `stack:${chainId}`,
      actionKind: "link_aid",
      chainId,
      actingPlayerId: action.actingPlayerId,
      cardInstanceId: action.soulStateCardInstanceId,
      cardDefinitionId: soulStateCard.definitionId,
      targetInstanceIds: [],
      targetEffectFilterTags: ["general"],
      activationLabel: "flash",
      sourceActivationZone: "field",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
    };

    const stateAfterDeclaration: GameState = {
      ...options.state,
      log: [
        ...options.state.log,
        `[LinkAid] ${action.actingPlayerId} がリンクエイドを発揮宣言（${action.soulStateCardInstanceId}）`,
      ],
    };

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration,
        activeStack: linkAidActiveStack,
        actingPlayerId: action.actingPlayerId,
      }),
    };
  },
  swap_hand_trash: (options, action) => {
    // 手札/手元⇔トラッシュの1対1入替 (engine-atomic-hand-trash-swap-legal-action、
    // BSTH02.7-TR03(A) 等): 出す側 (手札/手元) の現在ゾーンをそのまま入る側の行き先にする
    // (1対1物理交換、swap_bullet_edit/swap_star_garment と同型の1アクション atomic 交換)。
    const pending = options.state.pendingHandTrashSwapChoice;
    const outgoingCard = getCardById(
      options.state,
      action.outgoingCardInstanceId
    );
    const incomingCard = getCardById(
      options.state,
      action.incomingCardInstanceId
    );
    const pendingOutgoingZones = pending?.outgoingZones ?? [
      "hand",
      "set_aside",
    ];
    if (
      !pending ||
      pending.pendingId !== action.pendingId ||
      pending.actingPlayerId !== action.actingPlayerId ||
      pending.sourceInstanceId !== action.sourceInstanceId ||
      !pending.outgoingCandidateInstanceIds.includes(
        action.outgoingCardInstanceId
      ) ||
      !pending.incomingCandidateInstanceIds.includes(
        action.incomingCardInstanceId
      ) ||
      !outgoingCard ||
      !incomingCard ||
      !isCardInEffectZone(
        options.state,
        outgoingCard,
        pendingOutgoingZones,
        action.actingPlayerId,
        options.getCardDefinitionById
      ) ||
      incomingCard.zone !== "trash" ||
      outgoingCard.ownerPlayerId !== action.actingPlayerId ||
      incomingCard.ownerPlayerId !== action.actingPlayerId
    ) {
      throw new Error(
        `Invalid hand/trash swap: pending=${action.pendingId} source=${action.sourceInstanceId} outgoing=${action.outgoingCardInstanceId} incoming=${action.incomingCardInstanceId}`
      );
    }

    const outgoingDef =
      outgoingCard && options.getCardDefinitionById(outgoingCard.definitionId);
    const incomingDef =
      incomingCard && options.getCardDefinitionById(incomingCard.definitionId);
    // 出す側の現在ゾーン ("hand" | "set_aside") を入る側の行き先にする。
    const destinationZone: "hand" | "set_aside" =
      outgoingCard?.zone === "set_aside" ? "set_aside" : "hand";
    const effectSourceInstanceId =
      pending.effectSourceInstanceId ?? pending.sourceInstanceId;
    const effectSourceDefinitionId =
      pending.effectSourceDefinitionId ?? pending.sourceDefinitionId;
    const effectSourceCard = getCardById(options.state, effectSourceInstanceId);
    const effectSourceDefinition = options.getCardDefinitionById(
      effectSourceDefinitionId
    );
    const availableIncomingIds = new Set(
      resolveHandTrashSearchCandidates({
        state: options.state,
        actingPlayerId: action.actingPlayerId,
        zoneOwnerId: action.actingPlayerId,
        zones: ["trash"],
        getCardDefinitionById: options.getCardDefinitionById,
        ...(pending.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: pending.sourcePreventionLevel }
          : {}),
        effectSource: {
          ...(effectSourceCard ? { instance: effectSourceCard } : {}),
          ...(effectSourceDefinition
            ? { definition: effectSourceDefinition }
            : {}),
        },
        ...(pending.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: pending.sourcePreventionBypass }
          : {}),
        blockMovedToTrashBlockedDisposition: true,
        returnFromTrashDestination: destinationZone,
      }).map((c) => c.instanceId)
    );
    if (!availableIncomingIds.has(action.incomingCardInstanceId)) {
      throw new Error(
        `Invalid hand/trash swap: incoming blocked by resistance pending=${action.pendingId} incoming=${action.incomingCardInstanceId}`
      );
    }

    const afterOutgoing = moveCardZone(
      options.state,
      outgoingCard.instanceId,
      "trash",
      undefined
    );
    const afterIncoming = moveCardZone(
      afterOutgoing,
      incomingCard.instanceId,
      destinationZone,
      undefined
    );
    let newState: GameState = replaceCardInstances(
      {
        ...afterIncoming,
        pendingHandTrashSwapChoice: null,
      },
      afterIncoming.cardInstances.map((c) => {
        if (c.instanceId === action.outgoingCardInstanceId) {
          return {
            ...c,
            zone: "trash" as const,
            attachedToInstanceId: null,
            zoneRoleName: outgoingDef
              ? getDefaultZoneRoleName(outgoingDef, "trash")
              : c.zoneRoleName,
            faceDown: false,
          };
        }
        if (c.instanceId === action.incomingCardInstanceId) {
          return {
            ...c,
            zone: destinationZone,
            attachedToInstanceId: null,
            zoneRoleName: incomingDef
              ? getDefaultZoneRoleName(incomingDef, destinationZone)
              : c.zoneRoleName,
            faceDown: false,
          };
        }
        return c;
      })
    );

    newState = recordHandExchange(options.state, newState);
    newState.log.push(
      `swap_hand_trash:${action.sourceInstanceId}:${action.outgoingCardInstanceId}<->${action.incomingCardInstanceId}`
    );

    newState = recomputeAndRebuildContinuousEffects(
      newState,
      options.getCardDefinitionById
    );

    return {
      state: resumeEffectAfterCardChoice(newState, pending, options, [
        action.outgoingCardInstanceId,
        action.incomingCardInstanceId,
      ]),
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  decline_hand_trash_swap: () => {
    // 03c: 発揮済みの対象選択は辞退不可。旧クライアントの action も拒否する。
    throw new Error("入れ替えの発揮後は辞退できません");
  },
  swap_field_hand: (options, action) => {
    const pending = options.state.pendingFieldHandSwapChoice;
    const sourceCard = getCardById(options.state, action.sourceInstanceId);
    const incomingCard = getCardById(
      options.state,
      action.incomingCardInstanceId
    );
    if (
      !pending ||
      pending.pendingId !== action.pendingId ||
      pending.actingPlayerId !== action.actingPlayerId ||
      pending.sourceInstanceId !== action.sourceInstanceId ||
      !pending.incomingCandidateInstanceIds.includes(
        action.incomingCardInstanceId
      ) ||
      !sourceCard ||
      sourceCard.zone !== "field" ||
      !incomingCard ||
      incomingCard.zone !== "hand" ||
      incomingCard.ownerPlayerId !== action.actingPlayerId
    ) {
      throw new Error(
        `Invalid field/hand swap: source=${action.sourceInstanceId} incoming=${action.incomingCardInstanceId}`
      );
    }
    // 入替の物理処理はチェンジと共用する。コア・合体・バトルを引き継ぐ。
    let newState = executeSpiritHandSwap(
      { ...options.state, pendingFieldHandSwapChoice: null },
      action.incomingCardInstanceId,
      action.sourceInstanceId,
      pending.chainId,
      action.actingPlayerId,
      options.getCardDefinitionById,
      {},
      pending.enterRecovered
    );
    newState = {
      ...newState,
      log: [
        ...newState.log,
        `swap_field_hand:${action.sourceInstanceId}<->${action.incomingCardInstanceId}`,
      ],
    };

    newState = recomputeAndRebuildContinuousEffects(
      newState,
      options.getCardDefinitionById
    );

    // ENGINE-field-hand-swap-trigger: 【聖詠】入れ替え成立を観測イベント化する。zone-diff
    // 経由の汎用 enter_field 検出 (collectAndQueueTriggerReactions) は使わない — 入れ替えは
    // 公式ルール上「召喚」ではないため、それを流用すると無関係な card_event:summon /
    // game_event:summon リスナーまで誤発火する。field_hand_swap は card_event 自己誘発
    // (BSSG01-C03/C04「この効果は、手札から入れ替えたときにも発揮できる」) と
    // game_event(player) 観測 (BSSG01-C05「自分が【聖詠】を発揮したとき」) を単一 eventKind で
    // 直接キューイングする (factories.ts applyGameStartEffects の game_start 同型)。
    newState = queuePendingReactionsFromTriggerEvents(
      newState,
      [
        {
          actingPlayerId: action.actingPlayerId,
          eventKind: "field_hand_swap",
          source: "action_resolution",
          chainId: createEffectResolutionScope(pending.continuation ?? pending)
            .chainId,
          attackId: pending.continuation?.battleEndDeferralAttackId ?? null,
          relatedPlayerId: action.actingPlayerId,
          relatedInstanceId: action.incomingCardInstanceId,
          amount: null,
          ...(pending.effectScope ? { effectScope: pending.effectScope } : {}),
        },
      ],
      undefined,
      {
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }
    );

    return {
      state: resumeEffectAfterCardChoice(newState, pending, options, [
        action.sourceInstanceId,
        action.incomingCardInstanceId,
      ]),
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  decline_field_hand_swap: () => {
    // 03c: 発揮済みの対象選択は辞退不可。旧クライアントの action も拒否する。
    throw new Error("入れ替えの発揮後は辞退できません");
  },
  resolve_brave_combine_choice: (options) => {
    // ブレイヴ召喚のスタック窓クローズ後の「合体する/スピリット状態」選択を解決する。
    return applyResolveBraveCombineChoiceAction(options);
  },
  resolve_tensho_summon: (options) => {
    // 転召（召喚手順内ステップ）の強制コア消費の対象選択を解決する。
    return applyResolveTenshoSummonAction(options);
  },
  resolve_reverse_rebirth_summon: (options) => {
    // 逆転醒 pattern2（裏返して配置/召喚）の支払い + 維持コア配置を解決する。
    return applyResolveReverseRebirthSummonAction(options);
  },
  brave_swap: (options, action) => {
    const braveId = action.braveInstanceId;
    const fromHostId = action.fromHostInstanceId;
    const toHostId = action.toHostInstanceId;
    if (hasPreventBraveSeparationRestriction(options.state, fromHostId)) {
      const blockedState = {
        ...options.state,
        log: [
          ...options.state.log,
          `brave:swap:blocked:prevent_brave_separation:${braveId}:${fromHostId}->${toHostId}`,
        ],
      };
      return {
        state: blockedState,
        outcome: "priority_transferred" as const,
        closedWindow: null,
        resolvedStack: null,
        resolvedStacks: [],
      };
    }
    const braveCard = getCardById(options.state, braveId);
    const toHostCard = getCardById(options.state, toHostId);
    const swappedUnitExhausted =
      braveCard?.exhaustState !== undefined &&
      braveCard.exhaustState !== "recovered"
        ? true
        : toHostCard?.exhaustState !== undefined &&
          toHostCard.exhaustState !== "recovered";

    let swappedState = options.state;
    swappedState = updateCard(swappedState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: toHostId,
    }));
    swappedState = updateCard(swappedState, fromHostId, (c) => ({
      ...c,
      attachedChildrenIds: c.attachedChildrenIds.filter((id) => id !== braveId),
    }));
    swappedState = updateCard(swappedState, toHostId, (c) => ({
      ...c,
      attachedChildrenIds: [...c.attachedChildrenIds, braveId],
      exhaustState: swappedUnitExhausted ? "exhausted" : c.exhaustState,
    }));

    options.state.log.push(
      `brave:swap:${options.state.turnNumber}:${action.actingPlayerId}:${braveId}:${fromHostId}->${toHostId}`
    );

    swappedState = rebuildContinuousAndApplyStateBasedActions(
      swappedState,
      options.getCardDefinitionById
    );

    return {
      state: swappedState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
  brave_separate: (options, action) => {
    const hostId = action.hostInstanceId;
    const braveId = action.braveInstanceId;
    const brave = getCardById(options.state, braveId);
    const host = getCardById(options.state, hostId);
    if (hasPreventBraveSeparationRestriction(options.state, hostId)) {
      const blockedState = {
        ...options.state,
        log: [
          ...options.state.log,
          `brave:separate:blocked:prevent_brave_separation:${braveId}:${hostId}`,
        ],
      };
      return {
        state: blockedState,
        outcome: "priority_transferred" as const,
        closedWindow: null,
        resolvedStack: null,
        resolvedStacks: [],
      };
    }

    // コア補填: GUI から coreDistribution が指定されていればそれを使う
    // 未指定ならリザーブから自動補填（従来互換）
    const coreDistribution = options.separateCoreDistribution as
      | Record<string, number>
      | undefined;
    const braveMinCores = brave?.minimumRequiredCores ?? 0;
    const braveCores =
      (brave?.normalCoreCount ?? 0) +
      (brave && isSoulCoreOn(options.state, braveId) ? 1 : 0);
    const coresNeeded = Math.max(0, braveMinCores - braveCores);

    let separatedState = options.state;

    if (coreDistribution && Object.keys(coreDistribution).length > 0) {
      // GUI 指定: 各ソースからブレイヴにコアを移動
      let totalMoved = 0;
      for (const [sourceId, amount] of Object.entries(coreDistribution)) {
        if (amount <= 0) continue;
        const from =
          sourceId === "reserve"
            ? { kind: "reserve" as const, playerId: action.actingPlayerId }
            : { kind: "card" as const, instanceId: sourceId };
        separatedState = moveNormalCores(
          separatedState,
          from,
          { kind: "card", instanceId: braveId },
          amount,
          options.getCardDefinitionById
        );
        totalMoved += amount;
      }

      const separatedBraveExhaustState = brave
        ? resolveSeparatedBraveExhaustState(
            brave,
            options.getCardDefinitionById(brave.definitionId),
            host
          )
        : ("recovered" as const);

      // ブレイヴを分離
      separatedState = updateCard(separatedState, braveId, (c) => ({
        ...c,
        attachedToInstanceId: null,
        exhaustState: separatedBraveExhaustState,
        ...(separatedBraveExhaustState === "recovered"
          ? { exhaustedByUnpreventableEffect: false }
          : {}),
      }));
      separatedState = updateCard(separatedState, hostId, (c) => ({
        ...c,
        attachedChildrenIds: c.attachedChildrenIds.filter(
          (id) => id !== braveId
        ),
      }));
      separatedState.log.push(
        `brave:separate:${separatedState.turnNumber}:${action.actingPlayerId}:${braveId}:${hostId}:cores:${totalMoved}`
      );
      separatedState = rebuildContinuousAndApplyStateBasedActions(
        separatedState,
        options.getCardDefinitionById
      );
      return {
        state: separatedState,
        outcome: "priority_transferred" as const,
        closedWindow: null,
        resolvedStack: null,
        resolvedStacks: [],
      };
    }

    // 従来互換: リザーブ → 自軍フィールドカード上のコアから補填
    if (coresNeeded > 0) {
      separatedState = moveNormalCoresForBraveSeparation(
        separatedState,
        action.actingPlayerId,
        braveId,
        coresNeeded,
        options.getCardDefinitionById
      );
    }
    const separatedBraveExhaustState = brave
      ? resolveSeparatedBraveExhaustState(
          brave,
          options.getCardDefinitionById(brave.definitionId),
          host
        )
      : ("recovered" as const);
    separatedState = updateCard(separatedState, braveId, (c) => ({
      ...c,
      attachedToInstanceId: null,
      exhaustState: separatedBraveExhaustState,
      ...(separatedBraveExhaustState === "recovered"
        ? { exhaustedByUnpreventableEffect: false }
        : {}),
    }));
    separatedState = updateCard(separatedState, hostId, (c) => ({
      ...c,
      attachedChildrenIds: c.attachedChildrenIds.filter((id) => id !== braveId),
    }));
    separatedState.log.push(
      `brave:separate:${separatedState.turnNumber}:${action.actingPlayerId}:${braveId}:${hostId}`
    );
    separatedState = rebuildContinuousAndApplyStateBasedActions(
      separatedState,
      options.getCardDefinitionById
    );

    return {
      state: separatedState,
      outcome: "priority_transferred" as const,
      closedWindow: null,
      resolvedStack: null,
      resolvedStacks: [],
    };
  },
};

function applyLegalActionCore(
  options: ApplyLegalActionOptions
): ApplyLegalActionResult {
  // ゲーム終了後はアクション実行を拒否
  if (options.state.gameResult !== null) {
    throw new Error(
      `Cannot apply action after game has ended: result=${options.state.gameResult.reason}`
    );
  }

  // ログ配列を mutable 化: 内部関数は push で O(1) 追加する
  // (applyLegalAction 呼び出し元の state.log は変更されない)
  // actionStartLogIndex: 「転醒は同時に使えない」の同一タイミング窓 (= 1 action 適用)
  // の起点を記録する (executeRebirth が窓内の flip 既出を判定する)。
  options = {
    ...options,
    state: {
      ...options.state,
      log: [...options.state.log],
      actionStartLogIndex: options.state.log.length,
    },
  };

  // P2-11 phase6 根治: dispatch の唯一の正源 = LEGAL_ACTION_HANDLERS。
  // LegalActionHandlerMap の (非 optional) マップ型が全 LegalAction["kind"] の
  // handler 登録をコンパイル時に強制する (未登録 kind は型エラー)。Record への
  // cast は「union キーで mapped 型を index できない」TS 制約の回避のみ。
  const handler = (
    LEGAL_ACTION_HANDLERS as Record<
      LegalAction["kind"],
      (o: ApplyLegalActionOptions, a: LegalAction) => ApplyLegalActionResult
    >
  )[options.action.kind];
  return handler(options, options.action);
}

function appendUniqueString(
  values: readonly string[] | undefined,
  value: string
): string[] {
  return values?.includes(value) ? [...values] : [...(values ?? []), value];
}

function appendUniqueStrings(
  values: readonly string[],
  additions: readonly string[]
): string[] {
  const result = [...values];
  for (const addition of additions) {
    if (!result.includes(addition)) result.push(addition);
  }
  return result;
}

function getTargetRedirectReplacementMode(
  pending: PendingTargetRedirect
): TargetRedirectReplacementMode {
  return pending.replacementMode ?? "collapse";
}

function getTargetRedirectReplacementInstanceIds(options: {
  pending: PendingTargetRedirect;
  applyOptions: ApplyLegalActionOptions;
  redirectableInstanceIds: readonly string[];
}): string[] {
  const { pending, applyOptions, redirectableInstanceIds } = options;
  const replacementMode = getTargetRedirectReplacementMode(pending);
  if (replacementMode === "reselect") {
    const withIds =
      applyOptions.redirectTargetReplacementInstanceIds ??
      (applyOptions.redirectTargetReplacementInstanceId !== undefined
        ? [applyOptions.redirectTargetReplacementInstanceId]
        : undefined);
    if (!withIds || withIds.length === 0) {
      throw new Error(
        "confirm_target_redirect requires redirectTargetReplacementInstanceIds"
      );
    }
    if (withIds.length !== redirectableInstanceIds.length) {
      throw new Error(
        `redirectTargetReplacementInstanceIds count ${withIds.length} does not match redirectable target count ${redirectableInstanceIds.length}`
      );
    }
    const candidateSet = new Set(pending.candidateTokenInstanceIds);
    const seen = new Set<string>();
    for (const withId of withIds) {
      if (seen.has(withId)) {
        throw new Error(
          `redirectTargetReplacementInstanceIds contains duplicate ${withId}`
        );
      }
      seen.add(withId);
      if (!candidateSet.has(withId)) {
        throw new Error(
          `redirectTargetReplacementInstanceIds ${withId} not in candidateTokenInstanceIds [${pending.candidateTokenInstanceIds.join(", ")}]`
        );
      }
    }
    return [...withIds];
  }

  const withId =
    applyOptions.redirectTargetReplacementInstanceId ??
    applyOptions.redirectTargetReplacementInstanceIds?.[0];
  if (!withId) {
    throw new Error(
      "confirm_target_redirect requires redirectTargetReplacementInstanceId"
    );
  }
  if (!pending.candidateTokenInstanceIds.includes(withId)) {
    throw new Error(
      `redirectTargetReplacementInstanceId ${withId} not in candidateTokenInstanceIds [${pending.candidateTokenInstanceIds.join(", ")}]`
    );
  }
  return [withId];
}

function applyTargetRedirectReplacementToResolvedTargets(options: {
  resolvedInstanceIds: readonly string[];
  redirectableInstanceIds: readonly string[];
  replacementInstanceIds: readonly string[];
  replacementMode: TargetRedirectReplacementMode;
}): string[] {
  if (options.replacementMode === "reselect") {
    return applyRedirectReselectionToResolvedTargets(
      options.resolvedInstanceIds,
      options.redirectableInstanceIds,
      options.replacementInstanceIds
    );
  }
  return applyRedirectToResolvedTargets(
    options.resolvedInstanceIds,
    options.redirectableInstanceIds,
    options.replacementInstanceIds[0]!
  );
}

function applyTargetRedirectToCoreDistributionPending(options: {
  state: GameState;
  pending: PendingCoreDistribution;
  redirectableInstanceIds: readonly string[];
  replacementInstanceIds: readonly string[];
  replacementMode: TargetRedirectReplacementMode;
  redirectEffectId: string;
}): PendingCoreDistribution {
  // A redirect after target totals have been fixed replaces a physical
  // placement, rather than asking the chooser for target totals again. Those
  // totals describe the old candidates and cannot be reused for the
  // replacement (which may already have cores of its own), so let the
  // redirected physical allocation resolve directly.
  const pendingAfterConsumedTargetTotals =
    options.pending.targetTotalSelection?.fixedTargetTotals !== undefined
      ? (() => {
          const { targetTotalSelection: _ignored, ...pending } =
            options.pending;
          return pending;
        })()
      : options.pending;
  const redirectedCandidateIds =
    applyTargetRedirectReplacementToResolvedTargets({
      resolvedInstanceIds: options.pending.candidates.map(
        (candidate) => candidate.instanceId
      ),
      redirectableInstanceIds: options.redirectableInstanceIds,
      replacementInstanceIds: options.replacementInstanceIds,
      replacementMode: options.replacementMode,
    });
  const seen = new Set<string>();
  const candidates: PendingCoreDistribution["candidates"] = [];
  for (const instanceId of redirectedCandidateIds) {
    if (seen.has(instanceId)) continue;
    seen.add(instanceId);
    const existing = options.pending.candidates.find(
      (candidate) => candidate.instanceId === instanceId
    );
    const card = getCardById(options.state, instanceId);
    const definitionId = existing?.definitionId ?? card?.definitionId;
    if (!definitionId) {
      throw new Error(
        `applyTargetRedirectAction: core distribution redirect target ${instanceId} is not in state`
      );
    }
    candidates.push({ instanceId, definitionId });
  }
  const targetInterruption =
    options.pending.targetInterruption !== undefined
      ? {
          targetInterruption: {
            ...options.pending.targetInterruption,
            targetedDisclosureResolved: false,
          },
        }
      : {};
  return {
    ...pendingAfterConsumedTargetTotals,
    candidates,
    skippedTargetRedirectEffectIds: appendUniqueString(
      options.pending.skippedTargetRedirectEffectIds,
      options.redirectEffectId
    ),
    ...targetInterruption,
  };
}

function getCoreDistributionRedirectReplacementId(options: {
  instanceId: string;
  redirectableInstanceIds: readonly string[];
  replacementInstanceIds: readonly string[];
  replacementMode: TargetRedirectReplacementMode;
}): string {
  const redirectIndex = options.redirectableInstanceIds.indexOf(
    options.instanceId
  );
  if (redirectIndex < 0) return options.instanceId;
  if (options.replacementMode === "reselect") {
    return options.replacementInstanceIds[redirectIndex] ?? options.instanceId;
  }
  return options.replacementInstanceIds[0] ?? options.instanceId;
}

function applyTargetRedirectToCoreDistributionAllocations(options: {
  allocations: Record<string, number>;
  redirectableInstanceIds: readonly string[];
  replacementInstanceIds: readonly string[];
  replacementMode: TargetRedirectReplacementMode;
}): Record<string, number> {
  const nextAllocations: Record<string, number> = {};
  for (const [instanceId, amount] of Object.entries(options.allocations)) {
    const nextInstanceId = getCoreDistributionRedirectReplacementId({
      instanceId,
      redirectableInstanceIds: options.redirectableInstanceIds,
      replacementInstanceIds: options.replacementInstanceIds,
      replacementMode: options.replacementMode,
    });
    nextAllocations[nextInstanceId] =
      (nextAllocations[nextInstanceId] ?? 0) + amount;
  }
  return nextAllocations;
}

function applyTargetRedirectToCoreDistributionSoulCoreInstanceId(options: {
  soulCoreInstanceId: string | undefined;
  redirectableInstanceIds: readonly string[];
  replacementInstanceIds: readonly string[];
  replacementMode: TargetRedirectReplacementMode;
}): string | undefined {
  if (options.soulCoreInstanceId === undefined) return undefined;
  return getCoreDistributionRedirectReplacementId({
    instanceId: options.soulCoreInstanceId,
    redirectableInstanceIds: options.redirectableInstanceIds,
    replacementInstanceIds: options.replacementInstanceIds,
    replacementMode: options.replacementMode,
  });
}

/**
 * P3-47 F-4 Step 3a/3b: confirm_target_redirect / decline_target_redirect の解決。
 *
 * pendingTargetRedirects[0] (FIFO 先頭) を消費し、redirect 結果を返す。
 * - confirm: options.redirectTargetReplacementInstanceId が
 *   pending.candidateTokenInstanceIds に含まれていることを検証し、置換後の対象集合を返す。
 * - decline: 元の集合のまま返す。
 *
 * Step 3b で continuation 配線を追加。pending.continuation が設定されていれば
 * `executeEffect({ startFromStepIndex, restoredStepContext, targetInstanceIds })` を呼んで
 * 中断した effect/step を redirected/原集合の対象 ID で再起動する。
 * continuation 未設定の pending (旧 Step 3a 互換) は従来通り state のみ返す。
 */
function applyTargetRedirectAction(
  options: ApplyLegalActionOptions
): import("./legal-actions-types").ResolveTargetRedirectResult {
  const { state, action } = options;
  if (
    action.kind !== "confirm_target_redirect" &&
    action.kind !== "decline_target_redirect"
  ) {
    throw new Error(
      `applyTargetRedirectAction: unexpected action kind: ${action.kind}`
    );
  }
  const pending = state.pendingTargetRedirects.find(
    (p) => p.pendingId === action.pendingId
  );
  if (!pending) {
    throw new Error(
      `Unknown pendingTargetRedirect: pendingId=${action.pendingId}`
    );
  }
  const candidateChooserPlayerId =
    pending.candidateChooserPlayerId ?? pending.promptedPlayerId;
  const awaitsCandidateChoice =
    pending.decisionConfirmed === true &&
    candidateChooserPlayerId !== pending.promptedPlayerId;
  const expectedActorId =
    action.kind === "confirm_target_redirect" && awaitsCandidateChoice
      ? candidateChooserPlayerId
      : pending.promptedPlayerId;
  if (action.actingPlayerId !== expectedActorId) {
    throw new Error(
      `${action.kind} must be invoked by expected redirect actor: actingPlayerId=${action.actingPlayerId} vs expectedActorId=${expectedActorId} (promptedPlayerId=${pending.promptedPlayerId}, candidateChooserPlayerId=${candidateChooserPlayerId})`
    );
  }
  if (action.kind === "decline_target_redirect" && awaitsCandidateChoice) {
    throw new Error(
      "decline_target_redirect is not allowed after redirect confirmation"
    );
  }

  let redirected = false;
  let resolvedAfterRedirect: string[];
  let replacementInstanceIds: string[] = [];
  const redirectableInstanceIds = pending.redirectableInstanceIds ?? [
    pending.redirectableInstanceId,
  ];
  const replacementMode = getTargetRedirectReplacementMode(pending);
  if (action.kind === "confirm_target_redirect") {
    if (
      candidateChooserPlayerId !== pending.promptedPlayerId &&
      pending.decisionConfirmed !== true
    ) {
      const nextPendingTargetRedirects = state.pendingTargetRedirects.map(
        (p) =>
          p.pendingId === pending.pendingId
            ? { ...p, decisionConfirmed: true }
            : p
      );
      return {
        state: {
          ...state,
          pendingTargetRedirects: nextPendingTargetRedirects,
          log: [
            ...state.log,
            `effect:redirect_target:${pending.pendingId}:confirm-decision:${pending.promptedPlayerId}->chooser:${candidateChooserPlayerId}`,
          ],
        },
        pendingId: pending.pendingId,
        redirected: false,
        resolvedAfterRedirect: [...pending.originalResolvedInstanceIds],
      };
    }
    replacementInstanceIds = getTargetRedirectReplacementInstanceIds({
      pending,
      applyOptions: options,
      redirectableInstanceIds,
    });
    // forced_target_inclusion タウント: redirect は元効果の対象選択が確定した後に
    // 割り込む別経路のため、タウント対象を対象集合から外せてしまうと強制が無意味になる。
    // 元効果の発揮者 (sourceEffectInstanceId の controller) を actingPlayerId として、
    // 差し替え対象 (redirectableInstanceIds) のいずれかが強制対象かどうかを判定する。
    const sourceEffectCard = getCardById(state, pending.sourceEffectInstanceId);
    if (sourceEffectCard) {
      const forcedIds = getMandatoryForcedTargetInclusionIds(
        state,
        sourceEffectCard.controllerPlayerId,
        redirectableInstanceIds,
        redirectableInstanceIds.length
      );
      if (forcedIds.some((id) => redirectableInstanceIds.includes(id))) {
        throw new Error(
          `Cannot redirect forced target inclusion candidate ${forcedIds.join(",")} away`
        );
      }
    }
    redirected = true;
    resolvedAfterRedirect = applyTargetRedirectReplacementToResolvedTargets({
      resolvedInstanceIds: pending.originalResolvedInstanceIds,
      redirectableInstanceIds,
      replacementInstanceIds,
      replacementMode,
    });
  } else {
    resolvedAfterRedirect = [...pending.originalResolvedInstanceIds];
  }

  const remaining = state.pendingTargetRedirects.filter(
    (p) => p.pendingId !== action.pendingId
  );
  // redirect_effect_target CE 側の usageLimit (例:「ターンに1回」) は redirect が実際に
  // confirm されたときのみ消費する (decline は消費しない)。BSLH01-R02 (先例フランドールは
  // usageLimit 無指定なので既存挙動は変わらない)。
  const redirectingCe = redirected
    ? state.activeContinuousEffects.find(
        (ce) => ce.effectId === pending.redirectEffectId
      )
    : undefined;
  const redirectCeUsageLimit = redirectingCe
    ? getRedirectEffectTargetMetadata(redirectingCe)?.usageLimit
    : undefined;
  const stateAfterRedirectUsageRecord = redirectCeUsageLimit
    ? recordEffectUsageIfLimited({
        state,
        sourceInstanceId: redirectingCe!.sourceInstanceId,
        sourceDefinitionId: redirectingCe!.sourceDefinitionId,
        effectLabel: "redirect_effect_target",
        usageLimit: redirectCeUsageLimit,
      })
    : state;
  if (pending.coreDistributionPendingId !== undefined) {
    const coreDistributionPending =
      stateAfterRedirectUsageRecord.pendingCoreDistribution;
    if (
      coreDistributionPending === null ||
      coreDistributionPending.pendingId !== pending.coreDistributionPendingId
    ) {
      throw new Error(
        `applyTargetRedirectAction: core distribution pending ${pending.coreDistributionPendingId} is not active`
      );
    }
    const nextCoreDistributionPending = redirected
      ? applyTargetRedirectToCoreDistributionPending({
          state: stateAfterRedirectUsageRecord,
          pending: coreDistributionPending,
          redirectableInstanceIds,
          replacementInstanceIds,
          replacementMode,
          redirectEffectId: pending.redirectEffectId,
        })
      : {
          ...coreDistributionPending,
          skippedTargetRedirectEffectIds: appendUniqueString(
            coreDistributionPending.skippedTargetRedirectEffectIds,
            pending.redirectEffectId
          ),
        };
    const stateAfterCoreDistributionRedirect: GameState = {
      ...stateAfterRedirectUsageRecord,
      pendingCoreDistribution: nextCoreDistributionPending,
      pendingTargetRedirects: remaining,
      log: [
        ...stateAfterRedirectUsageRecord.log,
        redirected
          ? `effect:redirect_target:${pending.pendingId}:confirm:${pending.redirectableInstanceId}->${replacementInstanceIds.join(",")}`
          : `effect:redirect_target:${pending.pendingId}:decline`,
      ],
    };
    if (pending.coreDistributionAllocations !== undefined) {
      const nextAllocations = redirected
        ? applyTargetRedirectToCoreDistributionAllocations({
            allocations: pending.coreDistributionAllocations,
            redirectableInstanceIds,
            replacementInstanceIds,
            replacementMode,
          })
        : { ...pending.coreDistributionAllocations };
      const nextSoulCoreInstanceId = redirected
        ? applyTargetRedirectToCoreDistributionSoulCoreInstanceId({
            soulCoreInstanceId: pending.coreDistributionSoulCoreInstanceId,
            redirectableInstanceIds,
            replacementInstanceIds,
            replacementMode,
          })
        : pending.coreDistributionSoulCoreInstanceId;
      const nextSoulCoreAllocations =
        pending.coreDistributionSoulCoreAllocations !== undefined
          ? redirected
            ? applyTargetRedirectToCoreDistributionAllocations({
                allocations: pending.coreDistributionSoulCoreAllocations,
                redirectableInstanceIds,
                replacementInstanceIds,
                replacementMode,
              })
            : { ...pending.coreDistributionSoulCoreAllocations }
          : undefined;
      const distributionResult = applyPendingCoreDistributionAction({
        ...options,
        state: stateAfterCoreDistributionRedirect,
        coreDistributionAllocations: nextAllocations,
        ...(pending.coreDistributionSourceAllocations !== undefined
          ? {
              coreDistributionSourceAllocations: {
                ...pending.coreDistributionSourceAllocations,
              },
            }
          : {}),
        ...(pending.coreDistributionSoulCoreSourceAllocations !== undefined
          ? {
              coreDistributionSoulCoreSourceAllocations: {
                ...pending.coreDistributionSoulCoreSourceAllocations,
              },
            }
          : {}),
        ...(nextSoulCoreInstanceId !== undefined
          ? { coreDistributionSoulCoreInstanceId: nextSoulCoreInstanceId }
          : {}),
        ...(nextSoulCoreAllocations !== undefined
          ? { coreDistributionSoulCoreAllocations: nextSoulCoreAllocations }
          : {}),
      });
      return {
        state: distributionResult.state,
        pendingId: pending.pendingId,
        redirected,
        resolvedAfterRedirect,
      };
    }
    return {
      state: stateAfterCoreDistributionRedirect,
      pendingId: pending.pendingId,
      redirected,
      resolvedAfterRedirect,
    };
  }
  const stateAfter: GameState = {
    ...stateAfterRedirectUsageRecord,
    pendingTargetRedirects: remaining,
    log: [
      ...stateAfterRedirectUsageRecord.log,
      redirected
        ? `effect:redirect_target:${pending.pendingId}:confirm:${pending.redirectableInstanceId}->${replacementInstanceIds.join(",")}`
        : `effect:redirect_target:${pending.pendingId}:decline`,
    ],
  };

  // P3-47 F-4 Step 3b: continuation がある場合は元効果を redirected/原集合で再実行する。
  // effect-interpreter は resolveTargets 直後に redirect 検出して return しているため、
  // ここでは startFromStepIndex=resumeStepIndex + targetInstanceIds=resolvedAfterRedirect で
  // 同 effect/step を再投入する。restoredStepContext で前ステップ結果を保持する。
  let finalState: GameState = stateAfter;
  if (pending.continuation) {
    const cont = pending.continuation;
    const resolution = createEffectResolutionScope(cont);
    const def = options.getCardDefinitionById(cont.sourceDefinitionId);
    const effect = resolveContinuationEffect(def, cont);
    if (!effect) {
      throw new Error(
        `applyTargetRedirectAction: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
      );
    }
    const resumeTargetInstanceIds = cont.targetInstanceIds
      ? (() => {
          if (
            cont.redirectTargetIndexes !== undefined &&
            cont.redirectTargetIndexes.length === resolvedAfterRedirect.length
          ) {
            const next = [...cont.targetInstanceIds!];
            for (
              let index = 0;
              index < cont.redirectTargetIndexes.length;
              index++
            ) {
              next[cont.redirectTargetIndexes[index]!] =
                resolvedAfterRedirect[index]!;
            }
            return next;
          }
          if (cont.redirectTargetIndexes !== undefined) {
            const redirectIndexSet = new Set(cont.redirectTargetIndexes);
            const firstRedirectIndex = Math.min(...cont.redirectTargetIndexes);
            const next: string[] = [];
            for (
              let index = 0;
              index < cont.targetInstanceIds!.length;
              index++
            ) {
              if (!redirectIndexSet.has(index)) {
                next.push(cont.targetInstanceIds![index]!);
                continue;
              }
              if (index === firstRedirectIndex) {
                next.push(...resolvedAfterRedirect);
              }
            }
            return next;
          }
          const start = cont.redirectTargetStart ?? 0;
          const count =
            cont.redirectTargetCount ??
            pending.originalResolvedInstanceIds.length;
          const next = [...cont.targetInstanceIds!];
          next.splice(start, count, ...resolvedAfterRedirect);
          return next;
        })()
      : resolvedAfterRedirect;
    const resumeTargetGroups =
      cont.targetGroups !== undefined &&
      redirected &&
      replacementInstanceIds.length > 0
        ? cont.targetGroups.map((group) => {
            const groupRedirectableCount = redirectableInstanceIds.filter(
              (id) => group.candidateTargetInstanceIds.includes(id)
            ).length;
            const groupContainsRedirectable = groupRedirectableCount > 0;
            const replacementAlreadyCandidate = replacementInstanceIds.every(
              (id) => group.candidateTargetInstanceIds.includes(id)
            );
            const candidateTargetInstanceIds = replacementAlreadyCandidate
              ? group.candidateTargetInstanceIds
              : appendUniqueStrings(
                  group.candidateTargetInstanceIds,
                  replacementInstanceIds
                );
            const requiredTargetCount = groupContainsRedirectable
              ? Math.max(
                  0,
                  group.requiredTargetCount -
                    groupRedirectableCount +
                    resolvedAfterRedirect.length
                )
              : group.requiredTargetCount;
            const maxTargetCount =
              group.maxTargetCount !== undefined && groupContainsRedirectable
                ? Math.max(requiredTargetCount, group.maxTargetCount)
                : group.maxTargetCount;
            if (
              !groupContainsRedirectable ||
              (replacementAlreadyCandidate &&
                requiredTargetCount === group.requiredTargetCount &&
                maxTargetCount === group.maxTargetCount)
            ) {
              return group;
            }
            return {
              ...group,
              requiredTargetCount,
              ...(maxTargetCount !== undefined ? { maxTargetCount } : {}),
              candidateTargetInstanceIds,
            };
          })
        : cont.targetGroups;
    finalState = resolution.execute({
      state: stateAfter,
      effect,
      effectIndex: cont.effectIndex,
      ...(cont.divineSkillIndex !== undefined
        ? { divineSkillIndex: cont.divineSkillIndex }
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
      targetedDisclosureSourceDefinitionId: cont.sourceDefinitionId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      ...(cont.battleEndDeferralAttackId !== undefined
        ? {
            battleEndDeferralAttackId: cont.battleEndDeferralAttackId,
          }
        : {}),
      startFromStepIndex: cont.resumeStepIndex,
      restoredStepContext: cont.stepContext,
      targetInstanceIds: resumeTargetInstanceIds,
      ...(resumeTargetGroups !== undefined
        ? { targetGroups: resumeTargetGroups }
        : {}),
      ...(cont.targetStepId !== undefined
        ? { targetStepId: cont.targetStepId }
        : {}),
      // 同じ redirect_effect_target CE を resume ステップで再発火させない
      // (= confirm/decline 済みの選択を二度プロンプトしないため)
      skipRedirectEffectIdsAtStartStep: [pending.redirectEffectId],
      ...(cont.redirectTargetStart !== undefined
        ? { skipRedirectTargetStartAtStartStep: cont.redirectTargetStart }
        : {}),
      ...(cont.redirectTargetCount !== undefined
        ? {
            skipRedirectTargetCountAtStartStep: redirected
              ? resolvedAfterRedirect.length
              : cont.redirectTargetCount,
          }
        : {}),
      forceSnapshotContinuousTargets: redirected,
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
    });
    finalState = resolution.finalize({
      state: finalState,
      beforeState: stateAfter,
      endLogs: [],
      actingPlayerId: cont.actingPlayerId,
      causedBySourceInstanceId:
        cont.effectSourceInstanceId ?? cont.sourceInstanceId,
      enterFieldCausedByPlayerId: cont.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(cont.battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
        : {}),
    });
    finalState = checkAndQueuePostResolutionOracleIfReady(
      finalState,
      cont.postResolutionOracle,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    );
    finalState = maybeFinalizeBattleEndScopeAfterPendingDrain(
      finalState,
      options
    );
  }

  return {
    state: finalState,
    pendingId: pending.pendingId,
    redirected,
    resolvedAfterRedirect,
  };
}

/**
 * DeckReveal pending の pick / order を処理する。
 */
export function tryApplyLegalAction(
  options: ApplyLegalActionOptions
): SafeActionResult {
  try {
    const result = applyLegalAction(options);
    return { ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      state: {
        ...options.state,
        log: [
          ...options.state.log,
          `action:rollback:${options.action.kind}:${message}`,
        ],
      },
      error: message,
    };
  }
}

/** コア選択の完了後に、保存した宣言条件で共通の召喚処理へ進む。 */
function completeSummonDeclaration(
  rawOptions: ApplyLegalActionOptions,
  options: ApplyLegalActionOptions,
  action: import("./legal-actions-types").SummonLegalAction,
  resolvedTargetInstanceIds: readonly string[],
  permissionDeclarationConsumesTargets: boolean,
  tokenPoolPreCostForcedCombine: { combineHostInstanceId: string } | null
) {
  const cardPlayTargetInstanceIds = permissionDeclarationConsumesTargets
    ? []
    : resolvedTargetInstanceIds;
  const resolvedChosenLifeCoreKind = resolveChosenLifeCoreKind(
    action,
    options.chosenLifeCoreKind
  );
  const isNonMainSummonDeclaration =
    action.summonPermissionEffectIndex !== undefined ||
    action.declaredSummonAltCostGrantSourceInstanceId !== undefined;
  const opensPlayCardStack =
    (options.state.step === "main" &&
      options.state.activePlayerId === action.actingPlayerId) ||
    isNonMainSummonDeclaration;

  if (opensPlayCardStack) {
    const deferredResult = useSummonInStackContextAsAction({
      state: options.state,
      actingPlayerId: action.actingPlayerId,
      cardInstanceId: action.sourceInstanceId,
      targetInstanceIds: cardPlayTargetInstanceIds,
      targetEffectFilterTags: permissionDeclarationConsumesTargets
        ? ["general"]
        : action.targetEffectFilterTags,
      paymentSources: resolvePaymentSources(action, options.paymentSources),
      ...(action.fixedPaymentCost !== undefined
        ? { fixedPaymentCost: action.fixedPaymentCost }
        : {}),
      ...(action.baseCostOverride !== undefined
        ? { baseCostOverride: action.baseCostOverride }
        : {}),
      ...(action.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
        : {}),
      // 自己召喚許可は通常コストでも main 以外（フラッシュ窓等）で使えるため許可。
      ...(isNonMainSummonDeclaration ? { allowNonMainStep: true } : {}),
      ...(action.summonPermissionEffectIndex !== undefined
        ? { sourceEffectIndex: action.summonPermissionEffectIndex }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(resolvedChosenLifeCoreKind !== undefined
        ? {
            chosenLifeCoreKind: resolvedChosenLifeCoreKind,
          }
        : {}),
      ...(options.enterFieldCorePlacements
        ? {
            enterFieldCorePlacements: options.enterFieldCorePlacements,
          }
        : {}),
      ...(tokenPoolPreCostForcedCombine
        ? {
            combineHostInstanceId:
              tokenPoolPreCostForcedCombine.combineHostInstanceId,
          }
        : {}),
    });
    const stateAfterSummonPermissionUsageRecord =
      action.summonPermissionEffectIndex !== undefined
        ? recordEffectUsageIfLimited({
            state: deferredResult.state,
            sourceInstanceId: action.sourceInstanceId,
            sourceDefinitionId: action.sourceDefinitionId,
            effectLabel: getStableEffectLabel(
              "summon_permission",
              action.summonPermissionEffectIndex,
              { effectIndex: action.summonPermissionEffectIndex }
            ),
            usageLimit: action.summonPermissionUsageLimit,
            ...(action.summonPermissionLimitGroupId
              ? {
                  groupId: action.summonPermissionLimitGroupId,
                }
              : {}),
          })
        : deferredResult.state;

    return {
      state: openEffectDeclarationStackWindow({
        baseState: options.state,
        stateAfterDeclaration: stateAfterSummonPermissionUsageRecord,
        rollbackBeforeState: rawOptions.state,
        activeStack: {
          ...deferredResult.activeStack,
          ...(action.declaredSummonAltCostGrantSourceInstanceId !== undefined
            ? {
                playDeclarationIgnoresSummonCondition:
                  getDeclaredSummonAltCostGrant(
                    rawOptions.state,
                    action.actingPlayerId,
                    getCardDefinitionOrThrow(
                      action.sourceDefinitionId,
                      rawOptions.getCardDefinitionById
                    )
                  )?.benefits.ignoreSummonCondition === true,
              }
            : {}),
        },
        actingPlayerId: action.actingPlayerId,
      }),
      chainId: deferredResult.activeStack.chainId,
    };
  }

  return playSummonAsAction({
    state: options.state,
    actingPlayerId: action.actingPlayerId,
    cardInstanceId: action.sourceInstanceId,
    targetInstanceIds: cardPlayTargetInstanceIds,
    targetEffectFilterTags: permissionDeclarationConsumesTargets
      ? ["general"]
      : action.targetEffectFilterTags,
    paymentSources: resolvePaymentSources(action, options.paymentSources),
    ...(action.fixedPaymentCost !== undefined
      ? { fixedPaymentCost: action.fixedPaymentCost }
      : {}),
    ...(action.baseCostOverride !== undefined
      ? { baseCostOverride: action.baseCostOverride }
      : {}),
    ...(action.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(resolvedChosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: resolvedChosenLifeCoreKind,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
    ...(options.enterFieldCorePlacements
      ? {
          enterFieldCorePlacements: options.enterFieldCorePlacements,
        }
      : {}),
    ...(tokenPoolPreCostForcedCombine
      ? {
          combineHostInstanceId:
            tokenPoolPreCostForcedCombine.combineHostInstanceId,
        }
      : {}),
  });
}

/** Resume after pre-cost placement without re-declaring permissions or generating a second token. */
export function resumeSummonDeclaration(
  options: ApplyLegalActionOptions,
  pending: import("../model").DeferredSummonDeclaration
) {
  let action = pending.action;
  const definition = getCardDefinitionOrThrow(
    action.sourceDefinitionId,
    options.getCardDefinitionById
  );
  const availability = getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: action.actingPlayerId,
    card: definition,
    sourceInstanceId: action.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    useKind: "summon",
    ...(action.baseCostOverride !== undefined
      ? { baseCostOverride: action.baseCostOverride }
      : {}),
    ...(action.onBoardCoreSourceFilter !== undefined
      ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
      : {}),
  });
  action = {
    ...action,
    finalCost: action.fixedPaymentCost ?? availability.reduction.finalCost,
    availableReserveCoreAmount: availability.reserveSource.availableCoreAmount,
    availableOnBoardCoreSources: availability.onBoardCoreSources,
    availableSoulCoreOnlySources: availability.soulCoreOnlySources,
  };
  const paymentChoice = resolveEffectSummonPaymentChoice({
    state: options.state,
    actingPlayerId: action.actingPlayerId,
    sourceInstanceId: action.sourceInstanceId,
    targetInstanceId: action.sourceInstanceId,
    definition,
    amount: action.fixedPaymentCost ?? availability.reduction.finalCost,
    getCardDefinitionById: options.getCardDefinitionById,
    paymentSources: options.paymentSources ?? pending.inputs.paymentSources,
    onBoardCoreSourceFilter: action.onBoardCoreSourceFilter,
  });
  if (paymentChoice.kind === "unavailable")
    throw new Error("Summon cost unavailable after pre-cost placement");
  if (paymentChoice.kind === "pending")
    return {
      state: {
        ...paymentChoice.state,
        pendingEffectSummonCostPayment: {
          ...paymentChoice.state.pendingEffectSummonCostPayment!,
          summonDeclaration: pending,
        },
      },
      chainId: `summon-payment:${action.sourceInstanceId}`,
    };
  const resumedOptions = {
    ...options,
    ...pending.inputs,
    paymentSources: paymentChoice.paymentSources,
  };
  return completeSummonDeclaration(
    { ...resumedOptions, state: pending.originalState },
    resumedOptions,
    action,
    pending.targetInstanceIds,
    pending.permissionDeclarationConsumesTargets,
    { combineHostInstanceId: pending.combineHostInstanceId }
  );
}
