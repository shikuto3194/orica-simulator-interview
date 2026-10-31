import { buildSummonActionCostModifier } from "./summon-cost";
import { requireTriggerChainId } from "../chain-id";
import { resolveTurnFaceDown } from "./turn-face-down";
import { registerCardAccessRule } from "./card-access-rules";
import { resolveZoneMoveHandGainCost } from "./hand-gain-cost";
import { computeLifeReductionAmountBonus } from "./structured-modifiers";
import { queueActionCountSelection } from "./action-count-selection";
import { getFieldCoreSourceTakeableCount } from "./structured-core-shoot";
// P2-14 inc7: effect-interpreter god-file 分解。native アクション実行 registry 本体
// (NativeActionContext 型群 + NATIVE_ACTION_HANDLERS dispatch レジストリ + executeNativeAction
// dispatcher) を兄弟ファイルへ抽出。arrow は各 leaf handler/helper module から import し、
// 親ローカル関数は呼ばない完全 leaf のため一方向 import (循環なし)。barrel/振る舞い不変。

// P3-88 core_move amount {min,max}: pendingCoreCountSelection 生成用 sequence (registry 専用 counter)
import { recordHandEntries, recordHandExchange } from "../zone/hand-increase";
let coreCountPendingSequence = 0;
// ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2 count_decrease amount
// {min,max}: pendingCountSelection 生成用 sequence (registry 専用 counter)
let countSelectionPendingSequence = 0;
// engine-atomic-hand-trash-swap-legal-action: pendingHandTrashSwapChoice 生成用 sequence
let handTrashSwapPendingSequence = 0;
// field-hand swap: pendingFieldHandSwapChoice 生成用 sequence
let fieldHandSwapPendingSequence = 0;
// BSTH02.7-C06 branch2: pendingGroupedSummonCostOverrideChoice 生成用 sequence
let groupedSummonCostOverridePendingSequence = 0;
// ENGINE-composite-heterogeneous-removal-budget discard_set_burst count {min,max}:
// pendingDiscardSetBurstCountSelection 生成用 sequence (registry 専用 counter)
let discardSetBurstCountSelectionPendingSequence = 0;

import { getEffectiveBp } from "../battle/battle-shared";
import { designateActiveAttackTarget } from "../battle/designated-attack-target";
import { executeEndSingleBattle } from "../battle/battle-actions";
import { getBattleEndDeferralChainId } from "../battle/battle-end-scope-finalize";
import { matchesCardFilter, pickCostCEFilterFields } from "../card/card-filter";
import { getCardById } from "../card/card-lookup";
import { placeFieldCardBeside } from "../card/field-position";
import { putCardOnField } from "../card/put-card-on-field";
import { isTimingScopeActive } from "../card/ce-lookup";
import { immuneProtectedCount } from "../model";
import { requireCardZone } from "../model";
import {
  getNormalCoreCountAtLocation,
  getTotalCoresOnCardById,
  isSoulCoreOn,
  moveCardZone,
  updateCard,
} from "../core/core-system";
import {
  applyCardCostPayments,
  getTotalPaymentAmount,
  getAvailablePayCostCoreSources,
  getAutomaticNormalCorePaymentSources,
  type CardCostPaymentSource,
} from "../core/payment-system";
import type { Action, Effect, ResistableOutcome } from "../dsl-types";
import { getDefaultZoneRoleName } from "../factories";
import {
  canUseEffectByUsageLimit,
  composeRecordedUsage,
  evaluateBraveCombineAsSummonGate,
  getChoiceVariantUsageLabel,
  getEffectSourceTribePreventionBypass,
  getEffectiveColors,
  getEffectiveTribes,
  isEligibleBraveCombineHost,
  isEligibleBraveSeparationTarget,
  isCardUseRestricted,
  isAdventRestricted,
  filterRestrictedTimings,
  mergeRegistrationChoiceVariant,
  recordEffectUsageIfLimited,
  resolveDynamicStackNegatePreventionLevel,
} from "../legal/legal-actions-shared";
import {
  getRegisteredMagicActionAllowedZones,
  isConditionalCostBlocked,
} from "../legal/legal-actions-availability";
import { getChoiceStepCondition } from "./structured-effect-registrations";
import { getRequiredCostSourceTribesForCard } from "../legal/required-count-cost-gate";
import { canPayRequiredEffectCosts } from "../legal/required-effect-cost-gate";
import { mergeTargetLockBypassProfiles } from "./target-affect-gate";
import {
  executeBraveCombine,
  rebuildContinuousAndApplyStateBasedActions,
} from "../legal/brave-combine-state-helpers";
import { resolveSeparatedBraveExhaustState } from "../mechanics/brave-spirit-state-recovery";
import { getEnterFieldCorePlacementPolicy } from "../zone/enter-field-placement-policy";
import { queueEnterFieldCorePlacement } from "../zone/enter-field-placement-pending";
import { executeEffectAdvent } from "../mechanics/advent-system";
import { getAdjacentAdventDestination } from "../mechanics/host-dual-advent";
import {
  executeDiscardSetBurst,
  getDiscardableBurstStates,
  getBurstSetBlockReason,
  useSetBurstAsAction,
} from "../mechanics/burst-system";
import { useQuartzSetAsEffect } from "../mechanics/quartz-system";
import { getGroupedSummonCostOverrideCandidateIds } from "../mechanics/grouped-summon-cost-override-choice";
import { collectAndQueueTriggerReactions } from "./trigger-system";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import { hasPreventBraveSeparationRestriction } from "../mechanics/brave-separation-restriction";
import { hasCannotCombineRestriction } from "../mechanics/act-as-spirit";
import {
  useMagicCardInFlashContextAsAction,
  useMagicCardWithoutPayingCostAsAction,
} from "../mechanics/magic-system";
import { openEffectUseResponseWindow } from "../legal/stack-window-openers";
import type {
  ActiveStack,
  AdventData,
  BounceAction,
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  CostOverrideAction,
  DeckRevealAction,
  DiscardHandAction,
  DivineTransformAction,
  DrawModifyAction,
  EffectActivationSourceZone,
  EffectPlayerRef,
  EffectResistanceAction,
  EffectTarget,
  EffectCoreLocation,
  ForceFirstAttackerAction,
  ForcedTargetInclusionAction,
  GameState,
  GateFlashStackCoreAction,
  GateFlashStackHandDiscardAction,
  GrantEffectSourcePreventionImmunityAction,
  HandGainPreventionAction,
  LifeGainReplacementAction,
  LifeGainPreventionAction,
  PendingEffectTargetGroup,
  PostResolutionOracleTrigger,
  CoreMoveDestinationReplacementAction,
  NegateAction,
  PeekDeckAction,
  PendingAttackStepEndBlockedRetry,
  PreventBattleAction,
  PreventBraveSeparationAction,
  PreventNormalCoreMoveAction,
  PreventDeckDiscardAction,
  PreventHandDiscardAction,
  PreventLifeDamageAction,
  NormalCoreContainer,
  RedirectDeckDiscardToExcludeAction,
  RequireAttackExhaustCostAction,
  RequireBattleCostAction,
  RequireBattleDestroyCostAction,
  RequireHandGainCostAction,
  RebirthAction,
  RemoveFromGameAction,
  RestrictAdventAction,
  RestrictBurstActivationAction,
  RestrictCorePlacementAction,
  RestrictSymbolAdditionAction,
  RestrictEndBattleAction,
  RestrictEndStepAction,
  RestrictFieldCostPaymentAction,
  RestrictFlashAction,
  RestrictRecoveryAction,
  RestrictReserveCostPaymentAction,
  RestrictStackAction,
  ReturnFromTrashAction,
  RevealHandAction,
  SearchDeckAction,
  SendToDeckAction,
  ShuffleZoneAction,
  StayOnFieldAction,
  SummonAction,
  SuppressStackSourceAction,
  TimingScope,
  TreatAsAction,
  LifeCoreSelectionContinuation,
  Zone,
} from "../model";
import { queuePendingLeave } from "../state-based-actions";
import { getStepResult, serializeStepContext } from "../step-execution-context";
import type {
  StepExecutionContext,
  StepResult,
} from "../step-execution-context";
import { resolveBpCompareDestroyAffect } from "./effect-affect-adapter";
import { executeReplaceAttackDeclaration } from "./attack-declaration-replacement";
import { getCoreMinimumProtectedByResistance } from "./effect-resistance-check";
import {
  executeBorrowCardEventEffect,
  executeBorrowMagicEffect,
} from "./effect-borrowing";
import { executeEffect } from "./effect-interpreter";
import { runPendingDeckRevealBoundary } from "./deck-reveal-boundary";
import { negateOngoingEffects } from "./ongoing-effect-negation";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
import { executeUnderCardTriggerInherit } from "./native-under-card-trigger-inherit";
import { effectResistanceTagForOutcome } from "./effect-resistance-tags";
import { resolveCountToNumber } from "./native-action-shared";
import {
  resolveHandTrashSearchCandidates,
  resolveHandTrashSwapCandidates,
} from "./zone-search-candidates";
import {
  executeAllowIgnoreSummonCondition,
  executeAllowMidBattleJoin,
  executeAllowSimultaneousAttack,
  executeCountAsMultiple,
  executeFieldNameUniqueness,
  executeForceAttackStepEndAfterFirstBattle,
  executeGrantGameLossImmunity,
  executeGrantDeclaredSummonAltCost,
  executeGrantSummonTrashCorePlacement,
  executeGrantFlashConsecutiveUse,
  executeGrantLinkAidCostOverride,
  executeGrantOptionalDeckRevealCountBoost,
  executeLimitCostReduction,
  executeGrantPaidLeaveSuppressionImmunity,
  executeGrantPaidPreventionImmunity,
  executeOfferMagicPreCostTrigger,
  executeOverrideProperties,
  executeRedirectTarget,
  executeRegisterActAsSpirit,
  executeRegisterExpandEffectTargetCount,
  executeRegisterGrantedEffect,
  executeUnderCardRoleGrant,
  executeRequireBlockIfAble,
  executeRequireMultiBlock,
  executeRegisterRedirectEffectTarget,
  executeExtendFieldSymbolSource,
  executePreventCostReduction,
  executeRestrictDrawToTop,
  executeRestrictManifest,
  executeRestrictUse,
  executeSuppressEffect,
  isRestrictedToTopOnlyDraw,
} from "./native-ce-registration-handlers";
import {
  executeCoreDistribute,
  executeCoreSetToLevel,
  executeCoreMoveSplit,
  executeGrantLifeDamageSourcePreventionImmunity,
  executeLifeDamageInterception,
  executeMoveCard,
  executeSetSelfAsMirage,
  executeSuppressPendingLeaveEffects,
} from "./native-move-core-handlers";
import { isHandGainPreventedByOwnEffect } from "./effect-resistance-check";
import {
  executePlaceStarGarment,
  executeSwapStarGarment,
} from "./native-star-garment-handlers";
import {
  executeBulletEdit,
  executeSwapBulletEdit,
} from "./native-bullet-edit-handlers";
import { executePlaceTextRoleUnderCard } from "./native-under-card-placement-handlers";
import {
  convertTargetSpecToEffectTarget,
  isDynamicBpModifyTargetSpecEligible,
  resolveAmountToNumber,
  resolveCoreLocationForStep,
  resolveSetExhaustStateValue,
} from "./native-target-resolution";
import { markPreSelectedTargetRefsPreserved } from "./preselected-target-ref-context";
import { nextPendingSelectionId } from "./structured-effect-sequences";
import { evaluateCondition } from "./structured-condition-eval";
import { executeCorrelatePendingTrigger } from "./structured-pending-trigger-correlation";
import {
  computeCoreMoveAmountBonus,
  executeAdditionalAttack,
  executeAdditionalCost,
  executeGrantConnectBattle,
  executeAllowBlockWhileExhausted,
  executeAllowAttackWhileExhausted,
  executeAllowTaplessBattleDeclare,
  executeBlockUnblockable,
  executeBounce,
  executeBpModify,
  executeCoreMove,
  executeCoreMoveAmountModifier,
  executeCostOverride,
  executeAdventCostOverride,
  executeCountDecrease,
  executeCountGainModifier,
  executeCountIncrease,
  executeCountSet,
  executeDeckReveal,
  executeDeclareGimmick,
  executeDestroy,
  executeDiscardHand,
  executeDivineTransform,
  executeDraw,
  executeDrawModify,
  executeDurationOverride,
  executeEffectImmunity,
  executeEffectParamModify,
  executeEffectResistance,
  executeEndAttackStep,
  executeEndTurn,
  executeEnterSoulState,
  executeExhaust,
  executeGateFlashStackCore,
  executeGateFlashStackHandDiscard,
  executeGrantExtraSteps,
  executeGrantExtraTurn,
  executeSkipNextTurn,
  executeLifeDamage,
  executeLifeFill,
  executeEndBattle,
  executeNegate,
  executePeekDeck,
  executePreventBattle,
  executePreventBraveSeparation,
  executePreventNormalCoreMove,
  executeRequireAttackExhaustCost,
  executeRequireBattleCost,
  executeRequireBattleDestroyCost,
  executeRequireHandGainCost,
  executeHandGainPrevention,
  executePreventDeckDiscard,
  executeRedirectDeckDiscardToExclude,
  executePreventHandDiscard,
  executePreventLifeDamage,
  executeRebirth,
  executeRecover,
  executePreventNextRecovery,
  executeRemoveFromGame,
  processMovedToTrashEffects,
  executeRestrictAdvent,
  executeRestrictBurstActivation,
  executeRestrictRecovery,
  executeRestrictCorePlacement,
  executeRestrictSymbolAddition,
  executeLifeGainReplacement,
  executeLifeGainPrevention,
  executeCoreMoveDestinationReplacement,
  executeRestrictEndAttackStep,
  executeRestrictEndBattle,
  executeRestrictEndStep,
  executeRestrictEndTurn,
  executeRestrictFieldCostPayment,
  executeGrantEffectSourcePreventionImmunity,
  executeRestrictFlash,
  executeRestrictReserveCostPayment,
  executeRestrictStack,
  executeReturnFromTrash,
  executeRevealHand,
  executeReverseRebirth,
  executeSearchDeck,
  executeSendToDeck,
  executeShuffleZone,
  executeAllRelatedTokensSummon,
  executeRefSummon,
  executeSoulStateSummon,
  executeSplitSummonChoice,
  executeStayOnField,
  executeSummon,
  executeTokenSummon,
  placeCardFromZoneToField,
  executeSuppressStackSource,
  executeForceFirstAttacker,
  executeForcedTargetInclusion,
  executeSymbolAdd,
  executeUnderCardSlotCapacityGrant,
  executeTreatAs,
  executeUnblockable,
  executeVanish,
  resolvePlayerRef,
  toSimpleNormalCoreContainer,
} from "./structured-effect-interpreter";
import { resolveCountBound, resolveTargetSpec } from "./target-resolution";
import { normalizeSummonFromZoneZone } from "./summon-from-zone-candidates";

function getCoreCountSelectionAvailableCores(
  state: GameState,
  actingPlayerId: string,
  fromLoc: EffectCoreLocation,
  fromContainer: NormalCoreContainer,
  toContainer: NormalCoreContainer | null,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile
): number {
  const normalAvailable = getNormalCoreCountAtLocation(state, fromContainer);
  if (fromLoc.kind !== "card_instance" || toContainer === null) {
    return normalAvailable;
  }

  const sourceCard = getCardById(state, fromLoc.instanceId);
  if (!sourceCard) return normalAvailable;

  const soulOwnerId = sourceCard?.ownerPlayerId;
  const soulOwner = soulOwnerId
    ? state.players.find((p) => p.id === soulOwnerId)
    : undefined;
  const soulOnSource =
    soulOwner?.soulCoreLocation?.kind === "card" &&
    soulOwner.soulCoreLocation.instanceId === fromLoc.instanceId;
  const destinationOwnerId =
    toContainer.kind === "card"
      ? getCardById(state, toContainer.instanceId)?.ownerPlayerId
      : toContainer.kind === "void"
        ? undefined
        : toContainer.playerId;
  const sameCardDestination =
    toContainer.kind === "card" &&
    toContainer.instanceId === fromLoc.instanceId;
  const canMoveSoul =
    soulOwnerId !== undefined &&
    soulOnSource &&
    toContainer.kind !== "void" &&
    soulOwnerId === destinationOwnerId &&
    !sameCardDestination;

  const totalCoresOnSource = normalAvailable + (soulOnSource ? 1 : 0);
  const protectedMinRemaining = getCoreMinimumProtectedByResistance(
    state,
    sourceCard,
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel ?? "none",
    sourcePreventionBypass
  );
  const maxMovableTotal = Math.max(
    0,
    totalCoresOnSource - protectedMinRemaining
  );
  return Math.min(normalAvailable + (canMoveSoul ? 1 : 0), maxMovableTotal);
}

function coreMoveTargetSelectsFieldCardDestination(
  action: Extract<Action, { kind: "core_move" }>
): boolean {
  if (action.target === undefined || action.to?.kind !== "field_card") {
    return false;
  }
  switch (action.from.kind) {
    case "reserve":
    case "trash":
    case "life":
    case "void":
      return true;
    default:
      return false;
  }
}

function resolveCoreMoveToLocationForStep(
  action: Extract<Action, { kind: "core_move" }>,
  state: GameState,
  actingPlayerId: string,
  stepCtx: StepExecutionContext,
  resolvedTargetIds: string[] | undefined
): EffectCoreLocation {
  if (
    action.toTargetController !== undefined &&
    resolvedTargetIds?.[0] !== undefined
  ) {
    return resolveTargetControllerCoreLocation(
      state,
      actingPlayerId,
      resolvedTargetIds[0],
      action.toTargetController.kind
    );
  }
  if (action.to === undefined) {
    throw new Error("core_move requires to or toTargetController");
  }
  return resolveCoreLocationForStep(action.to, stepCtx, resolvedTargetIds);
}

function resolveTargetControllerCoreLocation(
  state: GameState,
  actingPlayerId: string,
  targetInstanceId: string,
  kind: "reserve" | "trash" | "life" | "void"
): EffectCoreLocation {
  const target = state.cardInstances.find(
    (card) => card.instanceId === targetInstanceId
  );
  const player: EffectPlayerRef =
    target?.controllerPlayerId === actingPlayerId ? "self" : "opponent";
  return { kind, player };
}

function resolveCoreMoveToLocationForTarget(
  action: Extract<Action, { kind: "core_move" }>,
  state: GameState,
  actingPlayerId: string,
  stepCtx: StepExecutionContext,
  resolvedTargetIds: string[],
  targetIndex: number
): EffectCoreLocation {
  const targetId = resolvedTargetIds[targetIndex];
  if (action.toTargetController !== undefined && targetId !== undefined) {
    return resolveTargetControllerCoreLocation(
      state,
      actingPlayerId,
      targetId,
      action.toTargetController.kind
    );
  }
  if (action.to === undefined) {
    throw new Error("core_move requires to or toTargetController");
  }
  return resolveCoreLocationForStep(
    action.to,
    stepCtx,
    resolvedTargetIds,
    targetIndex
  );
}

function resolveDefinitionEffectForContinuation(
  def: CardDefinition | undefined,
  effectIndex: number,
  divineSkillIndex: number | undefined,
  isAccelData: boolean | undefined,
  isChangeData: boolean | undefined
): Effect | undefined {
  if (divineSkillIndex !== undefined) {
    return def?.grandwalkerData?.divineSkills?.[divineSkillIndex]?.effects?.[
      effectIndex
    ];
  }
  if (isAccelData === true) {
    return def?.accelData?.effects?.[effectIndex];
  }
  if (isChangeData === true) {
    return def?.changeData?.effects?.[effectIndex];
  }
  return def?.effects?.[effectIndex];
}

function buildMultiTargetCoreMoveContinuation(args: {
  ctx: NativeActionContext & { action: Extract<Action, { kind: "core_move" }> };
  processedTargetIds: readonly string[];
  movedAmount: number;
}): LifeCoreSelectionContinuation | undefined {
  const { ctx, processedTargetIds, movedAmount } = args;
  const { sourceInstanceId, actingPlayerId, stepCtx } = ctx;
  const { provenance, effectSourceDefinitionId, effectSourceInstanceId } =
    ctx.effectMeta;
  const { continuationMeta } = ctx;
  const effectIndex = provenance?.effectIndex;
  const stepIndex = provenance?.stepIndex;
  if (effectIndex === undefined || stepIndex === undefined || !ctx.step) {
    return undefined;
  }
  const pending = ctx.state.pendingLifeCoreSelection;
  const sourceDefinitionId =
    effectSourceDefinitionId ??
    pending?.effectSourceDefinitionId ??
    pending?.sourceDefinitionId ??
    ctx.state.cardInstances.find((card) => card.instanceId === sourceInstanceId)
      ?.definitionId;
  if (!sourceDefinitionId) return undefined;

  const definitionEffect = resolveDefinitionEffectForContinuation(
    ctx.getCardDefinitionById(sourceDefinitionId),
    effectIndex,
    continuationMeta.divineSkillIndex,
    continuationMeta.isAccelData,
    continuationMeta.isChangeData
  );
  const uniqueProcessed = [...new Set(processedTargetIds)];
  const processedSet = new Set(uniqueProcessed);
  const remainingTargetIds = (ctx.resolvedTargetIds ?? []).filter(
    (id) => !processedSet.has(id)
  );
  const hasRemainingTargets = remainingTargetIds.length > 0;
  const partialStepResult: StepResult = {
    stepId: ctx.step.id ?? `__step_${stepIndex}`,
    affectedCardInstanceIds: uniqueProcessed,
    succeeded: uniqueProcessed.length > 0,
    executed: true,
    ...(movedAmount > 0 ? { numericAmount: movedAmount } : {}),
  };

  return {
    sourceDefinitionId,
    effectIndex,
    chainId: requireTriggerChainId(continuationMeta.chainId),
    ...(continuationMeta.divineSkillIndex !== undefined
      ? { divineSkillIndex: continuationMeta.divineSkillIndex }
      : {}),
    ...(continuationMeta.isAccelData !== undefined
      ? { isAccelData: continuationMeta.isAccelData }
      : {}),
    ...(continuationMeta.isChangeData !== undefined
      ? { isChangeData: continuationMeta.isChangeData }
      : {}),
    sourceInstanceId,
    ...(definitionEffect !== ctx.effect
      ? { resumeEffectOverride: ctx.effect }
      : {}),
    ...(effectSourceInstanceId !== undefined ? { effectSourceInstanceId } : {}),
    ...(effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId }
      : {}),
    actingPlayerId,
    ...(continuationMeta.resolvedCoreMoveAmounts
      ? { resolvedCoreMoveAmounts: continuationMeta.resolvedCoreMoveAmounts }
      : {}),
    resumeStepIndex: hasRemainingTargets ? stepIndex : stepIndex + 1,
    stepContext: serializeStepContext(stepCtx),
    initialStepResults: [partialStepResult],
    resumePreviousStepPreState: ctx.state,
    ...(hasRemainingTargets
      ? {
          targetInstanceIds: remainingTargetIds,
          targetStepId: ctx.step.id ?? `__step_${stepIndex}`,
          targetSelectionResolved: true,
        }
      : {}),
    ...(ctx.choiceIndex !== undefined ? { choiceIndex: ctx.choiceIndex } : {}),
    ...(ctx.effectMeta.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: ctx.effectMeta.sourcePreventionLevel }
      : {}),
    ...(ctx.effectMeta.sourceTargetLockBypass !== undefined
      ? { sourceTargetLockBypass: ctx.effectMeta.sourceTargetLockBypass }
      : {}),
    ...(ctx.effectMeta.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: ctx.effectMeta.sourcePreventionBypass }
      : {}),
    ...(continuationMeta.triggerFromZone !== undefined
      ? { triggerFromZone: continuationMeta.triggerFromZone }
      : {}),
    ...(continuationMeta.triggerCause !== undefined
      ? { triggerCause: continuationMeta.triggerCause }
      : {}),
    ...(continuationMeta.triggerRelatedInstanceZone !== undefined
      ? {
          triggerRelatedInstanceZone:
            continuationMeta.triggerRelatedInstanceZone,
        }
      : {}),
    ...(continuationMeta.activationZone !== undefined
      ? { activationZone: continuationMeta.activationZone }
      : {}),
    ...(continuationMeta.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: continuationMeta.costPaidThisEffect }
      : {}),
    ...(continuationMeta.postResolutionOracle !== undefined
      ? { postResolutionOracle: continuationMeta.postResolutionOracle }
      : {}),
    ...(!hasRemainingTargets && continuationMeta.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...continuationMeta.targetInstanceIds] }
      : {}),
    ...(!hasRemainingTargets && continuationMeta.targetStepId !== undefined
      ? { targetStepId: continuationMeta.targetStepId }
      : {}),
    ...(!hasRemainingTargets &&
    continuationMeta.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(continuationMeta.targetGroups !== undefined
      ? { targetGroups: continuationMeta.targetGroups }
      : {}),
    ...(continuationMeta.sequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    ...(ctx.effectMeta.recordedUsage !== undefined
      ? { recordedUsage: ctx.effectMeta.recordedUsage }
      : {}),
    ...(continuationMeta.eventAmount !== undefined
      ? { eventAmount: continuationMeta.eventAmount }
      : {}),
    ...(ctx.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            ctx.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(ctx.pendingEffectPendingId !== undefined
      ? { pendingEffectPendingId: ctx.pendingEffectPendingId }
      : {}),
    ...(ctx.effectMeta.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: ctx.effectMeta.battleEndDeferralAttackId }
      : {}),
    ...(ctx.effectMeta.effectActionKind !== undefined
      ? { effectActionKind: ctx.effectMeta.effectActionKind }
      : {}),
    ...(continuationMeta.rangeAutoResolveStrategy !== undefined
      ? { rangeAutoResolveStrategy: continuationMeta.rangeAutoResolveStrategy }
      : {}),
  };
}

function isLiveAdditionalCostDynamicSupported(
  dynamicAmount: import("../dsl-types").DynamicCount
): boolean {
  const isSupportedSource = (
    source: import("../dsl-types").DynamicCountSource
  ): boolean => {
    switch (source.kind) {
      case "count_value":
      case "cards_in_zone":
      case "declaration_count_this_turn":
        return true;
      case "cores_on":
        return (
          source.location.kind === "reserve" ||
          source.location.kind === "life" ||
          source.location.kind === "trash"
        );
      case "field_bp_total":
      case "cards_from_ref":
      case "cost_from_ref":
      case "symbol_count_from_ref":
      case "selected_targets":
      case "trigger_related_instances":
      case "trigger_related_instances_count":
      case "event_amount":
      case "cost_paid_this_effect":
      case "braves_on_source":
      case "source_effective_cost":
      case "source_effective_bp":
      case "source_effective_level":
      case "step_numeric_amount":
      case "self_under_card_count":
        return false;
    }
  };
  return (
    isSupportedSource(dynamicAmount.source) &&
    (dynamicAmount.subtract === undefined ||
      isSupportedSource(dynamicAmount.subtract))
  );
}

