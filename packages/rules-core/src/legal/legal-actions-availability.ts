import {
  hasMagicUsePermission,
  getOwnHandCards,
  getDeckHandCards,
  isInHandForOwnEffect,
  getOwnEffectSourceZone,
  isCardInEffectZone,
} from "../effect/card-access-rules";
import { isPrivateTriggeredDeclarationConditionMet } from "../effect/private-triggered-eligibility";
export { isPrivateTriggeredDeclarationConditionMet } from "../effect/private-triggered-eligibility";
import { getTriggeredMechanicActivationState } from "../effect/triggered-mechanic-eligibility";
import { scopeInnermostTriggerReactions } from "../effect/trigger-resolution-scope";
import {
  isTriggeredSourceUsageAvailable,
  canSkipDuplicateTriggeredSource,
  hasNoDuplicateUsageLimit,
} from "../effect/triggered-source-usage";
import {
  getEffectiveCategory,
  hasCannotCombineRestriction,
} from "../mechanics/act-as-spirit";
import { hasPreventBraveSeparationRestriction } from "../mechanics/brave-separation-restriction";
import { collectLinkAidCostSourceCandidates } from "../mechanics/link-aid-system";
import { getCardById } from "../card/card-lookup";
import {
  getGrantedEffectUsageLabel,
  canActivateGrantedEffect,
} from "../mechanics/grant-effect-system";
import { isTimingScopeActive } from "../card/ce-lookup";
import {
  isTextRoleUnderActiveSpiritHost,
  isActiveTextRoleUnderEffectSource,
  type TextRoleUnderSourceRole,
} from "../mechanics/star-garment-utils";
import { getCardsByZone } from "../zone/zone-partition";
import { evaluateApplicability } from "../effect/effect-interpreter";
import { canExecuteRebirthEffectNow } from "../effect/structured-card-replacement";
import {
  getPaidPreventionImmunityCardCostCandidates,
  getPaidPreventionImmunityCost,
} from "../effect/effect-resistance-check";
import { getEnterFieldCorePlacementPolicy } from "../zone/enter-field-placement-policy";
import {
  getBattleImmediateRebirthTimingWindowId,
  getBattleImmediateEffectSourceUseBlockReason,
  mergeBattleImmediateChoiceVariant,
} from "../battle/battle-immediate-effect-system";
import type { RegisteredBattleImmediateEffectAction } from "../battle/battle-immediate-effect-system";
import {
  stackMatchesNegateAction,
  type StackNegateActionLike,
} from "../stack/stack-negate";
import { collectPendingStacksForCardInstance } from "./stack-collection-helpers";
import {
  getEffectDescriptorSourceKindForPrintedCategory,
  getEffectRegistrationSourceKindForPrintedCategory,
} from "../source-kinds";
import {
  getBurstSetBlockReason,
  getReplaceableBurstSetState,
  hasPendingBurstActivationSelections,
} from "../mechanics/burst-system";
import {
  getMirageSetBlockReason,
  getAvailableMiragePaymentSources,
  getMirageReplacementChoices,
} from "../mechanics/mirage-system";
import {
  getAttackDeclarationBlockReason,
  getAttackEntityId,
  getBlockDeclarationBlockReason,
  getDeclineBlockBlockReason,
  getJoinActiveAttackBlockReason,
  getPendingForcedFirstAttackerId,
  getOpenBattleFlashBlockReason,
  getPassBattleFlashBlockReason,
  isDesignatedAttackTargetLegal,
  getRequiredAttackExhaustCostCount,
  getRequiredAttackExhaustCostSourceCandidates,
  getRequiredBattleDestroyCostCount,
  getBattleCardCostPaymentPlans,
} from "../battle/battle-system";
import { getFieldEffectSourceUseBlockReason } from "../card/card-effect-system";
import type { EffectActionContext } from "../effect/effect-resolution";
import { getMinimumRequiredCoresFromDefinition } from "../factories";
import {
  getAvailableMagicPaymentSources,
  getMagicCostOverrideSource,
  getMagicFreeUseSource,
} from "../mechanics/magic-system";
import {
  getAccelFreeUseSource,
  getAvailableAccelChangePaymentSources,
  getChangeSwapCandidates,
} from "../mechanics/accel-change-system";
import {
  adventTimingWindowAllowed,
  getAdventTargets,
  getContractAdventTargets,
  getFContractAdventTargets,
  getAdventDeclareUsageKey,
  hasSoulCoreAvailable,
  isExcludedByHostExclusiveLock,
} from "../mechanics/advent-system";
import { getHostGrantedAdventChoiceOptions } from "../mechanics/host-dual-advent";
import { getContractCombineCandidateTargets } from "../mechanics/contract-combine-system";
import { getManifestTargets } from "../mechanics/manifest-system";
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  DivineSkillCoreCost,
  DivineSkillTiming,
  EffectActivationSourceZone,
  EffectExecutionMode,
  EffectPreventionLevel,
  EffectResolutionActionKind,
  EffectReevaluationPoint,
  GameState,
  LifeCoreKind,
  PendingPrivateDeclaration,
  SuppressionEffectDescriptor,
  PendingTriggeredEffect,
  TriggerPriority,
  Zone,
} from "../model";
import {
  collectUnderCardScopeIds,
  getQuartzSetStatesByHost,
  isGrandwalkerOrGuidedNexus,
  isImaginBrave,
  isTextRoleUnderCard,
  textRoleUnderCardIdsOf,
  underCardRoleTagsEqual,
} from "../model";
import {
  isChainInOpenResponseWindow,
  isInstanceInOpenResponseWindow,
} from "../stack/stack-window-shared";
import {
  matchesApplicabilityZoneList,
  type Action,
  type Effect,
  type EffectStep,
  type StepCondition,
} from "../dsl-types";
import {
  mergeTargetLockBypassProfiles,
  type TargetLockBypassProfile,
} from "../effect/target-affect-gate";
import {
  isCombinedBraveEffectSource,
  resolveAffectSourceIdentity,
} from "../effect/effect-source-identity";
import { getTotalCoresOnCardById, isSoulCoreOn } from "../core/core-system";
import { countEnterFieldCoreSources } from "../zone/enter-field-core-sources";
import {
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getEffectiveLevel,
} from "../battle/battle-shared";
import {
  attachedBravesCountingTowardLimit,
  braveConditionAllowsNexusHost,
  canReceiveBraveWithinCombineLimit,
  getActiveMaxCombinedBravesForHost,
  getBraveSelfReferenceRewriteStatus,
  getEffectiveColors,
  getTenshoTargetCandidates,
  getValidBraveCombineHosts,
  isIncomingBraveConditionIgnoredByHost,
  matchesBraveConditionForCard,
} from "./legal-actions-shared";
import {
  canDeclareDivineSkillEffect,
  getDivineSkillUsageKey,
} from "./divine-skill-usage";
import {
  getAvailableCardCostPaymentSources,
  getAvailableOnBoardCorePaymentSources,
  type AvailableCardCostPaymentSourcesResult,
} from "../core/payment-system";
import { isArtsTokenMagicDefinition } from "../card/card-filter";
import {
  getAvailableBurstSourceChoices,
  getAvailableTriggeredEffectSourceChoices,
  mergeTriggeredChoiceVariant,
} from "../effect/trigger-system";
import type {
  RegisteredTriggeredEffectAction,
  TriggeredEffectSourceChoice,
} from "../effect/trigger-system";

export function getTriggerPriority(value: {
  triggerPriority?: TriggerPriority;
}): TriggerPriority {
  return value.triggerPriority ?? "normal";
}

export function getHighestTriggerPriority(
  values: readonly { triggerPriority?: TriggerPriority }[]
): TriggerPriority {
  return values.some((value) => getTriggerPriority(value) === "immediate")
    ? "immediate"
    : "normal";
}
import type {
  AttackLegalAction,
  FlipInsteadOfAttackLegalAction,
  JoinActiveAttackLegalAction,
  DeclinePendingBurstCheckLegalAction,
  ResolvePendingBurstCheckLegalAction,
  ResolvePendingTriggeredEffectLegalAction,
  BattleImmediateEffectLegalAction,
  BlockLegalAction,
  FieldCardEffectLegalAction,
  HandActivatedEffectLegalAction,
  GetAvailableFieldCardEffectLegalActionsOptions,
  GetLegalActionsOptions,
  RegisteredActionTiming,
  SetBurstLegalAction,
  SetMirageLegalAction,
  SetQuartzLegalAction,
  ActivateSoulStateLegalAction,
  UseAccelLegalAction,
  UseChangeLegalAction,
  DeclareAdventLegalAction,
  DeclareDualHostAdventLegalAction,
  DeclareManifestLegalAction,
  RegisteredTargetedEffectActionBase,
  RegisteredFieldCardEffectAction,
  RegisteredHandActivatedEffectAction,
  RegisteredMagicAction,
  RegisteredSourceUnderCardRequirement,
  UseMagicLegalAction,
  OpenBattleFlashLegalAction,
  PassBattleFlashLegalAction,
  PassStackLegalAction,
  PassPreDeclarationStackLegalAction,
  PlaceNexusLegalAction,
  EndAttackStepLegalAction,
  BraveCombineLegalAction,
  ContractCombineLegalAction,
  LinkAidLegalAction,
  BraveSeparateLegalAction,
  BraveSwapLegalAction,
  DeclineBlockLegalAction,
  SummonLegalAction,
  PrivateTriggeredEffectDeclarationLegalAction,
  SelectPendingToResolveLegalAction,
  UseDivineSkillLegalAction,
} from "./legal-actions-types";
import {
  getQuartzPlacements,
  getQuartzName,
  canPayQuartzCountCost,
  getEligibleQuartzHosts,
} from "../mechanics/quartz-system";
import {
  canEnumerateMainHandCardActions,
  createAttackLegalActionId,
  createBattleImmediateEffectLegalActionId,
  createBlockLegalActionId,
  createFieldCardEffectLegalActionId,
  createHandActivatedEffectLegalActionId,
  createHandCardLegalActionId,
  createMagicLegalActionId,
  createOpenBattleFlashLegalActionId,
  createPassBattleFlashLegalActionId,
  createPassStackLegalActionId,
  createPassPreDeclarationStackLegalActionId,
  createSetBurstLegalActionId,
  createSetMirageLegalActionId,
  createSetQuartzLegalActionId,
  createActivateSoulStateLegalActionId,
  getSoulStateActivationEffectIndex,
  createResolvePendingBurstCheckLegalActionId,
  createDeclinePendingBurstCheckLegalActionId,
  createResolvePendingTriggeredEffectLegalActionId,
  createSelectPendingToResolveLegalActionId,
  createEndAttackStepLegalActionId,
  createDeclineBlockLegalActionId,
  createSpiritTargetAttackLegalActionId,
  createJoinActiveAttackLegalActionId,
  areLegalActionTargetGroupsSatisfiable,
  buildLegalActionTargetGroups,
  getAvailableChosenLifeCoreKinds,
  getCandidateTargetZones,
  getCandidateTargetInstanceIds,
  getHandCardLegalActionKind,
  getRequiredTargetCount,
  getMaxTargetCount,
  resolveEmptyFireTargetCounts,
  getTargetEffectFilterTags,
  getTargetMode,
  evaluateSummonDeclarationGate,
  canSummonUltimate,
  canUseEffectByUsageLimit,
  getChoiceVariantUsageLabel,
  getEffectExecutionMode,
  getStepUsageLabel,
  getStableEffectLabel,
  isBurstEffectNullifiedByOpponent,
  isCardUseRestricted,
  isCardManifestRestricted,
  mergeRegistrationChoiceVariant,
  getSimultaneousAttackGrant,
  getMidBattleJoinGrant,
  filterRestrictedTimings,
  isFlashRestricted,
  isBurstActivationRestricted,
  isAdventRestricted,
  getResponseStackSourceInstanceId,
  executeReevaluationCheck,
  getAvailableBraveSeparationCoreCount,
  getEffectSourceTribePreventionBypass,
  getDeclaredSummonAltCostGrant,
  getSummonTrashCorePlacementGrant,
} from "./legal-actions-shared";
import {
  isMagicLikeCardForm,
  matchesCardFilter,
  type MatchCardFilterOptions,
} from "../card/card-filter";
import { getResponseWindowActionTimings } from "../stack/stack-window-shared";
import type { EffectFilterTag } from "../state-based-actions";
import {
  getChoiceStepCondition,
  getHandSummonPermissionSpec,
  getNormalActionDeclarationTargetingMetadata,
  HAND_ACTIVATED_EFFECT_ZONES,
} from "../effect/structured-effect-registrations";
import { canExecuteOptionalStep } from "../effect/native-effect-front-helpers";
import { previewConditionalCoreCost } from "../effect/conditional-cost-core-preview";
import {
  evaluateCondition,
  resolveLocationPlayer,
} from "../effect/structured-effect-interpreter";
import { convertCoreLocation } from "../effect/native-action-shared";
import { getFieldCoreSourceTakeableCount } from "../effect/structured-core-shoot";
import type { ConditionSourceContext } from "../effect/structured-condition-eval";
import { createStepExecutionContext } from "../step-execution-context";
import { resolveCountBound } from "../effect/target-resolution";
import { getExpandEffectTargetCountBonusDeclarative } from "../effect/expand-effect-target-count";
import type { AdditionalCostModifier } from "../core/cost-system";
import {
  calculateFullReductionSummonCost,
  calculateSpecialCostFinalCost,
  getEffectiveCostFloor,
} from "../core/cost-system";
import {
  capTargetGroupsByRequiredSelectedTargetsCountCost,
  getRequiredCostSourceTribesForCard,
  getRequiredSelectedTargetsCountCostLimitedMaxTargetCount,
} from "./required-count-cost-gate";
import { canPayRequiredEffectCosts } from "./required-effect-cost-gate";
import {
  getSummonCostExcludeChoiceOption,
  calculateFullyPaidSummonRemainingCost,
} from "../mechanics/summon-cost-exclude-choice";
import { getSummonCostCoreMoveChoiceOption } from "../mechanics/summon-cost-core-move-choice";
import { calculateFreeSummonCost } from "../effect/summon-cost";
import { isCardLeaveAffectBlockedByResistance } from "../effect/effect-affect-adapter";
import { resolveHandTrashSwapCandidates } from "../effect/zone-search-candidates";

type CandidateTargetOptions = NonNullable<
  Parameters<typeof getCandidateTargetInstanceIds>[3]
>;

function hasDeferredOptionalRepeatChoice(effect: Effect | undefined): boolean {
  if (!effect) return false;
  const hasExplicitChoice = effect.steps.some(
    (step) => step.choice !== undefined && step.choice.length > 0
  );
  if (hasExplicitChoice) return false;
  return effect.steps.some((step) => step.repeat?.optional === true);
}

function getChoiceIterationsForAvailability(
  effect: Effect | undefined,
  variants: readonly unknown[] | undefined
): Array<number | undefined> {
  if (!variants || variants.length === 0) return [undefined];
  if (hasDeferredOptionalRepeatChoice(effect)) return [undefined];
  return variants.map((_, choiceIndex) => choiceIndex);
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
  preventionSourceInstanceId?: string | undefined;
  actingPlayerId: string;
  registration:
    | {
        reevaluationPoints?: readonly EffectReevaluationPoint[];
        preventionLevel?: EffectPreventionLevel;
        targetLockBypass?: TargetLockBypassProfile;
        suppressionEffectDescriptor?: SuppressionEffectDescriptor;
      }
    | undefined;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  if (
    options.sourceInstanceId === undefined ||
    !hasEffectSuppressionReevaluation(options.registration)
  ) {
    return false;
  }
  const dynamicPreventionBypass = getEffectSourceTribePreventionBypass(
    options.state,
    options.preventionSourceInstanceId ?? options.sourceInstanceId,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  const sourcePreventionLevel =
    dynamicPreventionBypass?.kind === "all_effects"
      ? "unpreventable"
      : options.registration?.preventionLevel;
  const sourcePreventionBypass =
    dynamicPreventionBypass?.kind === "all_effects"
      ? undefined
      : mergeTargetLockBypassProfiles(
          options.registration?.targetLockBypass,
          dynamicPreventionBypass
        );

  return !executeReevaluationCheck({
    state: options.state,
    checkKind: "effect_suppression",
    sourceInstanceId: options.sourceInstanceId,
    targetInstanceIds: [],
    sourcePreventionLevel: sourcePreventionLevel ?? "none",
    ...(sourcePreventionBypass !== undefined ? { sourcePreventionBypass } : {}),
    ...(options.registration?.suppressionEffectDescriptor !== undefined
      ? {
          suppressionEffectDescriptor:
            options.registration.suppressionEffectDescriptor,
        }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

interface PendingSelectExecutionMetadata {
  canSkipDuplicate?: true;
  executionMode: EffectExecutionMode;
  sourceInstanceId?: string;
  sourceEffectInstanceId?: string;
  registrationIndex?: number;
}

function getTriggeredSourceChoicesForPendingSelection(
  options: GetLegalActionsOptions,
  pendingTriggeredEffect: PendingTriggeredEffect
): TriggeredEffectSourceChoice[] {
  if (!options.getRegisteredTriggeredEffectActions) return [];
  if (
    pendingTriggeredEffect.declaredFromPrivateZone &&
    pendingTriggeredEffect.declaredSourceInstanceId !== undefined &&
    pendingTriggeredEffect.declaredSourceKind !== undefined &&
    pendingTriggeredEffect.declaredRegistrationIndex !== undefined
  ) {
    const sourceCard = getCardById(
      options.state,
      pendingTriggeredEffect.declaredSourceInstanceId
    );
    const sourceDefinition = sourceCard
      ? options.getCardDefinitionById(sourceCard.definitionId)
      : undefined;
    const actionRegistration =
      sourceDefinition !== undefined
        ? options.getRegisteredTriggeredEffectActions(
            sourceDefinition.cardNo
          )?.[pendingTriggeredEffect.declaredRegistrationIndex]
        : undefined;
    return sourceCard && sourceDefinition && actionRegistration
      ? [
          {
            sourceCard,
            sourceDefinition,
            sourceEffectDefinition: sourceDefinition,
            sourceKind: pendingTriggeredEffect.declaredSourceKind,
            registrationIndex: pendingTriggeredEffect.declaredRegistrationIndex,
            actionRegistration,
          },
        ]
      : [];
  }

  return getAvailableTriggeredEffectSourceChoices({
    state: options.state,
    pendingEffect: pendingTriggeredEffect,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
}

function getMechanicPendingSelectExecutionMode(
  options: GetLegalActionsOptions,
  pendingTriggeredEffect: PendingTriggeredEffect
): EffectExecutionMode | undefined {
  const mechanic = pendingTriggeredEffect.mechanic;
  if (!mechanic) return undefined;
  let executionMode: EffectExecutionMode =
    mechanic.kind === "magic_stack_domain" ? "mandatory" : "optional";

  if (
    mechanic.kind === "oracle" &&
    getCardById(options.state, mechanic.grandwalkerInstanceId) !== undefined
  ) {
    const sourceCard = getCardById(
      options.state,
      mechanic.grandwalkerInstanceId
    );
    const sourceDefinition = sourceCard
      ? options.getCardDefinitionById(sourceCard.definitionId)
      : undefined;
    if (
      sourceDefinition?.grandwalkerData?.oracleExecutionMode === "mandatory"
    ) {
      executionMode = "mandatory";
    }
  }

  if (mechanic.kind === "granted_effect") {
    const grantCe = options.state.activeContinuousEffects.find(
      (ce) => ce.effectId === mechanic.grantCeEffectId
    );
    const grantedEffect = grantCe?.metadata?.grantedEffect as
      | Effect
      | undefined;
    if (grantedEffect !== undefined) {
      executionMode = getEffectExecutionMode(grantedEffect);
    }
  }

  return executionMode;
}

function getPendingSelectExecutionMetadataList(
  options: GetLegalActionsOptions,
  pendingTriggeredEffect: PendingTriggeredEffect
): PendingSelectExecutionMetadata[] {
  if (pendingTriggeredEffect.declaredFromPrivateZone === true) {
    return [{ executionMode: "mandatory" }];
  }

  if (pendingTriggeredEffect.mechanic) {
    const executionMode = getMechanicPendingSelectExecutionMode(
      options,
      pendingTriggeredEffect
    );
    return executionMode ? [{ executionMode }] : [];
  }

  const bySourceRegistration = new Map<
    string,
    PendingSelectExecutionMetadata
  >();
  let hasAmbiguousSourceRegistration = false;
  const sourceChoices = getTriggeredSourceChoicesForPendingSelection(
    options,
    pendingTriggeredEffect
  );

  for (const sourceChoice of sourceChoices) {
    if (
      !isTriggeredSourceUsageAvailable({
        state: options.state,
        pendingEffect: pendingTriggeredEffect,
        choice: sourceChoice,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    )
      continue;
    const variants = sourceChoice.actionRegistration.choices;
    const sourceEffect =
      sourceChoice.actionRegistration.effectIndex !== undefined
        ? sourceChoice.sourceEffectDefinition.effects?.[
            sourceChoice.actionRegistration.effectIndex
          ]
        : undefined;
    const choiceIterations = getChoiceIterationsForAvailability(
      sourceEffect,
      variants
    );
    for (const choiceIndex of choiceIterations) {
      const variantRegistration: RegisteredTriggeredEffectAction =
        choiceIndex !== undefined && variants
          ? mergeTriggeredChoiceVariant(
              sourceChoice.actionRegistration,
              variants[choiceIndex]!
            )
          : sourceChoice.actionRegistration;
      const variantTriggerEffectTiming =
        choiceIndex !== undefined && variants
          ? variants[choiceIndex]!.triggerEffectTiming
          : undefined;
      if (
        variantTriggerEffectTiming !== undefined &&
        pendingTriggeredEffect.effectActivationTiming !==
          variantTriggerEffectTiming
      ) {
        continue;
      }

      const sourceRegistrationInstanceId =
        sourceChoice.sourceEffectInstanceId ??
        sourceChoice.sourceCard.instanceId;
      const key = `${sourceRegistrationInstanceId}#${sourceChoice.registrationIndex}`;
      const executionMode = getEffectExecutionMode(variantRegistration);
      const existing = bySourceRegistration.get(key);
      if (existing !== undefined) {
        if (existing.executionMode !== executionMode) {
          hasAmbiguousSourceRegistration = true;
        }
        continue;
      }
      bySourceRegistration.set(key, {
        executionMode,
        ...(executionMode === "mandatory" &&
        canSkipDuplicateTriggeredSource({
          state: options.state,
          pendingEffect: pendingTriggeredEffect,
          choice: sourceChoice,
          choices: sourceChoices,
          getCardDefinitionById: options.getCardDefinitionById,
        })
          ? { canSkipDuplicate: true as const }
          : {}),
        sourceInstanceId: sourceChoice.sourceCard.instanceId,
        ...(sourceChoice.sourceEffectInstanceId !== undefined
          ? { sourceEffectInstanceId: sourceChoice.sourceEffectInstanceId }
          : {}),
        registrationIndex: sourceChoice.registrationIndex,
      });
    }
  }

  // choice variant 内で mandatory/optional が混ざる registration は、現行の
  // resolvedSourceRegistrationKeys が choiceIndex 粒度を持たないため select 段階で
  // source 分解しない。resolve 側の既存 action 生成に任せる。
  if (hasAmbiguousSourceRegistration) return [];

  const sourceRegistrationMetadata = [...bySourceRegistration.values()];
  if (sourceRegistrationMetadata.length === 0) return [];

  const executionModes = new Set(
    sourceRegistrationMetadata.map((metadata) => metadata.executionMode)
  );
  if (executionModes.size === 1) {
    const executionMode = sourceRegistrationMetadata[0]!.executionMode;
    if (
      sourceRegistrationMetadata.some((metadata) => metadata.canSkipDuplicate)
    )
      return sourceRegistrationMetadata;
    if (sourceRegistrationMetadata.length === 1) {
      return [sourceRegistrationMetadata[0]!];
    }
    // 相手の効果は強制/任意が同じでも個々に順序を選ぶため、識別情報を保つ。
    if (
      (executionMode === "optional" &&
        pendingTriggeredEffect.actingPlayerId === options.actingPlayerId) ||
      pendingTriggeredEffect.actingPlayerId !== options.state.activePlayerId
    ) {
      return sourceRegistrationMetadata;
    }
    return [{ executionMode }];
  }
  return sourceRegistrationMetadata;
}

function getPendingSelectActionSourceId(
  metadata: PendingSelectExecutionMetadata | undefined
): string | undefined {
  return metadata?.sourceEffectInstanceId ?? metadata?.sourceInstanceId;
}

function buildSelectPendingToResolveLegalActions(
  options: GetLegalActionsOptions,
  pending: PendingTriggeredEffect,
  turnPlayerId: string
): SelectPendingToResolveLegalAction[] {
  const metadataList = getPendingSelectExecutionMetadataList(options, pending);
  if (
    metadataList.length === 0 &&
    pending.timingSourceRegistrations !== undefined &&
    !pending.mechanic
  )
    return [];
  const actionMetadataList: readonly (
    | PendingSelectExecutionMetadata
    | undefined
  )[] = metadataList.length > 0 ? metadataList : [undefined];
  return actionMetadataList.map((metadata) => ({
    kind: "select_pending_to_resolve",
    actionId: createSelectPendingToResolveLegalActionId(
      pending.pendingId,
      getPendingSelectActionSourceId(metadata),
      metadata?.registrationIndex
    ),
    can: true,
    reason: `legal_select_pending_to_resolve_${pending.eventKind}`,
    actingPlayerId: turnPlayerId,
    pendingId: pending.pendingId,
    ownerPlayerId: pending.actingPlayerId,
    eventKind: pending.eventKind,
    ...(metadata ?? {}),
  }));
}

function triggeredSourceChoiceMatchesPendingSelection(
  pendingTriggeredEffect: PendingTriggeredEffect,
  sourceChoice: TriggeredEffectSourceChoice
): boolean {
  if (
    pendingTriggeredEffect.selectedSourceInstanceId !== undefined &&
    sourceChoice.sourceCard.instanceId !==
      pendingTriggeredEffect.selectedSourceInstanceId
  ) {
    return false;
  }
  if (
    pendingTriggeredEffect.selectedSourceEffectInstanceId !== undefined &&
    sourceChoice.sourceEffectInstanceId !==
      pendingTriggeredEffect.selectedSourceEffectInstanceId
  ) {
    return false;
  }
  if (
    pendingTriggeredEffect.selectedRegistrationIndex !== undefined &&
    sourceChoice.registrationIndex !==
      pendingTriggeredEffect.selectedRegistrationIndex
  ) {
    return false;
  }
  return true;
}

interface CandidateEvaluationContext {
  state: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}

function candidateTargetOptions(
  options: CandidateEvaluationContext,
  sourceInstanceId: string,
  extra: Omit<
    CandidateTargetOptions,
    | "getCardDefinitionById"
    | "sourceInstanceId"
    | "evaluateCondition"
    | "evaluateApplicability"
  > = {}
): CandidateTargetOptions {
  return {
    ...extra,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId,
    evaluateCondition: (condition, conditionSourceInstanceId, actingPlayerId) =>
      evaluateCondition(
        options.state,
        condition,
        conditionSourceInstanceId,
        actingPlayerId,
        options.getCardDefinitionById
      ),
    evaluateApplicability: (applicability, applicabilitySourceInstanceId) =>
      evaluateApplicability(
        options.state,
        applicability,
        applicabilitySourceInstanceId,
        options.getCardDefinitionById
      ),
  };
}

function cardFilterEvaluationOptions(
  options: CandidateEvaluationContext
): Pick<MatchCardFilterOptions, "evaluateCondition" | "evaluateApplicability"> {
  return {
    evaluateCondition: (condition, conditionSourceInstanceId, actingPlayerId) =>
      evaluateCondition(
        options.state,
        condition,
        conditionSourceInstanceId,
        actingPlayerId,
        options.getCardDefinitionById
      ),
    evaluateApplicability: (applicability, applicabilitySourceInstanceId) =>
      evaluateApplicability(
        options.state,
        applicability,
        applicabilitySourceInstanceId,
        options.getCardDefinitionById
      ),
  };
}

function combinationsOfSize<T>(values: readonly T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (values.length < size) return [];
  const results: T[][] = [];
  const visit = (start: number, selected: T[]) => {
    if (selected.length === size) {
      results.push([...selected]);
      return;
    }
    const remainingNeeded = size - selected.length;
    for (let i = start; i <= values.length - remainingNeeded; i += 1) {
      selected.push(values[i]!);
      visit(i + 1, selected);
      selected.pop();
    }
  };
  visit(0, []);
  return results;
}

function getAttackExhaustCostChoices(
  state: GameState,
  sourceCard: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): (string[] | undefined)[] {
  const requiredCount = getRequiredAttackExhaustCostCount(
    state,
    sourceCard,
    getCardDefinitionById
  );
  if (requiredCount === 0) return [undefined];
  const candidates = getRequiredAttackExhaustCostSourceCandidates(
    state,
    sourceCard,
    getCardDefinitionById
  );
  if (candidates === null) return [undefined];
  return combinationsOfSize(candidates, requiredCount);
}

function attackExhaustCostActionSuffix(choice: string[] | undefined): string {
  return choice === undefined ? "" : `:exhaust:${choice.join("+")}`;
}

function attackExhaustCostActionProps(choice: string[] | undefined):
  | {
      attackExhaustCostSourceInstanceId: string;
      attackExhaustCostSourceInstanceIds: string[];
    }
  | Record<string, never> {
  return choice === undefined
    ? {}
    : {
        attackExhaustCostSourceInstanceId: choice[0]!,
        attackExhaustCostSourceInstanceIds: choice,
      };
}

/**
 * battle_destroy_cost_gate (BSDB01-C09) の破壊コスト源選択肢。
 * getAttackExhaustCostChoices と同型 (attack_exhaust_cost_gate の破壊版)。
 * tags で attack/block/both の適用範囲を絞る (require_battle_cost と同じ構造)。
 */
function getBattleDestroyCostChoices(
  state: GameState,
  sourceCard: CardInstance,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  tags: readonly string[]
): (string[] | undefined)[] {
  const requiredCount = getRequiredBattleDestroyCostCount(
    state,
    sourceCard,
    getCardDefinitionById,
    tags
  );
  if (requiredCount === 0) return [undefined];
  return getBattleCardCostPaymentPlans(
    state,
    sourceCard,
    getCardDefinitionById,
    tags
  ).map((plan) => plan.map((item) => item.instanceId));
}

function battleDestroyCostActionSuffix(choice: string[] | undefined): string {
  return choice === undefined ? "" : `:destroy-cost:${choice.join("+")}`;
}

function battleDestroyCostActionProps(choice: string[] | undefined):
  | {
      battleDestroyCostSourceInstanceId: string;
      battleDestroyCostSourceInstanceIds: string[];
    }
  | Record<string, never> {
  return choice === undefined
    ? {}
    : {
        battleDestroyCostSourceInstanceId: choice[0]!,
        battleDestroyCostSourceInstanceIds: choice,
      };
}

type MagicZoneCostDiscountOption =
  | {
      kind: "exact";
      modifier: AdditionalCostModifier;
      candidateCardInstanceIds: string[];
      count: number;
      paymentSources: ReturnType<typeof getAvailableMagicPaymentSources>;
    }
  | {
      /**
       * 「手札を○枚まで破棄し、破棄1枚につきコストを-N」型 (BSAZ03-M01 effects[1b])。
       * exact と異なり必要枚数が固定でなく 0〜maxCount の範囲でプレイヤーが選ぶため、
       * legal action 側では最終コストが選択枚数に応じて変動する
       * (zoneCostDiscountPerCard × 実選択枚数 が getZoneCostPaymentForMagic で解決)。
       * ここでの paymentSources は「最大枚数まで破棄した場合」の best-case 判定用。
       * sourceZone:"field" 版 (BSAZ01-C06 effects[2]、useCostPayment.kind:
       * "return_to_deck_bottom_field") も同じ variable 判定を共有する
       * (findCandidates は sourceZone を汎用的に扱うため区別不要)。
       */
      kind: "variable";
      discountPerCard: number;
      maxCount: number;
      candidateCardInstanceIds: string[];
      paymentSources: ReturnType<typeof getAvailableMagicPaymentSources>;
    };

function getMagicZoneCostDiscountOptions(options: {
  state: GameState;
  actingPlayerId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  effectMode: "main" | "flash" | "stack";
  allowedSourceZones: readonly Zone[];
}): MagicZoneCostDiscountOption[] {
  const results: MagicZoneCostDiscountOption[] = [];

  const findCandidates = (
    zone: Zone,
    filter: import("../dsl-types").CardFilter | undefined
  ): string[] =>
    options.state.cardInstances
      .filter((card) => {
        // 使用宣言中のカード自身は候補から除外する (discard_hand は sourceZone:"hand"
        // のため、対象カード自身が候補プールに紛れ込む唯一のケース。BSAZ03-M01 effects[1b])。
        if (card.instanceId === options.sourceCard.instanceId) return false;
        if (card.ownerPlayerId !== options.actingPlayerId) return false;
        if (card.zone !== zone) return false;
        if (!filter) return true;
        const def = options.getCardDefinitionById(card.definitionId);
        if (!def) return false;
        return matchesCardFilter(card, def, filter, {
          ...cardFilterEvaluationOptions(options),
          effectiveColors: getEffectiveColors(options.state, card, def),
          effectiveLevel:
            card.zone === "field"
              ? getEffectiveLevel(
                  options.state,
                  card,
                  def,
                  options.getCardDefinitionById
                )
              : undefined,
        });
      })
      .map((card) => card.instanceId);

  // 継続 cost_modify+useCostPayment ステップを1カード分スキャンし results に積む。
  // scope "self": ceHolder(=使用中のマジック自身)の target 版
  // (「このカードを使用するとき、〜することでコストを-N」)。
  // scope "player": ceHolder(=自分のフィールドの別カード)が持つ player+cardFilter 版
  // (「自分が◯◯マジックのコストを支払うとき、〜することで…」。BSAZ01-C14 型)。
  // useCostPayment 併用の player scope CE は登録済 CE (getApplicableAdditionalCostDeltaCEs)
  // 側に情報が無いため、self scope と同じ DSL 直接読みで扱う (SSOT: 同一スキャンロジック共有)。
  const scanEffects = (
    effects: readonly Effect[],
    ceHolderCard: CardInstance,
    ceHolderCardNo: string,
    scope: "self" | "player"
  ): void => {
    for (const effect of effects) {
      if (effect.timing.kind !== "continuous") continue;
      if (
        effect.condition &&
        effect.condition.length > 0 &&
        !evaluateCondition(
          options.state,
          effect.condition,
          ceHolderCard.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )
      ) {
        continue;
      }
      if (
        effect.applicability &&
        !evaluateApplicability(
          options.state,
          effect.applicability,
          ceHolderCard.instanceId,
          options.getCardDefinitionById
        )
      ) {
        continue;
      }

      for (const step of effect.steps) {
        const action = step.action;
        if (action.kind !== "cost_modify") continue;
        if (!action.useCostPayment) continue;
        if (scope === "self") {
          if (!action.target) continue;
        } else {
          if (action.target || !action.player) continue;
          const resolvedPlayerId =
            action.player === "opponent"
              ? (options.state.players.find(
                  (p) => p.id !== ceHolderCard.ownerPlayerId
                )?.id ?? ceHolderCard.ownerPlayerId)
              : ceHolderCard.ownerPlayerId;
          if (resolvedPlayerId !== options.actingPlayerId) continue;
          if (
            action.cardFilter &&
            !matchesCardFilter(
              options.sourceCard,
              options.sourceDefinition,
              action.cardFilter,
              {
                ...cardFilterEvaluationOptions(options),
                effectiveColors: getEffectiveColors(
                  options.state,
                  options.sourceCard,
                  options.sourceDefinition
                ),
                effectiveLevel:
                  options.sourceCard.zone === "field"
                    ? getEffectiveLevel(
                        options.state,
                        options.sourceCard,
                        options.sourceDefinition,
                        options.getCardDefinitionById
                      )
                    : undefined,
              }
            )
          ) {
            continue;
          }
        }
        const modifier = action.modifier;
        if (
          typeof modifier !== "object" ||
          !("additionalCostValue" in modifier) ||
          // useCostPayment (可変枚数コスト軽減) は DynamicCount 未対応。数値のみ扱う
          // (ENGINE-cost-modify-additional-cost-value-dynamic-amount のスコープ外)。
          typeof modifier.additionalCostValue !== "number" ||
          modifier.additionalCostValue >= 0
        ) {
          continue;
        }
        const payment = action.useCostPayment;
        // "core_move" (BSSL01-M02 型) は召喚コスト専用の代替支払い（トラッシュのコアを
        // フィールド/リザーブに置く）で、マジック使用コストのゾーン割引とは無関係
        // （card.filter を持たずカード候補も無い）。ここでは対象外として素通りする
        // （検出・解決は mechanics/summon-cost-core-move-choice.ts の専用経路）。
        if (payment.kind === "core_move") continue;

        if (payment.kind === "return_to_deck_top_bottom") {
          if (payment.count !== 2) continue;
          const candidates = findCandidates(payment.sourceZone, payment.filter);
          if (candidates.length < payment.count) continue;

          const costModifier: AdditionalCostModifier = {
            amount: modifier.additionalCostValue,
            reason: `zone_cost:${ceHolderCardNo}`,
          };
          const paymentSources = getAvailableMagicPaymentSources({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            magicInstanceId: options.sourceCard.instanceId,
            getCardDefinitionById: options.getCardDefinitionById,
            effectMode: options.effectMode,
            additionalCostModifiers: [costModifier],
            allowedSourceZones: options.allowedSourceZones,
          });
          if (!paymentSources.canFullyPay) continue;
          results.push({
            kind: "exact",
            modifier: costModifier,
            candidateCardInstanceIds: candidates,
            count: payment.count,
            paymentSources,
          });
          continue;
        }

        if (
          payment.kind === "discard_hand" ||
          payment.kind === "return_to_deck_bottom_field"
        ) {
          const rawCandidates = findCandidates(
            payment.sourceZone,
            payment.filter
          );
          // field 由来カード (return_to_deck_bottom_field) は cannot_leave_field /
          // cannot_be_sent_to_deck 耐性を持ちうる。候補段階で除外しないと、legal action
          // 確定時の割引額 (discountPerCard × 選択枚数) と executeSendToDeck が実際に
          // 移動できる枚数が食い違い、「割引だけ得てカードは場に残る」不整合が生じる
          // (adversarial verifier round1 Lens3 指摘)。discard_hand の sourceZone:"hand"
          // にはこの耐性が及ばないため対象外。
          const candidates =
            payment.kind === "return_to_deck_bottom_field"
              ? rawCandidates.filter((id) => {
                  const card = options.state.cardInstances.find(
                    (c) => c.instanceId === id
                  );
                  return (
                    card !== undefined &&
                    !isCardLeaveAffectBlockedByResistance(
                      options.state,
                      card,
                      "send_to_deck",
                      options.actingPlayerId,
                      options.getCardDefinitionById
                    )
                  );
                })
              : rawCandidates;
          if (candidates.length === 0) continue;
          const discountPerCard = modifier.additionalCostValue;
          const bestCaseCount = Math.min(payment.maxCount, candidates.length);
          const bestCaseModifier: AdditionalCostModifier = {
            amount: discountPerCard * bestCaseCount,
            reason: `zone_cost:${ceHolderCardNo}`,
          };
          const paymentSources = getAvailableMagicPaymentSources({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            magicInstanceId: options.sourceCard.instanceId,
            getCardDefinitionById: options.getCardDefinitionById,
            effectMode: options.effectMode,
            additionalCostModifiers: [bestCaseModifier],
            allowedSourceZones: options.allowedSourceZones,
          });
          if (!paymentSources.canFullyPay) continue;
          results.push({
            kind: "variable",
            discountPerCard,
            maxCount: payment.maxCount,
            candidateCardInstanceIds: candidates,
            paymentSources,
          });
        }
      }
    }
  };

  scanEffects(
    options.sourceDefinition.effects ?? [],
    options.sourceCard,
    options.sourceDefinition.cardNo,
    "self"
  );

  // player scope: 自分のフィールドの他カードが持つ「自分が◯◯マジックのコストを
  // 支払うとき、〜することで軽減する」型 CE も候補にする
  // (engine-cost-modify-player-scoped-zone-discount)。self scope とは異なりカード自身の
  // 効果ではないため、フィールド上の全自軍カードを走査する。
  for (const fieldCard of options.state.cardInstances) {
    if (fieldCard.zone !== "field") continue;
    if (fieldCard.ownerPlayerId !== options.actingPlayerId) continue;
    if (fieldCard.instanceId === options.sourceCard.instanceId) continue;
    const ceHolderDefinition = options.getCardDefinitionById(
      fieldCard.definitionId
    );
    if (!ceHolderDefinition) continue;
    scanEffects(
      ceHolderDefinition.effects ?? [],
      fieldCard,
      ceHolderDefinition.cardNo,
      "player"
    );
  }

  return results;
}

function getBurstIgnoresOpponentCannotActivateBurst(
  burstDefinition: CardDefinition | undefined,
  effectIndex: number | undefined,
  allowLegacyWholeCardScan: boolean
): boolean {
  if (burstDefinition === undefined) return false;
  const effects = burstDefinition.effects ?? [];
  if (effectIndex !== undefined) {
    const effect = effects[effectIndex];
    return (
      effect?.timing.kind === "burst" &&
      effect.ignoresOpponentCannotActivateBurst === true
    );
  }
  if (!allowLegacyWholeCardScan) return false;
  return effects.some(
    (effect) =>
      effect.timing.kind === "burst" &&
      effect.ignoresOpponentCannotActivateBurst === true
  );
}

function getResolvedMaxTargetCount(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  actionRegistration: import("./legal-actions-types").RegisteredTargetedEffectActionBase,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): number {
  const baseMaxTargetCount =
    actionRegistration.maxTargetCountDynamic === undefined
      ? getMaxTargetCount(actionRegistration)
      : (() => {
          const stepContext = createStepExecutionContext(state);
          stepContext.sourceInstanceId = sourceInstanceId;
          return resolveCountBound(
            actionRegistration.maxTargetCountDynamic!,
            state,
            actingPlayerId,
            stepContext,
            getCardDefinitionById
          );
        })();
  if (baseMaxTargetCount <= 0) return baseMaxTargetCount;
  // ENGINE-target-count-expand-modifier Step4: GUI 候補数上限への expand_effect_target_count
  // CE (BSLH01-TR02(A) 等) の楽観的加算。実対象数の SSOT は実行時の候補プールベース判定
  // (getExpandEffectTargetCountBonus) であり、本関数は「+1 選択できる」ことを示す上限のみ。
  return (
    baseMaxTargetCount +
    getExpandEffectTargetCountBonusDeclarative({
      state,
      actingPlayerId,
      sourceInstanceId,
      registration: actionRegistration,
      getCardDefinitionById,
    })
  );
}

function createCountBoundResolver(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): (bound: import("../dsl-types").CountBound) => number {
  return (bound) => {
    const stepContext = createStepExecutionContext(state);
    stepContext.sourceInstanceId = sourceInstanceId;
    return resolveCountBound(
      bound,
      state,
      actingPlayerId,
      stepContext,
      getCardDefinitionById
    );
  };
}

function getResolvedRequiredTargetCount(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  actionRegistration: import("./legal-actions-types").RegisteredTargetedEffectActionBase,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): number {
  if (actionRegistration.requiredTargetCountDynamic === undefined) {
    return getRequiredTargetCount(actionRegistration);
  }
  return createCountBoundResolver(
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById
  )(actionRegistration.requiredTargetCountDynamic);
}

/**
 * D-2 Phase 2 chooser 解決ヘルパー。
 * registration の chooser メタデータと effect owner / opponent から
 * 対象選択を委ねるプレイヤー ID を導出する。
 *
 * 戻り値:
 * - chooser 未指定 / "self" → ownerPlayerId
 * - "opponent" → ownerOpponentId (なければ ownerPlayerId)
 * - "either" → 現状 ownerPlayerId (prompt routing は未実装、registration に存在するだけ)
 */
function resolveChooserPlayerId(
  state: GetLegalActionsOptions["state"],
  ownerPlayerId: string,
  chooserMode: "self" | "opponent" | "either" | undefined
): string {
  if (chooserMode === "opponent") {
    const opponent = state.players.find((p) => p.id !== ownerPlayerId)?.id;
    return opponent ?? ownerPlayerId;
  }
  return ownerPlayerId;
}

function isHostWithinBraveCombineLimit(options: {
  state: GameState;
  host: CardInstance;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const hostDef = options.getCardDefinitionById(options.host.definitionId);
  const cap =
    getActiveMaxCombinedBravesForHost({
      state: options.state,
      host: options.host,
      hostDef,
      getCardDefinitionById: options.getCardDefinitionById,
    })?.count ?? 1;
  return (
    attachedBravesCountingTowardLimit(
      options.state,
      options.host,
      hostDef,
      options.getCardDefinitionById
    ) <= cap
  );
}

function areHostAttachedBravesLegal(options: {
  state: GameState;
  host: CardInstance;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const hostDef = options.getCardDefinitionById(options.host.definitionId);
  // def 未解決なら合体上限/braveCondition を検査できない。ブレイヴを失う側の
  // 再検証（ブレイヴ数は減る＝より合法）で不明を違法扱いにすると正当な swap を
  // 誤って阻む (BSTH02-X04 系 swap)。検査できない場合は許容する。
  if (!hostDef) return true;
  if (!isHostWithinBraveCombineLimit(options)) return false;

  for (const braveId of options.host.attachedChildrenIds) {
    const brave = getCardById(options.state, braveId);
    const braveDef = brave
      ? options.getCardDefinitionById(brave.definitionId)
      : undefined;
    if (!braveDef?.braveCondition) continue;
    if (
      !matchesBraveConditionForCard({
        condition: braveDef.braveCondition,
        state: options.state,
        card: options.host,
        definition: hostDef,
        getCardDefinitionById: options.getCardDefinitionById,
        excludeBraveInstanceId: braveId,
        categoryEvaluation: "brave_host",
      })
    ) {
      return false;
    }
  }
  return true;
}

function canPerformOneWayBraveSwap(options: {
  state: GameState;
  fromHost: CardInstance;
  braveId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const simulatedFromHost: CardInstance = {
    ...options.fromHost,
    attachedChildrenIds: options.fromHost.attachedChildrenIds.filter(
      (id) => id !== options.braveId
    ),
  };
  return areHostAttachedBravesLegal({
    state: options.state,
    host: simulatedFromHost,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

/**
 * conditional_cost composition の canExecute チェックを legality 時に実行する。
 * いずれかのステップが実行不可なら true を返す (= blocked)。
 */
export function isConditionalCostBlocked(options: {
  state: GetLegalActionsOptions["state"];
  actingPlayerId: string;
  sourceCard: GetLegalActionsOptions["state"]["cardInstances"][number];
  sourceDefinition: NonNullable<
    ReturnType<GetLegalActionsOptions["getCardDefinitionById"]>
  >;
  sourceKind: string;
  resolutionKind: EffectActionContext["resolutionKind"];
  composition: { kind: string; steps: readonly unknown[] } | undefined;
  effect?: Effect | undefined;
  choiceIndex?: number | undefined;
  effectIndex?: number | undefined;
  effectSourceInstanceId?: string | undefined;
  effectSourceDefinition?: CardDefinition | undefined;
  sourcePreventionLevel?: EffectPreventionLevel | undefined;
  sourceTargetLockBypass?: TargetLockBypassProfile | undefined;
  sourcePreventionBypass?: TargetLockBypassProfile | undefined;
  effectActionKind?: EffectResolutionActionKind | undefined;
  getCardDefinitionById: GetLegalActionsOptions["getCardDefinitionById"];
  getRegisteredTriggeredEffectActions: GetLegalActionsOptions["getRegisteredTriggeredEffectActions"];
  getRegisteredBurstActions: GetLegalActionsOptions["getRegisteredBurstActions"];
  getConditionalCostCanExecuteCheck: GetLegalActionsOptions["getConditionalCostCanExecuteCheck"];
}): boolean {
  const hasConditionalCostComposition =
    options.composition?.kind === "conditional_cost";
  const hasConditionalCostSteps =
    options.effect?.steps.some(
      (step) => step.connector === "conditional_cost"
    ) === true;
  if (!hasConditionalCostComposition && !hasConditionalCostSteps) {
    return false;
  }

  if (
    hasConditionalCostComposition &&
    options.getConditionalCostCanExecuteCheck
  ) {
    const minimalContext: EffectActionContext = {
      chainId: "",
      resolutionKind: options.resolutionKind,
      actingPlayerId: options.actingPlayerId,
      sourceKind: options.sourceKind as EffectActionContext["sourceKind"],
      sourceCard: options.sourceCard,
      sourceDefinition: options.sourceDefinition,
      targetInstanceIds: [],
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    };

    for (let i = 0; i < options.composition!.steps.length; i++) {
      const check = options.getConditionalCostCanExecuteCheck(
        options.sourceDefinition.cardNo,
        i
      );
      if (check && !check(options.state, minimalContext)) {
        return true;
      }
    }
  }

  if (!options.effect) {
    return false;
  }

  const resolvedSteps = getResolvedEffectStepsForAvailability(
    options.effect,
    options.choiceIndex
  );
  const stepCtx = createStepExecutionContext(options.state);

  for (let i = 0; i + 1 < resolvedSteps.length; i++) {
    const costStep = resolvedSteps[i]!;
    const resultStep = resolvedSteps[i + 1]!;
    if (resultStep.connector !== "conditional_cost") {
      continue;
    }
    // 後段の任意対価は、それ以前の独立した効果を宣言不能にしない。
    // 先行手順で資源や対象が変わるので、後段は到達時の共通判定に委ねる。
    if (i !== 0 || costStep.executionMode === "optional") continue;
    if (
      !isStepConditionPossibleForAvailability(
        costStep.stepCondition,
        options.choiceIndex
      ) ||
      !isStepConditionPossibleForAvailability(
        resultStep.stepCondition,
        options.choiceIndex
      )
    ) {
      continue;
    }
    if (
      [costStep, resultStep].some(
        (step) =>
          step.condition?.length &&
          !evaluateCondition(
            options.state,
            step.condition,
            options.sourceCard.instanceId,
            options.actingPlayerId,
            options.getCardDefinitionById
          )
      )
    )
      continue;
    const costPreview = previewConditionalCoreCost({
      state: options.state,
      action: costStep.action,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: options.sourceCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
      sourcePreventionLevel: options.sourcePreventionLevel,
      sourcePreventionBypass: options.sourcePreventionBypass,
      sourceTargetLockBypass: options.sourceTargetLockBypass,
      effectSourceInstanceId: options.effectSourceInstanceId,
      effectSourceDefinitionId: options.effectSourceDefinition?.cardNo,
    });
    if (costPreview?.paid === false) return true;
    const preGateCostStep = shouldPreGateConditionalCostStep(costStep.action);
    const preGateResultStep =
      resultStep.executionMode !== "optional" &&
      shouldPreGateConditionalCostResultStep(resultStep.action) &&
      (resultStep.action.kind === "draw" ||
        resultStep.action.kind === "deck_reveal" ||
        !shouldPreGateConditionalCostStep(costStep.action));
    if (!preGateCostStep && !preGateResultStep) {
      continue;
    }
    if (
      preGateCostStep &&
      !canExecuteOptionalStep({
        action: costStep.action,
        effect: options.effect,
        effectIndex: options.effectIndex,
        targetStepId: costStep.id ?? `__step_${i}`,
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId:
          options.effectSourceInstanceId ?? options.sourceCard.instanceId,
        getCardDefinitionById: options.getCardDefinitionById,
        stepCtx,
        sourceDefinition: options.sourceDefinition,
        ...(options.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: options.effectSourceInstanceId }
          : {}),
        ...(options.effectSourceDefinition !== undefined
          ? { effectSourceDefinition: options.effectSourceDefinition }
          : {}),
        ...(options.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: options.sourcePreventionLevel }
          : {}),
        ...(options.sourceTargetLockBypass !== undefined
          ? { sourceTargetLockBypass: options.sourceTargetLockBypass }
          : {}),
        ...(options.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: options.sourcePreventionBypass }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
      })
    ) {
      return true;
    }
    if (
      preGateResultStep &&
      !canExecuteOptionalStep({
        action: resultStep.action,
        effect: options.effect,
        effectIndex: options.effectIndex,
        targetStepId: resultStep.id ?? `__step_${i + 1}`,
        state: costPreview?.state ?? options.state,
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId:
          options.effectSourceInstanceId ?? options.sourceCard.instanceId,
        getCardDefinitionById: options.getCardDefinitionById,
        stepCtx,
        sourceDefinition: options.sourceDefinition,
        ...(options.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: options.effectSourceInstanceId }
          : {}),
        ...(options.effectSourceDefinition !== undefined
          ? { effectSourceDefinition: options.effectSourceDefinition }
          : {}),
        ...(options.sourcePreventionLevel !== undefined
          ? { sourcePreventionLevel: options.sourcePreventionLevel }
          : {}),
        ...(options.sourceTargetLockBypass !== undefined
          ? { sourceTargetLockBypass: options.sourceTargetLockBypass }
          : {}),
        ...(options.sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass: options.sourcePreventionBypass }
          : {}),
        ...(options.effectActionKind !== undefined
          ? { effectActionKind: options.effectActionKind }
          : {}),
      })
    ) {
      return true;
    }
  }

  return false;
}

function getResolvedEffectStepsForAvailability(
  effect: Effect,
  choiceIndex: number | undefined
): EffectStep[] {
  return effect.steps.flatMap((step) => {
    if (!step.choice || step.choice.length === 0) {
      return [step];
    }
    if (
      choiceIndex !== undefined &&
      choiceIndex > 0 &&
      choiceIndex <= step.choice.length
    ) {
      return [
        mergeChoiceStepForAvailability(step, step.choice[choiceIndex - 1]!),
      ];
    }
    return [step];
  });
}

function mergeChoiceStepForAvailability(
  parent: EffectStep,
  choice: EffectStep
): EffectStep {
  return {
    ...choice,
    ...(choice.id === undefined && parent.id !== undefined
      ? { id: parent.id }
      : {}),
    ...(choice.connector === undefined && parent.connector !== undefined
      ? { connector: parent.connector }
      : {}),
    ...(choice.stepCondition === undefined && parent.stepCondition !== undefined
      ? { stepCondition: parent.stepCondition }
      : {}),
  };
}

function isStepConditionPossibleForAvailability(
  condition: StepCondition | undefined,
  choiceIndex: number | undefined
): boolean {
  if (!condition) return true;
  return (
    evaluateChoiceStepConditionForAvailability(condition, choiceIndex) !== false
  );
}

function evaluateChoiceStepConditionForAvailability(
  condition: StepCondition,
  choiceIndex: number | undefined
): boolean | undefined {
  let result: boolean | undefined;
  if (condition.kind === "ref_choice") {
    result =
      choiceIndex === undefined
        ? undefined
        : condition.choiceIndex === choiceIndex;
  } else if (condition.kind === "all") {
    let sawUnknown = false;
    for (const child of condition.conditions) {
      const childResult = evaluateChoiceStepConditionForAvailability(
        child,
        choiceIndex
      );
      if (childResult === false) {
        result = false;
        break;
      }
      if (childResult === undefined) sawUnknown = true;
    }
    if (result === undefined && !sawUnknown) result = true;
  }

  if (result === undefined) return undefined;
  return condition.not === true ? !result : result;
}

function shouldPreGateConditionalCostStep(action: Action): boolean {
  return (
    action.kind === "exhaust" ||
    action.kind === "recover" ||
    action.kind === "set_exhaust_state"
  );
}

/**
 * コスト側の step result に依存せず、宣言時点で実行可否を確定できる効果だけを扱う。
 * deck_reveal / draw は空デッキでは state を変えず conditional_cost rollback になるため、
 * 同じ宣言を繰り返せないよう legality 時点で封鎖する。
 */
function shouldPreGateConditionalCostResultStep(action: Action): boolean {
  return (
    action.kind === "deck_reveal" ||
    action.kind === "draw" ||
    action.kind === "recover" ||
    action.kind === "exhaust" ||
    action.kind === "set_exhaust_state"
  );
}

type QueueHandTrashSwapAction = Extract<
  Action,
  { kind: "queue_hand_trash_swap" }
>;
type QueueHandTrashSwapStep = EffectStep & {
  action: QueueHandTrashSwapAction;
};

function isQueueHandTrashSwapStep(
  step: EffectStep
): step is QueueHandTrashSwapStep {
  return step.action.kind === "queue_hand_trash_swap";
}

function resolveAvailabilitySourcePrevention(options: {
  state: GameState;
  sourceInstanceId: string | undefined;
  actingPlayerId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  registrationPreventionLevel: EffectPreventionLevel | undefined;
  registrationPreventionBypass?: TargetLockBypassProfile | undefined;
}): {
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
} {
  const dynamicBypass = getEffectSourceTribePreventionBypass(
    options.state,
    options.sourceInstanceId,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  if (dynamicBypass?.kind === "all_effects") {
    return { sourcePreventionLevel: "unpreventable" };
  }
  return {
    ...(options.registrationPreventionLevel !== undefined
      ? { sourcePreventionLevel: options.registrationPreventionLevel }
      : {}),
    ...(() => {
      const sourcePreventionBypass = mergeTargetLockBypassProfiles(
        options.registrationPreventionBypass,
        dynamicBypass
      );
      return sourcePreventionBypass !== undefined
        ? { sourcePreventionBypass }
        : {};
    })(),
  };
}

function isQueueHandTrashSwapEffectAvailable(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  sourceDefinition: CardDefinition;
  effectSourceInstanceId: string;
  effectSourceDefinition: CardDefinition;
  effect: Effect;
  choiceIndex: number | undefined;
  actionRegistration: RegisteredTargetedEffectActionBase;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const steps = getResolvedEffectStepsForAvailability(
    options.effect,
    options.choiceIndex
  );
  const queueSteps = steps.filter(isQueueHandTrashSwapStep);
  if (queueSteps.length === 0) {
    return true;
  }
  if (steps.some((step) => step.action.kind !== "queue_hand_trash_swap")) {
    return true;
  }

  const effectSourceCard = getCardById(
    options.state,
    options.effectSourceInstanceId
  );
  const prevention = resolveAvailabilitySourcePrevention({
    state: options.state,
    sourceInstanceId: options.effectSourceInstanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    registrationPreventionLevel: options.actionRegistration.preventionLevel,
    registrationPreventionBypass: options.actionRegistration.targetLockBypass,
  });
  const effectSource = {
    ...(effectSourceCard ? { instance: effectSourceCard } : {}),
    definition: options.effectSourceDefinition,
  };

  return queueSteps.some((step) => {
    if (
      step.condition &&
      step.condition.length > 0 &&
      !evaluateCondition(
        options.state,
        step.condition,
        options.sourceInstanceId,
        options.actingPlayerId,
        options.getCardDefinitionById
      )
    ) {
      return false;
    }
    const { outgoingCandidates, incomingCandidates } =
      resolveHandTrashSwapCandidates({
        state: options.state,
        sourceInstanceId: options.sourceInstanceId,
        actingPlayerId: options.actingPlayerId,
        action: step.action,
        getCardDefinitionById: options.getCardDefinitionById,
        sourceDefinition: options.sourceDefinition,
        effectSource,
        ...prevention,
      });
    return outgoingCandidates.length > 0 && incomingCandidates.length > 0;
  });
}

function getTargetMagicFollowUpUseOption(options: {
  state: GetLegalActionsOptions["state"];
  actingPlayerId: string;
  targetInstanceId: string;
  getCardDefinitionById: GetLegalActionsOptions["getCardDefinitionById"];
  getRegisteredMagicActions: GetLegalActionsOptions["getRegisteredMagicActions"];
}): {
  targetInstanceId: string;
  targetMode: "none" | "manual";
  requiredTargetCount: number;
  /** 可変選択時の上限。省略時=requiredTargetCount（固定数）。D-2 Phase 2。 */
  maxTargetCount?: number;
  targetEffectFilterTags: readonly EffectFilterTag[];
  candidateTargetInstanceIds: string[];
  availableChosenLifeCoreKinds: LifeCoreKind[];
  requiresChosenLifeCoreKind: boolean;
} | null {
  const targetCard = getCardById(options.state, options.targetInstanceId);

  if (!targetCard || targetCard.controllerPlayerId !== options.actingPlayerId) {
    return null;
  }

  const targetDefinition = options.getCardDefinitionById(
    targetCard.definitionId
  );

  if (!targetDefinition || !isMagicLikeCardForm(targetCard, targetDefinition)) {
    return null;
  }

  const actionRegistrations = options.getRegisteredMagicActions?.(
    targetDefinition.cardNo
  );
  const actionRegistration = actionRegistrations?.[0];

  if (!actionRegistration) {
    return {
      targetInstanceId: targetCard.instanceId,
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: ["general"],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
    };
  }

  const requiredTargetCount = getResolvedRequiredTargetCount(
    options.state,
    options.actingPlayerId,
    targetCard.instanceId,
    actionRegistration,
    options.getCardDefinitionById
  );
  const maxTargetCount = getResolvedMaxTargetCount(
    options.state,
    options.actingPlayerId,
    targetCard.instanceId,
    actionRegistration,
    options.getCardDefinitionById
  );
  const needsCandidates = requiredTargetCount > 0 || maxTargetCount > 0;
  const candidateTargetInstanceIds = !needsCandidates
    ? []
    : getCandidateTargetInstanceIds(
        options.state,
        options.actingPlayerId,
        actionRegistration,
        candidateTargetOptions(options, targetCard.instanceId)
      );
  const availableChosenLifeCoreKinds =
    actionRegistration.actingPlayerLifeCoreChoice
      ? getAvailableChosenLifeCoreKinds({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: targetCard.instanceId,
          actionRegistration,
          candidateTargetInstanceIds,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      : [];

  // 空撃ち許可: 対象不在でもアクション生成（効果はスキップされる）
  // ただし requiredTargetCount が 0 でない場合は候補なしでも OK

  if (
    actionRegistration.actingPlayerLifeCoreChoice &&
    availableChosenLifeCoreKinds.length === 0
  ) {
    return null;
  }

  return {
    targetInstanceId: targetCard.instanceId,
    targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
    requiredTargetCount,
    ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
    targetEffectFilterTags: getTargetEffectFilterTags(actionRegistration),
    candidateTargetInstanceIds,
    availableChosenLifeCoreKinds,
    requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
  };
}

function getPlayableTargetCardWithoutAdditionalInput(options: {
  state: GetLegalActionsOptions["state"];
  actingPlayerId: string;
  targetInstanceId: string;
  getCardDefinitionById: GetLegalActionsOptions["getCardDefinitionById"];
  getRegisteredHandCardEffectActions: GetLegalActionsOptions["getRegisteredHandCardEffectActions"];
}): {
  targetInstanceId: string;
  enterFieldCorePlacementRule: "required_minimum" | "optional" | "forbidden";
  minimumEnterFieldCoreCount: number;
  maximumEnterFieldCoreCount: number | null;
  requiresEnterFieldCorePlacements: boolean;
} | null {
  const targetCard = getCardById(options.state, options.targetInstanceId);

  if (!targetCard || targetCard.controllerPlayerId !== options.actingPlayerId) {
    return null;
  }

  const targetDefinition = options.getCardDefinitionById(
    targetCard.definitionId
  );

  if (
    !targetDefinition ||
    (targetDefinition.printedCategory !== "spirit" &&
      targetDefinition.printedCategory !== "nexus")
  ) {
    return null;
  }

  const actionRegistration = options.getRegisteredHandCardEffectActions?.(
    targetDefinition.cardNo
  );

  if (
    actionRegistration &&
    (getResolvedRequiredTargetCount(
      options.state,
      options.actingPlayerId,
      targetCard.instanceId,
      actionRegistration,
      options.getCardDefinitionById
    ) > 0 ||
      !!actionRegistration.actingPlayerLifeCoreChoice)
  ) {
    return null;
  }

  const enterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy({
    card: targetCard,
    definition: targetDefinition,
  });

  return {
    targetInstanceId: targetCard.instanceId,
    enterFieldCorePlacementRule: enterFieldCorePlacementPolicy.rule,
    minimumEnterFieldCoreCount: enterFieldCorePlacementPolicy.minimumCoreCount,
    maximumEnterFieldCoreCount: enterFieldCorePlacementPolicy.maximumCoreCount,
    requiresEnterFieldCorePlacements:
      enterFieldCorePlacementPolicy.minimumCoreCount > 0,
  };
}

/**
 * P3-86 案X: 発揮前無効化誘発 (flash-use, 咲夜 BSTH01-X05) と、同じ stack chain から
 * 派生した private declaration は、対象の応答窓
 * (stackWindow / preDeclarationStackWindow / battle flash 窓) にいる間は deferred。
 * = 自分のスタックタイミング (能動応答) を先に処理し、窓クローズ後のチェックポイントで
 * 初めて declare/skip を surface する。
 */
export function isDeferredFlashUsePrivateDeclaration(
  state: GameState,
  declaration: PendingPrivateDeclaration
): boolean {
  return (
    (declaration.eventKind === "flash" &&
      declaration.relatedInstanceId !== null &&
      isInstanceInOpenResponseWindow(state, declaration.relatedInstanceId)) ||
    (declaration.chainId !== null &&
      isChainInOpenResponseWindow(state, declaration.chainId))
  );
}

export function getAvailablePrivateTriggeredEffectDeclarationLegalActions(
  options: GetLegalActionsOptions
): PrivateTriggeredEffectDeclarationLegalAction[] {
  const resolutionState = scopeInnermostTriggerReactions(options.state);
  // 案 X 準拠: 発揮前無効化誘発は対象フラッシュが応答窓にいる間 deferred。
  // 判定は deferred を除いた「現に判断可能な集合」上で行う。
  const nonDeferred = resolutionState.pendingPrivateDeclarations.filter(
    (declaration) =>
      !isDeferredFlashUsePrivateDeclaration(options.state, declaration)
  );
  if (nonDeferred.length === 0) return [];
  const highestPriority = getHighestTriggerPriority([
    ...nonDeferred,
    ...resolutionState.pendingTriggeredEffects,
  ]);
  const priorityNonDeferred = nonDeferred.filter(
    (declaration) => getTriggerPriority(declaration) === highestPriority
  );
  if (priorityNonDeferred.length === 0) return [];

  // 混在オーナー時は insertion 順 owner が先に判断 (旧 [0] ロジック踏襲)。
  // = 「active owner」= nonDeferred[0] のオーナー。他オーナーには何も surface しない。
  const activeOwnerId = priorityNonDeferred[0]!.ownerPlayerId;
  if (activeOwnerId !== options.actingPlayerId) return [];

  // 同一オーナーの全宣言について declare/skip を並列 surface する。
  // 順序選択は EffectQueueOverlay のカード focus と前面カードの action claim に委譲し、
  // engine 側に明示の select ステップは置かない (UI 即応 + 通信往復ゼロ)。
  const ownerQueue = priorityNonDeferred.filter(
    (declaration) => declaration.ownerPlayerId === activeOwnerId
  );
  return ownerQueue.flatMap<PrivateTriggeredEffectDeclarationLegalAction>(
    (declaration) => {
      const sourceDefinition = options.getCardDefinitionById(
        declaration.sourceDefinitionId
      );
      if (!sourceDefinition) return [];
      const canDeclare = canDeclarePrivateTriggeredEffect({
        state: options.state,
        declaration,
        sourceDefinition,
        actingPlayerId: activeOwnerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        getConditionalCostCanExecuteCheck:
          options.getConditionalCostCanExecuteCheck,
      });
      return buildDeclareSkipPair(
        declaration,
        sourceDefinition.cardNo,
        canDeclare
      );
    }
  );
}

function canDeclarePrivateTriggeredEffect(options: {
  state: GameState;
  declaration: PendingPrivateDeclaration;
  sourceDefinition: CardDefinition;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: GetLegalActionsOptions["getRegisteredTriggeredEffectActions"];
  getRegisteredBurstActions: GetLegalActionsOptions["getRegisteredBurstActions"];
  getConditionalCostCanExecuteCheck: GetLegalActionsOptions["getConditionalCostCanExecuteCheck"];
}): boolean {
  if (
    !isPrivateTriggeredDeclarationConditionMet({
      state: options.state,
      declaration: options.declaration,
      sourceDefinition: options.sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    })
  ) {
    return false;
  }

  const registration = options.getRegisteredTriggeredEffectActions(
    options.sourceDefinition.cardNo
  )?.[options.declaration.registrationIndex];
  const effectIndex = registration?.effectIndex;
  if (effectIndex === undefined) return true;
  const effect = options.sourceDefinition.effects?.[effectIndex];
  const sourceCard = getCardById(
    options.state,
    options.declaration.sourceInstanceId
  );
  if (
    effect &&
    sourceCard &&
    registration &&
    isConditionalCostBlocked({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceCard,
      sourceDefinition: options.sourceDefinition,
      sourceKind: registration.sourceKind,
      resolutionKind: "pending_triggered_effect",
      composition: registration.composition,
      effect,
      effectIndex,
      ...resolveAvailabilitySourcePrevention({
        state: options.state,
        sourceInstanceId: sourceCard.instanceId,
        actingPlayerId: options.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        registrationPreventionLevel: registration.preventionLevel,
        registrationPreventionBypass: registration.targetLockBypass,
      }),
      sourceTargetLockBypass: registration.targetLockBypass,
      effectActionKind: "triggered_effect",
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      getConditionalCostCanExecuteCheck:
        options.getConditionalCostCanExecuteCheck,
    })
  )
    return false;
  const negateActions =
    effect !== undefined
      ? getNegateActionsByEffectIndex(options.sourceDefinition, effectIndex)
      : [];
  if (
    negateActions.length === 0 ||
    hasNonNegateChoiceVariant(options.sourceDefinition, effectIndex)
  ) {
    return true;
  }
  return areNegateActionsCompatibleWithRelatedStack({
    state: options.state,
    relatedInstanceId: options.declaration.relatedInstanceId,
    negateActions,
    actingPlayerId: options.actingPlayerId,
    ...(sourceCard ? { sourceCard } : {}),
    sourceDefinition: options.sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
  });
}

function buildDeclareSkipPair(
  declaration: PendingPrivateDeclaration,
  sourceCardNo: string,
  canDeclare = true
): PrivateTriggeredEffectDeclarationLegalAction[] {
  const actions: PrivateTriggeredEffectDeclarationLegalAction[] = [];
  if (canDeclare) {
    actions.push({
      kind: "declare_private_triggered_effect",
      actionId: `declare_private_triggered_effect:${declaration.declarationId}`,
      can: true,
      reason: `legal_declare_private_triggered_effect_${declaration.eventKind}`,
      actingPlayerId: declaration.ownerPlayerId,
      declarationId: declaration.declarationId,
      eventKind: declaration.eventKind,
      sourceInstanceId: declaration.sourceInstanceId,
      sourceDefinitionId: declaration.sourceDefinitionId,
      sourceCardNo,
      registrationIndex: declaration.registrationIndex,
    });
  }
  actions.push({
    kind: "skip_private_triggered_effect",
    actionId: `skip_private_triggered_effect:${declaration.declarationId}`,
    can: true,
    reason: `legal_skip_private_triggered_effect_${declaration.eventKind}`,
    actingPlayerId: declaration.ownerPlayerId,
    declarationId: declaration.declarationId,
    eventKind: declaration.eventKind,
    sourceInstanceId: declaration.sourceInstanceId,
    sourceDefinitionId: declaration.sourceDefinitionId,
    sourceCardNo,
    registrationIndex: declaration.registrationIndex,
  });
  return actions;
}

/**
 * 操作権と合法手で同じ解決候補を数える。休眠観測自体は実状態に保持する。
 * 定義参照がある経路は通常の発揮資格判定を使う。state-onlyの表示/互換経路は
 * 共通pruneが更新する休眠・解決済み登録を読む。
 * 登録記録を持たない旧snapshotは従来どおり扱う。
 */
export function getPendingTriggeredEffectsForResolution(
  options: Pick<GetLegalActionsOptions, "state"> &
    Partial<
      Pick<
        GetLegalActionsOptions,
        "getCardDefinitionById" | "getRegisteredTriggeredEffectActions"
      >
    >
): GameState["pendingTriggeredEffects"] {
  return scopeInnermostTriggerReactions(
    options.state
  ).pendingTriggeredEffects.filter((pendingEffect) => {
    if (
      !pendingEffect.dormantSourceRegistrationKeys?.length ||
      pendingEffect.timingSourceRegistrations === undefined
    )
      return true;

    if (
      options.getCardDefinitionById &&
      options.getRegisteredTriggeredEffectActions
    ) {
      return (
        getAvailableTriggeredEffectSourceChoices({
          state: options.state,
          pendingEffect,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }).length > 0
      );
    }

    const dormant = new Set(pendingEffect.dormantSourceRegistrationKeys);
    const resolved = new Set(
      pendingEffect.resolvedSourceRegistrationKeys ?? []
    );
    return Object.entries(pendingEffect.timingSourceRegistrations).some(
      ([key, source]) =>
        !dormant.has(key) &&
        !resolved.has(key) &&
        // 登録keyはeffect元ID#登録番号。アンダーカードの効果元とhostを区別する。
        !resolved.has(key.replace(/#\d+$/, "")) &&
        !pendingEffect.resolvedSourceInstanceIds.includes(
          source.sourceInstanceId
        )
    );
  });
}

export function getAvailablePendingTriggeredEffectLegalActions(
  options: GetLegalActionsOptions
): Array<
  ResolvePendingTriggeredEffectLegalAction | SelectPendingToResolveLegalAction
> {
  const queue = getPendingTriggeredEffectsForResolution(options);
  if (queue.length === 0) {
    return [];
  }
  const highestPriority = getHighestTriggerPriority(queue);
  const priorityQueue = queue.filter(
    (pending) => getTriggerPriority(pending) === highestPriority
  );

  // P3-36 Phase C: 公開キュー解決順選択権はターンプレイヤーが持つ（厳密ルール）。
  // - selectedByTurnPlayer === true の pending があればそれを起点とする。
  // - 単一 pending は原則 auto-select。ただし相手の複数効果を含む場合は選択が必要。
  // - 2 件以上のキューは同一オーナー・混在オーナーいずれも turn player に
  //   select_pending_to_resolve を提示する。
  const turnPlayerId = options.state.activePlayerId;
  const explicitlySelected = priorityQueue.find(
    (p) => p.selectedByTurnPlayer === true
  );
  const headPending = priorityQueue[0]!;
  // 1イベントに複数カード/複数効果が反応する場合も、相手の効果の順序は
  // ターンプレイヤーが効果単位で選ぶ。イベント件数だけで自動選択しない。
  const requiresSourceSelection =
    priorityQueue.length === 1 &&
    headPending.actingPlayerId !== turnPlayerId &&
    getPendingSelectExecutionMetadataList(options, headPending).length > 1;
  const selectedPending =
    explicitlySelected ??
    (priorityQueue.length === 1 && !requiresSourceSelection
      ? headPending
      : null);

  // キューカードの前面化は UI 内だけの操作で、ここには状態を残さない。したがって
  // 前面化した効果を変えることは、所有者を問わず何度でもできる。
  // `select_pending_to_resolve` は ActionBar の「解決」を押した確定操作であり、その
  // 時点で 1 効果を「次に解決する効果」として固定する。owner が発揮する/しないを
  // 選ぶ間、または mandatory 解決へ進む間に別候補へ戻ることはできない。
  // これはキュー全体の解決順を事前固定するものではない。
  // 「ただちに」(triggerPriority:"immediate") が混在する場合は、同時誘発群内で
  // 通常誘発より先に解決するため、選択候補も最高優先度の pending だけに絞る。
  // なお解決が対象選択等の入れ子 pending を開いている間は、上位の分岐がそちらを
  // 優先して本関数自体が呼ばれないため、解決中に選択をすり替えることはできない。
  const reselectableActions: SelectPendingToResolveLegalAction[] =
    options.actingPlayerId === turnPlayerId &&
    (priorityQueue.length > 1 || requiresSourceSelection) &&
    selectedPending === null
      ? priorityQueue.flatMap((pending) =>
          buildSelectPendingToResolveLegalActions(
            options,
            pending,
            turnPlayerId
          )
        )
      : [];

  if (selectedPending === null) {
    // Phase C 選択ステップ: turn player に select アクションを提示
    return options.actingPlayerId === turnPlayerId ? reselectableActions : [];
  }

  const nextActingPlayerId = selectedPending.actingPlayerId;
  // 厳密ルール: 選択された pending（または単一 pending の auto-select）のみ resolve 対象。
  const targetPendings: typeof queue = [selectedPending];

  // D-2 Phase 2 chooser: 各 sourceChoice の chooser を per-action で評価するため、
  // 入口ガードでは「呼び出し側 player が effect owner」または
  // 「呼び出し側 player が effect owner の opponent (chooser=opponent の可能性)」のいずれかを許容する。
  const ownerOpponentId = options.state.players.find(
    (p) => p.id !== nextActingPlayerId
  )?.id;
  const callerIsOwner = nextActingPlayerId === options.actingPlayerId;
  const callerIsOpponent = ownerOpponentId === options.actingPlayerId;
  if (!callerIsOwner && !callerIsOpponent) {
    return reselectableActions;
  }

  return [
    ...reselectableActions,
    ...targetPendings.flatMap<ResolvePendingTriggeredEffectLegalAction>(
      (pendingTriggeredEffect) => {
        if (pendingTriggeredEffect.actingPlayerId !== nextActingPlayerId) {
          return [];
        }

        // P3-92: mechanic 付き pending (神託/解封/創界石転醒) はカード効果 registration を
        // 持たないため、スキャンせず単一の optional resolve/skip を提示する。
        // chooser 変種は無く owner 本人のみ解決できる。
        if (pendingTriggeredEffect.mechanic) {
          if (!callerIsOwner) {
            return [];
          }
          const mechanic = pendingTriggeredEffect.mechanic;
          const {
            sourceCard: mechanicSourceCard,
            sourceDefinition: mechanicSourceDefinition,
            grant: grantCeForGoneCheck,
            canActivate,
          } = getTriggeredMechanicActivationState(
            options.state,
            mechanic,
            options.getCardDefinitionById
          );
          const mechanicSourceKind =
            mechanic.kind === "granted_effect" && mechanicSourceDefinition
              ? getEffectRegistrationSourceKindForPrintedCategory(
                  mechanicSourceDefinition.printedCategory
                )
              : ("nexus" as const);
          const mechanicSourceGone = !canActivate;
          // granted_effect: CE.metadata.grantedEffect.executionMode を尊重する。
          // SSOT は getEffectExecutionMode (legal-actions-shared) で「省略時 mandatory」。
          // 一律 optional に固めると BSDB01-R03 等の強制付与（『〜する』終止形）が任意扱い
          // になり相手がスキップできる silent gap（audit BSDB01-R03 2026-06-22）。
          let mechanicExecutionMode: "mandatory" | "optional" =
            mechanic.kind === "magic_stack_domain" ? "mandatory" : "optional";
          if (
            mechanic.kind === "oracle" &&
            mechanicSourceDefinition?.grandwalkerData?.oracleExecutionMode ===
              "mandatory"
          ) {
            mechanicExecutionMode = "mandatory";
          }
          if (mechanic.kind === "granted_effect") {
            const grantedEffect = grantCeForGoneCheck?.metadata
              ?.grantedEffect as import("../dsl-types").Effect | undefined;
            if (grantedEffect !== undefined) {
              mechanicExecutionMode = getEffectExecutionMode(grantedEffect);
            }
          }
          return [
            {
              kind: "resolve_pending_triggered_effect",
              actionId: createResolvePendingTriggeredEffectLegalActionId(
                pendingTriggeredEffect.pendingId,
                mechanicSourceCard?.instanceId,
                undefined,
                undefined
              ),
              can: true,
              reason: mechanicSourceGone
                ? `legal_resolve_pending_triggered_effect_${pendingTriggeredEffect.eventKind}_skip_only`
                : `legal_resolve_pending_triggered_effect_${pendingTriggeredEffect.eventKind}`,
              actingPlayerId: nextActingPlayerId,
              pendingId: pendingTriggeredEffect.pendingId,
              eventKind: pendingTriggeredEffect.eventKind,
              executionMode: mechanicExecutionMode,
              ...(mechanicSourceCard && mechanicSourceDefinition
                ? {
                    sourceKind: mechanicSourceKind,
                    sourceInstanceId: mechanicSourceCard.instanceId,
                    sourceDefinitionId: mechanicSourceCard.definitionId,
                    sourceCardNo: mechanicSourceDefinition.cardNo,
                  }
                : {}),
              targetMode: "none",
              requiredTargetCount: 0,
              targetEffectFilterTags: ["general"],
              candidateTargetInstanceIds: [],
              availableChosenLifeCoreKinds: [],
              requiresChosenLifeCoreKind: false,
              ...(mechanicSourceGone ? { skipOnly: true as const } : {}),
            },
          ];
        }

        const sourceChoices: TriggeredEffectSourceChoice[] =
          getTriggeredSourceChoicesForPendingSelection(
            options,
            pendingTriggeredEffect
          ).filter((sourceChoice) =>
            triggeredSourceChoiceMatchesPendingSelection(
              pendingTriggeredEffect,
              sourceChoice
            )
          );
        // 同時誘発中の未成立な観測記録は操作を要求しない。発揮資格は共通判定で再評価する。
        if (
          sourceChoices.length === 0 &&
          pendingTriggeredEffect.timingSourceRegistrations !== undefined
        )
          return [];
        // P3-91 移植: caller 非依存の理由 (usageLimit / 空撃ち禁止 / 条件未達) を除いて
        // 発揮可能な variant が 1 つでもあるか。0 なら誰もこの pending を解決できないため、
        // owner に drain 専用の skipOnly action を返す (BIE の skipOnly と同型)。
        let anyVariantGloballyAvailable = false;

        const sourceBackedActions =
          sourceChoices.flatMap<ResolvePendingTriggeredEffectLegalAction>(
            (sourceChoice) => {
              // P3-24 Phase 2: choice 変種は registration.choices に集約されている。
              // 変種ごとに 1 legal action を展開する (choices 未定義なら 1 件のみ)。
              const variants = sourceChoice.actionRegistration.choices;
              const sourceEffect =
                sourceChoice.actionRegistration.effectIndex !== undefined
                  ? sourceChoice.sourceEffectDefinition.effects?.[
                      sourceChoice.actionRegistration.effectIndex
                    ]
                  : undefined;
              const choiceIterations = getChoiceIterationsForAvailability(
                sourceEffect,
                variants
              );

              return choiceIterations.flatMap<ResolvePendingTriggeredEffectLegalAction>(
                (choiceIndex) => {
                  // 変種ごとの target / chooser メタを top-level にマージした擬似 registration
                  const variantRegistration: RegisteredTriggeredEffectAction =
                    choiceIndex !== undefined && variants
                      ? mergeTriggeredChoiceVariant(
                          sourceChoice.actionRegistration,
                          variants[choiceIndex]!
                        )
                      : sourceChoice.actionRegistration;
                  const variantTriggerEffectTiming =
                    choiceIndex !== undefined && variants
                      ? variants[choiceIndex]!.triggerEffectTiming
                      : undefined;
                  if (
                    variantTriggerEffectTiming !== undefined &&
                    pendingTriggeredEffect.effectActivationTiming !==
                      variantTriggerEffectTiming
                  ) {
                    return [];
                  }
                  if (
                    isEffectSuppressedBeforeDeclaration({
                      state: options.state,
                      sourceInstanceId: sourceChoice.sourceCard.instanceId,
                      preventionSourceInstanceId:
                        sourceChoice.sourceEffectInstanceId ??
                        sourceChoice.sourceCard.instanceId,
                      actingPlayerId: nextActingPlayerId,
                      registration: variantRegistration,
                      getCardDefinitionById: options.getCardDefinitionById,
                    })
                  ) {
                    return [];
                  }
                  const targetEvaluationSourceInstanceId =
                    sourceChoice.sourceEffectInstanceId ??
                    sourceChoice.sourceCard.instanceId;

                  // ---- caller 非依存チェック (どの呼び出し側でも結果が変わらないブロック理由) ----
                  // P3-91 移植: chooser フィルタより先に評価し、「誰も発揮できない pending」の
                  // 検出 (anyVariantGloballyAvailable) を caller に依存させない。

                  const targetGroups = buildLegalActionTargetGroups({
                    state: options.state,
                    actingPlayerId: nextActingPlayerId,
                    actionRegistration: variantRegistration,
                    ...candidateTargetOptions(
                      options,
                      targetEvaluationSourceInstanceId
                    ),
                    resolveCountBound: createCountBoundResolver(
                      options.state,
                      nextActingPlayerId,
                      targetEvaluationSourceInstanceId,
                      options.getCardDefinitionById
                    ),
                  });
                  const requiredCostSourceTribes =
                    getRequiredCostSourceTribesForCard(
                      options.state,
                      sourceChoice.sourceEffectInstanceId !== undefined
                        ? getCardById(
                            options.state,
                            sourceChoice.sourceEffectInstanceId
                          )
                        : sourceChoice.sourceCard,
                      sourceChoice.sourceEffectDefinition,
                      options.getCardDefinitionById
                    );
                  const effectiveTargetGroups =
                    capTargetGroupsByRequiredSelectedTargetsCountCost(
                      options.state,
                      nextActingPlayerId,
                      variantRegistration,
                      targetGroups,
                      requiredCostSourceTribes
                    );
                  if (effectiveTargetGroups === null) {
                    return [];
                  }
                  if (
                    effectiveTargetGroups.length > 0 &&
                    !areLegalActionTargetGroupsSatisfiable(
                      effectiveTargetGroups,
                      variantRegistration.allowDuplicateTargets === true
                    )
                  ) {
                    return [];
                  }
                  const groupedRequiredTargetCount =
                    effectiveTargetGroups.length > 0
                      ? effectiveTargetGroups.reduce(
                          (sum, group) => sum + group.requiredTargetCount,
                          0
                        )
                      : null;
                  const groupedMaxTargetCount =
                    effectiveTargetGroups.length > 0
                      ? effectiveTargetGroups.reduce(
                          (sum, group) =>
                            sum +
                            (group.maxTargetCount ?? group.requiredTargetCount),
                          0
                        )
                      : null;
                  const rawRequiredTargetCount =
                    groupedRequiredTargetCount ??
                    getResolvedRequiredTargetCount(
                      options.state,
                      nextActingPlayerId,
                      targetEvaluationSourceInstanceId,
                      variantRegistration,
                      options.getCardDefinitionById
                    );
                  const rawMaxTargetCount =
                    groupedMaxTargetCount ??
                    getResolvedMaxTargetCount(
                      options.state,
                      nextActingPlayerId,
                      targetEvaluationSourceInstanceId,
                      variantRegistration,
                      options.getCardDefinitionById
                    );
                  const costLimitedMaxTargetCount =
                    effectiveTargetGroups.length > 0
                      ? rawMaxTargetCount
                      : getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
                          options.state,
                          nextActingPlayerId,
                          variantRegistration,
                          rawMaxTargetCount,
                          requiredCostSourceTribes
                        );
                  if (costLimitedMaxTargetCount < rawRequiredTargetCount) {
                    return [];
                  }
                  const effectiveRawMaxTargetCount = Math.min(
                    rawMaxTargetCount,
                    costLimitedMaxTargetCount
                  );
                  const needsCandidates =
                    rawRequiredTargetCount > 0 ||
                    effectiveRawMaxTargetCount > 0;
                  const candidateTargetInstanceIds =
                    effectiveTargetGroups.length > 0
                      ? Array.from(
                          new Set(
                            effectiveTargetGroups.flatMap(
                              (group) => group.candidateTargetInstanceIds
                            )
                          )
                        )
                      : !needsCandidates
                        ? []
                        : getCandidateTargetInstanceIds(
                            options.state,
                            nextActingPlayerId,
                            variantRegistration,
                            candidateTargetOptions(
                              options,
                              targetEvaluationSourceInstanceId
                            )
                          );
                  const availableChosenLifeCoreKinds =
                    variantRegistration.actingPlayerLifeCoreChoice
                      ? getAvailableChosenLifeCoreKinds({
                          state: options.state,
                          actingPlayerId: nextActingPlayerId,
                          sourceInstanceId: targetEvaluationSourceInstanceId,
                          actionRegistration: variantRegistration,
                          candidateTargetInstanceIds,
                          getCardDefinitionById: options.getCardDefinitionById,
                        })
                      : [];

                  // 空撃ち対応 (03b:131): 対象不足でも「ことで」コスト以外は使用可能。
                  const emptyFire = resolveEmptyFireTargetCounts({
                    requiredTargetCount: rawRequiredTargetCount,
                    maxTargetCount: effectiveRawMaxTargetCount,
                    candidateCount:
                      variantRegistration.allowDuplicateTargets === true &&
                      candidateTargetInstanceIds.length > 0
                        ? Math.max(
                            candidateTargetInstanceIds.length,
                            rawRequiredTargetCount
                          )
                        : candidateTargetInstanceIds.length,
                    gatedByConditionalCost:
                      variantRegistration.targetGatedByConditionalCost === true,
                    requiresFullCount:
                      variantRegistration.targetRequiresFullCount === true,
                  });
                  if (emptyFire.block) {
                    return [];
                  }
                  const requiredTargetCount = emptyFire.requiredTargetCount;
                  const maxTargetCount = emptyFire.maxTargetCount;

                  if (
                    variantRegistration.actingPlayerLifeCoreChoice &&
                    availableChosenLifeCoreKinds.length === 0
                  ) {
                    return [];
                  }

                  if (
                    !canPayRequiredEffectCosts(
                      options.state,
                      nextActingPlayerId,
                      variantRegistration,
                      options.getCardDefinitionById,
                      requiredCostSourceTribes,
                      cardFilterEvaluationOptions({
                        state: options.state,
                        getCardDefinitionById: options.getCardDefinitionById,
                      }),
                      {
                        sourceInstanceId:
                          sourceChoice.sourceEffectInstanceId ??
                          sourceChoice.sourceCard.instanceId,
                        sourceDefinition: sourceChoice.sourceEffectDefinition,
                        sourceDefinitionId:
                          sourceChoice.sourceEffectDefinitionId ??
                          sourceChoice.sourceEffectDefinition.cardNo,
                        ...(variantRegistration.effectIndex !== undefined
                          ? { effectIndex: variantRegistration.effectIndex }
                          : {}),
                        ...(variantRegistration.preventionLevel !== undefined
                          ? {
                              sourcePreventionLevel:
                                variantRegistration.preventionLevel,
                            }
                          : {}),
                        ...(variantRegistration.targetLockBypass !== undefined
                          ? {
                              sourceTargetLockBypass:
                                variantRegistration.targetLockBypass,
                              sourcePreventionBypass:
                                variantRegistration.targetLockBypass,
                            }
                          : {}),
                      }
                    )
                  ) {
                    return [];
                  }

                  // 誘発でも「ことで」の対価だけは宣言できない (03c)。
                  // field/hand/magic と同じ判定を用い、独立した前段や後段の
                  // optional step を、効果全体の発揮不能へ拡大しない。
                  if (
                    isConditionalCostBlocked({
                      state: options.state,
                      actingPlayerId: nextActingPlayerId,
                      sourceCard: sourceChoice.sourceCard,
                      sourceDefinition: sourceChoice.sourceEffectDefinition,
                      sourceKind: variantRegistration.sourceKind,
                      resolutionKind: "pending_triggered_effect",
                      composition: variantRegistration.composition,
                      effect:
                        sourceChoice.sourceEffectDefinition.effects?.[
                          variantRegistration.effectIndex ?? -1
                        ],
                      effectIndex: variantRegistration.effectIndex,
                      choiceIndex,
                      effectSourceInstanceId:
                        sourceChoice.sourceEffectInstanceId,
                      effectSourceDefinition:
                        sourceChoice.sourceEffectDefinition,
                      ...resolveAvailabilitySourcePrevention({
                        state: options.state,
                        sourceInstanceId: targetEvaluationSourceInstanceId,
                        actingPlayerId: nextActingPlayerId,
                        getCardDefinitionById: options.getCardDefinitionById,
                        registrationPreventionLevel:
                          variantRegistration.preventionLevel,
                        registrationPreventionBypass:
                          variantRegistration.targetLockBypass,
                      }),
                      sourceTargetLockBypass:
                        variantRegistration.targetLockBypass,
                      effectActionKind: "triggered_effect",
                      getCardDefinitionById: options.getCardDefinitionById,
                      getRegisteredTriggeredEffectActions:
                        options.getRegisteredTriggeredEffectActions,
                      getRegisteredBurstActions:
                        options.getRegisteredBurstActions,
                      getConditionalCostCanExecuteCheck:
                        options.getConditionalCostCanExecuteCheck,
                    })
                  )
                    return [];

                  // usageLimit チェック（effect 単位で共有 — Phase 1 fix）
                  // private 宣言経由で既に消費済みの場合は再チェックしない（二重判定を回避）。
                  // 消費は declare apply 時に `recordEffectUsageIfLimited` で済んでおり、
                  // resolve apply 側も `usageLimitConsumedOnPrivateDeclaration` を見て二重消費を防ぐ。
                  if (
                    variantRegistration.usageLimit &&
                    pendingTriggeredEffect.usageLimitConsumedOnPrivateDeclaration !==
                      true &&
                    !canUseEffectByUsageLimit({
                      sourceEffect:
                        sourceChoice.sourceEffectDefinition.effects?.[
                          variantRegistration.effectIndex ?? -1
                        ],
                      state: options.state,
                      sourceInstanceId:
                        sourceChoice.sourceEffectInstanceId ??
                        sourceChoice.sourceCard.instanceId,
                      sourceDefinitionId:
                        sourceChoice.sourceEffectDefinitionId ??
                        sourceChoice.sourceEffectDefinition.cardNo,
                      getCardDefinitionById: options.getCardDefinitionById,
                      effectLabel: getStableEffectLabel(
                        variantRegistration.sourceKind,
                        sourceChoice.registrationIndex,
                        variantRegistration
                      ),
                      usageLimit: variantRegistration.usageLimit,
                      ...(variantRegistration.limitGroupId
                        ? { groupId: variantRegistration.limitGroupId }
                        : {}),
                      ...(pendingTriggeredEffect.relatedInstanceId
                        ? {
                            relatedInstanceId:
                              pendingTriggeredEffect.relatedInstanceId,
                          }
                        : {}),
                      // ENGINE-no-duplicate-per-event-scope: 〔重複不可〕は per-event scope。
                      // 同 pending 内の同名 source 排除に使う (別 pending では match しない)。
                      triggerEventScopeKey: pendingTriggeredEffect.pendingId,
                      // ENGINE-trigger-per-effect-activation-dedup: per_trigger_activation chainId キー。
                      ...(pendingTriggeredEffect.chainId
                        ? {
                            triggerActivationKey:
                              pendingTriggeredEffect.chainId,
                          }
                        : {}),
                    })
                  ) {
                    return [];
                  }

                  // 変種別 usageLimit チェック (「ターンに1回ずつ」= choice ごとに独立)。
                  // 共有制限とは別ラベル (`:choice:N` suffix) で独立に消費・封鎖される (C05)。
                  const variantOwnUsageLimit =
                    choiceIndex !== undefined && variants
                      ? variants[choiceIndex]!.usageLimit
                      : undefined;
                  if (
                    variantOwnUsageLimit &&
                    !canUseEffectByUsageLimit({
                      sourceEffect:
                        sourceChoice.sourceEffectDefinition.effects?.[
                          variantRegistration.effectIndex ?? -1
                        ],
                      state: options.state,
                      sourceInstanceId:
                        sourceChoice.sourceEffectInstanceId ??
                        sourceChoice.sourceCard.instanceId,
                      sourceDefinitionId:
                        sourceChoice.sourceEffectDefinitionId ??
                        sourceChoice.sourceEffectDefinition.cardNo,
                      getCardDefinitionById: options.getCardDefinitionById,
                      effectLabel: getChoiceVariantUsageLabel(
                        getStableEffectLabel(
                          variantRegistration.sourceKind,
                          sourceChoice.registrationIndex,
                          variantRegistration
                        ),
                        choiceIndex!
                      ),
                      usageLimit: variantOwnUsageLimit,
                      ...(pendingTriggeredEffect.relatedInstanceId
                        ? {
                            relatedInstanceId:
                              pendingTriggeredEffect.relatedInstanceId,
                          }
                        : {}),
                      triggerEventScopeKey: pendingTriggeredEffect.pendingId,
                      ...(pendingTriggeredEffect.chainId
                        ? {
                            triggerActivationKey:
                              pendingTriggeredEffect.chainId,
                          }
                        : {}),
                    })
                  ) {
                    return [];
                  }

                  // choice ステップの条件が満たされない variant はスキップ
                  if (
                    choiceIndex !== undefined &&
                    variantRegistration.effectIndex !== undefined
                  ) {
                    const choiceCondition = getChoiceStepCondition(
                      sourceChoice.sourceEffectDefinition,
                      variantRegistration.effectIndex,
                      choiceIndex
                    );
                    if (choiceCondition && choiceCondition.length > 0) {
                      const condMet = evaluateCondition(
                        options.state,
                        choiceCondition,
                        sourceChoice.sourceCard.instanceId,
                        nextActingPlayerId,
                        options.getCardDefinitionById
                      );
                      if (!condMet) {
                        return [];
                      }
                    }
                  }

                  if (variantRegistration.effectIndex !== undefined) {
                    const variantNegateActions = getNegateActionsByEffectIndex(
                      sourceChoice.sourceEffectDefinition,
                      variantRegistration.effectIndex,
                      choiceIndex
                    );
                    const sourceCardForNegate =
                      sourceChoice.sourceEffectInstanceId !== undefined
                        ? (getCardById(
                            options.state,
                            sourceChoice.sourceEffectInstanceId
                          ) ?? sourceChoice.sourceCard)
                        : sourceChoice.sourceCard;
                    if (
                      !areNegateActionsCompatibleWithRelatedStack({
                        state: options.state,
                        relatedInstanceId:
                          pendingTriggeredEffect.relatedInstanceId,
                        negateActions: variantNegateActions,
                        actingPlayerId: nextActingPlayerId,
                        sourceCard: sourceCardForNegate,
                        sourceDefinition: sourceChoice.sourceEffectDefinition,
                        getCardDefinitionById: options.getCardDefinitionById,
                      })
                    ) {
                      return [];
                    }
                  }

                  // ここまで到達した variant は (chooser を除いて) 発揮可能。
                  anyVariantGloballyAvailable = true;

                  // ---- caller 依存チェック ----
                  // D-2 Phase 2 chooser: variant の chooser を解決して prompt 相手を計算
                  const chooserMode = variantRegistration.chooser;
                  const chooserPlayerId =
                    chooserMode === "opponent" && ownerOpponentId
                      ? ownerOpponentId
                      : nextActingPlayerId;

                  // 呼び出し側 player が prompt 相手と一致しない variant はスキップ
                  if (chooserPlayerId !== options.actingPlayerId) {
                    return [];
                  }

                  const choiceLabel =
                    choiceIndex !== undefined && variants
                      ? variants[choiceIndex]!.label
                      : undefined;

                  const baseAction: ResolvePendingTriggeredEffectLegalAction = {
                    ...(callerIsOwner &&
                    getEffectExecutionMode(variantRegistration) ===
                      "mandatory" &&
                    canSkipDuplicateTriggeredSource({
                      state: options.state,
                      pendingEffect: pendingTriggeredEffect,
                      choice: sourceChoice,
                      choices: getTriggeredSourceChoicesForPendingSelection(
                        options,
                        pendingTriggeredEffect
                      ),
                      getCardDefinitionById: options.getCardDefinitionById,
                    })
                      ? { canSkipDuplicate: true as const }
                      : {}),
                    kind: "resolve_pending_triggered_effect",
                    actionId: createResolvePendingTriggeredEffectLegalActionId(
                      pendingTriggeredEffect.pendingId,
                      sourceChoice.sourceEffectInstanceId ??
                        sourceChoice.sourceCard.instanceId,
                      sourceChoice.registrationIndex,
                      choiceIndex
                    ),
                    can: true,
                    reason:
                      variantRegistration.reason ??
                      `legal_resolve_pending_triggered_effect_${pendingTriggeredEffect.eventKind}`,
                    actingPlayerId: nextActingPlayerId,
                    ...(chooserPlayerId !== nextActingPlayerId
                      ? { chooserPlayerId }
                      : {}),
                    pendingId: pendingTriggeredEffect.pendingId,
                    eventKind: pendingTriggeredEffect.eventKind,
                    executionMode:
                      pendingTriggeredEffect.declaredFromPrivateZone === true
                        ? "mandatory"
                        : getEffectExecutionMode(variantRegistration),
                    sourceKind: sourceChoice.sourceKind,
                    sourceInstanceId: sourceChoice.sourceCard.instanceId,
                    sourceDefinitionId: sourceChoice.sourceCard.definitionId,
                    ...(sourceChoice.sourceEffectDefinitionId !== undefined
                      ? {
                          sourceEffectDefinitionId:
                            sourceChoice.sourceEffectDefinitionId,
                        }
                      : {}),
                    ...(sourceChoice.sourceEffectInstanceId !== undefined
                      ? {
                          sourceEffectInstanceId:
                            sourceChoice.sourceEffectInstanceId,
                        }
                      : {}),
                    sourceCardNo: sourceChoice.sourceEffectDefinition.cardNo,
                    registrationIndex: sourceChoice.registrationIndex,
                    ...(choiceIndex !== undefined
                      ? {
                          choiceIndex,
                          ...(choiceLabel ? { choiceLabel } : {}),
                        }
                      : {}),
                    targetMode: getTargetMode(
                      requiredTargetCount,
                      maxTargetCount
                    ),
                    requiredTargetCount,
                    ...(maxTargetCount > requiredTargetCount
                      ? { maxTargetCount }
                      : {}),
                    targetEffectFilterTags:
                      getTargetEffectFilterTags(variantRegistration),
                    candidateTargetInstanceIds,
                    ...(effectiveTargetGroups.length > 0
                      ? { targetGroups: effectiveTargetGroups }
                      : {}),
                    ...(variantRegistration.targetStepId !== undefined
                      ? { targetStepId: variantRegistration.targetStepId }
                      : {}),
                    ...(variantRegistration.allowDuplicateTargets === true
                      ? { allowDuplicateTargets: true }
                      : {}),
                    ...(variantRegistration.requiredPayCostAmount !== undefined
                      ? {
                          requiredPayCostAmount:
                            variantRegistration.requiredPayCostAmount,
                        }
                      : {}),
                    ...(variantRegistration.requiredCountCostAmount !==
                    undefined
                      ? {
                          requiredCountCostAmount:
                            variantRegistration.requiredCountCostAmount,
                        }
                      : {}),
                    ...(variantRegistration.requiredCountCostPlayer !==
                    undefined
                      ? {
                          requiredCountCostPlayer:
                            variantRegistration.requiredCountCostPlayer,
                        }
                      : {}),
                    availableChosenLifeCoreKinds,
                    requiresChosenLifeCoreKind:
                      availableChosenLifeCoreKinds.length > 1,
                  };

                  // resource:"card" の scoped paid prevention は、既存互換の
                  // 宣言 variant として維持する。BSGE01-R04 型の count cost は
                  // stack 窓後・対象選択前の pendingStepChoice で扱うため、ここでは
                  // variant を増やさない。
                  const paidPreventionImmunityCost =
                    chooserPlayerId === nextActingPlayerId &&
                    variantRegistration.preventionLevel !== "unpreventable"
                      ? getPaidPreventionImmunityCost(
                          options.state,
                          sourceChoice.sourceCard.instanceId,
                          variantRegistration.effectIndex
                        )
                      : null;
                  const ownerForImmunityCost = options.state.players.find(
                    (p) => p.id === nextActingPlayerId
                  );
                  // ENGINE-paid-prevention-immunity-card-cost Step2/3: cost.resource
                  // で afford 判定を分岐する。"card" variant は cost.zone 内の
                  // cost.filter 一致カード数 (playerId 所有分) を候補として
                  // legal-actions-apply.ts が実際に除外する
                  // (BSKB01-X01「トラッシュの系統:鋼騎士カード3枚を除外」型)。候補数が
                  // amount 以上なら offer する。候補数 === amount のときは選択不要
                  // (apply が全候補を自動確定)、候補数 > amount のときは player が
                  // `paidPreventionImmunityCardCostCandidateInstanceIds` から
                  // amount 枚を選び apply に `paidPreventionImmunityCardSelection`
                  // として渡す必要がある (Step3)。
                  const paidPreventionImmunityCardCandidates =
                    paidPreventionImmunityCost !== null &&
                    paidPreventionImmunityCost.resource === "card" &&
                    ownerForImmunityCost !== undefined
                      ? getPaidPreventionImmunityCardCostCandidates(
                          options.state,
                          ownerForImmunityCost.id,
                          paidPreventionImmunityCost,
                          options.getCardDefinitionById
                        )
                      : [];
                  const canPayPreventionImmunityCost =
                    paidPreventionImmunityCost !== null &&
                    ownerForImmunityCost !== undefined &&
                    paidPreventionImmunityCost.resource === "card" &&
                    paidPreventionImmunityCardCandidates.length >=
                      paidPreventionImmunityCost.amount;

                  const variantActions = [baseAction];
                  if (canPayPreventionImmunityCost) {
                    variantActions.push({
                      ...baseAction,
                      actionId: `${baseAction.actionId}:pay-prevention-immunity`,
                      reason: `${baseAction.reason}:pay_prevention_immunity`,
                      payPreventionImmunityCost: true,
                      ...(paidPreventionImmunityCost?.resource === "card"
                        ? {
                            paidPreventionImmunityCardCostCandidateInstanceIds:
                              paidPreventionImmunityCardCandidates.map(
                                (c) => c.instanceId
                              ),
                            paidPreventionImmunityCardCostAmount:
                              paidPreventionImmunityCost.amount,
                          }
                        : {}),
                    });
                  }
                  return variantActions;
                }
              );
            }
          );

        if (sourceBackedActions.length > 0) {
          return sourceBackedActions;
        }

        // P3-91 移植: sourceChoices は存在するが全 variant が caller 非依存の理由
        // (usageLimit / 空撃ち禁止 / 条件未達) で発揮不能 → 誰もこの pending を解決できず
        // 滞留する。owner に drain 専用の skipOnly action を返す (apply は resolver を
        // 実行せず pending を除去する)。
        if (
          sourceChoices.length > 0 &&
          !anyVariantGloballyAvailable &&
          callerIsOwner
        ) {
          const skipOnlyActionsById = new Map<
            string,
            ResolvePendingTriggeredEffectLegalAction
          >();
          for (const sourceChoice of sourceChoices) {
            const sourceRegistrationInstanceId =
              sourceChoice.sourceEffectInstanceId ??
              sourceChoice.sourceCard.instanceId;
            const actionId = createResolvePendingTriggeredEffectLegalActionId(
              pendingTriggeredEffect.pendingId,
              sourceRegistrationInstanceId,
              sourceChoice.registrationIndex
            );
            skipOnlyActionsById.set(actionId, {
              kind: "resolve_pending_triggered_effect",
              actionId,
              can: true,
              reason: `legal_resolve_pending_triggered_effect_${pendingTriggeredEffect.eventKind}_skip_only`,
              actingPlayerId: nextActingPlayerId,
              pendingId: pendingTriggeredEffect.pendingId,
              eventKind: pendingTriggeredEffect.eventKind,
              executionMode: "optional",
              sourceKind: sourceChoice.sourceKind,
              sourceInstanceId: sourceChoice.sourceCard.instanceId,
              sourceDefinitionId: sourceChoice.sourceCard.definitionId,
              ...(sourceChoice.sourceEffectDefinitionId !== undefined
                ? {
                    sourceEffectDefinitionId:
                      sourceChoice.sourceEffectDefinitionId,
                  }
                : {}),
              ...(sourceChoice.sourceEffectInstanceId !== undefined
                ? {
                    sourceEffectInstanceId: sourceChoice.sourceEffectInstanceId,
                  }
                : {}),
              sourceCardNo: sourceChoice.sourceEffectDefinition.cardNo,
              registrationIndex: sourceChoice.registrationIndex,
              targetMode: "none",
              requiredTargetCount: 0,
              targetEffectFilterTags: ["general"],
              candidateTargetInstanceIds: [],
              availableChosenLifeCoreKinds: [],
              requiresChosenLifeCoreKind: false,
              skipOnly: true,
            });
          }
          return [...skipOnlyActionsById.values()];
        }

        // sourceChoices が存在したが全て chooser フィルタで除外された場合、
        // fallback action を生成してはいけない（呼び出し側 player 向けの prompt が
        // この pending effect には無い、という意味になる）。
        if (sourceChoices.length > 0) {
          return [];
        }

        // 真の fallback (registration が一切ない pending effect): chooser を考慮しない。
        // 呼び出し側が effect owner でない場合はスキップ。
        if (!callerIsOwner) {
          return [];
        }

        return [
          {
            kind: "resolve_pending_triggered_effect",
            actionId: createResolvePendingTriggeredEffectLegalActionId(
              pendingTriggeredEffect.pendingId
            ),
            can: true,
            reason: `legal_resolve_pending_triggered_effect_${pendingTriggeredEffect.eventKind}`,
            actingPlayerId: nextActingPlayerId,
            pendingId: pendingTriggeredEffect.pendingId,
            eventKind: pendingTriggeredEffect.eventKind,
            executionMode: "mandatory",
            targetMode: "none",
            requiredTargetCount: 0,
            targetEffectFilterTags: ["general"],
            candidateTargetInstanceIds: [],
            availableChosenLifeCoreKinds: [],
            requiresChosenLifeCoreKind: false,
          },
        ];
      }
    ),
  ];
}

export function getAvailablePendingBurstCheckLegalActions(
  options: GetLegalActionsOptions
): Array<
  ResolvePendingBurstCheckLegalAction | DeclinePendingBurstCheckLegalAction
> {
  const highestPendingTriggerPriority = getHighestTriggerPriority([
    ...options.state.pendingTriggeredEffects,
    ...options.state.pendingPrivateDeclarations.filter(
      (declaration) =>
        !isDeferredFlashUsePrivateDeclaration(options.state, declaration)
    ),
  ]);
  if (highestPendingTriggerPriority === "immediate") {
    return [];
  }

  const pendingActivationChecks = options.state.pendingBurstChecks.filter(
    (pendingBurstCheck) => pendingBurstCheck.activationSelected !== true
  );

  if (!hasPendingBurstActivationSelections(options.state)) {
    return [];
  }

  // Ver.17.0: 複数バースト発動時は「宣言順＝解決順」(マニュアル page12)。
  // 防御側優先は宣言順序のルール: 同一窓では「ブロック側から発動の宣言を
  // しなければいけません」(page14 FAQ で確定、04b_burst-rules.md 参照)。
  const defenseSidePlayerId = options.state.players.find(
    (p) => p.id !== options.state.activePlayerId
  )?.id;
  const hasDefenseSideBurst =
    defenseSidePlayerId !== undefined &&
    pendingActivationChecks.some(
      (bc) => bc.actingPlayerId === defenseSidePlayerId
    );
  const nextActingPlayerId = hasDefenseSideBurst
    ? defenseSidePlayerId
    : pendingActivationChecks[0]?.actingPlayerId;

  if (!nextActingPlayerId || nextActingPlayerId !== options.actingPlayerId) {
    return [];
  }

  if (isBurstActivationRestricted(options.state, nextActingPlayerId)) {
    return pendingActivationChecks.flatMap((pendingBurstCheck) => {
      if (pendingBurstCheck.actingPlayerId !== nextActingPlayerId) {
        return [];
      }
      return [
        {
          kind: "decline_pending_burst_check",
          actionId: createDeclinePendingBurstCheckLegalActionId(
            pendingBurstCheck.checkId
          ),
          can: true,
          reason: `legal_decline_pending_burst_check_${pendingBurstCheck.eventKind}`,
          actingPlayerId: nextActingPlayerId,
          checkId: pendingBurstCheck.checkId,
          eventKind: pendingBurstCheck.eventKind,
          relatedPlayerId: pendingBurstCheck.relatedPlayerId,
        } satisfies DeclinePendingBurstCheckLegalAction,
      ];
    });
  }

  return pendingActivationChecks.flatMap<
    ResolvePendingBurstCheckLegalAction | DeclinePendingBurstCheckLegalAction
  >((pendingBurstCheck) => {
    if (pendingBurstCheck.actingPlayerId !== nextActingPlayerId) {
      return [];
    }

    const sourceChoices = options.getRegisteredBurstActions
      ? getAvailableBurstSourceChoices({
          state: options.state,
          pendingBurstCheck,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
        })
      : [];
    const sourceBackedActions =
      sourceChoices.flatMap<ResolvePendingBurstCheckLegalAction>(
        (sourceChoice) => {
          const burstVariants = sourceChoice.actionRegistration.choices;
          const burstEffect =
            sourceChoice.actionRegistration.effectIndex !== undefined
              ? sourceChoice.sourceDefinition.effects?.[
                  sourceChoice.actionRegistration.effectIndex
                ]
              : undefined;
          const burstChoiceIterations = getChoiceIterationsForAvailability(
            burstEffect,
            burstVariants
          );

          return burstChoiceIterations.flatMap((burstChoiceIndex) => {
            const variantRegistration =
              burstChoiceIndex !== undefined && burstVariants
                ? mergeRegistrationChoiceVariant(
                    sourceChoice.actionRegistration,
                    burstVariants[burstChoiceIndex]!
                  )
                : sourceChoice.actionRegistration;
            const sourceCardSelfPlayRequested =
              variantRegistration.playSourceCardWithoutCostAfterResolve ===
              true;
            const sourceCardSelfUseRequested =
              variantRegistration.useSourceCardWithoutCostAfterResolve === true;
            const targetCardPlayRequested =
              variantRegistration.playTargetCardWithoutCostAfterResolve ===
              true;
            const targetCardUseRequested =
              variantRegistration.useTargetCardWithoutCostAfterResolve === true;
            const sourceCardCanSelfPlay =
              sourceChoice.sourceDefinition.printedCategory === "spirit" ||
              sourceChoice.sourceDefinition.printedCategory === "nexus";
            const sourceCardCanSelfUse = isMagicLikeCardForm(
              sourceChoice.sourceCard,
              sourceChoice.sourceDefinition
            );

            if (
              [
                sourceCardSelfPlayRequested,
                sourceCardSelfUseRequested,
                targetCardPlayRequested,
                targetCardUseRequested,
              ].filter(Boolean).length > 1
            ) {
              throw new Error(
                `Burst source cannot request multiple no-cost follow-ups at once: ${sourceChoice.sourceDefinition.cardNo}`
              );
            }

            if (sourceCardSelfPlayRequested && !sourceCardCanSelfPlay) {
              return [];
            }

            if (sourceCardSelfUseRequested && !sourceCardCanSelfUse) {
              return [];
            }

            const burstBaseLabel = getStableEffectLabel(
              "burst",
              sourceChoice.registrationIndex,
              undefined
            );
            const variantOwnUsageLimit =
              burstChoiceIndex !== undefined && burstVariants
                ? burstVariants[burstChoiceIndex]!.usageLimit
                : undefined;
            if (
              variantOwnUsageLimit &&
              !canUseEffectByUsageLimit({
                sourceEffect:
                  sourceChoice.sourceDefinition.effects?.[
                    variantRegistration.effectIndex ?? -1
                  ],
                state: options.state,
                sourceInstanceId: sourceChoice.sourceCard.instanceId,
                sourceDefinitionId: sourceChoice.sourceCard.definitionId,
                getCardDefinitionById: options.getCardDefinitionById,
                effectLabel: getChoiceVariantUsageLabel(
                  burstBaseLabel,
                  burstChoiceIndex!
                ),
                usageLimit: variantOwnUsageLimit,
              })
            ) {
              return [];
            }

            if (
              burstChoiceIndex !== undefined &&
              variantRegistration.effectIndex !== undefined
            ) {
              const choiceCondition = getChoiceStepCondition(
                sourceChoice.sourceDefinition,
                variantRegistration.effectIndex,
                burstChoiceIndex
              );
              if (choiceCondition && choiceCondition.length > 0) {
                const condMet = evaluateCondition(
                  options.state,
                  choiceCondition,
                  sourceChoice.sourceCard.instanceId,
                  nextActingPlayerId,
                  options.getCardDefinitionById
                );
                if (!condMet) {
                  return [];
                }
              }
            }

            const isBurstEffectSuppressedAtDeclaration =
              isBurstEffectNullifiedByOpponent(
                options.state,
                sourceChoice.sourceCard.instanceId,
                nextActingPlayerId,
                {
                  ignoresOpponentCannotActivateBurst:
                    getBurstIgnoresOpponentCannotActivateBurst(
                      sourceChoice.sourceDefinition,
                      variantRegistration.effectIndex,
                      variantRegistration.effectIndex === undefined
                    ),
                  getCardDefinitionById: options.getCardDefinitionById,
                }
              );
            const rawRequiredTargetCount = getResolvedRequiredTargetCount(
              options.state,
              nextActingPlayerId,
              sourceChoice.sourceCard.instanceId,
              variantRegistration,
              options.getCardDefinitionById
            );
            const rawMaxTargetCount = getResolvedMaxTargetCount(
              options.state,
              nextActingPlayerId,
              sourceChoice.sourceCard.instanceId,
              variantRegistration,
              options.getCardDefinitionById
            );
            const requiredCostSourceTribes = getRequiredCostSourceTribesForCard(
              options.state,
              sourceChoice.sourceCard,
              sourceChoice.sourceDefinition,
              options.getCardDefinitionById
            );
            const costLimitedMaxTargetCount = variantRegistration.targetGroups
              ?.length
              ? rawMaxTargetCount
              : getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
                  options.state,
                  nextActingPlayerId,
                  variantRegistration,
                  rawMaxTargetCount,
                  requiredCostSourceTribes
                );
            if (
              !isBurstEffectSuppressedAtDeclaration &&
              costLimitedMaxTargetCount < rawRequiredTargetCount
            ) {
              return [];
            }
            const requiredTargetCount = rawRequiredTargetCount;
            const maxTargetCount = isBurstEffectSuppressedAtDeclaration
              ? rawMaxTargetCount
              : Math.min(rawMaxTargetCount, costLimitedMaxTargetCount);
            const needsCandidates =
              requiredTargetCount > 0 || maxTargetCount > 0;
            const candidateTargetInstanceIdsBase = !needsCandidates
              ? []
              : getCandidateTargetInstanceIds(
                  options.state,
                  nextActingPlayerId,
                  variantRegistration,
                  candidateTargetOptions(
                    options,
                    sourceChoice.sourceCard.instanceId
                  )
                );
            const targetEnterFieldCorePlacementOptions = targetCardPlayRequested
              ? candidateTargetInstanceIdsBase.flatMap((targetInstanceId) => {
                  const playableTargetCard =
                    getPlayableTargetCardWithoutAdditionalInput({
                      state: options.state,
                      actingPlayerId: nextActingPlayerId,
                      targetInstanceId,
                      getCardDefinitionById: options.getCardDefinitionById,
                      getRegisteredHandCardEffectActions:
                        options.getRegisteredHandCardEffectActions,
                    });

                  return playableTargetCard ? [playableTargetCard] : [];
                })
              : [];
            const targetFollowUpMagicOptions = targetCardUseRequested
              ? candidateTargetInstanceIdsBase.flatMap((targetInstanceId) => {
                  const followUpMagicOption = getTargetMagicFollowUpUseOption({
                    state: options.state,
                    actingPlayerId: nextActingPlayerId,
                    targetInstanceId,
                    getCardDefinitionById: options.getCardDefinitionById,
                    getRegisteredMagicActions:
                      options.getRegisteredMagicActions,
                  });

                  return followUpMagicOption ? [followUpMagicOption] : [];
                })
              : [];
            const candidateTargetInstanceIds = targetCardPlayRequested
              ? targetEnterFieldCorePlacementOptions.map(
                  (targetOption) => targetOption.targetInstanceId
                )
              : targetCardUseRequested
                ? targetFollowUpMagicOptions.map(
                    (targetOption) => targetOption.targetInstanceId
                  )
                : candidateTargetInstanceIdsBase;
            const targetGroups = buildLegalActionTargetGroups({
              state: options.state,
              actingPlayerId: nextActingPlayerId,
              actionRegistration: variantRegistration,
              ...candidateTargetOptions(
                options,
                sourceChoice.sourceCard.instanceId
              ),
              resolveCountBound: createCountBoundResolver(
                options.state,
                nextActingPlayerId,
                sourceChoice.sourceCard.instanceId,
                options.getCardDefinitionById
              ),
            });
            const effectiveTargetGroups =
              capTargetGroupsByRequiredSelectedTargetsCountCost(
                options.state,
                nextActingPlayerId,
                variantRegistration,
                targetGroups,
                requiredCostSourceTribes
              );
            if (
              effectiveTargetGroups === null &&
              !isBurstEffectSuppressedAtDeclaration
            ) {
              return [];
            }
            if (
              (effectiveTargetGroups?.length ?? 0) > 0 &&
              !isBurstEffectSuppressedAtDeclaration &&
              !areLegalActionTargetGroupsSatisfiable(
                effectiveTargetGroups!,
                variantRegistration.allowDuplicateTargets === true
              )
            ) {
              return [];
            }
            const emptyFire = resolveEmptyFireTargetCounts({
              requiredTargetCount,
              maxTargetCount,
              candidateCount:
                variantRegistration.allowDuplicateTargets === true &&
                candidateTargetInstanceIds.length > 0
                  ? Math.max(
                      candidateTargetInstanceIds.length,
                      requiredTargetCount
                    )
                  : candidateTargetInstanceIds.length,
              gatedByConditionalCost:
                variantRegistration.targetGatedByConditionalCost === true,
              requiresFullCount:
                variantRegistration.targetRequiresFullCount === true,
            });
            if (emptyFire.block && !isBurstEffectSuppressedAtDeclaration) {
              return [];
            }
            const availableChosenLifeCoreKinds =
              variantRegistration.actingPlayerLifeCoreChoice
                ? getAvailableChosenLifeCoreKinds({
                    state: options.state,
                    actingPlayerId: nextActingPlayerId,
                    sourceInstanceId: sourceChoice.sourceCard.instanceId,
                    actionRegistration: variantRegistration,
                    candidateTargetInstanceIds,
                    getCardDefinitionById: options.getCardDefinitionById,
                  })
                : [];

            if (
              variantRegistration.actingPlayerLifeCoreChoice &&
              !isBurstEffectSuppressedAtDeclaration &&
              availableChosenLifeCoreKinds.length === 0
            ) {
              return [];
            }

            if (
              !isBurstEffectSuppressedAtDeclaration &&
              !canPayRequiredEffectCosts(
                options.state,
                nextActingPlayerId,
                variantRegistration,
                options.getCardDefinitionById,
                requiredCostSourceTribes,
                cardFilterEvaluationOptions({
                  state: options.state,
                  getCardDefinitionById: options.getCardDefinitionById,
                }),
                {
                  sourceInstanceId: sourceChoice.sourceCard.instanceId,
                  sourceDefinition: sourceChoice.sourceDefinition,
                  sourceDefinitionId: sourceChoice.sourceDefinition.cardNo,
                  ...(variantRegistration.effectIndex !== undefined
                    ? { effectIndex: variantRegistration.effectIndex }
                    : {}),
                  ...(variantRegistration.preventionLevel !== undefined
                    ? {
                        sourcePreventionLevel:
                          variantRegistration.preventionLevel,
                      }
                    : {}),
                  ...(variantRegistration.targetLockBypass !== undefined
                    ? {
                        sourceTargetLockBypass:
                          variantRegistration.targetLockBypass,
                        sourcePreventionBypass:
                          variantRegistration.targetLockBypass,
                      }
                    : {}),
                }
              )
            ) {
              return [];
            }

            const enterFieldCorePlacementPolicy = sourceCardSelfPlayRequested
              ? getEnterFieldCorePlacementPolicy({
                  card: sourceChoice.sourceCard,
                  definition: sourceChoice.sourceDefinition,
                })
              : {
                  rule: "optional" as const,
                  minimumCoreCount: 0,
                  maximumCoreCount: null,
                };
            const sharedTargetEnterFieldCorePlacementOption =
              targetEnterFieldCorePlacementOptions.length === 0
                ? null
                : targetEnterFieldCorePlacementOptions.every(
                      (targetOption) =>
                        targetOption.enterFieldCorePlacementRule ===
                          targetEnterFieldCorePlacementOptions[0]
                            ?.enterFieldCorePlacementRule &&
                        targetOption.minimumEnterFieldCoreCount ===
                          targetEnterFieldCorePlacementOptions[0]
                            ?.minimumEnterFieldCoreCount &&
                        targetOption.maximumEnterFieldCoreCount ===
                          targetEnterFieldCorePlacementOptions[0]
                            ?.maximumEnterFieldCoreCount
                    )
                  ? (targetEnterFieldCorePlacementOptions[0] ?? null)
                  : null;
            const burstChoiceLabel =
              burstChoiceIndex !== undefined && burstVariants
                ? burstVariants[burstChoiceIndex]!.label
                : undefined;

            return [
              {
                kind: "resolve_pending_burst_check",
                actionId: createResolvePendingBurstCheckLegalActionId(
                  pendingBurstCheck.checkId,
                  sourceChoice.sourceCard.instanceId,
                  sourceChoice.registrationIndex,
                  burstChoiceIndex
                ),
                can: true,
                reason:
                  variantRegistration.reason ??
                  `legal_resolve_pending_burst_check_${pendingBurstCheck.eventKind}`,
                actingPlayerId: nextActingPlayerId,
                checkId: pendingBurstCheck.checkId,
                eventKind: pendingBurstCheck.eventKind,
                relatedPlayerId: pendingBurstCheck.relatedPlayerId,
                sourceKind: sourceChoice.sourceKind,
                sourceInstanceId: sourceChoice.sourceCard.instanceId,
                sourceDefinitionId: sourceChoice.sourceCard.definitionId,
                sourceCardNo: sourceChoice.sourceDefinition.cardNo,
                registrationIndex: sourceChoice.registrationIndex,
                ...(burstChoiceIndex !== undefined
                  ? {
                      choiceIndex: burstChoiceIndex,
                      ...(burstChoiceLabel
                        ? { choiceLabel: burstChoiceLabel }
                        : {}),
                    }
                  : {}),
                // Burst targets are selected during effect resolution, after
                // activation/effect-declaration stack windows have closed.
                targetMode: "none",
                requiredTargetCount: 0,
                targetEffectFilterTags: [],
                candidateTargetInstanceIds: [],
                ...(variantRegistration.requiredPayCostAmount !== undefined
                  ? {
                      requiredPayCostAmount:
                        variantRegistration.requiredPayCostAmount,
                    }
                  : {}),
                ...(variantRegistration.requiredCountCostAmount !== undefined
                  ? {
                      requiredCountCostAmount:
                        variantRegistration.requiredCountCostAmount,
                    }
                  : {}),
                ...(variantRegistration.requiredCountCostPlayer !== undefined
                  ? {
                      requiredCountCostPlayer:
                        variantRegistration.requiredCountCostPlayer,
                    }
                  : {}),
                availableChosenLifeCoreKinds,
                requiresChosenLifeCoreKind:
                  availableChosenLifeCoreKinds.length > 1,
                playsSourceCardWithoutCostAfterResolve:
                  sourceCardSelfPlayRequested,
                usesSourceCardWithoutCostAfterResolve:
                  sourceCardSelfUseRequested,
                playsTargetCardWithoutCostAfterResolve: targetCardPlayRequested,
                usesTargetCardWithoutCostAfterResolve: targetCardUseRequested,
                enterFieldCorePlacementRule: sourceCardSelfPlayRequested
                  ? enterFieldCorePlacementPolicy.rule
                  : sharedTargetEnterFieldCorePlacementOption
                    ? sharedTargetEnterFieldCorePlacementOption.enterFieldCorePlacementRule
                    : "optional",
                minimumEnterFieldCoreCount: sourceCardSelfPlayRequested
                  ? enterFieldCorePlacementPolicy.minimumCoreCount
                  : sharedTargetEnterFieldCorePlacementOption
                    ? sharedTargetEnterFieldCorePlacementOption.minimumEnterFieldCoreCount
                    : 0,
                maximumEnterFieldCoreCount: sourceCardSelfPlayRequested
                  ? enterFieldCorePlacementPolicy.maximumCoreCount
                  : sharedTargetEnterFieldCorePlacementOption
                    ? sharedTargetEnterFieldCorePlacementOption.maximumEnterFieldCoreCount
                    : null,
                requiresEnterFieldCorePlacements: sourceCardSelfPlayRequested
                  ? enterFieldCorePlacementPolicy.minimumCoreCount > 0
                  : sharedTargetEnterFieldCorePlacementOption
                    ? sharedTargetEnterFieldCorePlacementOption.requiresEnterFieldCorePlacements
                    : false,
                targetFollowUpMagicOptions,
                targetEnterFieldCorePlacementOptions,
              },
            ];
          });
        }
      );

    if (sourceBackedActions.length > 0) {
      // P3-71: バースト発動は任意。発動可能なバーストがある場合は
      //   「発動しない」(decline) を必ず併せて提供する。
      const declineAction: DeclinePendingBurstCheckLegalAction = {
        kind: "decline_pending_burst_check",
        actionId: createDeclinePendingBurstCheckLegalActionId(
          pendingBurstCheck.checkId
        ),
        can: true,
        reason: `legal_decline_pending_burst_check_${pendingBurstCheck.eventKind}`,
        actingPlayerId: nextActingPlayerId,
        checkId: pendingBurstCheck.checkId,
        eventKind: pendingBurstCheck.eventKind,
        relatedPlayerId: pendingBurstCheck.relatedPlayerId,
      };
      return [...sourceBackedActions, declineAction];
    }

    if (sourceChoices.length > 0) {
      // Source-backed burst registrations exist, but every variant was pruned
      // by target/cost/condition checks. Do not fall through to the generic
      // no-source resolver; the legal choice is to decline this burst window.
      return [
        {
          kind: "decline_pending_burst_check",
          actionId: createDeclinePendingBurstCheckLegalActionId(
            pendingBurstCheck.checkId
          ),
          can: true,
          reason: `legal_decline_pending_burst_check_${pendingBurstCheck.eventKind}`,
          actingPlayerId: nextActingPlayerId,
          checkId: pendingBurstCheck.checkId,
          eventKind: pendingBurstCheck.eventKind,
          relatedPlayerId: pendingBurstCheck.relatedPlayerId,
        },
      ];
    }

    return [
      {
        kind: "resolve_pending_burst_check",
        actionId: createResolvePendingBurstCheckLegalActionId(
          pendingBurstCheck.checkId
        ),
        can: true,
        reason: `legal_resolve_pending_burst_check_${pendingBurstCheck.eventKind}`,
        actingPlayerId: nextActingPlayerId,
        checkId: pendingBurstCheck.checkId,
        eventKind: pendingBurstCheck.eventKind,
        relatedPlayerId: pendingBurstCheck.relatedPlayerId,
        targetMode: "none",
        requiredTargetCount: 0,
        targetEffectFilterTags: ["general"],
        candidateTargetInstanceIds: [],
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
        playsSourceCardWithoutCostAfterResolve: false,
        usesSourceCardWithoutCostAfterResolve: false,
        playsTargetCardWithoutCostAfterResolve: false,
        usesTargetCardWithoutCostAfterResolve: false,
        enterFieldCorePlacementRule: "optional",
        minimumEnterFieldCoreCount: 0,
        maximumEnterFieldCoreCount: null,
        requiresEnterFieldCorePlacements: false,
        targetFollowUpMagicOptions: [],
        targetEnterFieldCorePlacementOptions: [],
      },
    ];
  });
}

function getRegisteredFieldCardEffectTiming(
  actionTiming: RegisteredActionTiming | undefined
): RegisteredActionTiming {
  return actionTiming ?? "normal";
}

function isRegisteredFieldEffectSourceZoneAllowed(
  actionRegistration: RegisteredFieldCardEffectAction,
  sourceZone: Zone,
  isAdventSource: boolean
): boolean {
  const zone = actionRegistration.applicability?.zone;
  if (zone === undefined) return sourceZone === "field";

  const zones = Array.isArray(zone) ? zone : [zone];
  // "advent_source"（煌臨元）判定込みの SSOT は matchesApplicabilityZoneList
  // （dsl-types.ts、BSSL01-X03 導入。evaluateApplicability と同じ判定ロジックを共有）。
  return matchesApplicabilityZoneList(zones, sourceZone, isAdventSource);
}

/**
 * マジック使用元ゾーンの許可判定 (engine-magic-trash-use-permission)。
 * `applicability.zone` 未宣言の従来カードは手札/手元のみ（既定挙動を変えない）。
 * 宣言があれば `matchesApplicabilityZoneList` で判定する（"trash" を含む宣言のみ
 * トラッシュからの使用を許可。`generateMagicRegistrations` が hand/set_aside/trash
 * 以外の zone 宣言を弾いているため、ここに来る宣言は常にこの3ゾーンの組合せ）。
 */
function isRegisteredMagicSourceZoneAllowed(
  actionRegistration: RegisteredMagicAction,
  sourceZone: Zone,
  isAdventSource: boolean
): boolean {
  const zone = actionRegistration.applicability?.zone;
  if (zone === undefined)
    return sourceZone === "hand" || sourceZone === "set_aside";

  const zones = Array.isArray(zone) ? zone : [zone];
  return matchesApplicabilityZoneList(zones, sourceZone, isAdventSource);
}

/**
 * registration.applicability.zone から、そのマジック registration が実際に許可する
 * 使用元ゾーンの一覧を導出する SSOT (engine-magic-trash-use-permission、adversarial
 * verifier 指摘反映)。`isRegisteredMagicSourceZoneAllowed` と同じ既定 (未宣言 = 手札/手元)
 * を使う。availability 側 (`getAvailableMagicPaymentSources` 等) と apply 側
 * (`useMagicCardInFlashContextAsAction`) の両方がこれを通して `getMagicCardAndDefinition`
 * の `allowedSourceZones` へ渡すことで、宣言していない registration 経由でトラッシュの
 * カードが実行時にすり抜けるのを防ぐ（`generateMagicRegistrations` が hand/set_aside/trash
 * 以外の zone 宣言を弾いているため、ここで返す値は常にこの3ゾーンの組合せ）。
 */
export function getRegisteredMagicActionAllowedZones(
  actionRegistration: Pick<RegisteredMagicAction, "applicability">
): readonly Zone[] {
  const zone = actionRegistration.applicability?.zone;
  if (zone === undefined) return ["hand", "set_aside"];
  return Array.isArray(zone)
    ? (zone as readonly Zone[])
    : ([zone] as readonly Zone[]);
}

function getCurrentStackResponseTarget(state: GameState): ActiveStack | null {
  if (state.window === "stack") {
    return state.stackWindow?.pendingStackAction ?? null;
  }
  if (state.window === "pre_declaration_stack") {
    return state.preDeclarationStackWindow?.pendingStackAction ?? null;
  }
  if (
    state.window === "stack_before_block" ||
    state.window === "stack_after_block" ||
    state.window === "flash_before_block" ||
    state.window === "flash_after_block"
  ) {
    return state.activeAttack?.flashWindowState?.pendingStackAction ?? null;
  }
  return null;
}

function getNegateActionsByEffectIndex(
  definition: CardDefinition,
  effectIndex: number,
  choiceIndex?: number
): StackNegateActionLike[] {
  const effect = definition.effects?.[effectIndex];
  const actions: StackNegateActionLike[] = [];
  for (const step of effect
    ? getResolvedEffectStepsForAvailability(effect, choiceIndex)
    : []) {
    const action = step.action;
    if (action?.kind === "negate") actions.push(action);
  }
  return actions;
}

function hasNonNegateChoiceVariant(
  definition: CardDefinition,
  effectIndex: number
): boolean {
  const effect = definition.effects?.[effectIndex];
  if (!effect) return false;
  return effect.steps.some((step) =>
    (step.choice ?? []).some((choice) => choice.action.kind !== "negate")
  );
}

function areNegateActionsCompatibleWithRelatedStack(options: {
  state: GameState;
  relatedInstanceId: string | null;
  negateActions: readonly StackNegateActionLike[];
  actingPlayerId: string;
  sourceCard?: CardInstance;
  sourceDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  if (options.negateActions.length === 0) return true;
  if (options.relatedInstanceId === null) return true;
  const targetStacks = collectNegateCandidateStacksForRelatedInstance(
    options.state,
    options.relatedInstanceId
  );
  if (targetStacks.length === 0) return true;
  return options.negateActions.some((negateAction) =>
    targetStacks.some(
      (stack) =>
        stack.isNullified !== true &&
        stackMatchesNegateAction({
          state: options.state,
          stack,
          request: withInferredMagicNegateTiming(negateAction, stack),
          actingPlayerId: options.actingPlayerId,
          getCardDefinitionById: options.getCardDefinitionById,
          ...(options.sourceCard ? { sourceCard: options.sourceCard } : {}),
          sourceDefinition: options.sourceDefinition,
        })
    )
  );
}

function withInferredMagicNegateTiming(
  request: StackNegateActionLike,
  stack: ActiveStack
): StackNegateActionLike {
  if (
    request.negateTarget !== "effect" ||
    request.targetEffectTiming !== undefined ||
    stack.actionKind !== "magic"
  ) {
    return request;
  }
  const inferredTiming =
    stack.activationLabel !== undefined && stack.activationLabel !== "none"
      ? stack.activationLabel
      : stack.chosenTiming;
  return { ...request, targetEffectTiming: inferredTiming };
}

function collectNegateCandidateStacksForRelatedInstance(
  state: GameState,
  relatedInstanceId: string
): ActiveStack[] {
  const stacks = [
    ...collectPendingStacksForCardInstance(state, relatedInstanceId),
  ];
  const continuation = state.pendingTargetedDisclosureContinuation;
  if (
    continuation &&
    continuation.targetInstanceIds.includes(relatedInstanceId)
  ) {
    if (continuation.deferredStackResolution) {
      stacks.push({
        ...continuation.deferredStackResolution.deferredStack,
        targetInstanceIds: [...continuation.targetInstanceIds],
      });
    }
    if (continuation.negateIdentitySnapshot) {
      stacks.push({
        ...continuation.negateIdentitySnapshot,
        targetInstanceIds: [...continuation.targetInstanceIds],
      });
    }
  }
  return stacks;
}

/** 対象範囲だけでは空撃ちを禁止しない。ことで構文のときだけ成功対象を要求する。 */
function isRegistrationEligibleForStackResponse(options: {
  state: GameState;
  actingPlayerId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  actionRegistration: { effectIndex?: number };
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): boolean {
  const effectIndex = options.actionRegistration.effectIndex;
  if (effectIndex === undefined) return true;
  const effect = options.sourceDefinition.effects?.[effectIndex];
  if (
    !effect ||
    !getResolvedEffectStepsForAvailability(effect, undefined).some(
      (step) => step.connector === "conditional_cost"
    )
  )
    return true;
  const negateActions = getNegateActionsByEffectIndex(
    options.sourceDefinition,
    effectIndex
  );
  if (negateActions.length === 0) return true;
  const target = getCurrentStackResponseTarget(options.state);
  if (!target) return false;
  return negateActions.some((request) =>
    stackMatchesNegateAction({
      ...options,
      stack: target,
      request,
    })
  );
}

export function getAvailableFieldCardEffectLegalActions(
  options: GetAvailableFieldCardEffectLegalActionsOptions,
  timing: RegisteredActionTiming = "normal"
): FieldCardEffectLegalAction[] {
  const legalActions: FieldCardEffectLegalAction[] = [];

  const sourceCards = [
    ...getCardsByZone(options.state, "field"),
    ...getCardsByZone(options.state, "mirage"),
    ...getCardsByZone(options.state, "burst"),
  ];
  // 煌臨元 (advent_source) は runtime Zone 上 "field" のままホストの下に重なるため
  // sourceCards に含まれ得る。applicability.zone:["advent_source"] 判定用 (BSSL01-X03)。
  const adventSourceIds = collectUnderCardScopeIds(options.state).adventSource;

  for (const sourceCard of sourceCards) {
    // P3-69: フィールド上の裏向きカードは印字の能力を持たない (起動/フラッシュ効果を提供しない)。
    if (sourceCard.faceDown) {
      continue;
    }

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition) {
      continue;
    }

    const nativeSourceEntries: Array<{
      sourceEffectDefinition: CardDefinition;
      sourceEffectInstanceId: string;
      requiredSourceRole?: TextRoleUnderSourceRole;
    }> = isTextRoleUnderCard(options.state, sourceCard)
      ? []
      : [
          {
            sourceEffectDefinition: sourceDefinition,
            sourceEffectInstanceId: sourceCard.instanceId,
          },
        ];
    const sourceEntries = [...nativeSourceEntries];
    if (
      isTextRoleUnderActiveSpiritHost({
        state: options.state,
        hostCard: sourceCard,
        hostDefinition: sourceDefinition,
      })
    ) {
      for (const underId of textRoleUnderCardIdsOf(sourceCard)) {
        if (
          !isActiveTextRoleUnderEffectSource({
            state: options.state,
            hostCard: sourceCard,
            hostDefinition: sourceDefinition,
            effectSourceInstanceId: underId,
          })
        )
          continue;
        const underCard = getCardById(options.state, underId);
        if (!underCard) continue;
        if (underCard.attachedToInstanceId !== sourceCard.instanceId) continue;
        if (underCard.zone !== "field" || underCard.faceDown) continue;
        const underDefinition = options.getCardDefinitionById(
          underCard.definitionId
        );
        if (!underDefinition) continue;
        sourceEntries.push({
          sourceEffectDefinition: underDefinition,
          sourceEffectInstanceId: underCard.instanceId,
          requiredSourceRole: "text_role_under",
        });
      }
    }
    // クォーツ host 継承発揮 (ENGINE-quartz-host-identity-propagation、qa-030) の
    // activated 版 source entry。text_role_under と異なり category:"spirit" 制限は
    // 課さない (ENIGMA は brave)。continuous 版 quartzInheritedContinuousEffectEntries
    // (continuous-effect-rebuild.ts) と同型。
    if (sourceDefinition.quartzHostData?.inheritsSetQuartzEffects === true) {
      for (const setState of getQuartzSetStatesByHost(
        options.state,
        sourceCard.instanceId
      )) {
        const quartzCard = getCardById(
          options.state,
          setState.quartzInstanceId
        );
        if (!quartzCard) continue;
        if (quartzCard.zone !== "field" || quartzCard.faceDown) continue;
        const quartzDefinition = options.getCardDefinitionById(
          quartzCard.definitionId
        );
        if (!quartzDefinition) continue;
        sourceEntries.push({
          sourceEffectDefinition: quartzDefinition,
          sourceEffectInstanceId: quartzCard.instanceId,
          requiredSourceRole: "quartz_inherited",
        });
      }
    }
    const combinedBraveIds = new Set(sourceCard.attachedChildrenIds);
    for (const candidate of options.state.cardInstances) {
      if (candidate.imaginRightCombinedWith === sourceCard.instanceId) {
        combinedBraveIds.add(candidate.instanceId);
      }
    }
    for (const braveId of combinedBraveIds) {
      const braveCard = getCardById(options.state, braveId);
      if (!braveCard) continue;
      if (
        braveCard.attachedToInstanceId !== sourceCard.instanceId &&
        braveCard.imaginRightCombinedWith !== sourceCard.instanceId
      ) {
        continue;
      }
      if (braveCard.zone !== "field" || braveCard.faceDown) continue;
      const braveDefinition = options.getCardDefinitionById(
        braveCard.definitionId
      );
      if (!braveDefinition || braveDefinition.printedCategory !== "brave") {
        continue;
      }
      sourceEntries.push({
        sourceEffectDefinition: braveDefinition,
        sourceEffectInstanceId: braveCard.instanceId,
        requiredSourceRole: "combined_brave",
      });
    }

    for (const {
      sourceEffectDefinition,
      sourceEffectInstanceId,
      requiredSourceRole,
    } of sourceEntries) {
      const actionRegistrations =
        options.getRegisteredFieldCardEffectActions(
          sourceEffectDefinition.cardNo
        ) ?? [];

      for (const [index, actionRegistration] of actionRegistrations.entries()) {
        if (actionRegistration.requiredSourceRole !== requiredSourceRole) {
          continue;
        }
        if (
          !isRegisteredFieldEffectSourceZoneAllowed(
            actionRegistration,
            sourceCard.zone,
            adventSourceIds.has(sourceCard.instanceId)
          )
        ) {
          continue;
        }

        if (
          getRegisteredFieldCardEffectTiming(actionRegistration.timing) !==
          timing
        ) {
          continue;
        }

        if (
          timing === "flash" &&
          !filterRestrictedTimings(
            ["flash"],
            options.state,
            options.actingPlayerId,
            undefined,
            options.getCardDefinitionById,
            undefined,
            sourceCard.zone,
            sourceEffectInstanceId,
            actionRegistration.suppressionEffectDescriptor,
            evaluateCondition
          ).includes("flash")
        ) {
          continue;
        }

        // timingScope: フラッシュ『お互いのアタックステップ』等のステップ限定。
        // 効果オーナーは sourceCard.controllerPlayerId（actingPlayerId と一致するが
        // 明示的にカードコントローラを参照）。
        if (
          !isTimingScopeActive(
            actionRegistration.timingScope,
            options.state.step,
            options.state.activePlayerId,
            sourceCard.controllerPlayerId
          )
        ) {
          continue;
        }

        if (
          timing === "stack" &&
          !filterRestrictedTimings(
            ["stack"],
            options.state,
            options.actingPlayerId,
            getCurrentMagicActionTimingContext(options)?.stackSourceInstanceId,
            options.getCardDefinitionById,
            getCurrentMagicActionTimingContext(options)?.stackSource,
            sourceCard.zone,
            sourceEffectInstanceId,
            actionRegistration.suppressionEffectDescriptor,
            evaluateCondition
          ).includes("stack")
        ) {
          continue;
        }

        if (
          timing === "stack" &&
          !isRegistrationEligibleForStackResponse({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            sourceCard,
            sourceDefinition: sourceEffectDefinition,
            actionRegistration,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        ) {
          continue;
        }

        const fieldAffectSourceIdentity = resolveAffectSourceIdentity({
          state: options.state,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinition,
          effectSourceInstanceId: sourceEffectInstanceId,
          effectSourceDefinition: sourceEffectDefinition,
          getCardDefinitionById: options.getCardDefinitionById,
        });
        const fieldEffectSourcePreventionBypass =
          getEffectSourceTribePreventionBypass(
            options.state,
            fieldAffectSourceIdentity.instanceId,
            options.actingPlayerId,
            options.getCardDefinitionById
          );

        // P3-75: 「効果を発揮させない」は発揮前提の gate。
        // usageLimit 記録や stack 窓生成の前に legal action から除外する。
        if (
          actionRegistration.reevaluationPoints?.some((point) =>
            point.checks.includes("effect_suppression")
          ) &&
          !executeReevaluationCheck({
            state: options.state,
            checkKind: "effect_suppression",
            sourceInstanceId: sourceCard.instanceId,
            targetInstanceIds: [],
            ...(fieldEffectSourcePreventionBypass !== undefined
              ? { sourcePreventionBypass: fieldEffectSourcePreventionBypass }
              : {}),
            ...(actionRegistration.suppressionEffectDescriptor !== undefined
              ? {
                  suppressionEffectDescriptor:
                    actionRegistration.suppressionEffectDescriptor,
                }
              : {}),
            getCardDefinitionById: options.getCardDefinitionById,
          })
        ) {
          continue;
        }

        // category 両立性は物理カード (sourceCard, 例: quartz host ENIGMA=brave) ではなく
        // 効果の発揮元定義 (sourceEffectDefinition) で判定する。text_role_under は under-card が
        // 概ね spirit category で host(spirit-effective) と一致し問題化しなかったが、quartz は
        // host の category を制限しない設計 (ENIGMA=brave) のため、nexus category のクォーツ
        // 効果 (BSLH01-TR03(A)「情報」) を brave host 越しに発揮すると誤って
        // source_kind_category_mismatch で弾かれていた。
        const blockReason = getFieldEffectSourceUseBlockReason(
          options.actingPlayerId,
          actionRegistration.sourceKind,
          sourceCard,
          sourceEffectDefinition
        );

        if (blockReason !== null) {
          continue;
        }

        // restrict_manifest CE チェック（効果発揮制限）
        if (
          isCardManifestRestricted(
            options.state,
            options.actingPlayerId,
            sourceCard,
            sourceDefinition,
            options.getCardDefinitionById,
            actionRegistration.suppressionEffectDescriptor
          )
        ) {
          continue;
        }

        if (
          actionRegistration.usageLimit &&
          !canUseEffectByUsageLimit({
            sourceEffect:
              sourceEffectDefinition.effects?.[
                actionRegistration.effectIndex ?? -1
              ],
            state: options.state,
            sourceInstanceId: sourceEffectInstanceId,
            sourceDefinitionId:
              sourceEffectDefinition.cardNo !== sourceDefinition.cardNo
                ? sourceEffectDefinition.cardNo
                : sourceCard.definitionId,
            getCardDefinitionById: options.getCardDefinitionById,
            effectLabel: `${actionRegistration.sourceKind}:${index}`,
            usageLimit: actionRegistration.usageLimit,
            ...(actionRegistration.limitGroupId
              ? { groupId: actionRegistration.limitGroupId }
              : {}),
          })
        ) {
          continue;
        }

        const fieldEffect =
          actionRegistration.effectIndex !== undefined
            ? sourceEffectDefinition.effects?.[actionRegistration.effectIndex]
            : undefined;
        if (
          getBraveSelfReferenceRewriteStatus({
            state: options.state,
            sourceCard,
            sourceDefinition,
            sourceEffectDefinition,
            sourceEffectInstanceId,
            effect: fieldEffect,
            getCardDefinitionById: options.getCardDefinitionById,
          }) === "blocked"
        ) {
          continue;
        }
        const fieldAvailabilitySourcePrevention =
          resolveAvailabilitySourcePrevention({
            state: options.state,
            sourceInstanceId: fieldAffectSourceIdentity.instanceId,
            actingPlayerId: options.actingPlayerId,
            getCardDefinitionById: options.getCardDefinitionById,
            registrationPreventionLevel: actionRegistration.preventionLevel,
            registrationPreventionBypass: actionRegistration.targetLockBypass,
          });
        // applicability (例: Lv2 制限) を満たさない場合は legal action を生成しない
        const fieldEffectApplicabilitySourceInstanceId =
          requiredSourceRole === "combined_brave"
            ? sourceEffectInstanceId
            : sourceCard.instanceId;
        if (
          actionRegistration.applicability &&
          !evaluateApplicability(
            options.state,
            actionRegistration.applicability,
            fieldEffectApplicabilitySourceInstanceId,
            options.getCardDefinitionById
          )
        ) {
          continue;
        }

        // effect.condition (例: 創界神なし + デッキ ≥ 3 枚) を満たさない場合は
        // legal action を生成しない。「ことで」コストや「〜のとき」条件の
        // 事前ガード (裁定 #4: フォーオブアカインドはデッキ < 3 で発動不可)。
        const fieldEffectConditionSourceInstanceId =
          requiredSourceRole === "combined_brave"
            ? sourceEffectInstanceId
            : sourceCard.instanceId;
        const fieldEffectConditionSourceContext:
          | ConditionSourceContext
          | undefined =
          requiredSourceRole === "combined_brave"
            ? { combinedBraveHostSourceInstanceId: sourceCard.instanceId }
            : undefined;
        if (
          actionRegistration.condition &&
          actionRegistration.condition.length > 0 &&
          !evaluateCondition(
            options.state,
            actionRegistration.condition,
            fieldEffectConditionSourceInstanceId,
            options.actingPlayerId,
            options.getCardDefinitionById,
            undefined,
            fieldEffectConditionSourceContext
          )
        ) {
          continue;
        }

        const fieldVariants = actionRegistration.choices;
        const fieldChoiceIterations = getChoiceIterationsForAvailability(
          fieldEffect,
          fieldVariants
        );

        for (const fieldChoiceIndex of fieldChoiceIterations) {
          const variantRegistration: RegisteredFieldCardEffectAction =
            fieldChoiceIndex !== undefined && fieldVariants
              ? mergeRegistrationChoiceVariant(
                  actionRegistration,
                  fieldVariants[fieldChoiceIndex]!
                )
              : actionRegistration;

          if (
            isConditionalCostBlocked({
              state: options.state,
              actingPlayerId: options.actingPlayerId,
              sourceCard,
              sourceDefinition: sourceEffectDefinition,
              sourceKind: actionRegistration.sourceKind,
              resolutionKind: "field_card_effect_action",
              composition: variantRegistration.composition,
              effect: fieldEffect,
              effectIndex: variantRegistration.effectIndex,
              choiceIndex: fieldChoiceIndex,
              effectSourceInstanceId: sourceEffectInstanceId,
              effectSourceDefinition: sourceEffectDefinition,
              ...fieldAvailabilitySourcePrevention,
              sourceTargetLockBypass: variantRegistration.targetLockBypass,
              effectActionKind: "field_card_effect",
              getCardDefinitionById: options.getCardDefinitionById,
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
              getRegisteredBurstActions: options.getRegisteredBurstActions,
              getConditionalCostCanExecuteCheck:
                options.getConditionalCostCanExecuteCheck,
            })
          ) {
            continue;
          }

          if (
            !sourceHasRequiredUnderCard(
              options.state,
              sourceCard,
              variantRegistration.sourceRequiredUnderCard
            )
          ) {
            continue;
          }

          const variantOwnUsageLimit =
            fieldChoiceIndex !== undefined && fieldVariants
              ? fieldVariants[fieldChoiceIndex]!.usageLimit
              : undefined;
          if (
            variantOwnUsageLimit &&
            !canUseEffectByUsageLimit({
              sourceEffect: fieldEffect,
              state: options.state,
              sourceInstanceId: sourceEffectInstanceId,
              sourceDefinitionId:
                sourceEffectDefinition.cardNo !== sourceDefinition.cardNo
                  ? sourceEffectDefinition.cardNo
                  : sourceCard.definitionId,
              getCardDefinitionById: options.getCardDefinitionById,
              effectLabel: getChoiceVariantUsageLabel(
                "field_card_effect",
                fieldChoiceIndex!
              ),
              usageLimit: variantOwnUsageLimit,
            })
          ) {
            continue;
          }

          if (fieldChoiceIndex !== undefined) {
            const choiceCondition = getChoiceStepCondition(
              sourceEffectDefinition,
              actionRegistration.effectIndex,
              fieldChoiceIndex
            );
            if (
              choiceCondition &&
              choiceCondition.length > 0 &&
              !evaluateCondition(
                options.state,
                choiceCondition,
                fieldEffectConditionSourceInstanceId,
                options.actingPlayerId,
                options.getCardDefinitionById,
                undefined,
                fieldEffectConditionSourceContext
              )
            ) {
              continue;
            }
          }

          if (
            fieldEffect &&
            !isQueueHandTrashSwapEffectAvailable({
              state: options.state,
              actingPlayerId: options.actingPlayerId,
              sourceInstanceId: sourceCard.instanceId,
              sourceDefinition,
              effectSourceInstanceId: sourceEffectInstanceId,
              effectSourceDefinition: sourceEffectDefinition,
              effect: fieldEffect,
              choiceIndex: fieldChoiceIndex,
              actionRegistration: variantRegistration,
              getCardDefinitionById: options.getCardDefinitionById,
            })
          ) {
            continue;
          }

          const fieldCandidateTargetOptions = candidateTargetOptions(
            options,
            sourceCard.instanceId,
            {
              ...(sourceEffectDefinition.cardNo !== sourceDefinition.cardNo
                ? { sourceDefinition: sourceEffectDefinition }
                : {}),
              affectSourceIdentity: fieldAffectSourceIdentity,
            }
          );

          const targetGroups = buildLegalActionTargetGroups({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            actionRegistration: variantRegistration,
            ...fieldCandidateTargetOptions,
            resolveCountBound: createCountBoundResolver(
              options.state,
              options.actingPlayerId,
              sourceCard.instanceId,
              options.getCardDefinitionById
            ),
          });
          const requiredCostSourceTribes = getRequiredCostSourceTribesForCard(
            options.state,
            getCardById(options.state, sourceEffectInstanceId) ?? sourceCard,
            sourceEffectDefinition,
            options.getCardDefinitionById
          );
          // 対象を持たない「手札を破棄することで…」等も、宣言前に起動コストを
          // 支払えることを確認する。実行時の conditional_cost rollback だけに委ねると、
          // usageLimit が払い戻されて同じ no-op 宣言を繰り返し生成してしまう。
          if (
            !canPayRequiredEffectCosts(
              options.state,
              options.actingPlayerId,
              variantRegistration,
              options.getCardDefinitionById,
              requiredCostSourceTribes,
              cardFilterEvaluationOptions({
                state: options.state,
                getCardDefinitionById: options.getCardDefinitionById,
              }),
              {
                sourceInstanceId: sourceEffectInstanceId,
                sourceDefinition: sourceEffectDefinition,
                sourceDefinitionId: sourceEffectDefinition.cardNo,
                ...(variantRegistration.effectIndex !== undefined
                  ? { effectIndex: variantRegistration.effectIndex }
                  : {}),
                ...(variantRegistration.preventionLevel !== undefined
                  ? {
                      sourcePreventionLevel:
                        variantRegistration.preventionLevel,
                    }
                  : {}),
                ...(variantRegistration.targetLockBypass !== undefined
                  ? {
                      sourceTargetLockBypass:
                        variantRegistration.targetLockBypass,
                      sourcePreventionBypass:
                        variantRegistration.targetLockBypass,
                    }
                  : {}),
              }
            )
          ) {
            continue;
          }
          const effectiveTargetGroups =
            capTargetGroupsByRequiredSelectedTargetsCountCost(
              options.state,
              options.actingPlayerId,
              variantRegistration,
              targetGroups,
              requiredCostSourceTribes
            );
          if (effectiveTargetGroups === null) {
            continue;
          }
          if (
            effectiveTargetGroups.length > 0 &&
            !areLegalActionTargetGroupsSatisfiable(
              effectiveTargetGroups,
              variantRegistration.allowDuplicateTargets === true
            )
          ) {
            continue;
          }
          const groupedRequiredTargetCount =
            effectiveTargetGroups.length > 0
              ? effectiveTargetGroups.reduce(
                  (sum, group) => sum + group.requiredTargetCount,
                  0
                )
              : null;
          const groupedMaxTargetCount =
            effectiveTargetGroups.length > 0
              ? effectiveTargetGroups.reduce(
                  (sum, group) =>
                    sum + (group.maxTargetCount ?? group.requiredTargetCount),
                  0
                )
              : null;
          const rawRequiredTargetCount =
            groupedRequiredTargetCount ??
            getResolvedRequiredTargetCount(
              options.state,
              options.actingPlayerId,
              sourceCard.instanceId,
              variantRegistration,
              options.getCardDefinitionById
            );
          const rawMaxTargetCount =
            groupedMaxTargetCount ??
            getResolvedMaxTargetCount(
              options.state,
              options.actingPlayerId,
              sourceCard.instanceId,
              variantRegistration,
              options.getCardDefinitionById
            );
          const costLimitedMaxTargetCount =
            effectiveTargetGroups.length > 0
              ? rawMaxTargetCount
              : getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
                  options.state,
                  options.actingPlayerId,
                  variantRegistration,
                  rawMaxTargetCount,
                  requiredCostSourceTribes
                );
          if (costLimitedMaxTargetCount < rawRequiredTargetCount) {
            continue;
          }
          const effectiveRawMaxTargetCount = Math.min(
            rawMaxTargetCount,
            costLimitedMaxTargetCount
          );
          const needsCandidates =
            rawRequiredTargetCount > 0 || effectiveRawMaxTargetCount > 0;
          const candidateTargetInstanceIds =
            effectiveTargetGroups.length > 0
              ? Array.from(
                  new Set(
                    effectiveTargetGroups.flatMap(
                      (group) => group.candidateTargetInstanceIds
                    )
                  )
                )
              : !needsCandidates
                ? []
                : getCandidateTargetInstanceIds(
                    options.state,
                    options.actingPlayerId,
                    variantRegistration,
                    fieldCandidateTargetOptions
                  );
          const availableChosenLifeCoreKinds = getAvailableChosenLifeCoreKinds({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            sourceInstanceId: sourceCard.instanceId,
            actionRegistration: variantRegistration,
            candidateTargetInstanceIds,
            getCardDefinitionById: options.getCardDefinitionById,
          });

          const emptyFire = resolveEmptyFireTargetCounts({
            requiredTargetCount: rawRequiredTargetCount,
            maxTargetCount: effectiveRawMaxTargetCount,
            candidateCount:
              variantRegistration.allowDuplicateTargets === true &&
              candidateTargetInstanceIds.length > 0
                ? Math.max(
                    candidateTargetInstanceIds.length,
                    rawRequiredTargetCount
                  )
                : candidateTargetInstanceIds.length,
            gatedByConditionalCost:
              variantRegistration.targetGatedByConditionalCost === true,
            requiresFullCount:
              variantRegistration.targetRequiresFullCount === true,
          });
          if (emptyFire.block) {
            continue;
          }
          const requiredTargetCount = emptyFire.requiredTargetCount;
          const maxTargetCount = emptyFire.maxTargetCount;

          if (
            variantRegistration.actingPlayerLifeCoreChoice &&
            availableChosenLifeCoreKinds.length === 0
          ) {
            continue;
          }

          const fieldChooserPlayerId = resolveChooserPlayerId(
            options.state,
            options.actingPlayerId,
            variantRegistration.chooser
          );
          const fieldChoiceLabel =
            fieldChoiceIndex !== undefined && fieldVariants
              ? fieldVariants[fieldChoiceIndex]!.label
              : undefined;
          legalActions.push({
            kind: "use_field_card_effect",
            actionId: createFieldCardEffectLegalActionId(
              sourceEffectInstanceId !== sourceCard.instanceId
                ? `${actionRegistration.sourceKind}:effect:${sourceEffectInstanceId}`
                : actionRegistration.sourceKind,
              sourceCard.instanceId,
              index,
              fieldChoiceIndex
            ),
            registrationIndex: index,
            ...(fieldChoiceIndex !== undefined
              ? {
                  choiceIndex: fieldChoiceIndex,
                  ...(fieldChoiceLabel
                    ? { choiceLabel: fieldChoiceLabel }
                    : {}),
                }
              : {}),
            can: true,
            reason:
              actionRegistration.reason ??
              "registered_field_card_effect_action",
            actingPlayerId: options.actingPlayerId,
            ...(fieldChooserPlayerId !== options.actingPlayerId
              ? { chooserPlayerId: fieldChooserPlayerId }
              : {}),
            sourceKind: actionRegistration.sourceKind,
            timing,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            ...(sourceEffectDefinition.cardNo !== sourceDefinition.cardNo
              ? { sourceEffectDefinitionId: sourceEffectDefinition.cardNo }
              : {}),
            ...(sourceEffectInstanceId !== sourceCard.instanceId
              ? { sourceEffectInstanceId }
              : {}),
            sourceCardNo: sourceEffectDefinition.cardNo,
            targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
            requiredTargetCount,
            ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
            targetEffectFilterTags:
              getTargetEffectFilterTags(variantRegistration),
            candidateTargetInstanceIds,
            ...(effectiveTargetGroups.length > 0
              ? { targetGroups: effectiveTargetGroups }
              : {}),
            ...(variantRegistration.targetStepId !== undefined
              ? { targetStepId: variantRegistration.targetStepId }
              : {}),
            ...(variantRegistration.allowDuplicateTargets === true
              ? { allowDuplicateTargets: true }
              : {}),
            ...(variantRegistration.requiredPayCostAmount !== undefined
              ? {
                  requiredPayCostAmount:
                    variantRegistration.requiredPayCostAmount,
                }
              : {}),
            availableChosenLifeCoreKinds,
            requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
          });
        }
      }
    }
  }

  // P3-99 起動権 variant: grant_effect で付与された「起動効果」(grantedEffect.timing.kind ===
  // "activated") を被付与カード (grantee) の legal action として列挙する。registration ではなく
  // CE.metadata.grantedEffect から発揮するため、上の registration ループとは別系統。
  // 早期 return: active な granted_effect CE が無ければ何もしない (fuzz hot-path 保護)。
  for (const ce of options.state.activeContinuousEffects) {
    if (ce.modifierTag !== "granted_effect") continue;
    const granteeInstanceId = ce.targetInstanceId;
    if (!granteeInstanceId) continue;
    const grantedEffect = ce.metadata?.grantedEffect as
      | import("../dsl-types").Effect
      | undefined;
    if (!grantedEffect || grantedEffect.timing.kind !== "activated") continue;

    // 付与された起動効果の mode を field 効果の timing ("normal"/"flash"/"stack") へ写像。
    const grantedTiming: RegisteredActionTiming =
      grantedEffect.timing.mode === "main"
        ? "normal"
        : grantedEffect.timing.mode === "stack"
          ? "stack"
          : "flash";
    if (grantedTiming !== timing) continue;

    const grantee = getCardById(options.state, granteeInstanceId);
    if (!grantee || grantee.zone !== "field" || grantee.faceDown) continue;
    // 起動できるのは被付与カードの管理者 (grantPlayerRef:self の既定)。
    if (grantee.controllerPlayerId !== options.actingPlayerId) continue;

    const granteeDefinition = options.getCardDefinitionById(
      grantee.definitionId
    );
    if (!granteeDefinition) continue;

    if (
      !canActivateGrantedEffect(
        options.state,
        ce,
        grantee,
        options.getCardDefinitionById
      )
    )
      continue;

    if (
      grantedTiming === "flash" &&
      !filterRestrictedTimings(
        ["flash"],
        options.state,
        options.actingPlayerId,
        undefined,
        options.getCardDefinitionById,
        undefined,
        grantee.zone,
        undefined,
        undefined,
        evaluateCondition
      ).includes("flash")
    ) {
      continue;
    }

    if (
      grantedTiming === "stack" &&
      !filterRestrictedTimings(
        ["stack"],
        options.state,
        options.actingPlayerId,
        undefined,
        options.getCardDefinitionById,
        undefined,
        grantee.zone,
        grantee.instanceId,
        {
          sourceDefinitionId: granteeDefinition.cardNo,
          timingKind: "activated",
          activatedMode: "stack",
        },
        evaluateCondition
      ).includes("stack")
    ) {
      continue;
    }

    // 付与効果側の timingScope (例: 『自分のアタックステップ』) を尊重する。
    if (
      grantedEffect.timingScope &&
      !isTimingScopeActive(
        grantedEffect.timingScope,
        options.state.step,
        options.state.activePlayerId,
        grantee.controllerPlayerId
      )
    ) {
      continue;
    }

    // usageLimit は対象ごとの CE.effectId ではなく、付与元本文の stable identity で消費する。
    // これにより 1 回の grant が同名の複数対象へ付与した〔ターンに1回:同名〕を共有する。
    if (
      grantedEffect.usageLimit &&
      !canUseEffectByUsageLimit({
        sourceEffect: grantedEffect,
        state: options.state,
        sourceInstanceId: granteeInstanceId,
        sourceDefinitionId: grantee.definitionId,
        getCardDefinitionById: options.getCardDefinitionById,
        effectLabel: getGrantedEffectUsageLabel(ce, "activated"),
        ...(grantedEffect.limitGroupId
          ? { groupId: grantedEffect.limitGroupId }
          : {}),
        usageLimit: grantedEffect.usageLimit,
      })
    ) {
      continue;
    }

    legalActions.push({
      kind: "use_field_card_effect",
      // actionId は CE.effectId で一意化し、被付与カード自身の field 効果
      // (registrationIndex 0) と衝突しないようにする。
      actionId: createFieldCardEffectLegalActionId(
        `granted:${ce.effectId}`,
        granteeInstanceId,
        0
      ),
      registrationIndex: 0,
      can: true,
      reason: "granted_activated_effect",
      actingPlayerId: options.actingPlayerId,
      sourceKind: getEffectRegistrationSourceKindForPrintedCategory(
        granteeDefinition.printedCategory
      ),
      timing,
      ...(grantedEffect.activationLabel !== undefined
        ? { activationLabel: grantedEffect.activationLabel }
        : {}),
      sourceInstanceId: granteeInstanceId,
      sourceDefinitionId: grantee.definitionId,
      sourceCardNo: granteeDefinition.cardNo,
      targetMode: getTargetMode(0, 0),
      requiredTargetCount: 0,
      targetEffectFilterTags: ["general"],
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      grantedEffectCeId: ce.effectId,
    });
  }

  return legalActions;
}

function sourceHasRequiredUnderCard(
  state: GameState,
  sourceCard: CardInstance,
  requirement: RegisteredSourceUnderCardRequirement | undefined
): boolean {
  if (requirement === undefined) return true;
  return sourceCard.underCards.some((entry) => {
    if (entry.role !== requirement.role) return false;
    if (
      requirement.roleTag !== undefined &&
      !underCardRoleTagsEqual(entry.roleTag, requirement.roleTag)
    ) {
      return false;
    }
    const underCard = getCardById(state, entry.cardInstanceId);
    return (
      underCard?.zone === "field" &&
      underCard.attachedToInstanceId === sourceCard.instanceId
    );
  });
}

type SelfSummonDslAction = Extract<Action, { kind: "summon" | "put" }> & {
  target: { kind: "self" };
};

function isSelfSummonDslAction(action: Action): action is SelfSummonDslAction {
  return (
    (action.kind === "summon" || action.kind === "put") &&
    action.target.kind === "self"
  );
}

function resolveSelfSummonStepCostForAvailability(options: {
  state: GameState;
  actingPlayerId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  action: SelfSummonDslAction;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): number {
  const allPaymentSources = getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: options.sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId: options.sourceCard.instanceId,
    summonCause: "effect",
    useKind:
      options.sourceDefinition.printedCategory === "nexus"
        ? "place_nexus"
        : "summon",
  });
  const costFloor = getEffectiveCostFloor(
    options.sourceDefinition,
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceCard.instanceId
  );
  const freeSummonCost = (): number =>
    Math.max(0, costFloor + allPaymentSources.reduction.additionalCost);
  const overrideCost = (baseCost: number): number =>
    getAvailableCardCostPaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      card: options.sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
      sourceInstanceId: options.sourceCard.instanceId,
      baseCostOverride: baseCost,
      summonCause: "effect",
      useKind:
        options.sourceDefinition.printedCategory === "nexus"
          ? "place_nexus"
          : "summon",
    }).reduction.finalCost;
  const fixedPaymentCost = (baseCost: number): number =>
    Math.max(0, baseCost + allPaymentSources.reduction.additionalCost);
  const costModifier = options.action.costModifier;
  if (costModifier === "free") {
    return freeSummonCost();
  }
  if (costModifier === "full_reduction") {
    return calculateFullReductionSummonCost({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      definition: options.sourceDefinition,
      sourceInstanceId: options.sourceCard.instanceId,
      summonCause: "effect",
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }
  if (typeof costModifier === "object") {
    if ("override" in costModifier) {
      return overrideCost(costModifier.override);
    }
    if ("fixedPayment" in costModifier) {
      return fixedPaymentCost(costModifier.fixedPayment);
    }
  }
  return allPaymentSources.reduction.finalCost;
}

function canSatisfySelfSummonStepAvailability(options: {
  state: GameState;
  actingPlayerId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  action: SelfSummonDslAction;
  priorThisCardCoreMove: ReturnType<typeof getPriorThisCardCoreMove>;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  const zone = options.action.target.zone;
  if (
    zone !== undefined &&
    !isCardInEffectZone(
      options.state,
      options.sourceCard,
      Array.isArray(zone) ? zone : [zone],
      options.actingPlayerId,
      options.getCardDefinitionById
    )
  ) {
    return false;
  }

  if (
    isCardUseRestricted(
      options.state,
      options.actingPlayerId,
      options.sourceCard,
      options.sourceDefinition,
      options.getCardDefinitionById,
      options.sourceDefinition.printedCategory === "nexus"
        ? "place_nexus"
        : "summon"
    )
  ) {
    return false;
  }

  if (
    !(
      "ignoreSummonCondition" in options.action &&
      options.action.ignoreSummonCondition
    ) &&
    !canSummonUltimate(
      options.state,
      options.actingPlayerId,
      options.sourceDefinition,
      options.getCardDefinitionById,
      {
        sourceInstanceId: options.sourceCard.instanceId,
        evaluateCondition,
      }
    )
  ) {
    return false;
  }

  const allPaymentSources = getAvailableCardCostPaymentSources({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    card: options.sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    sourceInstanceId: options.sourceCard.instanceId,
    summonCause: "effect",
    useKind:
      options.sourceDefinition.printedCategory === "nexus"
        ? "place_nexus"
        : "summon",
  });
  const filteredCostPaymentSources =
    options.action.onBoardCoreSourceFilter !== undefined
      ? getAvailableCardCostPaymentSources({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          card: options.sourceDefinition,
          getCardDefinitionById: options.getCardDefinitionById,
          sourceInstanceId: options.sourceCard.instanceId,
          summonCause: "effect",
          useKind:
            options.sourceDefinition.printedCategory === "nexus"
              ? "place_nexus"
              : "summon",
          onBoardCoreSourceFilter: options.action.onBoardCoreSourceFilter,
        })
      : allPaymentSources;
  const allOnBoardCoreAmount = allPaymentSources.onBoardCoreSources
    .filter((source) => source.instanceId !== options.sourceCard.instanceId)
    .reduce((sum, source) => sum + source.availableCoreAmount, 0);
  const filteredOnBoardCostCoreAmount =
    filteredCostPaymentSources.onBoardCoreSources
      .filter((source) => source.instanceId !== options.sourceCard.instanceId)
      .reduce((sum, source) => sum + source.availableCoreAmount, 0);
  const priorThisCardCoreMoveAmount =
    options.priorThisCardCoreMove?.amount ?? 0;
  const normalPaymentSourceIds = new Set(
    allPaymentSources.onBoardCoreSources.map((source) => source.instanceId)
  );
  const priorMoveFrom = options.priorThisCardCoreMove?.from;
  const priorMovePlayerId =
    priorMoveFrom === undefined
      ? undefined
      : resolveLocationPlayer(
          options.actingPlayerId,
          convertCoreLocation(priorMoveFrom),
          options.state
        );
  // 界放など通常支払い元にないコアは、先行移動しても通常予算を消費しない。
  // 混在する移動元では通常予算外から払える分を先に充て、重なる分だけ予約する。
  const outsidePaymentBudgetCoreAmount =
    priorMoveFrom === undefined
      ? 0
      : options.state.cardInstances
          .filter(
            (card) =>
              card.zone === "field" &&
              card.controllerPlayerId === priorMovePlayerId &&
              card.pendingLeaveKind === null &&
              card.instanceId !== options.sourceCard.instanceId &&
              !normalPaymentSourceIds.has(card.instanceId)
          )
          .reduce(
            (sum, card) =>
              sum +
              getFieldCoreSourceTakeableCount(
                options.state,
                card,
                options.actingPlayerId,
                {
                  filter: priorMoveFrom.filter,
                  sourceInstanceId: options.sourceCard.instanceId,
                  effectSource: {
                    instance: options.sourceCard,
                    definition: options.sourceDefinition,
                  },
                  getCardDefinitionById: options.getCardDefinitionById,
                  soulCoresOnCard: Number(
                    isSoulCoreOn(options.state, card.instanceId)
                  ),
                  soulCoresMovable: Number(
                    priorMovePlayerId === options.actingPlayerId &&
                      options.priorThisCardCoreMove?.effectKind !==
                        "normal_only" &&
                      isSoulCoreOn(options.state, card.instanceId)
                  ),
                }
              ),
            0
          );
  const reservedNormalPaymentCoreAmount = Math.max(
    0,
    priorThisCardCoreMoveAmount - outsidePaymentBudgetCoreAmount
  );
  const allCoreBudget =
    allPaymentSources.reserveSource.availableCoreAmount +
    allOnBoardCoreAmount -
    reservedNormalPaymentCoreAmount;
  const costToPay = resolveSelfSummonStepCostForAvailability(options);

  const enterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy({
    card: options.sourceCard,
    definition: options.sourceDefinition,
  });
  const existingCoreCount = options.action.target.carryOverExistingCores
    ? options.sourceCard.normalCoreCount + priorThisCardCoreMoveAmount
    : 0;
  const requiredEnterFieldCores = Math.max(
    0,
    enterFieldCorePlacementPolicy.minimumCoreCount - existingCoreCount
  );
  const canUseSelfSummonCostChoice =
    options.action.costModifier === undefined &&
    (options.action.target.zone !== undefined ||
      options.sourceCard.zone === "hand" ||
      options.sourceCard.zone === "set_aside" ||
      options.sourceCard.zone === "trash");
  if (canUseSelfSummonCostChoice) {
    const costExcludeOption = getSummonCostExcludeChoiceOption(
      options.state,
      options.actingPlayerId,
      options.sourceCard,
      options.sourceDefinition,
      options.getCardDefinitionById
    );
    if (costExcludeOption !== undefined) {
      if (
        costExcludeOption.minCount > 0 &&
        costExcludeOption.candidateCardInstanceIds.length <
          costExcludeOption.minCount
      ) {
        return false;
      }
      const maxSelectableCount = Math.min(
        costExcludeOption.maxCount,
        costExcludeOption.candidateCardInstanceIds.length
      );
      const finalCost = costExcludeOption.fullCostPaid
        ? calculateFullyPaidSummonRemainingCost(
            options.state,
            options.actingPlayerId,
            options.sourceDefinition,
            options.sourceCard,
            options.getCardDefinitionById,
            "effect"
          )
        : costExcludeOption.fullReduction
          ? calculateFullReductionSummonCost({
              state: options.state,
              actingPlayerId: options.actingPlayerId,
              definition: options.sourceDefinition,
              sourceInstanceId: options.sourceCard.instanceId,
              summonCause: "effect",
              getCardDefinitionById: options.getCardDefinitionById,
            })
          : getAvailableCardCostPaymentSources({
              state: options.state,
              actingPlayerId: options.actingPlayerId,
              card: options.sourceDefinition,
              getCardDefinitionById: options.getCardDefinitionById,
              sourceInstanceId: options.sourceCard.instanceId,
              summonCause: "effect",
              useKind:
                options.sourceDefinition.printedCategory === "nexus"
                  ? "place_nexus"
                  : "summon",
              additionalCostModifiers: [
                {
                  amount:
                    -costExcludeOption.discountPerCard * maxSelectableCount,
                  reason: "summon_cost_exclude_choice",
                },
              ],
            }).reduction.finalCost;
      return allCoreBudget - finalCost >= requiredEnterFieldCores;
    }

    const costCoreMoveOption = getSummonCostCoreMoveChoiceOption(
      options.state,
      options.actingPlayerId,
      options.sourceCard,
      options.sourceDefinition,
      options.getCardDefinitionById
    );
    if (costCoreMoveOption !== undefined) {
      if (
        costCoreMoveOption.minCount > 0 &&
        costCoreMoveOption.availableCoreCount < costCoreMoveOption.minCount
      ) {
        return false;
      }
      const finalCost = costCoreMoveOption.grantsFreeSummon
        ? calculateFreeSummonCost({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            definition: options.sourceDefinition,
            sourceInstanceId: options.sourceCard.instanceId,
            getCardDefinitionById: options.getCardDefinitionById,
            summonCause: "effect",
          })
        : getAvailableCardCostPaymentSources({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            card: options.sourceDefinition,
            getCardDefinitionById: options.getCardDefinitionById,
            sourceInstanceId: options.sourceCard.instanceId,
            summonCause: "effect",
            useKind:
              options.sourceDefinition.printedCategory === "nexus"
                ? "place_nexus"
                : "summon",
            additionalCostModifiers: [
              {
                amount: -costCoreMoveOption.costOffset,
                reason: "summon_cost_core_move_choice",
              },
            ],
          }).reduction.finalCost;
      return (
        allCoreBudget + costCoreMoveOption.availableCoreCount - finalCost >=
        requiredEnterFieldCores
      );
    }
  }
  if (options.action.onBoardCoreSourceFilter === undefined) {
    return allCoreBudget - costToPay >= requiredEnterFieldCores;
  }

  const canPayFromReserve =
    filteredCostPaymentSources.reserveSource.availableCoreAmount >= costToPay &&
    allCoreBudget - costToPay >= requiredEnterFieldCores;
  if (canPayFromReserve) {
    return true;
  }

  const normalOnBoardSourceIds = new Set(
    allPaymentSources.onBoardCoreSources.map((source) => source.instanceId)
  );
  const filteredIndependentCoreAmount =
    filteredCostPaymentSources.onBoardCoreSources
      .filter((source) => source.instanceId !== options.sourceCard.instanceId)
      .filter((source) => !normalOnBoardSourceIds.has(source.instanceId))
      .reduce((sum, source) => sum + source.availableCoreAmount, 0);
  const sharedCostPaidFromNormalBudget = Math.max(
    0,
    costToPay - filteredIndependentCoreAmount
  );
  return (
    filteredOnBoardCostCoreAmount >= costToPay &&
    allCoreBudget - sharedCostPaidFromNormalBudget >= requiredEnterFieldCores
  );
}

function getPriorThisCardCoreMove(action: Action | undefined):
  | {
      amount: number;
      effectKind: Extract<Action, { kind: "core_move" }>["effectKind"];
      from: Extract<
        Extract<Action, { kind: "core_move" }>["from"],
        { kind: "field_card" }
      >;
    }
  | undefined {
  if (
    action?.kind !== "core_move" ||
    action.from.kind !== "field_card" ||
    action.to?.kind !== "this_card" ||
    typeof action.amount !== "number" ||
    action.amount <= 0
  ) {
    return undefined;
  }
  return {
    amount: action.amount,
    from: action.from,
    effectKind: action.effectKind,
  };
}

function effectSelfSummonsAreAvailable(options: {
  state: GameState;
  actingPlayerId: string;
  sourceCard: CardInstance;
  sourceDefinition: CardDefinition;
  effect: Effect | undefined;
  choiceIndex?: number;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): boolean {
  if (options.effect === undefined) return true;
  const steps = getResolvedEffectStepsForAvailability(
    options.effect,
    options.choiceIndex
  );
  for (const [stepIndex, step] of steps.entries()) {
    if (
      !isStepConditionPossibleForAvailability(
        step.stepCondition,
        options.choiceIndex
      )
    )
      continue;
    const action = step.action;
    if (!isSelfSummonDslAction(action)) continue;
    const costPreview =
      stepIndex === 1 && step.connector === "conditional_cost"
        ? previewConditionalCoreCost({
            state: options.state,
            action: steps[0]!.action,
            actingPlayerId: options.actingPlayerId,
            sourceInstanceId: options.sourceCard.instanceId,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        : undefined;
    if (costPreview?.paid === false) return false;
    if (
      !canSatisfySelfSummonStepAvailability({
        state: costPreview?.state ?? options.state,
        actingPlayerId: options.actingPlayerId,
        sourceCard: options.sourceCard,
        sourceDefinition: options.sourceDefinition,
        action,
        priorThisCardCoreMove:
          step.connector === "conditional_cost"
            ? getPriorThisCardCoreMove(steps[stepIndex - 1]?.action)
            : undefined,
        getCardDefinitionById: options.getCardDefinitionById,
      })
    ) {
      return false;
    }
  }
  return true;
}

/**
 * 手札/手元起動効果 (RegisteredHandActivatedEffectAction) を legal action として列挙する。
 * `use_field_card_effect` の手札版。timingScope（『自分のスタートステップ』等）・
 * usageLimit・condition・applicability で発動可否をガードする。
 * メインステップ限定ではない（timingScope が許可するステップで発動できる）。
 */
export function getAvailableHandActivatedEffectLegalActions(
  options: GetLegalActionsOptions,
  allowedTimings?: readonly ("main" | "flash" | "stack")[]
): HandActivatedEffectLegalAction[] {
  if (!options.getRegisteredHandActivatedEffectActions) {
    return [];
  }
  const currentAllowedTimings =
    allowedTimings ?? getCurrentMagicActionTimings(options);
  if (currentAllowedTimings.length === 0) {
    return [];
  }

  const legalActions: HandActivatedEffectLegalAction[] = [];

  // 手札起動効果のソースは手札/手元に加え、トラッシュに存在してもよい（「トラッシュにある
  // このカードは、フラッシュタイミングで…手札に戻る」BSGE01-M01〜M04 等）。実際に
  // 発動可能かは registration ごとの applicability.zone を evaluateApplicability で絞る。
  // 煌臨元/ソウル状態は runtime zone は field のままなので、ここで明示的に候補化する。
  const nativeHandActivatedSourceCards = HAND_ACTIVATED_EFFECT_ZONES.flatMap(
    (zone) => getCardsByZone(options.state, zone)
  );
  const adventSourceIds = collectUnderCardScopeIds(options.state).adventSource;
  const soulStateIds = new Set(
    options.state.players.flatMap((player) => player.soulStateInstanceIds)
  );
  const fieldCards = getCardsByZone(options.state, "field");
  const adventSourceCards = fieldCards.filter((card) =>
    adventSourceIds.has(card.instanceId)
  );
  const soulStateCards = fieldCards.filter((card) =>
    soulStateIds.has(card.instanceId)
  );
  const handActivatedSourceCards = [
    ...nativeHandActivatedSourceCards,
    ...getDeckHandCards(
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById
    ),
    ...adventSourceCards,
    ...soulStateCards,
  ];
  for (const sourceCard of handActivatedSourceCards) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
      continue;
    }
    const sourceActivationZone: EffectActivationSourceZone =
      adventSourceIds.has(sourceCard.instanceId)
        ? "advent_source"
        : soulStateIds.has(sourceCard.instanceId)
          ? "soul_state"
          : sourceCard.zone === "hand" ||
              sourceCard.zone === "set_aside" ||
              sourceCard.zone === "trash"
            ? sourceCard.zone
            : isInHandForOwnEffect(
                  options.state,
                  sourceCard,
                  options.actingPlayerId,
                  options.getCardDefinitionById
                )
              ? "hand"
              : "field";

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    if (!sourceDefinition) {
      continue;
    }

    const actionRegistrations =
      options.getRegisteredHandActivatedEffectActions(
        sourceDefinition.cardNo
      ) ?? [];

    for (const [index, actionRegistration] of actionRegistrations.entries()) {
      if (!currentAllowedTimings.includes(actionRegistration.timing)) {
        continue;
      }

      if (
        actionRegistration.timing === "flash" &&
        !filterRestrictedTimings(
          getCurrentMagicActionTimings(options),
          options.state,
          options.actingPlayerId,
          undefined,
          options.getCardDefinitionById,
          undefined,
          sourceCard.zone,
          undefined,
          undefined,
          evaluateCondition
        ).includes("flash")
      ) {
        continue;
      }

      if (
        actionRegistration.timing === "stack" &&
        !filterRestrictedTimings(
          ["stack"],
          options.state,
          options.actingPlayerId,
          undefined,
          options.getCardDefinitionById,
          undefined,
          sourceCard.zone,
          sourceCard.instanceId,
          actionRegistration.suppressionEffectDescriptor,
          evaluateCondition
        ).includes("stack")
      ) {
        continue;
      }

      // timingScope: 『自分のスタートステップ』等のステップ/プレイヤー限定。
      if (
        !isTimingScopeActive(
          actionRegistration.timingScope,
          options.state.step,
          options.state.activePlayerId,
          sourceCard.controllerPlayerId
        )
      ) {
        continue;
      }

      // usageLimit (per_card_name turn 等) を満たさなければ列挙しない。
      if (
        actionRegistration.usageLimit &&
        !canUseEffectByUsageLimit({
          sourceEffect:
            sourceDefinition.effects?.[actionRegistration.effectIndex ?? -1],
          state: options.state,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: `hand_activated:${index}`,
          usageLimit: actionRegistration.usageLimit,
          ...(actionRegistration.limitGroupId
            ? { groupId: actionRegistration.limitGroupId }
            : {}),
        })
      ) {
        continue;
      }

      // applicability (例: Lv 制限) を満たさない場合は生成しない。
      if (
        actionRegistration.applicability &&
        !evaluateApplicability(
          options.state,
          actionRegistration.applicability,
          sourceCard.instanceId,
          options.getCardDefinitionById
        )
      ) {
        continue;
      }

      // condition (例: 同名スピリットがいない = field_lacks) を満たさない場合は生成しない。
      if (
        actionRegistration.condition &&
        actionRegistration.condition.length > 0 &&
        !evaluateCondition(
          options.state,
          actionRegistration.condition,
          sourceCard.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )
      ) {
        continue;
      }

      const handVariants = actionRegistration.choices;
      const handEffect =
        actionRegistration.effectIndex !== undefined
          ? sourceDefinition.effects?.[actionRegistration.effectIndex]
          : undefined;
      const handChoiceIterations = getChoiceIterationsForAvailability(
        handEffect,
        handVariants
      );

      for (const handChoiceIndex of handChoiceIterations) {
        const variantRegistration: RegisteredHandActivatedEffectAction =
          handChoiceIndex !== undefined && handVariants
            ? mergeRegistrationChoiceVariant(
                actionRegistration,
                handVariants[handChoiceIndex]!
              )
            : actionRegistration;

        const variantOwnUsageLimit =
          handChoiceIndex !== undefined && handVariants
            ? handVariants[handChoiceIndex]!.usageLimit
            : undefined;
        if (
          variantOwnUsageLimit &&
          !canUseEffectByUsageLimit({
            sourceEffect:
              sourceDefinition.effects?.[actionRegistration.effectIndex ?? -1],
            state: options.state,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            getCardDefinitionById: options.getCardDefinitionById,
            effectLabel: getChoiceVariantUsageLabel(
              "hand_card_effect",
              handChoiceIndex!
            ),
            usageLimit: variantOwnUsageLimit,
          })
        ) {
          continue;
        }

        if (handChoiceIndex !== undefined) {
          const choiceCondition = getChoiceStepCondition(
            sourceDefinition,
            actionRegistration.effectIndex,
            handChoiceIndex
          );
          if (
            choiceCondition &&
            choiceCondition.length > 0 &&
            !evaluateCondition(
              options.state,
              choiceCondition,
              sourceCard.instanceId,
              options.actingPlayerId,
              options.getCardDefinitionById
            )
          ) {
            continue;
          }
        }

        const handEffect =
          sourceDefinition.effects?.[actionRegistration.effectIndex];
        if (
          handEffect &&
          !isQueueHandTrashSwapEffectAvailable({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinition,
            effectSourceInstanceId: sourceCard.instanceId,
            effectSourceDefinition: sourceDefinition,
            effect: handEffect,
            choiceIndex: handChoiceIndex,
            actionRegistration: variantRegistration,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        ) {
          continue;
        }

        const targetGroups = buildLegalActionTargetGroups({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          actionRegistration: variantRegistration,
          ...candidateTargetOptions(options, sourceCard.instanceId),
          resolveCountBound: createCountBoundResolver(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            options.getCardDefinitionById
          ),
        });
        const requiredCostSourceTribes = getRequiredCostSourceTribesForCard(
          options.state,
          sourceCard,
          sourceDefinition,
          options.getCardDefinitionById
        );
        const effectiveTargetGroups =
          capTargetGroupsByRequiredSelectedTargetsCountCost(
            options.state,
            options.actingPlayerId,
            variantRegistration,
            targetGroups,
            requiredCostSourceTribes
          );
        if (effectiveTargetGroups === null) {
          continue;
        }
        if (
          effectiveTargetGroups.length > 0 &&
          !areLegalActionTargetGroupsSatisfiable(
            effectiveTargetGroups,
            variantRegistration.allowDuplicateTargets === true
          )
        ) {
          continue;
        }
        const groupedRequiredTargetCount =
          effectiveTargetGroups.length > 0
            ? effectiveTargetGroups.reduce(
                (sum, group) => sum + group.requiredTargetCount,
                0
              )
            : null;
        const groupedMaxTargetCount =
          effectiveTargetGroups.length > 0
            ? effectiveTargetGroups.reduce(
                (sum, group) =>
                  sum + (group.maxTargetCount ?? group.requiredTargetCount),
                0
              )
            : null;
        const rawRequiredTargetCount =
          groupedRequiredTargetCount ??
          getResolvedRequiredTargetCount(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            variantRegistration,
            options.getCardDefinitionById
          );
        const rawMaxTargetCount =
          groupedMaxTargetCount ??
          getResolvedMaxTargetCount(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            variantRegistration,
            options.getCardDefinitionById
          );
        const costLimitedMaxTargetCount =
          effectiveTargetGroups.length > 0
            ? rawMaxTargetCount
            : getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
                options.state,
                options.actingPlayerId,
                variantRegistration,
                rawMaxTargetCount,
                requiredCostSourceTribes
              );
        if (costLimitedMaxTargetCount < rawRequiredTargetCount) {
          continue;
        }
        const effectiveRawMaxTargetCount = Math.min(
          rawMaxTargetCount,
          costLimitedMaxTargetCount
        );
        const needsCandidates =
          rawRequiredTargetCount > 0 || effectiveRawMaxTargetCount > 0;
        const candidateTargetInstanceIds =
          effectiveTargetGroups.length > 0
            ? Array.from(
                new Set(
                  effectiveTargetGroups.flatMap(
                    (group) => group.candidateTargetInstanceIds
                  )
                )
              )
            : !needsCandidates
              ? []
              : getCandidateTargetInstanceIds(
                  options.state,
                  options.actingPlayerId,
                  variantRegistration,
                  candidateTargetOptions(options, sourceCard.instanceId)
                );
        const availableChosenLifeCoreKinds = getAvailableChosenLifeCoreKinds({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: sourceCard.instanceId,
          actionRegistration: variantRegistration,
          candidateTargetInstanceIds,
          getCardDefinitionById: options.getCardDefinitionById,
        });

        const emptyFire = resolveEmptyFireTargetCounts({
          requiredTargetCount: rawRequiredTargetCount,
          maxTargetCount: effectiveRawMaxTargetCount,
          candidateCount:
            variantRegistration.allowDuplicateTargets === true &&
            candidateTargetInstanceIds.length > 0
              ? Math.max(
                  candidateTargetInstanceIds.length,
                  rawRequiredTargetCount
                )
              : candidateTargetInstanceIds.length,
          gatedByConditionalCost:
            variantRegistration.targetGatedByConditionalCost === true,
          requiresFullCount:
            variantRegistration.targetRequiresFullCount === true,
        });
        if (emptyFire.block) {
          continue;
        }
        const requiredTargetCount = emptyFire.requiredTargetCount;
        const maxTargetCount = emptyFire.maxTargetCount;

        if (
          variantRegistration.actingPlayerLifeCoreChoice &&
          availableChosenLifeCoreKinds.length === 0
        ) {
          continue;
        }

        // 「カウント-1することで手札に戻る」等の conditional_cost ゲート
        // (requiredCountCostAmount 等) を満たせなければ列挙しない。field_card/magic
        // 経路の canPayRequiredEffectCosts 呼び出しと同型 (engine-trash-zone-flash-
        // activated-recovery adversarial verifier round1 lens2 refute)。
        if (
          !canPayRequiredEffectCosts(
            options.state,
            options.actingPlayerId,
            variantRegistration,
            options.getCardDefinitionById,
            requiredCostSourceTribes,
            cardFilterEvaluationOptions({
              state: options.state,
              getCardDefinitionById: options.getCardDefinitionById,
            }),
            {
              sourceInstanceId: sourceCard.instanceId,
              sourceDefinition,
              sourceDefinitionId: sourceDefinition.cardNo,
              ...(variantRegistration.effectIndex !== undefined
                ? { effectIndex: variantRegistration.effectIndex }
                : {}),
              ...(variantRegistration.preventionLevel !== undefined
                ? {
                    sourcePreventionLevel: variantRegistration.preventionLevel,
                  }
                : {}),
              ...(variantRegistration.targetLockBypass !== undefined
                ? {
                    sourceTargetLockBypass:
                      variantRegistration.targetLockBypass,
                    sourcePreventionBypass:
                      variantRegistration.targetLockBypass,
                  }
                : {}),
            }
          )
        ) {
          continue;
        }

        if (
          isConditionalCostBlocked({
            ...options,
            sourceCard,
            sourceDefinition,
            sourceKind: sourceDefinition.printedCategory,
            resolutionKind: "field_card_effect_action",
            composition: undefined,
            effect: sourceDefinition.effects?.[variantRegistration.effectIndex],
            effectIndex: variantRegistration.effectIndex,
            choiceIndex: handChoiceIndex,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
            getConditionalCostCanExecuteCheck:
              options.getConditionalCostCanExecuteCheck,
          }) ||
          !effectSelfSummonsAreAvailable({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            sourceCard,
            sourceDefinition,
            effect: sourceDefinition.effects?.[variantRegistration.effectIndex],
            ...(handChoiceIndex !== undefined
              ? { choiceIndex: handChoiceIndex }
              : {}),
            getCardDefinitionById: options.getCardDefinitionById,
          })
        ) {
          continue;
        }

        const handChooserPlayerId = resolveChooserPlayerId(
          options.state,
          options.actingPlayerId,
          variantRegistration.chooser
        );
        const handChoiceLabel =
          handChoiceIndex !== undefined && handVariants
            ? handVariants[handChoiceIndex]!.label
            : undefined;
        legalActions.push({
          kind: "use_hand_card_effect",
          actionId: createHandActivatedEffectLegalActionId(
            sourceCard.instanceId,
            index,
            handChoiceIndex
          ),
          registrationIndex: index,
          effectIndex: actionRegistration.effectIndex,
          chosenTiming: actionRegistration.timing,
          ...(handChoiceIndex !== undefined
            ? {
                choiceIndex: handChoiceIndex,
                ...(handChoiceLabel ? { choiceLabel: handChoiceLabel } : {}),
              }
            : {}),
          ...(actionRegistration.activationLabel
            ? { activationLabel: actionRegistration.activationLabel }
            : {}),
          can: true,
          reason:
            actionRegistration.reason ??
            "registered_hand_activated_effect_action",
          actingPlayerId: options.actingPlayerId,
          ...(handChooserPlayerId !== options.actingPlayerId
            ? { chooserPlayerId: handChooserPlayerId }
            : {}),
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          sourceCardNo: sourceDefinition.cardNo,
          sourceActivationZone,
          targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
          requiredTargetCount,
          ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
          targetEffectFilterTags:
            getTargetEffectFilterTags(variantRegistration),
          candidateTargetInstanceIds,
          ...(effectiveTargetGroups.length > 0
            ? { targetGroups: effectiveTargetGroups }
            : {}),
          ...(variantRegistration.targetStepId !== undefined
            ? { targetStepId: variantRegistration.targetStepId }
            : {}),
          ...(variantRegistration.allowDuplicateTargets === true
            ? { allowDuplicateTargets: true }
            : {}),
          availableChosenLifeCoreKinds,
          requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
        });
      }
    }
  }

  return legalActions;
}

function canSatisfySummonPermissionCostAndPlacement(options: {
  state: GameState;
  actingPlayerId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  paymentSources: AvailableCardCostPaymentSourcesResult;
  finalCost: number;
  minPlacement: number;
  hasOnBoardCoreSourceFilter: boolean;
}): boolean {
  if (options.minPlacement <= 0) {
    return options.hasOnBoardCoreSourceFilter
      ? options.paymentSources.reserveSource.availableCoreAmount >=
          options.finalCost ||
          options.paymentSources.onBoardCoreSources.reduce(
            (sum, source) => sum + source.availableCoreAmount,
            0
          ) >= options.finalCost
      : options.paymentSources.totalAvailableCoreAmount >= options.finalCost;
  }

  if (!options.hasOnBoardCoreSourceFilter) {
    return (
      options.paymentSources.totalAvailableCoreAmount >=
      options.finalCost + options.minPlacement
    );
  }

  const placementOnBoardSources = getAvailableOnBoardCorePaymentSources(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  const placementSourceIds = new Set(
    placementOnBoardSources.map((source) => source.instanceId)
  );
  const costSourceIds = new Set(
    options.paymentSources.onBoardCoreSources.map((source) => source.instanceId)
  );

  const reserveAvailable =
    options.paymentSources.reserveSource.availableCoreAmount;
  const reserveOnlyCanSatisfy =
    reserveAvailable >= options.finalCost &&
    reserveAvailable -
      options.finalCost +
      placementOnBoardSources.reduce(
        (sum, source) => sum + source.availableCoreAmount,
        0
      ) >=
      options.minPlacement;
  if (reserveOnlyCanSatisfy) return true;

  const sharedOnBoard = options.paymentSources.onBoardCoreSources
    .filter((source) => placementSourceIds.has(source.instanceId))
    .reduce((sum, source) => sum + source.availableCoreAmount, 0);
  const costOnlyOnBoard = options.paymentSources.onBoardCoreSources
    .filter((source) => !placementSourceIds.has(source.instanceId))
    .reduce((sum, source) => sum + source.availableCoreAmount, 0);
  const placementOnlyOnBoard = placementOnBoardSources
    .filter((source) => !costSourceIds.has(source.instanceId))
    .reduce((sum, source) => sum + source.availableCoreAmount, 0);

  const costFromShared = Math.max(0, options.finalCost - costOnlyOnBoard);
  if (costFromShared > sharedOnBoard) return false;

  return (
    reserveAvailable + placementOnlyOnBoard + sharedOnBoard - costFromShared >=
    options.minPlacement
  );
}

/**
 * 転召の対象からは、コスト支払いに使わなかった通常コアも解決時に全て離れる。
 * 通常の「コスト + 場入りコア」の合算だけでは、その対象上のコアを二重に数えられて
 * しまうため、最終的な Lv1 配置まで完了できる対象があるかを宣言時に判定する。
 *
 * 送り先が reserve の場合は転召後に同じコアを場入り配置へ使えるため、通常の
 * affordability gate だけで足りる。現在収録済みの転召は void 送りだが、trash も
 * 配置元ではないため同じ扱いにする。
 */
function canSatisfyTenshoSummonCostAndPlacement(options: {
  state: GameState;
  actingPlayerId: string;
  definition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  paymentSources: AvailableCardCostPaymentSourcesResult;
  finalCost: number;
  minPlacement: number;
}): boolean {
  const tensho = options.definition.tenshoSummon;
  if (
    !tensho ||
    options.minPlacement <= 0 ||
    tensho.destination === "reserve"
  ) {
    return true;
  }

  return getTenshoTargetCandidates(
    options.state,
    options.actingPlayerId,
    tensho,
    options.getCardDefinitionById
  ).some((targetInstanceId) => {
    const target = options.state.cardInstances.find(
      (card) => card.instanceId === targetInstanceId
    );
    const forcedNormalCoreCount = target?.normalCoreCount ?? 0;
    const targetPaymentCapacity =
      options.paymentSources.onBoardCoreSources.find(
        (source) => source.instanceId === targetInstanceId
      )?.availableCoreAmount ?? 0;
    // 転召で失う通常コアをコストにも使えれば二重消費を避けられる。ただし、
    // 転召条件として対象に残す最低コア数と、コスト源として許可されていない分は
    // 維持コアへ回せない。
    const reusableForCost = Math.min(
      Math.max(0, forcedNormalCoreCount - tensho.minCores),
      targetPaymentCapacity,
      options.finalCost
    );
    const remainingForPlacement =
      options.paymentSources.totalAvailableCoreAmount -
      options.finalCost -
      forcedNormalCoreCount +
      reusableForCost;
    return remainingForPlacement >= options.minPlacement;
  });
}

export function getAvailableHandSummonPermissionLegalActions(
  options: GetLegalActionsOptions
): Array<SummonLegalAction | PlaceNexusLegalAction> {
  const legalActions: Array<SummonLegalAction | PlaceNexusLegalAction> = [];

  // 「手札/手元にあるこのカードは召喚/配置できる」は手札と手元(set_aside)の両方が源。
  // スピリット/アルティメット = summon 許可、ネクサス = place_nexus 許可。
  // 許可スペック検出・applicability/condition・支払い・usageLimit のゲート判定は
  // 両者で同一のため、同一パイプラインで card kind を分岐して legal-action を発行する（SSOT）。
  // トラッシュも源に含める (engine-alt-cost-summon-multizone: 「手札/トラッシュにあるこの
  // カードは…召喚できる」BSFT01-X01 型)。getHandSummonPermissionSpec が
  // applicability.zone:"trash" 未宣言のカードは弾くため、トラッシュ全走査でも
  // 該当カード以外は素通り（既存 hand/set_aside と同型のゲート構造）。
  // 煌臨元 (advent_source) も源に含める (engine-advent-source-summon-permission:
  // 「…煌臨元にあるこのカードは、召喚できる」BSSL01-X03 型)。煌臨元は runtime Zone 上
  // "field" のままホストの下に重なる (getAvailableFieldCardEffectLegalActions と同型の
  // collectUnderCardScopeIds 判定) ため、"field" 全走査ではなく adventSourceIds に
  // 絞り込んでから合流する。getHandSummonPermissionSpec が
  // applicability.zone:"advent_source" 未宣言のカードは弾く。
  // 魂状態も runtime Zone 上 "field" のまま別状態で扱われるため、soulStateInstanceIds に
  // 絞り込んで同じ召喚許可パイプラインへ合流する。
  const handCards = getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  const setAsideCards = getCardsByZone(options.state, "set_aside");
  const trashCards = getCardsByZone(options.state, "trash");
  const adventSourceIds = collectUnderCardScopeIds(options.state).adventSource;
  const adventSourceCards = getCardsByZone(options.state, "field").filter((c) =>
    adventSourceIds.has(c.instanceId)
  );
  const soulStateIds = new Set(
    options.state.players.flatMap((player) => player.soulStateInstanceIds)
  );
  const soulStateCards = getCardsByZone(options.state, "field").filter((c) =>
    soulStateIds.has(c.instanceId)
  );
  const sourceCards = [
    ...handCards,
    ...setAsideCards,
    ...trashCards,
    ...adventSourceCards,
    ...soulStateCards,
  ];

  for (const sourceCard of sourceCards) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
      continue;
    }

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    const handCardActionKind = sourceDefinition
      ? getHandCardLegalActionKind(sourceDefinition)
      : null;
    if (
      !sourceDefinition ||
      (handCardActionKind !== "summon" && handCardActionKind !== "place_nexus")
    ) {
      continue;
    }
    const isNexusPermission = handCardActionKind === "place_nexus";

    // BSAZ02-C08【月面基地】: 発揮元(このネクサス)を疲労させることを選べば召喚条件無視/
    // 軽減シンボル全充足の代替コストを得る許可 (grant_declared_summon_alt_cost CE)。
    // getDeclaredSummonAltCostGrant は getCEsForTarget 経由で C08 の timingScope
    // (period:"attack") を自動フィルタするため、対応する窓の外では常に null になり、
    // このカード以外の通常召喚許可カードの挙動には一切影響しない。
    // 注意 (adversarial verifier round3 false-positive 対応): この消費は
    // getAvailableHandCardLegalActions (main phase 通常召喚経路) には**意図的に**
    // 配線しない。canEnumerateMainHandCardActions (legal-actions-shared.ts) が
    // state.step==="main" を必須とする一方、C08 の CE は period:"attack" のときのみ
    // 有効 (isTimingScopeActive, ce-lookup.ts) なため両条件は排他的で、そちらへ配線しても
    // 到達不能コードにしかならない。実際の消費経路である本関数
    // (getAvailableHandSummonPermissionLegalActions) は main 限定ゲートを意図的に
    // 通さない設計 (呼び出し元 legal-actions.ts の該当コメント参照) で、flash window
    // 分岐からも呼ばれるため attack step 窓を正しく網羅する。
    const declaredAltCostGrant = isNexusPermission
      ? null
      : getDeclaredSummonAltCostGrant(
          options.state,
          options.actingPlayerId,
          sourceDefinition
        );
    const summonConditionSatisfied =
      isNexusPermission ||
      canSummonUltimate(
        options.state,
        options.actingPlayerId,
        sourceDefinition,
        options.getCardDefinitionById,
        {
          sourceInstanceId: sourceCard.instanceId,
          evaluateCondition,
        }
      );
    // 召喚条件 / 転召 / restrict_use / field_name_uniqueness は通常召喚と同じ
    // 宣言 gate を共有する。通常条件が不成立でも、declaredAltCostGrant が
    // 召喚条件無視を許可していれば (発揮元疲労を選ぶことを前提に) 許可 effect 列挙へ進む。
    if (
      evaluateSummonDeclarationGate({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        card: sourceCard,
        definition: sourceDefinition,
        actionKind: isNexusPermission ? "place_nexus" : "summon",
        getCardDefinitionById: options.getCardDefinitionById,
        ignoreSummonCondition:
          declaredAltCostGrant?.benefits.ignoreSummonCondition === true,
        evaluateCondition,
      }).kind !== "allowed"
    ) {
      continue;
    }

    for (const [effectIndex, effect] of (
      sourceDefinition.effects ?? []
    ).entries()) {
      let permissionSpec = getHandSummonPermissionSpec(effect);
      if (permissionSpec === undefined) {
        continue;
      }
      if (permissionSpec.requiresFullReductionCost) {
        // costModifier:"full_reduction" (「軽減シンボルすべてを満たして召喚できる」型、
        // BSTH11-X03/X04[0,1])。実額は calculateFullReductionSummonCost (SSOT、BSAZ02-C08
        // declaredAltCostGrant.fullReduction 分岐と同一関数) で算出し、以降は
        // fixedPayment 経路 (symbol 軽減を経由せずこの額をそのまま最終コストとする) に合流する。
        const { requiresFullReductionCost: _omit, ...rest } = permissionSpec;
        permissionSpec = {
          ...rest,
          fixedPayment: calculateFullReductionSummonCost({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            definition: sourceDefinition,
            sourceInstanceId: sourceCard.instanceId,
            getCardDefinitionById: options.getCardDefinitionById,
          }),
        };
      }

      if (
        effect.timing.kind === "activated" &&
        effect.timing.mode === "main" &&
        effect.timingScope === undefined &&
        !canEnumerateMainHandCardActions(options.state, options.actingPlayerId)
      ) {
        continue;
      }

      if (
        !isTimingScopeActive(
          effect.timingScope,
          options.state.step,
          options.state.activePlayerId,
          sourceCard.controllerPlayerId
        )
      ) {
        continue;
      }

      const choiceStep = effect.steps.find(
        (s) => s.choice && s.choice.length > 0
      );
      const usageLimit = (effect.usageLimit ?? choiceStep?.usageLimit) as
        | SummonLegalAction["summonPermissionUsageLimit"]
        | undefined;
      const usageLabel = getStableEffectLabel(
        "summon_permission",
        effectIndex,
        {
          effectIndex,
        }
      );

      if (
        usageLimit &&
        !canUseEffectByUsageLimit({
          sourceEffect: effect,
          state: options.state,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: usageLabel,
          usageLimit,
          ...(effect.limitGroupId ? { groupId: effect.limitGroupId } : {}),
        })
      ) {
        continue;
      }

      if (
        effect.applicability &&
        !evaluateApplicability(
          options.state,
          effect.applicability,
          sourceCard.instanceId,
          options.getCardDefinitionById
        )
      ) {
        continue;
      }

      if (
        effect.condition &&
        effect.condition.length > 0 &&
        !evaluateCondition(
          options.state,
          effect.condition,
          sourceCard.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )
      ) {
        continue;
      }

      const declarationTargeting =
        permissionSpec.declarationSteps !== undefined &&
        permissionSpec.declarationSteps.length > 0
          ? getNormalActionDeclarationTargetingMetadata(
              effect,
              permissionSpec.declarationSteps
            )
          : undefined;
      const declarationRequiredTargetCount = declarationTargeting
        ? getResolvedRequiredTargetCount(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            declarationTargeting,
            options.getCardDefinitionById
          )
        : 0;
      const declarationMaxTargetCount = declarationTargeting
        ? getResolvedMaxTargetCount(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            declarationTargeting,
            options.getCardDefinitionById
          )
        : 0;
      const declarationCandidateTargetInstanceIds = declarationTargeting
        ? getCandidateTargetInstanceIds(
            options.state,
            options.actingPlayerId,
            declarationTargeting,
            candidateTargetOptions(options, sourceCard.instanceId)
          )
        : [];
      if (
        declarationCandidateTargetInstanceIds.length <
        declarationRequiredTargetCount
      ) {
        continue;
      }

      const paymentSources = getAvailableCardCostPaymentSources({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        card: sourceDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
        sourceInstanceId: sourceCard.instanceId,
        useKind: handCardActionKind,
        ...(permissionSpec.onBoardCoreSourceFilter !== undefined
          ? {
              onBoardCoreSourceFilter: permissionSpec.onBoardCoreSourceFilter,
            }
          : {}),
        ...(permissionSpec.baseCostOverride !== null
          ? { baseCostOverride: permissionSpec.baseCostOverride }
          : {}),
      });

      // 固定支払い(fixedPayment)と通常/総コスト上書き(軽減適用)を分岐。
      const isFixedPayment = permissionSpec.fixedPayment !== null;
      const costExcludeOption =
        !isFixedPayment && permissionSpec.baseCostOverride === null
          ? getSummonCostExcludeChoiceOption(
              options.state,
              options.actingPlayerId,
              sourceCard,
              sourceDefinition,
              options.getCardDefinitionById,
              effectIndex
            )
          : undefined;
      const paidExclusionCost = costExcludeOption?.fullCostPaid
        ? calculateFullyPaidSummonRemainingCost(
            options.state,
            options.actingPlayerId,
            sourceDefinition,
            sourceCard,
            options.getCardDefinitionById
          )
        : undefined;
      const fixedPaymentFinalCost = isFixedPayment
        ? Math.max(
            permissionSpec.fixedPayment!,
            getEffectiveCostFloor(
              sourceDefinition,
              options.state,
              options.actingPlayerId,
              options.getCardDefinitionById,
              sourceCard.instanceId
            )
          )
        : null;
      const reducedCost =
        paidExclusionCost !== undefined
          ? 0
          : isFixedPayment
            ? fixedPaymentFinalCost!
            : paymentSources.reduction.reducedCost;
      const additionalCost =
        paidExclusionCost ??
        (isFixedPayment ? 0 : paymentSources.reduction.additionalCost);
      const finalCost =
        paidExclusionCost ??
        (isFixedPayment
          ? fixedPaymentFinalCost!
          : paymentSources.reduction.finalCost);
      const totalReduction = isFixedPayment
        ? Math.max(0, sourceDefinition.cost - fixedPaymentFinalCost!)
        : paymentSources.reduction.totalReduction;

      const enterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy({
        card: sourceCard,
        definition: sourceDefinition,
      });
      const minPlacement = enterFieldCorePlacementPolicy.minimumCoreCount;
      const hasOnBoardCoreSourceFilter =
        permissionSpec.onBoardCoreSourceFilter !== undefined;

      if (isFixedPayment || paidExclusionCost !== undefined) {
        if (
          !canSatisfySummonPermissionCostAndPlacement({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            getCardDefinitionById: options.getCardDefinitionById,
            paymentSources,
            finalCost,
            minPlacement,
            hasOnBoardCoreSourceFilter,
          })
        ) {
          continue;
        }
      } else {
        if (!paymentSources.canFullyPay) {
          continue;
        }
        if (
          minPlacement > 0 &&
          !canSatisfySummonPermissionCostAndPlacement({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            getCardDefinitionById: options.getCardDefinitionById,
            paymentSources,
            finalCost,
            minPlacement,
            hasOnBoardCoreSourceFilter,
          })
        ) {
          continue;
        }
      }

      const permissionCommon = {
        can: true as const,
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceCard.definitionId,
        sourceCardNo: sourceDefinition.cardNo,
        targetMode: getTargetMode(
          declarationRequiredTargetCount,
          declarationMaxTargetCount
        ),
        requiredTargetCount: declarationRequiredTargetCount,
        ...(declarationMaxTargetCount > declarationRequiredTargetCount
          ? { maxTargetCount: declarationMaxTargetCount }
          : {}),
        targetEffectFilterTags: declarationTargeting
          ? getTargetEffectFilterTags(declarationTargeting)
          : (["general"] as const),
        candidateTargetInstanceIds: declarationCandidateTargetInstanceIds,
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
        reducedCost,
        additionalCost,
        finalCost,
        totalReduction,
        availableReserveCoreAmount:
          paymentSources.reserveSource.availableCoreAmount,
        availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
        availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
        enterFieldCorePlacementRule: enterFieldCorePlacementPolicy.rule,
        maximumEnterFieldCoreCount:
          enterFieldCorePlacementPolicy.maximumCoreCount,
        minimumEnterFieldCoreCount:
          enterFieldCorePlacementPolicy.minimumCoreCount,
        requiresEnterFieldCorePlacements:
          enterFieldCorePlacementPolicy.minimumCoreCount > 0,
      };

      if (isNexusPermission) {
        // ネクサスの自己配置許可（「手札/手元にあるこのネクサスは配置できる」）。
        // BSES01-C03 迎撃砲 [0,1]。place_nexus 解決経路（legal-actions-apply）へ流す。
        legalActions.push({
          kind: "place_nexus",
          actionId: `legal:place-nexus-permission:${sourceCard.instanceId}:${effectIndex}`,
          reason: "legal_place_nexus_by_hand_permission",
          ...permissionCommon,
          ...(isFixedPayment ? { fixedPaymentCost: finalCost } : {}),
          ...(permissionSpec.baseCostOverride !== null
            ? { baseCostOverride: permissionSpec.baseCostOverride }
            : {}),
          placePermissionEffectIndex: effectIndex,
          ...(usageLimit ? { placePermissionUsageLimit: usageLimit } : {}),
          ...(effect.limitGroupId
            ? { placePermissionLimitGroupId: effect.limitGroupId }
            : {}),
        });
      } else if (summonConditionSatisfied) {
        // declaredAltCostGrant が召喚条件無視で通しているだけ (summonConditionSatisfied
        // が false) のときは、下記の通常コスト経路 (costExclude/costCoreMove/plain) を
        // 一切出さない。発揮元を疲労させる代替コスト (このブロックの外、後述の
        // declaredAltCostGrant 専用 push) のみが唯一の召喚手段になる。
        //
        // 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』(BSTH02.7-X02 effects[1] 等)。
        // 自己召喚許可 (このブロック) とは別 effect の継続 cost_modify+useCostPayment.exclude
        // を getSummonCostExcludeChoiceOption で検出し、通常の summon-permission action の
        // 代わりに opensCostExcludeChoice 版を返す (BSTH02.7-M01 effects[0] と同一 primitive、
        // 固定支払い/コスト上書きのときは対象外)。

        // 必須除外 (minCount>0) かつ候補0件 = 「除外できないのでこの方法では召喚できない」
        // (engine-alt-cost-summon-multizone)。通常コストへのフォールバックを許さず、
        // この許可 effect の legal action 自体を出さない。
        if (
          costExcludeOption &&
          costExcludeOption.minCount > 0 &&
          costExcludeOption.candidateCardInstanceIds.length === 0
        ) {
          continue;
        }
        // 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを
        // 支払わずに召喚する』(BSSL01-M02 effects[0,1])。exclude と同じ「別 effect の
        // 継続 cost_modify を検出し、通常の summon-permission action の代わりに
        // opensCostCoreMoveChoice 版を返す」パターン。両 kind は排他 (同一許可効果に
        // 同時付与されるカードは現状無い)。
        const costCoreMoveOption =
          !isFixedPayment &&
          permissionSpec.baseCostOverride === null &&
          !costExcludeOption
            ? getSummonCostCoreMoveChoiceOption(
                options.state,
                options.actingPlayerId,
                sourceCard,
                sourceDefinition,
                options.getCardDefinitionById
              )
            : undefined;
        // 必須移動 (minCount>0、常にそうなる想定) かつ移動可能コア不足 = 「支払えないので
        // この方法では召喚できない」。通常コストへのフォールバックは許さない
        // (exclude の候補0件ガードと同じ規律)。
        if (
          costCoreMoveOption &&
          costCoreMoveOption.minCount > 0 &&
          costCoreMoveOption.availableCoreCount < costCoreMoveOption.minCount
        ) {
          continue;
        }
        if (costCoreMoveOption) {
          legalActions.push({
            kind: "summon",
            actionId: `legal:summon-permission:${sourceCard.instanceId}:${effectIndex}:cost-core-move-choice`,
            reason: "legal_summon_by_hand_permission",
            ...permissionCommon,
            minimumRequiredCores:
              getMinimumRequiredCoresFromDefinition(sourceDefinition),
            summonPermissionEffectIndex: effectIndex,
            ...(usageLimit ? { summonPermissionUsageLimit: usageLimit } : {}),
            ...(effect.limitGroupId
              ? { summonPermissionLimitGroupId: effect.limitGroupId }
              : {}),
            opensCostCoreMoveChoice: true,
            costCoreMoveEffectIndex: costCoreMoveOption.effectIndex,
            costCoreMoveMinCount: costCoreMoveOption.minCount,
            costCoreMoveAvailableCoreCount:
              costCoreMoveOption.availableCoreCount,
            costCoreMoveOffset: costCoreMoveOption.costOffset,
            ...(costCoreMoveOption.grantsFreeSummon
              ? { costCoreMoveGrantsFreeSummon: true }
              : {}),
            costCoreMoveFieldDestinationCandidateInstanceIds:
              costCoreMoveOption.fieldDestinationCandidateInstanceIds,
            ...(permissionSpec.onBoardCoreSourceFilter !== undefined
              ? {
                  onBoardCoreSourceFilter:
                    permissionSpec.onBoardCoreSourceFilter,
                }
              : {}),
          });
        } else if (costExcludeOption) {
          legalActions.push({
            kind: "summon",
            actionId: `legal:summon-permission:${sourceCard.instanceId}:${effectIndex}:cost-exclude-choice`,
            reason: "legal_summon_by_hand_permission",
            ...permissionCommon,
            minimumRequiredCores:
              getMinimumRequiredCoresFromDefinition(sourceDefinition),
            summonPermissionEffectIndex: effectIndex,
            ...(usageLimit ? { summonPermissionUsageLimit: usageLimit } : {}),
            ...(effect.limitGroupId
              ? { summonPermissionLimitGroupId: effect.limitGroupId }
              : {}),
            opensCostExcludeChoice: true,
            costExcludeEffectIndex: costExcludeOption.effectIndex,
            costExcludeMaxCount: costExcludeOption.maxCount,
            costExcludeDiscountPerCard: costExcludeOption.discountPerCard,
            ...(costExcludeOption.fullCostPaid
              ? { costExcludeFullCostPaid: true }
              : {}),
            costExcludeCandidateInstanceIds:
              costExcludeOption.candidateCardInstanceIds,
            costExcludeSourceZone: costExcludeOption.sourceZone,
            costExcludeMinCount: costExcludeOption.minCount,
            ...(costExcludeOption.fullReduction
              ? { costExcludeFullReduction: true }
              : {}),
            ...(permissionSpec.onBoardCoreSourceFilter !== undefined
              ? {
                  onBoardCoreSourceFilter:
                    permissionSpec.onBoardCoreSourceFilter,
                }
              : {}),
          });
        } else {
          legalActions.push({
            kind: "summon",
            actionId: `legal:summon-permission:${sourceCard.instanceId}:${effectIndex}`,
            reason: "legal_summon_by_hand_permission",
            ...permissionCommon,
            minimumRequiredCores:
              getMinimumRequiredCoresFromDefinition(sourceDefinition),
            ...(isFixedPayment ? { fixedPaymentCost: finalCost } : {}),
            ...(permissionSpec.baseCostOverride !== null
              ? { baseCostOverride: permissionSpec.baseCostOverride }
              : {}),
            summonPermissionEffectIndex: effectIndex,
            ...(usageLimit ? { summonPermissionUsageLimit: usageLimit } : {}),
            ...(effect.limitGroupId
              ? { summonPermissionLimitGroupId: effect.limitGroupId }
              : {}),
            ...(permissionSpec.onBoardCoreSourceFilter !== undefined
              ? {
                  onBoardCoreSourceFilter:
                    permissionSpec.onBoardCoreSourceFilter,
                }
              : {}),
          });
        }
      }
    }

    // BSAZ02-C08【月面基地】の宣言時代替コストは、対象カード自身の自己召喚許可
    // (Q54) とは無関係に、手札から行う通常召喚へ付与される。Q54 effect の列挙内へ
    // 入れると、normalActionPermission の明示がない通常カードを召喚できなくなるため、
    // 独立した通常召喚宣言として生成する。
    if (
      sourceCard.zone === "hand" &&
      !isNexusPermission &&
      declaredAltCostGrant
    ) {
      const altFinalCost = declaredAltCostGrant.benefits.fullReduction
        ? calculateFullReductionSummonCost({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            definition: sourceDefinition,
            sourceInstanceId: sourceCard.instanceId,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        : sourceDefinition.cost;
      // altFinalCost は既に軽減シンボル全充足済みの最終コスト。固定支払いとして
      // 運び、実フィールドシンボルによる二重軽減を防ぐ。
      const altPaymentSources = getAvailableCardCostPaymentSources({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        card: sourceDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
        sourceInstanceId: sourceCard.instanceId,
      });
      const altEnterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy(
        {
          card: sourceCard,
          definition: sourceDefinition,
        }
      );
      const altMinPlacement = altEnterFieldCorePlacementPolicy.minimumCoreCount;
      const altPayable =
        altPaymentSources.totalAvailableCoreAmount >=
        altFinalCost + altMinPlacement;
      if (altPayable) {
        legalActions.push({
          kind: "summon",
          actionId: `legal:summon-permission:${sourceCard.instanceId}:declared-alt-cost`,
          reason: "legal_summon_by_hand_permission",
          can: true,
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          sourceCardNo: sourceDefinition.cardNo,
          targetMode: "none",
          requiredTargetCount: 0,
          targetEffectFilterTags: ["general"],
          candidateTargetInstanceIds: [],
          availableChosenLifeCoreKinds: [],
          requiresChosenLifeCoreKind: false,
          reducedCost: altFinalCost,
          additionalCost: 0,
          finalCost: altFinalCost,
          totalReduction: Math.max(0, sourceDefinition.cost - altFinalCost),
          availableReserveCoreAmount:
            altPaymentSources.reserveSource.availableCoreAmount,
          availableOnBoardCoreSources: altPaymentSources.onBoardCoreSources,
          availableSoulCoreOnlySources: altPaymentSources.soulCoreOnlySources,
          enterFieldCorePlacementRule: altEnterFieldCorePlacementPolicy.rule,
          maximumEnterFieldCoreCount:
            altEnterFieldCorePlacementPolicy.maximumCoreCount,
          minimumRequiredCores:
            getMinimumRequiredCoresFromDefinition(sourceDefinition),
          minimumEnterFieldCoreCount: altMinPlacement,
          requiresEnterFieldCorePlacements: altMinPlacement > 0,
          fixedPaymentCost: altFinalCost,
          declaredSummonAltCostGrantSourceInstanceId:
            declaredAltCostGrant.costGrantInstanceId,
        });
      }
    }
  }

  return legalActions;
}

export function getAvailableFlashFieldCardEffectLegalActions(
  options: GetLegalActionsOptions
): FieldCardEffectLegalAction[] {
  // 実行窓は残す。見出しラベルのない本文タイミング行動や耐性を区別できる
  // 個々のregistrationで restrict_flash / restrict_stack を判定する。
  const context = getCurrentMagicActionTimingContext(options);
  return (context?.raw ?? [])
    .filter((timing): timing is "flash" | "stack" => timing !== "main")
    .flatMap((timing) =>
      getAvailableFieldCardEffectLegalActions(options, timing)
    );
}

/** 発揮資格だけを既存の宣言判定で評価する。内外チェーンの順序待ちは除去理由にしない。 */
export function pruneUnavailableBattleImmediateEffects(
  options: GetLegalActionsOptions
): GameState {
  if (
    !options.getRegisteredBattleImmediateEffectActions ||
    !options.state.battleImmediateEffects.length
  )
    return options.state;
  const available = new Set(
    options.state.players.flatMap((player) =>
      getAvailableBattleImmediateEffectLegalActions(
        { ...options, actingPlayerId: player.id },
        options.state.battleImmediateEffects
      )
        .filter((action) => action.skipOnly !== true)
        .map((action) => action.promptId)
    )
  );
  const remaining = options.state.battleImmediateEffects.filter((prompt) =>
    available.has(prompt.promptId)
  );
  return remaining.length === options.state.battleImmediateEffects.length
    ? options.state
    : {
        ...options.state,
        battleImmediateEffects: remaining,
        log: [
          ...options.state.log,
          ...options.state.battleImmediateEffects
            .filter((prompt) => !available.has(prompt.promptId))
            .map(
              (prompt) => `battle:immediate:pruned-illegal:${prompt.promptId}`
            ),
        ],
      };
}

export function getAvailableBattleImmediateEffectLegalActions(
  options: GetLegalActionsOptions,
  prompts = scopeInnermostTriggerReactions(options.state).battleImmediateEffects
): BattleImmediateEffectLegalAction[] {
  const registrationLookup = options.getRegisteredBattleImmediateEffectActions;

  if (!registrationLookup) {
    return [];
  }

  const legalActions: BattleImmediateEffectLegalAction[] = [];
  const duplicateScopeByActionId = new Map<string, string>();
  const duplicateSourcesByScope = new Map<string, Set<string>>();

  for (const prompt of prompts) {
    // D-2 Phase 2 chooser: 各 variant の chooser を per-action で評価するため、
    // 入口ガードでは「呼び出し側 player が effect owner」または
    // 「呼び出し側 player が effect owner の opponent (chooser=opponent の可能性)」のいずれかを許容する。
    const promptOwnerOpponentId = options.state.players.find(
      (p) => p.id !== prompt.actingPlayerId
    )?.id;
    const battleImmCallerIsOwner =
      prompt.actingPlayerId === options.actingPlayerId;
    const battleImmCallerIsOpponent =
      promptOwnerOpponentId === options.actingPlayerId;
    if (!battleImmCallerIsOwner && !battleImmCallerIsOpponent) {
      continue;
    }

    const sourceDefinition = options.getCardDefinitionById(
      prompt.sourceDefinitionId
    );
    const sourceEffectDefinition = options.getCardDefinitionById(
      prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId
    );

    const allRegistrations = sourceEffectDefinition
      ? (registrationLookup(sourceEffectDefinition.cardNo) ?? [])
      : [];
    const actionRegistration = allRegistrations[prompt.registrationIndex] as
      | RegisteredBattleImmediateEffectAction
      | undefined;
    const registrationValid =
      sourceDefinition !== undefined &&
      sourceEffectDefinition !== undefined &&
      actionRegistration !== undefined &&
      actionRegistration.timing === prompt.timing;
    const sourceEffect =
      registrationValid && actionRegistration.effectIndex !== undefined
        ? sourceEffectDefinition.effects?.[actionRegistration.effectIndex]
        : undefined;
    const promptSourceCard = getCardById(
      options.state,
      prompt.sourceInstanceId
    );
    const battleImmediateEffectSourceInstanceId =
      prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId;
    const battleImmediateCombinedBraveSource =
      sourceEffectDefinition !== undefined &&
      isCombinedBraveEffectSource({
        state: options.state,
        sourceInstanceId: prompt.sourceInstanceId,
        ...(prompt.sourceEffectInstanceId !== undefined
          ? { effectSourceInstanceId: prompt.sourceEffectInstanceId }
          : {}),
        effectSourceDefinition: sourceEffectDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
      });
    const battleImmediateApplicabilitySourceInstanceId =
      battleImmediateCombinedBraveSource &&
      prompt.sourceEffectInstanceId !== undefined
        ? prompt.sourceEffectInstanceId
        : prompt.sourceInstanceId;
    const battleImmediateConditionSourceInstanceId =
      battleImmediateCombinedBraveSource &&
      prompt.sourceEffectInstanceId !== undefined
        ? prompt.sourceEffectInstanceId
        : prompt.sourceInstanceId;
    const battleImmediateConditionSourceContext:
      | ConditionSourceContext
      | undefined = battleImmediateCombinedBraveSource
      ? { combinedBraveHostSourceInstanceId: prompt.sourceInstanceId }
      : undefined;
    const selfReferenceRewriteStatus =
      registrationValid &&
      sourceDefinition !== undefined &&
      sourceEffectDefinition !== undefined &&
      promptSourceCard !== undefined
        ? getBraveSelfReferenceRewriteStatus({
            state: options.state,
            sourceCard: promptSourceCard,
            sourceDefinition,
            sourceEffectDefinition,
            ...(prompt.sourceEffectInstanceId !== undefined
              ? { sourceEffectInstanceId: prompt.sourceEffectInstanceId }
              : {}),
            effect: sourceEffect,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        : "not_required";
    const effectApplicabilityMet =
      promptSourceCard !== undefined &&
      sourceDefinition !== undefined &&
      getBattleImmediateEffectSourceUseBlockReason(
        prompt.actingPlayerId,
        prompt.sourceKind,
        promptSourceCard,
        sourceDefinition,
        options.state
      ) === null &&
      (!sourceEffect?.applicability ||
        evaluateApplicability(
          options.state,
          sourceEffect.applicability,
          battleImmediateApplicabilitySourceInstanceId,
          options.getCardDefinitionById
        ));
    const effectConditionMet =
      effectApplicabilityMet &&
      (!sourceEffect?.condition ||
        sourceEffect.condition.length === 0 ||
        evaluateCondition(
          options.state,
          sourceEffect.condition,
          battleImmediateConditionSourceInstanceId,
          prompt.actingPlayerId,
          options.getCardDefinitionById,
          undefined,
          battleImmediateConditionSourceContext
        ));
    const effectRebirthGateMet =
      selfReferenceRewriteStatus !== "blocked" &&
      effectConditionMet &&
      canExecuteRebirthEffectNow(
        options.state,
        prompt.actingPlayerId,
        sourceEffect,
        battleImmediateEffectSourceInstanceId,
        options.getCardDefinitionById,
        getBattleImmediateRebirthTimingWindowId(prompt)
      );

    // P3-91: caller 非依存の理由 (usageLimit / 空撃ち禁止 / choice 条件未達) を除いて
    // 発揮可能な variant が 1 つでもあるか。0 なら誰もこの prompt を解決できないため、
    // owner に drain 専用の skipOnly action を返す (下の if)。これが無いと
    // battleImmediateEffects に prompt が滞留しアタックが進行不能になる
    // (queueRegisteredBattleImmediateEffects の usageLimit 事前 skip の解決時版)。
    let anyVariantGloballyAvailable = false;

    // P3-24 Phase 2: choice 変種は registration.choices に集約済み。変種ごとに 1 legal action を展開
    const variants =
      registrationValid && effectRebirthGateMet
        ? actionRegistration.choices
        : undefined;
    const choiceIterations =
      !registrationValid || !effectRebirthGateMet
        ? []
        : getChoiceIterationsForAvailability(sourceEffect, variants);

    for (const choiceIndex of choiceIterations) {
      const reg: RegisteredBattleImmediateEffectAction =
        choiceIndex !== undefined && variants
          ? mergeBattleImmediateChoiceVariant(
              actionRegistration!,
              variants[choiceIndex]!,
              choiceIndex
            )
          : actionRegistration!;
      const resolvedChoiceIndex = reg.choiceIndex;
      const regIdx = prompt.registrationIndex;
      const battleImmTriggerEventScopeKey = `battle_immediate:${prompt.attackId}:${prompt.timing}:${prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId}:${prompt.registrationIndex}`;

      // ---- caller 非依存チェック (どの呼び出し側でも結果が変わらないブロック理由) ----
      if (
        isEffectSuppressedBeforeDeclaration({
          state: options.state,
          sourceInstanceId: prompt.sourceInstanceId,
          preventionSourceInstanceId:
            prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId,
          actingPlayerId: prompt.actingPlayerId,
          registration: reg,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      ) {
        continue;
      }

      if (
        reg.usageLimit &&
        !canUseEffectByUsageLimit({
          sourceEffect: sourceEffect,
          state: options.state,
          sourceInstanceId:
            prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId,
          sourceDefinitionId:
            prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: getStableEffectLabel("battle_immediate", regIdx, reg),
          usageLimit: reg.usageLimit,
          triggerEventScopeKey: battleImmTriggerEventScopeKey,
          ...(reg.limitGroupId ? { groupId: reg.limitGroupId } : {}),
        })
      ) {
        continue;
      }

      // 分岐・反復のない単一 step の usageLimit は interpreter が `__step:` で
      // 記録する。同じラベルを使って宣言前に除外し、使用済み効果の action /
      // declaration stack を生成しない。
      if (
        reg.declarationStepUsage &&
        !canUseEffectByUsageLimit({
          sourceEffect: sourceEffect,
          state: options.state,
          sourceInstanceId:
            prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId,
          sourceDefinitionId:
            prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: getStepUsageLabel(
            prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId,
            reg.effectIndex ?? regIdx,
            reg.declarationStepUsage.stepIndex,
            reg.declarationStepUsage.usageGroupId
          ),
          usageLimit: reg.declarationStepUsage.usageLimit,
        })
      ) {
        continue;
      }

      // 変種別 usageLimit チェック (「ターンに1回ずつ」= choice ごとに独立, C05 アタック時)。
      const bieVariantOwnUsageLimit =
        resolvedChoiceIndex !== undefined && variants
          ? variants[resolvedChoiceIndex]!.usageLimit
          : undefined;
      if (
        bieVariantOwnUsageLimit &&
        !canUseEffectByUsageLimit({
          sourceEffect: sourceEffect,
          state: options.state,
          sourceInstanceId:
            prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId,
          sourceDefinitionId:
            prompt.sourceEffectDefinitionId ?? prompt.sourceDefinitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: getChoiceVariantUsageLabel(
            getStableEffectLabel("battle_immediate", regIdx, reg),
            resolvedChoiceIndex!
          ),
          usageLimit: bieVariantOwnUsageLimit,
          triggerEventScopeKey: battleImmTriggerEventScopeKey,
        })
      ) {
        continue;
      }

      const battleImmediateAffectSourceIdentity = resolveAffectSourceIdentity({
        state: options.state,
        sourceInstanceId: prompt.sourceInstanceId,
        ...(sourceDefinition !== undefined ? { sourceDefinition } : {}),
        ...(prompt.sourceEffectInstanceId !== undefined
          ? { effectSourceInstanceId: prompt.sourceEffectInstanceId }
          : {}),
        ...(sourceEffectDefinition !== undefined
          ? { effectSourceDefinition: sourceEffectDefinition }
          : {}),
        getCardDefinitionById: options.getCardDefinitionById,
      });
      const battleImmediateCandidateTargetOptions = candidateTargetOptions(
        options,
        prompt.sourceInstanceId,
        {
          ...(sourceEffectDefinition !== undefined
            ? { sourceDefinition: sourceEffectDefinition }
            : {}),
          affectSourceIdentity: battleImmediateAffectSourceIdentity,
        }
      );

      const targetGroups = buildLegalActionTargetGroups({
        state: options.state,
        actingPlayerId: prompt.actingPlayerId,
        actionRegistration: reg,
        ...battleImmediateCandidateTargetOptions,
        resolveCountBound: createCountBoundResolver(
          options.state,
          prompt.actingPlayerId,
          prompt.sourceInstanceId,
          options.getCardDefinitionById
        ),
      });
      const requiredCostSourceTribes = getRequiredCostSourceTribesForCard(
        options.state,
        getCardById(
          options.state,
          prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId
        ),
        sourceEffectDefinition,
        options.getCardDefinitionById
      );
      const effectiveTargetGroups =
        capTargetGroupsByRequiredSelectedTargetsCountCost(
          options.state,
          prompt.actingPlayerId,
          reg,
          targetGroups,
          requiredCostSourceTribes
        );
      if (effectiveTargetGroups === null) {
        continue;
      }
      if (
        effectiveTargetGroups.length > 0 &&
        !areLegalActionTargetGroupsSatisfiable(
          effectiveTargetGroups,
          reg.allowDuplicateTargets === true
        )
      ) {
        continue;
      }
      const groupedRequiredTargetCount =
        effectiveTargetGroups.length > 0
          ? effectiveTargetGroups.reduce(
              (sum, group) => sum + group.requiredTargetCount,
              0
            )
          : null;
      const groupedMaxTargetCount =
        effectiveTargetGroups.length > 0
          ? effectiveTargetGroups.reduce(
              (sum, group) =>
                sum + (group.maxTargetCount ?? group.requiredTargetCount),
              0
            )
          : null;
      const rawRequiredTargetCount =
        groupedRequiredTargetCount ??
        getResolvedRequiredTargetCount(
          options.state,
          prompt.actingPlayerId,
          prompt.sourceInstanceId,
          reg,
          options.getCardDefinitionById
        );
      const rawMaxTargetCount =
        groupedMaxTargetCount ??
        getResolvedMaxTargetCount(
          options.state,
          prompt.actingPlayerId,
          prompt.sourceInstanceId,
          reg,
          options.getCardDefinitionById
        );
      const costLimitedMaxTargetCount =
        effectiveTargetGroups.length > 0
          ? rawMaxTargetCount
          : getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
              options.state,
              prompt.actingPlayerId,
              reg,
              rawMaxTargetCount,
              requiredCostSourceTribes
            );
      if (costLimitedMaxTargetCount < rawRequiredTargetCount) {
        continue;
      }
      const effectiveRawMaxTargetCount = Math.min(
        rawMaxTargetCount,
        costLimitedMaxTargetCount
      );
      const needsCandidates =
        rawRequiredTargetCount > 0 || effectiveRawMaxTargetCount > 0;
      // 候補の絞り込みは効果オーナー視点で行う (chooser が変わっても "self/opponent" は owner 基準)
      const candidateTargetInstanceIds =
        effectiveTargetGroups.length > 0
          ? Array.from(
              new Set(
                effectiveTargetGroups.flatMap(
                  (group) => group.candidateTargetInstanceIds
                )
              )
            )
          : !needsCandidates
            ? []
            : getCandidateTargetInstanceIds(
                options.state,
                prompt.actingPlayerId,
                reg,
                battleImmediateCandidateTargetOptions
              );

      // 空撃ち対応 (03b:131): 対象不足でも「ことで」コスト以外は使用可能。
      const emptyFire = resolveEmptyFireTargetCounts({
        requiredTargetCount: rawRequiredTargetCount,
        maxTargetCount: effectiveRawMaxTargetCount,
        candidateCount:
          reg.allowDuplicateTargets === true &&
          candidateTargetInstanceIds.length > 0
            ? Math.max(
                candidateTargetInstanceIds.length,
                rawRequiredTargetCount
              )
            : candidateTargetInstanceIds.length,
        gatedByConditionalCost: reg.targetGatedByConditionalCost === true,
        requiresFullCount: reg.targetRequiresFullCount === true,
      });
      if (emptyFire.block) {
        continue;
      }
      const requiredTargetCount = emptyFire.requiredTargetCount;
      const maxTargetCount = emptyFire.maxTargetCount;

      if (
        !canPayRequiredEffectCosts(
          options.state,
          prompt.actingPlayerId,
          reg,
          options.getCardDefinitionById,
          requiredCostSourceTribes,
          cardFilterEvaluationOptions({
            state: options.state,
            getCardDefinitionById: options.getCardDefinitionById,
          }),
          {
            sourceInstanceId: prompt.sourceInstanceId,
            ...(sourceEffectDefinition !== undefined
              ? { sourceDefinition: sourceEffectDefinition }
              : {}),
            ...(sourceEffectDefinition !== undefined
              ? { sourceDefinitionId: sourceEffectDefinition.cardNo }
              : {}),
            ...(reg.effectIndex !== undefined
              ? { effectIndex: reg.effectIndex }
              : {}),
            ...(reg.preventionLevel !== undefined
              ? { sourcePreventionLevel: reg.preventionLevel }
              : {}),
            ...(reg.targetLockBypass !== undefined
              ? {
                  sourceTargetLockBypass: reg.targetLockBypass,
                  sourcePreventionBypass: reg.targetLockBypass,
                }
              : {}),
          }
        )
      ) {
        continue;
      }

      // choice ステップの条件が満たされない variant はスキップ
      if (resolvedChoiceIndex !== undefined && reg.effectIndex !== undefined) {
        const choiceCondition = getChoiceStepCondition(
          sourceEffectDefinition!,
          reg.effectIndex,
          resolvedChoiceIndex
        );
        if (choiceCondition && choiceCondition.length > 0) {
          const condMet = evaluateCondition(
            options.state,
            choiceCondition,
            battleImmediateConditionSourceInstanceId,
            prompt.actingPlayerId,
            options.getCardDefinitionById,
            undefined,
            battleImmediateConditionSourceContext
          );
          if (!condMet) {
            continue;
          }
        }
      }

      // ここまで到達した variant は (chooser を除いて) 発揮可能。
      anyVariantGloballyAvailable = true;

      // ---- caller 依存チェック ----
      // D-2 Phase 2 chooser: variant の chooser を解決して prompt 相手を計算
      const chooserPlayerId = resolveChooserPlayerId(
        options.state,
        prompt.actingPlayerId,
        reg.chooser
      );
      // 呼び出し側 player が prompt 相手と一致しない variant はスキップ
      if (chooserPlayerId !== options.actingPlayerId) {
        continue;
      }

      const choiceLabel =
        resolvedChoiceIndex !== undefined && variants
          ? variants[resolvedChoiceIndex]!.label
          : undefined;
      const battleImmediateExecutionMode =
        prompt.executionMode ??
        reg.executionMode ??
        sourceEffect?.executionMode ??
        "mandatory";

      if (battleImmCallerIsOwner && hasNoDuplicateUsageLimit(reg.usageLimit)) {
        const scope = `${prompt.actingPlayerId}:${battleImmTriggerEventScopeKey}`;
        duplicateScopeByActionId.set(
          createBattleImmediateEffectLegalActionId(
            prompt.promptId,
            resolvedChoiceIndex
          ),
          scope
        );
        const sources = duplicateSourcesByScope.get(scope) ?? new Set<string>();
        sources.add(prompt.sourceEffectInstanceId ?? prompt.sourceInstanceId);
        duplicateSourcesByScope.set(scope, sources);
      }

      legalActions.push({
        kind: "resolve_battle_immediate_effect",
        actionId: createBattleImmediateEffectLegalActionId(
          prompt.promptId,
          resolvedChoiceIndex
        ),
        can: true,
        reason: reg.reason ?? `legal_battle_immediate_${prompt.timing}_effect`,
        actingPlayerId: prompt.actingPlayerId,
        ...(chooserPlayerId !== prompt.actingPlayerId
          ? { chooserPlayerId }
          : {}),
        promptId: prompt.promptId,
        attackId: prompt.attackId,
        timing: prompt.timing,
        sourceKind: prompt.sourceKind,
        sourceInstanceId: prompt.sourceInstanceId,
        sourceDefinitionId: prompt.sourceDefinitionId,
        ...(prompt.sourceEffectDefinitionId !== undefined
          ? { sourceEffectDefinitionId: prompt.sourceEffectDefinitionId }
          : {}),
        ...(prompt.sourceEffectInstanceId !== undefined
          ? { sourceEffectInstanceId: prompt.sourceEffectInstanceId }
          : {}),
        sourceCardNo: prompt.sourceCardNo,
        participantEntityId: prompt.participantEntityId,
        executionMode: battleImmediateExecutionMode,
        ...(resolvedChoiceIndex !== undefined
          ? {
              choiceIndex: resolvedChoiceIndex,
              ...(choiceLabel ? { choiceLabel } : {}),
            }
          : {}),
        targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
        requiredTargetCount,
        ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
        targetEffectFilterTags: getTargetEffectFilterTags(reg),
        candidateTargetInstanceIds,
        ...(effectiveTargetGroups.length === 0 &&
        reg.candidateTargetZones !== undefined
          ? { candidateTargetZones: reg.candidateTargetZones }
          : {}),
        ...(effectiveTargetGroups.length > 0
          ? { targetGroups: effectiveTargetGroups }
          : {}),
        ...(reg.targetStepId !== undefined
          ? { targetStepId: reg.targetStepId }
          : {}),
        ...(reg.allowDuplicateTargets === true
          ? { allowDuplicateTargets: true }
          : {}),
        ...(reg.requiredPayCostAmount !== undefined
          ? { requiredPayCostAmount: reg.requiredPayCostAmount }
          : {}),
        ...(reg.requiredCountCostAmount !== undefined
          ? { requiredCountCostAmount: reg.requiredCountCostAmount }
          : {}),
        ...(reg.requiredCountCostPlayer !== undefined
          ? { requiredCountCostPlayer: reg.requiredCountCostPlayer }
          : {}),
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
      });
    }

    const canDeclineOptionalBattleImmediate =
      registrationValid &&
      effectRebirthGateMet &&
      battleImmCallerIsOwner &&
      (prompt.executionMode ??
        actionRegistration.executionMode ??
        sourceEffect?.executionMode) === "optional";
    // Optional battle-immediate effects must expose a decline action even when
    // an executable variant exists ("ことで" effects can be declined).
    // If no variant is available, the same skipOnly path also drains the prompt.
    if (
      (canDeclineOptionalBattleImmediate || !anyVariantGloballyAvailable) &&
      battleImmCallerIsOwner
    ) {
      legalActions.push({
        kind: "resolve_battle_immediate_effect",
        actionId: `${createBattleImmediateEffectLegalActionId(prompt.promptId)}:skip`,
        can: true,
        reason: `legal_battle_immediate_${prompt.timing}_effect_skip_only`,
        actingPlayerId: prompt.actingPlayerId,
        promptId: prompt.promptId,
        attackId: prompt.attackId,
        timing: prompt.timing,
        sourceKind: prompt.sourceKind,
        sourceInstanceId: prompt.sourceInstanceId,
        sourceDefinitionId: prompt.sourceDefinitionId,
        ...(prompt.sourceEffectDefinitionId !== undefined
          ? { sourceEffectDefinitionId: prompt.sourceEffectDefinitionId }
          : {}),
        ...(prompt.sourceEffectInstanceId !== undefined
          ? { sourceEffectInstanceId: prompt.sourceEffectInstanceId }
          : {}),
        sourceCardNo: prompt.sourceCardNo,
        participantEntityId: prompt.participantEntityId,
        executionMode: "optional",
        targetMode: "none",
        requiredTargetCount: 0,
        targetEffectFilterTags: ["general"],
        candidateTargetInstanceIds: [],
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
        skipOnly: true,
      });
    }
  }

  return legalActions.map((action) => {
    const scope = duplicateScopeByActionId.get(action.actionId);
    return action.executionMode === "mandatory" &&
      scope !== undefined &&
      (duplicateSourcesByScope.get(scope)?.size ?? 0) > 1
      ? { ...action, canSkipDuplicate: true as const }
      : action;
  });
}

function getCurrentMagicActionTimingContext(options: GetLegalActionsOptions): {
  raw: Array<"main" | "flash" | "stack">;
  stackSourceInstanceId?: string | null;
  stackSource?: ActiveStack | null;
} | null {
  let raw: Array<"main" | "flash" | "stack">;
  let stackSourceInstanceId: string | null | undefined;
  let stackSource: ActiveStack | null | undefined;

  const stackWindow = options.state.stackWindow;
  if (stackWindow !== null && options.state.window === "stack") {
    raw = getResponseWindowActionTimings({
      windowState: stackWindow,
      actingPlayerId: options.actingPlayerId,
    });
    stackSourceInstanceId = stackWindow.pendingStackAction?.cardInstanceId;
    stackSource = stackWindow.pendingStackAction;
  } else if (
    canEnumerateMainHandCardActions(options.state, options.actingPlayerId)
  ) {
    raw = ["main", "flash"];
  } else {
    // Pre-declaration stack context
    const preDecWin = options.state.preDeclarationStackWindow;
    if (
      preDecWin !== null &&
      options.state.window === "pre_declaration_stack"
    ) {
      raw = getResponseWindowActionTimings({
        windowState: preDecWin,
        actingPlayerId: options.actingPlayerId,
      });
      stackSourceInstanceId = getResponseStackSourceInstanceId(
        preDecWin,
        preDecWin.sourceInstanceId
      );
      stackSource = preDecWin.pendingStackAction;
    } else {
      // Battle flash context (既存)
      const flashWindowState = options.state.activeAttack?.flashWindowState;

      if (!flashWindowState) {
        return null;
      }

      if (
        options.state.window !== "flash_before_block" &&
        options.state.window !== "flash_after_block" &&
        options.state.window !== "stack_before_block" &&
        options.state.window !== "stack_after_block"
      ) {
        return null;
      }

      raw = getResponseWindowActionTimings({
        windowState: flashWindowState,
        actingPlayerId: options.actingPlayerId,
      });
      stackSourceInstanceId =
        flashWindowState.pendingStackAction?.cardInstanceId;
      stackSource = flashWindowState.pendingStackAction;
    }
  }

  return {
    raw,
    ...(stackSourceInstanceId !== undefined ? { stackSourceInstanceId } : {}),
    ...(stackSource !== undefined ? { stackSource } : {}),
  };
}

export function getCurrentMagicActionTimings(
  options: GetLegalActionsOptions
): Array<"main" | "flash" | "stack"> {
  const context = getCurrentMagicActionTimingContext(options);
  if (context === null) return [];

  // P3-75: restrict_flash / restrict_stack CE でブロックされるタイミングを除去
  return filterRestrictedTimings(
    context.raw,
    options.state,
    options.actingPlayerId,
    context.stackSourceInstanceId,
    options.getCardDefinitionById,
    context.stackSource,
    undefined,
    undefined,
    undefined,
    evaluateCondition
  );
}

export function getAvailableMagicLegalActions(
  options: GetLegalActionsOptions & {
    /**
     * 他の使用の支払い前に、フィールド上の作戦マジックの指定効果を通常マジック使用として
     * 許可する一時的な権利。通常の field 効果列挙を広げず、発生済み pending のみが渡す。
     */
    fieldMagicUsePermission?: {
      sourceInstanceId: string;
      effectIndex: number;
    };
  }
): UseMagicLegalAction[] {
  const getRegisteredMagicActions = options.getRegisteredMagicActions;
  const timings = getCurrentMagicActionTimings(options);

  if (!getRegisteredMagicActions || timings.length === 0) {
    return [];
  }

  const legalActions: UseMagicLegalAction[] = [];

  // 手札 + 手元 + トラッシュ + フィールドからマジック使用可能カードを列挙
  // （手元のマジックは通常使用可能。アクセル再使用のみ不可。トラッシュは
  // `applicability.zone` にトラッシュを宣言した registration のみ許可 =
  // `isRegisteredMagicSourceZoneAllowed` がゲート。engine-magic-trash-use-permission、
  // BSDB01-R03「トラッシュにあるこのカードは…トラッシュからも使用できる」）。
  const handCards = getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  const setAsideCards = getCardsByZone(options.state, "set_aside");
  const trashCards = getCardsByZone(options.state, "trash");
  const fieldCards = getCardsByZone(options.state, "field");
  const sourceCards = [
    ...handCards,
    ...setAsideCards,
    ...trashCards,
    ...fieldCards,
  ];
  const adventSourceIds = collectUnderCardScopeIds(options.state).adventSource;

  for (const sourceCard of sourceCards) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
      continue;
    }

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition) {
      continue;
    }
    const sourceEffectiveCategory = getEffectiveCategory(
      options.state,
      sourceCard,
      sourceDefinition
    );
    if (
      !isMagicLikeCardForm(sourceCard, sourceDefinition) &&
      sourceEffectiveCategory !== "magic"
    ) {
      continue;
    }

    // restrict_use CE チェック
    if (
      isCardUseRestricted(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById,
        "magic"
      )
    ) {
      continue;
    }

    const registrations = getRegisteredMagicActions(sourceDefinition.cardNo);

    if (!registrations || registrations.length === 0) {
      continue;
    }

    for (const actionRegistration of registrations) {
      const sourceIsFieldGrantedMagic =
        sourceCard.zone === "field" &&
        sourceEffectiveCategory === "magic" &&
        !isMagicLikeCardForm(sourceCard, sourceDefinition);
      const sourceIsFieldArtsTokenMagic =
        sourceCard.zone === "field" &&
        isArtsTokenMagicDefinition(sourceDefinition);
      const sourceHasFieldMagicUsePermission =
        sourceCard.zone === "field" &&
        options.fieldMagicUsePermission?.sourceInstanceId ===
          sourceCard.instanceId &&
        options.fieldMagicUsePermission.effectIndex ===
          actionRegistration.effectIndex;
      // BSAZ01-C12 の「ただちにメイン効果を使用できる」は、割り込み元が
      // flash / stack の地球マジックでも main 効果を通常 use_magic として
      // 使用する明示許可。発生済み pending が渡す1効果だけを開くため、通常の
      // field magic 列挙や他の main magic のタイミングは広げない。
      const registrationTimingIsAllowed =
        timings.includes(actionRegistration.timing) ||
        (sourceHasFieldMagicUsePermission &&
          actionRegistration.timing === "main");
      if (!registrationTimingIsAllowed) {
        continue;
      }
      const sourceCanUseFromField =
        sourceIsFieldGrantedMagic ||
        sourceIsFieldArtsTokenMagic ||
        sourceHasFieldMagicUsePermission ||
        (sourceCard.zone === "field" &&
          hasMagicUsePermission(
            options.state,
            sourceCard.instanceId,
            actionRegistration.timing
          ));
      if (
        !isRegisteredMagicSourceZoneAllowed(
          actionRegistration,
          getOwnEffectSourceZone(
            options.state,
            sourceCard,
            options.actingPlayerId,
            options.getCardDefinitionById
          ),
          adventSourceIds.has(sourceCard.instanceId)
        ) &&
        !sourceCanUseFromField
      ) {
        continue;
      }

      if (
        actionRegistration.timing === "flash" &&
        !filterRestrictedTimings(
          ["flash"],
          options.state,
          options.actingPlayerId,
          undefined,
          options.getCardDefinitionById,
          undefined,
          sourceCard.zone,
          undefined,
          undefined,
          evaluateCondition
        ).includes("flash")
      ) {
        continue;
      }

      // timingScope: マジックも『お互いのアタックステップ』等の限定がある。
      // engine-hand-self-card-main-end-activation-timing: timingScope.subPhase==="end"
      // (「メインステップ終了時に使用できる」) は state.window==="step_end" のときだけ有効。
      if (
        !isTimingScopeActive(
          actionRegistration.timingScope,
          options.state.step,
          options.state.activePlayerId,
          sourceCard.controllerPlayerId,
          options.state.window === "step_end" ? "end" : undefined
        )
      ) {
        continue;
      }

      if (
        actionRegistration.timing === "stack" &&
        !filterRestrictedTimings(
          ["stack"],
          options.state,
          options.actingPlayerId,
          undefined,
          options.getCardDefinitionById,
          undefined,
          sourceCard.zone,
          sourceCard.instanceId,
          actionRegistration.suppressionEffectDescriptor,
          evaluateCondition
        ).includes("stack")
      ) {
        continue;
      }

      if (
        actionRegistration.timing === "stack" &&
        !isRegistrationEligibleForStackResponse({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          sourceCard,
          sourceDefinition,
          actionRegistration,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      ) {
        continue;
      }

      if (
        actionRegistration.usageLimit &&
        !canUseEffectByUsageLimit({
          sourceEffect:
            sourceDefinition.effects?.[actionRegistration.effectIndex ?? -1],
          state: options.state,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: "magic",
          usageLimit: actionRegistration.usageLimit,
          ...(actionRegistration.limitGroupId
            ? { groupId: actionRegistration.limitGroupId }
            : {}),
        })
      ) {
        continue;
      }

      const timing = actionRegistration.timing;
      // engine-magic-trash-use-permission (adversarial verifier round1 指摘反映):
      // この registration が実際に許可するゾーンを getMagicCardAndDefinition 系ヘルパーへ
      // 明示的に渡す。宣言していない registration 経由でトラッシュのカードが実行時に
      // すり抜けるのを防ぐため、既定 (未宣言) は手札/手元のみに戻し、個別 registration
      // 単位でのみトラッシュを許可する。
      const baseRegistrationAllowedZones =
        getRegisteredMagicActionAllowedZones(actionRegistration);
      const registrationAllowedZones =
        sourceCanUseFromField && !baseRegistrationAllowedZones.includes("field")
          ? ([...baseRegistrationAllowedZones, "field"] as const)
          : baseRegistrationAllowedZones;

      const paymentSources = getAvailableMagicPaymentSources({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        magicInstanceId: sourceCard.instanceId,
        getCardDefinitionById: options.getCardDefinitionById,
        effectMode: timing,
        allowedSourceZones: registrationAllowedZones,
      });
      const zoneCostDiscountOptions = getMagicZoneCostDiscountOptions({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
        effectMode: timing,
        allowedSourceZones: registrationAllowedZones,
      });
      const freeUseSource = getMagicFreeUseSource({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        magicInstanceId: sourceCard.instanceId,
        getCardDefinitionById: options.getCardDefinitionById,
        effectMode: timing,
        allowedSourceZones: registrationAllowedZones,
      });
      // P2-05 Phase 4a: 「コストNで使用できる」型 (amount>0) の上書きコスト CE
      const costOverrideSource = getMagicCostOverrideSource({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        magicInstanceId: sourceCard.instanceId,
        getCardDefinitionById: options.getCardDefinitionById,
        effectMode: timing,
        allowedSourceZones: registrationAllowedZones,
      });
      if (
        costOverrideSource?.usageLimit &&
        !canUseEffectByUsageLimit({
          state: options.state,
          sourceInstanceId: costOverrideSource.sourceInstanceId,
          sourceDefinitionId: costOverrideSource.sourceDefinitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          sourceEffect: costOverrideSource.sourceEffect,
          effectLabel: costOverrideSource.effectLabel ?? "magic_cost_override",
          usageLimit: costOverrideSource.usageLimit,
          ...(costOverrideSource.limitGroupId
            ? { groupId: costOverrideSource.limitGroupId }
            : {}),
        })
      ) {
        continue;
      }
      const specialCostAdditionalCost = paymentSources.reduction.additionalCost;
      const specialCostFloor = getEffectiveCostFloor(
        sourceDefinition,
        options.state,
        options.actingPlayerId,
        options.getCardDefinitionById,
        sourceCard.instanceId,
        timing
      );
      const freeFinalCost = calculateSpecialCostFinalCost(
        specialCostFloor,
        0,
        specialCostAdditionalCost
      );
      const canPayFreeCost =
        freeUseSource.canUseWithoutCost &&
        paymentSources.totalAvailableCoreAmount >= freeFinalCost;
      const overrideFinalCost =
        costOverrideSource !== null
          ? calculateSpecialCostFinalCost(
              specialCostFloor,
              costOverrideSource.overrideCost,
              specialCostAdditionalCost
            )
          : 0;
      const canPayOverrideCost =
        costOverrideSource !== null &&
        paymentSources.totalAvailableCoreAmount >= overrideFinalCost;

      // 通常コストで払えず、無料化 CE も払える上書きコスト CE もないなら継続不可
      if (
        !paymentSources.canFullyPay &&
        !canPayFreeCost &&
        !canPayOverrideCost &&
        zoneCostDiscountOptions.length === 0
      ) {
        continue;
      }

      // effect.condition の事前ガード (field card と同型)。
      // 「ことで」コスト・「〜のとき」条件をマジック側でも legal action 列挙時に評価する。
      if (
        actionRegistration.condition &&
        actionRegistration.condition.length > 0 &&
        !evaluateCondition(
          options.state,
          actionRegistration.condition,
          sourceCard.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )
      ) {
        continue;
      }

      const magicEffect =
        actionRegistration.effectIndex !== undefined
          ? sourceDefinition.effects?.[actionRegistration.effectIndex]
          : undefined;
      const magicAvailabilitySourcePrevention =
        resolveAvailabilitySourcePrevention({
          state: options.state,
          sourceInstanceId: sourceCard.instanceId,
          actingPlayerId: options.actingPlayerId,
          getCardDefinitionById: options.getCardDefinitionById,
          registrationPreventionLevel: actionRegistration.preventionLevel,
          registrationPreventionBypass: actionRegistration.targetLockBypass,
        });

      // P3-24 per-choice usageLimit: choice 変種は registration.choices に集約されている。
      // 変種ごとに 1 legal action を展開する (choices 未定義なら 1 件のみ)。
      // 全変種が変種別 usageLimit / 条件で封鎖されていれば use_magic は 1 件も出ない
      // (= use 自体が非合法化される)。
      const magicVariants = actionRegistration.choices;
      const magicChoiceIterations = getChoiceIterationsForAvailability(
        magicEffect,
        magicVariants
      );

      for (const magicChoiceIndex of magicChoiceIterations) {
        const variantRegistration: RegisteredMagicAction =
          magicChoiceIndex !== undefined && magicVariants
            ? mergeRegistrationChoiceVariant(
                actionRegistration,
                magicVariants[magicChoiceIndex]!
              )
            : actionRegistration;

        if (
          isConditionalCostBlocked({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            sourceCard,
            sourceDefinition,
            sourceKind: "magic",
            resolutionKind: "magic_action",
            composition: variantRegistration.composition,
            effect: magicEffect,
            effectIndex: variantRegistration.effectIndex,
            choiceIndex: magicChoiceIndex,
            ...magicAvailabilitySourcePrevention,
            sourceTargetLockBypass: variantRegistration.targetLockBypass,
            effectActionKind: "magic",
            getCardDefinitionById: options.getCardDefinitionById,
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
            getConditionalCostCanExecuteCheck:
              options.getConditionalCostCanExecuteCheck,
          })
        ) {
          continue;
        }

        // 変種別 usageLimit チェック (「ゲーム中に1回ずつ」C21 = choice ごとに独立)。
        const variantOwnUsageLimit =
          magicChoiceIndex !== undefined && magicVariants
            ? magicVariants[magicChoiceIndex]!.usageLimit
            : undefined;
        if (
          variantOwnUsageLimit &&
          !canUseEffectByUsageLimit({
            sourceEffect:
              sourceDefinition.effects?.[actionRegistration.effectIndex ?? -1],
            state: options.state,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            getCardDefinitionById: options.getCardDefinitionById,
            effectLabel: getChoiceVariantUsageLabel("magic", magicChoiceIndex!),
            usageLimit: variantOwnUsageLimit,
          })
        ) {
          continue;
        }

        // choice ステップの条件が満たされない variant はスキップ
        if (
          magicChoiceIndex !== undefined &&
          actionRegistration.effectIndex !== undefined
        ) {
          const choiceCondition = getChoiceStepCondition(
            sourceDefinition,
            actionRegistration.effectIndex,
            magicChoiceIndex
          );
          if (choiceCondition && choiceCondition.length > 0) {
            const condMet = evaluateCondition(
              options.state,
              choiceCondition,
              sourceCard.instanceId,
              options.actingPlayerId,
              options.getCardDefinitionById
            );
            if (!condMet) {
              continue;
            }
          }
        }

        const targetGroups = buildLegalActionTargetGroups({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          actionRegistration: variantRegistration,
          ...candidateTargetOptions(options, sourceCard.instanceId),
          resolveCountBound: createCountBoundResolver(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            options.getCardDefinitionById
          ),
        });
        const requiredCostSourceTribes = getRequiredCostSourceTribesForCard(
          options.state,
          sourceCard,
          sourceDefinition,
          options.getCardDefinitionById
        );
        const effectiveTargetGroups =
          capTargetGroupsByRequiredSelectedTargetsCountCost(
            options.state,
            options.actingPlayerId,
            variantRegistration,
            targetGroups,
            requiredCostSourceTribes
          );
        if (effectiveTargetGroups === null) {
          continue;
        }
        if (
          effectiveTargetGroups.length > 0 &&
          !areLegalActionTargetGroupsSatisfiable(
            effectiveTargetGroups,
            variantRegistration.allowDuplicateTargets === true
          )
        ) {
          continue;
        }
        const groupedRequiredTargetCount =
          effectiveTargetGroups.length > 0
            ? effectiveTargetGroups.reduce(
                (sum, group) => sum + group.requiredTargetCount,
                0
              )
            : null;
        const groupedMaxTargetCount =
          effectiveTargetGroups.length > 0
            ? effectiveTargetGroups.reduce(
                (sum, group) =>
                  sum + (group.maxTargetCount ?? group.requiredTargetCount),
                0
              )
            : null;
        const rawRequiredTargetCount =
          groupedRequiredTargetCount ??
          getResolvedRequiredTargetCount(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            variantRegistration,
            options.getCardDefinitionById
          );
        const rawMaxTargetCount =
          groupedMaxTargetCount ??
          getResolvedMaxTargetCount(
            options.state,
            options.actingPlayerId,
            sourceCard.instanceId,
            variantRegistration,
            options.getCardDefinitionById
          );
        const costLimitedMaxTargetCount =
          effectiveTargetGroups.length > 0
            ? rawMaxTargetCount
            : getRequiredSelectedTargetsCountCostLimitedMaxTargetCount(
                options.state,
                options.actingPlayerId,
                variantRegistration,
                rawMaxTargetCount,
                requiredCostSourceTribes
              );
        if (costLimitedMaxTargetCount < rawRequiredTargetCount) {
          continue;
        }
        const effectiveRawMaxTargetCount = Math.min(
          rawMaxTargetCount,
          costLimitedMaxTargetCount
        );
        const needsCandidates =
          rawRequiredTargetCount > 0 || effectiveRawMaxTargetCount > 0;
        const candidateTargetInstanceIds =
          effectiveTargetGroups.length > 0
            ? Array.from(
                new Set(
                  effectiveTargetGroups.flatMap(
                    (group) => group.candidateTargetInstanceIds
                  )
                )
              )
            : !needsCandidates
              ? []
              : getCandidateTargetInstanceIds(
                  options.state,
                  options.actingPlayerId,
                  variantRegistration,
                  candidateTargetOptions(options, sourceCard.instanceId)
                );
        const availableChosenLifeCoreKinds =
          variantRegistration.actingPlayerLifeCoreChoice
            ? getAvailableChosenLifeCoreKinds({
                state: options.state,
                actingPlayerId: options.actingPlayerId,
                sourceInstanceId: sourceCard.instanceId,
                actionRegistration: variantRegistration,
                candidateTargetInstanceIds,
                getCardDefinitionById: options.getCardDefinitionById,
              })
            : [];

        // 空撃ち対応 (03b:131): 対象不足でも「ことで」コスト以外は使用可能。
        const emptyFire = resolveEmptyFireTargetCounts({
          requiredTargetCount: rawRequiredTargetCount,
          maxTargetCount: effectiveRawMaxTargetCount,
          candidateCount:
            variantRegistration.allowDuplicateTargets === true &&
            candidateTargetInstanceIds.length > 0
              ? Math.max(
                  candidateTargetInstanceIds.length,
                  rawRequiredTargetCount
                )
              : candidateTargetInstanceIds.length,
          gatedByConditionalCost:
            variantRegistration.targetGatedByConditionalCost === true,
          requiresFullCount:
            variantRegistration.targetRequiresFullCount === true,
        });
        if (emptyFire.block) {
          continue;
        }
        const requiredTargetCount = emptyFire.requiredTargetCount;
        const maxTargetCount = emptyFire.maxTargetCount;

        if (
          variantRegistration.actingPlayerLifeCoreChoice &&
          availableChosenLifeCoreKinds.length === 0
        ) {
          continue;
        }

        if (
          !canPayRequiredEffectCosts(
            options.state,
            options.actingPlayerId,
            variantRegistration,
            options.getCardDefinitionById,
            requiredCostSourceTribes,
            cardFilterEvaluationOptions({
              state: options.state,
              getCardDefinitionById: options.getCardDefinitionById,
            }),
            {
              sourceInstanceId: sourceCard.instanceId,
              sourceDefinition,
              sourceDefinitionId: sourceDefinition.cardNo,
              ...(variantRegistration.effectIndex !== undefined
                ? { effectIndex: variantRegistration.effectIndex }
                : {}),
              ...(variantRegistration.preventionLevel !== undefined
                ? {
                    sourcePreventionLevel: variantRegistration.preventionLevel,
                  }
                : {}),
              ...(variantRegistration.targetLockBypass !== undefined
                ? {
                    sourceTargetLockBypass:
                      variantRegistration.targetLockBypass,
                    sourcePreventionBypass:
                      variantRegistration.targetLockBypass,
                  }
                : {}),
            }
          )
        ) {
          continue;
        }

        // D-2 Phase 2 chooser metadata: actingPlayerId は据え置きで chooserPlayerId のみ伝搬
        const magicChooserPlayerId = resolveChooserPlayerId(
          options.state,
          options.actingPlayerId,
          variantRegistration.chooser
        );
        const magicChooserField =
          magicChooserPlayerId !== options.actingPlayerId
            ? { chooserPlayerId: magicChooserPlayerId }
            : {};

        const magicChoiceLabel =
          magicChoiceIndex !== undefined && magicVariants
            ? magicVariants[magicChoiceIndex]!.label
            : undefined;
        const magicChoiceFields =
          magicChoiceIndex !== undefined
            ? {
                choiceIndex: magicChoiceIndex,
                ...(magicChoiceLabel ? { choiceLabel: magicChoiceLabel } : {}),
              }
            : {};
        const magicEffectCostFields = {
          ...(effectiveTargetGroups.length > 0
            ? { targetGroups: effectiveTargetGroups }
            : {}),
          ...(effectiveTargetGroups.length === 0
            ? {
                candidateTargetZones:
                  getCandidateTargetZones(variantRegistration),
              }
            : {}),
          ...(variantRegistration.targetStepId !== undefined
            ? { targetStepId: variantRegistration.targetStepId }
            : {}),
          ...(variantRegistration.allowDuplicateTargets === true
            ? { allowDuplicateTargets: true }
            : {}),
          ...(variantRegistration.requiredPayCostAmount !== undefined
            ? {
                requiredPayCostAmount:
                  variantRegistration.requiredPayCostAmount,
              }
            : {}),
          ...(variantRegistration.requiredCountCostAmount !== undefined
            ? {
                requiredCountCostAmount:
                  variantRegistration.requiredCountCostAmount,
              }
            : {}),
          ...(variantRegistration.requiredCountCostPlayer !== undefined
            ? {
                requiredCountCostPlayer:
                  variantRegistration.requiredCountCostPlayer,
              }
            : {}),
        };

        // 通常コスト版 (paid) — canFullyPay のときのみ push
        if (paymentSources.canFullyPay) {
          legalActions.push({
            kind: "use_magic",
            actionId: createMagicLegalActionId(
              sourceCard.instanceId,
              timing,
              "paid",
              magicChoiceIndex,
              actionRegistration.effectIndex
            ),
            can: true,
            reason: actionRegistration.reason ?? `legal_use_magic_${timing}`,
            actingPlayerId: options.actingPlayerId,
            ...magicChooserField,
            timing,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            sourceCardNo: sourceDefinition.cardNo,
            allowedSourceZones: registrationAllowedZones,
            ...(actionRegistration.effectIndex !== undefined
              ? { effectIndex: actionRegistration.effectIndex }
              : {}),
            ...magicChoiceFields,
            ...magicEffectCostFields,
            targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
            requiredTargetCount,
            ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
            targetEffectFilterTags:
              getTargetEffectFilterTags(variantRegistration),
            candidateTargetInstanceIds,
            availableChosenLifeCoreKinds,
            requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
            reducedCost: paymentSources.reduction.reducedCost,
            additionalCost: paymentSources.reduction.additionalCost,
            finalCost: paymentSources.reduction.finalCost,
            totalReduction: paymentSources.reduction.totalReduction,
            availableReserveCoreAmount:
              paymentSources.reserveSource.availableCoreAmount,
            availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
            availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
            costMode: "paid",
          });
        }

        for (const [
          zoneCostOptionIndex,
          zoneCostOption,
        ] of zoneCostDiscountOptions.entries()) {
          const sharedZoneCostFields = {
            can: true as const,
            actingPlayerId: options.actingPlayerId,
            ...magicChooserField,
            timing,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            sourceCardNo: sourceDefinition.cardNo,
            allowedSourceZones: registrationAllowedZones,
            ...(actionRegistration.effectIndex !== undefined
              ? { effectIndex: actionRegistration.effectIndex }
              : {}),
            ...magicChoiceFields,
            ...magicEffectCostFields,
            targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
            requiredTargetCount,
            ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
            targetEffectFilterTags:
              getTargetEffectFilterTags(variantRegistration),
            candidateTargetInstanceIds,
            availableChosenLifeCoreKinds,
            requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
            reducedCost: zoneCostOption.paymentSources.reduction.reducedCost,
            additionalCost:
              zoneCostOption.paymentSources.reduction.additionalCost,
            finalCost: zoneCostOption.paymentSources.reduction.finalCost,
            totalReduction:
              zoneCostOption.paymentSources.reduction.totalReduction,
            availableReserveCoreAmount:
              zoneCostOption.paymentSources.reserveSource.availableCoreAmount,
            availableOnBoardCoreSources:
              zoneCostOption.paymentSources.onBoardCoreSources,
            availableSoulCoreOnlySources:
              zoneCostOption.paymentSources.soulCoreOnlySources,
          };

          if (zoneCostOption.kind === "exact") {
            legalActions.push({
              kind: "use_magic",
              actionId: createMagicLegalActionId(
                sourceCard.instanceId,
                timing,
                "zone_discount",
                magicChoiceIndex,
                actionRegistration.effectIndex,
                zoneCostOptionIndex
              ),
              reason:
                actionRegistration.reason ??
                `legal_use_magic_${timing}_zone_discount`,
              ...sharedZoneCostFields,
              costMode: "zone_discount",
              zoneCostDiscountAmount: zoneCostOption.modifier.amount,
              zoneCostPaymentCandidateIds:
                zoneCostOption.candidateCardInstanceIds,
              zoneCostPaymentCount: zoneCostOption.count,
            });
            continue;
          }

          legalActions.push({
            kind: "use_magic",
            actionId: createMagicLegalActionId(
              sourceCard.instanceId,
              timing,
              "zone_discount_variable",
              magicChoiceIndex,
              actionRegistration.effectIndex,
              zoneCostOptionIndex
            ),
            reason:
              actionRegistration.reason ??
              `legal_use_magic_${timing}_zone_discount_variable`,
            ...sharedZoneCostFields,
            costMode: "zone_discount_variable",
            zoneCostDiscountPerCard: zoneCostOption.discountPerCard,
            zoneCostPaymentCandidateIds:
              zoneCostOption.candidateCardInstanceIds,
            zoneCostPaymentMaxCount: zoneCostOption.maxCount,
          });
        }

        // 無料使用版 (free) — cost_override CE が適用可能なときに別途 push
        if (canPayFreeCost) {
          legalActions.push({
            kind: "use_magic",
            actionId: createMagicLegalActionId(
              sourceCard.instanceId,
              timing,
              "free",
              magicChoiceIndex,
              actionRegistration.effectIndex
            ),
            can: true,
            reason:
              actionRegistration.reason ?? `legal_use_magic_${timing}_free`,
            actingPlayerId: options.actingPlayerId,
            ...magicChooserField,
            timing,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            sourceCardNo: sourceDefinition.cardNo,
            allowedSourceZones: registrationAllowedZones,
            ...(actionRegistration.effectIndex !== undefined
              ? { effectIndex: actionRegistration.effectIndex }
              : {}),
            ...magicChoiceFields,
            ...magicEffectCostFields,
            targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
            requiredTargetCount,
            ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
            targetEffectFilterTags:
              getTargetEffectFilterTags(variantRegistration),
            candidateTargetInstanceIds,
            availableChosenLifeCoreKinds,
            requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
            reducedCost: 0,
            additionalCost: specialCostAdditionalCost,
            finalCost: freeFinalCost,
            totalReduction: sourceDefinition.cost,
            availableReserveCoreAmount:
              paymentSources.reserveSource.availableCoreAmount,
            availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
            availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
            costMode: "free",
            ...(freeUseSource.sourceInstanceId
              ? { costOverrideSourceInstanceId: freeUseSource.sourceInstanceId }
              : {}),
          });
        }

        // 上書きコスト版 (override) — cost_override CE (amount>0) が適用可能で
        // 上書きコスト分を支払えるときに別途 push (P2-05 Phase 4a)
        if (costOverrideSource !== null && canPayOverrideCost) {
          legalActions.push({
            kind: "use_magic",
            actionId: createMagicLegalActionId(
              sourceCard.instanceId,
              timing,
              "override",
              magicChoiceIndex,
              actionRegistration.effectIndex
            ),
            can: true,
            reason:
              actionRegistration.reason ?? `legal_use_magic_${timing}_override`,
            actingPlayerId: options.actingPlayerId,
            ...magicChooserField,
            timing,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            sourceCardNo: sourceDefinition.cardNo,
            allowedSourceZones: registrationAllowedZones,
            ...(actionRegistration.effectIndex !== undefined
              ? { effectIndex: actionRegistration.effectIndex }
              : {}),
            ...magicChoiceFields,
            ...magicEffectCostFields,
            targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
            requiredTargetCount,
            ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
            targetEffectFilterTags:
              getTargetEffectFilterTags(variantRegistration),
            candidateTargetInstanceIds,
            availableChosenLifeCoreKinds,
            requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
            reducedCost: costOverrideSource.overrideCost,
            additionalCost: specialCostAdditionalCost,
            finalCost: overrideFinalCost,
            totalReduction: Math.max(
              0,
              sourceDefinition.cost - costOverrideSource.overrideCost
            ),
            availableReserveCoreAmount:
              paymentSources.reserveSource.availableCoreAmount,
            availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
            availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
            costMode: "override",
            overrideCost: costOverrideSource.overrideCost,
            costOverrideSourceInstanceId: costOverrideSource.sourceInstanceId,
            ...(costOverrideSource.usageLimit
              ? { costOverrideUsageLimit: costOverrideSource.usageLimit }
              : {}),
            ...(costOverrideSource.limitGroupId
              ? { costOverrideLimitGroupId: costOverrideSource.limitGroupId }
              : {}),
            ...(costOverrideSource.effectLabel
              ? { costOverrideEffectLabel: costOverrideSource.effectLabel }
              : {}),
          });
        }
      } // end for magicChoiceIndex
    } // end for actionRegistration
  } // end for sourceCard

  return legalActions;
}

/**
 * engine-hand-self-card-main-end-activation-timing: 手札/手元の magic に
 * `timingScope.subPhase === "end"`（「メインステップ終了時に使用できる」型）の登録が
 * あり、かつ他の全ゲートを満たして実際に使用可能になるかを判定する。
 * turn-system.ts の advanceStep がステップを離れる直前にこれを呼び、真なら
 * （通常の triggered reaction pending と同様に）`window: "step_end"` で一旦停止して
 * プレイヤーに使用機会を与える。BSTH02.7-C01 effects[1] が初出。
 *
 * まず対象カードが `timingScope.subPhase === "end"` の登録を持つかどうかだけを安価に
 * 判定し（該当ゼロなら早期return、大半のゲームで毎ステップこの経路を素通りする）、
 * 候補がある場合のみ `getAvailableMagicLegalActions` を `window: "step_end"` で probe して
 * 残り全ゲート（condition/usageLimit/payment 等）を SSOT のまま再利用する。
 */
export function hasEligibleMainStepEndMagicActivation(
  options: Pick<
    GetLegalActionsOptions,
    | "state"
    | "actingPlayerId"
    | "getCardDefinitionById"
    | "getRegisteredFieldCardEffectActions"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredMagicActions"
  >
): boolean {
  const getRegisteredMagicActions = options.getRegisteredMagicActions;
  if (!getRegisteredMagicActions) return false;

  const handCards = getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  const setAsideCards = getCardsByZone(options.state, "set_aside");
  const sourceCards = [...handCards, ...setAsideCards].filter(
    (c) => c.controllerPlayerId === options.actingPlayerId
  );

  const candidateCardNos = new Set<string>();
  for (const sourceCard of sourceCards) {
    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    if (
      !sourceDefinition ||
      !isMagicLikeCardForm(sourceCard, sourceDefinition)
    ) {
      continue;
    }
    const registrations = getRegisteredMagicActions(sourceDefinition.cardNo);
    if (registrations?.some((r) => r.timingScope?.subPhase === "end")) {
      candidateCardNos.add(sourceDefinition.cardNo);
    }
  }
  if (candidateCardNos.size === 0) return false;

  const probeState: GameState = { ...options.state, window: "step_end" };
  const actions = getAvailableMagicLegalActions({
    ...options,
    state: probeState,
  });
  return actions.some((a) => candidateCardNos.has(a.sourceCardNo));
}

export function getAvailableHandCardLegalActions(
  options: GetLegalActionsOptions
): Array<SummonLegalAction | PlaceNexusLegalAction> {
  if (!canEnumerateMainHandCardActions(options.state, options.actingPlayerId)) {
    return [];
  }

  const legalActions: Array<SummonLegalAction | PlaceNexusLegalAction> = [];

  // 手札 + 手元ゾーンの両方から召喚/配置可能カードを列挙
  const handCards = getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  const setAsideCards = getCardsByZone(options.state, "set_aside");
  const sourceCards =
    handCards.length > 0 && setAsideCards.length > 0
      ? [...handCards, ...setAsideCards]
      : handCards.length > 0
        ? handCards
        : setAsideCards;

  for (const sourceCard of sourceCards) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
      continue;
    }

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition) {
      continue;
    }

    const actionKind = getHandCardLegalActionKind(sourceDefinition);

    if (actionKind === null) {
      continue;
    }

    // 召喚条件 / 転召 / restrict_use / field_name_uniqueness CE チェック。
    // 「待機状態を含まない自分の同名スピリットはフィールドに1体しか存在できない」
    // ため、静的な同名 1 体が既に自フィールドにいれば新規召喚を提示しない。
    // 待機状態の既存個体は除外＝場唯一性バイパス。
    if (
      evaluateSummonDeclarationGate({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        card: sourceCard,
        definition: sourceDefinition,
        actionKind: actionKind === "place_nexus" ? "place_nexus" : "summon",
        getCardDefinitionById: options.getCardDefinitionById,
        evaluateCondition,
      }).kind !== "allowed"
    ) {
      continue;
    }

    const actionRegistration = options.getRegisteredHandCardEffectActions?.(
      sourceDefinition.cardNo
    );
    const enterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy({
      card: sourceCard,
      definition: sourceDefinition,
    });
    // ブレイヴ召喚: 合体先がフィールドにあれば、合体すれば場入りコアは 0 で足りる
    // (`05_brave-and-attack-special-cases.md`「個数不問、置かなくてもよい」)。合体先が
    // なければスピリット状態のみで Lv1 必須。affordability も最小コアもこの最小側で扱う
    // (合体可否・コア配置の確定はスタック窓クローズ後の解決時)。
    let effectiveMinPlacement = enterFieldCorePlacementPolicy.minimumCoreCount;
    if (
      sourceDefinition.printedCategory === "brave" &&
      effectiveMinPlacement > 0 &&
      getValidBraveCombineHosts(
        options.state,
        sourceDefinition,
        options.actingPlayerId,
        options.getCardDefinitionById,
        sourceCard.instanceId
      ).length > 0
    ) {
      effectiveMinPlacement = 0;
    }
    const requiredTargetCount = actionRegistration
      ? getResolvedRequiredTargetCount(
          options.state,
          options.actingPlayerId,
          sourceCard.instanceId,
          actionRegistration,
          options.getCardDefinitionById
        )
      : getRequiredTargetCount({});
    const maxTargetCount = actionRegistration
      ? getResolvedMaxTargetCount(
          options.state,
          options.actingPlayerId,
          sourceCard.instanceId,
          actionRegistration,
          options.getCardDefinitionById
        )
      : getMaxTargetCount({});
    const needsCandidates = requiredTargetCount > 0 || maxTargetCount > 0;
    const candidateTargetInstanceIds =
      !needsCandidates || !actionRegistration
        ? []
        : getCandidateTargetInstanceIds(
            options.state,
            options.actingPlayerId,
            actionRegistration,
            candidateTargetOptions(options, sourceCard.instanceId)
          );
    const availableChosenLifeCoreKinds =
      actionRegistration && actionRegistration.actingPlayerLifeCoreChoice
        ? getAvailableChosenLifeCoreKinds({
            state: options.state,
            actingPlayerId: options.actingPlayerId,
            sourceInstanceId: sourceCard.instanceId,
            actionRegistration,
            candidateTargetInstanceIds,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        : [];

    const paymentSources = getAvailableCardCostPaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      card: sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
      sourceInstanceId: sourceCard.instanceId,
      useKind: actionKind,
    });

    if (!paymentSources.canFullyPay) {
      continue;
    }

    // 直後コア配置 (manual/ai-reference/10_rules/03a_cost-payment.md:58):
    // 配置コアはリザーブ／フィールドのカード上のいずれからも拠出できる。
    // フィールドのスピリットはコアを 0 にすれば消滅するが、それ自体はルール上許容。
    // よって合算で「コスト + 配置分」を満たせるかだけを判定する。
    // BSLH01-T13 grant_summon_trash_core_placement: 召喚(place_nexus は対象外)のとき
    // トラッシュも配置元として使える許可があれば、その amount も合算に含める
    // (未算入だと reserve/field だけで賄えない CB スピリット召喚が summon action
    // 候補自体として一切列挙されず、grant の存在意義が失われる)。
    if (effectiveMinPlacement > 0) {
      const fieldCoreTotal = paymentSources.onBoardCoreSources.reduce(
        (sum, s) => sum + s.availableCoreAmount,
        0
      );
      const trashGrantAmount =
        actionKind === "summon"
          ? (getSummonTrashCorePlacementGrant(
              options.state,
              options.actingPlayerId,
              sourceDefinition
            )?.amount ?? 0)
          : 0;
      if (
        paymentSources.reserveSource.availableCoreAmount +
          fieldCoreTotal +
          trashGrantAmount <
        paymentSources.reduction.finalCost + effectiveMinPlacement
      ) {
        continue;
      }
    }

    // 【転召】は維持コア配置より先に対象の通常コアを全て送る。
    // generic な cost + placement 合算を通っても、その対象の残コアを配置に
    // 二重計上すると、解決後に入力不能な pendingEnterFieldPlacement が残る。
    if (
      actionKind === "summon" &&
      !canSatisfyTenshoSummonCostAndPlacement({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        definition: sourceDefinition,
        getCardDefinitionById: options.getCardDefinitionById,
        paymentSources,
        finalCost: paymentSources.reduction.finalCost,
        minPlacement: effectiveMinPlacement,
      })
    ) {
      continue;
    }

    if (candidateTargetInstanceIds.length < requiredTargetCount) {
      continue;
    }

    if (
      actionRegistration?.actingPlayerLifeCoreChoice &&
      availableChosenLifeCoreKinds.length === 0
    ) {
      continue;
    }

    const targetEffectFilterTags = actionRegistration
      ? getTargetEffectFilterTags(actionRegistration)
      : (["general"] as const);

    // D-2 Phase 2 chooser metadata: actingPlayerId は据え置きで chooserPlayerId のみ伝搬
    const handCardChooserPlayerId = resolveChooserPlayerId(
      options.state,
      options.actingPlayerId,
      actionRegistration?.chooser
    );
    const handCardChooserField =
      handCardChooserPlayerId !== options.actingPlayerId
        ? { chooserPlayerId: handCardChooserPlayerId }
        : {};

    const actionBase = {
      actionId: createHandCardLegalActionId(actionKind, sourceCard.instanceId),
      can: true as const,
      reason:
        actionRegistration?.reason ??
        (actionKind === "summon" ? "legal_summon" : "legal_place_nexus"),
      actingPlayerId: options.actingPlayerId,
      ...handCardChooserField,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: sourceDefinition.cardNo,
      targetMode: getTargetMode(requiredTargetCount, maxTargetCount),
      requiredTargetCount,
      ...(maxTargetCount > requiredTargetCount ? { maxTargetCount } : {}),
      targetEffectFilterTags,
      candidateTargetInstanceIds,
      availableChosenLifeCoreKinds,
      requiresChosenLifeCoreKind: availableChosenLifeCoreKinds.length > 1,
      reducedCost: paymentSources.reduction.reducedCost,
      additionalCost: paymentSources.reduction.additionalCost,
      finalCost: paymentSources.reduction.finalCost,
      totalReduction: paymentSources.reduction.totalReduction,
      availableReserveCoreAmount:
        paymentSources.reserveSource.availableCoreAmount,
      availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
      availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
      enterFieldCorePlacementRule: enterFieldCorePlacementPolicy.rule,
      maximumEnterFieldCoreCount:
        enterFieldCorePlacementPolicy.maximumCoreCount,
    };

    if (actionKind === "summon") {
      // 召喚コスト『トラッシュ○枚まで除外、1枚につきコスト-N』(BSTH02.7-M01 effects[0] 等)。
      // 候補が存在する間は通常の summon action の代わりに opensCostExcludeChoice 版を返す
      // (pendingDrawStepCostChoice と同型: 0 枚選択 = 辞退相当で通常コスト召喚に帰着する)。
      const costExcludeOptionRaw = getSummonCostExcludeChoiceOption(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById
      );
      // 必須除外 (minCount>0) は、この汎用通常召喚経路には一切提示しない
      // (engine-alt-cost-summon-multizone, adversarial verifier round2 で是正)。
      // 「合体中の鍵ブレイヴを除外して召喚コストを支払ったものとして扱う」は
      // 本来コストでの通常召喚に取って代わるものではなく、あくまで別の代替手段
      // (getAvailableHandSummonPermissionLegalActions の許可 effect 経由) として
      // 並立提示すべき。ここで mandatory オプションを拾うと、候補(合体中の鍵ブレイヴ)が
      // 存在する間 else 分岐の通常コスト summon action が消え、除外したくないプレイヤーが
      // 印字コストのまま召喚する手段を失う（minCount>0 の pending は 0 枚選択を許さず
      // resolveSummonCostExcludeChoiceSelection が throw するため辞退もできない）。
      const costExcludeOption =
        costExcludeOptionRaw && costExcludeOptionRaw.minCount > 0
          ? undefined
          : costExcludeOptionRaw;
      // 召喚コスト『トラッシュのコアN個以上をフィールド/リザーブに置くことで、コストを
      // 支払わずに召喚する』(BSSL01-M02 effects[0,1])。常に必須支払い (minCount>0) のため、
      // exclude と同じ理由でこの汎用通常召喚経路には一切提示しない（許可 effect 経由の
      // getAvailableHandSummonPermissionLegalActions のみが opensCostCoreMoveChoice を出す）。
      const costCoreMoveOptionRaw = getSummonCostCoreMoveChoiceOption(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById
      );
      const costCoreMoveOption =
        costCoreMoveOptionRaw && costCoreMoveOptionRaw.minCount > 0
          ? undefined
          : costCoreMoveOptionRaw;
      if (costCoreMoveOption) {
        legalActions.push({
          ...actionBase,
          actionId: `legal:summon:${sourceCard.instanceId}:cost-core-move-choice`,
          kind: "summon",
          minimumRequiredCores:
            getMinimumRequiredCoresFromDefinition(sourceDefinition),
          minimumEnterFieldCoreCount: effectiveMinPlacement,
          requiresEnterFieldCorePlacements: effectiveMinPlacement > 0,
          opensCostCoreMoveChoice: true,
          costCoreMoveEffectIndex: costCoreMoveOption.effectIndex,
          costCoreMoveMinCount: costCoreMoveOption.minCount,
          costCoreMoveAvailableCoreCount: costCoreMoveOption.availableCoreCount,
          costCoreMoveOffset: costCoreMoveOption.costOffset,
          ...(costCoreMoveOption.grantsFreeSummon
            ? { costCoreMoveGrantsFreeSummon: true }
            : {}),
          costCoreMoveFieldDestinationCandidateInstanceIds:
            costCoreMoveOption.fieldDestinationCandidateInstanceIds,
        });
        continue;
      }
      if (costExcludeOption) {
        legalActions.push({
          ...actionBase,
          actionId: `legal:summon:${sourceCard.instanceId}:cost-exclude-choice`,
          kind: "summon",
          minimumRequiredCores:
            getMinimumRequiredCoresFromDefinition(sourceDefinition),
          minimumEnterFieldCoreCount: effectiveMinPlacement,
          requiresEnterFieldCorePlacements: effectiveMinPlacement > 0,
          opensCostExcludeChoice: true,
          costExcludeEffectIndex: costExcludeOption.effectIndex,
          costExcludeMaxCount: costExcludeOption.maxCount,
          costExcludeDiscountPerCard: costExcludeOption.discountPerCard,
          ...(costExcludeOption.fullCostPaid
            ? { costExcludeFullCostPaid: true }
            : {}),
          costExcludeSourceZone: costExcludeOption.sourceZone,
          costExcludeMinCount: costExcludeOption.minCount,
          costExcludeCandidateInstanceIds:
            costExcludeOption.candidateCardInstanceIds,
          ...(costExcludeOption.fullReduction
            ? { costExcludeFullReduction: true }
            : {}),
        });
        continue;
      }

      legalActions.push({
        ...actionBase,
        kind: "summon",
        minimumRequiredCores:
          getMinimumRequiredCoresFromDefinition(sourceDefinition),
        minimumEnterFieldCoreCount: effectiveMinPlacement,
        requiresEnterFieldCorePlacements: effectiveMinPlacement > 0,
      });
      continue;
    }

    legalActions.push({
      ...actionBase,
      kind: "place_nexus",
      minimumEnterFieldCoreCount:
        enterFieldCorePlacementPolicy.minimumCoreCount,
      requiresEnterFieldCorePlacements:
        enterFieldCorePlacementPolicy.minimumCoreCount > 0,
    });
  }

  return legalActions;
}

export function getAvailableSetBurstLegalActions(
  options: GetLegalActionsOptions
): SetBurstLegalAction[] {
  if (!canEnumerateMainHandCardActions(options.state, options.actingPlayerId)) {
    return [];
  }

  const legalActions: SetBurstLegalAction[] = [];

  for (const sourceCard of getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  )) {
    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition) {
      continue;
    }

    const blockReason = getBurstSetBlockReason({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });

    if (blockReason !== null) {
      continue;
    }

    legalActions.push({
      kind: "set_burst",
      actionId: createSetBurstLegalActionId(sourceCard.instanceId),
      can: true,
      reason: "legal_set_burst",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: sourceDefinition.cardNo,
      replacedBurstInstanceId:
        getReplaceableBurstSetState(options.state, options.actingPlayerId)
          ?.cardInstanceId ?? null,
    });
  }

  return legalActions;
}

export function getAvailableSetMirageLegalActions(
  options: GetLegalActionsOptions
): SetMirageLegalAction[] {
  if (!canEnumerateMainHandCardActions(options.state, options.actingPlayerId)) {
    return [];
  }

  const legalActions: SetMirageLegalAction[] = [];

  const candidateCards = [
    ...getOwnHandCards(
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById
    ),
    ...getCardsByZone(options.state, "trash"),
  ];

  for (const sourceCard of candidateCards) {
    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition?.mirageData) {
      continue;
    }

    if (
      sourceCard.zone === "trash" &&
      !sourceDefinition.mirageData.canSetFromTrash
    ) {
      continue;
    }

    if (
      isCardUseRestricted(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById,
        "set_mirage"
      )
    ) {
      continue;
    }

    const blockReason = getMirageSetBlockReason({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });

    if (blockReason !== null) {
      continue;
    }

    // コスト支払い可能か確認
    const paymentSources = getAvailableMiragePaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      mirageData: sourceDefinition.mirageData,
      sourceInstanceId: sourceCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });

    if (!paymentSources.canFullyPay) {
      continue;
    }

    for (const replacedMirageInstanceIds of getMirageReplacementChoices({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    })) {
      legalActions.push({
        kind: "set_mirage",
        actionId: createSetMirageLegalActionId(
          sourceCard.instanceId,
          replacedMirageInstanceIds
        ),
        can: true,
        reason: "legal_set_mirage",
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceCard.definitionId,
        sourceCardNo: sourceDefinition.cardNo,
        replacedMirageInstanceIds,
        mirageCost: sourceDefinition.mirageData.cost,
        mirageReduction: sourceDefinition.mirageData.reduction,
        finalCost: paymentSources.reduction.finalCost,
        availableReserveCoreAmount:
          paymentSources.reserveSource.availableCoreAmount,
        availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
        availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
      });
    }
  }

  return legalActions;
}

export function getAvailableSetQuartzLegalActions(
  options: GetLegalActionsOptions
): SetQuartzLegalAction[] {
  if (!canEnumerateMainHandCardActions(options.state, options.actingPlayerId)) {
    return [];
  }

  const legalActions: SetQuartzLegalAction[] = [];
  const hosts = getEligibleQuartzHosts(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  if (hosts.length === 0) return legalActions;

  for (const sourceCard of getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  )) {
    // Hand cards share the global cardInstances collection; only the acting
    // player can declare a quartz set from a card they control.
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) continue;
    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    const quartzData = sourceDefinition?.quartzData;
    if (!quartzData) continue;

    const countCost = quartzData.countCost ?? 0;
    if (
      !canPayQuartzCountCost(options.state, options.actingPlayerId, countCost)
    ) {
      continue;
    }

    for (const {
      hostInstanceId,
      slot,
      replacedQuartzInstanceId,
    } of getQuartzPlacements(
      options.state,
      options.actingPlayerId,
      sourceCard.instanceId,
      options.getCardDefinitionById
    )) {
      legalActions.push({
        kind: "set_quartz",
        actionId: createSetQuartzLegalActionId(
          sourceCard.instanceId,
          hostInstanceId,
          slot,
          replacedQuartzInstanceId
        ),
        can: true,
        reason: "legal_set_quartz",
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceCard.definitionId,
        sourceCardNo: sourceDefinition.cardNo,
        hostInstanceId,
        hostCardNo: options.getCardDefinitionById(
          options.state.cardInstances.find(
            (c) => c.instanceId === hostInstanceId
          )!.definitionId
        )!.cardNo,
        slot,
        ...(replacedQuartzInstanceId !== undefined
          ? {
              replacedQuartzInstanceId,
              replacedQuartzName:
                getQuartzName(
                  options.state,
                  replacedQuartzInstanceId,
                  options.getCardDefinitionById
                ) ?? replacedQuartzInstanceId,
            }
          : {}),
        quartzCountCost: countCost,
      });
    }
  }

  return legalActions;
}

/**
 * 魂状態化アクション（activate_soul_state）を legal action として列挙する。
 * 自分のメインステップ中、手札/手元(set_aside)の契約/魂状態カードを field へ移動して魂状態化する。
 * 各カードは自身がいるゾーンに対応する applicability.zone を持つ effect を引く（hand/set_aside）。
 */
export function getAvailableActivateSoulStateLegalActions(
  options: GetLegalActionsOptions
): ActivateSoulStateLegalAction[] {
  if (!canEnumerateMainHandCardActions(options.state, options.actingPlayerId)) {
    return [];
  }
  const legalActions: ActivateSoulStateLegalAction[] = [];
  const handCards = getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  );
  const setAsideCards = getCardsByZone(options.state, "set_aside");
  for (const sourceCard of [...handCards, ...setAsideCards]) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) continue;
    const def = options.getCardDefinitionById(sourceCard.definitionId);
    if (!def) continue;
    const sourceZone: "hand" | "set_aside" =
      sourceCard.zone === "set_aside" ? "set_aside" : "hand";
    const effectIndex = getSoulStateActivationEffectIndex(def, sourceZone);
    if (effectIndex === null) continue;
    legalActions.push({
      kind: "activate_soul_state",
      actionId: createActivateSoulStateLegalActionId(
        sourceCard.instanceId,
        effectIndex
      ),
      can: true,
      reason: "legal_activate_soul_state",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: def.cardNo,
      effectIndex,
    });
  }
  return legalActions;
}

export function getAvailablePassStackLegalActions(
  options: GetLegalActionsOptions
): PassStackLegalAction[] {
  const win = options.state.stackWindow;

  if (
    !win ||
    options.state.window !== "stack" ||
    win.priorityPlayerId !== options.actingPlayerId
  ) {
    return [];
  }

  return [
    {
      kind: "pass_stack",
      actionId: createPassStackLegalActionId(options.actingPlayerId),
      can: true,
      reason: "legal_pass_stack",
      actingPlayerId: options.actingPlayerId,
    },
  ];
}

export function getAvailablePassPreDeclarationStackLegalActions(
  options: GetLegalActionsOptions
): PassPreDeclarationStackLegalAction[] {
  const win = options.state.preDeclarationStackWindow;

  if (
    !win ||
    options.state.window !== "pre_declaration_stack" ||
    win.priorityPlayerId !== options.actingPlayerId
  ) {
    return [];
  }

  return [
    {
      kind: "pass_pre_declaration_stack",
      actionId: createPassPreDeclarationStackLegalActionId(
        win.kind,
        options.actingPlayerId
      ),
      can: true,
      reason: `legal_pass_pre_declaration_stack_${win.kind}`,
      actingPlayerId: options.actingPlayerId,
      declarationKind: win.kind,
    },
  ];
}

export function getAvailableAttackLegalActions(
  options: GetLegalActionsOptions
): AttackLegalAction[] {
  if (options.state.preDeclarationStackWindow !== null) {
    return [];
  }

  // 先攻1ターン目はアタック不可
  if (
    options.state.turnNumber === 1 &&
    options.state.activePlayerId === options.state.playerOrder[0]
  ) {
    return [];
  }

  const legalActions: AttackLegalAction[] = [];

  // 同時アタック許可 (P2-05): grant が有効なら、filter に合致する
  // アタック宣言可能カードの一覧を先に集める (candidates 計算用)。
  const simulGrant = getSimultaneousAttackGrant(
    options.state,
    options.actingPlayerId
  );
  const simulEligibleInstanceIds: string[] = [];
  if (simulGrant !== null) {
    for (const card of getCardsByZone(options.state, "field")) {
      const def = options.getCardDefinitionById(card.definitionId);
      if (
        !def ||
        !matchesCardFilter(card, def, simulGrant.filter, {
          ...cardFilterEvaluationOptions(options),
          state: options.state,
          effectiveColors: getEffectiveColors(options.state, card, def),
          effectiveBp: getCombinedUnitBp(
            options.state,
            card,
            def,
            options.getCardDefinitionById
          ),
          coreCount: getTotalCoresOnCardById(options.state, card.instanceId),
          effectiveLevel: getEffectiveLevel(
            options.state,
            card,
            def,
            options.getCardDefinitionById
          ),
          effectiveSymbolCount: getCombinedUnitSymbolCount(
            options.state,
            card,
            def,
            options.getCardDefinitionById
          ),
        })
      )
        continue;
      if (
        getAttackDeclarationBlockReason({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: card.instanceId,
          getCardDefinitionById: options.getCardDefinitionById,
        }) !== null
      ) {
        continue;
      }
      simulEligibleInstanceIds.push(card.instanceId);
    }
  }

  for (const sourceCard of getCardsByZone(options.state, "field")) {
    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition) {
      continue;
    }

    const blockReason = getAttackDeclarationBlockReason({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });

    if (blockReason !== null) {
      continue;
    }

    // 同時アタックオプション: 自身が filter 合致 + 合流候補が他に1体以上
    const simulCandidateIds =
      simulGrant !== null &&
      simulEligibleInstanceIds.includes(sourceCard.instanceId)
        ? simulEligibleInstanceIds.filter((id) => id !== sourceCard.instanceId)
        : [];

    const attackCostChoices = getAttackExhaustCostChoices(
      options.state,
      sourceCard,
      options.getCardDefinitionById
    );
    const attackDestroyCostChoices = getBattleDestroyCostChoices(
      options.state,
      sourceCard,
      options.getCardDefinitionById,
      ["battle_destroy_cost_gate_attack", "battle_destroy_cost_gate_both"]
    );

    for (const attackExhaustCostSourceInstanceIds of attackCostChoices) {
      for (const battleDestroyCostSourceInstanceIds of attackDestroyCostChoices) {
        const baseActionId = createAttackLegalActionId(sourceCard.instanceId);
        legalActions.push({
          kind: "attack",
          actionId: `${baseActionId}${attackExhaustCostActionSuffix(
            attackExhaustCostSourceInstanceIds
          )}${battleDestroyCostActionSuffix(battleDestroyCostSourceInstanceIds)}`,
          can: true,
          reason: "legal_attack_declaration",
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          sourceCardNo: sourceDefinition.cardNo,
          battleEntityId: getAttackEntityId(
            options.state,
            sourceCard.instanceId
          ),
          ...attackExhaustCostActionProps(attackExhaustCostSourceInstanceIds),
          ...battleDestroyCostActionProps(battleDestroyCostSourceInstanceIds),
          ...(simulGrant !== null && simulCandidateIds.length > 0
            ? {
                simultaneousAttackOption: {
                  candidateInstanceIds: simulCandidateIds,
                  maxCount: simulGrant.maxCount,
                  grantSourceInstanceId: simulGrant.sourceInstanceId,
                },
              }
            : {}),
        });
      }
    }

    // 指定アタック: 各相手スピリット/アルティメットを対象に1件ずつ生成
    for (const targetCard of getCardsByZone(options.state, "field")) {
      if (
        targetCard.pendingLeaveKind !== null ||
        targetCard.attachedToInstanceId !== null ||
        targetCard.controllerPlayerId === options.actingPlayerId
      ) {
        continue;
      }

      const targetDefinition = options.getCardDefinitionById(
        targetCard.definitionId
      );

      if (
        !targetDefinition ||
        !isDesignatedAttackTargetLegal(
          options.state,
          targetCard,
          options.getCardDefinitionById,
          sourceCard
        )
      ) {
        continue;
      }

      for (const attackExhaustCostSourceInstanceIds of attackCostChoices) {
        for (const battleDestroyCostSourceInstanceIds of attackDestroyCostChoices) {
          const baseActionId = createSpiritTargetAttackLegalActionId(
            sourceCard.instanceId,
            targetCard.instanceId
          );
          legalActions.push({
            kind: "attack",
            actionId: `${baseActionId}${attackExhaustCostActionSuffix(
              attackExhaustCostSourceInstanceIds
            )}${battleDestroyCostActionSuffix(
              battleDestroyCostSourceInstanceIds
            )}`,
            can: true,
            reason: "legal_attack_declaration_spirit_target",
            actingPlayerId: options.actingPlayerId,
            sourceInstanceId: sourceCard.instanceId,
            sourceDefinitionId: sourceCard.definitionId,
            sourceCardNo: sourceDefinition.cardNo,
            battleEntityId: getAttackEntityId(
              options.state,
              sourceCard.instanceId
            ),
            targetInstanceId: targetCard.instanceId,
            ...attackExhaustCostActionProps(attackExhaustCostSourceInstanceIds),
            ...battleDestroyCostActionProps(battleDestroyCostSourceInstanceIds),
          });
        }
      }
    }
  }

  return legalActions;
}

/**
 * アタック宣言の代替宣言 (BSDB01-TX01(A) 型、CardDefinition.attackAlternativeFlip)。
 * `attack` と同じ legality (`getAttackDeclarationBlockReason`) が通るフィールド上の
 * カードのうち、`attackAlternativeFlip` を持つものだけに1件ずつ生成する。対象・
 * コスト源選択を伴わないカード本文のため、`getAvailableAttackLegalActions` と異なり
 * 同時アタック/指定アタック/疲労コスト等の分岐は不要。
 */
export function getAvailableFlipInsteadOfAttackLegalActions(
  options: GetLegalActionsOptions
): FlipInsteadOfAttackLegalAction[] {
  if (options.state.preDeclarationStackWindow !== null) {
    return [];
  }

  // 先攻1ターン目はアタック不可 (getAvailableAttackLegalActions と同じガード。
  // getAttackDeclarationBlockReason 自体はこのチェックを持たないため、attack と
  // legality を共有する代替宣言側でも複製する必要がある。adversarial verifier
  // 2026-07-30 refute: このガード漏れで先攻1ターン目に flip_instead_of_attack が
  // 誤って合法生成されうる)。
  if (
    options.state.turnNumber === 1 &&
    options.state.activePlayerId === options.state.playerOrder[0]
  ) {
    return [];
  }

  const legalActions: FlipInsteadOfAttackLegalAction[] = [];

  for (const sourceCard of getCardsByZone(options.state, "field")) {
    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition?.attackAlternativeFlip) {
      continue;
    }

    if (
      getAttackDeclarationBlockReason({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: sourceCard.instanceId,
        getCardDefinitionById: options.getCardDefinitionById,
      }) !== null
    ) {
      continue;
    }

    legalActions.push({
      kind: "flip_instead_of_attack",
      actionId: `legal:flip_instead_of_attack:${sourceCard.instanceId}`,
      can: true,
      reason: "legal_attack_alternative_flip",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: sourceDefinition.cardNo,
    });
  }

  return legalActions;
}

/**
 * 「相手のブロック宣言前」ウィンドウ (block 未宣言) 一覧。before_block flash 窓
 * (開通前/開通中/内側スタック窓) を含む declare_attack〜declare_block 手前まで。
 */
const BEFORE_BLOCK_DECLARED_WINDOWS: ReadonlySet<import("../model").Window> =
  new Set(["declare_attack", "flash_before_block", "stack_before_block"]);

/**
 * 途中合流アタック宣言 (P2-05 Phase 5, BSTH07.8-XX01【導域】)。allow_mid_battle_join CE
 * が有効で、召喚直後の参加機会 (pendingImmediateAttackJoins) が残っている
 * grant.filter に合致するカードが、進行中のアタックへ「相手のブロック宣言前」
 * (block 未宣言。declare_attack〜flash_before_block/stack_before_block) ならただちに合流できる。
 */
export function getAvailableJoinActiveAttackLegalActions(
  options: GetLegalActionsOptions
): JoinActiveAttackLegalAction[] {
  if (options.state.preDeclarationStackWindow !== null) {
    return [];
  }
  if (!BEFORE_BLOCK_DECLARED_WINDOWS.has(options.state.window)) {
    return [];
  }
  const activeAttack = options.state.activeAttack;
  if (activeAttack === null) {
    return [];
  }
  const grant = getMidBattleJoinGrant(options.state, options.actingPlayerId);
  if (grant === null) {
    return [];
  }
  if (
    activeAttack.blockDeclarationCompleted ||
    activeAttack.flashAfterBlockCompleted ||
    activeAttack.blockAssignments.some(
      (assignment) => assignment.blockedByEntityIds.length > 0
    )
  )
    return [];
  const summonedIds = options.state.pendingImmediateAttackJoins
    ?.filter((entry) => entry.attackId === activeAttack.attackId)
    .map((entry) => entry.sourceInstanceId);
  if (!summonedIds || summonedIds.length === 0) {
    return [];
  }
  const summonedIdSet = new Set(summonedIds);

  const legalActions: JoinActiveAttackLegalAction[] = [];
  for (const card of getCardsByZone(options.state, "field")) {
    if (!summonedIdSet.has(card.instanceId)) continue;
    if (card.controllerPlayerId !== options.actingPlayerId) continue;

    const def = options.getCardDefinitionById(card.definitionId);
    if (!def) continue;

    if (
      !matchesCardFilter(card, def, grant.filter, {
        ...cardFilterEvaluationOptions(options),
        state: options.state,
        effectiveColors: getEffectiveColors(options.state, card, def),
        effectiveBp: getCombinedUnitBp(
          options.state,
          card,
          def,
          options.getCardDefinitionById
        ),
        coreCount: getTotalCoresOnCardById(options.state, card.instanceId),
        effectiveLevel: getEffectiveLevel(
          options.state,
          card,
          def,
          options.getCardDefinitionById
        ),
        effectiveSymbolCount: getCombinedUnitSymbolCount(
          options.state,
          card,
          def,
          options.getCardDefinitionById
        ),
      })
    ) {
      continue;
    }

    if (
      getJoinActiveAttackBlockReason({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: card.instanceId,
        getCardDefinitionById: options.getCardDefinitionById,
      }) !== null
    ) {
      continue;
    }

    const attackCostChoices = getAttackExhaustCostChoices(
      options.state,
      card,
      options.getCardDefinitionById
    );
    const attackDestroyCostChoices = getBattleDestroyCostChoices(
      options.state,
      card,
      options.getCardDefinitionById,
      ["battle_destroy_cost_gate_attack", "battle_destroy_cost_gate_both"]
    );
    for (const attackExhaustCostSourceInstanceIds of attackCostChoices) {
      for (const battleDestroyCostSourceInstanceIds of attackDestroyCostChoices) {
        const baseActionId = createJoinActiveAttackLegalActionId(
          card.instanceId,
          activeAttack.attackId
        );
        legalActions.push({
          kind: "join_active_attack",
          actionId: `${baseActionId}${attackExhaustCostActionSuffix(
            attackExhaustCostSourceInstanceIds
          )}${battleDestroyCostActionSuffix(
            battleDestroyCostSourceInstanceIds
          )}`,
          can: true,
          reason: "legal_join_active_attack",
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: card.instanceId,
          sourceDefinitionId: card.definitionId,
          sourceCardNo: def.cardNo,
          attackId: activeAttack.attackId,
          grantSourceInstanceId: grant.sourceInstanceId,
          ...attackExhaustCostActionProps(attackExhaustCostSourceInstanceIds),
          ...battleDestroyCostActionProps(battleDestroyCostSourceInstanceIds),
        });
      }
    }
  }
  return legalActions;
}

export function getAvailableBlockLegalActions(
  options: GetLegalActionsOptions
): BlockLegalAction[] {
  if (options.state.preDeclarationStackWindow !== null) {
    return [];
  }

  const activeAttack = options.state.activeAttack;

  if (activeAttack === null) {
    return [];
  }

  const legalActions: BlockLegalAction[] = [];
  // P2-05 Phase 5: 複数体ブロック強制 (requiredBlockerCount) 未達の participant も
  // 「まだブロック宣言できる」候補に含める (2体目以降の declare_block を可能にする)。
  const unblockedParticipantEntityIds = activeAttack.blockAssignments
    .filter(
      (assignment) =>
        assignment.blockedByEntityIds.length <
        (assignment.requiredBlockerCount ?? 1)
    )
    .map((assignment) => assignment.participantEntityId);

  for (const sourceCard of getCardsByZone(options.state, "field")) {
    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );

    if (!sourceDefinition) {
      continue;
    }

    const blockDestroyCostChoices = getBattleDestroyCostChoices(
      options.state,
      sourceCard,
      options.getCardDefinitionById,
      ["battle_destroy_cost_gate_block", "battle_destroy_cost_gate_both"]
    );

    for (const participantEntityId of unblockedParticipantEntityIds) {
      const blockReason = getBlockDeclarationBlockReason({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: sourceCard.instanceId,
        participantEntityId,
        getCardDefinitionById: options.getCardDefinitionById,
      });

      if (blockReason !== null) {
        continue;
      }

      for (const battleDestroyCostSourceInstanceIds of blockDestroyCostChoices) {
        legalActions.push({
          kind: "block",
          actionId: `${createBlockLegalActionId(
            sourceCard.instanceId,
            participantEntityId
          )}${battleDestroyCostActionSuffix(battleDestroyCostSourceInstanceIds)}`,
          can: true,
          reason: "legal_block_declaration",
          actingPlayerId: options.actingPlayerId,
          sourceInstanceId: sourceCard.instanceId,
          sourceDefinitionId: sourceCard.definitionId,
          sourceCardNo: sourceDefinition.cardNo,
          blockerEntityId: getAttackEntityId(
            options.state,
            sourceCard.instanceId
          ),
          participantEntityId,
          attackId: activeAttack.attackId,
          ...battleDestroyCostActionProps(battleDestroyCostSourceInstanceIds),
        });
      }
    }
  }

  return legalActions;
}

export function getAvailableOpenBattleFlashLegalActions(
  options: GetLegalActionsOptions
): OpenBattleFlashLegalAction[] {
  const legalActions: OpenBattleFlashLegalAction[] = [];

  for (const flashKind of ["before_block", "after_block"] as const) {
    const blockReason = getOpenBattleFlashBlockReason({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      flashKind,
    });

    if (blockReason !== null || options.state.activeAttack === null) {
      continue;
    }

    legalActions.push({
      kind: "open_battle_flash",
      actionId: createOpenBattleFlashLegalActionId(
        options.state.activeAttack.attackId,
        flashKind
      ),
      can: true,
      reason: `legal_open_battle_flash_${flashKind}`,
      actingPlayerId: options.actingPlayerId,
      attackId: options.state.activeAttack.attackId,
      flashKind,
    });
  }

  return legalActions;
}

export function getAvailablePassBattleFlashLegalActions(
  options: GetLegalActionsOptions
): PassBattleFlashLegalAction[] {
  const blockReason = getPassBattleFlashBlockReason({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
  });
  const activeAttack = options.state.activeAttack;

  if (
    blockReason !== null ||
    activeAttack === null ||
    activeAttack.flashWindowState === null
  ) {
    return [];
  }

  const flashWindowState = activeAttack.flashWindowState;

  // 内側 stack サブ窓 (pendingStackAction !== null) への応答パスは "スタックパス"、
  // フラッシュ本体 2-pass ループの優先権パスは "フラッシュパス"。
  // 保留中のスタック効果 (相手のフラッシュ使用など) への応答かどうかで判別する。
  // (flash 本体では getResponseWindowActionTimings も優先権保持者に "flash" を返すため
  //  両者は一致する。ラベル判別自体は pendingStackAction 有無で直接行えば十分。)
  const responseTiming: "flash" | "stack" =
    flashWindowState.pendingStackAction !== null ? "stack" : "flash";

  return [
    {
      kind: "pass_battle_flash",
      actionId: createPassBattleFlashLegalActionId(
        activeAttack.attackId,
        flashWindowState.kind
      ),
      can: true,
      reason: `legal_pass_battle_flash_${flashWindowState.kind}`,
      actingPlayerId: options.actingPlayerId,
      attackId: activeAttack.attackId,
      flashKind: flashWindowState.kind,
      responseTiming,
    },
  ];
}

/**
 * P3-55 Phase B: 防御側プレイヤーの「ブロックしない」 legal action を返す。
 * 旧 `getAvailableStartBattleResolutionLegalActions` (アクティブ側 trigger) を置き換える。
 * after_block close からのバトル解決は `pass_battle_flash` apply の auto-chain で行うため、
 * ここでは defender の decline 経路のみ提示する。
 */
export function getAvailableDeclineBlockLegalActions(
  options: GetLegalActionsOptions
): DeclineBlockLegalAction[] {
  const blockReason = getDeclineBlockBlockReason({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
  });

  if (blockReason !== null || options.state.activeAttack === null) {
    return [];
  }

  return [
    {
      kind: "decline_block",
      actionId: createDeclineBlockLegalActionId(
        options.state.activeAttack.attackId
      ),
      can: true,
      reason: "legal_decline_block",
      actingPlayerId: options.actingPlayerId,
      attackId: options.state.activeAttack.attackId,
    },
  ];
}

export function getAvailableEndAttackStepLegalActions(
  options: GetLegalActionsOptions
): EndAttackStepLegalAction[] {
  if (
    options.state.step !== "attack" ||
    options.state.window !== "none" ||
    options.state.activePlayerId !== options.actingPlayerId ||
    options.state.activeAttack !== null
  ) {
    return [];
  }

  // 「このスピリットは可能ならこのターンの最初にアタックする」強制中、対象カードが
  // 現に合法アタック宣言可能な間は、アタックせずにアタックステップを終了する選択を
  // 抜け道として使えないようにする (ENGINE-force-first-attack-this-turn)。
  if (
    getPendingForcedFirstAttackerId(
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById
    ) !== null
  ) {
    return [];
  }

  return [
    {
      kind: "end_attack_step",
      actionId: createEndAttackStepLegalActionId(options.actingPlayerId),
      can: true,
      reason: "legal_end_attack_step",
      actingPlayerId: options.actingPlayerId,
    },
  ];
}

export function getAvailableBraveCombineLegalActions(
  options: GetLegalActionsOptions
): BraveCombineLegalAction[] {
  if (options.state.step !== "main") return [];
  if (options.state.activePlayerId !== options.actingPlayerId) return [];
  if (options.state.stackWindow !== null) return [];

  const legalActions: BraveCombineLegalAction[] = [];

  const fieldCards = getCardsByZone(options.state, "field");
  const soulStateIds = new Set(
    options.state.players.flatMap((player) => player.soulStateInstanceIds)
  );

  // 魂状態カードは runtime 上 zone:"field" のままだが、通常メイン合体はスピリット状態のブレイヴのみ。
  const braves = fieldCards.filter(
    (c) =>
      c.controllerPlayerId === options.actingPlayerId &&
      c.zoneRoleName === "brave" &&
      c.attachedToInstanceId === null &&
      c.pendingLeaveKind === null &&
      !soulStateIds.has(c.instanceId)
  );

  const spirits = fieldCards.filter(
    (c) =>
      c.controllerPlayerId === options.actingPlayerId &&
      (c.zoneRoleName === "spirit" || c.zoneRoleName === "ultimate") &&
      c.pendingLeaveKind === null
  );

  // ENGINE-brave-combine-nexus-host: 合体条件 (05_brave-and-attack-special-cases.md:33-36
  // 「カテゴリ/色/系統/コスト/カード名」) にネクサスを指定するブレイヴのみ、候補にネクサスも含める。
  // categories 未指定/nexus 非含有のブレイヴは従来通り spirits のみが候補（挙動不変）。
  const nexuses = fieldCards.filter(
    (c) =>
      c.controllerPlayerId === options.actingPlayerId &&
      c.zoneRoleName === "nexus" &&
      c.pendingLeaveKind === null
  );

  for (const brave of braves) {
    const braveDef = options.getCardDefinitionById(brave.definitionId);
    if (!braveDef) continue;
    if (braveDef.allowMainStepBraveCombine === false) continue;

    // P3-47 F-2 Step 5 / BSAZ02-C10: act_as_spirit overrides.keywords か
    // 印字 keywordTags のいずれかで "cannot_combine" を持つブレイヴ自身は合体不可
    // (理論上の保険)。
    if (hasCannotCombineRestriction(options.state, brave.instanceId, braveDef))
      continue;

    const hostCandidates = braveConditionAllowsNexusHost(
      braveDef.braveCondition
    )
      ? [...spirits, ...nexuses]
      : spirits;

    for (const spirit of hostCandidates) {
      const spiritDef = options.getCardDefinitionById(spirit.definitionId);
      if (!spiritDef) continue;

      // P3-47 F-2 Step 5 / BSAZ02-C10: 合体先 spirit が cannot_combine を持つ場合は
      // 除外。フランドール token 等、「合体できない」制約付与カードを brave_combine
      // 候補集合から弾く。
      if (
        hasCannotCombineRestriction(options.state, spirit.instanceId, spiritDef)
      )
        continue;

      // BSDB01-CX01 host exclusive-lock (SSOT isExcludedByHostExclusiveLock,
      // advent 側と共有): 保護中のスタックへは slots.cardNames に一致するブレイヴ
      // (孫悟空/ベジータ) 以外は合体できない。
      if (
        isExcludedByHostExclusiveLock(
          options.state,
          spirit,
          braveDef,
          options.getCardDefinitionById
        )
      )
        continue;

      if (
        braveDef.braveCondition &&
        !isIncomingBraveConditionIgnoredByHost({
          state: options.state,
          host: spirit,
          incomingBrave: brave,
          incomingBraveDef: braveDef,
          getCardDefinitionById: options.getCardDefinitionById,
        }) &&
        !matchesBraveConditionForCard({
          condition: braveDef.braveCondition,
          state: options.state,
          card: spirit,
          definition: spiritDef,
          getCardDefinitionById: options.getCardDefinitionById,
          categoryEvaluation: "brave_host",
        })
      )
        continue;
      if (
        !canReceiveBraveWithinCombineLimit({
          state: options.state,
          host: spirit,
          incomingBrave: brave,
          incomingBraveDef: braveDef,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      )
        continue;

      legalActions.push({
        kind: "brave_combine",
        actionId: `legal:brave-combine:${brave.instanceId}:${spirit.instanceId}`,
        can: true,
        reason: "legal_brave_combine",
        actingPlayerId: options.actingPlayerId,
        braveInstanceId: brave.instanceId,
        braveCardNo: braveDef.cardNo,
        targetInstanceId: spirit.instanceId,
        targetCardNo: spiritDef.cardNo,
      });
    }
  }

  // 異魔神ブレイヴ (imaginBraveData) の右合体スロット (10_rules/08c §7)。既に左スロット
  // (attachedToInstanceId、上のループの通常合体) が埋まっているブレイヴだけを対象にする。
  // brave_combine と同一 legal action kind を再利用する（GUI/REST 側の新規配線不要。
  // legal-actions-apply.ts の brave_combine ハンドラが「対象ブレイヴが既に
  // attachedToInstanceId を持つ」ことで右スロット合体と判別し
  // executeImaginBraveSecondCombine へ分岐する）。
  const imaginBravesAwaitingRightSlot = fieldCards.filter(
    (c) =>
      c.controllerPlayerId === options.actingPlayerId &&
      c.zoneRoleName === "brave" &&
      c.attachedToInstanceId !== null &&
      c.imaginRightCombinedWith === null &&
      c.pendingLeaveKind === null
  );

  for (const brave of imaginBravesAwaitingRightSlot) {
    const braveDef = options.getCardDefinitionById(brave.definitionId);
    if (!braveDef || !isImaginBrave(braveDef)) continue;
    if (hasCannotCombineRestriction(options.state, brave.instanceId, braveDef))
      continue;

    const rightCondition =
      braveDef.imaginBraveData?.rightCondition ??
      braveDef.imaginBraveData?.sharedCondition;
    if (!rightCondition) continue;

    for (const spirit of spirits) {
      // 既に左スロットで合体中のホストは右スロット候補から除外（同じ相手への二重合体禁止）。
      if (spirit.instanceId === brave.attachedToInstanceId) continue;
      const spiritDef = options.getCardDefinitionById(spirit.definitionId);
      if (!spiritDef) continue;

      if (
        hasCannotCombineRestriction(options.state, spirit.instanceId, spiritDef)
      )
        continue;

      // BSDB01-CX01 host exclusive-lock (SSOT isExcludedByHostExclusiveLock)。
      if (
        isExcludedByHostExclusiveLock(
          options.state,
          spirit,
          braveDef,
          options.getCardDefinitionById
        )
      )
        continue;

      if (
        !matchesBraveConditionForCard({
          condition: rightCondition,
          state: options.state,
          card: spirit,
          definition: spiritDef,
          getCardDefinitionById: options.getCardDefinitionById,
          categoryEvaluation: "brave_host",
        })
      )
        continue;
      if (
        !canReceiveBraveWithinCombineLimit({
          state: options.state,
          host: spirit,
          incomingBrave: brave,
          incomingBraveDef: braveDef,
          getCardDefinitionById: options.getCardDefinitionById,
        })
      )
        continue;

      legalActions.push({
        kind: "brave_combine",
        actionId: `legal:brave-combine:imagin-right:${brave.instanceId}:${spirit.instanceId}`,
        can: true,
        reason: "legal_brave_combine",
        actingPlayerId: options.actingPlayerId,
        braveInstanceId: brave.instanceId,
        braveCardNo: braveDef.cardNo,
        targetInstanceId: spirit.instanceId,
        targetCardNo: spiritDef.cardNo,
      });
    }
  }

  return legalActions;
}

/**
 * 契約合体（フラッシュ【契約合体：<条件>】、P3-111 S2）の legal action を列挙する。
 * `brave_combine` と異なり:
 * - 発動元は自分の手札の brave カード（`contractCombineData` を持つもの）。
 * - main 限定ではなく `contractCombineData.timingScope` でステップ/プレイヤーを限定する
 *   （手札起動効果の timingScope ゲートと同じ規約。main 限定ゲートを通さない）。
 * - 起動コストとして自分のソウルコアが必要（`hasSoulCoreAvailable`）。
 * - 合体先は maxCombinedBraves の多重合体枠を無視し、常に対象自分のスピリット/アルティメット
 *   （既に合体済みでも「合体していたブレイヴは破棄する」で置換できるため候補から除外しない）。
 */
export function getAvailableContractCombineLegalActions(
  options: GetLegalActionsOptions
): ContractCombineLegalAction[] {
  if (options.state.stackWindow !== null) return [];
  if (!getCurrentMagicActionTimings(options).includes("flash")) return [];

  const legalActions: ContractCombineLegalAction[] = [];

  const handBraves = getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  ).filter((c) => c.controllerPlayerId === options.actingPlayerId);

  // 自己完結型（亜種1, P3-111 S2）: 手札のブレイヴ自身がソウルコアをトラッシュに
  // 置くことを起動コストとして支払う。
  const emittedContractCombineBraveIds = new Set<string>();

  if (
    hasSoulCoreAvailable(options.state, options.actingPlayerId) &&
    !isFlashRestricted(options.state, options.actingPlayerId, "hand")
  ) {
    for (const brave of handBraves) {
      const braveDef = options.getCardDefinitionById(brave.definitionId);
      if (!braveDef?.contractCombineData) continue;

      if (
        !isTimingScopeActive(
          braveDef.contractCombineData.timingScope,
          options.state.step,
          options.state.activePlayerId,
          options.actingPlayerId
        )
      )
        continue;

      const targets = getContractCombineCandidateTargets({
        state: options.state,
        actingPlayerId: options.actingPlayerId,
        braveCard: brave,
        braveDefinition: braveDef,
        getCardDefinitionById: options.getCardDefinitionById,
      });
      if (targets.length > 0) {
        legalActions.push({
          kind: "contract_combine",
          actionId: `legal:contract-combine:${brave.instanceId}`,
          can: true,
          reason: "legal_contract_combine",
          actingPlayerId: options.actingPlayerId,
          braveInstanceId: brave.instanceId,
          braveCardNo: braveDef.cardNo,
          candidateTargetInstanceIds: targets.map(
            (target) => target.instanceId
          ),
          targetMode: "manual",
          requiredTargetCount: 1,
        });
        emittedContractCombineBraveIds.add(brave.instanceId);
      }
    }
  }

  // プロキシ起動型（亜種2, P3-111 S4）: フィールドのカード（ネクサス等）の
  // `contractCombineProxyData` から、指定カード名（省略時は無制限）への契約合体を
  // 「ソウルコアをトラッシュに置いたものとして」代理発動する（起動コスト免除）。
  // 対象カード名以外の判定（ブレイヴの braveCondition / timingScope）は自己完結型と
  // 同じ SSOT を再利用する。使用制限は〔ターンに1回：同名〕(per_card_name/turn) 固定。
  // 実際に発動されるのはブレイヴ自身のフラッシュ【契約合体】キーワード（発動元は常に手札）
  // であり、プロキシ経由でもこの性質は変わらないため、ゲートは自己完結型と同じ
  // hand 側 restrict_flash を見る（adversarial verifier 指摘）。
  if (!isFlashRestricted(options.state, options.actingPlayerId, "hand")) {
    const proxySources = getCardsByZone(options.state, "field").filter(
      (c) => c.controllerPlayerId === options.actingPlayerId && !c.faceDown
    );

    for (const proxySource of proxySources) {
      const proxyDef = options.getCardDefinitionById(proxySource.definitionId);
      const proxyData = proxyDef?.contractCombineProxyData;
      if (!proxyData) continue;

      if (
        !evaluateCondition(
          options.state,
          [{ kind: "min_level", value: proxyData.requiredLevel }],
          proxySource.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )
      )
        continue;

      if (
        !canUseEffectByUsageLimit({
          state: options.state,
          sourceInstanceId: proxySource.instanceId,
          sourceDefinitionId: proxySource.definitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: "contract_combine_proxy",
          usageLimit: { kind: "per_card_name", duration: "turn" },
        })
      )
        continue;

      for (const brave of handBraves) {
        const braveDef = options.getCardDefinitionById(brave.definitionId);
        if (!braveDef?.contractCombineData) continue;

        if (
          !isTimingScopeActive(
            braveDef.contractCombineData.timingScope,
            options.state.step,
            options.state.activePlayerId,
            options.actingPlayerId
          )
        )
          continue;

        const targets = getContractCombineCandidateTargets({
          state: options.state,
          actingPlayerId: options.actingPlayerId,
          braveCard: brave,
          braveDefinition: braveDef,
          getCardDefinitionById: options.getCardDefinitionById,
          ...(proxyData.targetCardNames !== undefined
            ? { proxyTargetCardNames: proxyData.targetCardNames }
            : {}),
        });
        if (targets.length > 0) {
          if (emittedContractCombineBraveIds.has(brave.instanceId)) continue;
          legalActions.push({
            kind: "contract_combine",
            actionId: `legal:contract-combine:${brave.instanceId}`,
            can: true,
            reason: "legal_contract_combine",
            actingPlayerId: options.actingPlayerId,
            braveInstanceId: brave.instanceId,
            braveCardNo: braveDef.cardNo,
            candidateTargetInstanceIds: targets.map(
              (target) => target.instanceId
            ),
            targetMode: "manual",
            requiredTargetCount: 1,
          });
          emittedContractCombineBraveIds.add(brave.instanceId);
        }
      }
    }
  }

  return legalActions;
}

/**
 * 【リンクエイド】(P3-111 S6、BSGE01-CX01〜CX04/R01〜R05) の legal action を列挙する。
 * 魂状態のカード（`linkAidData` を持つもの）ごとに、支払い元候補が1つ以上あれば
 * 「リンクエイドを発揮宣言する」単位で列挙する。
 * 10_rules/07b §リンクエイド 裁定: コスト源は固定1コア（軽減・疲労は無関係）、召喚扱いではない
 * state-change。ターン/同名の使用制限なし。
 *
 * `grant_link_aid_cost_override` CE (BSGE01-C03「ディソレイト」フラッシュ) が自分に
 * 登録されている間の候補拡張も `collectLinkAidCostSourceCandidates` が一元的に扱う。
 */
export function getAvailableLinkAidLegalActions(
  options: GetLegalActionsOptions
): LinkAidLegalAction[] {
  if (options.state.stackWindow !== null) return [];
  if (!getCurrentMagicActionTimings(options).includes("flash")) return [];

  const legalActions: LinkAidLegalAction[] = [];

  const actingPlayer = options.state.players.find(
    (p) => p.id === options.actingPlayerId
  );
  if (!actingPlayer) return legalActions;

  const soulStateCards = getCardsByZone(options.state, "field").filter((c) =>
    actingPlayer.soulStateInstanceIds.includes(c.instanceId)
  );
  if (soulStateCards.length === 0) return legalActions;

  for (const soulCard of soulStateCards) {
    const soulDef = options.getCardDefinitionById(soulCard.definitionId);
    if (!soulDef?.linkAidData) continue;

    if (
      !isTimingScopeActive(
        soulDef.linkAidData.timingScope,
        options.state.step,
        options.state.activePlayerId,
        options.actingPlayerId
      )
    )
      continue;

    const costSourceCandidates = collectLinkAidCostSourceCandidates(
      options.state,
      options.actingPlayerId,
      soulCard.instanceId,
      options.getCardDefinitionById
    );
    if (costSourceCandidates.length === 0) continue;

    legalActions.push({
      kind: "link_aid",
      actionId: `legal:link-aid:${soulCard.instanceId}`,
      can: true,
      reason: "legal_link_aid",
      actingPlayerId: options.actingPlayerId,
      soulStateCardInstanceId: soulCard.instanceId,
      soulStateCardNo: soulDef.cardNo,
    });
  }

  return legalActions;
}

export { getValidBraveCombineHosts } from "./legal-actions-shared";

/**
 * 場入りコア配置に充てられるコア数 (リザーブ + 自分フィールドのカード上)。
 * ブレイヴ召喚のスピリット状態 (Lv1) を払えるかの判定に使う。
 * generic な「コア」配置なので、通常/ソウルをともに数える。
 */
export function getAvailablePlacementCoreCount(
  state: GameState,
  playerId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  return countEnterFieldCoreSources({
    state,
    actingPlayerId: playerId,
    getCardDefinitionById,
  });
}

export function getAvailableBraveSeparateLegalActions(
  options: GetLegalActionsOptions
): BraveSeparateLegalAction[] {
  if (options.state.step !== "main") return [];
  if (options.state.activePlayerId !== options.actingPlayerId) return [];
  if (options.state.stackWindow !== null) return [];

  const legalActions: BraveSeparateLegalAction[] = [];

  for (const host of getCardsByZone(options.state, "field")) {
    if (host.controllerPlayerId !== options.actingPlayerId) continue;
    if (host.attachedChildrenIds.length === 0) continue;
    if (host.pendingLeaveKind !== null) continue;
    if (hasPreventBraveSeparationRestriction(options.state, host.instanceId))
      continue;

    for (const braveId of host.attachedChildrenIds) {
      const brave = getCardById(options.state, braveId);
      if (!brave) continue;

      // ブレイヴの Lv1 必要コアが確保できるかチェック
      const braveMinCores = brave.minimumRequiredCores;
      const braveCores =
        brave.normalCoreCount + (isSoulCoreOn(options.state, braveId) ? 1 : 0);
      const needed = Math.max(0, braveMinCores - braveCores);
      const availableCores = getAvailableBraveSeparationCoreCount(
        options.state,
        options.actingPlayerId,
        braveId,
        options.getCardDefinitionById
      );
      if (needed > availableCores) continue;

      legalActions.push({
        kind: "brave_separate",
        actionId: `legal:brave-separate:${host.instanceId}:${braveId}`,
        can: true,
        reason: "legal_brave_separate",
        actingPlayerId: options.actingPlayerId,
        hostInstanceId: host.instanceId,
        braveInstanceId: braveId,
      });
    }
  }

  return legalActions;
}

export function getAvailableBraveSwapLegalActions(
  options: GetLegalActionsOptions
): BraveSwapLegalAction[] {
  if (options.state.step !== "main") return [];
  if (options.state.activePlayerId !== options.actingPlayerId) return [];
  if (options.state.stackWindow !== null) return [];

  const legalActions: BraveSwapLegalAction[] = [];

  // 合体中のスピリットから、ブレイヴを別のスピリットに移す
  const fieldCards = getCardsByZone(options.state, "field");
  for (const fromHost of fieldCards) {
    if (fromHost.controllerPlayerId !== options.actingPlayerId) continue;
    if (fromHost.attachedChildrenIds.length === 0) continue;
    if (fromHost.pendingLeaveKind !== null) continue;
    if (
      hasPreventBraveSeparationRestriction(options.state, fromHost.instanceId)
    )
      continue;

    for (const braveId of fromHost.attachedChildrenIds) {
      const brave = getCardById(options.state, braveId);
      if (!brave) continue;
      const braveDef = options.getCardDefinitionById(brave.definitionId);
      if (!braveDef) continue;

      const allowsNexusHost = braveConditionAllowsNexusHost(
        braveDef.braveCondition
      );

      // 交換先: 未合体 or 別の合体ホスト（ブレイヴ入れ替え）。
      // ネクサスは合体条件側で明示許容されたブレイヴだけ候補に含める。
      for (const toHost of fieldCards) {
        if (toHost.instanceId === fromHost.instanceId) continue;
        if (toHost.controllerPlayerId !== options.actingPlayerId) continue;
        if (toHost.pendingLeaveKind !== null) continue;
        if (
          toHost.zoneRoleName !== "spirit" &&
          toHost.zoneRoleName !== "ultimate" &&
          !(allowsNexusHost && toHost.zoneRoleName === "nexus")
        )
          continue;
        // 既に同じブレイヴが付いている場合はスキップ
        if (toHost.attachedChildrenIds.includes(braveId)) continue;
        // 合体条件チェック
        const toHostDef = options.getCardDefinitionById(toHost.definitionId);
        if (!toHostDef) continue;
        // BSDB01-CX01 host exclusive-lock (SSOT isExcludedByHostExclusiveLock)。
        // ブレイヴ入れ替え先 (toHost) も「入れ替え」の一種として保護対象に含む。
        if (
          isExcludedByHostExclusiveLock(
            options.state,
            toHost,
            braveDef,
            options.getCardDefinitionById
          )
        )
          continue;
        if (
          braveDef.braveCondition &&
          !matchesBraveConditionForCard({
            condition: braveDef.braveCondition,
            state: options.state,
            card: toHost,
            definition: toHostDef,
            getCardDefinitionById: options.getCardDefinitionById,
            categoryEvaluation: "brave_host",
          })
        )
          continue;
        if (
          !canReceiveBraveWithinCombineLimit({
            state: options.state,
            host: toHost,
            incomingBrave: brave,
            incomingBraveDef: braveDef,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        )
          continue;
        if (
          !canPerformOneWayBraveSwap({
            state: options.state,
            fromHost,
            braveId,
            getCardDefinitionById: options.getCardDefinitionById,
          })
        )
          continue;

        legalActions.push({
          kind: "brave_swap",
          actionId: `legal:brave-swap:${braveId}:${fromHost.instanceId}:${toHost.instanceId}`,
          can: true,
          reason: "legal_brave_swap",
          actingPlayerId: options.actingPlayerId,
          fromHostInstanceId: fromHost.instanceId,
          braveInstanceId: braveId,
          toHostInstanceId: toHost.instanceId,
        });
      }
    }
  }

  return legalActions;
}

// ─── アクセル ───

/**
 * 現在のタイミングでアクセル使用可能な手札カードを列挙する。
 * アクセルは手札からのみ使用可能（手元からは不可）。
 * タイミングはアクセルデータの timing に依存（"main" or "flash"）。
 */
export function getAvailableAccelLegalActions(
  options: GetLegalActionsOptions
): UseAccelLegalAction[] {
  const timings = getCurrentMagicActionTimings(options);
  if (timings.length === 0) return [];

  const legalActions: UseAccelLegalAction[] = [];

  // アクセルは手札からのみ（set_aside からは不可）
  for (const sourceCard of getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  )) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) continue;

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    if (!sourceDefinition?.accelData) continue;

    // restrict_use CE チェック
    if (
      isCardUseRestricted(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById,
        "accel"
      )
    )
      continue;

    const accelData = sourceDefinition.accelData;
    const sourceTimings = filterRestrictedTimings(
      timings,
      options.state,
      options.actingPlayerId,
      undefined,
      options.getCardDefinitionById,
      undefined,
      sourceCard.zone,
      undefined,
      undefined,
      evaluateCondition
    );

    // タイミングチェック: アクセルの timing が現在の利用可能タイミングに含まれるか
    if (!sourceTimings.includes(accelData.timing)) continue;

    const paymentSources = getAvailableAccelChangePaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      cost: accelData.cost,
      reductionSymbols: accelData.reduction,
      useKind: "accel",
      sourceInstanceId: sourceCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });

    // ENGINE-accel-tribe-cost-override (BSTH08.5-R12): 自分の系統一致カードの
    // 【アクセル】コストを0にできる cost_override CE。getMagicFreeUseSource/
    // getMagicCostOverrideSource の free 版と対称の dual-legal-action push。
    const freeUseSource = getAccelFreeUseSource({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      accelCard: sourceCard,
      accelDefinition: sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    const canUseFree =
      freeUseSource.canUseWithoutCost &&
      freeUseSource.sourceInstanceId !== undefined &&
      freeUseSource.sourceDefinitionId !== undefined;

    if (!paymentSources.canFullyPay && !canUseFree) continue;

    if (paymentSources.canFullyPay) {
      legalActions.push({
        kind: "use_accel",
        actionId: `legal:accel:${sourceCard.instanceId}:${accelData.timing}`,
        can: true,
        reason: `legal_use_accel_${accelData.timing}`,
        actingPlayerId: options.actingPlayerId,
        timing: accelData.timing,
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceCard.definitionId,
        sourceCardNo: sourceDefinition.cardNo,
        targetMode: "none",
        requiredTargetCount: 0,
        targetEffectFilterTags: ["general"] as const,
        candidateTargetInstanceIds: [],
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
        reducedCost: paymentSources.reduction.reducedCost,
        additionalCost: paymentSources.reduction.additionalCost,
        finalCost: paymentSources.reduction.finalCost,
        totalReduction: paymentSources.reduction.totalReduction,
        availableReserveCoreAmount:
          paymentSources.reserveSource.availableCoreAmount,
        availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
        availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
        costMode: "paid",
      });
    }

    if (canUseFree && freeUseSource.sourceInstanceId !== undefined) {
      const freeUseSourceInstanceId = freeUseSource.sourceInstanceId;
      legalActions.push({
        kind: "use_accel",
        actionId: `legal:accel:${sourceCard.instanceId}:${accelData.timing}:free`,
        can: true,
        reason: `legal_use_accel_${accelData.timing}_free`,
        actingPlayerId: options.actingPlayerId,
        timing: accelData.timing,
        sourceInstanceId: sourceCard.instanceId,
        sourceDefinitionId: sourceCard.definitionId,
        sourceCardNo: sourceDefinition.cardNo,
        targetMode: "none",
        requiredTargetCount: 0,
        targetEffectFilterTags: ["general"] as const,
        candidateTargetInstanceIds: [],
        availableChosenLifeCoreKinds: [],
        requiresChosenLifeCoreKind: false,
        reducedCost: accelData.cost,
        additionalCost: paymentSources.reduction.additionalCost,
        finalCost: paymentSources.reduction.additionalCost,
        totalReduction: accelData.cost,
        availableReserveCoreAmount:
          paymentSources.reserveSource.availableCoreAmount,
        availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
        availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
        costMode: "free",
        costOverrideSourceInstanceId: freeUseSourceInstanceId,
        ...(freeUseSource.usageLimit
          ? { costOverrideUsageLimit: freeUseSource.usageLimit }
          : {}),
        ...(freeUseSource.limitGroupId
          ? { costOverrideLimitGroupId: freeUseSource.limitGroupId }
          : {}),
        ...(freeUseSource.effectLabel
          ? { costOverrideEffectLabel: freeUseSource.effectLabel }
          : {}),
      });
    }
  }

  return legalActions;
}

// ─── チェンジ ───

/**
 * 現在のタイミングでチェンジ使用可能な手札カードを列挙する。
 * チェンジはフラッシュタイミングのみ。手札からのみ使用可能。
 */
export function getAvailableChangeLegalActions(
  options: GetLegalActionsOptions
): UseChangeLegalAction[] {
  const timings = getCurrentMagicActionTimings(options);
  if (timings.length === 0) return [];

  // チェンジはフラッシュタイミングのみ
  if (!timings.includes("flash")) return [];

  const legalActions: UseChangeLegalAction[] = [];

  for (const sourceCard of getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  )) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) continue;

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    if (!sourceDefinition?.changeData) continue;

    // restrict_use CE チェック
    if (
      isCardUseRestricted(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById,
        "change"
      )
    )
      continue;

    const changeData = sourceDefinition.changeData;
    const sourceTimings = filterRestrictedTimings(
      timings,
      options.state,
      options.actingPlayerId,
      undefined,
      options.getCardDefinitionById,
      undefined,
      sourceCard.zone,
      undefined,
      undefined,
      evaluateCondition
    );
    if (!sourceTimings.includes("flash")) continue;

    const paymentSources = getAvailableAccelChangePaymentSources({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      cost: changeData.cost,
      reductionSymbols: changeData.reduction,
      useKind: "change",
      sourceInstanceId: sourceCard.instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });

    if (!paymentSources.canFullyPay) continue;

    // 入れ替え候補を列挙 (changeCardDef は BSDB01-CX01 host exclusive-lock 判定用)
    const swapCandidateInstanceIds = getChangeSwapCandidates({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      swapCondition: changeData.swapCondition,
      getCardDefinitionById: options.getCardDefinitionById,
      changeCardDef: sourceDefinition,
    });

    const baseAction = {
      kind: "use_change",
      can: true,
      reason: "legal_use_change",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: sourceDefinition.cardNo,
      targetMode: "none",
      requiredTargetCount: 0,
      targetEffectFilterTags: ["general"] as const,
      candidateTargetInstanceIds: [],
      availableChosenLifeCoreKinds: [],
      requiresChosenLifeCoreKind: false,
      reducedCost: paymentSources.reduction.reducedCost,
      additionalCost: paymentSources.reduction.additionalCost,
      finalCost: paymentSources.reduction.finalCost,
      totalReduction: paymentSources.reduction.totalReduction,
      availableReserveCoreAmount:
        paymentSources.reserveSource.availableCoreAmount,
      availableOnBoardCoreSources: paymentSources.onBoardCoreSources,
      availableSoulCoreOnlySources: paymentSources.soulCoreOnlySources,
      swapCandidateInstanceIds,
    } satisfies Omit<UseChangeLegalAction, "actionId">;

    // 08b §5: チェンジは効果発揮後に「破棄」or「入れ替え」を選ぶ。
    // 宣言時 action は単一にし、後処理選択は resolve_pending_change_cleanup_choice
    // で解決時点の候補に対して行う。
    legalActions.push({
      ...baseAction,
      actionId: `legal:change:${sourceCard.instanceId}`,
    });
  }

  return legalActions;
}

// ─── 煌臨 (advent) ───

/**
 * 現在のタイミングで煌臨宣言可能な手札カードを列挙する。
 *
 * 煌臨は「召喚ではない」が、手札からソウルコアを消費して使う行動なので
 * accel/change と同じく getCurrentMagicActionTimings を時系判定の基盤に使う。
 *
 * 時系ゲート (各カードの adventData.adventTiming 別):
 * - "main_and_flash" … メイン or フラッシュ窓 (timings に main/flash)。
 * - "own_turn" … 自分のターンのメイン or フラッシュ窓。
 * - "both_attack_step" … お互いのアタックステップのフラッシュ窓のみ (10_rules/08a §1 表)。
 *   activeAttack の battle flash 本体窓 (timings に flash) を許可する。
 * - "own_attack_step" … 自分のアタックステップのフラッシュ窓のみ
 *   (flash かつ activePlayerId === actingPlayerId)。
 *
 * 増分2: 煌臨種別 (adventData.adventVariant) ごとに対象列挙器を選ぶ。
 * - "contract" → getContractAdventTargets (魂状態の契約カード含む、08a:147-148)。
 * - "f_contract" → getFContractAdventTargets (魂状態 + ネクサス含む、08a:156-158)。
 * - undefined / "normal" → getAdventTargets (通常煌臨)。
 * 1 カードは 1 種別のみ印字するため (【煌臨】/【契約煌臨】/【F契約煌臨】は排他)、
 * (card, mode) は 1 対 1。最も具体的な (印字された) 種別のみを emit する。
 *
 * ソウルコア (hasSoulCoreAvailable) と使用制限 (isCardUseRestricted) でゲートし、
 * 選んだ列挙器が 1 体以上返すカードのみ legal にする。
 */
export function getAvailableAdventLegalActions(
  options: GetLegalActionsOptions
): DeclareAdventLegalAction[] {
  const timings = getCurrentMagicActionTimings(options);
  if (timings.length === 0) return [];

  // restrict_advent CE (ENGINE-restrict-advent、BSFT01-X01「相手は【煌臨】できない」) なら
  // 煌臨宣言 legal action 自体を生成しない。
  if (isAdventRestricted(options.state, options.actingPlayerId)) return [];

  const battleFlashWindowState =
    options.state.activeAttack?.flashWindowState ?? null;
  const inBattleFlashWindow =
    battleFlashWindowState !== null &&
    (options.state.window === "flash_before_block" ||
      options.state.window === "flash_after_block" ||
      options.state.window === "stack_before_block" ||
      options.state.window === "stack_after_block");
  const isActivePlayer =
    options.state.activePlayerId === options.actingPlayerId;

  const legalActions: DeclareAdventLegalAction[] = [];

  // 手札 (通常煌臨) ＋ トラッシュ (adventSourceZone:"trash" のトラッシュ起点煌臨) を走査。
  // adventSourceZone はカードの adventData に印字されるので、ゾーン別に候補を集めてから
  // 各カードの宣言可否を判定する (08a §1 手順1「煌臨元を取り出すゾーン」)。
  const adventSourceCards = [
    ...getOwnHandCards(
      options.state,
      options.actingPlayerId,
      options.getCardDefinitionById
    ),
    ...getCardsByZone(options.state, "trash"),
  ];

  for (const sourceCard of adventSourceCards) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) continue;

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    if (!sourceDefinition?.adventData) continue;

    const adventData = sourceDefinition.adventData;

    // 取り出しゾーンが印字と一致するカードのみ宣言可能
    // (手札カードは sourceZone:"hand"/未指定、トラッシュカードは sourceZone:"trash")。
    const sourceZone = adventData.adventSourceZone ?? "hand";
    if (
      !isCardInEffectZone(
        options.state,
        sourceCard,
        [sourceZone],
        options.actingPlayerId,
        options.getCardDefinitionById
      )
    )
      continue;

    // 〔ターンに1回:同名〕トラッシュ起点煌臨のターン制限。
    // 同名 (cardNo) でこのターン既に発動済みなら宣言不可。
    if (
      sourceZone === "trash" &&
      options.state.usedTrashAdventKeysThisTurn.includes(
        sourceDefinition.cardNo
      )
    )
      continue;
    // 通常 declare_advent の 〔ターンに1回:同名〕 opt-in は printed name で共有する。
    if (
      adventData.declareUsageLimit?.kind === "per_card_name" &&
      adventData.declareUsageLimit.duration === "turn" &&
      options.state.usedAdventDeclareKeysThisTurn.includes(
        getAdventDeclareUsageKey(sourceDefinition)
      )
    )
      continue;

    const sourceTimings = filterRestrictedTimings(
      timings,
      options.state,
      options.actingPlayerId,
      undefined,
      options.getCardDefinitionById,
      undefined,
      sourceCard.zone,
      undefined,
      undefined,
      evaluateCondition
    );
    if (sourceTimings.length === 0) continue;
    const sourceInMainTiming = sourceTimings.includes("main");
    const sourceInFlashTiming = sourceTimings.includes("flash");

    // restrict_use CE チェック (accel/change と同様)
    if (
      isCardUseRestricted(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById,
        "advent"
      )
    )
      continue;

    const timingCtx = {
      sourceInMainTiming,
      sourceInFlashTiming,
      inBattleFlashWindow,
      isActivePlayer,
    };

    // 通常経路: ソウルコアが使用可能なときのみ、declareCondition + adventTiming で判定。
    const soulCoreAvailable = hasSoulCoreAvailable(
      options.state,
      options.actingPlayerId,
      { dest: adventData.soulCoreDest }
    );
    const normalPathAllowed =
      soulCoreAvailable &&
      (!adventData.declareCondition ||
        adventData.declareCondition.length === 0 ||
        evaluateCondition(
          options.state,
          adventData.declareCondition,
          sourceCard.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )) &&
      adventTimingWindowAllowed(adventData.adventTiming, timingCtx);

    // 代替コスト経路 (adventData.alternateCostAdvent、BSSL01-X01[3])。
    // ソウルコア所持の有無とは独立に判定する（原文に所持時の排他制約なし。
    // 通常経路と両方成立する場合、プレイヤーがソウルコアを消費するかどうかを選べる）。
    // 〔ターンに1回:同名〕は printed name キーで gate する。
    const altPathAllowed =
      adventData.alternateCostAdvent !== undefined &&
      !options.state.usedAlternateCostAdventKeysThisTurn.includes(
        getAdventDeclareUsageKey(sourceDefinition)
      ) &&
      (!adventData.declareCondition ||
        adventData.declareCondition.length === 0 ||
        evaluateCondition(
          options.state,
          adventData.declareCondition,
          sourceCard.instanceId,
          options.actingPlayerId,
          options.getCardDefinitionById
        )) &&
      evaluateCondition(
        options.state,
        adventData.alternateCostAdvent.condition,
        sourceCard.instanceId,
        options.actingPlayerId,
        options.getCardDefinitionById
      ) &&
      adventTimingWindowAllowed(
        adventData.alternateCostAdvent.timing,
        timingCtx
      );

    if (!normalPathAllowed && !altPathAllowed) continue;

    // 煌臨種別ごとに対象列挙器を選ぶ (08a §3)。両経路とも対象条件 (adventCondition) は共有する。
    const adventMode: "normal" | "contract" | "f_contract" =
      adventData.adventVariant ?? "normal";
    const targets =
      adventMode === "f_contract"
        ? getFContractAdventTargets(
            options.state,
            options.actingPlayerId,
            adventData,
            options.getCardDefinitionById,
            sourceDefinition,
            altPathAllowed
          )
        : adventMode === "contract"
          ? getContractAdventTargets(
              options.state,
              options.actingPlayerId,
              adventData,
              options.getCardDefinitionById,
              sourceDefinition,
              altPathAllowed
            )
          : getAdventTargets(
              options.state,
              options.actingPlayerId,
              adventData,
              options.getCardDefinitionById,
              sourceDefinition,
              altPathAllowed
            );
    if (targets.length === 0) continue;

    legalActions.push({
      kind: "declare_advent",
      actionId: `legal:advent:${sourceCard.instanceId}`,
      can: true,
      reason: "legal_declare_advent",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: sourceDefinition.cardNo,
      candidateTargetInstanceIds: targets.map((t) => t.instanceId),
      targetMode: "manual",
      requiredTargetCount: 1,
      adventMode,
      soulCoreDest: adventData.soulCoreDest,
      adventSourceZone: sourceZone,
      chargeCoresOnAdvent: adventData.chargeCoresOnAdvent ?? false,
      useAlternateCost: false,
    });
  }

  // 常時許可は契約合体の proxy と同じく、手札カードの1宣言へ集約する。
  for (const source of adventSourceCards) {
    const grantedOptions = getHostGrantedAdventChoiceOptions(
      options.state,
      source.instanceId,
      options.actingPlayerId,
      options.getCardDefinitionById
    );
    if (grantedOptions.length === 0) continue;
    const definition = options.getCardDefinitionById(source.definitionId)!;
    const hostIds = grantedOptions.map(
      (choice) => choice.proxySourceInstanceId!
    );
    const existing = legalActions.find(
      (action) => action.sourceInstanceId === source.instanceId
    );
    if (existing) {
      existing.candidateTargetInstanceIds = [
        ...new Set([...existing.candidateTargetInstanceIds, ...hostIds]),
      ];
    } else {
      legalActions.push({
        kind: "declare_advent",
        actionId: `legal:advent:${source.instanceId}`,
        can: true,
        reason: "legal_declare_advent",
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: source.instanceId,
        sourceDefinitionId: source.definitionId,
        sourceCardNo: definition.cardNo,
        candidateTargetInstanceIds: [...new Set(hostIds)],
        targetMode: "manual",
        requiredTargetCount: 1,
        adventMode: definition.adventData?.adventVariant ?? "contract",
        soulCoreDest: "trash",
        adventSourceZone: "hand",
        chargeCoresOnAdvent: false,
        useAlternateCost: false,
      });
    }
  }

  return legalActions;
}

/**
 * 多重煌臨 (declare_dual_host_advent、BSSG01-X03「暁 切歌＆月読 調『アマルガム』」、
 * 裁定確定 2026-08-01) を列挙する。手札の `dualHostAdventData` 印字カードにつき、
 * 2つの host スロット条件 (`hostSlotConditions`) それぞれの対象候補列挙は既存
 * `getAdventTargets` (SSOT、通常煌臨と同じ 対象除外/条件判定) を再利用し、両者の
 * union を `candidateTargetInstanceIds` にする。両スロットとも候補が1体以上ないと
 * 成立しないため emit しない。
 */
export function getAvailableDualHostAdventLegalActions(
  options: GetLegalActionsOptions
): DeclareDualHostAdventLegalAction[] {
  const timings = getCurrentMagicActionTimings(options);
  if (timings.length === 0) return [];
  if (isAdventRestricted(options.state, options.actingPlayerId)) return [];

  const isActivePlayer =
    options.state.activePlayerId === options.actingPlayerId;
  const inBattleFlashWindow =
    options.state.activeAttack?.flashWindowState != null;
  const timingCtx = {
    sourceInMainTiming: timings.includes("main"),
    sourceInFlashTiming: timings.includes("flash"),
    inBattleFlashWindow,
    isActivePlayer,
  };

  const legalActions: DeclareDualHostAdventLegalAction[] = [];

  for (const sourceCard of getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  )) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) continue;

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    if (!sourceDefinition?.dualHostAdventData) continue;
    const dualData = sourceDefinition.dualHostAdventData;

    if (
      isCardUseRestricted(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById,
        "advent"
      )
    )
      continue;

    const sourceTimings = filterRestrictedTimings(
      timings,
      options.state,
      options.actingPlayerId,
      undefined,
      options.getCardDefinitionById,
      undefined,
      sourceCard.zone,
      undefined,
      undefined,
      evaluateCondition
    );
    if (
      !adventTimingWindowAllowed(dualData.adventTiming, {
        ...timingCtx,
        sourceInMainTiming: sourceTimings.includes("main"),
        sourceInFlashTiming: sourceTimings.includes("flash"),
      })
    )
      continue;

    const soulCoreAvailable = hasSoulCoreAvailable(
      options.state,
      options.actingPlayerId,
      { dest: dualData.soulCoreDest }
    );
    if (!soulCoreAvailable) continue;

    const [slotA, slotB] = dualData.hostSlotConditions;
    const slotATargets = getAdventTargets(
      options.state,
      options.actingPlayerId,
      {
        adventCondition: slotA,
        adventTiming: dualData.adventTiming,
        soulCoreDest: dualData.soulCoreDest,
      },
      options.getCardDefinitionById,
      sourceDefinition
    );
    const slotBTargets = getAdventTargets(
      options.state,
      options.actingPlayerId,
      {
        adventCondition: slotB,
        adventTiming: dualData.adventTiming,
        soulCoreDest: dualData.soulCoreDest,
      },
      options.getCardDefinitionById,
      sourceDefinition
    );
    if (slotATargets.length === 0 || slotBTargets.length === 0) continue;

    const candidateInstanceIds = new Set<string>();
    for (const t of slotATargets) candidateInstanceIds.add(t.instanceId);
    for (const t of slotBTargets) candidateInstanceIds.add(t.instanceId);
    if (candidateInstanceIds.size < 2) continue;

    legalActions.push({
      kind: "declare_dual_host_advent",
      actionId: `legal:dual_host_advent:${sourceCard.instanceId}`,
      can: true,
      reason: "legal_declare_dual_host_advent",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: sourceDefinition.cardNo,
      candidateTargetInstanceIds: [...candidateInstanceIds],
      targetMode: "manual",
      requiredTargetCount: 2,
      soulCoreDest: dualData.soulCoreDest,
    });
  }

  return legalActions;
}

// ─── 顕現 (manifest) ───

/**
 * 現在のタイミングで顕現宣言可能な手札カードを列挙する。
 *
 * 顕現は召喚の一種だが、advent/accel/change と同じくソウルコアを消費する手札からの
 * 発揮行動なので getCurrentMagicActionTimings を時系判定の基盤に使う。
 *
 * 時系ゲート: 現状すべての顕現カードが manifestTiming:"own_main_step" のみを印字するため、
 * 自分のターンの main 窓のみを許可する (advent の own_turn/main_and_flash のような
 * 複数窓分岐は無い。将来「自分のターン」等の顕現カードが出たら分岐を追加する)。
 */
export function getAvailableManifestLegalActions(
  options: GetLegalActionsOptions
): DeclareManifestLegalAction[] {
  const timings = getCurrentMagicActionTimings(options);
  if (timings.length === 0) return [];

  // ソウルコアが使用不可なら顕現自体ができない
  if (!hasSoulCoreAvailable(options.state, options.actingPlayerId)) return [];

  const isActivePlayer =
    options.state.activePlayerId === options.actingPlayerId;
  if (!isActivePlayer) return [];

  const legalActions: DeclareManifestLegalAction[] = [];

  for (const sourceCard of getOwnHandCards(
    options.state,
    options.actingPlayerId,
    options.getCardDefinitionById
  )) {
    if (sourceCard.controllerPlayerId !== options.actingPlayerId) continue;

    const sourceDefinition = options.getCardDefinitionById(
      sourceCard.definitionId
    );
    if (!sourceDefinition?.manifestData) continue;

    const manifestData = sourceDefinition.manifestData;

    if (
      !evaluateCondition(
        options.state,
        manifestData.condition ?? [],
        sourceCard.instanceId,
        options.actingPlayerId,
        options.getCardDefinitionById
      )
    )
      continue;

    const sourceTimings = filterRestrictedTimings(
      timings,
      options.state,
      options.actingPlayerId,
      undefined,
      options.getCardDefinitionById,
      undefined,
      sourceCard.zone,
      undefined,
      undefined,
      evaluateCondition
    );
    if (sourceTimings.length === 0) continue;

    // manifestTiming:"own_main_step" — main 窓のみ許可。
    if (!sourceTimings.includes("main")) continue;

    // 顕現は1コストを支払う効果召喚。通常召喚だけの禁止とは区別する。
    if (
      isCardUseRestricted(
        options.state,
        options.actingPlayerId,
        sourceCard,
        sourceDefinition,
        options.getCardDefinitionById,
        "summon",
        { byEffect: true, effectiveCost: 1 }
      )
    )
      continue;

    const targets = getManifestTargets(
      options.state,
      options.actingPlayerId,
      manifestData,
      options.getCardDefinitionById
    );
    if (targets.length === 0) continue;

    legalActions.push({
      kind: "declare_manifest",
      actionId: `legal:manifest:${sourceCard.instanceId}`,
      can: true,
      reason: "legal_declare_manifest",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: sourceCard.instanceId,
      sourceDefinitionId: sourceCard.definitionId,
      sourceCardNo: sourceDefinition.cardNo,
      candidateTargetInstanceIds: targets.map((t) => t.instanceId),
      targetMode: "manual",
      requiredTargetCount: 1,
      soulCoreDest: manifestData.soulCoreDest,
    });
  }

  return legalActions;
}

// ---------------------------------------------------------------------------
// 神技/導技/界放/契約技
// ---------------------------------------------------------------------------

/**
 * 神技のタイミングが現在のゲームステップに合致するか判定する。
 */
function isDivineSkillTimingMatch(
  timing: DivineSkillTiming,
  options: GetLegalActionsOptions,
  stackSourceContext?: {
    sourceInstanceId: string;
    sourceDefinitionId: string;
    sourceKind: NonNullable<
      import("../model").SuppressionEffectDescriptor["sourceKind"]
    >;
    effectIndex: number;
    label: string;
  }
): boolean {
  const { state, actingPlayerId } = options;

  if (typeof timing === "object") {
    if (state.step !== timing.step) return false;
    if (timing.subPhase === "end" && state.window !== "step_end") return false;
    if (timing.whose === "own" && state.activePlayerId !== actingPlayerId)
      return false;
    if (timing.whose === "opponent" && state.activePlayerId === actingPlayerId)
      return false;
    // 『アタックステップ』は期間の制限であり、フラッシュ窓の代わりにはならない。
    if (timing.mode) {
      return isDivineSkillTimingMatch(timing.mode, options, stackSourceContext);
    }
    // 終了時等、フラッシュ見出しを持たない技もスタック応答には使えない。
    return (
      state.stackWindow === null &&
      state.preDeclarationStackWindow === null &&
      state.activeAttack?.flashWindowState?.pendingStackAction == null
    );
  }

  if (timing === "flash_or_stack" || timing === "flash") {
    const rawTimings = getCurrentMagicActionTimingContext(options);
    // flashWindowState はスタック応答にも共有されるため、実際の実行窓を先に区別する。
    // 通常フラッシュでの発揮にはスタック禁止を適用しない。
    const mode = rawTimings?.raw.includes("flash") ? "flash" : "stack";
    if (mode === "stack" && timing !== "flash_or_stack") return false;
    // 通常起動効果と同じ窓・優先権判定を使う。期間指定のないフラッシュは
    // 自分のメインでも使える（10_rules/02_turn-flow-and-timing.md §Main Step）。
    if (rawTimings?.raw.includes(mode) !== true) return false;
    // フラッシュ/スタック禁止と発揮元ごとの抑止も共通判定に通す。
    return (
      filterRestrictedTimings(
        [mode],
        state,
        actingPlayerId,
        rawTimings.stackSourceInstanceId,
        options.getCardDefinitionById,
        rawTimings.stackSource,
        undefined,
        stackSourceContext?.sourceInstanceId,
        stackSourceContext
          ? {
              sourceDefinitionId: stackSourceContext.sourceDefinitionId,
              sourceKind: stackSourceContext.sourceKind,
              effectIndex: stackSourceContext.effectIndex,
              effectLabels: [stackSourceContext.label],
              keywords: [stackSourceContext.label],
              timingKind: "activated",
              activatedMode: mode,
              activationLabel: mode,
            }
          : undefined,
        evaluateCondition
      ).includes(mode) === true
    );
  }

  // 10_rules/02_turn-flow-and-timing.md:200-206 and
  // 20_design/08_stack-window-and-priority-loop.md:176-182:
  // stack response windows only allow mode:"stack" stack effects. Other DivineSkillTiming
  // variants have no stack variant, so those divine skills must not appear in those
  // response windows.
  if (
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    state.activeAttack?.flashWindowState?.pendingStackAction != null
  ) {
    return false;
  }

  if (timing === "main") {
    return (
      getCurrentMagicActionTimingContext(options)?.raw.includes("main") === true
    );
  }
  return false;
}

/** 終了時の神技が使用可能なら、通常の step_end 窓を開く。 */
export function hasEligibleStepEndDivineSkill(
  options: GetLegalActionsOptions
): boolean {
  const probe = {
    ...options,
    state: { ...options.state, window: "step_end" as const },
  };
  return getAvailableDivineSkillLegalActions(probe).some((action) => {
    const skill = options.getCardDefinitionById(action.sourceDefinitionId)
      ?.grandwalkerData?.divineSkills?.[action.skillIndex];
    return (
      skill &&
      typeof skill.timing === "object" &&
      skill.timing.subPhase === "end"
    );
  });
}

/**
 * DivineSkillCoreCost（固定値 or 範囲）を min/max へ正規化する。
 * 固定値は min=max=coreCost として扱う（ENGINE-divine-skill-variable-core-cost-range）。
 */
function divineSkillCoreCostBounds(coreCost: DivineSkillCoreCost): {
  min: number;
  max: number;
} {
  if (typeof coreCost === "number") return { min: coreCost, max: coreCost };
  return { min: coreCost.min, max: coreCost.max };
}

export function getAvailableDivineSkillLegalActions(
  options: GetLegalActionsOptions
): UseDivineSkillLegalAction[] {
  const legalActions: UseDivineSkillLegalAction[] = [];

  for (const card of options.state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== options.actingPlayerId) continue;

    const def = options.getCardDefinitionById(card.definitionId);
    if (!def || !isGrandwalkerOrGuidedNexus(def)) continue;
    if (!def.grandwalkerData?.divineSkills) continue;

    const cardLevel = getEffectiveLevel(
      options.state,
      card,
      def,
      options.getCardDefinitionById
    );

    for (let i = 0; i < def.grandwalkerData.divineSkills.length; i++) {
      const skill = def.grandwalkerData.divineSkills[i]!;

      if (
        !canDeclareDivineSkillEffect(
          options.state,
          card.instanceId,
          i,
          options.getCardDefinitionById
        )
      )
        continue;

      // タイミングチェック
      if (
        !isDivineSkillTimingMatch(skill.timing, options, {
          sourceInstanceId: card.instanceId,
          sourceDefinitionId: card.definitionId,
          sourceKind: getEffectDescriptorSourceKindForPrintedCategory(
            def.printedCategory
          ),
          effectIndex: i,
          label: skill.label,
        })
      ) {
        continue;
      }

      // レベルチェック
      const minLevel = skill.minLevel ?? 1;
      const maxLevel = skill.maxLevel ?? 99;
      if (cardLevel < minLevel || cardLevel > maxLevel) {
        continue;
      }

      // 宣言はスキルごとに1件。範囲コストは最小額を発揮前提とし、
      // 実際の2/3/4/5/6個の選択は応答窓を閉じた後に共通コアHUDで行う。
      const costBounds = divineSkillCoreCostBounds(skill.coreCost);
      if (card.normalCoreCount < costBounds.min) {
        continue;
      }

      // ターン制限チェック（maxUsesPerTurn 省略時=1。「ターンに2回」は 2）。
      if (skill.turnLimit) {
        const usedKey = getDivineSkillUsageKey({
          sourceInstanceId: card.instanceId,
          controllerPlayerId: card.controllerPlayerId,
          sourceCardNo: def.cardNo,
          skillIndex: i,
          turnLimit: skill.turnLimit,
        });
        const maxUses = skill.maxUsesPerTurn ?? 1;
        const usedCount = options.state.usedDivineSkillKeysThisTurn.filter(
          (k) => k === usedKey
        ).length;
        if (usedCount >= maxUses) {
          continue;
        }
      }

      legalActions.push({
        kind: "use_divine_skill",
        actionId: `legal:divine_skill:${card.instanceId}:${i}`,
        can: true,
        reason: "legal_use_divine_skill",
        actingPlayerId: options.actingPlayerId,
        sourceInstanceId: card.instanceId,
        sourceDefinitionId: card.definitionId,
        sourceCardNo: def.cardNo,
        skillIndex: i,
        label: skill.label,
        coreCost: costBounds.min,
        availableCores: card.normalCoreCount,
      });
    }
  }

  return legalActions;
}