/**
 * DSL Action の native 実行パス。全アクションをここで実行する
 * （P3-15 Phase 1〜15 で V1→Native 移行完了、V1 パスは廃止済み）。
 * 成功時は更新済み GameState、未対応時は null を返す。
 */
// P2-12 phase B: コア移動・支払い配分の plumbing 群 (action 固有・多くは深い呼び出しへ透過)。
interface NativeActionCorePayment {
  coreShootDistribution?: Record<string, number> | undefined;
  coreShootSoulCoreInstanceId?: string | undefined;
  coreDistributionAllocations?: Record<string, number> | undefined;
  coreDistributionSoulCoreAllocations?: Record<string, number> | undefined;
  coreDistributionSoulCoreInstanceId?: string | undefined;
  coreSourceAllocations?: Record<string, number> | undefined;
  coreSourceSoulCoreInstanceId?: string | undefined;
  payCostPaymentSources?:
    | readonly import("../core/payment-system").CardCostPaymentSource[]
    | undefined;
  summonPaymentSources?:
    | readonly import("../core/payment-system").CardCostPaymentSource[]
    | undefined;
  summonEnterFieldCorePlacements?:
    | readonly import("../zone/enter-field-placement-execution").EnterFieldCorePlacement[]
    | undefined;
}

// P2-12 phase B: 効果の来歴・防止レベル等のメタ情報。
interface NativeActionEffectMeta {
  provenance?: NonNullable<ContinuousEffect["provenance"]> | undefined;
  effectSourceInstanceId?: string | undefined;
  effectSourceDefinitionId?: string | undefined;
  sourceCardReferenceInstanceId?: string | undefined;
  pendingStackNegateCandidate?: ActiveStack | null | undefined;
  sourcePreventionLevel?: import("../model").EffectPreventionLevel | undefined;
  sourcePreventionBypass?:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  negatePreventionLevel?: import("../model").EffectPreventionLevel | undefined;
  sourceTargetLockBypass?:
    | import("./target-affect-gate").TargetLockBypassProfile
    | undefined;
  forceSnapshotContinuousTargets: boolean;
  battleEndDeferralAttackId?: string | undefined;
  /**
   * core_move_amount_modifier の自動加算を呼び出し側で制御する。
   * undefined は従来通り自動計算、0 は抑止。主に「2体のコア1個ずつ」
   * のような分配 repeat で、印字効果あたり bonus を1回に保つために使う。
   */
  coreMoveAmountBonusOverride?: number | undefined;
  /**
   * この効果解決を発生させた種別 (magic/burst_activation/triggered_effect 等)。
   * SummonAction.summonCause 導出元 (BSTH02-C02、engine-summon-cause-conditional-cost-tax)。
   */
  effectActionKind?: import("../model").EffectResolutionActionKind | undefined;
  /** `end_turn` の遅延 finalization 時に必要な usage 払い戻し情報。 */
  recordedUsage?: import("../model").RecordedEffectUsage | undefined;
  /** `end_attack_step` の遅延 finalization が相手効果でブロックされた場合の retry 継続。 */
  endAttackStepBlockedRetry?: PendingAttackStepEndBlockedRetry | undefined;
}

interface NativeActionContinuationMeta {
  summonPreCostCombineHostInstanceId?: string | undefined;
  resolvedCoreMoveAmounts?:
    | import("../model").ResolvedCoreMoveAmounts
    | undefined;
  chainId: string;
  divineSkillIndex?: number | undefined;
  isAccelData?: boolean | undefined;
  isChangeData?: boolean | undefined;
  triggerFromZone?: Zone | undefined;
  triggerCause?: import("../model").TriggerEventCause | undefined;
  triggerRelatedInstanceZone?: Zone | undefined;
  activationZone?: EffectActivationSourceZone | undefined;
  costPaidThisEffect?: number | undefined;
  postResolutionOracle?: PostResolutionOracleTrigger | undefined;
  targetInstanceIds?: readonly string[] | undefined;
  targetStepId?: string | undefined;
  targetSelectionResolved?: boolean | undefined;
  targetGroups?: readonly PendingEffectTargetGroup[] | undefined;
  sequentialTargetConsumption?: boolean | undefined;
  eventAmount?: number | undefined;
  rangeAutoResolveStrategy?: "min" | "max" | undefined;
}

function getBattleEndPendingLeaveChainId(
  meta: Pick<NativeActionEffectMeta, "battleEndDeferralAttackId">
): string | undefined {
  return meta.battleEndDeferralAttackId === undefined
    ? undefined
    : getBattleEndDeferralChainId(meta.battleEndDeferralAttackId);
}

// P2-12 phase A 根治: executeNativeAction の引数を束ねる context (phase B で意味的にグループ化)。
// handler は先頭で必要 field を `const { … } = ctx[.group]` 分解 → 本体は switch ケースと verbatim。
interface NativeActionContext {
  // 中核（常時参照）
  action: Action;
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepCtx: StepExecutionContext;
  effect: Effect;
  // 対象/ステップ解決
  resolvedTargetIds?: string[] | undefined;
  preservePreSelectedTargetRefs?: boolean | undefined;
  step?: import("../dsl-types").EffectStep | undefined;
  choiceIndex?: number | undefined;
  // その他
  pendingEffectSimultaneousGroupId?: string | undefined;
  /** P3-129: 解決中の pending triggered effect 自身の pendingId。correlate_pending_trigger 用。 */
  pendingEffectPendingId?: string | undefined;
  getRegisteredTriggeredEffectActions?:
    | import("./trigger-system").TriggeredEffectActionRegistrationLookup
    | undefined;
  getRegisteredBurstActions?:
    | import("./trigger-system").BurstActionRegistrationLookup
    | undefined;
  /**
   * ENGINE-conditional-free-magic-use-target-selection: use_magic_without_cost が
   * 対象選択を要する場合に本物の pendingEffectTargetSelection を生成するための窓口。
   */
  resolveDeferredStackForFreeMagicUse?:
    | ((state: GameState, stack: import("../model").ActiveStack) => GameState)
    | undefined;
  /**
   * ENGINE-free-magic-use-target-selection-nonfield-candidate-zones:
   * use_magic_without_cost が synthetic ActiveStack の candidateTargetZones を
   * 発揮効果の登録情報から引き継ぐための窓口。
   */
  getRegisteredMagicActions?:
    | import("../legal/legal-actions-types").MagicActionRegistrationLookup
    | undefined;
  // グループ化された plumbing / メタ
  corePayment: NativeActionCorePayment;
  effectMeta: NativeActionEffectMeta;
  continuationMeta: NativeActionContinuationMeta;
}

function queueInlineEffectSummonEnterFieldTriggers(
  ctx: NativeActionContext,
  beforeState: GameState,
  afterState: GameState,
  sourceEffectIndex?: number
): GameState {
  if (
    beforeState.pendingMultiPlacement === null &&
    afterState.pendingMultiPlacement !== null
  ) {
    return afterState;
  }
  if (
    beforeState.pendingEffectSummonCostPayment === null &&
    afterState.pendingEffectSummonCostPayment !== null
  ) {
    return afterState;
  }
  return collectAndQueueTriggerReactions({
    beforeState,
    afterState,
    source: "action_resolution",
    chainId: ctx.continuationMeta.chainId ?? null,
    attackId: beforeState.activeAttack?.attackId ?? null,
    getCardDefinitionById: ctx.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      ctx.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: ctx.getRegisteredBurstActions,
    causedByPlayerId: ctx.actingPlayerId,
    causedBySourceInstanceId: ctx.sourceInstanceId,
    enterFieldCausedByPlayerId: ctx.actingPlayerId,
    ...(sourceEffectIndex !== undefined ? { sourceEffectIndex } : {}),
  });
}

type NativeActionHandler<K extends Action["kind"]> = (
  ctx: NativeActionContext & { action: Extract<Action, { kind: K }> }
) => GameState | null;

// 移行中は optional マップ型 (未移行 kind は legacy switch へ fallback)。
// 全 kind 移行後に `?` を外すと網羅性がコンパイル時強制される (根治の核)。
type NativeActionHandlerMap = {
  [K in Action["kind"]]: NativeActionHandler<K>;
};

function findTargetRebirthPostChoice(
  definition: CardDefinition | undefined
): RebirthAction["postRebirthChoice"] | undefined {
  for (const effect of definition?.effects ?? []) {
    for (const step of effect.steps) {
      const action = step.action;
      if (action.kind === "rebirth" && action.postRebirthChoice) {
        return action.postRebirthChoice;
      }
    }
  }
  return undefined;
}

const NATIVE_ACTION_HANDLERS: NativeActionHandlerMap = {
  // 自身の現在ゾーンから移動する。場からは共通離場処理、場以外からは基本ゾーン移動。
  move_self: (ctx) => {
    const { action, state, sourceInstanceId, actingPlayerId } = ctx;
    requireCardZone(action.destination);
    const { getCardDefinitionById } = ctx;
    const sourceCard = state.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    );
    if (!sourceCard) {
      return null;
    }
    state.log.push(
      `effect:move_self:${sourceInstanceId}:${action.destination}`
    );
    // 自身の移動も通常の非破壊離場へ合流し、コア・下カード・合体・置換を共通処理する。
    // move_card と同じく、移動先を指定した bounce は破壊/消滅を発生させない。
    if (action.destination !== "field" && sourceCard.zone === "field") {
      return queuePendingLeave({
        state,
        instanceId: sourceInstanceId,
        kind:
          action.destination === "removed_from_game"
            ? "remove_from_game"
            : "bounce",
        cause: "effect_resolution",
        chainId: `effect:move_self:${sourceInstanceId}:${action.destination}`,
        causePlayerId: actingPlayerId,
        deferZoneMoveUntilChainEnd: false,
        leaveDestination: { zone: action.destination },
        causedByEffectSourceInstanceId: sourceInstanceId,
      });
    }
    const sourceDefinition = getCardDefinitionById(sourceCard.definitionId);
    if (action.destination === "field") {
      return putCardOnField(
        state,
        sourceInstanceId,
        getCardDefinitionById,
        actingPlayerId
      );
    }
    return moveCardZone(
      state,
      sourceInstanceId,
      action.destination,
      sourceDefinition
        ? getDefaultZoneRoleName(sourceDefinition, action.destination)
        : sourceCard.zoneRoleName
    );
  },
  noop: (ctx) => {
    const { action, state, sourceInstanceId, resolvedTargetIds } = ctx;
    // ENGINE-brave-combine-third-party-target: target 指定時（選択専用 step）は、対象が
    // 実際に解決できたときだけ log を残す。無条件 push だと後続 step が
    // `{kind:"ref_executed"}` で「対象を選べたか」を判定しようとしたとき、対象0件でも
    // 常に true になってしまう（safe な判定手段は ref_count のみ、というアドホックな
    // 制約を避けるため、noop 自体の executed/succeeded を対象解決結果と一致させる）。
    if (action.target !== undefined && (resolvedTargetIds ?? []).length === 0) {
      return state;
    }
    return {
      ...state,
      log: [...state.log, `effect:noop:${sourceInstanceId}`],
    };
  },
  draw: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      getCardDefinitionById,
      stepCtx,
      sourceInstanceId,
    } = ctx;
    // ドローするプレイヤー（player:"opponent" で相手にドローさせる）。
    const drawPlayerId = resolvePlayerRef(
      actingPlayerId,
      action.player ?? "self",
      state
    );
    // 完全禁止は可変枚数の選択より先に判定する。ここで pending を立てると、後続の
    // 再開時に「ドローを発揮した」履歴だけが残り、Q29310 の「ドローだけの効果は
    // 発揮していない」扱いに反する。
    if (isHandGainPreventedByOwnEffect(state, drawPlayerId, actingPlayerId)) {
      return {
        ...state,
        log: [
          ...state.log,
          `effect:draw:blocked-by-hand-gain-prevention:${drawPlayerId}`,
        ],
      };
    }
    const pending = queueActionCountSelection(ctx);
    if (pending) return pending;
    let drawCount: number;
    if (action.targetHandSize !== undefined) {
      // 「手札が N 枚になるまでドローする」: count を無視し、不足分だけ引く。
      // 既に N 枚以上なら 0 枚。executeDraw が count<=0 で no-op になる。
      const handCount =
        state.players.find((p) => p.id === drawPlayerId)?.handCount ?? 0;
      drawCount = Math.max(0, action.targetHandSize - handCount);
    } else {
      drawCount = resolveCountToNumber(
        action.count,
        state,
        drawPlayerId,
        stepCtx,
        getCardDefinitionById
      );
    }
    // 発揮元カードが mirage ゾーン滞在中 (【セット中】) なら「ミラージュ効果でドロー」履歴に記録
    // (mirage_draw_occurred ConditionClause の SSOT、BSGE01-C03/C10)。
    const sourceCard = getCardById(state, sourceInstanceId);
    const mirageSetSourceInstanceId =
      sourceCard?.zone === "mirage" ? sourceInstanceId : undefined;
    // restrict_draw_to_top CE (BSTH09-C05):「デッキの上からしかドロー/オープンできない」
    // 自己制約が有効なら bottom 指定を強制的に top へ上書きする。
    const drawPosition = isRestrictedToTopOnlyDraw(state, drawPlayerId)
      ? "top"
      : action.position;
    const hasCards = state.cardInstances.some(
      (card) => card.ownerPlayerId === drawPlayerId && card.zone === "deck"
    );
    const gate =
      drawCount > 0 && hasCards
        ? resolveZoneMoveHandGainCost(
            state,
            { actingPlayerId, sourceInstanceId },
            drawPlayerId,
            [{ zone: "deck" }],
            "hand",
            getCardDefinitionById,
            { ...ctx.corePayment, effectTiming: ctx.effect.timing }
          )
        : { state, canGain: true };
    if (!gate.canGain) return gate.state;
    const effectSourceIdentity = resolveAffectSourceIdentity({
      state: gate.state,
      sourceInstanceId,
      effectSourceInstanceId: ctx.effectMeta.effectSourceInstanceId,
      effectSourceDefinitionId: ctx.effectMeta.effectSourceDefinitionId,
      getCardDefinitionById,
    });
    return executeDraw(gate.state, drawPlayerId, drawCount, drawPosition, {
      mirageSetSourceInstanceId,
      getCardDefinitionById,
      effectControllerPlayerId: actingPlayerId,
      effectSource: {
        instance: effectSourceIdentity.instance,
        definition: effectSourceIdentity.definition,
        effectIndex: ctx.effectMeta.provenance?.effectIndex,
        targetStepId:
          ctx.step?.id ??
          (ctx.effectMeta.provenance?.stepIndex !== undefined
            ? `__step_${ctx.effectMeta.provenance.stepIndex}`
            : undefined),
        effectActivationTiming: stepCtx.effectActivationTiming,
      },
      sourcePreventionLevel: ctx.effectMeta.sourcePreventionLevel,
      sourcePreventionBypass: ctx.effectMeta.sourcePreventionBypass,
    });
  },
  life_damage: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
    } = ctx;
    const effectSourceIdentity = resolveAffectSourceIdentity({
      state,
      sourceInstanceId,
      ...(ctx.effectMeta.effectSourceInstanceId !== undefined
        ? { effectSourceInstanceId: ctx.effectMeta.effectSourceInstanceId }
        : {}),
      ...(ctx.effectMeta.effectSourceDefinitionId !== undefined
        ? { effectSourceDefinitionId: ctx.effectMeta.effectSourceDefinitionId }
        : {}),
      getCardDefinitionById,
    });
    const amount = resolveAmountToNumber(
      action.amount,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    return executeLifeDamage(
      state,
      actingPlayerId,
      {
        kind: "life_damage",
        player: action.player as EffectPlayerRef,
        amount,
      },
      getCardDefinitionById,
      effectSourceIdentity.instanceId,
      effectSourceIdentity.definitionId,
      ctx.effectMeta.battleEndDeferralAttackId
    );
  },
  life_fill: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId } = ctx;
    return executeLifeFill(
      state,
      actingPlayerId,
      {
        kind: "life_fill",
        player: action.player as EffectPlayerRef,
        targetValue: action.targetValue,
      },
      sourceInstanceId,
      /*skipLifeGainReplacementChoice=*/ undefined,
      ctx.effectMeta.battleEndDeferralAttackId
    );
  },
  declare_gimmick: (ctx) => {
    const { action, state, actingPlayerId } = ctx;
    return executeDeclareGimmick(
      state,
      actingPlayerId,
      action.player as EffectPlayerRef
    );
  },
  correlate_pending_trigger: (ctx) => {
    const { action, state, sourceInstanceId, pendingEffectPendingId } = ctx;
    return executeCorrelatePendingTrigger(
      state,
      sourceInstanceId,
      action.key,
      pendingEffectPendingId
    );
  },
  count_increase: (ctx) => {
    const { action, state, actingPlayerId, getCardDefinitionById, stepCtx } =
      ctx;
    const amount = resolveAmountToNumber(
      action.amount,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    return executeCountIncrease(
      state,
      actingPlayerId,
      action.player as EffectPlayerRef,
      amount,
      (action as { protectedFromNonTribe?: string }).protectedFromNonTribe
    );
  },
  count_gain_modifier: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeCountGainModifier(
      state,
      actingPlayerId,
      action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  core_move_amount_modifier: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeCoreMoveAmountModifier(
      state,
      actingPlayerId,
      action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  count_decrease: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect,
    } = ctx;
    const effectSourceInstanceId =
      ctx.effectMeta.effectSourceInstanceId ??
      ctx.effectMeta.provenance?.effectSourceInstanceId ??
      sourceInstanceId;
    const effectSourceDefinitionId =
      ctx.effectMeta.effectSourceDefinitionId ??
      ctx.effectMeta.provenance?.effectSourceDefinitionId;
    const effectSourceCard =
      getCardById(state, effectSourceInstanceId) ??
      getCardById(state, sourceInstanceId);
    const effectSourceDefinition = getCardDefinitionById(
      effectSourceDefinitionId ?? effectSourceCard?.definitionId ?? ""
    );
    const sourceTribes = getEffectiveTribes(
      state,
      effectSourceCard,
      effectSourceDefinition,
      getCardDefinitionById
    );
    const playerRef = action.player as EffectPlayerRef;
    // ENGINE-cost-modify-additional-cost-value-dynamic-amount Step2: amount が {min,max}
    // (「好きなだけ減らせる」型) のとき、プレイヤーに減らす数 (min〜max) を選ばせる
    // pendingCountSelection を生成する。PendingCoreCountSelection と同型パターン。
    if (
      typeof action.amount === "object" &&
      action.amount !== null &&
      "min" in action.amount
    ) {
      const targetPlayerId = resolvePlayerRef(actingPlayerId, playerRef, state);
      const player = state.players.find((p) => p.id === targetPlayerId);
      const immune = immuneProtectedCount(
        player?.protectedCounts,
        sourceTribes
      );
      const reducible = Math.max(0, (player?.countValue ?? 0) - immune);
      const resolvedMin = resolveCountBound(
        action.amount.min,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
      const resolvedMax =
        action.amount.max === undefined
          ? reducible
          : resolveCountBound(
              action.amount.max,
              state,
              actingPlayerId,
              stepCtx,
              getCardDefinitionById
            );
      const effectiveMax = Math.min(resolvedMax, reducible);
      const effectiveMin = Math.min(resolvedMin, effectiveMax);
      if (effectiveMax <= effectiveMin) {
        if (effectiveMin <= 0) {
          state.log.push(`effect:count_decrease:noop:reducible=${reducible}`);
          return state;
        }
        return executeCountDecrease(
          state,
          actingPlayerId,
          playerRef,
          effectiveMin,
          sourceTribes
        );
      }
      const sourceCard = getCardById(state, sourceInstanceId);
      state.log.push(
        `effect:count_selection:pending:${effectiveMin}-${effectiveMax}:${targetPlayerId}`
      );
      return {
        ...state,
        pendingCountSelection: {
          pendingId: `cnts-${countSelectionPendingSequence++}`,
          actingPlayerId,
          sourceInstanceId,
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          targetPlayerId,
          playerRef,
          sourceTribes,
          min: effectiveMin,
          max: effectiveMax,
          effectTiming: effect.timing,
          priorStateSnapshot: state,
          ...(ctx.effectMeta.battleEndDeferralAttackId !== undefined
            ? {
                battleEndDeferralAttackId:
                  ctx.effectMeta.battleEndDeferralAttackId,
              }
            : {}),
        },
      };
    }
    const amount = resolveAmountToNumber(
      action.amount,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    return executeCountDecrease(
      state,
      actingPlayerId,
      playerRef,
      amount,
      sourceTribes
    );
  },
  count_set: (ctx) => {
    const { action, state, actingPlayerId } = ctx;
    return executeCountSet(
      state,
      actingPlayerId,
      action.player as EffectPlayerRef,
      action.value
    );
  },
  end_attack_step: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId } = ctx;
    // R12「受けない」: action.unaffectedByRestriction を妨害判定へ伝搬。
    return executeEndAttackStep(
      state,
      actingPlayerId,
      action.unaffectedByRestriction,
      sourceInstanceId,
      ctx.effectMeta.recordedUsage,
      ctx.effectMeta.endAttackStepBlockedRetry
    );
  },
  end_turn: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId } = ctx;
    return executeEndTurn(
      state,
      actingPlayerId,
      action.unaffectedByRestriction,
      sourceInstanceId,
      ctx.effectMeta.recordedUsage
    );
  },
  end_single_battle: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    } = ctx;
    return executeEndSingleBattle(
      state,
      actingPlayerId,
      action.unaffectedByRestriction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions
    );
  },
  end_battle: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    } = ctx;
    // 終了予約の効果は親効果の差分収集後、共通の解決境界で実行する。
    // ここで同期実行すると親効果への原因の付け替え・二重収集が起きる。
    return executeEndBattle(
      state,
      actingPlayerId,
      action.unaffectedByRestriction,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      undefined,
      true,
      getRegisteredBurstActions
    );
  },
  additional_attack: (ctx) => {
    const { state, actingPlayerId, sourceInstanceId } = ctx;
    return executeAdditionalAttack(state, actingPlayerId, sourceInstanceId);
  },
  designate_attack: (ctx) => {
    const targetId = ctx.resolvedTargetIds?.[0];
    return targetId === undefined
      ? ctx.state
      : designateActiveAttackTarget(
          ctx.state,
          targetId,
          ctx.getCardDefinitionById,
          ctx.sourceInstanceId
        );
  },
  connect_battle: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId } = ctx;
    return executeGrantConnectBattle(
      state,
      actingPlayerId,
      sourceInstanceId,
      action.maxUses
    );
  },
  grant_extra_turn: (ctx) => {
    const { action, state, actingPlayerId } = ctx;
    return executeGrantExtraTurn(state, actingPlayerId, action, ctx);
  },
  grant_extra_steps: (ctx) => {
    const { action, state, actingPlayerId } = ctx;
    return executeGrantExtraSteps(state, actingPlayerId, action);
  },
  skip_next_turn: (ctx) => {
    const { action, state, actingPlayerId } = ctx;
    return executeSkipNextTurn(state, actingPlayerId, action);
  },
  recover: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
    } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    return executeRecover(
      state,
      actingPlayerId,
      target,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId
    );
  },
  prevent_next_recovery: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
    } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    return executePreventNextRecovery(
      state,
      actingPlayerId,
      target,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId
    );
  },
  exhaust: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
    } = ctx.effectMeta;
    // effect_param_override (「疲労効果」のコスト上限+N, BSLH01-M01) 適用のため
    // destroy/vanish/bounce と同じ actionKind 経路を通す。
    const target = convertTargetSpecToEffectTarget(action.target, {
      state,
      sourceInstanceId,
      actionKind: "exhaust",
      getCardDefinitionById,
    });
    const targetState =
      action.degree === "heavy_exhaust"
        ? ("heavily_exhausted" as const)
        : undefined;
    return executeExhaust(
      state,
      actingPlayerId,
      target,
      getCardDefinitionById,
      targetState,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
      action.downgradeAtTurnEnd
    );
  },
  set_exhaust_state: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
    } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const resolvedState = resolveSetExhaustStateValue(action, {
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepContext: stepCtx,
    });
    // matchExhaustStateOf 指定時に参照カードが解決できない (例: バトル外で誤って
    // 呼ばれた) 場合は no-op。resolveSetExhaustStateValue (native-target-resolution.ts)
    // を使う SSOT (P3-105 verifier 指摘対応)。
    if (action.matchExhaustStateOf && resolvedState === undefined) return state;
    const anchor =
      action.placement && action.matchExhaustStateOf
        ? resolveTargetSpec({
            state,
            targetSpec: action.matchExhaustStateOf,
            actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            stepContext: stepCtx,
          })[0]
        : undefined;
    if (action.placement && (!anchor || anchor.zone !== "field")) return state;
    const afterState =
      resolvedState === "recovered"
        ? executeRecover(
            state,
            actingPlayerId,
            target,
            getCardDefinitionById,
            sourceInstanceId,
            resolvedTargetIds,
            sourcePreventionLevel,
            sourceTargetLockBypass,
            sourcePreventionBypass,
            effectSourceInstanceId,
            effectSourceDefinitionId,
            "fully"
          )
        : executeExhaust(
            state,
            actingPlayerId,
            target,
            getCardDefinitionById,
            resolvedState === "heavily_exhausted"
              ? "heavily_exhausted"
              : undefined,
            sourceInstanceId,
            resolvedTargetIds,
            sourcePreventionLevel,
            sourceTargetLockBypass,
            sourcePreventionBypass,
            effectSourceInstanceId,
            effectSourceDefinitionId,
            undefined,
            true
          );
    if (!action.placement || !anchor) return afterState;
    const ids =
      resolvedTargetIds ??
      resolveTargetSpec({
        state,
        targetSpec: action.target,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById,
        stepContext: stepCtx,
      }).map((c) => c.instanceId);
    // 状態変更を防がれた場合は位置だけを動かして対価成立にしない。
    if (
      !ids.length ||
      ids.some(
        (id) => getCardById(afterState, id)?.exhaustState !== resolvedState
      )
    )
      return state;
    return ids.reduce(
      (s, id) =>
        placeFieldCardBeside(s, id, anchor.instanceId, action.placement!),
      afterState
    );
  },
  bp_modify: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect,
      resolvedTargetIds,
    } = ctx;
    const {
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
      forceSnapshotContinuousTargets,
    } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const allowDynamicAllTargets = isDynamicBpModifyTargetSpecEligible(
      action.target
    );
    // amount が DynamicCount（オブジェクト）なら、継続 CE に live 評価される
    // 動的修飾として渡す（「カウント1につき BP+1000」等の比例継続修飾）。
    // amount 数値はログ用の登録時スナップショットとして併渡しする。
    const dynamicAmount =
      typeof action.amount === "object" ? action.amount : undefined;
    const amount = resolveAmountToNumber(
      action.amount,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeBpModify(
      state,
      actingPlayerId,
      {
        target,
        amount,
        duration: action.duration,
        ...(dynamicAmount !== undefined ? { dynamicAmount } : {}),
      },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      forceSnapshotContinuousTargets,
      allowDynamicAllTargets,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId
    );
  },
  symbol_add: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const {
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      battleEndDeferralAttackId,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
    } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    // 配列はデュアルカラーシンボル (1 シンボルが複数色として機能) として 1 CE で登録する。
    // 単色は長さ1の配列に正規化して executeSymbolAdd へ渡す。
    return executeSymbolAdd(
      state,
      actingPlayerId,
      {
        kind: "symbol_add",
        target,
        ...(!ctx.effectMeta.forceSnapshotContinuousTargets &&
        effect.timing.kind === "continuous" &&
        action.duration.scope === "while_on_field" &&
        action.target.kind === "filter" &&
        action.target.count === "all"
          ? { continuousTarget: action.target }
          : {}),
        ...(action.symbol !== undefined ? { symbol: action.symbol } : {}),
        ...(action.symbolSource ? { symbolSource: action.symbolSource } : {}),
        ...(action.count !== undefined ? { count: action.count } : {}),
        ...(action.countEvaluation !== undefined
          ? { countEvaluation: action.countEvaluation }
          : {}),
        duration: action.duration,
      },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      battleEndDeferralAttackId,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId
    );
  },
  under_card_slot_capacity_grant: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeUnderCardSlotCapacityGrant(
      state,
      actingPlayerId,
      {
        kind: "under_card_slot_capacity_grant",
        target,
        hostRoleTag: action.hostRoleTag,
        childRoleTag: action.childRoleTag,
        ...(action.childFilter ? { childFilter: action.childFilter } : {}),
        duration: action.duration,
      },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  under_card_role_grant: (ctx) =>
    executeUnderCardRoleGrant(
      ctx.action,
      ctx.state,
      ctx.actingPlayerId,
      ctx.sourceInstanceId,
      ctx.effect,
      ctx.resolvedTargetIds,
      ctx.effectMeta.provenance
    ),
  enter_soul_state: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const { sourcePreventionLevel, sourceTargetLockBypass } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    return executeEnterSoulState(
      state,
      actingPlayerId,
      { target },
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  place: (ctx) => {
    const {
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
    } = ctx;
    const card = getCardById(state, sourceInstanceId);
    const definition = card
      ? getCardDefinitionById(card.definitionId)
      : undefined;
    if (!card || !definition) return state;
    if (definition.printedCategory !== "nexus") {
      return {
        ...state,
        log: [...state.log, `effect:place:${sourceInstanceId}:not-nexus`],
      };
    }
    const { summonPaymentSources, summonEnterFieldCorePlacements } =
      ctx.corePayment;
    const summonCause: "effect" | "burst" =
      ctx.effectMeta.effectActionKind === "burst_activation"
        ? "burst"
        : "effect";
    const activationZone = ctx.continuationMeta.activationZone;
    const activationZoneAsSummonZone =
      activationZone === "hand" ||
      activationZone === "set_aside" ||
      activationZone === "trash"
        ? activationZone
        : undefined;
    const v1Action: SummonAction = {
      kind: "summon",
      target: "self",
      summonCause,
      withoutCost: true,
      enterFieldEventKind: "place",
      ...(activationZoneAsSummonZone !== undefined
        ? { zone: activationZoneAsSummonZone }
        : {}),
      ...(activationZone === "advent_source"
        ? { includeAdventSource: true }
        : {}),
      ...(activationZone === "soul_state" ? { includeSoulState: true } : {}),
    };
    const placedState = executeSummon(
      state,
      ctx.continuationMeta.chainId,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      getCardDefinitionById,
      summonPaymentSources,
      summonEnterFieldCorePlacements,
      undefined,
      ctx.effectMeta.battleEndDeferralAttackId,
      ctx.effectMeta.provenance?.effectIndex,
      ctx.continuationMeta.activationZone,
      stepCtx.allowPendingPayCostSourceAllocation === true,
      ctx.effect.timing,
      undefined,
      undefined,
      ctx
    );
    return queueInlineEffectSummonEnterFieldTriggers(
      ctx,
      state,
      placedState,
      ctx.effectMeta.provenance?.effectIndex
    );
  },
  quartz_set: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      resolvedTargetIds,
      getCardDefinitionById,
    } = ctx;
    // target:{kind:"self"} は summon(target:self) と同じ理由 (native-action-registry.ts
    // summon ハンドラ参照) で resolvedTargetIds を経由しない: resolveTargetSpec の "self" 分岐は
    // 対象が現に zone==="field" であることを要求するが、quartz_set(self) はカード自身が
    // まだ手札等にある状態から魂状態へ直接遷移する（BSLH01-R05「このカードを…セットする」）。
    const quartzInstanceId =
      action.target.kind === "self" || action.target.kind === "source_card"
        ? sourceInstanceId
        : resolvedTargetIds?.[0];
    if (!quartzInstanceId) return state;
    return useQuartzSetAsEffect({
      state,
      actingPlayerId,
      quartzInstanceId,
      getCardDefinitionById,
      sourceContext: {
        sourceInstanceId,
        effectActionKind: ctx.effectMeta.effectActionKind,
        burstPostResolutionDestination:
          ctx.stepCtx.burstPostResolutionDestination,
      },
      ...(action.free !== undefined ? { free: action.free } : {}),
      ...(action.placement !== undefined
        ? { placement: action.placement }
        : {}),
    }).state;
  },
  effect_immunity: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeEffectImmunity(
      state,
      actingPlayerId,
      {
        target,
        duration: action.duration,
        ...(action.sourceScope ? { sourceScope: action.sourceScope } : {}),
        ...(action.sourcePlayerScope
          ? { sourcePlayerScope: action.sourcePlayerScope }
          : {}),
        ...(effect.applicability?.zone !== undefined
          ? { sourceApplicabilityZone: effect.applicability.zone }
          : {}),
        ...(action.satisfiesPreventionRestriction
          ? {
              satisfiesPreventionRestriction:
                action.satisfiesPreventionRestriction,
            }
          : {}),
      },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  unblockable: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeUnblockable(
      state,
      actingPlayerId,
      {
        target,
        duration: action.duration,
        ...(!ctx.effectMeta.forceSnapshotContinuousTargets &&
        effect.timing.kind === "continuous" &&
        action.duration.scope === "while_on_field" &&
        action.target.kind === "filter" &&
        action.target.count === "all"
          ? { continuousTarget: action.target }
          : {}),
      },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  allow_block_while_exhausted: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeAllowBlockWhileExhausted(
      state,
      actingPlayerId,
      { target, duration: action.duration },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  allow_attack_while_exhausted: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeAllowAttackWhileExhausted(
      state,
      actingPlayerId,
      { target, duration: action.duration },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  allow_tapless_battle_declare: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeAllowTaplessBattleDeclare(
      state,
      actingPlayerId,
      { target, duration: action.duration },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  block_unblockable: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeBlockUnblockable(
      state,
      actingPlayerId,
      { target, duration: action.duration },
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  prevent_battle: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    // DSL restriction は配列 ["attack","block"]、v1 は "attack"|"block"|"both"
    let restriction: "attack" | "block" | "both";
    if (action.restriction.length >= 2) restriction = "both";
    else restriction = action.restriction[0] ?? "both";
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: PreventBattleAction = {
      kind: "prevent_battle",
      target,
      restriction,
      duration: action.duration,
      ...(action.ruleStrength ? { ruleStrength: true } : {}),
    };
    return executePreventBattle(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  prevent_brave_separation: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: PreventBraveSeparationAction = {
      kind: "prevent_brave_separation",
      target,
      duration: action.duration,
    };
    return executePreventBraveSeparation(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  prevent_normal_core_move: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: PreventNormalCoreMoveAction = {
      kind: "prevent_normal_core_move",
      target,
      duration: action.duration,
    };
    return executePreventNormalCoreMove(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      tScope,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
  require_battle_cost: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      resolvedTargetIds,
    } = ctx;
    const fixedTargetIds = resolvedTargetIds ?? [];
    const { provenance } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    // DSL restriction は配列 ["attack","block"]、v1 は "attack"|"block"|"both"
    // (prevent_battle と同じ正規化。native-action-registry.ts:876-879 参照)
    let restriction: "attack" | "block" | "both";
    if (action.restriction.length >= 2) restriction = "both";
    else restriction = action.restriction[0] ?? "both";
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RequireBattleCostAction = {
      kind: "require_battle_cost",
      target,
      restriction,
      costAmount: action.costAmount,
      duration: action.duration,
      ...(action.firstAttackOnly ? { firstAttackOnly: true } : {}),
      ...(action.target.kind === "ref" && fixedTargetIds.length > 0
        ? { targetInstanceIds: [...fixedTargetIds] }
        : {}),
    };
    return executeRequireBattleCost(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  require_attack_exhaust_cost: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RequireAttackExhaustCostAction = {
      kind: "require_attack_exhaust_cost",
      target,
      costTargetFilter: action.costTargetFilter,
      duration: action.duration,
    };
    return executeRequireAttackExhaustCost(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  require_battle_destroy_cost: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    // DSL restriction は配列 ["attack","block"]、v1 は "attack"|"block"|"both"
    // (require_battle_cost と同じ正規化。native-action-registry.ts:1536-1540 参照)
    let restriction: "attack" | "block" | "both";
    if (action.restriction.length >= 2) restriction = "both";
    else restriction = action.restriction[0] ?? "both";
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RequireBattleDestroyCostAction = {
      kind: "require_battle_destroy_cost",
      ...(action.destination ? { destination: action.destination } : {}),
      target,
      restriction,
      costTargetFilter: action.costTargetFilter,
      duration: action.duration,
    };
    return executeRequireBattleDestroyCost(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  prevent_life_damage: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: PreventLifeDamageAction = {
      kind: "prevent_life_damage",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executePreventLifeDamage(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      provenance
    );
  },
  require_hand_gain_cost: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RequireHandGainCostAction = {
      kind: "require_hand_gain_cost",
      player: action.player as EffectPlayerRef,
      costAmount: action.costAmount,
      duration: action.duration,
    };
    return executeRequireHandGainCost(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  hand_gain_prevention: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: HandGainPreventionAction = {
      kind: "hand_gain_prevention",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executeHandGainPrevention(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  effect_resistance: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourceTargetLockBypass } =
      ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    // resistsOutcome は単一値 / 配列両対応。配列の場合は outcome ごとに 1 CE を登録する。
    // 例: ["destroy", "bounce"] → cannot_be_destroyed CE と cannot_be_bounced CE の 2 件。
    const outcomes: (ResistableOutcome | undefined)[] = Array.isArray(
      action.resistsOutcome
    )
      ? action.resistsOutcome.length > 0
        ? action.resistsOutcome
        : [undefined]
      : [action.resistsOutcome];
    const tScope: TimingScope | undefined = effect.timingScope;
    // 置換効果: replacement 指定時は resistsOutcome をトリガー条件として保存する
    // （現在は move_to 系 = 手札 / デッキ下 のみ。疲労残置は stay_on_field に移行済み）
    // replacement の場合は配列を許可しない（最初の outcome のみ trigger とする）。
    const triggerMap: Record<
      string,
      "leave_field" | "destroy" | "bounce" | "vanish"
    > = {
      leave_field: "leave_field",
      destroy: "destroy",
      bounce: "bounce",
      vanish: "vanish",
    };
    let current = state;
    for (const outcome of outcomes) {
      let v1Action: EffectResistanceAction;
      if (action.replacement) {
        const replacementTrigger =
          triggerMap[outcome ?? "leave_field"] ?? "leave_field";
        // FieldExitReplacement は move_to (手札/デッキ下)・pay_cost (コスト支払い残留)・
        // advent_source (煌臨元追加)・soul_state (魂状態化) の判別共用体。kind ごとに
        // v1 replacementAction へそのまま写す。
        const replacementAction =
          action.replacement.kind === "advent_source"
            ? {
                kind: "advent_source" as const,
                target: action.replacement.target,
                orTrash: action.replacement.orTrash,
              }
            : action.replacement.kind === "soul_state"
              ? { kind: "soul_state" as const }
              : action.replacement.kind === "pay_cost"
                ? {
                    kind: "pay_cost" as const,
                    amount: action.replacement.amount,
                  }
                : {
                    kind: "move_to" as const,
                    zone: action.replacement.zone,
                  };
        v1Action = {
          kind: "effect_resistance",
          target,
          resistType: "replace_field_exit",
          source: action.source,
          duration: action.duration,
          replacementTrigger,
          replacementAction,
        };
      } else {
        v1Action = {
          kind: "effect_resistance",
          target,
          resistType: effectResistanceTagForOutcome(outcome),
          source: action.source,
          ...(action.targetLockSourceFilter
            ? { targetLockSourceFilter: action.targetLockSourceFilter }
            : {}),
          duration: action.duration,
          ...(action.coreMinimum !== undefined
            ? { coreMinimum: action.coreMinimum }
            : {}),
          ...(action.coreMinimumSource !== undefined
            ? { coreMinimumSource: action.coreMinimumSource }
            : {}),
          ...(action.entryZone !== undefined
            ? { entryZone: action.entryZone }
            : {}),
          ...(action.excludedCauses
            ? { excludedCauses: action.excludedCauses }
            : {}),
          ...(action.ruleStrength ? { ruleStrength: true } : {}),
        };
      }
      current = executeEffectResistance(
        current,
        actingPlayerId,
        v1Action,
        sourceInstanceId,
        getCardDefinitionById,
        resolvedTargetIds,
        tScope,
        provenance,
        sourcePreventionLevel,
        sourceTargetLockBypass
      );
      // replacement は配列対応しない (最初の outcome のみ trigger に採用)
      if (action.replacement) break;
    }
    return current;
  },
  draw_modify: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    const amount = resolveAmountToNumber(
      action.amount,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: DrawModifyAction = {
      kind: "draw_modify",
      amount,
      duration: action.duration,
    };
    return executeDrawModify(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  effect_param_modify: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeEffectParamModify(
      state,
      actingPlayerId,
      {
        ...action,
        ...(action.addLimitAmount !== undefined
          ? {
              addLimitAmount: resolveAmountToNumber(
                action.addLimitAmount,
                state,
                actingPlayerId,
                ctx.stepCtx,
                ctx.getCardDefinitionById
              ),
            }
          : {}),
      },
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  duration_override: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeDurationOverride(
      state,
      actingPlayerId,
      action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  restrict_flash: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    // DSL source (Zone | Zone[] | undefined) を v1 (Zone | Zone[] | "any") に伝搬。
    // 未指定時は全ゾーン制限として "any" にフォールバック。
    const v1Action: RestrictFlashAction = {
      kind: "restrict_flash",
      player: action.player as EffectPlayerRef,
      source: action.source ?? "any",
      duration: action.duration,
    };
    return executeRestrictFlash(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  restrict_stack: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RestrictStackAction = {
      kind: "restrict_stack",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
      ...(action.targetScope ? { targetScope: action.targetScope } : {}),
      ...(action.effectFilter ? { effectFilter: action.effectFilter } : {}),
      ...(action.sourceCardFilter
        ? { sourceCardFilter: action.sourceCardFilter }
        : {}),
    };
    return executeRestrictStack(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  restrict_burst_activation: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RestrictBurstActivationAction = {
      kind: "restrict_burst_activation",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
      ...(action.cost ? { cost: action.cost } : {}),
    };
    return executeRestrictBurstActivation(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  restrict_advent: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RestrictAdventAction = {
      kind: "restrict_advent",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executeRestrictAdvent(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  restrict_recovery: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined =
      action.timingScope ?? effect.timingScope;
    const v1Action: RestrictRecoveryAction = {
      kind: "restrict_recovery",
      ...(action.restriction ? { restriction: action.restriction } : {}),
      player: action.player as EffectPlayerRef,
      duration: action.duration,
      ...(action.filter ? { filter: action.filter } : {}),
    };
    return executeRestrictRecovery(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance,
      action.target ? (resolvedTargetIds ?? []) : undefined
    );
  },
  restrict_reserve_cost_payment: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RestrictReserveCostPaymentAction = {
      kind: "restrict_reserve_cost_payment",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executeRestrictReserveCostPayment(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  restrict_field_cost_payment: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: RestrictFieldCostPaymentAction = {
      kind: "restrict_field_cost_payment",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
      ...(action.effectModes ? { effectModes: action.effectModes } : {}),
    };
    return executeRestrictFieldCostPayment(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  grant_effect_source_prevention_immunity: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: GrantEffectSourcePreventionImmunityAction = {
      kind: "grant_effect_source_prevention_immunity",
      player: action.player as EffectPlayerRef,
      sourceScope: action.sourceScope,
      ...(action.preventionBypass !== undefined
        ? { preventionBypass: action.preventionBypass }
        : {}),
      ...(action.appliesTo !== undefined
        ? { appliesTo: action.appliesTo }
        : {}),
      ...(action.usageLimit !== undefined
        ? { usageLimit: action.usageLimit }
        : {}),
      duration: action.duration,
    };
    return executeGrantEffectSourcePreventionImmunity(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  suppress_stack_source: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: SuppressStackSourceAction = {
      kind: "suppress_stack_source",
      target: action.target,
      player: action.player as EffectPlayerRef,
      duration: action.duration,
      ...(action.effectFilter ? { effectFilter: action.effectFilter } : {}),
    };
    return executeSuppressStackSource(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance,
      effect.applicability?.zone
    );
  },
  force_first_attacker: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: ForceFirstAttackerAction = {
      kind: "force_first_attacker",
      target: action.target,
    };
    return executeForceFirstAttacker(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  forced_target_inclusion: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: ForcedTargetInclusionAction = {
      kind: "forced_target_inclusion",
      target: action.target,
    };
    return executeForcedTargetInclusion(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  gate_flash_stack_core: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: GateFlashStackCoreAction = {
      kind: "gate_flash_stack_core",
      player: action.player as EffectPlayerRef,
      ...(action.source !== undefined ? { source: action.source } : {}),
      duration: action.duration,
    };
    return executeGateFlashStackCore(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  gate_flash_stack_hand_discard: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: GateFlashStackHandDiscardAction = {
      kind: "gate_flash_stack_hand_discard",
      player: action.player as EffectPlayerRef,
      ...(action.count !== undefined ? { count: action.count } : {}),
      ...(action.targetEffectLabels !== undefined
        ? { targetEffectLabels: action.targetEffectLabels }
        : {}),
      ...(action.sourceActivationZones !== undefined
        ? { sourceActivationZones: action.sourceActivationZones }
        : {}),
      ...((Array.isArray(effect.usageLimit)
        ? effect.usageLimit
        : effect.usageLimit
          ? [effect.usageLimit]
          : []
      ).some((limit) => limit.kind === "no_duplicate")
        ? { noDuplicate: true }
        : {}),
      duration: action.duration,
    };
    return executeGateFlashStackHandDiscard(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  prevent_hand_discard: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const tScope: TimingScope | undefined = effect.timingScope;
    const v1Action: PreventHandDiscardAction = {
      kind: "prevent_hand_discard",
      player: action.player as EffectPlayerRef,
      ...(action.handCountMax !== undefined
        ? { handCountMax: action.handCountMax }
        : {}),
      ...(action.minSourceCores !== undefined
        ? { minSourceCores: action.minSourceCores }
        : {}),
      duration: action.duration,
    };
    return executePreventHandDiscard(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  prevent_deck_discard: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: PreventDeckDiscardAction = {
      kind: "prevent_deck_discard",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executePreventDeckDiscard(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  redirect_deck_discard_to_exclude: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: RedirectDeckDiscardToExcludeAction = {
      kind: "redirect_deck_discard_to_exclude",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executeRedirectDeckDiscardToExclude(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  restrict_core_placement: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: RestrictCorePlacementAction = {
      kind: "restrict_core_placement",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
      ...(action.scope !== undefined ? { scope: action.scope } : {}),
      ...(action.fromZone !== undefined ? { fromZone: action.fromZone } : {}),
      ...(action.sourceTimingScope !== undefined
        ? { sourceTimingScope: action.sourceTimingScope }
        : {}),
      ...(action.sourceFilter !== undefined
        ? { sourceFilter: action.sourceFilter }
        : {}),
    };
    return executeRestrictCorePlacement(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  restrict_symbol_addition: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: RestrictSymbolAdditionAction = {
      kind: "restrict_symbol_addition",
      player: action.player as EffectPlayerRef,
      maxTotal: action.maxTotal,
      duration: action.duration,
      ...(action.sourceFilter !== undefined
        ? { sourceFilter: action.sourceFilter }
        : {}),
    };
    return executeRestrictSymbolAddition(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  life_gain_replacement: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: LifeGainReplacementAction = {
      kind: "life_gain_replacement",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executeLifeGainReplacement(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  life_gain_prevention: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: LifeGainPreventionAction = {
      kind: "life_gain_prevention",
      player: action.player as EffectPlayerRef,
      duration: action.duration,
    };
    return executeLifeGainPrevention(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  core_move_destination_replacement: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const v1Action: CoreMoveDestinationReplacementAction = {
      kind: "core_move_destination_replacement",
      fromOwner: action.fromOwner,
      ...(action.fromZone !== undefined ? { fromZone: action.fromZone } : {}),
      ...(action.matchCausingSourceOnly !== undefined
        ? { matchCausingSourceOnly: action.matchCausingSourceOnly }
        : {}),
      toZone: action.toZone,
      ...(action.matchToZone !== undefined
        ? { matchToZone: action.matchToZone }
        : {}),
      ...(action.optional !== undefined ? { optional: action.optional } : {}),
      duration: action.duration,
    };
    return executeCoreMoveDestinationReplacement(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance
    );
  },
  restrict_end_attack_step: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      getCardDefinitionById,
    } = ctx;
    const { provenance, sourcePreventionLevel } = ctx.effectMeta;
    return executeRestrictEndAttackStep(
      state,
      actingPlayerId,
      {
        kind: "restrict_end_attack_step",
        player: action.player as EffectPlayerRef,
        duration: action.duration,
        ...(action.unpreventableIf
          ? { unpreventableIf: action.unpreventableIf }
          : {}),
      },
      sourceInstanceId,
      getCardDefinitionById,
      effect.timingScope,
      provenance,
      sourcePreventionLevel
    );
  },
  restrict_end_battle: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      getCardDefinitionById,
    } = ctx;
    const { provenance, sourcePreventionLevel } = ctx.effectMeta;
    return executeRestrictEndBattle(
      state,
      actingPlayerId,
      {
        kind: "restrict_end_battle",
        player: action.player as EffectPlayerRef,
        duration: action.duration,
        ...(action.unpreventableIf
          ? { unpreventableIf: action.unpreventableIf }
          : {}),
      } as RestrictEndBattleAction,
      sourceInstanceId,
      getCardDefinitionById,
      effect.timingScope,
      provenance,
      sourcePreventionLevel
    );
  },
  restrict_end_step: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      getCardDefinitionById,
    } = ctx;
    const { provenance, sourcePreventionLevel } = ctx.effectMeta;
    return executeRestrictEndStep(
      state,
      actingPlayerId,
      {
        kind: "restrict_end_step",
        player: action.player as EffectPlayerRef,
        duration: action.duration,
        ...(action.unpreventableIf
          ? { unpreventableIf: action.unpreventableIf }
          : {}),
      } as RestrictEndStepAction,
      sourceInstanceId,
      getCardDefinitionById,
      effect.timingScope,
      provenance,
      sourcePreventionLevel
    );
  },
  restrict_end_turn: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      getCardDefinitionById,
    } = ctx;
    const { provenance, sourcePreventionLevel } = ctx.effectMeta;
    return executeRestrictEndTurn(
      state,
      actingPlayerId,
      {
        kind: "restrict_end_turn",
        player: action.player as EffectPlayerRef,
        duration: action.duration,
        ...(action.unpreventableIf
          ? { unpreventableIf: action.unpreventableIf }
          : {}),
      },
      sourceInstanceId,
      getCardDefinitionById,
      effect.timingScope,
      provenance,
      sourcePreventionLevel
    );
  },
  negate_ongoing_effects: (ctx) =>
    negateOngoingEffects({
      ...ctx,
      sourcePreventionLevel: ctx.effectMeta.sourcePreventionLevel,
    }),
  negate: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    // DSL negateTarget "summon"|"place"|"use"|"effect" を v1 の同型にそのまま渡す
    // (v1 側の "use_magic" との差は旧 V1 変換でも未変換だったため挙動維持)
    const v1Action: NegateAction = {
      kind: "negate",
      ...(action.causedByThisEffect ? { causedByThisEffect: true } : {}),
      negateTarget: (action.negateTarget === "use"
        ? "use_magic"
        : action.negateTarget) as NegateAction["negateTarget"],
      ...(action.targetFilter ? { targetFilter: action.targetFilter } : {}),
      ...(action.targetController
        ? { targetController: action.targetController }
        : {}),
      ...(action.targetEffectTiming
        ? { targetEffectTiming: action.targetEffectTiming }
        : {}),
      ...(action.targetEffectFilter
        ? { targetEffectFilter: action.targetEffectFilter }
        : {}),
      ...(action.suppressMatchedEffect !== undefined
        ? { suppressMatchedEffect: action.suppressMatchedEffect }
        : {}),
      ...(action.burstSuppressKind
        ? { burstSuppressKind: action.burstSuppressKind }
        : {}),
      ...(action.duration ? { duration: action.duration } : {}),
    };
    return executeNegate(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      effect.timingScope,
      provenance,
      effect.timing.kind === "continuous",
      ctx.continuationMeta.chainId
    );
  },
  treat_as: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId } = ctx;
    const { provenance } = ctx.effectMeta;
    // 支払い文脈限定 treat_as (whenPayingForFilter) は無条件 CE を登録しない。
    // 加色は cost-system.calculateReduction が支払い対象カードを照合して解決時のみ行う
    // (「夜錆カードを召喚/配置するとき限定でシンボルを白/紫としても扱う」BSSA01-C01 等)。
    // ここで CE を積むと BP・表示・通常の色判定にまで誤って漏れるため no-op で返す。
    if (action.whenPayingForFilter || action.waivesReductionRequirement) {
      return state;
    }
    // 「このカードの軽減シンボル」型はカード状態だけの自己修飾。
    // 場の実体状態（スピリット/アルティメット/ブレイヴ/ネクサス等）には CE を登録せず、
    // 使用時コスト計算が card.effects を直接読んで反映する。
    if (action.cardStateOnly) {
      return state;
    }
    // DSL aspects[] → v1 aspect (単数) 変換
    const hasColor = action.aspects.includes("color");
    const hasSymbol = action.aspects.includes("symbol");
    const hasReduction = action.aspects.includes("reduction_symbol");
    let aspect: TreatAsAction["aspect"];
    if (hasColor && hasSymbol) aspect = "color_and_symbol";
    else if (hasColor) aspect = "color";
    else if (hasSymbol && hasReduction) aspect = "symbol_and_reduction";
    else if (hasSymbol) aspect = "symbol";
    else if (hasReduction) aspect = "reduction_symbol";
    else aspect = "symbol";
    const v1Action = {
      kind: "treat_as" as const,
      aspect,
      asColor: action.asColor,
      ...(action.appliesToCard !== undefined
        ? { appliesToCard: action.appliesToCard }
        : {}),
      ...(action.cardStateOnly !== undefined
        ? { cardStateOnly: action.cardStateOnly }
        : {}),
      ...(action.reductionSymbolBaseColors !== undefined
        ? { reductionSymbolBaseColors: action.reductionSymbolBaseColors }
        : {}),
    } as TreatAsAction;
    return executeTreatAs(
      state,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      provenance
    );
  },
  rebirth: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
    } = ctx;
    // DSL RebirthAction の optional フィールドを v1 互換のデフォルトで埋める
    const v1Action: RebirthAction = {
      kind: "rebirth",
      maxCount: action.maxCount ?? Number.POSITIVE_INFINITY,
      triggerDescription: action.triggerDescription ?? "",
      ...(action.foldCombinedPartnerToAdventSource
        ? { foldCombinedPartnerToAdventSource: true }
        : {}),
      ...(action.forceTriggerCondition ? { forceTriggerCondition: true } : {}),
      ...(action.separatesFromHost ? { separatesFromHost: true } : {}),
      ...(action.asIfCombinedWithSource
        ? { asIfCombinedWithInstanceId: sourceInstanceId }
        : {}),
      ...(action.vanishAfterFlipOnLvDeficit
        ? { vanishAfterFlipOnLvDeficit: true }
        : {}),
      ...(action.allowPostRebirthCorePlacementForLvDeficit
        ? { allowPostRebirthCorePlacementForLvDeficit: true }
        : {}),
      ...(action.postRebirthChoice
        ? { postRebirthChoice: action.postRebirthChoice }
        : {}),
      ...(action.countBonusMode
        ? { countBonusMode: action.countBonusMode }
        : {}),
    };
    // 外部転醒（action.target 指定）: resolvedTargetIds の対象 instance を
    // sourceInstanceId として executeRebirth を呼ぶ。front-face 限定（既に
    // 裏返った instance は definitionId !== originalDefinitionId で除外）。
    // BSSA01-XX01 神技4「夜錆の転醒前1つの【転醒】を発揮する」型。
    if (action.target) {
      const ids = resolvedTargetIds ?? [];
      let mutated = state;
      for (const targetId of ids) {
        const inst = mutated.cardInstances.find(
          (c) => c.instanceId === targetId
        );
        if (!inst) continue;
        if (inst.definitionId !== inst.originalDefinitionId) continue;
        const targetDef = getCardDefinitionById(inst.definitionId);
        const targetPostChoice = findTargetRebirthPostChoice(targetDef);
        mutated = executeRebirth(
          mutated,
          actingPlayerId,
          targetPostChoice && v1Action.postRebirthChoice === undefined
            ? { ...v1Action, postRebirthChoice: targetPostChoice }
            : v1Action,
          targetId,
          getCardDefinitionById,
          requireTriggerChainId(ctx.continuationMeta.chainId),
          stepCtx.rebirthTimingWindowId
        );
      }
      return mutated;
    }
    const rebirthSourceInstanceId =
      ctx.effectMeta.effectSourceInstanceId ?? sourceInstanceId;
    return executeRebirth(
      state,
      actingPlayerId,
      v1Action,
      rebirthSourceInstanceId,
      getCardDefinitionById,
      requireTriggerChainId(ctx.continuationMeta.chainId),
      stepCtx.rebirthTimingWindowId
    );
  },
  reverse_rebirth: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
    } = ctx;
    const reverseRebirthSourceInstanceId =
      ctx.effectMeta.effectSourceInstanceId ?? sourceInstanceId;
    return executeReverseRebirth(
      state,
      actingPlayerId,
      action,
      reverseRebirthSourceInstanceId,
      getCardDefinitionById
    );
  },
  brave_combine_effect: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      stepCtx,
    } = ctx;
    const hostId = (resolvedTargetIds ?? [])[0];
    if (!hostId) return state;
    // ENGINE-brave-combine-third-party-target: source 指定時は前段 step (通常
    // noop+target の選択専用 step) が解決したブレイヴを合体元にする。省略時は
    // 従来どおり sourceInstanceId 自身（既存 BSFT01 系との後方互換）。
    const braveId =
      action.source !== undefined
        ? (getStepResult(stepCtx, action.source.stepId)
            ?.affectedCardInstanceIds?.[0] ?? undefined)
        : sourceInstanceId;
    if (!braveId) return state;
    const braveBeforeCombine = getCardById(state, braveId);
    const braveBeforeDef = braveBeforeCombine
      ? getCardDefinitionById(braveBeforeCombine.definitionId)
      : undefined;
    const isAsSummonFromOffField =
      action.asSummon === true &&
      braveBeforeCombine !== undefined &&
      braveBeforeCombine.zone !== "field" &&
      braveBeforeDef !== undefined;
    if (
      isAsSummonFromOffField &&
      braveBeforeCombine !== undefined &&
      braveBeforeDef !== undefined
    ) {
      const summonGate = evaluateBraveCombineAsSummonGate({
        state,
        brave: braveBeforeCombine,
        braveDef: braveBeforeDef,
        getCardDefinitionById,
        evaluateCondition,
      });
      if (summonGate.kind !== "allowed") {
        const reason =
          summonGate.kind === "summon_condition_failed"
            ? "summon-condition-failed"
            : summonGate.kind === "tensho_target_missing"
              ? "tensho-target-missing"
              : summonGate.kind === "field_name_uniqueness"
                ? "field-name-uniqueness"
                : "restricted";
        state.log.push(`effect:summon:${braveId}:${reason}`);
        return state;
      }
      const hostCard = getCardById(state, hostId);
      const hostDef = hostCard
        ? getCardDefinitionById(hostCard.definitionId)
        : undefined;
      if (
        hostCard === undefined ||
        hostDef === undefined ||
        hostCard.pendingLeaveKind !== null ||
        hasCannotCombineRestriction(state, braveId, braveBeforeDef) ||
        !isEligibleBraveCombineHost({
          state,
          host: hostCard,
          hostDefinition: hostDef,
          incomingBraveCondition: braveBeforeDef.braveCondition,
          incomingBrave: braveBeforeCombine,
          incomingBraveDef: braveBeforeDef,
          getCardDefinitionById,
        })
      ) {
        return state;
      }
      const basePolicy = getEnterFieldCorePlacementPolicy({
        card: braveBeforeCombine,
        definition: braveBeforeDef,
      });
      const effectIndex = ctx.effectMeta.provenance?.effectIndex ?? 0;
      const stepIndex = ctx.effectMeta.provenance?.stepIndex ?? 0;
      const chainId =
        ctx.continuationMeta.chainId ??
        `effect:brave-combine-as-summon:${sourceInstanceId}:${effectIndex}:${stepIndex}`;
      const effectSourceInstanceId =
        ctx.effectMeta.effectSourceInstanceId ??
        ctx.effectMeta.provenance?.effectSourceInstanceId ??
        sourceInstanceId;
      const effectSourceCard =
        getCardById(state, effectSourceInstanceId) ??
        getCardById(state, sourceInstanceId);
      const effectSourceDefinitionId =
        ctx.effectMeta.effectSourceDefinitionId ??
        ctx.effectMeta.provenance?.effectSourceDefinitionId ??
        effectSourceCard?.definitionId ??
        braveBeforeDef.cardNo;
      return {
        ...state,
        pendingEnterFieldPlacement: {
          pendingId: `brave-combine-as-summon-placement:${chainId}:${braveId}:${hostId}`,
          actingPlayerId,
          sourceInstanceId: braveId,
          sourceDefinitionId: braveBeforeDef.cardNo,
          remainingStacks: [],
          minimumCoreCount: 0,
          maximumCoreCount: basePolicy.maximumCoreCount,
          effectBraveCombineAsSummon: {
            braveInstanceId: braveId,
            braveDefinitionId: braveBeforeDef.cardNo,
            hostInstanceId: hostId,
            fromZone: braveBeforeCombine.zone,
            effectSourceInstanceId,
            effectSourceDefinitionId,
            effectIndex,
            effectResolutionBeforeState: state,
            chainId,
            stepResultId: ctx.step?.id ?? `__step_${stepIndex}`,
            ...(ctx.step?.choice !== undefined && ctx.choiceIndex !== undefined
              ? { chosenChoiceIndex: ctx.choiceIndex }
              : {}),
          },
          ...(ctx.continuationMeta.postResolutionOracle !== undefined
            ? {
                postResolutionOracle: ctx.continuationMeta.postResolutionOracle,
              }
            : {}),
        },
        log: [
          ...state.log,
          `effect:brave-combine-as-summon-placement:pending:${braveId}:${hostId}:chain=${chainId}`,
        ],
      };
    }
    const braveCores = getCardById(state, braveId)?.normalCoreCount ?? 0;
    const braveSoul = isSoulCoreOn(state, braveId);
    const combinedState = executeBraveCombine(
      state,
      actingPlayerId,
      braveId,
      hostId,
      getCardDefinitionById
    );
    const braveAfterCombine = getCardById(combinedState, braveId);
    const combineSucceeded =
      braveAfterCombine?.zone === "field" &&
      braveAfterCombine.attachedToInstanceId === hostId;
    if (combineSucceeded) {
      combinedState.log.push(
        `brave:combine:effect:${state.turnNumber}:${actingPlayerId}:${braveId}:${hostId}:cores:${braveCores}${braveSoul ? "+soul" : ""}`
      );
    }
    if (
      action.asSummon === true &&
      braveBeforeCombine?.zone !== "field" &&
      combineSucceeded
    ) {
      combinedState.log.push(
        `effect:summon:${braveId}:direct-combine:from=${braveBeforeCombine?.zone ?? "unknown"}:cost=0`
      );
    }
    return combinedState;
  },
  brave_separate_effect: (ctx) => {
    const { state, actingPlayerId, getCardDefinitionById, resolvedTargetIds } =
      ctx;
    const braveId = (resolvedTargetIds ?? [])[0];
    if (!braveId) return state;
    const brave = getCardById(state, braveId);
    const hostId = brave?.attachedToInstanceId ?? null;
    if (!brave || !hostId) return state;
    const host = getCardById(state, hostId);
    if (hasPreventBraveSeparationRestriction(state, hostId)) {
      state.log.push(
        `brave:separate:effect:blocked:prevent_brave_separation:${braveId}:${hostId}`
      );
      return state;
    }
    // 最終防御ゲート (adversarial verifier round2 refute 対応): target-resolution.ts の
    // braveSeparationSolvencyOnly フィルタは preSelectedIds 分岐 (target-resolution.ts の
    // 「GUI 事前選択があればそちらを使用」早期return) を経由すると素通りする。この handler が
    // ここで再検証してから選択待ちへ移る (isEligibleBraveSeparationTarget が SSOT)。
    if (!isEligibleBraveSeparationTarget(state, brave, getCardDefinitionById)) {
      return state;
    }

    let separatedState = state;
    const separatedBraveExhaustState = resolveSeparatedBraveExhaustState(
      brave,
      getCardDefinitionById(brave.definitionId),
      host
    );
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
      `brave:separate:effect:${separatedState.turnNumber}:${actingPlayerId}:${braveId}:${hostId}`
    );
    separatedState = queueEnterFieldCorePlacement({
      state: separatedState,
      beforeState: state,
      instanceId: braveId,
      getCardDefinitionById,
      eventKind: null,
    });
    return rebuildContinuousAndApplyStateBasedActions(
      separatedState,
      getCardDefinitionById
    );
  },
  advent_cost_override: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    const target = convertTargetSpecToEffectTarget(action.target);
    const tScope: TimingScope | undefined = effect.timingScope;
    return executeAdventCostOverride(
      state,
      actingPlayerId,
      {
        target,
        costTreatedAs: action.costTreatedAs,
        duration: action.duration,
      },
      sourceInstanceId,
      tScope,
      provenance
    );
  },
  cost_modify: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect, stepCtx } =
      ctx;
    const { provenance } = ctx.effectMeta;
    const mod = action.modifier;
    const tScope: TimingScope | undefined = effect.timingScope;
    if (action.target) {
      // カード自身対象 (target ベース): 「このカードのコストは3としても扱う」等
      if (typeof mod === "object" && "additionalCostValue" in mod) {
        const additionalCostValue = mod.additionalCostValue;
        return executeAdditionalCost(
          state,
          actingPlayerId,
          {
            kind: "additional_cost",
            ...(action.additionalPayment ? { additionalPayment: true } : {}),
            additionalCost: resolveAmountToNumber(
              additionalCostValue,
              state,
              actingPlayerId,
              stepCtx,
              ctx.getCardDefinitionById
            ),
            ...(effect.applicability?.zone !== undefined
              ? { sourceApplicabilityZone: effect.applicability.zone }
              : {}),
          },
          sourceInstanceId,
          provenance,
          tScope
        );
      }
      if (typeof mod === "object" && "override" in mod) {
        const sourceCard = getCardById(state, sourceInstanceId);
        if (
          action.whenUsingEffectMode !== undefined &&
          sourceCard &&
          sourceCard.zone !== "field"
        ) {
          return state;
        }
        const v1Action: CostOverrideAction & { targetInstanceId: string } = {
          kind: "cost_override",
          player: "self",
          filter: {
            cardName: "self",
            ...(action.whenUsingEffectMode
              ? { usingEffectMode: [action.whenUsingEffectMode] }
              : {}),
          },
          costOverride: mod.override,
          duration: action.duration ?? { scope: "while_on_field" },
          targetInstanceId: sourceInstanceId,
          ...(effect.applicability?.zone !== undefined
            ? { sourceApplicabilityZone: effect.applicability.zone }
            : {}),
        };
        return executeCostOverride(
          state,
          actingPlayerId,
          v1Action,
          sourceInstanceId,
          tScope,
          provenance
        );
      }
      return null;
    }
    // player ベース: 「マジックカードをコストなしで使える」等
    if (action.player) {
      // action.cardFilter (DSL 入力、CardFilter 全体) から消費側 matchesCostCEFilterClause
      // が実際に解釈するフィールドだけを pickCostCEFilterFields (card-filter.ts SSOT) で
      // 抽出する (guard-audit-card-filter-projection、2026-08-05 subset-type-unification、
      // 敵対的検証 Lens 2 で反証)。旧実装はフィールド別 allowlist コピーで
      // requiredKeywordTags 等の対応フィールドが黙って脱落し、単純な `{...cardFilter}` は
      // 逆に maxCost 等の非対応フィールドを型チェックが通る形で黙って脱落させる
      // silent no-op trap になっていた。
      const filter = action.cardFilter
        ? pickCostCEFilterFields(action.cardFilter)
        : undefined;
      if (mod === "free") {
        const v1Action: CostOverrideAction = {
          kind: "cost_override",
          player: action.player as EffectPlayerRef,
          ...(filter ? { filter } : {}),
          costOverride: 0,
          duration: action.duration ?? { scope: "while_on_field" },
          ...(effect.applicability?.zone !== undefined
            ? { sourceApplicabilityZone: effect.applicability.zone }
            : {}),
        };
        return executeCostOverride(
          state,
          actingPlayerId,
          v1Action,
          sourceInstanceId,
          tScope,
          provenance
        );
      }
      if (typeof mod === "object" && "override" in mod) {
        const v1Action: CostOverrideAction = {
          kind: "cost_override",
          player: action.player as EffectPlayerRef,
          ...(filter ? { filter } : {}),
          costOverride: mod.override,
          duration: action.duration ?? { scope: "while_on_field" },
          ...(effect.applicability?.zone !== undefined
            ? { sourceApplicabilityZone: effect.applicability.zone }
            : {}),
        };
        return executeCostOverride(
          state,
          actingPlayerId,
          v1Action,
          sourceInstanceId,
          tScope,
          provenance
        );
      }
      // player+cardFilter 版 additionalCostValue
      // (ENGINE-cost-modify-additional-cost-value-player-path-dead)。「自分の◯◯の
      // 使用コストを-1する」(BSLH01) 等、cost_override (絶対値上書き) と異なりカード毎の
      // 基準コストへの相対加算/軽減のため targetFilter 付き additional_cost CE として
      // 登録する (消費側 SSOT: getApplicableAdditionalCostDeltaCEs、card-filter.ts、
      // calculateReduction が全コスト計算経路へ自動合流)。
      if (typeof mod === "object" && "additionalCostValue" in mod) {
        const additionalCostValue = mod.additionalCostValue;
        return executeAdditionalCost(
          state,
          actingPlayerId,
          {
            kind: "additional_cost",
            ...(action.additionalPayment ? { additionalPayment: true } : {}),
            additionalCost: resolveAmountToNumber(
              additionalCostValue,
              state,
              actingPlayerId,
              stepCtx,
              ctx.getCardDefinitionById
            ),
            ...(typeof additionalCostValue === "number" ||
            !isLiveAdditionalCostDynamicSupported(additionalCostValue)
              ? {}
              : { additionalCostDynamic: additionalCostValue }),
            targetFilter: {
              player: action.player as EffectPlayerRef,
              ...(filter ?? {}),
            },
            duration: action.duration ?? { scope: "while_on_field" },
            ...(effect.applicability?.zone !== undefined
              ? { sourceApplicabilityZone: effect.applicability.zone }
              : {}),
          },
          sourceInstanceId,
          provenance,
          tScope
        );
      }
    }
    return null;
  },
  stay_on_field: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      pendingEffectSimultaneousGroupId,
    } = ctx;
    const target = convertTargetSpecToEffectTarget(action.target);
    // newExhaustState 省略時は現在の疲労状態を維持する（「同じ状態で残す/残せる」）。
    const v1Action: StayOnFieldAction = {
      kind: "stay_on_field",
      target,
      ...(action.newExhaustState !== undefined
        ? { newExhaustState: action.newExhaustState }
        : {}),
    };
    return executeStayOnField(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      pendingEffectSimultaneousGroupId !== undefined
        ? { simultaneousGroupId: pendingEffectSimultaneousGroupId }
        : undefined
    );
  },
  destroy: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      sourceCardReferenceInstanceId,
    } = ctx.effectMeta;
    const pendingLeaveChainId = getBattleEndPendingLeaveChainId(ctx.effectMeta);
    const sourceCardTargetInstanceId =
      sourceCardReferenceInstanceId ?? sourceInstanceId;
    const sourceCardTargetIds =
      action.target.kind === "source_card"
        ? state.cardInstances.some(
            (card) =>
              card.instanceId === sourceCardTargetInstanceId &&
              card.zone === "field" &&
              card.pendingLeaveKind === null
          )
          ? [sourceCardTargetInstanceId]
          : []
        : undefined;
    const target =
      action.target.kind === "source_card"
        ? { player: "self" as const, count: 1 }
        : convertTargetSpecToEffectTarget(action.target, {
            state,
            sourceInstanceId,
            actionKind: "destroy",
            getCardDefinitionById,
          });
    return executeDestroy(
      state,
      actingPlayerId,
      target,
      getCardDefinitionById,
      sourceInstanceId,
      action.target.kind === "source_card"
        ? sourceCardTargetIds
        : resolvedTargetIds,
      action.suppressDestroyedEffects,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      action.suppressDestroyedEffectsByCategory,
      "effect",
      undefined,
      undefined,
      sourcePreventionBypass,
      // BSLH01-C07: state 経由の橋渡し配列 (model.ts 参照)。executeNativeAction の
      // 25 引数リストへ新規追加せず ctx.state から直読みし、destroy 経路にだけ適用する
      // (クリアは executeEffect wrapper が呼び出し全体の return 時に一括して行う)。
      (
        state.pendingSoulDriveDepartureStayOnFieldPreventionSourceInstanceIds ??
        []
      ).includes(sourceInstanceId),
      pendingLeaveChainId,
      ctx.preservePreSelectedTargetRefs
    );
  },
  suppress_pending_leave_effects: (ctx) => {
    const {
      action,
      state,
      getCardDefinitionById,
      resolvedTargetIds,
      getRegisteredTriggeredEffectActions,
    } = ctx;
    return executeSuppressPendingLeaveEffects(
      state,
      resolvedTargetIds,
      action.suppressDestroyedEffects,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions
    );
  },
  vanish: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
    } = ctx.effectMeta;
    const pendingLeaveChainId = getBattleEndPendingLeaveChainId(ctx.effectMeta);
    const target = convertTargetSpecToEffectTarget(action.target, {
      state,
      sourceInstanceId,
      actionKind: "vanish",
      getCardDefinitionById,
    });
    return executeVanish(
      state,
      actingPlayerId,
      target,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      action.suppressDestroyedEffects,
      sourcePreventionLevel,
      action.braveCannotRemain,
      sourceTargetLockBypass,
      action.coreDestinationChoice,
      effect.timing,
      sourcePreventionBypass,
      pendingLeaveChainId
    );
  },
  bp_compare_destroy: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
    } = ctx.effectMeta;
    const pendingLeaveChainId = getBattleEndPendingLeaveChainId(ctx.effectMeta);
    // 源と選択した相手対象の実効 BP を比べ、「同じか低い」側を破壊する。
    // 同値は両側が条件を満たす（両方破壊）。両側とも通常破壊（executeDestroy）に委譲し、
    // 相手対象には相手効果耐性、源には自分の効果としての耐性判定をそのまま適用する。
    // - comparer 省略時 (Pattern 1): 源は効果の発生源カード自身。
    // - comparer 指定時 (Pattern 2): 源を場の別カード (例: 自分の「ルーシィ」1体) から選ぶ。
    const comparerId =
      action.comparer !== undefined
        ? resolveTargetSpec({
            state,
            targetSpec: action.comparer,
            actingPlayerId,
            sourceInstanceId,
            getCardDefinitionById,
            stepContext: stepCtx,
          })[0]?.instanceId
        : sourceInstanceId;
    const sourceCard = state.cardInstances.find(
      (c) => c.instanceId === comparerId
    );
    const sourceDef = sourceCard
      ? getCardDefinitionById(sourceCard.definitionId)
      : undefined;
    const chosenId = resolvedTargetIds?.[0];
    if (!sourceCard || sourceCard.zone !== "field" || !sourceDef || !chosenId) {
      // 源が場にいない / 対象未確定 → 比較不能（fail-closed、何もしない）。
      return state;
    }
    const targetCard = state.cardInstances.find(
      (c) => c.instanceId === chosenId
    );
    const targetDef = targetCard
      ? getCardDefinitionById(targetCard.definitionId)
      : undefined;
    if (!targetCard || targetCard.zone !== "field" || !targetDef) {
      return state;
    }
    const sourceBp = getEffectiveBp(
      state,
      sourceCard,
      sourceDef,
      getCardDefinitionById
    );
    const targetBp = getEffectiveBp(
      state,
      targetCard,
      targetDef,
      getCardDefinitionById
    );
    let current = state;
    const queueBpCompareBlockedDestroy = (
      card: CardInstance,
      causePlayerId: string
    ): GameState => {
      current.log.push(
        `effect:destroy:blocked-by-resistance:${actingPlayerId}:${card.instanceId}`
      );
      return queuePendingLeave({
        state: current,
        instanceId: card.instanceId,
        kind: "destroy",
        cause: "bp_compare",
        chainId:
          pendingLeaveChainId ??
          `effect:destroy:${actingPlayerId}:${card.instanceId}`,
        causePlayerId,
        blockedByResistance: true,
        causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      });
    };
    // 「BP比べでは破壊されない」(cannot_be_destroyed_by_bp_compare): 効果の
    // BP比べも本耐性で阻止される (04_state-based-rules.md §BP比べ破壊)。
    // この破壊は BP比べによるものと自明なので、executeDestroy 前にここで判定する。
    // 「BP が同じか低い側が破壊される」: bp <= 相手bp の側を破壊。同値は両方成立。
    if (targetBp <= sourceBp) {
      const targetAffect = resolveBpCompareDestroyAffect(
        current,
        targetCard,
        sourceCard.controllerPlayerId,
        getCardDefinitionById,
        sourcePreventionLevel,
        "bp_compare",
        sourcePreventionBypass
      );
      if (
        targetAffect.kind === "blocked" &&
        targetAffect.reason !== "effect_resistance"
      ) {
        current.log.push(
          `effect:bp_compare_destroy:immunity:${targetCard.instanceId}`
        );
      } else if (
        targetAffect.kind === "blocked" &&
        targetAffect.reason === "effect_resistance"
      ) {
        current = queueBpCompareBlockedDestroy(
          targetCard,
          sourceCard.controllerPlayerId
        );
      } else {
        const opponentTarget = convertTargetSpecToEffectTarget(action.target, {
          state: current,
          sourceInstanceId,
          actionKind: "destroy",
        });
        current = executeDestroy(
          current,
          actingPlayerId,
          opponentTarget,
          getCardDefinitionById,
          sourceInstanceId,
          [chosenId],
          undefined,
          sourcePreventionLevel,
          sourceTargetLockBypass,
          undefined,
          "bp_compare",
          "bp_compare",
          sourceCard.controllerPlayerId,
          sourcePreventionBypass,
          undefined,
          pendingLeaveChainId
        );
      }
    }
    if (sourceBp <= targetBp) {
      const sourceAffect = resolveBpCompareDestroyAffect(
        current,
        sourceCard,
        targetCard.controllerPlayerId,
        getCardDefinitionById,
        sourcePreventionLevel,
        "bp_compare",
        sourcePreventionBypass
      );
      if (
        sourceAffect.kind === "blocked" &&
        sourceAffect.reason !== "effect_resistance"
      ) {
        current.log.push(
          `effect:bp_compare_destroy:immunity:${sourceCard.instanceId}`
        );
      } else if (
        sourceAffect.kind === "blocked" &&
        sourceAffect.reason === "effect_resistance"
      ) {
        current = queueBpCompareBlockedDestroy(
          sourceCard,
          targetCard.controllerPlayerId
        );
      } else {
        // 源側の破壊。comparer 指定時はその選択カード (controller が自分なら "self")
        // を、省略時は発生源カード自身を破壊する。explicit instanceId を渡して特定する。
        const sourceSideTarget: EffectTarget = {
          player:
            sourceCard.controllerPlayerId === actingPlayerId
              ? "self"
              : "opponent",
          count: 1,
        };
        current = executeDestroy(
          current,
          actingPlayerId,
          sourceSideTarget,
          getCardDefinitionById,
          sourceInstanceId,
          [sourceCard.instanceId],
          undefined,
          sourcePreventionLevel,
          sourceTargetLockBypass,
          undefined,
          "bp_compare",
          "bp_compare",
          targetCard.controllerPlayerId,
          sourcePreventionBypass,
          undefined,
          pendingLeaveChainId
        );
      }
    }
    return current;
  },
  bounce: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
    } = ctx.effectMeta;
    const pendingLeaveChainId = getBattleEndPendingLeaveChainId(ctx.effectMeta);
    const target = convertTargetSpecToEffectTarget(action.target, {
      state,
      sourceInstanceId,
      actionKind: "bounce",
      getCardDefinitionById,
    });
    if (action.destination === "hand_or_set_aside_choice") {
      const ids = resolvedTargetIds ?? [];
      if (ids.length === 0) return state;
      return {
        ...state,
        pendingZoneSelection: {
          pendingId: nextPendingSelectionId("zs"),
          actingPlayerId,
          effectActingPlayerId: actingPlayerId,
          sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
          sourceDefinitionId:
            state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
              ?.definitionId ?? "dsl-unknown",
          actionKind: "bounce",
          sourceZone: "field",
          candidateCardInstanceIds: ids,
          maxCount: ids.length,
          canSkip: false,
          destination: "hand_or_set_aside_choice",
          remainingActions: [],
          effectTiming: ctx.effect.timing,
          priorStateSnapshot: state,
          ...(sourcePreventionLevel !== undefined
            ? { sourcePreventionLevel }
            : {}),
          ...(sourcePreventionBypass !== undefined
            ? { sourcePreventionBypass }
            : {}),
          bounceContext: {
            action: {
              kind: "bounce",
              target,
              ...(action.maxPreventable !== undefined
                ? { maxPreventable: action.maxPreventable }
                : {}),
            },
            ...(sourceTargetLockBypass !== undefined
              ? { sourceTargetLockBypass }
              : {}),
            ...(effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId }
              : {}),
            ...(effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId }
              : {}),
            ...(pendingLeaveChainId !== undefined
              ? { pendingLeaveChainId }
              : {}),
          },
        },
      };
    }
    const v1Action: BounceAction = {
      kind: "bounce",
      target,
      ...(action.maxPreventable !== undefined
        ? { maxPreventable: action.maxPreventable }
        : {}),
      ...(action.destination !== undefined
        ? { destination: action.destination }
        : {}),
    };
    return executeBounce(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
      pendingLeaveChainId
    );
  },
  send_to_deck: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
    } = ctx.effectMeta;
    const pendingLeaveChainId = getBattleEndPendingLeaveChainId(ctx.effectMeta);
    const target = convertTargetSpecToEffectTarget(action.target, {
      state,
      sourceInstanceId,
      getCardDefinitionById,
    });
    const v1Action: SendToDeckAction = {
      kind: "send_to_deck",
      target,
      position: action.position,
      ...(action.maxPreventable !== undefined
        ? { maxPreventable: action.maxPreventable }
        : {}),
      ...(action.pierceCannotLeaveField === true
        ? { pierceCannotLeaveField: true }
        : {}),
    };
    return executeSendToDeck(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
      pendingLeaveChainId
    );
  },
  remove_from_game: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
    } = ctx.effectMeta;
    const pendingLeaveChainId = getBattleEndPendingLeaveChainId(ctx.effectMeta);
    const target = convertTargetSpecToEffectTarget(action.target);
    const v1Action: RemoveFromGameAction = {
      kind: "remove_from_game",
      target,
      ...(action.pierceCannotLeaveField
        ? { pierceCannotLeaveField: true }
        : {}),
    };
    return executeRemoveFromGame(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      pendingLeaveChainId,
      ctx.effectMeta.battleEndDeferralAttackId
    );
  },
  discard: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect,
      step,
      choiceIndex,
      resolvedTargetIds,
    } = ctx;
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    // 「N枚まで破棄」= 任意の上限付き範囲 (count: { min: 0, max: N })。
    // resolveCountToNumber は範囲を min に潰す (= 0 → no-op) ため、範囲は別扱いで
    // 上限 (max) を実効枚数として渡し、選択を任意 (canSkip) にする (P3-88 core_move の
    // 「コアN個まで」と同型)。max は DynamicCount も可 (「カウント2につき1枚まで」)。
    // fromZone:"deck" のミルも executeDiscardHand 側 (isDeckMill+optionalUpTo) で
    // pendingZoneSelection を生成できるため同じ分岐で扱う (BSKB01-R03「2枚まで破棄」)。
    const rawCount = action.count;
    const isRangeCount =
      typeof rawCount === "object" && rawCount !== null && "min" in rawCount;
    let discardCount: number;
    let optionalUpTo = false;
    if (isRangeCount && action.targetHandSize === undefined) {
      const resolvedMin = resolveCountBound(
        rawCount.min,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
      const resolvedMax =
        rawCount.max === undefined
          ? resolvedMin
          : resolveCountBound(
              rawCount.max,
              state,
              actingPlayerId,
              stepCtx,
              getCardDefinitionById
            );
      discardCount = resolvedMax;
      // min===0 のときのみ任意選択 (0..max)。min>0 の範囲は resolver が exact/0..max のみ
      // 対応のため現状サポート外 (該当カードは min:0 のみ)。
      optionalUpTo = resolvedMin === 0;
    } else {
      discardCount = resolveCountToNumber(
        action.count,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
    }
    const capCount =
      action.capCount !== undefined
        ? resolveCountBound(
            action.capCount,
            state,
            actingPlayerId,
            stepCtx,
            getCardDefinitionById
          )
        : undefined;
    // DSL fromZone: Zone | Zone[] → v1 "hand" | "set_aside" | "hand_or_set_aside" | "deck" | "mirage"
    let fromZone:
      | "hand"
      | "set_aside"
      | "hand_or_set_aside"
      | "deck"
      | "mirage"
      | undefined;
    if (action.fromZone) {
      const zones = Array.isArray(action.fromZone)
        ? action.fromZone
        : [action.fromZone];
      if (zones.includes("deck")) fromZone = "deck";
      // ENGINE-composite-heterogeneous-removal-budget: "mirage" 単独指定のみ対応
      // (hand/set_aside との混在は現状未使用のため未対応、BSTH09-X01「相手のミラージュ
      // 3つまでを破棄」)。
      else if (zones.includes("mirage")) fromZone = "mirage";
      else if (zones.includes("hand") && zones.includes("set_aside"))
        fromZone = "hand_or_set_aside";
      else if (zones.includes("set_aside")) fromZone = "set_aside";
      else fromZone = "hand";
    }
    // DSL action.player を v1 targetPlayer にマップ。executeDiscardHand 側で
    // resolvePlayerRef(actingPlayerId, targetPlayer, state) により対象プレイヤーを解決し、
    // 手札絞り・handCount 減算・pendingZoneSelection.actingPlayerId を切り替える。
    const v1Action: DiscardHandAction = {
      kind: "discard_hand",
      count: discardCount,
      ...(action.physicalHandOnly ? { physicalHandOnly: true } : {}),
      ...(action.targetHandSize !== undefined
        ? { targetHandSize: action.targetHandSize }
        : {}),
      ...(capCount !== undefined ? { capCount } : {}),
      ...(action.player
        ? { targetPlayer: action.player as EffectPlayerRef }
        : {}),
      ...(action.unseen ? { unseen: true } : {}),
      ...(action.selectionPlayer
        ? { selectionPlayer: action.selectionPlayer }
        : {}),
      ...(action.destination === "deck_bottom"
        ? { destination: "deck_bottom" as const }
        : {}),
      ...(action.suppressMovedToTrashEffects === true
        ? { suppressMovedToTrashEffects: true }
        : {}),
      ...(fromZone ? { fromZone } : {}),
      // filter は CardFilter を丸ごと渡す。executeDiscardHand は matchesCardFilter
      // (SSOT) にそのまま流すため、フィールドを列挙コピーすると tribesLogic /
      // tribesRequired のような後付けフィールドが黙って落ちる。
      ...(action.filter ? { filter: { ...action.filter } } : {}),
    };
    // step.choice に同 kind="discard" の代替条件があれば OR 形式の選択モーダルとして提示する。
    // 例: BSTH01-C12「カード3枚 か 紅魔1枚」→ primary discard count:3, alt discard count:1 filter:tribes:["紅魔"]。
    // choiceIndex が外部から指定されている場合は単一分岐実行のため alt は無効化する。
    const altSelections: Array<{
      count: number;
      filter?: import("../dsl-types").CardFilter;
      label?: string;
    }> = [];
    if (step?.choice && step.choice.length > 0 && choiceIndex === undefined) {
      for (const c of step.choice) {
        if (c.action.kind !== "discard") continue;
        if (c.action.player !== action.player) continue;
        // count は数値リテラルのみ alt として扱う（Count 式は表現困難）
        if (typeof c.action.count !== "number" || c.action.count <= 0) continue;
        altSelections.push({
          count: c.action.count,
          ...(c.action.filter ? { filter: c.action.filter } : {}),
        });
      }
    }
    // effect/step の任意性はここへ来る前に選択済み。固定枚数の対象選択で
    // 二度目の辞退を加えない。「まで」の0枚は optionalUpTo だけが許可する（03c）。
    const isMandatory = true;
    return executeDiscardHand(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      effect.timing,
      {
        isMandatory,
        ...(action.target
          ? { selectedCardInstanceIds: resolvedTargetIds ?? [] }
          : {}),
        ...(optionalUpTo ? { optionalUpTo: true } : {}),
        ...(altSelections.length > 0
          ? { alternateSelections: altSelections }
          : {}),
        ...(action.deferMovedToTrashEffects === true
          ? { deferMovedToTrashEffects: true }
          : {}),
        ...(sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel }
          : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
      }
    );
  },
  process_moved_to_trash: (ctx) => {
    const { action, state, sourceInstanceId, getCardDefinitionById, stepCtx } =
      ctx;
    const sourceResult = getStepResult(stepCtx, action.source.stepId);
    const movedIds = sourceResult?.affectedCardInstanceIds ?? [];
    if (movedIds.length === 0) return state;
    const srcCard = getCardById(state, sourceInstanceId);
    const srcDef = srcCard
      ? getCardDefinitionById(srcCard.definitionId)
      : undefined;
    const sourceCategory =
      srcCard && srcDef
        ? getEffectiveCategory(state, srcCard, srcDef)
        : undefined;
    return processMovedToTrashEffects(state, movedIds, getCardDefinitionById, {
      sourceColors: getEffectiveColors(state, srcCard, srcDef),
      sourceTribes: getEffectiveTribes(
        state,
        srcCard,
        srcDef,
        getCardDefinitionById
      ),
      ...(srcDef?.name ? { sourceCardName: srcDef.name } : {}),
      ...(sourceCategory ? { sourceCategory } : {}),
      ...(srcCard ? { sourcePlayerId: srcCard.controllerPlayerId } : {}),
      fromZone: action.fromZone ?? "deck",
    });
  },
  discard_set_burst: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      stepCtx,
      effect,
    } = ctx;
    // BSRK01-C06「相手のバースト1つを破棄する」型。対象は setBurstStates。
    // 効果コントローラ (actingPlayerId) が裏向きセット中バーストから枚数分を選んで破棄。
    // 04b L68 の「発動宣言窓のスタックタイミングは『まだセット中』」より、破棄効果は
    // この窓でバースト発動の対抗手段として作用する（本実装は一発処理として burst → trash）。
    const targetPlayerId = resolvePlayerRef(
      actingPlayerId,
      action.player ?? "opponent",
      state
    );
    // ENGINE-composite-heterogeneous-removal-budget: action.count が {min,max}（範囲）で
    // 未解決のとき、Q4185 非識別によりカード単体の target 選択はできないため「何枚破棄するか」
    // のみをプレイヤーに選ばせる pendingDiscardSetBurstCountSelection を生成する
    // (count_decrease の pendingCountSelection と同型パターン)。resolvedTargetIds が
    // 既に解決済み (pending 解決後の再実行等) ならその件数を正とし pending は経由しない。
    if (
      resolvedTargetIds === undefined &&
      typeof action.count === "object" &&
      action.count !== null &&
      "min" in action.count
    ) {
      const setBurstIdsForPending = getDiscardableBurstStates(
        state,
        targetPlayerId
      ).map((s) => s.cardInstanceId);
      const resolvedMin = resolveCountBound(
        action.count.min,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
      const resolvedMax =
        action.count.max === undefined
          ? setBurstIdsForPending.length
          : resolveCountBound(
              action.count.max,
              state,
              actingPlayerId,
              stepCtx,
              getCardDefinitionById
            );
      const effectiveMax = Math.min(resolvedMax, setBurstIdsForPending.length);
      const effectiveMin = Math.min(resolvedMin, effectiveMax);
      if (effectiveMax <= effectiveMin) {
        return executeDiscardSetBurst(
          state,
          actingPlayerId,
          sourceInstanceId,
          targetPlayerId,
          effectiveMin,
          getCardDefinitionById,
          action.destination ?? "trash",
          action.unpreventable === true,
          undefined
        );
      }
      const sourceCard = getCardById(state, sourceInstanceId);
      state.log.push(
        `effect:discard_set_burst_count_selection:pending:${effectiveMin}-${effectiveMax}:${targetPlayerId}`
      );
      return {
        ...state,
        pendingDiscardSetBurstCountSelection: {
          pendingId: `dsbcs-${discardSetBurstCountSelectionPendingSequence++}`,
          actingPlayerId,
          sourceInstanceId,
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          targetPlayerId,
          min: effectiveMin,
          max: effectiveMax,
          destination: action.destination ?? "trash",
          unpreventable: action.unpreventable === true,
          effectTiming: effect.timing,
          priorStateSnapshot: state,
        },
      };
    }
    // ENGINE-composite-heterogeneous-removal-budget: action.count は Count
    // (DynamicCount 可)。resolvedTargetIds が既に解決済みならその件数を正とする
    // (destroy/search_zone と同じ SSOT: resolveTargets の候補確定結果を優先)。
    const resolvedCount =
      resolvedTargetIds !== undefined
        ? resolvedTargetIds.length
        : resolveCountToNumber(
            action.count,
            state,
            actingPlayerId,
            stepCtx,
            getCardDefinitionById
          );
    return executeDiscardSetBurst(
      state,
      actingPlayerId,
      sourceInstanceId,
      targetPlayerId,
      resolvedCount === -1 ? Number.MAX_SAFE_INTEGER : resolvedCount,
      getCardDefinitionById,
      action.destination ?? "trash",
      action.unpreventable === true,
      resolvedTargetIds
    );
  },
  search_zone: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect,
      resolvedTargetIds,
    } = ctx;
    // Validate before v1 destination normalization can turn an invalid request
    // into a different move. This sentinel denotes a later per-card choice.
    if (action.destination !== "hand_or_set_aside_choice")
      requireCardZone(action.destination);
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    // 「N枚まで戻す/加える」= 任意の上限付き範囲 (count: { min: 0, max: N })。
    // resolveCountToNumber は範囲を min に潰す (= 0 → no-op) ため、未解決時は上限
    // (max) を internal v1 action に渡し、optionalUpTo で 0..max pending を開く。
    // pendingEffectTargetSelection 等で解決済み target が戻ってきた実行時は、
    // プレイヤーが実際に選んだ件数を優先する。
    const rawSearchCount = action.count;
    const isRangeSearchCount =
      typeof rawSearchCount === "object" &&
      rawSearchCount !== null &&
      "min" in rawSearchCount;
    let searchCount: number;
    let optionalUpTo = false;
    if (resolvedTargetIds !== undefined) {
      searchCount = resolvedTargetIds.length;
    } else if (isRangeSearchCount) {
      const resolvedMin = resolveCountBound(
        rawSearchCount.min,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
      const resolvedMax =
        rawSearchCount.max === undefined
          ? resolvedMin
          : resolveCountBound(
              rawSearchCount.max,
              state,
              actingPlayerId,
              stepCtx,
              getCardDefinitionById
            );
      searchCount = resolvedMax;
      optionalUpTo = resolvedMin === 0;
    } else {
      searchCount = resolveCountToNumber(
        action.count,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
    }
    const searchFilter = action.filter;
    const searchZones = Array.isArray(action.zone)
      ? action.zone
      : [action.zone];
    const isHandTrashSearch =
      (searchZones.includes("hand") &&
        searchZones.every((zone) => zone === "hand" || zone === "trash")) ||
      // set_aside 単独指定 (BSTH08.5-X01「手元のブレイヴ1枚を除外することで」型)。
      // hand/trash との混在は未使用のため対象外 (zone === "trash" 単独は既存の
      // 専用 ReturnFromTrashAction 経路 (下記 `action.zone === "trash"` 分岐) を維持する)。
      searchZones.every((zone) => zone === "set_aside");
    if (isHandTrashSearch) {
      const zoneOwnerId = resolvePlayerRef(
        actingPlayerId,
        action.player ?? "self",
        state
      );
      const sourceCard = state.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      const sourceDefinition = sourceCard
        ? getCardDefinitionById(sourceCard.definitionId)
        : undefined;
      const effectSource: {
        instance?: CardInstance;
        definition?: CardDefinition;
      } = {
        ...(sourceCard ? { instance: sourceCard } : {}),
        ...(sourceDefinition ? { definition: sourceDefinition } : {}),
      };
      const destination =
        action.destination === "field"
          ? "field"
          : action.destination === "set_aside"
            ? "set_aside"
            : action.destination === "hand"
              ? "hand"
              : action.destination === "removed_from_game"
                ? "removed_from_game"
                : action.destination === "hand_or_set_aside_choice"
                  ? "hand_or_set_aside_choice"
                  : null;
      if (destination === null) return state;
      const matching = resolveHandTrashSearchCandidates({
        state,
        actingPlayerId,
        zoneOwnerId,
        zones: searchZones as readonly ("hand" | "trash" | "set_aside")[],
        ...(searchFilter ? { filter: searchFilter } : {}),
        getCardDefinitionById,
        sourcePreventionLevel: sourcePreventionLevel ?? "none",
        effectSource,
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        returnFromTrashDestination: destination,
      });

      const selected =
        resolvedTargetIds !== undefined
          ? matching.filter((candidate) =>
              resolvedTargetIds.includes(candidate.instanceId)
            )
          : matching.slice(0, searchCount);
      if (selected.length === 0) return state;

      const needsSelection =
        searchCount > 0 &&
        (destination === "hand_or_set_aside_choice"
          ? matching.length > 0
          : resolvedTargetIds === undefined &&
            (optionalUpTo
              ? matching.length > 0
              : matching.length > searchCount));
      if (needsSelection) {
        return {
          ...state,
          pendingZoneSelection: {
            pendingId: nextPendingSelectionId("zs"),
            actingPlayerId,
            effectActingPlayerId: actingPlayerId,
            sourceInstanceId: sourceInstanceId ?? "dsl-unknown",
            sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
            actionKind: "return_from_trash",
            sourceZone: searchZones.length > 1 ? "trash" : searchZones[0]!,
            candidateCardInstanceIds: matching.map((c) => c.instanceId),
            maxCount: optionalUpTo
              ? Math.min(searchCount, matching.length)
              : searchCount,
            destination,
            ...(zoneOwnerId !== actingPlayerId
              ? { targetPlayerId: zoneOwnerId }
              : {}),
            remainingActions: [],
            effectTiming: effect.timing,
            priorStateSnapshot: state,
            canSkip: optionalUpTo || action.mandatory !== true,
            ...(sourcePreventionLevel !== undefined
              ? { sourcePreventionLevel }
              : {}),
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
          },
          log: [
            ...state.log,
            `effect:search_zone:${searchZones.join("+")}:${actingPlayerId}:pending:${matching.length}candidates`,
          ],
        };
      }

      if (destination === "hand_or_set_aside_choice") return state;

      const gate = resolveZoneMoveHandGainCost(
        state,
        { actingPlayerId, sourceInstanceId },
        zoneOwnerId,
        selected,
        destination,
        getCardDefinitionById,
        { ...ctx.corePayment, effectTiming: effect.timing }
      );
      if (!gate.canGain) return gate.state;
      let nextState = gate.state;
      nextState.log.push(
        `effect:search_zone:${searchZones.join("+")}:${actingPlayerId}:${selected.length}:${destination}`
      );
      if (destination === "removed_from_game") {
        return executeRemoveFromGame(
          nextState,
          actingPlayerId,
          {
            kind: "remove_from_game",
            target: {
              player: action.player ?? "self",
              zone: searchZones,
              count: selected.length,
            },
          },
          getCardDefinitionById,
          sourceInstanceId,
          selected.map((c) => c.instanceId),
          sourcePreventionLevel,
          ctx.effectMeta.sourceTargetLockBypass,
          sourcePreventionBypass,
          getBattleEndPendingLeaveChainId(ctx.effectMeta),
          ctx.effectMeta.battleEndDeferralAttackId
        );
      }
      for (const selectedCard of selected) {
        if (destination === "field") {
          nextState.log.push(
            `effect:field_place:return_from_trash:${actingPlayerId}:${selectedCard.instanceId}`
          );
          nextState = placeCardFromZoneToField(
            nextState,
            selectedCard.instanceId,
            getCardDefinitionById
          );
        } else {
          nextState = moveCardZone(
            nextState,
            selectedCard.instanceId,
            destination
          );
        }
      }
      return nextState;
    }
    if (action.zone === "deck") {
      const deckPlayerId = resolvePlayerRef(
        actingPlayerId,
        action.player ?? "self",
        state
      );
      // destination の変換: DSL Zone → v1 search_deck destination
      let dest: "hand" | "field" | "top_of_deck" | "bottom_of_deck" = "hand";
      if (action.destination === "field") dest = "field";
      else if (
        action.destination === "deck" &&
        action.destinationPosition === "top"
      )
        dest = "top_of_deck";
      else if (
        action.destination === "deck" &&
        action.destinationPosition === "bottom"
      )
        dest = "bottom_of_deck";
      const v1Action: SearchDeckAction = {
        kind: "search_deck",
        count: searchCount,
        ...(searchFilter ? { filter: searchFilter } : {}),
        destination: dest,
        ...(deckPlayerId !== actingPlayerId
          ? { targetPlayerId: deckPlayerId }
          : {}),
        ...(action.mandatory ? { mandatory: true } : {}),
        ...(optionalUpTo ? { optionalUpTo: true } : {}),
      };
      return executeSearchDeck(
        state,
        actingPlayerId,
        v1Action,
        getCardDefinitionById,
        sourceInstanceId,
        effect.timing,
        resolvedTargetIds,
        ctx.corePayment
      );
    }
    if (action.zone === "trash") {
      // 操作対象トラッシュの所有プレイヤー（player:"opponent" で相手トラッシュ）。
      const trashPlayerId = resolvePlayerRef(
        actingPlayerId,
        action.player ?? "self",
        state
      );
      let trashDest:
        | "hand"
        | "field"
        | "set_aside"
        | "deck"
        | "removed_from_game"
        | "hand_or_set_aside_choice" = "hand";
      if (action.destination === "field") trashDest = "field";
      else if (action.destination === "set_aside") trashDest = "set_aside";
      else if (action.destination === "deck") trashDest = "deck";
      else if (action.destination === "removed_from_game")
        trashDest = "removed_from_game";
      else if (action.destination === "hand_or_set_aside_choice")
        trashDest = "hand_or_set_aside_choice";
      const v1Action: ReturnFromTrashAction = {
        kind: "return_from_trash",
        count: searchCount,
        ...(searchFilter ? { filter: searchFilter } : {}),
        destination: trashDest,
        ...(action.destination === "deck" && action.destinationPosition
          ? { destinationPosition: action.destinationPosition }
          : {}),
        ...(action.mandatory ? { mandatory: true } : {}),
        ...(optionalUpTo ? { optionalUpTo: true } : {}),
      };
      // 発生源スコープ付き「相手の効果を受けない」照合用 (実効値照合のため instance も渡す)。
      // トラッシュ束縛 effect_immunity (BSTH002-M01 等) を相手 acting の return_from_trash で
      // gate するために executeReturnFromTrash へ伝搬する。
      const trashSourceCard = state.cardInstances.find(
        (c) => c.instanceId === sourceInstanceId
      );
      const trashSourceDefinition: CardDefinition | undefined = trashSourceCard
        ? getCardDefinitionById(trashSourceCard.definitionId)
        : undefined;
      const trashEffectSource: {
        instance?: CardInstance;
        definition?: CardDefinition;
      } = {
        ...(trashSourceCard ? { instance: trashSourceCard } : {}),
        ...(trashSourceDefinition ? { definition: trashSourceDefinition } : {}),
      };
      return executeReturnFromTrash(
        state,
        actingPlayerId,
        v1Action,
        getCardDefinitionById,
        sourceInstanceId,
        effect.timing,
        trashPlayerId,
        resolvedTargetIds,
        sourcePreventionLevel ?? "none",
        trashEffectSource,
        sourcePreventionBypass,
        ctx.corePayment
      );
    }
    return state; // 未対応ゾーン (no-op)
  },
  resume_deck_reveal: (ctx) => {
    const { state, action } = ctx;
    if (state.pendingDeckReveal)
      throw new Error("Cannot resume over an active deck reveal");
    // 中間手順でセット/召喚/移動した公開カードを再取得・再移動しない。
    const stillRevealed = new Set(
      state.cardInstances
        .filter((card) => card.zone === "revealed")
        .map((card) => card.instanceId)
    );
    const pending = {
      ...action.pending,
      revealedCardInstanceIds: action.pending.revealedCardInstanceIds.filter(
        (id) => stillRevealed.has(id)
      ),
      pickedCardInstanceIds: action.pending.pickedCardInstanceIds.filter((id) =>
        stillRevealed.has(id)
      ),
    };
    return runPendingDeckRevealBoundary(
      { ...state, pendingDeckReveal: pending },
      {
        getCardDefinitionById: ctx.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          ctx.getRegisteredTriggeredEffectActions ?? (() => []),
        ...(ctx.getRegisteredBurstActions
          ? { getRegisteredBurstActions: ctx.getRegisteredBurstActions }
          : {}),
      },
      executeEffect
    );
  },
  deck_reveal: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
    } = ctx;
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    const v1Picks = action.picks.map((p) => ({
      count: p.count,
      ...(p.filter ? { filter: { ...p.filter } } : {}),
      ...(p.filterOr
        ? { filterOr: p.filterOr.map((filter) => ({ ...filter })) }
        : {}),
      ...(p.destination ? { destination: p.destination } : {}),
      ...(p.mandatory ? { mandatory: true } : {}),
      ...(p.exclusiveGroup ? { exclusiveGroup: p.exclusiveGroup } : {}),
      ...(p.costGate !== undefined ? { costGate: p.costGate } : {}),
    }));
    const resolvedRevealCount = resolveAmountToNumber(
      action.revealCount,
      state,
      actingPlayerId,
      stepCtx,
      getCardDefinitionById
    );
    const v1Action: DeckRevealAction = {
      kind: "deck_reveal",
      ...(action.beforePickSteps
        ? { beforePickSteps: action.beforePickSteps }
        : {}),
      ...(action.beforeMoveSteps
        ? { beforeMoveSteps: action.beforeMoveSteps }
        : {}),
      revealCount: resolvedRevealCount,
      picks: v1Picks,
      remainder:
        action.remainder === "player_choice"
          ? "top_or_bottom"
          : action.remainder,
      ...(action.player
        ? { targetPlayer: action.player as EffectPlayerRef }
        : {}),
      ...(action.revealTo ? { revealTo: action.revealTo } : {}),
      ...(action.suppressRevealedEffects
        ? { suppressRevealedEffects: true }
        : {}),
      ...(action.suppressFieldEntryEffects
        ? { suppressFieldEntryEffects: true }
        : {}),
    };
    return executeDeckReveal(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      sourcePreventionLevel ?? "none",
      sourcePreventionBypass
    );
  },
  reveal_hand: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
    } = ctx;
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    const v1Action: RevealHandAction = {
      kind: "reveal_hand",
      revealTo: action.revealTo,
      ...(action.player
        ? { targetPlayer: action.player as EffectPlayerRef }
        : {}),
      ...(action.count !== undefined ? { count: action.count } : {}),
      // discard と同じく CardFilter を丸ごと渡す（executeRevealHand →
      // matchesCardFilter SSOT。列挙コピーは後付けフィールドを黙って落とす）。
      ...(action.filter ? { filter: { ...action.filter } } : {}),
    };
    return executeRevealHand(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      {
        ...(action.target
          ? { selectedCardInstanceIds: ctx.resolvedTargetIds ?? [] }
          : {}),
        ...(action.open !== undefined ? { open: action.open } : {}),
        ...(sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel }
          : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
      }
    );
  },
  turn_face_down: (ctx) =>
    resolveTurnFaceDown(
      ctx.state,
      ctx.resolvedTargetIds ?? [],
      ctx.action.resolution,
      ctx.getCardDefinitionById
    ),
  grant_deck_hand_access: (ctx) =>
    registerCardAccessRule(
      ctx.state,
      ctx.sourceInstanceId,
      ctx.actingPlayerId,
      ctx.action,
      ctx.effect,
      ctx.effectMeta.provenance
    ),
  grant_magic_use: (ctx) =>
    registerCardAccessRule(
      ctx.state,
      ctx.sourceInstanceId,
      ctx.actingPlayerId,
      ctx.action,
      ctx.effect,
      ctx.effectMeta.provenance
    ),
  require_effect_cost: (ctx) =>
    registerCardAccessRule(
      ctx.state,
      ctx.sourceInstanceId,
      ctx.actingPlayerId,
      ctx.action,
      ctx.effect,
      ctx.effectMeta.provenance
    ),
  peek_deck: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
    } = ctx;
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    const v1Action: PeekDeckAction = {
      kind: "peek_deck",
      count: action.count,
      revealTo: action.revealTo,
      ...(action.player
        ? { targetPlayer: action.player as EffectPlayerRef }
        : {}),
    };
    return executePeekDeck(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      sourcePreventionLevel ?? "none",
      sourcePreventionBypass
    );
  },
  shuffle_zone: (ctx) => {
    const { action, state, actingPlayerId } = ctx;
    const v1Action: ShuffleZoneAction = {
      kind: "shuffle_zone",
      zone: action.zone,
      ...(action.player
        ? { targetPlayer: action.player as EffectPlayerRef }
        : {}),
    };
    return executeShuffleZone(state, actingPlayerId, v1Action);
  },
  summon: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
      step,
    } = ctx;
    const { summonPaymentSources, summonEnterFieldCorePlacements } =
      ctx.corePayment;
    // engine-summon-cause-conditional-cost-tax (BSTH02-C02): この summon step が
    // バースト効果解決中 (effectActionKind==="burst_activation") か、それ以外のカード効果か。
    // 通常召喚 (playHandCardWithPlacement 経由) はこの native handler 自体を通らないため、
    // ここに到達する時点で常に "effect" または "burst" のいずれか。
    const summonCause: "effect" | "burst" =
      ctx.effectMeta.effectActionKind === "burst_activation"
        ? "burst"
        : "effect";
    if (action.target.kind === "self") {
      const costMod = action.costModifier;
      const selfTarget = action.target;
      const activationZone = ctx.continuationMeta.activationZone;
      const activationZoneAsSummonZone =
        activationZone === "hand" ||
        activationZone === "set_aside" ||
        activationZone === "trash"
          ? activationZone
          : undefined;
      const v1Action: SummonAction = {
        ...(action.fieldCoreSourceMinimum !== undefined
          ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
          : {}),
        kind: "summon",
        target: "self",
        summonCause,
        ...(selfTarget.zone !== undefined
          ? { zone: normalizeSummonFromZoneZone(selfTarget.zone) }
          : activationZoneAsSummonZone !== undefined
            ? { zone: activationZoneAsSummonZone }
            : {}),
        ...(activationZone === "advent_source"
          ? { includeAdventSource: true }
          : {}),
        ...(activationZone === "soul_state" ? { includeSoulState: true } : {}),
        ...(selfTarget.carryOverExistingCores
          ? { carryOverExistingCores: true }
          : {}),
        ...buildSummonActionCostModifier(costMod),
        ...(action.onBoardCoreSourceFilter !== undefined
          ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
          : {}),
        ...(action.ignoreSummonCondition
          ? { ignoreSummonCondition: true }
          : {}),
        ...(action.suppressThirdPartySummonObservation
          ? { suppressThirdPartySummonObservation: true }
          : {}),
        ...(action.enterFieldEventKind !== undefined
          ? { enterFieldEventKind: action.enterFieldEventKind }
          : {}),
        ...(action.effectScope !== undefined
          ? { effectScope: action.effectScope }
          : {}),
      };
      const summonedState = executeSummon(
        state,
        ctx.continuationMeta.chainId,
        actingPlayerId,
        v1Action,
        sourceInstanceId,
        getCardDefinitionById,
        summonPaymentSources,
        summonEnterFieldCorePlacements,
        undefined,
        ctx.effectMeta.battleEndDeferralAttackId,
        ctx.effectMeta.provenance?.effectIndex,
        ctx.continuationMeta.activationZone,
        stepCtx.allowPendingPayCostSourceAllocation === true,
        ctx.effect.timing,
        undefined,
        ctx.continuationMeta.summonPreCostCombineHostInstanceId,
        ctx
      );
      return queueInlineEffectSummonEnterFieldTriggers(
        ctx,
        state,
        summonedState,
        ctx.effectMeta.provenance?.effectIndex
      );
    }
    if (action.target.kind === "from_token_pool") {
      if (
        action.target.source === "self" &&
        !state.cardInstances.some(
          (card) =>
            card.instanceId === sourceInstanceId && card.zone === "token_pool"
        )
      )
        return state;
      if (action.target.allRelatedTokens) {
        return executeAllRelatedTokensSummon(
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          ctx.effectMeta.provenance?.effectIndex
        );
      }
      const tokenCount = resolveCountToNumber(
        action.target.count,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
      return executeTokenSummon(
        state,
        ctx.continuationMeta.chainId,
        actingPlayerId,
        tokenCount,
        action.costModifier,
        action.trashCoreMax,
        action.trashCoreKind,
        action.voidCoreMaxPerCard,
        sourceInstanceId,
        getCardDefinitionById,
        action.disableAutoReserveFieldCores,
        ctx.effectMeta.provenance?.effectIndex,
        summonPaymentSources,
        action.target.source === "self"
          ? state.cardInstances.find(
              (card) =>
                card.instanceId === sourceInstanceId &&
                card.zone === "token_pool"
            )
          : undefined
      );
    }
    if (action.target.kind === "ref") {
      const refTarget = action.target;
      const stepResult = getStepResult(stepCtx, refTarget.stepId);
      return executeRefSummon(
        state,
        actingPlayerId,
        { ...action, target: refTarget },
        getCardDefinitionById,
        stepResult?.affectedCardInstanceIds ?? [],
        sourceInstanceId
      );
    }
    // from_zone
    const summonTarget = action.target;
    // 魂状態カード召喚 (rule 08a:152): filter.soulState==="only" は魂状態カード
    // (フィールド据え置き / soulStateInstanceIds 登録) を専用経路で召喚する。
    // 通常の zone 探索 (hand/set_aside/trash) では拾えないため早期分岐する。
    if (summonTarget.filter?.soulState === "only") {
      return executeSoulStateSummon(
        state,
        ctx.continuationMeta.chainId,
        actingPlayerId,
        summonTarget.filter,
        action.costModifier,
        sourceInstanceId,
        getCardDefinitionById,
        resolvedTargetIds,
        summonEnterFieldCorePlacements,
        step?.connector === "conditional_cost" ? stepCtx.originalState : state,
        summonPaymentSources,
        action.onBoardCoreSourceFilter,
        summonCause
      );
    }
    const zones = Array.isArray(summonTarget.zone)
      ? summonTarget.zone
      : [summonTarget.zone];
    // v1 zone は "hand" | "set_aside" | "trash" | "hand_or_set_aside" |
    // "hand_or_trash" | "hand_or_set_aside_or_trash"
    let zoneStr:
      | "hand"
      | "set_aside"
      | "trash"
      | "hand_or_set_aside"
      | "hand_or_trash"
      | "hand_or_set_aside_or_trash";
    if (zones.length === 1) {
      zoneStr = zones[0] as "hand" | "set_aside" | "trash";
    } else {
      const sorted = [...zones].sort();
      zoneStr = sorted.join("_or_") as typeof zoneStr;
    }
    // ENGINE-summon-from-zone-range-count-preselected-ids-truncated-to-min:
    // count:{min,max} レンジは resolveCountToNumber が常に min (多くは0) を返すため、
    // 明示選択 (resolvedTargetIds、プレイヤーが実際に選んだ対象) があるときにそれを使うと
    // 選択自体が無音で切り詰められる。native-target-resolution.ts の applyActionTargetCount
    // が filter ターゲットで採る「明示選択があれば count で切り詰めず選択を信頼する」規約と
    // 揃え、resolvedTargetIds があればその件数を優先する。
    const summonCount =
      resolvedTargetIds !== undefined && resolvedTargetIds.length > 0
        ? resolvedTargetIds.length
        : resolveCountToNumber(
            summonTarget.count,
            state,
            actingPlayerId,
            stepCtx,
            getCardDefinitionById
          );

    // BSTH02.7-C06 branch2: 「除外したカードN枚につき、召喚対象1体のコストを0にする」型の
    // グループ化コストオーバーライド。召喚対象 (toSummonIds) が確定済みで除外候補が
    // 存在するとき、即座には召喚せず pendingGroupedSummonCostOverrideChoice を開く
    // (P3-88 pendingCoreCountSelection と同型の「アクション実行内で追加選択を要求」パターン)。
    // 解決は applyPendingGroupedSummonCostOverrideChoiceAction が executeSummonOther を
    // 直接呼び出して完結させる（この handler へは戻らない）。
    if (action.groupedExcludeOverride) {
      const toSummonIds =
        resolvedTargetIds !== undefined
          ? resolvedTargetIds.slice(0, summonCount)
          : [];
      if (toSummonIds.length > 0) {
        const grouped = action.groupedExcludeOverride;
        const candidateCardInstanceIds =
          getGroupedSummonCostOverrideCandidateIds(
            state,
            actingPlayerId,
            grouped.sourceZone,
            grouped.filter,
            getCardDefinitionById
          );
        if (candidateCardInstanceIds.length > 0) {
          const sourceDefinitionId =
            state.cardInstances.find((c) => c.instanceId === sourceInstanceId)
              ?.definitionId ?? "dsl-unknown";
          return {
            ...state,
            pendingGroupedSummonCostOverrideChoice: {
              chainId: ctx.continuationMeta.chainId,
              pendingId: `gscoc-${groupedSummonCostOverridePendingSequence++}`,
              actingPlayerId,
              sourceInstanceId,
              sourceDefinitionId,
              summonTargetInstanceIds: toSummonIds,
              candidateCardInstanceIds,
              maxCount: grouped.maxCount,
              groupSize: grouped.groupSize,
              overrideCost: grouped.overrideCost,
              ...(action.costModifier === "full_reduction"
                ? { nonOverrideFullReduction: true }
                : {}),
            },
          };
        }
      }
    }

    const costMod = action.costModifier;
    const v1Action: SummonAction = {
      ...(action.fieldCoreSourceMinimum !== undefined
        ? { fieldCoreSourceMinimum: action.fieldCoreSourceMinimum }
        : {}),
      kind: "summon",
      target: "other",
      zone: zoneStr,
      count: summonCount,
      summonCause,
      ...(summonTarget.filter ? { filter: summonTarget.filter } : {}),
      ...buildSummonActionCostModifier(costMod),
      ...(action.onBoardCoreSourceFilter !== undefined
        ? { onBoardCoreSourceFilter: action.onBoardCoreSourceFilter }
        : {}),
      ...(action.trashCoreMax !== undefined
        ? { trashCoreMax: action.trashCoreMax }
        : {}),
      ...(action.trashCoreKind !== undefined
        ? { trashCoreKind: action.trashCoreKind }
        : {}),
      ...(summonTarget.includeAdventSource
        ? { includeAdventSource: true }
        : {}),
      ...(summonTarget.includeSoulState ? { includeSoulState: true } : {}),
      // engine-advent-source-leave-summon (BSSG01-C08 Lv2): 離脱トリガーが保持する
      // 煌臨元チェーンの instanceId に候補を制限する。
      ...(summonTarget.restrictToTriggerLeaveAdventSource
        ? {
            restrictToInstanceIds: stepCtx.triggerAdventSourceInstanceIds ?? [],
          }
        : {}),
      ...(action.suppressPlacementOracle
        ? { suppressPlacementOracle: true }
        : {}),
      ...(action.ignoreSummonCondition ? { ignoreSummonCondition: true } : {}),
      ...(action.enterFieldEventKind !== undefined
        ? { enterFieldEventKind: action.enterFieldEventKind }
        : {}),
      ...(action.effectScope !== undefined
        ? { effectScope: action.effectScope }
        : {}),
    };
    const summonedState = executeSummon(
      state,
      ctx.continuationMeta.chainId,
      actingPlayerId,
      v1Action,
      sourceInstanceId,
      getCardDefinitionById,
      summonPaymentSources,
      summonEnterFieldCorePlacements,
      resolvedTargetIds,
      ctx.effectMeta.battleEndDeferralAttackId,
      ctx.effectMeta.provenance?.effectIndex,
      undefined,
      undefined,
      ctx.effect.timing,
      undefined,
      ctx.continuationMeta.summonPreCostCombineHostInstanceId,
      ctx
    );
    return queueInlineEffectSummonEnterFieldTriggers(
      ctx,
      state,
      summonedState,
      ctx.effectMeta.provenance?.effectIndex
    );
  },
  // 「出す」は召喚と同じ場入り・維持コア配置パイプラインを共有するが、
  // event classification は必ず put に固定する。カード DSL 側へ内部フラグを漏らさない。
  put: (ctx) => {
    const result = NATIVE_ACTION_HANDLERS.summon({
      ...ctx,
      action: { ...ctx.action, kind: "summon", enterFieldEventKind: "put" },
    } as NativeActionContext & { action: Extract<Action, { kind: "summon" }> });
    if (
      !ctx.action.requireDirectCombineWithTrigger ||
      !result?.pendingMultiPlacement
    )
      return result;
    const braveInstanceId = ctx.stepCtx.triggerRelatedInstanceId;
    const targets = result.pendingMultiPlacement.targets;
    if (!braveInstanceId || targets.length !== 1)
      throw new Error(
        "Direct-combine put requires one host and a summon trigger"
      );
    return {
      ...result,
      pendingMultiPlacement: {
        ...result.pendingMultiPlacement,
        excludedFieldSourceIds: [braveInstanceId, targets[0]!.instanceId],
        directCombineRequirement: {
          braveInstanceId,
          hostInstanceId: targets[0]!.instanceId,
        },
      },
    };
  },
  // ENGINE-sequential-slot-choice (BSSL01-X01[5,6]): 「合計N体まで、トークンを出すか
  // 通常召喚できる(対象ごとに独立択一)」。pending 生成のみ (継続情報は effect-interpreter.ts が
  // 事後付与、core_move splitDestinations と同型パターン)。
  split_field_entry_choice: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect,
    } = ctx;
    const summonCause: "effect" | "burst" =
      ctx.effectMeta.effectActionKind === "burst_activation"
        ? "burst"
        : "effect";
    return executeSplitSummonChoice(
      state,
      ctx.continuationMeta.chainId,
      actingPlayerId,
      action,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect.timing,
      summonCause
    );
  },
  // ENGINE-effect-triggered-advent-declare (BSDB01-R01/R02): 他効果の steps 内から
  // 名前指定カードを効果本文の位置へ契約煌臨させる。「隣」は共有煌臨元の反対側 (08a6)。
  advent: (ctx) => {
    const {
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      action,
    } = ctx;
    const adventCardInstanceId = (resolvedTargetIds ?? [])[0];
    if (!adventCardInstanceId || isAdventRestricted(state, actingPlayerId))
      return state;
    const adventCard = getCardById(state, adventCardInstanceId);
    if (!adventCard) return state;
    const adventDef = getCardDefinitionById(adventCard.definitionId);
    if (!adventDef?.adventData) {
      return {
        ...state,
        log: [
          ...state.log,
          `effect:advent:${adventCardInstanceId}:no-advent-data`,
        ],
      };
    }
    const adjacent =
      action.placement === "adjacent"
        ? getAdjacentAdventDestination(
            state,
            sourceInstanceId,
            adventDef,
            actingPlayerId,
            getCardDefinitionById
          )
        : undefined;
    if (action.placement === "adjacent" && !adjacent) return state;
    // 効果本文が指定した煌臨なので本人の通常宣言条件は流用しない。
    // 「隣」の位置と共有元の存在は上で再評価し、ゾーンは実際の選択元に従う。
    const { adventTiming, soulCoreDest, adventVariant, adventCondition } =
      adventDef.adventData;
    const execAdventData: AdventData = {
      ...(adjacent?.chargeCores || adventDef.adventData.chargeCoresOnAdvent
        ? { chargeCoresOnAdvent: true }
        : {}),
      ...(adventDef.adventData.beforeAdventSourceAddition
        ? {
            beforeAdventSourceAddition:
              adventDef.adventData.beforeAdventSourceAddition,
          }
        : {}),
      adventCondition: { targetCategory: adventCondition.targetCategory },
      adventTiming,
      soulCoreDest,
      ...(adventVariant !== undefined ? { adventVariant } : {}),
      adventSourceZone: adventCard.zone === "trash" ? "trash" : "hand",
    };
    const adventMode = adventVariant ?? "normal";
    const afterAdvent = executeEffectAdvent(
      state,
      actingPlayerId,
      {
        adventCardInstanceId,
        targetInstanceId: adjacent?.target.instanceId ?? sourceInstanceId,
        adventData: execAdventData,
        isContractAdvent:
          adventMode === "contract" || adventMode === "f_contract",
        isFContractAdvent: adventMode === "f_contract",
        useAlternateCost: action.useAlternateCost === true,
        allowAdventSourceTarget: adjacent !== undefined,
      },
      getCardDefinitionById
    );
    return afterAdvent;
  },
  move_card: (ctx) => {
    const pending = queueActionCountSelection(ctx);
    if (pending) return pending;
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
    } = ctx;
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    return executeMoveCard(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourcePreventionBypass,
      { ...ctx.corePayment, effectTiming: ctx.effect.timing }
    );
  },
  borrow_magic_effect: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      getCardDefinitionById,
      resolvedTargetIds,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getRegisteredMagicActions,
    } = ctx;
    // action.borrowedEffectPreventionLevel（借用先効果の実行だけに適用するスコープ）を
    // effect 全体の sourcePreventionLevel（この borrow_magic_effect 自身の発動可否まで
    // unpreventable 化してしまう）より優先する。BSRK01-X02「この効果で発揮する…効果は、
    // 相手の効果を受けない」の主語（借用先の被借用効果）を超えないため
    // (adversarial verifier 2026-07-26 refute 対応)。
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    return executeBorrowMagicEffect(
      state,
      ctx.continuationMeta.chainId,
      actingPlayerId,
      action,
      getCardDefinitionById,
      resolvedTargetIds,
      executeEffect,
      getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions,
      action.borrowedEffectPreventionLevel ?? sourcePreventionLevel,
      sourcePreventionBypass,
      ({
        state: useState,
        sourceInstanceId: magicInstanceId,
        effect: borrowedEffect,
        effectIndex,
        sourcePreventionLevel: borrowedPreventionLevel,
        sourcePreventionBypass: borrowedPreventionBypass,
      }) => {
        const magicCard = getCardById(useState, magicInstanceId);
        const magicDefinition = magicCard
          ? getCardDefinitionById(magicCard.definitionId)
          : undefined;
        if (!magicCard || !magicDefinition) return useState;
        const magicTiming =
          borrowedEffect.timing.kind === "activated" &&
          borrowedEffect.timing.mode !== "any"
            ? borrowedEffect.timing.mode
            : "flash";
        const magicRegistration = getRegisteredMagicActions?.(
          magicDefinition.cardNo
        )?.find(
          (registration) =>
            registration.timing === magicTiming &&
            registration.effectIndex === effectIndex
        );

        // `treatAsMagicUse` は借用対象を通常のマジックとして「宣言」する経路である。
        // 登録 lookup が未配線だったり、対象 effect に一致する登録がなければ、通常の
        // use_magic が候補に出せないのと同じく fail-closed にする。ここで hand /
        // set_aside の既定値へフォールバックすると、登録固有の condition / timingScope /
        // usageLimit を飛ばしてしまう。
        if (!magicRegistration) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_declaration_unavailable:${magicDefinition.cardNo}:${effectIndex}`,
            ],
          };
        }

        // `treatAsMagicUse` は通常マジックの宣言として扱うため、マジックそのものへ
        // 適用される使用禁止・タイミング制約を借用でも省略しない。外側の効果が
        // アタック時に合法でも、借用先のフラッシュが禁止中/固有時機外なら
        // conditional_cost の効果側を不成立にして支払いを巻き戻す。
        if (
          isCardUseRestricted(
            useState,
            actingPlayerId,
            magicCard,
            magicDefinition,
            getCardDefinitionById,
            "magic"
          )
        ) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_use_restricted:${magicDefinition.cardNo}`,
            ],
          };
        }
        if (
          magicTiming === "flash" &&
          !filterRestrictedTimings(
            ["flash"],
            useState,
            actingPlayerId,
            undefined,
            getCardDefinitionById,
            undefined,
            magicCard.zone,
            undefined,
            undefined,
            evaluateCondition
          ).includes("flash")
        ) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_flash_restricted:${magicDefinition.cardNo}:${magicCard.zone}`,
            ],
          };
        }
        if (
          !isTimingScopeActive(
            magicRegistration.timingScope,
            useState.step,
            useState.activePlayerId,
            magicCard.controllerPlayerId,
            useState.window === "step_end" ? "end" : undefined
          )
        ) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_timing_scope_unmet:${magicDefinition.cardNo}:${effectIndex}`,
            ],
          };
        }
        if (
          magicRegistration.usageLimit !== undefined &&
          !canUseEffectByUsageLimit({
            sourceEffect: magicDefinition.effects?.[effectIndex],
            state: useState,
            sourceInstanceId: magicInstanceId,
            sourceDefinitionId: magicCard.definitionId,
            getCardDefinitionById,
            effectLabel: "magic",
            usageLimit: magicRegistration.usageLimit,
            ...(magicRegistration.limitGroupId
              ? { groupId: magicRegistration.limitGroupId }
              : {}),
          })
        ) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_usage_limit_reached:${magicDefinition.cardNo}:${effectIndex}`,
            ],
          };
        }

        // 借用使用も通常の magic registration の発動条件を通す。ここを effect 本文の
        // 実行時判定だけにすると、通常の use_magic では提示されないカードを in_use へ
        // 先に移せてしまい、使用誘発まで発生する。
        if (
          magicRegistration.condition?.length &&
          !evaluateCondition(
            useState,
            magicRegistration.condition,
            magicInstanceId,
            actingPlayerId,
            getCardDefinitionById
          )
        ) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_registration_condition_unmet:${magicDefinition.cardNo}:${effectIndex}`,
            ],
          };
        }

        const allowedSourceZones =
          getRegisteredMagicActionAllowedZones(magicRegistration);
        if (!allowedSourceZones.includes(magicCard.zone)) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_source_zone_unavailable:${magicDefinition.cardNo}:${magicCard.zone}`,
            ],
          };
        }

        const dynamicPreventionBypass = getEffectSourceTribePreventionBypass(
          useState,
          magicInstanceId,
          actingPlayerId,
          getCardDefinitionById
        );
        const registeredPreventionLevel =
          dynamicPreventionBypass?.kind === "all_effects"
            ? "unpreventable"
            : magicRegistration.preventionLevel;
        const registeredPreventionBypass =
          dynamicPreventionBypass?.kind === "all_effects"
            ? undefined
            : mergeTargetLockBypassProfiles(
                magicRegistration.targetLockBypass,
                dynamicPreventionBypass
              );
        const effectivePreventionLevel =
          borrowedPreventionLevel ?? registeredPreventionLevel;
        const effectivePreventionBypass = mergeTargetLockBypassProfiles(
          registeredPreventionBypass,
          borrowedPreventionBypass
        );

        // choice を持つマジックは、通常の use_magic と同じく有効な枝だけを
        // スタック窓後の選択へ渡す。choice 条件・必須コスト・conditional_cost の
        // pre-gate をここで揃え、利用不能な枝を選べないようにする。
        const declarationChoiceIndexes: Array<number | undefined> =
          magicRegistration.choices !== undefined
            ? magicRegistration.choices.map((_, choiceIndex) => choiceIndex)
            : [undefined];
        const eligibleDeclarationChoices = declarationChoiceIndexes.filter(
          (choiceIndex) => {
            const variantRegistration =
              choiceIndex !== undefined
                ? mergeRegistrationChoiceVariant(
                    magicRegistration,
                    magicRegistration.choices![choiceIndex]!
                  )
                : magicRegistration;
            const choiceCondition =
              choiceIndex !== undefined
                ? getChoiceStepCondition(
                    magicDefinition,
                    effectIndex,
                    choiceIndex
                  )
                : undefined;
            if (
              choiceCondition?.length &&
              !evaluateCondition(
                useState,
                choiceCondition,
                magicInstanceId,
                actingPlayerId,
                getCardDefinitionById
              )
            ) {
              return false;
            }
            const variantUsageLimit =
              choiceIndex !== undefined
                ? magicRegistration.choices?.[choiceIndex]?.usageLimit
                : undefined;
            if (
              variantUsageLimit !== undefined &&
              choiceIndex !== undefined &&
              !canUseEffectByUsageLimit({
                sourceEffect: magicDefinition.effects?.[effectIndex],
                state: useState,
                sourceInstanceId: magicInstanceId,
                sourceDefinitionId: magicDefinition.cardNo,
                getCardDefinitionById,
                effectLabel: getChoiceVariantUsageLabel("magic", choiceIndex),
                usageLimit: variantUsageLimit,
              })
            ) {
              return false;
            }
            if (
              variantRegistration !== undefined &&
              !canPayRequiredEffectCosts(
                useState,
                actingPlayerId,
                variantRegistration,
                getCardDefinitionById,
                getRequiredCostSourceTribesForCard(
                  useState,
                  magicCard,
                  magicDefinition,
                  getCardDefinitionById
                ),
                {
                  evaluateCondition: (
                    condition,
                    sourceInstanceId,
                    conditionActingPlayerId
                  ) =>
                    evaluateCondition(
                      useState,
                      condition,
                      sourceInstanceId,
                      conditionActingPlayerId,
                      getCardDefinitionById
                    ),
                },
                {
                  sourceInstanceId: magicInstanceId,
                  sourceDefinition: magicDefinition,
                  sourceDefinitionId: magicDefinition.cardNo,
                  effectIndex,
                  ...(effectivePreventionLevel !== undefined
                    ? { sourcePreventionLevel: effectivePreventionLevel }
                    : {}),
                  ...(effectivePreventionBypass !== undefined
                    ? {
                        sourceTargetLockBypass: effectivePreventionBypass,
                        sourcePreventionBypass: effectivePreventionBypass,
                      }
                    : {}),
                }
              )
            ) {
              return false;
            }
            return (
              variantRegistration === undefined ||
              !isConditionalCostBlocked({
                state: useState,
                actingPlayerId,
                sourceCard: magicCard,
                sourceDefinition: magicDefinition,
                sourceKind: "magic",
                resolutionKind: "magic_action",
                composition: variantRegistration.composition,
                effect: borrowedEffect,
                effectIndex: variantRegistration.effectIndex,
                choiceIndex,
                ...(effectivePreventionLevel !== undefined
                  ? { sourcePreventionLevel: effectivePreventionLevel }
                  : {}),
                ...(effectivePreventionBypass !== undefined
                  ? {
                      sourceTargetLockBypass: effectivePreventionBypass,
                      sourcePreventionBypass: effectivePreventionBypass,
                    }
                  : {}),
                effectActionKind: "magic",
                getCardDefinitionById,
                getRegisteredTriggeredEffectActions:
                  getRegisteredTriggeredEffectActions ?? (() => []),
                getRegisteredBurstActions,
                getConditionalCostCanExecuteCheck: undefined,
              })
            );
          }
        );
        if (eligibleDeclarationChoices.length === 0) {
          return {
            ...useState,
            log: [
              ...useState.log,
              `borrow_magic_effect:magic_declaration_unavailable:${magicDefinition.cardNo}:${effectIndex}`,
            ],
          };
        }

        const magicUsageLimit = magicRegistration.usageLimit;
        const stateAfterMagicUsageRecord = recordEffectUsageIfLimited({
          state: useState,
          sourceInstanceId: magicInstanceId,
          sourceDefinitionId: magicDefinition.cardNo,
          effectLabel: "magic",
          usageLimit: magicUsageLimit,
          ...(magicRegistration.limitGroupId
            ? { groupId: magicRegistration.limitGroupId }
            : {}),
        });
        const magicRecordedUsage = composeRecordedUsage([
          magicUsageLimit
            ? {
                effectLabel: "magic",
                usageLimit: magicUsageLimit,
                ...(magicRegistration.limitGroupId
                  ? { groupId: magicRegistration.limitGroupId }
                  : {}),
              }
            : undefined,
        ]);
        const magicNegatePreventionLevel =
          resolveDynamicStackNegatePreventionLevel({
            state: stateAfterMagicUsageRecord,
            sourceInstanceId: magicInstanceId,
            actingPlayerId,
            getCardDefinitionById,
          });
        // BSTH02.7-TX01(B) の「コア1個を支払うことで…ただちに使用できる」は、
        // 直前の pay_cost が固定コストを支払い済み。ここでは通常のマジック宣言を
        // 無償で通すことで、in_use・flash使用記録・使用前トリガーを一つの SSOT に
        // 集約する。効果そのものは activeStack.magicEffectIndex で借用対象だけに限定。
        const declared = useMagicCardInFlashContextAsAction({
          state: stateAfterMagicUsageRecord,
          actingPlayerId,
          magicInstanceId,
          allowedSourceZones,
          paymentSources: [],
          withoutCost: true,
          chosenTiming: magicTiming,
          ...(magicRegistration.activationLabel
            ? { activationLabel: magicRegistration.activationLabel }
            : magicTiming === "flash"
              ? { activationLabel: "flash" }
              : {}),
          effectIndex,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            getRegisteredTriggeredEffectActions ?? (() => []),
          getRegisteredBurstActions,
          ...(effectivePreventionLevel !== undefined
            ? { sourcePreventionLevel: effectivePreventionLevel }
            : {}),
          ...(effectivePreventionBypass !== undefined
            ? { sourcePreventionBypass: effectivePreventionBypass }
            : {}),
          ...(magicRegistration?.choices !== undefined
            ? {
                deferredChoiceIndexes: eligibleDeclarationChoices.filter(
                  (choiceIndex): choiceIndex is number =>
                    choiceIndex !== undefined
                ),
              }
            : {}),
        });
        const stack = {
          ...declared.activeStack,
          ...(magicRegistration?.reevaluationPoints?.length
            ? { reevaluationPoints: magicRegistration.reevaluationPoints }
            : {}),
          ...(magicRegistration?.suppressionEffectDescriptor
            ? {
                suppressionEffectDescriptor:
                  magicRegistration.suppressionEffectDescriptor,
              }
            : {}),
          ...(effectivePreventionLevel !== undefined
            ? { preventionLevel: effectivePreventionLevel }
            : {}),
          ...(effectivePreventionBypass !== undefined
            ? { preventionBypass: effectivePreventionBypass }
            : {}),
          ...(magicNegatePreventionLevel !== undefined
            ? { negatePreventionLevel: magicNegatePreventionLevel }
            : {}),
          ...(magicRegistration?.composition
            ? { composition: magicRegistration.composition }
            : {}),
          ...(magicRecordedUsage !== undefined
            ? { recordedUsage: magicRecordedUsage }
            : {}),
        };
        return openEffectUseResponseWindow(
          declared.state,
          stack,
          actingPlayerId
        );
      }
    );
  },
  borrow_card_event_effect: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      getRegisteredTriggeredEffectActions,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourcePreventionBypass,
      pendingStackNegateCandidate,
    } = ctx.effectMeta;
    return executeBorrowCardEventEffect(
      state,
      ctx.continuationMeta.chainId,
      actingPlayerId,
      sourceInstanceId,
      action,
      getCardDefinitionById,
      resolvedTargetIds,
      executeEffect,
      getRegisteredTriggeredEffectActions ?? (() => []),
      sourcePreventionLevel,
      sourcePreventionBypass,
      pendingStackNegateCandidate,
      ctx.effectMeta.battleEndDeferralAttackId,
      ctx.getRegisteredBurstActions
    );
  },
  under_card_trigger_inherit: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
      getRegisteredTriggeredEffectActions,
    } = ctx;
    return executeUnderCardTriggerInherit(
      state,
      ctx.continuationMeta.chainId,
      actingPlayerId,
      action,
      getCardDefinitionById,
      resolvedTargetIds,
      sourceInstanceId,
      executeEffect,
      getRegisteredTriggeredEffectActions ?? (() => []),
      ctx.getRegisteredBurstActions
    );
  },
  // ENGINE-conditional-free-magic-use-on-event: 手札の game_event 誘発「コストを支払わずに
  // 使用できる」の唯一 step。P3-34 により誘発効果の resolve_pending_triggered_effect は
  // このステップ実行前に必ずスタック窓を開くため、ここでは同期解決でよい（二重スタック回避）。
  // ENGINE-conditional-free-magic-use-target-selection: 本体効果が「N体まで」等の対象選択を
  // 要する場合は resolveDeferredStackForFreeMagicUse (synthetic ActiveStack 経由) が
  // pendingEffectTargetSelection を生成する。未配線の呼び出し元 (burst-system.ts 等) では
  // undefined のまま従来の同期解決にフォールバックする。
  use_magic_without_cost: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      resolveDeferredStackForFreeMagicUse,
      getRegisteredMagicActions,
      stepCtx,
    } = ctx;
    const { sourcePreventionLevel, negatePreventionLevel } = ctx.effectMeta;
    const activationZone = ctx.continuationMeta.activationZone;
    const magicActivationZone =
      activationZone === "hand" ||
      activationZone === "set_aside" ||
      activationZone === "trash" ||
      activationZone === "field"
        ? activationZone
        : undefined;
    const allowedSourceZones: Zone[] =
      magicActivationZone !== undefined &&
      magicActivationZone !== "hand" &&
      magicActivationZone !== "set_aside"
        ? ["hand", "set_aside", magicActivationZone]
        : ["hand", "set_aside"];
    // ENGINE-leave-field-free-use-stay-on-field-flush-gate: 三者観測 game_event の主語 Y
    // (このステップ自身の stepCtx.triggerRelatedInstanceId(s)、effect-resolution.ts 経由で
    // 既に注入済み) を、別 effectIndex (flash 本体) の発揮解決まで引き継ぐ。
    return useMagicCardWithoutPayingCostAsAction({
      state,
      actingPlayerId,
      magicInstanceId: sourceInstanceId,
      magicTiming: action.magicTiming,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions: undefined,
      allowedSourceZones,
      ...(magicActivationZone !== undefined
        ? { activationZone: magicActivationZone }
        : {}),
      ...(sourcePreventionLevel !== undefined ? { sourcePreventionLevel } : {}),
      ...(negatePreventionLevel !== undefined ? { negatePreventionLevel } : {}),
      ...(resolveDeferredStackForFreeMagicUse
        ? { resolveDeferredStackForFreeMagicUse }
        : {}),
      ...(getRegisteredMagicActions ? { getRegisteredMagicActions } : {}),
      ...(stepCtx.triggerRelatedInstanceId !== undefined
        ? { triggerRelatedInstanceId: stepCtx.triggerRelatedInstanceId }
        : {}),
      ...(stepCtx.triggerRelatedInstanceIds !== undefined
        ? { triggerRelatedInstanceIds: stepCtx.triggerRelatedInstanceIds }
        : {}),
    }).state;
  },
  set_burst: (ctx) => {
    const sourceInstanceId = ctx.resolvedTargetIds?.[0];
    if (!sourceInstanceId) return ctx.state;
    const options = {
      state: ctx.state,
      actingPlayerId: ctx.actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById: ctx.getCardDefinitionById,
      settingMode: "effect" as const,
    };
    if (getBurstSetBlockReason(options) !== null) return ctx.state;
    return useSetBurstAsAction(options).state;
  },
  set_self_as_mirage: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    // ENGINE-mirage-set-target-primitive: action.target 指定時、対象が0件に解決された
    // なら何もしない（noop ハンドラと同じ規約。sourceInstanceId へのフォールバックは
    // ref_executed ゲートを壊すため行わない）。
    if (action.target !== undefined && (resolvedTargetIds ?? []).length === 0) {
      return state;
    }
    const targetInstanceId =
      action.target !== undefined ? resolvedTargetIds?.[0] : undefined;
    return executeSetSelfAsMirage(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      targetInstanceId
    );
  },
  core_move: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      effect,
      resolvedTargetIds,
      step,
    } = ctx;
    const {
      coreShootDistribution,
      coreShootSoulCoreInstanceId,
      coreDistributionAllocations,
      coreDistributionSoulCoreInstanceId,
      coreDistributionSoulCoreAllocations,
      coreSourceAllocations,
      coreSourceSoulCoreInstanceId,
    } = ctx.corePayment;
    const {
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      coreMoveAmountBonusOverride,
      battleEndDeferralAttackId,
    } = ctx.effectMeta;
    const actionStepId =
      step?.id ?? (provenance ? `__step_${provenance.stepIndex}` : undefined);
    const requireFullCoreCount =
      action.requireFullCount === true ||
      (provenance !== undefined &&
        effect.steps[provenance.stepIndex + 1]?.connector ===
          "conditional_cost");
    const effectSourceInstanceId =
      ctx.effectMeta.effectSourceInstanceId ??
      provenance?.effectSourceInstanceId;
    const effectSourceDefinitionId =
      ctx.effectMeta.effectSourceDefinitionId ??
      provenance?.effectSourceDefinitionId;
    const coreMoveDestinationTargetIds =
      coreMoveTargetSelectsFieldCardDestination(action) &&
      resolvedTargetIds !== undefined
        ? [...resolvedTargetIds]
        : undefined;
    // splitDestinations 指定時は pending 生成系（複数移動先への配分プレイヤー選択）
    if (action.splitDestinations) {
      return executeCoreMoveSplit(
        { ...action, requireFullCount: requireFullCoreCount },
        state,
        actingPlayerId,
        sourceInstanceId,
        getCardDefinitionById,
        stepCtx,
        effect,
        sourcePreventionLevel,
        sourceTargetLockBypass,
        sourcePreventionBypass,
        effectSourceInstanceId,
        effectSourceDefinitionId,
        battleEndDeferralAttackId
      );
    }
    // to / toTargetController 指定時は v1 EffectCoreLocation に変換して executeCoreMove 直呼び。
    // `target` が field_card 配置先を expose する場合も to は field_card のまま保ち、
    // resolvedTargetIds を executeCoreMove の候補制限として渡す。trash/life/reserve の
    // field_card 専用 handler（ソウルコア・分配 pending 対応）を外さないため。
    if (!action.to && !action.toTargetController) return state;
    if (
      action.toTargetController !== undefined &&
      action.from.kind === "target_card" &&
      (!resolvedTargetIds || resolvedTargetIds.length === 0)
    ) {
      return state;
    }

    // P3-88: amount が {min, max} 範囲（「コアN個まで」）かつ単一ソース→単一移動先の
    // とき、プレイヤーに移動コア数 (min〜max) を選ばせる pendingCoreCountSelection を生成。
    // BSTH01-X08「相手のライフのコア2個までをボイドに置く」(min=0, max=2) 等。
    if (
      typeof action.amount === "object" &&
      action.amount !== null &&
      "min" in action.amount
    ) {
      // 単一対象コアシュート/単一配置先: 選択済みの対象1体 (resolvedTargetIds[0])
      // を card_instance に束ねる。pendingCoreCountSelection に保存され、数選択解決時に
      // この1体をコア源/移動先にする。対象未確定なら従来どおり target_card/field_card
      // のまま（container 化不能）。
      const fromLoc = resolveCoreLocationForStep(
        action.from,
        stepCtx,
        resolvedTargetIds
      );
      const toLoc = resolveCoreMoveToLocationForStep(
        action,
        state,
        actingPlayerId,
        stepCtx,
        resolvedTargetIds
      );
      const fromContainer = toSimpleNormalCoreContainer(
        fromLoc,
        actingPlayerId,
        state,
        sourceInstanceId,
        /*allowLife=*/ true
      );
      const toContainer = toSimpleNormalCoreContainer(
        toLoc,
        actingPlayerId,
        state,
        sourceInstanceId,
        /*allowLife=*/ true
      );
      // 範囲境界 (min/max) を数値へ解決。DynamicCount なら盤面で評価する
      // （「自分のカウント2につき1個まで」= max:{count_value, divisor:2} 等）。
      const resolvedMin = resolveCountBound(
        action.amount.min,
        state,
        actingPlayerId,
        stepCtx,
        getCardDefinitionById
      );
      const resolvedMax =
        action.amount.max === undefined
          ? undefined
          : resolveCountBound(
              action.amount.max,
              state,
              actingPlayerId,
              stepCtx,
              getCardDefinitionById
            );
      // field/target 等 container 化できないソースは数選択非対応 → 従来解決にフォールバック。
      if (fromContainer !== null) {
        const available = getCoreCountSelectionAvailableCores(
          state,
          actingPlayerId,
          fromLoc,
          fromContainer,
          toContainer,
          getCardDefinitionById,
          sourcePreventionLevel,
          sourcePreventionBypass
        );
        // コア除去効果メタ修飾 (BSTH001-転醒R02(A) effect[1] 他):
        // fromLoc が card_instance で対象が相手カードのとき、選択可能範囲
        // (min/max) に bonus を上乗せする。bonus は available と Math.min で
        // 自然に頭打ちになる。resolve 時の executeCoreMove には
        // amountBonusOverride=0 を渡して bonus 二重加算を防ぐ。
        let coreMoveBonus = 0;
        if (fromLoc.kind === "card_instance") {
          const fromCard = state.cardInstances.find(
            (c) => c.instanceId === fromLoc.instanceId
          );
          if (fromCard && fromCard.ownerPlayerId !== actingPlayerId) {
            coreMoveBonus =
              coreMoveAmountBonusOverride !== undefined
                ? coreMoveAmountBonusOverride
                : computeCoreMoveAmountBonus(
                    state,
                    actingPlayerId,
                    sourceInstanceId,
                    getCardDefinitionById,
                    effectSourceInstanceId
                  );
          }
        }
        if (
          fromLoc.kind === "life" &&
          resolvePlayerRef(actingPlayerId, fromLoc.player, state) !==
            actingPlayerId
        ) {
          coreMoveBonus =
            coreMoveAmountBonusOverride ??
            computeLifeReductionAmountBonus(
              state,
              actingPlayerId,
              sourceInstanceId,
              effectSourceInstanceId
            );
        }
        const rangeMin = resolvedMin + coreMoveBonus;
        const rangeMax = (resolvedMax ?? available) + coreMoveBonus;
        const effectiveMax = Math.min(rangeMax, available);
        const effectiveMin = Math.min(rangeMin, effectiveMax);
        // 選択の余地が無い（min===max、available=0 等）なら直接 executeCoreMove。
        if (effectiveMax <= effectiveMin) {
          if (effectiveMin <= 0) {
            state.log.push(`effect:core_count:noop:available=${available}`);
            return state;
          }
          return executeCoreMove(
            state,
            actingPlayerId,
            fromLoc,
            toLoc,
            effectiveMin,
            sourceInstanceId,
            coreShootDistribution,
            coreShootSoulCoreInstanceId,
            getCardDefinitionById,
            effect.timing,
            coreDistributionAllocations,
            coreDistributionSoulCoreInstanceId,
            coreDistributionSoulCoreAllocations,
            sourcePreventionLevel,
            undefined, // coreShootMinTotal
            undefined, // coreSourceAllocations
            undefined, // coreSourceSoulCoreInstanceId
            undefined, // allowPendingCoreSourceAllocation
            // bonus は既に effectiveMin に反映済 → 二重加算抑止
            coreMoveAmountBonusOverride !== undefined || coreMoveBonus > 0
              ? 0
              : undefined,
            /*allowPendingLifeCoreSelection=*/ true,
            undefined,
            undefined,
            provenance?.effectIndex,
            sourceTargetLockBypass,
            actionStepId,
            undefined,
            undefined,
            sourcePreventionBypass,
            effectSourceInstanceId,
            effectSourceDefinitionId,
            undefined,
            battleEndDeferralAttackId,
            coreMoveDestinationTargetIds
          );
        }
        const sourceCard = state.cardInstances.find(
          (c) => c.instanceId === sourceInstanceId
        );
        state.log.push(
          `effect:core_count:pending:${effectiveMin}-${effectiveMax}:${fromLoc.kind}->${toLoc.kind}${
            coreMoveBonus > 0 ? `:+bonus${coreMoveBonus}` : ""
          }`
        );
        return {
          ...state,
          pendingCoreCountSelection: {
            pendingId: `ccs-${coreCountPendingSequence++}`,
            actingPlayerId,
            sourceInstanceId,
            sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
            fromLocation: fromLoc,
            toLocation: toLoc,
            min: effectiveMin,
            max: effectiveMax,
            effectTiming: effect.timing,
            ...(coreMoveBonus > 0
              ? { coreMoveAmountBonusApplied: coreMoveBonus }
              : {}),
            ...(sourcePreventionLevel !== undefined
              ? { sourcePreventionLevel }
              : {}),
            ...(provenance?.effectIndex !== undefined
              ? { sourceEffectIndex: provenance.effectIndex }
              : {}),
            ...(actionStepId !== undefined
              ? { sourceTargetStepId: actionStepId }
              : {}),
            ...(sourceTargetLockBypass !== undefined
              ? { sourceTargetLockBypass }
              : {}),
            ...(sourcePreventionBypass !== undefined
              ? { sourcePreventionBypass }
              : {}),
            ...(effectSourceInstanceId !== undefined
              ? { effectSourceInstanceId }
              : {}),
            ...(effectSourceDefinitionId !== undefined
              ? { effectSourceDefinitionId }
              : {}),
            ...(action.effectKind !== undefined
              ? { effectKind: action.effectKind }
              : {}),
            ...(coreMoveDestinationTargetIds !== undefined
              ? { coreMoveDestinationTargetIds }
              : {}),
            ...(battleEndDeferralAttackId !== undefined
              ? { battleEndDeferralAttackId }
              : {}),
            priorStateSnapshot: state,
          },
        };
      }
      // field 源「コアN個まで」: core_shoot 機構（どのカードのコアを取るか選択）に
      // under-selection (minTotal) を渡す。max を上限、min を最低取得数とする。
      // max 未指定 ({min:N}) は上限不定のため従来解決にフォールバック。
      if (fromLoc.kind === "field" && resolvedMax !== undefined) {
        return executeCoreMove(
          state,
          actingPlayerId,
          fromLoc,
          toLoc,
          resolvedMax,
          sourceInstanceId,
          coreShootDistribution,
          coreShootSoulCoreInstanceId,
          getCardDefinitionById,
          effect.timing,
          coreDistributionAllocations,
          coreDistributionSoulCoreInstanceId,
          coreDistributionSoulCoreAllocations,
          sourcePreventionLevel,
          resolvedMin,
          undefined,
          undefined,
          undefined,
          coreMoveAmountBonusOverride,
          undefined,
          undefined,
          undefined,
          provenance?.effectIndex,
          sourceTargetLockBypass,
          actionStepId,
          undefined,
          undefined,
          sourcePreventionBypass,
          effectSourceInstanceId,
          effectSourceDefinitionId,
          undefined,
          battleEndDeferralAttackId,
          coreMoveDestinationTargetIds
        );
      }
    }

    const resolvedAmounts =
      ctx.continuationMeta.resolvedCoreMoveAmounts?.stepIndex ===
      provenance?.stepIndex
        ? ctx.continuationMeta.resolvedCoreMoveAmounts?.amounts
        : undefined;
    const coreAmount =
      action.amount === "all"
        ? Infinity
        : resolveCountToNumber(
            action.amount,
            state,
            actingPlayerId,
            stepCtx,
            getCardDefinitionById,
            resolvedTargetIds
          );

    // engine-coreshoot-multi-target-void / BSKB01-TX01(A): `from: target_card` かつ
    // 対象が複数 (`core_move.target` の count>1「Nつまで」/ count:"all" 等) のとき、
    // 単一 fromLoc に束ねると resolvedTargetIds[0] 以外の対象のコアが drain されない。
    // 対象ごとに個別 executeCoreMove を直列実行し、amount:"all" だけでなく
    // 固定数の「1個ずつ」も各対象から個別に動かす。
    // count:1 の既定単一対象呼び出し (resolvedTargetIds.length<=1) は下の従来経路のまま
    // (BSTH001-X02/BSTH07-M03/BSSL01-C05 等への非破壊)。
    if (
      action.from.kind === "target_card" &&
      resolvedTargetIds &&
      resolvedTargetIds.length > 1
    ) {
      let multiState = state;
      const processedTargetIds: string[] = [];
      let movedAmount = 0;
      const groupBonus =
        !resolvedAmounts &&
        coreAmount > 0 &&
        Number.isFinite(coreAmount) &&
        resolvedTargetIds.some(
          (id) => getCardById(state, id)?.ownerPlayerId !== actingPlayerId
        )
          ? Math.max(
              0,
              coreMoveAmountBonusOverride ??
                computeCoreMoveAmountBonus(
                  state,
                  actingPlayerId,
                  sourceInstanceId,
                  getCardDefinitionById,
                  effectSourceInstanceId
                )
            )
          : 0;
      let bonusAllocations: Record<string, number> = {};
      if (groupBonus > 0) {
        const identity = resolveAffectSourceIdentity({
          state,
          sourceInstanceId,
          effectSourceInstanceId,
          effectSourceDefinitionId,
          getCardDefinitionById,
        });
        const candidates = resolvedTargetIds.flatMap((id, i) => {
          const card = getCardById(state, id);
          if (!card) return [];
          const to = resolveCoreMoveToLocationForTarget(
            action,
            state,
            actingPlayerId,
            stepCtx,
            resolvedTargetIds,
            i
          );
          const soulCount = Math.max(
            0,
            getTotalCoresOnCardById(state, id) - card.normalCoreCount
          );
          const available = getFieldCoreSourceTakeableCount(
            state,
            card,
            actingPlayerId,
            {
              ...(action.target && "filter" in action.target
                ? { filter: action.target.filter }
                : {}),
              sourceInstanceId,
              ...(sourceTargetLockBypass ? { sourceTargetLockBypass } : {}),
              soulCoresOnCard: soulCount,
              soulCoresMovable:
                to.kind !== "void" && action.effectKind !== "normal_only"
                  ? soulCount
                  : 0,
              sourcePreventionLevel: sourcePreventionLevel ?? "none",
              effectSource: {
                ...(identity.instance ? { instance: identity.instance } : {}),
                ...(identity.definition
                  ? { definition: identity.definition }
                  : {}),
              },
              getCardDefinitionById,
              ...(sourcePreventionBypass ? { sourcePreventionBypass } : {}),
            }
          );
          const extra = Math.max(0, available - coreAmount);
          return extra > 0 ? [{ instanceId: id, available: extra }] : [];
        });
        const totalAvailable = candidates.reduce(
          (sum, c) => sum + c.available,
          0
        );
        const requiredTotal = Math.min(groupBonus, totalAvailable);
        if (
          requiredTotal > 0 &&
          coreSourceAllocations === undefined &&
          candidates.length > 1 &&
          totalAvailable > requiredTotal
        ) {
          return {
            ...state,
            pendingCoreSourceAllocation: {
              pendingId:
                "core-bonus-" + state.log.length + "-" + sourceInstanceId,
              actingPlayerId,
              sourceInstanceId,
              sourceDefinitionId:
                getCardById(state, sourceInstanceId)?.definitionId ??
                "dsl-unknown",
              candidates,
              requiredTotal,
              toLocation: resolveCoreMoveToLocationForTarget(
                action,
                state,
                actingPlayerId,
                stepCtx,
                resolvedTargetIds,
                0
              ),
              effectTiming: effect.timing,
              purpose: "core_move_bonus",
            },
          };
        }
        if (coreSourceAllocations !== undefined) {
          const capacities = new Map(
            candidates.map((c) => [c.instanceId, c.available])
          );
          let total = 0;
          for (const [id, amount] of Object.entries(coreSourceAllocations)) {
            if (
              !Number.isInteger(amount) ||
              amount < 0 ||
              amount > (capacities.get(id) ?? 0)
            )
              throw new Error("Invalid additional core move allocation");
            total += amount;
          }
          if (total !== requiredTotal)
            throw new Error("Additional core move allocation total mismatch");
          bonusAllocations = coreSourceAllocations;
        } else {
          let remaining = requiredTotal;
          for (const candidate of candidates) {
            const take = Math.min(remaining, candidate.available);
            bonusAllocations[candidate.instanceId] = take;
            remaining -= take;
          }
        }
      }
      if (Object.values(bonusAllocations).some((n) => n > 0)) {
        multiState = {
          ...multiState,
          log: [
            ...multiState.log,
            "effect:core_move_amount_modifier:applied:" +
              actingPlayerId +
              ":+" +
              Object.values(bonusAllocations).reduce((a, b) => a + b, 0) +
              ":target_group",
          ],
        };
      }
      for (let i = 0; i < resolvedTargetIds.length; i++) {
        const targetId = resolvedTargetIds[i]!;
        const beforeTargetCores = getTotalCoresOnCardById(multiState, targetId);
        multiState = executeCoreMove(
          multiState,
          actingPlayerId,
          resolveCoreLocationForStep(
            action.from,
            stepCtx,
            resolvedTargetIds,
            i
          ),
          resolveCoreMoveToLocationForTarget(
            action,
            multiState,
            actingPlayerId,
            stepCtx,
            resolvedTargetIds,
            i
          ),
          resolvedAmounts?.[targetId] ??
            coreAmount + (bonusAllocations[targetId] ?? 0),
          sourceInstanceId,
          coreShootDistribution,
          coreShootSoulCoreInstanceId,
          getCardDefinitionById,
          effect.timing,
          coreDistributionAllocations,
          coreDistributionSoulCoreInstanceId,
          coreDistributionSoulCoreAllocations,
          sourcePreventionLevel,
          undefined,
          coreSourceAllocations,
          coreSourceSoulCoreInstanceId,
          /*allowPendingCoreSourceAllocation=*/ true,
          /*amountBonusOverride=*/ 0,
          /*allowPendingLifeCoreSelection=*/ true,
          undefined,
          undefined,
          provenance?.effectIndex,
          sourceTargetLockBypass,
          actionStepId,
          /*skipLifeGainReplacementChoice=*/ undefined,
          action.effectKind,
          sourcePreventionBypass,
          effectSourceInstanceId,
          effectSourceDefinitionId,
          undefined,
          battleEndDeferralAttackId
        );
        const afterTargetCores = getTotalCoresOnCardById(multiState, targetId);
        const movedFromTarget = Math.max(
          0,
          beforeTargetCores - afterTargetCores
        );
        if (movedFromTarget > 0 || multiState.pendingLifeCoreSelection) {
          processedTargetIds.push(targetId);
          movedAmount +=
            multiState.pendingLifeCoreSelection?.fromLocation.kind ===
              "card_instance" &&
            multiState.pendingLifeCoreSelection.fromLocation.instanceId ===
              targetId
              ? multiState.pendingLifeCoreSelection.totalAmount
              : movedFromTarget;
        }
        if (multiState.pendingLifeCoreSelection) {
          const continuation = buildMultiTargetCoreMoveContinuation({
            ctx: {
              ...ctx,
              continuationMeta: {
                ...ctx.continuationMeta,
                resolvedCoreMoveAmounts: {
                  stepIndex: provenance?.stepIndex ?? 0,
                  amounts:
                    resolvedAmounts ??
                    Object.fromEntries(
                      resolvedTargetIds.map((id) => [
                        id,
                        coreAmount + (bonusAllocations[id] ?? 0),
                      ])
                    ),
                },
              },
            },
            processedTargetIds,
            movedAmount,
          });
          if (continuation) {
            multiState = {
              ...multiState,
              pendingLifeCoreSelection: {
                ...multiState.pendingLifeCoreSelection,
                continuation,
              },
            };
          }
          return multiState;
        }
      }
      return multiState;
    }

    // field_card ソースのコスト支払いは effect-interpreter メインループ経由なので
    // 配分曖昧時の pendingCoreSourceAllocation 生成を許可する (continuation は
    // executeEffect 側で注入される)。
    return executeCoreMove(
      state,
      actingPlayerId,
      // 固定数の単一対象コアシュートも target_card → card_instance に束ねる
      // (源・移動先の両方)。ref (同一効果内の先行 step 参照) の解決も同経由で行う。
      resolveCoreLocationForStep(action.from, stepCtx, resolvedTargetIds),
      resolveCoreMoveToLocationForStep(
        action,
        state,
        actingPlayerId,
        stepCtx,
        resolvedTargetIds
      ),
      resolvedAmounts?.[resolvedTargetIds?.[0] ?? ""] ?? coreAmount,
      sourceInstanceId,
      coreShootDistribution,
      coreShootSoulCoreInstanceId,
      getCardDefinitionById,
      effect.timing,
      coreDistributionAllocations,
      coreDistributionSoulCoreInstanceId,
      coreDistributionSoulCoreAllocations,
      sourcePreventionLevel,
      undefined,
      coreSourceAllocations,
      coreSourceSoulCoreInstanceId,
      /*allowPendingCoreSourceAllocation=*/ true,
      resolvedAmounts ? 0 : coreMoveAmountBonusOverride,
      /*allowPendingLifeCoreSelection=*/ true,
      undefined,
      undefined,
      provenance?.effectIndex,
      sourceTargetLockBypass,
      actionStepId,
      /*skipLifeGainReplacementChoice=*/ undefined,
      action.effectKind,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
      undefined,
      battleEndDeferralAttackId,
      coreMoveDestinationTargetIds,
      requireFullCoreCount
    );
  },
  core_distribute: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
      effect,
    } = ctx;
    const {
      sourcePreventionLevel,
      sourcePreventionBypass,
      battleEndDeferralAttackId,
    } = ctx.effectMeta;
    return executeCoreDistribute(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourcePreventionBypass,
      effect.timing,
      battleEndDeferralAttackId,
      resolveAffectSourceIdentity({
        state,
        sourceInstanceId,
        effectSourceInstanceId: ctx.effectMeta.effectSourceInstanceId,
        effectSourceDefinitionId: ctx.effectMeta.effectSourceDefinitionId,
        getCardDefinitionById,
      })
    );
  },
  core_set_to_level: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
      effect,
    } = ctx;
    const { sourcePreventionLevel, sourcePreventionBypass } = ctx.effectMeta;
    return executeCoreSetToLevel(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourcePreventionBypass,
      effect.timing,
      resolveAffectSourceIdentity({
        state,
        sourceInstanceId,
        effectSourceInstanceId: ctx.effectMeta.effectSourceInstanceId,
        effectSourceDefinitionId: ctx.effectMeta.effectSourceDefinitionId,
        getCardDefinitionById,
      })
    );
  },
  pay_cost: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, stepCtx, effect } =
      ctx;
    const {
      payCostPaymentSources,
      coreSourceAllocations,
      coreSourceSoulCoreInstanceId,
    } = ctx.corePayment;
    const { provenance } = ctx.effectMeta;
    // 効果コスト「N コスト支払う」.
    // BS ルール: 支払い源は「リザーブ / 自分のフィールド上カード (スピリット / アルティメット /
    //   ネクサス / 合体ブレイヴ等、コアを保持できる任意のカード)」から自由に組合せ可能。
    // 設計: summon / magic と同じく、プレイヤーが事前に選択した paymentSources を
    //   `ExecuteEffectOptions.payCostPaymentSources` で受け取り、`applyCardCostPayments` を再利用する。
    //   対話解決は窓後に配分を選び、非対話実行も同じ合法候補から決定的に支払う。
    const payerPlayerId = action.player
      ? resolvePlayerRef(
          actingPlayerId,
          action.player as EffectPlayerRef,
          state
        )
      : actingPlayerId;
    const payer = state.players.find((p) => p.id === payerPlayerId);
    if (!payer) return state;

    const candidates = getAvailablePayCostCoreSources(
      state,
      payerPlayerId,
      ctx.getCardDefinitionById,
      effect.timing.kind === "activated" && effect.timing.mode !== "any"
        ? effect.timing.mode
        : undefined
    );

    // HUDの配分を召喚/マジックと同じ支払いプリミティブへ渡す。
    // 通常/ソウルの選択と、コスト支払い起因の消滅待機も共通処理で扱う。
    const pay = (
      paymentSources: readonly CardCostPaymentSource[]
    ): GameState => {
      if (getTotalPaymentAmount(paymentSources) !== action.amount) return state;
      // 明示入力・pending再開も、現在の候補と制限で再検証する。
      const requested = new Map<
        string,
        { amount: number; soulCount: number; automaticSoul: boolean }
      >();
      for (const source of paymentSources) {
        if (
          !Number.isInteger(source.amount) ||
          source.amount <= 0 ||
          (source.kind === "card" &&
            source.destination !== undefined &&
            source.destination !== "trash")
        )
          return state;
        const id = source.kind === "reserve" ? "reserve" : source.instanceId;
        const previous = requested.get(id) ?? {
          amount: 0,
          soulCount: 0,
          automaticSoul: false,
        };
        requested.set(id, {
          amount: previous.amount + source.amount,
          soulCount:
            previous.soulCount + Number(source.includeSoulCore === true),
          automaticSoul:
            previous.automaticSoul || source.includeSoulCore === undefined,
        });
      }
      const validatedSources: CardCostPaymentSource[] = [];
      for (const [id, request] of requested) {
        const candidate = candidates.find((source) => source.instanceId === id);
        const soulCount =
          request.soulCount ||
          Number(
            request.automaticSoul &&
              request.amount > (candidate?.normalAvailable ?? 0)
          );
        if (
          !candidate ||
          request.amount > candidate.available ||
          soulCount > Number(candidate.hasSoulCore) ||
          request.amount - soulCount > candidate.normalAvailable
        )
          return state;
        validatedSources.push(
          id === "reserve"
            ? {
                kind: "reserve",
                amount: request.amount,
                includeSoulCore: soulCount === 1,
              }
            : {
                kind: "card",
                instanceId: id,
                amount: request.amount,
                includeSoulCore: soulCount === 1,
              }
        );
      }
      try {
        const next = applyCardCostPayments({
          state,
          actingPlayerId: payerPlayerId,
          chainId: `pay-cost-${sourceInstanceId}-${provenance?.effectIndex ?? 0}-${provenance?.stepIndex ?? 0}`,
          paymentSources: validatedSources,
          causedByEffectSourceInstanceId: sourceInstanceId,
          getCardDefinitionById: ctx.getCardDefinitionById,
        });
        next.log.push(
          `effect:pay_cost:${payerPlayerId}:${action.amount}:sources=${paymentSources.length}`
        );
        return next;
      } catch {
        return state;
      }
    };
    const paymentSource = (
      id: string,
      amount: number,
      includeSoulCore: boolean
    ): CardCostPaymentSource =>
      id === "reserve"
        ? { kind: "reserve", amount, includeSoulCore }
        : { kind: "card", instanceId: id, amount, includeSoulCore };
    if (coreSourceAllocations !== undefined) {
      const ids = new Set(Object.keys(coreSourceAllocations));
      if (coreSourceSoulCoreInstanceId !== undefined)
        ids.add(coreSourceSoulCoreInstanceId);
      return pay(
        [...ids].flatMap((id): CardCostPaymentSource[] => {
          const includeSoulCore = id === coreSourceSoulCoreInstanceId;
          const amount =
            (coreSourceAllocations[id] ?? 0) + Number(includeSoulCore);
          if (amount <= 0) return [];
          return [paymentSource(id, amount, includeSoulCore)];
        })
      );
    }
    if (payCostPaymentSources !== undefined) return pay(payCostPaymentSources);

    const allowDeferredSourceSelection =
      stepCtx.allowPendingPayCostSourceAllocation === true;
    const totalAvailable = candidates.reduce(
      (sum, source) => sum + source.available,
      0
    );
    if (totalAvailable < action.amount) return state;
    const automaticPayment = getAutomaticNormalCorePaymentSources(
      action.amount,
      candidates.map((source) => ({ ...source, sourceId: source.instanceId }))
    );
    if (
      allowDeferredSourceSelection &&
      (automaticPayment === null ||
        automaticPayment.some((source) => source.kind === "card"))
    ) {
      const sourceCard = getCardById(state, sourceInstanceId);
      return {
        ...state,
        pendingCoreSourceAllocation: {
          pendingId: `csa-pc-${sourceInstanceId}-${provenance?.effectIndex ?? 0}-${provenance?.stepIndex ?? 0}`,
          actingPlayerId: payerPlayerId,
          sourceInstanceId,
          sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
          candidates,
          requiredTotal: action.amount,
          toLocation: { kind: "trash", player: "self" },
          effectTiming: effect.timing,
        },
      };
    }
    if (automaticPayment !== null) return pay(automaticPayment);
    let remaining = action.amount;
    return pay(
      candidates.flatMap((source): CardCostPaymentSource[] => {
        const amount = Math.min(remaining, source.available);
        remaining -= amount;
        if (amount <= 0) return [];
        return [
          paymentSource(
            source.instanceId,
            amount,
            amount > (source.normalAvailable ?? 0)
          ),
        ];
      })
    );
  },
  suppress_effect: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance, sourcePreventionLevel, sourcePreventionBypass } =
      ctx.effectMeta;
    return executeSuppressEffect(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
      provenance,
      sourcePreventionLevel,
      sourcePreventionBypass
    );
  },
  override_properties: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const {
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
      forceSnapshotContinuousTargets,
    } = ctx.effectMeta;
    return executeOverrideProperties(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
      provenance,
      sourcePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      effectSourceInstanceId,
      effectSourceDefinitionId,
      forceSnapshotContinuousTargets
    );
  },
  register_act_as_spirit: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRegisterActAsSpirit(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
      provenance
    );
  },
  register_redirect_effect_target: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRegisterRedirectEffectTarget(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      provenance
    );
  },
  grant_effect: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRegisterGrantedEffect(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
      provenance
    );
  },
  grant_paid_prevention_immunity: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantPaidPreventionImmunity(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
      provenance
    );
  },
  grant_paid_leave_suppression_immunity: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantPaidLeaveSuppressionImmunity(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
      resolvedTargetIds,
      provenance
    );
  },
  place_star_garment: (ctx) => {
    const {
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    return executePlaceStarGarment(
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds
    );
  },
  swap_star_garment: (ctx) => {
    const {
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    return executeSwapStarGarment(
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds
    );
  },
  bullet_edit: (ctx) => {
    const {
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    return executeBulletEdit(
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds
    );
  },
  swap_bullet_edit: (ctx) => {
    const {
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    return executeSwapBulletEdit(
      action,
      state,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds
    );
  },
  place_text_role_under_card: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
    } = ctx;
    return executePlaceTextRoleUnderCard(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx
    );
  },
  queue_hand_trash_swap: (ctx) => {
    // engine-atomic-hand-trash-swap-legal-action (BSTH02.7-TR03(A) 等): 手札/手元・
    // トラッシュ双方に候補が1体以上あるときだけ pending を立てる（片側でも候補0なら
    // 何もしない＝発火自体させない）。実際の交換は swap_hand_trash
    // legal action が担う（この時点ではまだ何も動かさない）。
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
    } = ctx;
    const {
      effectSourceInstanceId,
      effectSourceDefinitionId,
      sourcePreventionLevel,
      sourcePreventionBypass,
    } = ctx.effectMeta;
    if (state.pendingHandTrashSwapChoice !== null) return state;

    const source = getCardById(state, sourceInstanceId);
    if (!source) return state;
    // cardName:"self"（BSAZ02-C16「トラッシュにあるこのカードは…入れ替えられる」）解決用に
    // 実際の効果テキスト提供元を両側フィルタへ渡す (MatchCardFilterOptions.sourceDefinition SSOT)。
    const sourceDefinition = getCardDefinitionById(source.definitionId);
    const actualEffectSourceCard =
      effectSourceInstanceId !== undefined
        ? getCardById(state, effectSourceInstanceId)
        : source;
    const actualEffectSourceDefinition =
      effectSourceDefinitionId !== undefined
        ? getCardDefinitionById(effectSourceDefinitionId)
        : sourceDefinition;
    const effectSource =
      actualEffectSourceCard || actualEffectSourceDefinition
        ? {
            ...(actualEffectSourceCard
              ? { instance: actualEffectSourceCard }
              : {}),
            ...(actualEffectSourceDefinition
              ? { definition: actualEffectSourceDefinition }
              : {}),
          }
        : undefined;

    const { outgoingZones, outgoingCandidates, incomingCandidates } =
      resolveHandTrashSwapCandidates({
        state,
        sourceInstanceId,
        actingPlayerId,
        action,
        getCardDefinitionById,
        ...(sourceDefinition !== undefined ? { sourceDefinition } : {}),
        ...(sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel }
          : {}),
        ...(effectSource !== undefined ? { effectSource } : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
      });
    if (outgoingCandidates.length === 0) return state;
    if (incomingCandidates.length === 0) return state;

    const newState: GameState = {
      ...state,
      pendingHandTrashSwapChoice: {
        pendingId: `hts-${handTrashSwapPendingSequence++}`,
        chainId: ctx.continuationMeta.chainId,
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: source.definitionId,
        outgoingZones,
        outgoingCandidateInstanceIds: outgoingCandidates.map(
          (c) => c.instanceId
        ),
        incomingCandidateInstanceIds: incomingCandidates.map(
          (c) => c.instanceId
        ),
        ...(sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel }
          : {}),
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        ...(effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId }
          : {}),
        ...(effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId }
          : {}),
      },
    };
    newState.log.push(`queue_hand_trash_swap:${sourceInstanceId}`);
    return newState;
  },
  queue_field_hand_swap: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
    } = ctx;
    if (state.pendingFieldHandSwapChoice !== null) return state;

    const source = getCardById(state, sourceInstanceId);
    if (!source || source.zone !== "field") return state;
    const sourceDefinition = getCardDefinitionById(source.definitionId);
    const matchOpts = sourceDefinition ? { sourceDefinition } : undefined;

    const incomingCandidates = state.cardInstances.filter((c) => {
      if (c.zone !== "hand") return false;
      if (c.ownerPlayerId !== actingPlayerId) return false;
      const def = getCardDefinitionById(c.definitionId);
      if (!def) return false;
      return matchesCardFilter(c, def, action.incomingFilter, matchOpts);
    });
    if (incomingCandidates.length === 0) return state;

    const newState: GameState = {
      ...state,
      pendingFieldHandSwapChoice: {
        pendingId: `fhs-${fieldHandSwapPendingSequence++}`,
        chainId: ctx.continuationMeta.chainId,
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: source.definitionId,
        incomingCandidateInstanceIds: incomingCandidates.map(
          (c) => c.instanceId
        ),
        enterRecovered: action.enterRecovered ?? true,
        ...(action.effectScope ? { effectScope: action.effectScope } : {}),
      },
    };
    newState.log.push(`queue_field_hand_swap:${sourceInstanceId}`);
    return newState;
  },
  restrict_use: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRestrictUse(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  prevent_cost_reduction: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executePreventCostReduction(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  limit_cost_reduction: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeLimitCostReduction(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  extend_field_symbol_source: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeExtendFieldSymbolSource(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  allow_simultaneous_attack: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeAllowSimultaneousAttack(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  force_attack_step_end_after_first_battle: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeForceAttackStepEndAfterFirstBattle(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  allow_mid_battle_join: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeAllowMidBattleJoin(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  allow_ignore_summon_condition: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeAllowIgnoreSummonCondition(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  grant_game_loss_immunity: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantGameLossImmunity(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  grant_declared_summon_alt_cost: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantDeclaredSummonAltCost(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  grant_summon_trash_core_placement: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantSummonTrashCorePlacement(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  grant_flash_consecutive_use: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantFlashConsecutiveUse(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  grant_link_aid_cost_override: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantLinkAidCostOverride(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  restrict_draw_to_top: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRestrictDrawToTop(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  grant_optional_deck_reveal_count_boost: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantOptionalDeckRevealCountBoost(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  register_expand_effect_target_count: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRegisterExpandEffectTargetCount(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  require_multi_block: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRequireMultiBlock(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  require_block_if_able: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance, sourcePreventionLevel } = ctx.effectMeta;
    return executeRequireBlockIfAble(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      sourcePreventionLevel,
      provenance
    );
  },
  offer_magic_pre_cost_trigger: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeOfferMagicPreCostTrigger(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  restrict_manifest: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeRestrictManifest(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  field_name_uniqueness: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      effect,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeFieldNameUniqueness(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance,
      getCardDefinitionById
    );
  },
  count_as_multiple: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId, effect } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeCountAsMultiple(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance
    );
  },
  redirect_target: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
    } = ctx;
    return executeRedirectTarget(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds
    );
  },
  replace_attack_declaration: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds,
    } = ctx;
    return executeReplaceAttackDeclaration(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      stepCtx,
      resolvedTargetIds
    );
  },
  life_damage_interception: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      resolvedTargetIds,
    } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeLifeDamageInterception(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      effect,
      provenance,
      resolvedTargetIds
    );
  },
  grant_life_damage_source_prevention_immunity: (ctx) => {
    const { action, state, actingPlayerId, sourceInstanceId } = ctx;
    const { provenance } = ctx.effectMeta;
    return executeGrantLifeDamageSourcePreventionImmunity(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      provenance
    );
  },
  divine_transform: (ctx) => {
    const {
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      getCardDefinitionById,
      resolvedTargetIds,
    } = ctx;
    const { sourcePreventionLevel, sourceTargetLockBypass } = ctx.effectMeta;
    const v1Target = convertTargetSpecToEffectTarget(action.target);
    const v1Action: DivineTransformAction = {
      kind: "divine_transform",
      target: v1Target,
      bpByLevel: action.bpByLevel,
      ...(action.colors ? { colors: action.colors } : {}),
      ...(action.symbols ? { symbols: action.symbols } : {}),
      ...(action.protectedFromNonGrandwalker !== undefined
        ? { protectedFromNonGrandwalker: action.protectedFromNonGrandwalker }
        : {}),
    };
    return executeDivineTransform(
      state,
      actingPlayerId,
      v1Action,
      getCardDefinitionById,
      sourceInstanceId,
      resolvedTargetIds,
      sourcePreventionLevel,
      sourceTargetLockBypass
    );
  },
};

export function executeNativeAction(
  action: Action,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  effect: Effect,
  chainId: string,
  resolvedTargetIds?: string[],
  pendingEffectSimultaneousGroupId?: string,
  coreShootDistribution?: Record<string, number>,
  coreShootSoulCoreInstanceId?: string,
  provenance?: NonNullable<ContinuousEffect["provenance"]>,
  payCostPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[],
  coreDistributionAllocations?: Record<string, number>,
  coreDistributionSoulCoreInstanceId?: string,
  coreDistributionSoulCoreAllocations?: Record<string, number>,
  summonPaymentSources?: readonly import("../core/payment-system").CardCostPaymentSource[],
  summonEnterFieldCorePlacements?: readonly import("../zone/enter-field-placement-execution").EnterFieldCorePlacement[],
  step?: import("../dsl-types").EffectStep,
  choiceIndex?: number,
  /**
   * 攻撃側効果の防止レベル (P3-43)。`"unpreventable"` のとき
   * `cannot_*` 効果耐性を貫通する。
   * effect-resolution → executeEffect → executeNativeAction → executor の経路で
   * EffectActionContext.sourcePreventionLevel から伝搬される。
   */
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  negatePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  /**
   * field_card ソースのコアコスト支払い配分。resolve_core_source_allocation 解決後の
   * コストステップ再実行で executeCoreMove へ渡される。
   */
  coreSourceAllocations?: Record<string, number>,
  coreSourceSoulCoreInstanceId?: string,
  getRegisteredTriggeredEffectActions?: import("./trigger-system").TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions?: import("./trigger-system").BurstActionRegistrationLookup,
  forceSnapshotContinuousTargets = false,
  battleEndDeferralAttackId?: string,
  /**
   * ENGINE-conditional-free-magic-use-target-selection: use_magic_without_cost が
   * 対象選択を要する場合に本物の pendingEffectTargetSelection を生成するための窓口。
   */
  resolveDeferredStackForFreeMagicUse?: (
    state: GameState,
    stack: import("../model").ActiveStack
  ) => GameState,
  /**
   * ENGINE-free-magic-use-target-selection-nonfield-candidate-zones:
   * use_magic_without_cost が synthetic ActiveStack の candidateTargetZones を
   * 発揮効果の登録情報から引き継ぐための窓口。
   */
  getRegisteredMagicActions?: import("../legal/legal-actions-types").MagicActionRegistrationLookup,
  sourcePreventionBypass?: import("./target-affect-gate").TargetLockBypassProfile,
  pendingStackNegateCandidate?: ActiveStack | null,
  effectActionKind?: import("../model").EffectResolutionActionKind,
  coreMoveAmountBonusOverride?: number,
  recordedUsage?: import("../model").RecordedEffectUsage,
  endAttackStepBlockedRetry?: PendingAttackStepEndBlockedRetry,
  /** P3-129: 解決中の pending triggered effect 自身の pendingId。correlate_pending_trigger 用。 */
  pendingEffectPendingId?: string,
  sourceCardReferenceInstanceId?: string,
  preservePreSelectedTargetRefs = false,
  continuationMeta: Omit<NativeActionContinuationMeta, "chainId"> = {}
): GameState | null {
  // P2-12 phase A 根治: dispatch の唯一の正源 = NATIVE_ACTION_HANDLERS。
  // 非 optional マップ型が全 Action["kind"] の handler 登録をコンパイル時に強制する
  // (未登録 kind = 型エラー)。Record cast は union キーで mapped 型を index できない
  // TS 制約の回避のみ。
  const nativeHandler = (
    NATIVE_ACTION_HANDLERS as Record<
      Action["kind"],
      (ctx: NativeActionContext) => GameState | null
    >
  )[action.kind];
  // deferred targeted disclosure の再開だけを、既存 executor 群へ印付けして渡す。
  // executor は `resolveTargetCards` を再利用しているため、ここで一度包めば
  // destroy / vanish / bounce / send_to_deck / exhaust 等すべてが同じ acquisition
  // 境界を共有する。通常の preSelectedIds は従来どおり再検査する。
  const contextualResolvedTargetIds =
    preservePreSelectedTargetRefs && resolvedTargetIds !== undefined
      ? markPreSelectedTargetRefsPreserved(resolvedTargetIds)
      : resolvedTargetIds;
  const result = nativeHandler({
    action,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepCtx,
    effect,
    resolvedTargetIds: contextualResolvedTargetIds,
    preservePreSelectedTargetRefs,
    step,
    choiceIndex,
    pendingEffectSimultaneousGroupId,
    pendingEffectPendingId,
    getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions,
    resolveDeferredStackForFreeMagicUse,
    getRegisteredMagicActions,
    corePayment: {
      coreShootDistribution,
      coreShootSoulCoreInstanceId,
      coreDistributionAllocations,
      coreDistributionSoulCoreInstanceId,
      coreDistributionSoulCoreAllocations,
      coreSourceAllocations,
      coreSourceSoulCoreInstanceId,
      payCostPaymentSources,
      summonPaymentSources,
      summonEnterFieldCorePlacements,
    },
    effectMeta: {
      provenance,
      effectSourceInstanceId: provenance?.effectSourceInstanceId,
      effectSourceDefinitionId: provenance?.effectSourceDefinitionId,
      ...(sourceCardReferenceInstanceId !== undefined
        ? { sourceCardReferenceInstanceId }
        : {}),
      pendingStackNegateCandidate,
      sourcePreventionLevel,
      negatePreventionLevel,
      sourceTargetLockBypass,
      sourcePreventionBypass,
      forceSnapshotContinuousTargets,
      battleEndDeferralAttackId,
      coreMoveAmountBonusOverride,
      effectActionKind,
      ...(recordedUsage !== undefined ? { recordedUsage } : {}),
      ...(endAttackStepBlockedRetry !== undefined
        ? { endAttackStepBlockedRetry }
        : {}),
    },
    continuationMeta: { ...continuationMeta, chainId },
  });
  if (result === null) return null;
  return action.kind === "swap_bullet_edit"
    ? recordHandExchange(state, result)
    : recordHandEntries(state, result, () => ({
        playerId: actingPlayerId,
        sourceInstanceId:
          provenance?.effectSourceInstanceId ?? sourceInstanceId,
      }));
}
