import { createEffectResolutionScope } from "../effect/effect-resolution-scope";
import { getObservedTriggerConditionResults } from "../effect/trigger-condition-observation";
import { hasPendingEffectResolution } from "../effect/pending-resolution-policy";
import { canActivateDivineSkillEffect } from "./divine-skill-usage";
import { canTriggerFromPendingLeaveSource } from "../zone/pending-leave-trigger-event-kind";
import { flushReadyEffectCompletions } from "../effect/effect-completion";
import { pruneIllegalPendingTriggeredEffects } from "../effect/trigger-system";
import {
  getTriggeredEffectSourceCardForUse,
  getTriggeredEffectSourceUseBlockReason,
} from "../effect/trigger-system";
import {
  stepChoicesForChoosingPlayer,
  stepPromptForChoosingPlayer,
} from "../effect/effect-step-prompt";
import { canActivateGrantedEffect } from "../mechanics/grant-effect-system";
import { getPendingTriggeredRebirthTimingWindowId } from "../effect/structured-card-replacement";
// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).
import {
  applyPostResolveTriggeredEffectHandling,
  buildCompositionAwareResolverLookup,
  buildFollowUpResolverLookup,
  flushPendingLeavesAfterRegisteredStayOnFieldChoiceResolved,
  flushPendingLeavesAfterReactionProgress,
  getCardDefinitionOrThrow,
  getCardInstanceOrThrow,
  getEffectResolutionSourceColors,
  maybeFinalizeBattleEndScopeAfterPendingDrain,
  getPendingTriggerSourceInstanceIds,
  getPendingTriggerSourcePlayerId,
  getPendingTriggerSourceTribes,
  movePrivateTriggeredMagicSourceToInUseIfReady,
  openQueuedBurstActivationDeclarationWindow,
  openQueuedBurstEffectDeclarationWindow,
} from "./legal-actions-apply";
import {
  getBattleImmediateTargetCandidateZones,
  isTargetStillPresentInCandidateZones,
  useBattleImmediateEffectAsAction,
} from "../battle/battle-immediate-effect-system";

import {
  finalizeResolvedBurstCard,
  getBurstPostResolutionDestination,
  hasPendingEffectsBeforeBurstEffect,
  hasPendingBurstActivationSelections,
  markBurstActivationEstablished,
  isBurstActivationSourceMoved,
  playBurstFollowUpCardWithoutPayingCost,
  useBurstFollowUpMagicCardWithoutPayingCost,
  playBurstSourceCardWithoutPayingCost,
  useBurstSourceMagicCardWithoutPayingCost,
} from "../mechanics/burst-system";

import { resolveDeferredFieldEffectStack } from "../card/card-effect-system";
import { resumeFieldMagicPreCostTriggerIfReady } from "./field-magic-pre-cost-trigger";
import {
  isActiveCombinedBraveEffectSource,
  isActiveTextRoleUnderEffectSource,
} from "../mechanics/star-garment-utils";
import {
  isActiveQuartzInheritedEffectSource,
  resolveDeferredSetQuartzStack,
} from "../mechanics/quartz-system";
import { runStateBasedActions } from "../state-based-actions";
import { resolveDeferredSetMirageStack } from "../mechanics/mirage-system";
import {
  executeHandWrittenEffectResolver,
  moveCompletedInUseMagicCardToTrashIfReady,
  processPendingImmediateBattleEnds,
} from "../effect/effect-resolution";
import { startDeferredExtraTurnIfReady } from "../effect/structured-state-grants";
import { resolveDeferredMagicStack } from "../mechanics/magic-system";
import {
  resolveDeferredAccelStack,
  resolveDeferredChangeStack,
} from "../mechanics/accel-change-system";

import type {
  ActiveStack,
  BurstFollowUpInfo,
  CardDefinition,
  ContinuousEffect,
  GameState,
  PendingEffectTargetGroup,
  PendingAsIfSoulCoreChoiceKind,
  PendingAsIfSoulCoreChoiceOption,
  PendingAfterTriggersContinuation,
  PendingStackNegateRequest,
  TargetedDisclosureResolutionCleanup,
  TargetedDisclosureContinuation,
} from "../model";
import {
  immuneProtectedCount,
  isPendingStackNegateRequestExpired,
} from "../model";
import type { EffectTargetFilter } from "../dsl-types";

import {
  applyBurstActivationImmunity,
  collectAndQueueTriggerReactions,
  finalizeCardUsageAndQueueTriggers,
  isBurstRelatedInstanceOffField,
  makeResolvedTriggeredSourceKey,
  queueEffectDeclarationTriggers,
  removeBurstActivationImmunity,
  useResolvePendingBurstCheckAsAction,
  useResolvePendingTriggeredEffectAsAction,
} from "../effect/trigger-system";
import type { ApplyLegalActionOptions } from "./legal-actions-types";
import type {
  DeferredStackResolver,
  DeferredStackResolverOptions,
} from "./stack-resolution-types";
import {
  stackMatchesNegateAction,
  type StackNegateActionLike,
} from "../stack/stack-negate";
import { evaluateCondition } from "../effect/structured-effect-interpreter";
import { refundAllRecordedUsage } from "../effect/native-effect-front-helpers";
import { getEffectStepChoiceOptions } from "../effect/structured-effect-registrations";
import { executeEnterSoulState } from "../effect/structured-soul-state";

import { getEnterFieldCorePlacementPolicy } from "../zone/enter-field-placement-policy";
import {
  applyEnterFieldCorePlacements,
  assertEnterFieldCorePlacementsAllowed,
  getPlacedCoreCount,
} from "../zone/enter-field-placement-execution";
import {
  buildReevaluationConfig,
  evaluateSummonDeclarationGate,
  getEffectiveTribes,
  isBurstEffectNullifiedByOpponent,
  getSummonTrashCorePlacementGrant,
  getTenshoTargetCandidates,
} from "./legal-actions-shared";

import type { EffectFilterTag } from "../state-based-actions";
import {
  hasPendingLeaveResolutionChoice,
  hasOutstandingEffectResolutionContinuation,
  isChainAtOrUnder,
} from "../state-based-actions";
import {
  queuePreFlushGrantedEffectsAndFlushPendingLeaves,
  flushPendingLeavesAndQueueReactions,
} from "../zone/pending-leave-flush";
import { resolveDeferredPlayCardStack } from "../play/play-card-system";
import {
  moveFailedPlayCardGroupToTrash,
  rollbackNormalHandPlayAfterStack,
} from "../play/play-card-resolution";
import { appendPublicDisclosuresForStateTransition } from "../public-disclosure";

import {
  getValidBraveCombineHosts,
  getAvailablePlacementCoreCount,
} from "./legal-actions-availability";
import { getCardById } from "../card/card-lookup";

import { isCEActiveForScope } from "../card/ce-lookup";
import {
  getBattleEndFinalizeAttackIdForActiveStack,
  getBattleEndFinalizeAttackIdForPending,
} from "../battle/battle-end-scope-finalize";

import { computePayToActCoreGate } from "./pay-to-act-core-gate";
import { computePayToActHandDiscardGate } from "./pay-to-act-hand-discard-gate";
import {
  getPaidLeaveSuppressionImmunityOffer,
  getPaidPreventionImmunityOffer,
} from "../effect/effect-resistance-check";

import {
  advanceAttackDeclarationStateIfReady,
  maybeQueueEffectActivationBurstCheck,
} from "./attack-burst-flow";
import {
  getDeferredOptionalRepeatChoiceSelection,
  getActiveStackEffectIndex,
  getBurstIgnoresOpponentCannotActivateBurst,
  getStackTargetSelection,
  lookupRegistrationForStack,
} from "./stack-target-resolution";
import {
  applyPendingCoreDistributionAction,
  checkAndQueuePostResolutionOracleIfReady,
  resolveContinuationEffect,
  resumeUseCostGateCoreMoveAfterMagicIfReady,
} from "./pending-action-handlers";

import {
  prepareDivineSkillCorePayment,
  resolveDeferredDivineSkillStack,
  resolveDeferredGrantedActivatedEffectStack,
  resolveMechanicTriggeredEffectCore,
} from "./mechanic-trigger-handlers";
import {
  getContractCombineAsIfSoulCoreChoiceOptions,
  resolveDeferredContractCombineStack,
} from "../mechanics/contract-combine-system";
import { resolveDeferredLinkAidStack } from "../mechanics/link-aid-system";
import {
  getAdventAsIfSoulCoreChoiceOptions,
  resolveDeferredAdventStack,
} from "../mechanics/advent-system";
import {
  getHostDualAdventAsIfSoulCoreChoiceOptions,
  resolveDeferredHostDualAdventStack,
} from "../mechanics/host-dual-advent";
import { resolveDeferredDualHostAdventStack } from "../mechanics/multi-host-advent";
import { resolveDeferredManifestStack } from "../mechanics/manifest-system";
import { resolveDeferredFlipInsteadOfAttackStack } from "../effect/structured-card-replacement";
import { filterTargetsStillInSnapshottedZones } from "../effect/targeted-disclosure-target-snapshot";
import { allocateGroupedTargetsByStep } from "../effect/native-target-resolution";

/**
 * deferred magic の対象選択が最後の pending だった場合、通常の post-resolution
 * carrier が再読される前に useCostGate の外側 core_move continuation を再開する。
 */
export function resumeUseCostGateCoreMoveAfterDeferredMagicTargetIfReady(
  state: GameState,
  activeStack: ActiveStack,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): GameState {
  return resumeUseCostGateCoreMoveAfterMagicIfReady(
    state,
    activeStack.postResolutionOracle,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      ...(options.getRegisteredBurstActions !== undefined
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
    }
  );
}

/**
 * Deferred target presence revalidation happens after a legal declaration has
 * already allocated every selected target to its group.  Keep that declaration
 * invariant intact, but lower only the resolution-time minimum for selections
 * which have since left their snapshotted candidate zone.  The common grouped
 * allocator can then route every surviving selection to its original step
 * without treating a fizzled target as a fresh declaration failure.
 */
function relaxGroupedTargetRequirementsForFizzledSelections(options: {
  targetInstanceIds: readonly string[];
  presentTargetInstanceIds: readonly string[];
  targetGroups: readonly PendingEffectTargetGroup[] | undefined;
}): readonly PendingEffectTargetGroup[] | undefined {
  const { targetInstanceIds, presentTargetInstanceIds, targetGroups } = options;
  if (
    targetGroups === undefined ||
    targetGroups.length === 0 ||
    targetInstanceIds.length === presentTargetInstanceIds.length
  ) {
    return targetGroups;
  }

  const declaredAllocation = allocateGroupedTargetsByStep({
    targetInstanceIds,
    targetGroups,
  });
  const remainingOccurrences = new Map<string, number>();
  for (const id of presentTargetInstanceIds) {
    remainingOccurrences.set(id, (remainingOccurrences.get(id) ?? 0) + 1);
  }
  const fizzledByGroup = new Map<number, number>();
  for (
    let targetIndex = 0;
    targetIndex < targetInstanceIds.length;
    targetIndex++
  ) {
    const id = targetInstanceIds[targetIndex]!;
    const remaining = remainingOccurrences.get(id) ?? 0;
    if (remaining > 0) {
      remainingOccurrences.set(id, remaining - 1);
      continue;
    }
    const groupIndex =
      declaredAllocation.groupIndexByTargetIndex.get(targetIndex);
    if (groupIndex !== undefined) {
      fizzledByGroup.set(groupIndex, (fizzledByGroup.get(groupIndex) ?? 0) + 1);
    }
  }

  return targetGroups.map((group, groupIndex) => {
    const fizzledCount = fizzledByGroup.get(groupIndex) ?? 0;
    if (fizzledCount === 0) return group;
    return {
      ...group,
      requiredTargetCount: Math.max(
        0,
        group.requiredTargetCount - fizzledCount
      ),
    };
  });
}

function isDeferredTriggeredSourceUnavailable(
  state: GameState,
  stack: ActiveStack,
  options: Pick<
    ApplyLegalActionOptions,
    "getCardDefinitionById" | "getRegisteredTriggeredEffectActions"
  >
): boolean {
  const pending = stack.triggeredPendingSnapshot;
  if (!pending || pending.mechanic || stack.triggeredSourceKind === undefined)
    return false;
  // 合体・継承など別カードから得た効果は、所属検査と使用回数の取消を伴う
  // resolveDeferredStackActionCore の既存終了経路に任せる。
  if (
    stack.effectSourceInstanceId !== undefined &&
    stack.effectSourceInstanceId !== stack.cardInstanceId
  )
    return false;
  const source = getCardById(state, stack.cardInstanceId);
  const definition =
    source && options.getCardDefinitionById(source.definitionId);
  if (!source || !definition) return true;
  const registration =
    stack.triggeredSourceCardNo !== undefined &&
    stack.triggeredRegistrationIndex !== undefined
      ? options.getRegisteredTriggeredEffectActions?.(
          stack.triggeredSourceCardNo
        )?.[stack.triggeredRegistrationIndex]
      : undefined;
  const effectDefinition = options.getCardDefinitionById(
    stack.effectSourceDefinitionId ??
      stack.triggeredSourceCardNo ??
      definition.cardNo
  );
  const effect =
    registration?.effectIndex !== undefined
      ? effectDefinition?.effects?.[registration.effectIndex]
      : undefined;
  return (
    getTriggeredEffectSourceUseBlockReason(
      stack.actingPlayerId,
      stack.triggeredSourceKind,
      getTriggeredEffectSourceCardForUse(source, pending, effect),
      definition,
      undefined,
      registration?.sourceZone,
      state,
      options.getCardDefinitionById
    ) !== null
  );
}

export function resolveDeferredTriggeredEffectStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getHandWrittenEffectResolver"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
    | "getRegisteredBattleImmediateEffectActions"
    | "getConditionalCostCanExecuteCheck"
    | "getConditionalResultSuccessCheck"
    | "resolvePendingTriggeredEffect"
    | "getPendingTriggeredEffectResolver"
    | "getRegisteredMagicActions"
  >
): GameState {
  const pendingSnapshot = resolvedStack.triggeredPendingSnapshot;
  if (!pendingSnapshot) {
    throw new Error(
      `Deferred triggered_effect stack missing pending snapshot: stackId=${resolvedStack.stackId}`
    );
  }

  const sourceInstanceId = resolvedStack.cardInstanceId;
  const registrationIndex = resolvedStack.triggeredRegistrationIndex;
  const actingPlayerId = resolvedStack.actingPlayerId;

  const source = getCardById(state, sourceInstanceId);
  const blockedByPendingLeave =
    !pendingSnapshot.mechanic &&
    source !== undefined &&
    !canTriggerFromPendingLeaveSource(state, source, pendingSnapshot);
  const blockedBySource = isDeferredTriggeredSourceUnavailable(
    state,
    resolvedStack,
    options
  );
  if (resolvedStack.isNullified || blockedByPendingLeave || blockedBySource) {
    const resolvedSourceInstanceId =
      resolvedStack.effectSourceInstanceId ?? sourceInstanceId;
    const nullifiedState: GameState = {
      ...state,
      log: [
        ...state.log,
        blockedBySource
          ? `effect:fizzled:source-unavailable:${resolvedStack.chainId}:${resolvedSourceInstanceId}`
          : blockedByPendingLeave
            ? `effect:fizzled:pending-leave:${resolvedStack.chainId}:${resolvedSourceInstanceId}`
            : `effect:nullified:${resolvedStack.chainId}:${resolvedSourceInstanceId}`,
      ],
    };
    if (pendingSnapshot.mechanic) {
      return advanceAttackDeclarationStateIfReady(nullifiedState, options);
    }
    const afterPostResolve = applyPostResolveTriggeredEffectHandling({
      state: nullifiedState,
      pendingEffect: pendingSnapshot,
      resolvedSourceInstanceId,
      resolvedSourceRegistrationIndex: registrationIndex,
      options,
    });
    const remainingFlushGuardStacks =
      afterPostResolve.pendingStackCascadeFlushGuardStacks?.filter(
        (stack) => stack.stackId !== resolvedStack.stackId
      );
    return flushPendingLeavesAfterRegisteredStayOnFieldChoiceResolved({
      state:
        remainingFlushGuardStacks === undefined
          ? afterPostResolve
          : {
              ...afterPostResolve,
              pendingStackCascadeFlushGuardStacks: remainingFlushGuardStacks,
            },
      pendingEffect: pendingSnapshot,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }

  // P3-92: mechanic 付き誘発 (神託/解封/創界石転醒) はカード効果 registration を
  // 持たないため、窓クローズ後にここで機構ロジックを直接実行する。
  // ソース消失等の再検証は各 mechanic resolver が graceful no-op で行う。
  if (pendingSnapshot.mechanic) {
    const resolvedState = resolveMechanicTriggeredEffectCore(
      state,
      pendingSnapshot,
      true,
      options
    );
    return advanceAttackDeclarationStateIfReady(resolvedState, options);
  }

  const sourceKind = resolvedStack.triggeredSourceKind;
  const sourceCardNo = resolvedStack.triggeredSourceCardNo;

  // registrationIndex / sourceCardNo は requeue 経路で再利用するために保持。
  // composition / reevaluation は ActiveStack 側のスナップショットを使う。
  void registrationIndex;

  // P3-51: triggered registration の effectIndex を引き出す。
  // tryExecuteEffects が同一 timing の他 effect を重複発動しないようにする。
  const deferredTriggeredRegistration =
    sourceCardNo !== undefined && registrationIndex !== undefined
      ? options.getRegisteredTriggeredEffectActions?.(sourceCardNo)?.[
          registrationIndex
        ]
      : undefined;
  const deferredTargetEffectIndex = deferredTriggeredRegistration?.effectIndex;

  // composition wrapping: declaration 時に ActiveStack へ保存した composition を再適用
  const effectiveHandWrittenEffectResolverLookup =
    sourceCardNo !== undefined
      ? (buildCompositionAwareResolverLookup({
          baseLookup: options.getHandWrittenEffectResolver,
          cardNo: sourceCardNo,
          composition: resolvedStack.composition,
          getConditionalCostCanExecuteCheck:
            options.getConditionalCostCanExecuteCheck,
          getConditionalResultSuccessCheck:
            options.getConditionalResultSuccessCheck,
        }) ?? options.getHandWrittenEffectResolver)
      : options.getHandWrittenEffectResolver;

  // sourceBackedResolver を再構築 (declaration 時と同等の closure)
  const targetInstanceIds = resolvedStack.targetInstanceIds;
  const targetStepId = resolvedStack.targetStepId;
  const chosenLifeCoreKind = resolvedStack.chosenLifeCoreKind;
  const choiceIndex = resolvedStack.triggeredChoiceIndex;
  const getCardDefinitionById = options.getCardDefinitionById;
  const handWrittenLookup = effectiveHandWrittenEffectResolverLookup;
  const triggeredSourceRegistrationKey =
    registrationIndex !== undefined
      ? makeResolvedTriggeredSourceKey(
          resolvedStack.effectSourceInstanceId ?? sourceInstanceId,
          registrationIndex
        )
      : undefined;
  const triggeredRelatedInstanceIds =
    triggeredSourceRegistrationKey !== undefined
      ? (pendingSnapshot.relatedInstanceIdsBySourceRegistrationKey?.[
          triggeredSourceRegistrationKey
        ] ?? pendingSnapshot.relatedInstanceIds)
      : pendingSnapshot.relatedInstanceIds;
  // engine-effect-tribe-tag-life-increase-trigger: 原因カードの実効系統 (+ 効果メタ
  // 系統タグ) を trigger_tribes/trigger_source_match 条件評価用に伝搬する
  // (BSTH03-X02「自分の系統：「蓬莱」を持つ効果で、自分のライフが増えたとき」)。
  // legal-actions-apply.ts の resolve_pending_triggered_effect 宣言時と同じ導出を、
  // スタック窓クローズ後のこの再構築 closure でも行う (declare 時 context は
  // ActiveStack へ持ち越されない)。
  const triggerSourceTribes = getPendingTriggerSourceTribes(
    state,
    pendingSnapshot,
    getCardDefinitionById
  );
  // engine-effect-tribe-tag-life-increase-trigger: 原因カードのコントローラーを
  // trigger_source_player 条件評価用に伝搬する（declare 時と同じ導出）。
  const triggerSourcePlayerId = getPendingTriggerSourcePlayerId(
    state,
    pendingSnapshot
  );
  // BSTH07-転醒R01(A)「このネクサス以外の」等、trigger_tribes.excludeSelfSource
  // 評価用に発生源カードの instanceId を伝搬する（declare 時と同じ導出）。
  const triggerSourceInstanceId = getPendingTriggerSourceInstanceIds(
    pendingSnapshot
  )[0] as string | undefined;
  // ENGINE-conditional-free-magic-use-target-selection: use_magic_without_cost
  // の同期解決経路から、対象選択が必要な場合に本物の pendingEffectTargetSelection を
  // 生成できるようにする窓口。resolveDeferredStackAction は本ファイル内定義のため
  // options をそのまま渡せる (SSOT: 対象選択延期ロジックの重複実装を避ける)。
  const resolveDeferredStackForFreeMagicUse = (
    freeUseState: GameState,
    syntheticStack: ActiveStack
  ): GameState =>
    resolveDeferredStackAction(freeUseState, syntheticStack, options);
  const pendingBattleEndDeferralAttackId =
    getBattleEndFinalizeAttackIdForPending(pendingSnapshot);
  const sourceBackedResolver =
    sourceKind !== undefined
      ? (currentState: GameState, context: { chainId: string }) => {
          const preparedSource = movePrivateTriggeredMagicSourceToInUseIfReady({
            state: currentState,
            pendingEffect: pendingSnapshot,
            sourceInstanceId,
            getCardDefinitionById,
          });
          const resolutionState = preparedSource.state;
          const sourceCard = getCardInstanceOrThrow(
            resolutionState,
            sourceInstanceId,
            "Unknown deferred triggered source card"
          );
          const sourceDefinition = getCardDefinitionOrThrow(
            sourceCard.definitionId,
            getCardDefinitionById
          );
          const effectSourceDefinition =
            resolvedStack.effectSourceDefinitionId !== undefined
              ? getCardDefinitionOrThrow(
                  resolvedStack.effectSourceDefinitionId,
                  getCardDefinitionById
                )
              : undefined;
          return executeHandWrittenEffectResolver({
            state: resolutionState,
            context: {
              chainId: context.chainId,
              resolutionKind: "pending_triggered_effect",
              effectEventAction: pendingSnapshot.eventKind,
              actingPlayerId,
              sourceKind,
              sourceCard,
              sourceDefinition,
              ...(effectSourceDefinition !== undefined
                ? { effectSourceDefinition }
                : {}),
              ...(resolvedStack.effectSourceInstanceId !== undefined
                ? {
                    effectSourceInstanceId:
                      resolvedStack.effectSourceInstanceId,
                  }
                : {}),
              ...(resolvedStack.effectSourceDefinitionId !== undefined
                ? {
                    effectSourceDefinitionId:
                      resolvedStack.effectSourceDefinitionId,
                  }
                : {}),
              targetInstanceIds,
              ...(resolvedStack.targetGroups !== undefined
                ? { targetGroups: resolvedStack.targetGroups }
                : {}),
              ...(resolvedStack.optionalRepeatTargetCount !== undefined
                ? {
                    optionalRepeatTargetCount:
                      resolvedStack.optionalRepeatTargetCount,
                  }
                : {}),
              ...(resolvedStack.preservePreSelectedTargetRefs === true
                ? { preservePreSelectedTargetRefs: true }
                : {}),
              ...(targetStepId !== undefined ? { targetStepId } : {}),
              getCardDefinitionById,
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
              ...(chosenLifeCoreKind !== undefined
                ? { chosenLifeCoreKind }
                : {}),
              ...(choiceIndex !== undefined ? { choiceIndex } : {}),
              rebirthTimingWindowId: getPendingTriggeredRebirthTimingWindowId(
                pendingSnapshot,
                sourceCard.controllerPlayerId
              ),
              triggeredRootConditionResults:
                triggeredSourceRegistrationKey !== undefined
                  ? getObservedTriggerConditionResults(
                      pendingSnapshot.timingSourceRegistrations?.[
                        triggeredSourceRegistrationKey
                      ]
                    )
                  : undefined,
              ...(pendingSnapshot.simultaneousGroupId !== undefined
                ? {
                    pendingEffectSimultaneousGroupId:
                      pendingSnapshot.simultaneousGroupId,
                  }
                : {}),
              // P3-14 C-5: イベント量を DynamicCount.event_amount へ伝播。
              ...(pendingSnapshot.amount !== null
                ? { eventAmount: pendingSnapshot.amount }
                : {}),
              // 三者観測 game_event の主語 Y を TargetSpec.trigger_related_instance に伝播。
              ...(pendingSnapshot.relatedInstanceId
                ? {
                    triggerRelatedInstanceId: pendingSnapshot.relatedInstanceId,
                  }
                : {}),
              ...(pendingSnapshot.triggerRelatedCombinedHostInstanceId !==
              undefined
                ? {
                    triggerRelatedCombinedHostInstanceId:
                      pendingSnapshot.triggerRelatedCombinedHostInstanceId,
                  }
                : {}),
              ...(triggeredRelatedInstanceIds !== undefined
                ? {
                    triggerRelatedInstanceIds: triggeredRelatedInstanceIds,
                  }
                : {}),
              // engine-advent-source-leave-summon (BSSG01-C08 Lv2)
              ...(pendingSnapshot.adventSourceInstanceIds !== undefined
                ? {
                    triggerAdventSourceInstanceIds:
                      pendingSnapshot.adventSourceInstanceIds,
                  }
                : {}),
              ...(pendingBattleEndDeferralAttackId !== undefined
                ? {
                    battleEndDeferralAttackId: pendingBattleEndDeferralAttackId,
                  }
                : {}),
              ...(pendingSnapshot.fromZone !== undefined
                ? { triggerFromZone: pendingSnapshot.fromZone }
                : {}),
              ...(pendingSnapshot.cause !== undefined
                ? { triggerCause: pendingSnapshot.cause }
                : {}),
              ...(preparedSource.activationZone !== undefined
                ? { activationZone: preparedSource.activationZone }
                : {}),
              // ENGINE-targeted-disclosure-offfield-source: relatedInstanceId の
              // 現在ゾーンを trigger_related_instance_off_field 条件の解決時再評価へ
              // 渡す (legal-actions-apply.ts の resolve_pending_triggered_effect
              // ハンドラと同型の derivation)。
              ...(pendingSnapshot.relatedInstanceId
                ? (() => {
                    const relatedCard = getCardById(
                      resolutionState,
                      pendingSnapshot.relatedInstanceId
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
              ...(resolvedStack.payCostPaymentSources !== undefined
                ? {
                    payCostPaymentSources: resolvedStack.payCostPaymentSources,
                  }
                : {}),
              ...(resolvedStack.deferPayCostSourceSelection === true
                ? { allowPendingPayCostSourceAllocation: true }
                : {}),
              ...(resolvedStack.summonPaymentSources !== undefined
                ? {
                    summonPaymentSources: resolvedStack.summonPaymentSources,
                  }
                : {}),
              ...(resolvedStack.summonEnterFieldCorePlacements !== undefined
                ? {
                    summonEnterFieldCorePlacements:
                      resolvedStack.summonEnterFieldCorePlacements,
                  }
                : {}),
              // P3-43: triggered registration の preventionLevel を伝搬。
              ...(resolvedStack.preventionLevel !== undefined
                ? { sourcePreventionLevel: resolvedStack.preventionLevel }
                : {}),
              ...(resolvedStack.preventionBypass !== undefined
                ? { sourcePreventionBypass: resolvedStack.preventionBypass }
                : {}),
              // P3-51: triggered registration の effectIndex を伝搬。
              ...(deferredTargetEffectIndex !== undefined
                ? { targetEffectIndex: deferredTargetEffectIndex }
                : {}),
              // P3-62: 宣言時に積んだ usageLimit 払戻情報を deferred 解決へ復元。
              ...(resolvedStack.recordedUsage
                ? { recordedUsage: resolvedStack.recordedUsage }
                : {}),
              targetedDisclosureNegateIdentity: resolvedStack,
            },
            getResolver: handWrittenLookup ?? (() => undefined),
          });
        }
      : undefined;

  // pending を再 insert してから既存 helper で解決する
  const stateWithPending: GameState = {
    ...state,
    pendingTriggeredEffects: [
      pendingSnapshot,
      ...state.pendingTriggeredEffects.filter(
        (p) => p.pendingId !== pendingSnapshot.pendingId
      ),
    ],
  };

  const result = useResolvePendingTriggeredEffectAsAction({
    state: stateWithPending,
    actingPlayerId,
    pendingId: pendingSnapshot.pendingId,
    ...(options.resolvePendingTriggeredEffect
      ? { resolveEffect: options.resolvePendingTriggeredEffect }
      : sourceBackedResolver
        ? { resolveEffect: sourceBackedResolver }
        : {}),
    ...(options.resolvePendingTriggeredEffect || sourceBackedResolver
      ? {}
      : options.getPendingTriggeredEffectResolver
        ? { getResolver: options.getPendingTriggeredEffectResolver }
        : {}),
    ...(resolvedStack.reevaluationPoints?.length
      ? {
          reevaluation: buildReevaluationConfig(
            {
              reevaluationPoints: resolvedStack.reevaluationPoints,
              ...(resolvedStack.preventionLevel !== undefined
                ? { preventionLevel: resolvedStack.preventionLevel }
                : {}),
              ...(resolvedStack.suppressionEffectDescriptor
                ? {
                    suppressionEffectDescriptor:
                      resolvedStack.suppressionEffectDescriptor,
                  }
                : {}),
            },
            sourceInstanceId,
            targetInstanceIds
          )!,
        }
      : {}),
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedBySourceInstanceId:
      resolvedStack.effectSourceInstanceId ?? sourceInstanceId,
    ...(resolvedStack.supplementalTriggerEvents !== undefined
      ? { supplementalTriggerEvents: resolvedStack.supplementalTriggerEvents }
      : {}),
    // engine-generic-effect-activation-causal-trigger: 解決開始時 choice で対価を支払って
    // いれば、この host (sourceInstanceId) 自身の効果解決によってフィールドを
    // 離れるカードの離脱誘発効果を flush 前に抑制する (BSGE01-R02)。
    ...(resolvedStack.suppressCausedLeaveEffects === true
      ? { suppressCausedLeaveEffectsForSourceInstanceId: sourceInstanceId }
      : {}),
  });

  const afterPostResolve = applyPostResolveTriggeredEffectHandling({
    state: result.state,
    pendingEffect: pendingSnapshot,
    resolvedSourceInstanceId:
      resolvedStack.effectSourceInstanceId ?? sourceInstanceId,
    resolvedSourceRegistrationIndex: registrationIndex,
    options,
  });
  const remainingFlushGuardStacks =
    afterPostResolve.pendingStackCascadeFlushGuardStacks?.filter(
      (stack) => stack.stackId !== resolvedStack.stackId
    );
  const afterStayChoiceFlush =
    flushPendingLeavesAfterRegisteredStayOnFieldChoiceResolved({
      state:
        remainingFlushGuardStacks === undefined
          ? afterPostResolve
          : {
              ...afterPostResolve,
              pendingStackCascadeFlushGuardStacks: remainingFlushGuardStacks,
            },
      pendingEffect: pendingSnapshot,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

  return maybeQueueEffectActivationBurstCheck({
    state: afterStayChoiceFlush,
    pendingEffect: pendingSnapshot,
    resolvedSourceInstanceId: sourceInstanceId,
    options,
  });
}

export function resolveDeferredBattleImmediateEffectStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: Pick<
    ApplyLegalActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredTriggeredEffectActions"
    | "getHandWrittenEffectResolver"
    | "getRegisteredBattleImmediateEffectActions"
    | "getRegisteredMagicActions"
    | "getConditionalCostCanExecuteCheck"
    | "getConditionalResultSuccessCheck"
    | "resolveFieldCardEffect"
    | "getRegisteredBurstActions"
  >
): GameState {
  const promptSnapshot = resolvedStack.battleImmediatePromptSnapshot;
  if (!promptSnapshot) {
    throw new Error(
      `Deferred battle_immediate_effect stack missing prompt snapshot: stackId=${resolvedStack.stackId}`
    );
  }

  const sourceCardNo = resolvedStack.battleImmediateSourceCardNo;
  const sourceKind = resolvedStack.battleImmediateSourceKind;
  if (!sourceCardNo || !sourceKind) {
    throw new Error(
      `Deferred battle_immediate_effect stack missing source metadata: stackId=${resolvedStack.stackId}`
    );
  }

  if (resolvedStack.isNullified) {
    return resumeStackCascadeIfReady(
      advanceAttackDeclarationStateIfReady(
        {
          ...state,
          log: [
            ...state.log,
            `effect:nullified:${resolvedStack.chainId}:${resolvedStack.cardInstanceId}`,
          ],
        },
        options
      ),
      options
    );
  }

  // composition wrapping: declaration 時に ActiveStack へ保存した composition を再適用
  const composedResolver = buildCompositionAwareResolverLookup({
    baseLookup: options.getHandWrittenEffectResolver,
    cardNo: sourceCardNo,
    composition: resolvedStack.composition,
    getConditionalCostCanExecuteCheck:
      options.getConditionalCostCanExecuteCheck,
    getConditionalResultSuccessCheck: options.getConditionalResultSuccessCheck,
  })?.(sourceCardNo);

  // 宣言後に積まれた stack 効果で source が場を離れた場合、deferred battle
  // immediate は再度の発揮前提を満たさない。ここで prompt を drain して cascade を
  // 継続する。`useBattleImmediateEffectAsAction` に委ねると source-on-field の
  // invariant 例外になり、残った prompt を抱えたまま training が advanceStep する。
  const sourceCard = getCardById(state, resolvedStack.cardInstanceId);
  if (!sourceCard || sourceCard.zone !== "field") {
    const stateAfterUsageRefund = resolvedStack.recordedUsage
      ? refundAllRecordedUsage(
          state,
          resolvedStack.cardInstanceId,
          resolvedStack.recordedUsage
        )
      : state;
    const fizzledState: GameState = {
      ...stateAfterUsageRefund,
      battleImmediateEffects:
        stateAfterUsageRefund.battleImmediateEffects.filter(
          (prompt) => prompt.promptId !== promptSnapshot.promptId
        ),
      log: [
        ...stateAfterUsageRefund.log,
        `effect:effect-fizzled:${resolvedStack.chainId}:battle-immediate-source-not-on-field`,
      ],
    };
    return resumeStackCascadeIfReady(
      advanceAttackDeclarationStateIfReady(fizzledState, options),
      options
    );
  }

  // 対象開示への応答中に選んだ対象が対象 zone を離れることがある。deferred 再開では
  // その対象だけを取り除く。一方、effect immunity / prevention は宣言済み TargetRef を
  // 失わせず、本体実行の affect gate で対象ごとに不発化する (03b:112-115)。
  const targetEffectFilterTags =
    resolvedStack.targetEffectFilterTags as readonly EffectFilterTag[];
  const presentTargetInstanceIds = resolvedStack.targetInstanceIds.filter(
    (id) =>
      isTargetStillPresentInCandidateZones(
        state,
        id,
        getBattleImmediateTargetCandidateZones(
          id,
          resolvedStack.targetGroups,
          resolvedStack.candidateTargetZones
        )
      )
  );
  const invalidTargetInstanceIds = resolvedStack.targetInstanceIds.filter(
    (id) => !presentTargetInstanceIds.includes(id)
  );
  const targetGroupsAfterPresenceRevalidation =
    relaxGroupedTargetRequirementsForFizzledSelections({
      targetInstanceIds: resolvedStack.targetInstanceIds,
      presentTargetInstanceIds,
      targetGroups: resolvedStack.targetGroups,
    });

  // prompt を再 insert してから既存 helper で解決する
  const stateWithPrompt: GameState = {
    ...state,
    battleImmediateEffects: [
      promptSnapshot,
      ...state.battleImmediateEffects.filter(
        (p) => p.promptId !== promptSnapshot.promptId
      ),
    ],
    ...(invalidTargetInstanceIds.length > 0
      ? {
          log: [
            ...state.log,
            `battle:immediate:targets-fizzled:${resolvedStack.chainId}:${invalidTargetInstanceIds.join(",")}`,
          ],
        }
      : {}),
  };

  const reevaluation = resolvedStack.reevaluationPoints?.length
    ? buildReevaluationConfig(
        {
          reevaluationPoints: resolvedStack.reevaluationPoints,
          ...(resolvedStack.preventionLevel !== undefined
            ? { preventionLevel: resolvedStack.preventionLevel }
            : {}),
          ...(resolvedStack.suppressionEffectDescriptor
            ? {
                suppressionEffectDescriptor:
                  resolvedStack.suppressionEffectDescriptor,
              }
            : {}),
        },
        resolvedStack.cardInstanceId,
        resolvedStack.targetInstanceIds
      )
    : undefined;

  const result = useBattleImmediateEffectAsAction({
    state: stateWithPrompt,
    actingPlayerId: resolvedStack.actingPlayerId,
    promptId: promptSnapshot.promptId,
    sourceInstanceId: resolvedStack.cardInstanceId,
    sourceKind,
    targetInstanceIds: presentTargetInstanceIds,
    targetRevalidationMode: "presence_only",
    ...(resolvedStack.targetSelectionResolved === true
      ? { preservePreSelectedTargetRefs: true }
      : {}),
    ...(resolvedStack.targetStepId !== undefined
      ? { targetStepId: resolvedStack.targetStepId }
      : {}),
    ...(targetGroupsAfterPresenceRevalidation !== undefined
      ? { targetGroups: targetGroupsAfterPresenceRevalidation }
      : {}),
    ...(resolvedStack.candidateTargetZones !== undefined
      ? { candidateTargetZones: resolvedStack.candidateTargetZones }
      : {}),
    targetEffectFilterTags,
    ...(resolvedStack.battleImmediatePreventionLevel !== undefined
      ? { sourcePreventionLevel: resolvedStack.battleImmediatePreventionLevel }
      : {}),
    ...(resolvedStack.preventionBypass !== undefined
      ? { sourcePreventionBypass: resolvedStack.preventionBypass }
      : {}),
    ...(resolvedStack.battleImmediateChoiceIndex !== undefined
      ? { choiceIndex: resolvedStack.battleImmediateChoiceIndex }
      : {}),
    ...(resolvedStack.optionalRepeatTargetCount !== undefined
      ? {
          optionalRepeatTargetCount: resolvedStack.optionalRepeatTargetCount,
        }
      : {}),
    ...(resolvedStack.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: resolvedStack.payCostPaymentSources }
      : {}),
    ...(resolvedStack.deferPayCostSourceSelection === true
      ? { allowPendingPayCostSourceAllocation: true }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.resolveFieldCardEffect
      ? { resolveEffect: options.resolveFieldCardEffect }
      : composedResolver
        ? { resolveEffect: composedResolver }
        : {}),
    ...(options.getHandWrittenEffectResolver
      ? { getHandWrittenEffectResolver: options.getHandWrittenEffectResolver }
      : {}),
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.getRegisteredMagicActions
      ? { getRegisteredMagicActions: options.getRegisteredMagicActions }
      : {}),
    ...(reevaluation ? { reevaluation } : {}),
    // P3-62: 宣言時に積んだ usageLimit 払戻情報を deferred 解決へ復元。
    ...(resolvedStack.recordedUsage
      ? { recordedUsage: resolvedStack.recordedUsage }
      : {}),
    ...(resolvedStack.supplementalTriggerEvents !== undefined
      ? { supplementalTriggerEvents: resolvedStack.supplementalTriggerEvents }
      : {}),
    ...(resolvedStack.suppressCausedLeaveEffects === true
      ? {
          suppressCausedLeaveEffectsForSourceInstanceId:
            resolvedStack.cardInstanceId,
        }
      : {}),
  });

  return resumeStackCascadeIfReady(
    advanceAttackDeclarationStateIfReady(result.state, options),
    options
  );
}

function resolveDeferredActivateSoulStateStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  if (resolvedStack.isNullified) {
    return {
      ...state,
      log: [
        ...state.log,
        `soul_state:nullified:${resolvedStack.chainId}:${resolvedStack.cardInstanceId}`,
      ],
    };
  }
  const sourceCard = getCardById(state, resolvedStack.cardInstanceId);
  if (
    !sourceCard ||
    sourceCard.zone !== resolvedStack.sourceActivationZone ||
    sourceCard.pendingLeaveKind !== null
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `soul_state:effect-fizzled:${resolvedStack.chainId}:source-unavailable`,
      ],
    };
  }

  const beforeSoulState = state;
  const afterSoulState = executeEnterSoulState(
    beforeSoulState,
    resolvedStack.actingPlayerId,
    { target: { selfCard: true, player: "self", count: 1 } },
    options.getCardDefinitionById,
    resolvedStack.cardInstanceId
  );
  return collectAndQueueTriggerReactions({
    beforeState: beforeSoulState,
    afterState: afterSoulState,
    source: "action_resolution",
    chainId: resolvedStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: resolvedStack.actingPlayerId,
    causedBySourceInstanceId: resolvedStack.cardInstanceId,
  });
}

export const EFFECT_RESOLUTION_STACK_RESOLVERS: Partial<
  Record<ActiveStack["actionKind"], DeferredStackResolver>
> = {
  triggered_effect: resolveDeferredTriggeredEffectStack,
  battle_immediate_effect: resolveDeferredBattleImmediateEffectStack,
  // P3-112: contract_combine/link_aid/declare_advent の発揮宣言スタック窓化。
  // divine_skill (下記 if 分岐) と同様に deferred 解決を経由する。
  contract_combine: resolveDeferredContractCombineStack,
  link_aid: resolveDeferredLinkAidStack,
  declare_advent: resolveDeferredAdventStack,
  declare_host_dual_advent: resolveDeferredHostDualAdventStack,
  declare_dual_host_advent: resolveDeferredDualHostAdventStack,
  declare_manifest: resolveDeferredManifestStack,
  flip_instead_of_attack: resolveDeferredFlipInsteadOfAttackStack,
  set_mirage: (state, activeStack, options) =>
    resolveDeferredSetMirageStack({
      state,
      activeStack,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }),
  set_quartz: (state, activeStack, options) =>
    runStateBasedActions(
      resolveDeferredSetQuartzStack({
        state,
        activeStack,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      }),
      options.getCardDefinitionById
    ).state,
  activate_soul_state: resolveDeferredActivateSoulStateStack,
};

function getAsIfSoulCoreChoiceKind(
  actionKind: ActiveStack["actionKind"]
): PendingAsIfSoulCoreChoiceKind | null {
  if (
    actionKind === "contract_combine" ||
    actionKind === "declare_advent" ||
    actionKind === "declare_host_dual_advent"
  ) {
    return actionKind;
  }
  return null;
}

export function applyAsIfSoulCoreChoiceToStack(
  stack: ActiveStack,
  option: PendingAsIfSoulCoreChoiceOption
): ActiveStack {
  const base = { ...stack, asIfSoulCoreChoiceResolved: true };
  if (stack.actionKind === "contract_combine") {
    const {
      contractCombineCostWaived: _costWaived,
      contractCombineProxySourceInstanceId: _proxySourceInstanceId,
      contractCombineProxyTargetCardNames: _proxyTargetCardNames,
      ...withoutContractChoice
    } = base;
    return {
      ...withoutContractChoice,
      ...(option.costWaived === true
        ? { contractCombineCostWaived: true }
        : {}),
      ...(option.proxySourceInstanceId !== undefined
        ? { contractCombineProxySourceInstanceId: option.proxySourceInstanceId }
        : {}),
      ...(option.proxyTargetCardNames !== undefined
        ? {
            contractCombineProxyTargetCardNames: [
              ...option.proxyTargetCardNames,
            ],
          }
        : {}),
    };
  }
  if (
    stack.actionKind === "declare_advent" ||
    stack.actionKind === "declare_host_dual_advent"
  ) {
    const { adventGrantSourceInstanceId: _previousGrant, ...withoutGrant } =
      base;
    return {
      ...withoutGrant,
      adventUseAlternateCost: option.useAlternateCost === true,
      ...(option.proxySourceInstanceId !== undefined
        ? { adventGrantSourceInstanceId: option.proxySourceInstanceId }
        : {}),
    };
  }
  return base;
}

function getAsIfSoulCoreChoiceOptionsForStack(
  state: GameState,
  stack: ActiveStack,
  options: DeferredStackResolverOptions
): PendingAsIfSoulCoreChoiceOption[] {
  switch (stack.actionKind) {
    case "contract_combine":
      return getContractCombineAsIfSoulCoreChoiceOptions(
        state,
        stack,
        options.getCardDefinitionById
      );
    case "declare_advent":
      return getAdventAsIfSoulCoreChoiceOptions(
        state,
        stack,
        options.getCardDefinitionById
      );
    case "declare_host_dual_advent":
      return getHostDualAdventAsIfSoulCoreChoiceOptions(
        state,
        stack,
        options.getCardDefinitionById
      );
    default:
      return [];
  }
}

function getPaidEffectModifierSourceTribes(options: {
  state: GameState;
  sourceInstanceId: string;
  sourceDefinitionId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): readonly string[] {
  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  const sourceDefinition =
    (sourceCard !== undefined
      ? options.getCardDefinitionById(sourceCard.definitionId)
      : undefined) ?? options.getCardDefinitionById(options.sourceDefinitionId);
  return getEffectiveTribes(
    options.state,
    sourceCard,
    sourceDefinition,
    options.getCardDefinitionById
  );
}

function canPayCountCostForPaidEffectModifier(options: {
  state: GameState;
  playerId: string;
  amount: number;
  sourceTribes: readonly string[];
}): boolean {
  const player = options.state.players.find((p) => p.id === options.playerId);
  if (!player) return false;
  const reducible = Math.max(
    0,
    player.countValue -
      immuneProtectedCount(player.protectedCounts, options.sourceTribes)
  );
  return reducible >= options.amount;
}

function buildPaidEffectModifierStepChoice(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState | null {
  if (
    resolvedStack.actionKind !== "triggered_effect" &&
    resolvedStack.actionKind !== "battle_immediate_effect" &&
    resolvedStack.actionKind !== "field_card_effect"
  ) {
    return null;
  }
  const registration = lookupRegistrationForStack(resolvedStack, options);
  const effectIndex = (registration as { effectIndex?: number } | null)
    ?.effectIndex;

  const makePending = (args: {
    kind: "paid_prevention_immunity" | "paid_leave_suppression";
    offer: {
      effectId: string;
      sourceInstanceId: string;
      sourceDefinitionId: string;
      sourceEffectIndex?: number;
      sourceStepIndex?: number;
      cost: { resource: "count"; amount: number };
    };
    sourceTribes: readonly string[];
  }): GameState => {
    const battleEndDeferralAttackId =
      getBattleEndFinalizeAttackIdForActiveStack(resolvedStack);
    const isPrevention = args.kind === "paid_prevention_immunity";
    return {
      ...state,
      pendingStepChoice: {
        pendingId: `paid-effect-modifier:${args.kind}:${resolvedStack.chainId}:${args.offer.effectId}`,
        actingPlayerId: resolvedStack.actingPlayerId,
        choosingPlayerId: resolvedStack.actingPlayerId,
        sourceInstanceId: args.offer.sourceInstanceId,
        sourceDefinitionId: args.offer.sourceDefinitionId,
        effectIndex: args.offer.sourceEffectIndex ?? 0,
        stepIndex: args.offer.sourceStepIndex ?? 0,
        stepLabel: args.kind,
        prompt: {
          label: "効果発揮時の支払い",
          question: isPrevention
            ? "カウント-1して、この効果を相手の効果で防げないようにしますか？"
            : "カウント-1して、この効果で離れるカードの効果を発揮させないようにしますか？",
        },
        choices: [
          { choiceIndex: 0, label: "支払わない" },
          { choiceIndex: 1, label: "支払う" },
        ],
        continuation: {
          sourceDefinitionId: args.offer.sourceDefinitionId,
          chainId: resolvedStack.chainId,
          effectIndex: args.offer.sourceEffectIndex ?? 0,
          sourceInstanceId: args.offer.sourceInstanceId,
          actingPlayerId: resolvedStack.actingPlayerId,
          stepIndex: args.offer.sourceStepIndex ?? 0,
          stepContext: { results: {} },
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        },
        deferredStack: resolvedStack,
        remainingStacks: [],
        paidEffectModifierChoice: {
          kind: args.kind,
          cost: args.offer.cost,
          sourceInstanceId: args.offer.sourceInstanceId,
          sourceDefinitionId: args.offer.sourceDefinitionId,
          sourceTribes: args.sourceTribes,
        },
      },
      log: [
        ...state.log,
        `effect:paid-modifier-choice:pending:${resolvedStack.chainId}:${args.kind}`,
      ],
    };
  };

  if (
    (resolvedStack.actionKind === "battle_immediate_effect"
      ? resolvedStack.battleImmediatePreventionLevel
      : resolvedStack.preventionLevel) !== "unpreventable" &&
    resolvedStack.paidPreventionImmunityChoiceResolved !== true
  ) {
    const offer = getPaidPreventionImmunityOffer(
      state,
      resolvedStack.cardInstanceId,
      effectIndex
    );
    if (offer?.cost.resource === "count") {
      const sourceTribes = getPaidEffectModifierSourceTribes({
        state,
        sourceInstanceId: offer.sourceInstanceId,
        sourceDefinitionId: offer.sourceDefinitionId,
        getCardDefinitionById: options.getCardDefinitionById,
      });
      if (
        canPayCountCostForPaidEffectModifier({
          state,
          playerId: resolvedStack.actingPlayerId,
          amount: offer.cost.amount,
          sourceTribes,
        })
      ) {
        return makePending({
          kind: "paid_prevention_immunity",
          offer: { ...offer, cost: offer.cost },
          sourceTribes,
        });
      }
    }
  }

  if (resolvedStack.paidLeaveSuppressionChoiceResolved !== true) {
    const offer = getPaidLeaveSuppressionImmunityOffer(
      state,
      resolvedStack.cardInstanceId
    );
    if (offer !== null) {
      const sourceTribes = getPaidEffectModifierSourceTribes({
        state,
        sourceInstanceId: offer.sourceInstanceId,
        sourceDefinitionId: offer.sourceDefinitionId,
        getCardDefinitionById: options.getCardDefinitionById,
      });
      if (
        canPayCountCostForPaidEffectModifier({
          state,
          playerId: resolvedStack.actingPlayerId,
          amount: offer.cost.amount,
          sourceTribes,
        })
      ) {
        return makePending({
          kind: "paid_leave_suppression",
          offer,
          sourceTribes,
        });
      }
    }
  }

  return null;
}

/** 発動不能になった宣言を取り消し、条件不成立なら元のセット状態へ戻す。 */
function cancelBurstActivation(
  state: GameState,
  stack: ActiveStack,
  reason: "source-moved" | "condition-lost"
): GameState {
  const checkId = stack.burstCheckId;
  if (!checkId) return state;
  const immunityEffectIds = new Set([
    `burst-window-immune-card:${checkId}`,
    `burst-window-immune-player:${checkId}`,
  ]);
  return {
    ...state,
    pendingBurstChecks: state.pendingBurstChecks.filter(
      (pending) => pending.checkId !== checkId
    ),
    setBurstStates: [
      ...state.setBurstStates.filter(
        (setBurst) => setBurst.cardInstanceId !== stack.cardInstanceId
      ),
      ...(reason === "condition-lost" &&
      getCardById(state, stack.cardInstanceId)?.zone === "burst"
        ? [
            {
              playerId: stack.actingPlayerId,
              cardInstanceId: stack.cardInstanceId,
            },
          ]
        : []),
    ],
    revealedBurstStates: state.revealedBurstStates.filter(
      (revealed) => revealed.checkId !== checkId
    ),
    activeContinuousEffects: state.activeContinuousEffects.filter(
      (effect) => !immunityEffectIds.has(effect.effectId)
    ),
    log: [
      ...state.log,
      `burst:activation-cancelled:${reason}:${checkId}:${stack.cardInstanceId}`,
    ],
  };
}

export function resolveDeferredStackAction(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  const after = resolveDeferredStackActionCore(state, resolvedStack, options);
  return appendPublicDisclosuresForStateTransition({
    before: state,
    after,
    actorPlayerId: resolvedStack.actingPlayerId,
    action: {
      kind: resolvedStack.actionKind,
      cardInstanceId: resolvedStack.cardInstanceId,
    },
  });
}

function resolveDeferredStackActionCore(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  // 未宣言キューの除去とは別に、宣言済み誘発は対象・対価の選択前に不発処理する。
  if (
    resolvedStack.actionKind === "triggered_effect" &&
    isDeferredTriggeredSourceUnavailable(state, resolvedStack, options)
  )
    return resolveDeferredTriggeredEffectStack(state, resolvedStack, options);

  // 神技の発揮抑止は、効果文内の対価や転醒対象などを選ぶ前に判定する。
  if (
    resolvedStack.actionKind === "divine_skill" &&
    !canActivateDivineSkillEffect(
      state,
      resolvedStack.cardInstanceId,
      resolvedStack.divineSkillIndex ?? 0,
      options.getCardDefinitionById
    )
  )
    return state;

  // 範囲支払いは対象数の確定より先に行う。
  if (resolvedStack.actionKind === "divine_skill") {
    const payment = prepareDivineSkillCorePayment(
      state,
      resolvedStack,
      options
    );
    if (payment.pending) return payment.state;
    state = payment.state;
    resolvedStack = payment.stack;
  }

  // 付与起動効果も、発揮できない場合は対価・対象の選択へ進めない。
  if (resolvedStack.grantedEffectCeId !== undefined) {
    const grant = state.activeContinuousEffects.find(
      (ce) => ce.effectId === resolvedStack.grantedEffectCeId
    );
    const grantee = getCardById(state, resolvedStack.cardInstanceId);
    if (
      grant &&
      grantee &&
      !canActivateGrantedEffect(
        state,
        grant,
        grantee,
        options.getCardDefinitionById
      )
    )
      return state;
  }

  if (isBurstActivationSourceMoved(state, resolvedStack)) {
    return cancelBurstActivation(state, resolvedStack, "source-moved");
  }
  if (
    !resolvedStack.payToActHandDiscardGateResolved &&
    !resolvedStack.isNullified
  ) {
    const handGate = computePayToActHandDiscardGate(
      state,
      resolvedStack,
      options.getCardDefinitionById
    );
    if (handGate) {
      if (handGate.candidateCardInstanceIds.length === 0) {
        return resolveDeferredStackAction(
          state,
          {
            ...resolvedStack,
            isNullified: true,
            payToActHandDiscardGateResolved: true,
          },
          options
        );
      }
      return {
        ...state,
        pendingPayToActHandDiscardGate: handGate,
        log: [
          ...state.log,
          `effect:gate_flash_stack_hand_discard:pending:${resolvedStack.chainId}:count=${handGate.requiredCount}:candidates=${handGate.candidateCardInstanceIds.length}`,
        ],
      };
    }
  }

  // 発揮前提コア除去ゲート (gate_flash_stack_core。BSTS01-M03 / 10_rules/03c
  // §「○○しなければ△△を発揮できない」): 相手のフラッシュ/スタック効果を解決する直前・
  // 対象選択前に、相手は指定ゾーンのコア1個をトラッシュに置かなければ発揮できない。
  // 効果保持カードが耐性を持つならゲート不成立 (computePayToActCoreGate が null)。粒度＝発揮1回ごと。
  if (!resolvedStack.payToActGateResolved && !resolvedStack.isNullified) {
    const gate = computePayToActCoreGate(
      state,
      resolvedStack,
      options.getCardDefinitionById
    );
    if (gate) {
      // 移動可能なコアが無い (候補ゼロ) → 「置かなければ発揮できない」を満たせないため
      // この効果は発揮できない (空撃ち)。decline 用 pending を挟まず即不発にし、
      // isNullified で下流の解決をスキップさせる (カードはトラッシュへ)。
      if (gate.candidates.length === 0) {
        return resolveDeferredStackAction(
          state,
          { ...resolvedStack, isNullified: true, payToActGateResolved: true },
          options
        );
      }
      return {
        ...state,
        pendingPayToActCoreGate: gate,
        log: [
          ...state.log,
          `effect:gate_flash_stack_core:pending:${resolvedStack.chainId}:count=${gate.remainingCount}:candidates=${gate.candidates.length}`,
        ],
      };
    }
  }

  // ルール正源: スタック窓はコスト支払い後・対象選択前に開く (03a パイプライン / 08 窓)。
  // 窓クローズ後の本解決時に、対象を要し未確定 (targetInstanceIds 空) なら現在盤面から候補を
  // 算出して pendingEffectTargetSelection を立て中断する (種別非依存)。
  //
  // P3-73/P3-75: 無効化済みスタック (isNullified) は対象選択しない。03b「効果無効化は
  // 『効果の発揮』を止める」のとおり、対象選択は効果発揮 (解決) の一部。よって発揮を止められた
  // 効果はコントローラへ対象選択を要求せず、下流 resolver の isNullified スキップ経路
  // (resolveDeferredMagicStack:1113 等) へ素通りさせる (無駄な選択操作と盤面情報リークを防ぐ)。
  // targetSelectionResolved: pendingEffectTargetSelection で player が能動的に 0 体を選んだ
  // 直後は再オープンしない (空選択ループ防止)。executeEffect 側で conditional_cost shortage
  // を検出して rollback する (ENGINE-registration-step-zero-to-n-target-selection)。
  if (
    !resolvedStack.isNullified &&
    resolvedStack.effectSourceInstanceId !== undefined &&
    resolvedStack.effectSourceInstanceId !== resolvedStack.cardInstanceId
  ) {
    const sourceCard = getCardById(state, resolvedStack.cardInstanceId);
    const sourceDefinition =
      sourceCard !== undefined
        ? options.getCardDefinitionById(sourceCard.definitionId)
        : undefined;
    if (
      sourceCard &&
      sourceDefinition &&
      !isActiveTextRoleUnderEffectSource({
        state,
        hostCard: sourceCard,
        hostDefinition: sourceDefinition,
        effectSourceInstanceId: resolvedStack.effectSourceInstanceId,
        ...(resolvedStack.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: resolvedStack.effectSourceDefinitionId }
          : {}),
      }) &&
      !isActiveQuartzInheritedEffectSource({
        state,
        hostCard: sourceCard,
        hostDefinition: sourceDefinition,
        effectSourceInstanceId: resolvedStack.effectSourceInstanceId,
        ...(resolvedStack.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: resolvedStack.effectSourceDefinitionId }
          : {}),
      }) &&
      !isActiveCombinedBraveEffectSource({
        state,
        hostCard: sourceCard,
        effectSourceInstanceId: resolvedStack.effectSourceInstanceId,
        ...(resolvedStack.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: resolvedStack.effectSourceDefinitionId }
          : {}),
      })
    ) {
      const refunded = resolvedStack.recordedUsage
        ? refundAllRecordedUsage(
            state,
            resolvedStack.effectSourceInstanceId ??
              resolvedStack.cardInstanceId,
            resolvedStack.recordedUsage
          )
        : state;
      // 宣言後に付与元の所属を失った効果は、対象選択せず通常の終了処理へ。
      // 使用回数だけを取り消し、応答スタックによる盤面変化は維持する (03f)。
      return resolveDeferredStackAction(
        {
          ...refunded,
          log: [
            ...refunded.log,
            `effect:effect-fizzled:${resolvedStack.chainId}:effect-source-not-star-garment-under`,
          ],
        },
        { ...resolvedStack, isNullified: true },
        options
      );
    }
  }

  if (!resolvedStack.isNullified) {
    const paidModifierChoiceState = buildPaidEffectModifierStepChoice(
      state,
      resolvedStack,
      options
    );
    if (paidModifierChoiceState !== null) {
      return paidModifierChoiceState;
    }
  }

  if (
    resolvedStack.actionKind === "burst_activation" &&
    !resolvedStack.isNullified &&
    !resolvedStack.targetSelectionResolved &&
    resolvedStack.targetInstanceIds.length === 0 &&
    resolvedStack.burstCheckId !== undefined
  ) {
    const stateWithBurstImmunity = resolvedStack.cardInstanceId
      ? applyBurstActivationImmunity(
          state,
          resolvedStack.burstCheckId,
          options.getCardDefinitionById
        ).state
      : state;
    const pendingBurstCheck = stateWithBurstImmunity.pendingBurstChecks.find(
      (check) => check.checkId === resolvedStack.burstCheckId
    );
    const burstRegistrationForStack =
      resolvedStack.burstRegistrationIndex !== undefined
        ? options.getRegisteredBurstActions?.(resolvedStack.cardDefinitionId)?.[
            resolvedStack.burstRegistrationIndex
          ]
        : resolvedStack.burstSourceKind !== undefined
          ? options
              .getRegisteredBurstActions?.(resolvedStack.cardDefinitionId)
              ?.find((r) => r.sourceKind === resolvedStack.burstSourceKind)
          : undefined;
    const burstDefForSuppress = options.getCardDefinitionById(
      resolvedStack.cardDefinitionId
    );
    const ignoresOpponentCannotActivateBurst =
      getBurstIgnoresOpponentCannotActivateBurst(
        burstDefForSuppress,
        burstRegistrationForStack?.effectIndex,
        burstRegistrationForStack?.effectIndex === undefined
      );
    const isBurstEffectSuppressed =
      pendingBurstCheck?.effectSuppressed === true ||
      (resolvedStack.cardInstanceId !== undefined &&
        isBurstEffectNullifiedByOpponent(
          stateWithBurstImmunity,
          resolvedStack.cardInstanceId,
          resolvedStack.actingPlayerId,
          {
            ignoresOpponentCannotActivateBurst,
            getCardDefinitionById: options.getCardDefinitionById,
          }
        )) ||
      (pendingBurstCheck !== undefined &&
        isBurstRelatedInstanceOffField(
          stateWithBurstImmunity,
          pendingBurstCheck
        ));
    if (isBurstEffectSuppressed && pendingBurstCheck !== undefined) {
      return resolveDeferredStackAction(
        {
          ...stateWithBurstImmunity,
          pendingBurstChecks: stateWithBurstImmunity.pendingBurstChecks.map(
            (check) =>
              check.checkId === pendingBurstCheck.checkId
                ? { ...check, effectSuppressed: true }
                : check
          ),
        },
        { ...resolvedStack, targetSelectionResolved: true },
        options
      );
    }
  }

  if (
    !resolvedStack.isNullified &&
    !resolvedStack.targetSelectionResolved &&
    resolvedStack.targetInstanceIds.length === 0
  ) {
    const deferredChoiceIndexes = resolvedStack.deferredChoiceIndexes ?? [];
    if (deferredChoiceIndexes.length > 0) {
      const registration = lookupRegistrationForStack(resolvedStack, options);
      const registrationChoices = (
        registration as
          | (typeof registration & {
              choices?: readonly {
                label: string;
                requiredPayCostAmount?: number;
              }[];
            })
          | null
      )?.choices;
      const effectIndex = registration
        ? getActiveStackEffectIndex(resolvedStack, registration)
        : undefined;
      const sourceDefinitionId =
        resolvedStack.effectSourceDefinitionId ??
        resolvedStack.cardDefinitionId;
      const sourceDefinition =
        options.getCardDefinitionById(sourceDefinitionId);
      const effect =
        effectIndex !== undefined
          ? sourceDefinition?.effects?.[effectIndex]
          : undefined;
      const choiceStepIndex =
        effect?.steps.findIndex(
          (step) => step.choice !== undefined && step.choice.length > 0
        ) ?? -1;
      const effectChoiceOptions =
        effect !== undefined && choiceStepIndex >= 0
          ? getEffectStepChoiceOptions(effect, choiceStepIndex)
          : [];
      const choices = deferredChoiceIndexes.map((choiceIndex) => {
        const effectChoice = effectChoiceOptions.find(
          (candidate) => candidate.choiceIndex === choiceIndex
        );
        return {
          choiceIndex,
          label:
            effectChoice?.label ??
            registrationChoices?.[choiceIndex]?.label ??
            `効果${choiceIndex + 1}`,
          ...(effectChoice?.prompt !== undefined
            ? { prompt: effectChoice.prompt }
            : {}),
          ...(effectChoice?.chooser !== undefined
            ? { chooser: effectChoice.chooser }
            : {}),
          ...(registrationChoices?.[choiceIndex]?.requiredPayCostAmount !==
          undefined
            ? {
                requiredPayCostAmount:
                  registrationChoices[choiceIndex]!.requiredPayCostAmount,
              }
            : {}),
        };
      });
      const sharedVariantChooser =
        choices.length > 0 &&
        choices.every((choice) => choice.chooser === choices[0]!.chooser)
          ? choices[0]!.chooser
          : undefined;
      const stepChooser =
        choiceStepIndex >= 0
          ? effect?.steps[choiceStepIndex]?.chooser
          : undefined;
      const choosingPlayerId =
        (stepChooser ?? sharedVariantChooser) === "opponent"
          ? (state.playerOrder.find(
              (playerId) => playerId !== resolvedStack.actingPlayerId
            ) ?? resolvedStack.actingPlayerId)
          : resolvedStack.actingPlayerId;
      // availability の結果として合法な枝が一つだけでも、choice step 自体は
      // 窓後に確定する。ここを自動選択すると変種別 usageLimit の記録点を飛ばし、
      // 同じ枝を再使用できてしまうため pending の共通解決経路へ統一する。
      if (choices.length > 0) {
        const sourceInstanceId =
          resolvedStack.effectSourceInstanceId ?? resolvedStack.cardInstanceId;
        const battleEndDeferralAttackId =
          getBattleEndFinalizeAttackIdForActiveStack(resolvedStack);
        return {
          ...state,
          pendingStepChoice: {
            pendingId: `stack-step-choice:${resolvedStack.chainId}`,
            actingPlayerId: resolvedStack.actingPlayerId,
            choosingPlayerId,
            sourceInstanceId,
            sourceDefinitionId,
            effectIndex: effectIndex ?? 0,
            stepIndex: choiceStepIndex >= 0 ? choiceStepIndex : 0,
            stepLabel:
              choiceStepIndex >= 0
                ? (effect?.steps[choiceStepIndex]?.id ??
                  `__step_${choiceStepIndex}`)
                : "deferred_stack_choice",
            prompt: stepPromptForChoosingPlayer(
              { label: "効果を選択", question: "発揮する効果を選んでください" },
              resolvedStack.actingPlayerId,
              choosingPlayerId,
              {
                textLines: sourceDefinition?.textLines,
                textRef: effect?.textRef,
              }
            ),
            choices: stepChoicesForChoosingPlayer(
              choices,
              resolvedStack.actingPlayerId,
              choosingPlayerId
            ),
            // PendingStepChoice の表示サニタイズ互換。deferredStack 設定時の
            // 解決再開は applyPendingStepChoiceAction が deferredStack を正源にする。
            continuation: {
              sourceDefinitionId,
              chainId: resolvedStack.chainId,
              effectIndex: effectIndex ?? 0,
              sourceInstanceId,
              actingPlayerId: resolvedStack.actingPlayerId,
              stepIndex: choiceStepIndex >= 0 ? choiceStepIndex : 0,
              stepContext: { results: {} },
              ...(battleEndDeferralAttackId !== undefined
                ? { battleEndDeferralAttackId }
                : {}),
            },
            deferredStack: resolvedStack,
            remainingStacks: [],
          },
          log: [
            ...state.log,
            `effect:step-choice-pending-after-stack:${resolvedStack.chainId}:${choices.length}options`,
          ],
        };
      }
    }

    const asIfSoulCoreChoiceKind = getAsIfSoulCoreChoiceKind(
      resolvedStack.actionKind
    );
    if (
      asIfSoulCoreChoiceKind !== null &&
      !resolvedStack.asIfSoulCoreChoiceResolved
    ) {
      const choiceOptions = getAsIfSoulCoreChoiceOptionsForStack(
        state,
        resolvedStack,
        options
      );
      const choiceOptionsWithTargets = choiceOptions.filter((choiceOption) => {
        const selectedStack = applyAsIfSoulCoreChoiceToStack(
          resolvedStack,
          choiceOption
        );
        return getStackTargetSelection(state, selectedStack, options) !== null;
      });
      if (choiceOptionsWithTargets.length === 1) {
        return resolveDeferredStackAction(
          state,
          applyAsIfSoulCoreChoiceToStack(
            resolvedStack,
            choiceOptionsWithTargets[0]!
          ),
          options
        );
      }
      if (choiceOptionsWithTargets.length > 1) {
        return {
          ...state,
          pendingAsIfSoulCoreChoice: {
            pendingId: `as-if-soul-core:${resolvedStack.chainId}`,
            actionKind: asIfSoulCoreChoiceKind,
            actingPlayerId: resolvedStack.actingPlayerId,
            sourceInstanceId: resolvedStack.cardInstanceId,
            sourceDefinitionId: resolvedStack.cardDefinitionId,
            deferredStack: resolvedStack,
            remainingStacks: [],
            options: choiceOptionsWithTargets,
          },
          log: [
            ...state.log,
            `effect:as-if-soul-core-choice:pending:${resolvedStack.chainId}:${choiceOptionsWithTargets.length}options`,
          ],
        };
      }
    }

    const optionalRepeatChoice = getDeferredOptionalRepeatChoiceSelection(
      state,
      resolvedStack,
      options
    );
    if (optionalRepeatChoice) {
      const battleEndDeferralAttackId =
        getBattleEndFinalizeAttackIdForActiveStack(resolvedStack);
      return {
        ...state,
        pendingEffectOptionalRepeatChoice: {
          pendingId: `effect-optional-repeat:${resolvedStack.chainId}`,
          actingPlayerId: resolvedStack.actingPlayerId,
          sourceInstanceId: resolvedStack.cardInstanceId,
          sourceDefinitionId: resolvedStack.cardDefinitionId,
          ...(resolvedStack.effectSourceInstanceId !== undefined
            ? { effectSourceInstanceId: resolvedStack.effectSourceInstanceId }
            : {}),
          ...(resolvedStack.effectSourceDefinitionId !== undefined
            ? {
                effectSourceDefinitionId:
                  resolvedStack.effectSourceDefinitionId,
              }
            : {}),
          effectIndex: optionalRepeatChoice.effectIndex,
          repeatStepIndex: optionalRepeatChoice.repeatStepIndex,
          ...(optionalRepeatChoice.targetStepId !== undefined
            ? { targetStepId: optionalRepeatChoice.targetStepId }
            : {}),
          baseTargetCount: optionalRepeatChoice.baseTargetCount,
          maxAdditionalCount: optionalRepeatChoice.maxAdditionalCount,
          additionalCountSelectionMode:
            optionalRepeatChoice.additionalCountSelectionMode,
          choices: optionalRepeatChoice.choices,
          deferredStack: resolvedStack,
          remainingStacks: [],
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        },
        log: [
          ...state.log,
          `effect:optional-repeat-choice:pending:${resolvedStack.chainId}:max=${optionalRepeatChoice.maxAdditionalCount}`,
        ],
      };
    }
    const sel = getStackTargetSelection(state, resolvedStack, options);
    if (sel) {
      const battleEndDeferralAttackId =
        getBattleEndFinalizeAttackIdForActiveStack(resolvedStack);
      // 宣言時 choice を畳んだ効果は ActiveStack に対象メタを載せていない。
      // 窓後に選ばれた変種から再計算したゾーンを deferredStack へ固定し、
      // resolveDeferredMagicStack 等の stale 対象検証でも同じ変種を正源にする。
      const targetReadyStack: ActiveStack = {
        ...resolvedStack,
        ...(sel.candidateTargetZones !== undefined
          ? { candidateTargetZones: sel.candidateTargetZones }
          : {}),
        ...(sel.targetGroups !== undefined
          ? { targetGroups: sel.targetGroups }
          : {}),
        ...(sel.allowDuplicateTargets !== undefined
          ? { allowDuplicateTargets: sel.allowDuplicateTargets }
          : {}),
        ...((sel.targetStepId ?? resolvedStack.targetStepId) !== undefined
          ? { targetStepId: sel.targetStepId ?? resolvedStack.targetStepId }
          : {}),
      };
      return {
        ...state,
        pendingEffectTargetSelection: {
          pendingId: `effect-target:${resolvedStack.chainId}`,
          actingPlayerId: resolvedStack.actingPlayerId,
          sourceInstanceId: resolvedStack.cardInstanceId,
          sourceDefinitionId: resolvedStack.cardDefinitionId,
          ...(resolvedStack.effectSourceInstanceId !== undefined
            ? { effectSourceInstanceId: resolvedStack.effectSourceInstanceId }
            : {}),
          ...(resolvedStack.effectSourceDefinitionId !== undefined
            ? {
                effectSourceDefinitionId:
                  resolvedStack.effectSourceDefinitionId,
              }
            : {}),
          deferredStack: targetReadyStack,
          remainingStacks: [],
          requiredTargetCount: sel.requiredTargetCount,
          maxTargetCount: sel.maxTargetCount,
          ...(sel.allowDuplicateTargets === true
            ? { allowDuplicateTargets: true }
            : {}),
          ...((sel.targetStepId ?? resolvedStack.targetStepId) !== undefined
            ? { targetStepId: sel.targetStepId ?? resolvedStack.targetStepId }
            : {}),
          candidateInstanceIds: sel.candidateInstanceIds,
          ...(sel.targetGroups !== undefined
            ? { targetGroups: sel.targetGroups }
            : {}),
          targetEffectFilterTags: sel.targetEffectFilterTags,
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
        },
        log: [
          ...state.log,
          `effect:target-selection:pending:${resolvedStack.chainId}:${sel.candidateInstanceIds.length}candidates`,
        ],
      };
    }
  }

  // composition メタデータから同時解決 resolver を構築
  const effectiveResolverLookup =
    buildCompositionAwareResolverLookup({
      baseLookup: options.getHandWrittenEffectResolver,
      cardNo: resolvedStack.cardDefinitionId,
      composition: resolvedStack.composition,
      getConditionalCostCanExecuteCheck:
        options.getConditionalCostCanExecuteCheck,
      getConditionalResultSuccessCheck:
        options.getConditionalResultSuccessCheck,
    }) ?? options.getHandWrittenEffectResolver;

  const effectResolutionResolver =
    EFFECT_RESOLUTION_STACK_RESOLVERS[resolvedStack.actionKind];
  if (effectResolutionResolver) {
    return effectResolutionResolver(state, resolvedStack, options);
  }

  if (resolvedStack.actionKind === "magic") {
    return resolveDeferredMagicStack({
      state,
      activeStack: resolvedStack,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(effectiveResolverLookup
        ? {
            getHandWrittenEffectResolver: effectiveResolverLookup,
          }
        : {}),
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
    });
  }

  if (resolvedStack.actionKind === "accel") {
    return resolveDeferredAccelStack({
      state,
      activeStack: resolvedStack,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(effectiveResolverLookup
        ? { getHandWrittenEffectResolver: effectiveResolverLookup }
        : {}),
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
    });
  }

  if (resolvedStack.actionKind === "change") {
    return resolveDeferredChangeStack({
      state,
      activeStack: resolvedStack,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(effectiveResolverLookup
        ? { getHandWrittenEffectResolver: effectiveResolverLookup }
        : {}),
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
    });
  }

  if (resolvedStack.actionKind === "divine_skill") {
    return resolveDeferredDivineSkillStack(state, resolvedStack, options);
  }

  if (
    resolvedStack.actionKind === "summon" ||
    resolvedStack.actionKind === "place_nexus"
  ) {
    const isInitialPlayResolution =
      !resolvedStack.playDeclarationLegalityChecked;
    if (
      !resolvedStack.isNullified &&
      !resolvedStack.playDeclarationLegalityChecked &&
      resolvedStack.normalHandPlayRollback !== undefined
    ) {
      const card = getCardById(state, resolvedStack.cardInstanceId);
      const definition = options.getCardDefinitionById(
        resolvedStack.cardDefinitionId
      );
      if (!card || !definition)
        throw new Error("Play declaration source missing");
      const gate = evaluateSummonDeclarationGate({
        state,
        actingPlayerId: resolvedStack.actingPlayerId,
        card,
        definition,
        actionKind: resolvedStack.actionKind,
        getCardDefinitionById: options.getCardDefinitionById,
        ignoreSummonCondition:
          resolvedStack.playDeclarationIgnoresSummonCondition === true,
        evaluateCondition,
      });
      const permissionCondition =
        resolvedStack.playDeclarationRecheckCondition ??
        (resolvedStack.sourceEffectIndex === undefined
          ? undefined
          : definition.effects?.[resolvedStack.sourceEffectIndex]?.condition);
      if (
        gate.kind !== "allowed" ||
        (permissionCondition !== undefined &&
          !evaluateCondition(
            state,
            permissionCondition,
            card.instanceId,
            resolvedStack.actingPlayerId,
            options.getCardDefinitionById
          ))
      ) {
        // 03f: 巻き戻すのは宣言自体の違法化だけ。場入り必要コア不足と分離する。
        return rollbackNormalHandPlayAfterStack({
          state,
          activeStack: resolvedStack,
          getCardDefinitionById: options.getCardDefinitionById,
        });
      }
    }
    resolvedStack = { ...resolvedStack, playDeclarationLegalityChecked: true };
    // ブレイヴ召喚: スタック窓クローズ後、場入りコア選択より前に「合体する/スピリット状態」を選ぶ。
    // ルール正源: `02_turn-flow-and-timing.md`「コスト支払い完了後に窓が開く」+
    // `05_brave-and-attack-special-cases.md`「召喚時にすぐに合体させることもできる」(合体は
    // 場入り=解決の一部)。合体可否・合体先 host の選択はスタック窓より後 (解決時) に行うため、
    // 合体先候補も解決時点 (窓クローズ後の現在盤面) から算出する。
    if (
      resolvedStack.actionKind === "summon" &&
      !resolvedStack.isNullified &&
      !resolvedStack.braveCombineChoiceResolved
    ) {
      const braveCard = getCardById(state, resolvedStack.cardInstanceId);
      const braveDef = options.getCardDefinitionById(
        resolvedStack.cardDefinitionId
      );
      if (braveCard && braveDef && braveDef.printedCategory === "brave") {
        // P3-138 token-pool-pre-cost-forced-combine (BSES01-T01「M1A4 ジャガーノート」型):
        // 宣言時点 (コスト支払い前) で既に combineHostInstanceId が確定している場合、
        // ホストがスタック窓を跨いでも生存していればそのまま採用し、任意選択
        // (pendingBraveCombineChoice) を提示しない (印字「対象はこのスピリットに直接
        // 合体しなければならない」の強制を維持する)。ホストが窓中に消えていれば
        // (相手のフラッシュ効果で破壊/移動された等) combineHostInstanceId を破棄し、
        // 通常の任意選択へフォールバックする。
        const declaredForcedHostInstanceId =
          resolvedStack.combineHostInstanceId;
        const declaredForcedHostCard =
          declaredForcedHostInstanceId !== undefined
            ? getCardById(state, declaredForcedHostInstanceId)
            : undefined;
        if (
          declaredForcedHostInstanceId !== undefined &&
          declaredForcedHostCard?.zone !== "field"
        ) {
          const {
            combineHostInstanceId: _staleForcedHost,
            ...staleHostStripped
          } = resolvedStack;
          return resolveDeferredStackAction(
            state,
            staleHostStripped as ActiveStack,
            options
          );
        }
        const hosts =
          declaredForcedHostInstanceId === undefined
            ? getValidBraveCombineHosts(
                state,
                braveDef,
                resolvedStack.actingPlayerId,
                options.getCardDefinitionById,
                braveCard.instanceId
              )
            : [];
        if (hosts.length > 0) {
          // スピリット状態 (合体しない) の場入りコア (Lv1) を、現在の
          // リザーブ + フィールドのコアで支払えるかを算出する。支払えない場合は
          // 合体選択でスピリット状態の選択肢を出さない (合体しか選べない soft-lock 回避)。
          const spiritLv1 = getEnterFieldCorePlacementPolicy({
            card: braveCard,
            definition: braveDef,
          }).minimumCoreCount;
          const spiritStateAffordable =
            getAvailablePlacementCoreCount(
              state,
              resolvedStack.actingPlayerId,
              options.getCardDefinitionById
            ) >= spiritLv1;
          return {
            ...state,
            pendingBraveCombineChoice: {
              pendingId: `brave-combine-choice:${resolvedStack.chainId}`,
              actingPlayerId: resolvedStack.actingPlayerId,
              braveInstanceId: resolvedStack.cardInstanceId,
              braveDefinitionId: resolvedStack.cardDefinitionId,
              deferredStack: resolvedStack,
              remainingStacks: [],
              ...(resolvedStack.postResolutionOracle !== undefined
                ? { postResolutionOracle: resolvedStack.postResolutionOracle }
                : {}),
              hostCandidateInstanceIds: hosts.map((h) => h.instanceId),
              spiritStateAffordable,
            },
            log: [
              ...state.log,
              `brave:combine-choice:pending:${resolvedStack.chainId}:hosts=${hosts.length}:spirit=${spiritStateAffordable ? 1 : 0}`,
            ],
          };
        }
      }
    }
    // 転召（召喚手順内ステップ）: スタック窓クローズ後・維持コア配置（場入り）前に挿入する
    // 強制コア消費。専用スタック窓は開かない。対象1体の上のコアすべてを送り先（ボイド等）へ移す。
    // ルール正源: 10_rules/07b 転召節 + 02:188「コスト支払い完了後にスタック窓」。
    // 対象選択を pendingTenshoSummon で待ち、resolve_tensho_summon 後に tenshoResolved=true で再開する。
    if (
      resolvedStack.actionKind === "summon" &&
      !resolvedStack.isNullified &&
      !resolvedStack.tenshoResolved
    ) {
      const summonDef = options.getCardDefinitionById(
        resolvedStack.cardDefinitionId
      );
      if (summonDef?.tenshoSummon) {
        const candidates = getTenshoTargetCandidates(
          state,
          resolvedStack.actingPlayerId,
          summonDef.tenshoSummon,
          options.getCardDefinitionById,
          resolvedStack.cardInstanceId
        );
        if (candidates.length > 0) {
          return {
            ...state,
            pendingTenshoSummon: {
              pendingId: `tensho-summon:${resolvedStack.chainId}`,
              actingPlayerId: resolvedStack.actingPlayerId,
              summoningInstanceId: resolvedStack.cardInstanceId,
              summoningDefinitionId: resolvedStack.cardDefinitionId,
              deferredStack: resolvedStack,
              remainingStacks: [],
              targetCandidateInstanceIds: candidates,
              destination: summonDef.tenshoSummon.destination,
            },
            log: [
              ...state.log,
              `tensho:pending:${resolvedStack.chainId}:candidates=${candidates.length}`,
            ],
          };
        }
        // 対象不在（適法性ゲートを通った後、スタック窓中に対象が消えた等）: 強制不能で不発。
        // tenshoResolved を立てず、そのまま下の維持コア配置（場入り）処理へ落とす。
      }
    }
    if (!resolvedStack.isNullified) {
      const sourceCard = getCardById(state, resolvedStack.cardInstanceId);
      const sourceDefinition = options.getCardDefinitionById(
        resolvedStack.cardDefinitionId
      );
      if (!sourceCard || !sourceDefinition) {
        throw new Error(
          `Pending enter-field placement source missing: ${resolvedStack.cardInstanceId}`
        );
      }
      const basePolicy = getEnterFieldCorePlacementPolicy({
        card: sourceCard,
        definition: sourceDefinition,
      });
      // P3-93 bug1: 配置時コア配置不可 (forbidden = 独立コア管理カード: 創界神/導界者/
      // 創界石) は置けるコアが無いため pending を立てない。GUI に無意味な維持コア選択 HUD を
      // 出さないため、空配置で場入り解決へ直行する (08c:114「配置時にコアを置けない」/
      // 08c:139 創界石も同型)。通常/任意ネクサスのみ pending を生成する。
      if (basePolicy.rule === "forbidden") {
        return resolveDeferredPlayCardStack({
          state,
          activeStack: { ...resolvedStack, enterFieldCorePlacements: [] },
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
          ...(effectiveResolverLookup
            ? {
                getHandWrittenEffectResolver: effectiveResolverLookup,
              }
            : {}),
        });
      }
      let placementMin = basePolicy.minimumCoreCount;
      const placementCoreCount =
        getAvailablePlacementCoreCount(
          state,
          resolvedStack.actingPlayerId,
          options.getCardDefinitionById
        ) +
        (resolvedStack.actionKind === "summon"
          ? Math.min(
              state.players.find(
                (player) => player.id === resolvedStack.actingPlayerId
              )?.trashNormalCoreCount ?? 0,
              getSummonTrashCorePlacementGrant(
                state,
                resolvedStack.actingPlayerId,
                sourceDefinition
              )?.amount ?? 0
            )
          : 0);
      if (resolvedStack.combineHostInstanceId !== undefined) {
        // 直接合体: コア配置任意 (min 0)。スピリット状態 Lv1 必須コア制約は課さない。
        placementMin = 0;
      }
      if (placementCoreCount < placementMin) {
        // 03f: 窓後の必要コア不足は召喚不成立。カード種別によらず field/SBA を経由しない。
        return moveFailedPlayCardGroupToTrash({
          state,
          instanceId: resolvedStack.cardInstanceId,
          chainId: resolvedStack.chainId,
          reason: "enter_field_core_shortage",
          getCardDefinitionById: options.getCardDefinitionById,
        });
      }
      const policy = { ...basePolicy, minimumCoreCount: placementMin };
      // 宣言時に API で指定された配置も窓後の実残数で再検証する。
      // stale な選択でも代替コアがあれば選び直せる。試行結果はコミットしない。
      const suppliedPlacements = resolvedStack.enterFieldCorePlacements;
      if (suppliedPlacements !== undefined) {
        let suppliedPlacementsValid = false;
        try {
          const trashGrant =
            resolvedStack.actionKind === "summon"
              ? getSummonTrashCorePlacementGrant(
                  state,
                  resolvedStack.actingPlayerId,
                  sourceDefinition
                )
              : null;
          assertEnterFieldCorePlacementsAllowed(
            { ...policy, allowedTrashNormalCoreCount: trashGrant?.amount ?? 0 },
            suppliedPlacements
          );
          if (getPlacedCoreCount(suppliedPlacements) >= placementMin) {
            applyEnterFieldCorePlacements({
              state: { ...state, log: [...state.log] },
              actingPlayerId: resolvedStack.actingPlayerId,
              destinationInstanceId: sourceCard.instanceId,
              placements: suppliedPlacements,
              getCardDefinitionById: options.getCardDefinitionById,
              allowTrashNormal: trashGrant !== null,
            });
            suppliedPlacementsValid = true;
          }
        } catch (error) {
          if (!isInitialPlayResolution) throw error;
          // コア源消失・移動制限の変化は再選択へ。宣言自体の違法化ではない。
        }
        if (suppliedPlacementsValid) {
          return resolveDeferredPlayCardStack({
            state,
            activeStack: resolvedStack,
            getCardDefinitionById: options.getCardDefinitionById,
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
            ...(effectiveResolverLookup
              ? { getHandWrittenEffectResolver: effectiveResolverLookup }
              : {}),
          });
        }
        const {
          enterFieldCorePlacements: _stalePlacements,
          ...unselectedStack
        } = resolvedStack;
        resolvedStack = unselectedStack;
      }
      return {
        ...state,
        pendingEnterFieldPlacement: {
          pendingId: `enter-field-placement:${resolvedStack.chainId}`,
          actingPlayerId: resolvedStack.actingPlayerId,
          sourceInstanceId: resolvedStack.cardInstanceId,
          sourceDefinitionId: resolvedStack.cardDefinitionId,
          deferredStack: resolvedStack,
          remainingStacks: [],
          minimumCoreCount: policy.minimumCoreCount,
          maximumCoreCount: policy.maximumCoreCount,
          ...(resolvedStack.postResolutionOracle !== undefined
            ? { postResolutionOracle: resolvedStack.postResolutionOracle }
            : {}),
        },
        log: [
          ...state.log,
          `play-card:enter-field-placement:pending:${resolvedStack.chainId}`,
        ],
      };
    }
    return resolveDeferredPlayCardStack({
      state,
      activeStack: resolvedStack,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      ...(effectiveResolverLookup
        ? {
            getHandWrittenEffectResolver: effectiveResolverLookup,
          }
        : {}),
    });
  }

  if (resolvedStack.actionKind === "burst_activation") {
    const checkId = resolvedStack.burstCheckId;

    if (!checkId) {
      throw new Error(
        `Burst activation stack missing burstCheckId: stackId=${resolvedStack.stackId}`
      );
    }

    // バースト発動の手書き resolver を再構築する
    let resolveEffect:
      | ((currentState: GameState, ctx: { chainId: string }) => GameState)
      | undefined;

    // P3-72: resolver lookup が undefined (サーバが getHandWrittenEffectResolver
    //   未配線) でも、executeHandWrittenEffectResolver は resolver 未登録時に
    //   structured effects へ fall back するため、常に wrap を構築して召喚等の
    //   バースト効果ステップを実行させる。誘発効果経路 (line ~2060) と対称化。
    const burstEffectResolverLookup =
      effectiveResolverLookup ?? ((_: string) => undefined);
    const burstRegistrationForStack =
      resolvedStack.burstRegistrationIndex !== undefined
        ? options.getRegisteredBurstActions?.(resolvedStack.cardDefinitionId)?.[
            resolvedStack.burstRegistrationIndex
          ]
        : resolvedStack.burstSourceKind !== undefined
          ? options
              .getRegisteredBurstActions?.(resolvedStack.cardDefinitionId)
              ?.find((r) => r.sourceKind === resolvedStack.burstSourceKind)
          : undefined;
    const burstTargetEffectIndex = burstRegistrationForStack?.effectIndex;
    {
      const sourceCard = getCardById(state, resolvedStack.cardInstanceId);

      if (sourceCard) {
        const sourceDef = options.getCardDefinitionById(
          sourceCard.definitionId
        );

        if (sourceDef) {
          // P3-63 残留懸念 #4 fix: sync path (line ~2310) と対称化。
          //   従来は `effectiveResolverLookup(cardNo)` が undefined を返した時 resolveEffect を
          //   構築せず、DSL fallback (tryExecuteStructuredEffects) も走らない不整合があった。
          //   `executeHandWrittenEffectResolver` 自体が resolver 未登録時に DSL に fall back する
          //   ため、resolver 有無に関わらず常に wrap を構築して fallback に道を残す。
          const capturedSourceCard = sourceCard;
          const capturedSourceDef = sourceDef;

          resolveEffect = (currentState, { chainId }) =>
            executeHandWrittenEffectResolver({
              state: currentState,
              context: {
                chainId,
                resolutionKind: "pending_burst_check",
                burstPostResolutionDestination:
                  getBurstPostResolutionDestination(
                    capturedSourceDef,
                    options.getHandWrittenBurstPostResolutionPolicy
                  ),
                actingPlayerId: resolvedStack.actingPlayerId,
                sourceKind: resolvedStack.burstSourceKind ?? "spirit",
                sourceCard: capturedSourceCard,
                sourceDefinition: capturedSourceDef,
                targetInstanceIds: resolvedStack.targetInstanceIds,
                ...(burstTargetEffectIndex !== undefined
                  ? { targetEffectIndex: burstTargetEffectIndex }
                  : {}),
                ...(resolvedStack.targetStepId !== undefined
                  ? { targetStepId: resolvedStack.targetStepId }
                  : {}),
                ...(resolvedStack.targetGroups !== undefined
                  ? { targetGroups: resolvedStack.targetGroups }
                  : {}),
                ...(resolvedStack.burstChoiceIndex !== undefined &&
                resolvedStack.targetInstanceIds.length > 1
                  ? { sequentialTargetConsumption: true }
                  : {}),
                getCardDefinitionById: options.getCardDefinitionById,
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
                getRegisteredBurstActions: options.getRegisteredBurstActions,
                ...(resolvedStack.burstChoiceIndex !== undefined
                  ? { choiceIndex: resolvedStack.burstChoiceIndex }
                  : {}),
                // P3-62 / P3-63: 宣言時に積んだ usageLimit 払戻情報を deferred 解決へ復元。
                ...(resolvedStack.recordedUsage
                  ? { recordedUsage: resolvedStack.recordedUsage }
                  : {}),
                targetedDisclosureNegateIdentity: resolvedStack,
              },
              getResolver: burstEffectResolverLookup,
            });
        }
      }
    }

    // burstFollowUpInfo が存在する場合、follow-up アクションを resolver に追加する
    const followUpInfo = resolvedStack.burstFollowUpInfo;
    if (followUpInfo) {
      const handWrittenPart = resolveEffect;
      const capturedFollowUpInfo: BurstFollowUpInfo = followUpInfo;
      const capturedSourceInstanceId = resolvedStack.cardInstanceId;
      const capturedTargetInstanceIds = resolvedStack.targetInstanceIds;

      resolveEffect = (currentState, ctx) => {
        let resolvedState = handWrittenPart
          ? handWrittenPart(currentState, ctx)
          : currentState;

        if (!capturedFollowUpInfo.playsSourceCardWithoutCostAfterResolve) {
          if (!capturedFollowUpInfo.usesSourceCardWithoutCostAfterResolve) {
            if (capturedFollowUpInfo.playsTargetCardWithoutCostAfterResolve) {
              for (const followUpCardInstanceId of capturedTargetInstanceIds) {
                const perTargetInput =
                  capturedFollowUpInfo.perTargetFollowUpInputs.find(
                    (i) => i.targetInstanceId === followUpCardInstanceId
                  );
                const placements =
                  perTargetInput?.enterFieldCorePlacements ?? [];

                const followUpPlayLookup = options.getHandWrittenEffectResolver
                  ? buildFollowUpResolverLookup({
                      state: resolvedState,
                      followUpInstanceId: followUpCardInstanceId,
                      getCardDefinitionById: options.getCardDefinitionById,
                      baseLookup: options.getHandWrittenEffectResolver,
                      getRegisteredFieldCardEffectActions:
                        options.getRegisteredFieldCardEffectActions,
                      getConditionalCostCanExecuteCheck:
                        options.getConditionalCostCanExecuteCheck,
                      getConditionalResultSuccessCheck:
                        options.getConditionalResultSuccessCheck,
                    })
                  : undefined;

                resolvedState = playBurstFollowUpCardWithoutPayingCost({
                  state: resolvedState,
                  actingPlayerId: resolvedStack.actingPlayerId,
                  sourceInstanceId: capturedSourceInstanceId,
                  targetInstanceId: followUpCardInstanceId,
                  getCardDefinitionById: options.getCardDefinitionById,
                  getRegisteredTriggeredEffectActions:
                    options.getRegisteredTriggeredEffectActions,
                  getRegisteredBurstActions: options.getRegisteredBurstActions,
                  enterFieldCorePlacements: placements,
                  chainId: ctx.chainId,
                  ...(followUpPlayLookup
                    ? {
                        getHandWrittenEffectResolver: followUpPlayLookup,
                      }
                    : {}),
                }).state;
              }

              return resolvedState;
            }

            if (!capturedFollowUpInfo.usesTargetCardWithoutCostAfterResolve) {
              return resolvedState;
            }

            for (const followUpMagicInstanceId of capturedTargetInstanceIds) {
              const perTargetInput =
                capturedFollowUpInfo.perTargetFollowUpInputs.find(
                  (i) => i.targetInstanceId === followUpMagicInstanceId
                );
              const targetMagicMeta =
                capturedFollowUpInfo.targetMagicEffectFilterTagsByInstanceId.find(
                  (m) => m.instanceId === followUpMagicInstanceId
                );
              const resolvedFollowUpTargetInstanceIds =
                perTargetInput?.followUpTargetInstanceIds ??
                capturedFollowUpInfo.followUpTargetInstanceIds ??
                [];
              const resolvedFollowUpChosenLifeCoreKind =
                perTargetInput?.followUpChosenLifeCoreKind ??
                capturedFollowUpInfo.followUpChosenLifeCoreKind;

              const followUpMagicLookup = options.getHandWrittenEffectResolver
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
                actingPlayerId: resolvedStack.actingPlayerId,
                sourceInstanceId: capturedSourceInstanceId,
                magicInstanceId: followUpMagicInstanceId,
                getCardDefinitionById: options.getCardDefinitionById,
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
                getRegisteredBurstActions: options.getRegisteredBurstActions,
                ...(resolvedFollowUpTargetInstanceIds.length > 0
                  ? { targetInstanceIds: resolvedFollowUpTargetInstanceIds }
                  : {}),
                ...(targetMagicMeta?.targetEffectFilterTags
                  ? {
                      targetEffectFilterTags:
                        targetMagicMeta.targetEffectFilterTags as readonly EffectFilterTag[],
                    }
                  : {}),
                ...(resolvedFollowUpChosenLifeCoreKind !== undefined
                  ? {
                      chosenLifeCoreKind: resolvedFollowUpChosenLifeCoreKind,
                    }
                  : {}),
                chainId: ctx.chainId,
                ...(followUpMagicLookup
                  ? {
                      getHandWrittenEffectResolver: followUpMagicLookup,
                    }
                  : {}),
              }).state;
            }

            return resolvedState;
          }

          // use source magic card
          resolvedState = useBurstSourceMagicCardWithoutPayingCost({
            state: resolvedState,
            actingPlayerId: resolvedStack.actingPlayerId,
            sourceInstanceId: capturedSourceInstanceId,
            getCardDefinitionById: options.getCardDefinitionById,
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
            getRegisteredBurstActions: options.getRegisteredBurstActions,
            ...(capturedTargetInstanceIds.length > 0
              ? { targetInstanceIds: capturedTargetInstanceIds }
              : {}),
            ...(resolvedStack.targetEffectFilterTags.length > 0
              ? {
                  targetEffectFilterTags:
                    resolvedStack.targetEffectFilterTags as readonly EffectFilterTag[],
                }
              : {}),
            ...(resolvedStack.chosenLifeCoreKind !== undefined
              ? { chosenLifeCoreKind: resolvedStack.chosenLifeCoreKind }
              : {}),
            chainId: ctx.chainId,
            ...(options.getHandWrittenEffectResolver
              ? {
                  getHandWrittenEffectResolver:
                    options.getHandWrittenEffectResolver,
                }
              : {}),
          }).state;

          return resolvedState;
        }

        // play source card
        resolvedState = playBurstSourceCardWithoutPayingCost({
          state: resolvedState,
          actingPlayerId: resolvedStack.actingPlayerId,
          sourceInstanceId: capturedSourceInstanceId,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
          getRegisteredBurstActions: options.getRegisteredBurstActions,
          enterFieldCorePlacements:
            resolvedStack.enterFieldCorePlacements ?? [],
          ...(capturedTargetInstanceIds.length > 0
            ? { targetInstanceIds: capturedTargetInstanceIds }
            : {}),
          ...(resolvedStack.targetEffectFilterTags.length > 0
            ? {
                targetEffectFilterTags:
                  resolvedStack.targetEffectFilterTags as readonly EffectFilterTag[],
              }
            : {}),
          ...(resolvedStack.chosenLifeCoreKind !== undefined
            ? { chosenLifeCoreKind: resolvedStack.chosenLifeCoreKind }
            : {}),
          chainId: ctx.chainId,
        }).state;

        return resolvedState;
      };
    }

    const stateWithBurstImmunity = resolvedStack.cardInstanceId
      ? applyBurstActivationImmunity(
          state,
          checkId,
          options.getCardDefinitionById
        ).state
      : state;
    const pendingBurstCheckInState =
      stateWithBurstImmunity.pendingBurstChecks.find(
        (check) => check.checkId === checkId
      );
    const pendingBurstCheckSnapshot =
      resolvedStack.burstPendingSnapshot?.checkId === checkId
        ? resolvedStack.burstPendingSnapshot
        : undefined;
    const pendingBurstCheck =
      pendingBurstCheckInState ?? pendingBurstCheckSnapshot;
    const stateWithRestoredBurstCheck =
      pendingBurstCheckInState === undefined &&
      pendingBurstCheckSnapshot !== undefined
        ? {
            ...stateWithBurstImmunity,
            pendingBurstChecks: [
              pendingBurstCheckSnapshot,
              ...stateWithBurstImmunity.pendingBurstChecks,
            ],
            log: [
              ...stateWithBurstImmunity.log,
              `burst:pending-snapshot-restored:${checkId}`,
            ],
          }
        : stateWithBurstImmunity;
    const burstStateForSuppression = stateWithRestoredBurstCheck;
    const pendingBurstCheckForSuppression =
      burstStateForSuppression.pendingBurstChecks.find(
        (check) => check.checkId === checkId
      ) ?? pendingBurstCheck;
    const burstDefForSuppress = resolvedStack.cardDefinitionId
      ? options.getCardDefinitionById(resolvedStack.cardDefinitionId)
      : undefined;
    const ignoresOpponentCannotActivateBurst =
      getBurstIgnoresOpponentCannotActivateBurst(
        burstDefForSuppress,
        burstTargetEffectIndex,
        burstTargetEffectIndex === undefined
      );
    const isBurstEffectSuppressed =
      resolvedStack.isNullified === true ||
      pendingBurstCheckForSuppression?.effectSuppressed === true ||
      (resolvedStack.cardInstanceId !== undefined &&
        isBurstEffectNullifiedByOpponent(
          burstStateForSuppression,
          resolvedStack.cardInstanceId,
          resolvedStack.actingPlayerId,
          {
            ignoresOpponentCannotActivateBurst,
            getCardDefinitionById: options.getCardDefinitionById,
          }
        )) ||
      (pendingBurstCheckForSuppression !== undefined &&
        isBurstRelatedInstanceOffField(
          burstStateForSuppression,
          pendingBurstCheckForSuppression
        ));
    const stateForBurstResolution = isBurstEffectSuppressed
      ? {
          ...burstStateForSuppression,
          log: [
            ...burstStateForSuppression.log,
            `burst:effect-suppressed:${checkId}:${resolvedStack.cardInstanceId ?? "all"}`,
          ],
        }
      : burstStateForSuppression;

    const burstResult = useResolvePendingBurstCheckAsAction({
      state: stateForBurstResolution,
      actingPlayerId: resolvedStack.actingPlayerId,
      checkId,
      ...(burstTargetEffectIndex !== undefined
        ? { burstEffectIndex: burstTargetEffectIndex }
        : {}),
      ...(isBurstEffectSuppressed
        ? {}
        : resolveEffect
          ? { resolveEffect }
          : options.resolvePendingBurstCheck
            ? { resolveEffect: options.resolvePendingBurstCheck }
            : options.getPendingBurstCheckResolver
              ? { getResolver: options.getPendingBurstCheckResolver }
              : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    // source card が存在する場合は post-resolution cleanup を実行する
    if (resolvedStack.cardInstanceId && options.getRegisteredBurstActions) {
      const stateBeforeFinalize = burstResult.state;
      const stateAfterFinalize = finalizeResolvedBurstCard({
        state: stateBeforeFinalize,
        actingPlayerId: resolvedStack.actingPlayerId,
        sourceInstanceId: resolvedStack.cardInstanceId,
        checkId,
        getCardDefinitionById: options.getCardDefinitionById,
        ...(options.getHandWrittenBurstPostResolutionPolicy
          ? {
              getHandWrittenBurstPostResolutionPolicy:
                options.getHandWrittenBurstPostResolutionPolicy,
            }
          : {}),
      });

      // P3-120: legal-actions-apply.ts の resolve_pending_burst_check ハンドラ
      // (即時解決経路) は finalizeResolvedBurstCard + collectAndQueueTriggerReactions
      // の後に必ず advanceAttackDeclarationStateIfReady を呼ぶが、この deferred stack
      // 解決経路 (対象選択待ちで中断した burst 効果が再開されるケース) は同じ後処理を
      // 行いながらこの呼び出しを欠いていた。指定対象アタックの burst 後 forced_block
      // 窓遷移が一度も走らず advanceStep が永久に stuck する原因だった。
      const stateAfterBurstPostResolution = collectAndQueueTriggerReactions({
        beforeState: stateBeforeFinalize,
        afterState: stateAfterFinalize,
        source: "burst_post_resolution",
        chainId: `burst:${checkId}`,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
        causedByPlayerId: resolvedStack.actingPlayerId,
        causedBySourceInstanceId: null,
      });
      return advanceAttackDeclarationStateIfReady(
        maybeFinalizeBattleEndScopeAfterPendingDrain(
          stateAfterBurstPostResolution,
          options
        ),
        options
      );
    }

    return advanceAttackDeclarationStateIfReady(
      maybeFinalizeBattleEndScopeAfterPendingDrain(burstResult.state, options),
      options
    );
  }

  // P3-99 起動権 variant: grant_effect で付与された起動効果の解決。registration ではなく
  // 付与 CE.metadata.grantedEffect を被付与カード (grantee) を source として実行する
  // (resolveGrantedEffectMechanic と同じ executeEffect + finalizeEffectResolution の核)。
  if (resolvedStack.grantedEffectCeId !== undefined) {
    return resolveDeferredGrantedActivatedEffectStack(
      state,
      resolvedStack,
      options
    );
  }

  // field_card_effect: 宣言された registration の DSL effectIndex を解決し、
  // deferred 解決で当該 1 効果のみを実行する (targetEffectIndex)。同一カードに複数の
  // activated 効果がある場合 (BSTH01-X04 フォーオブアカインド) の束ね実行と
  // 共有 recordedUsage ラベルの誤払い戻しを防ぐ。
  const fieldEffectTargetIndex =
    resolvedStack.actionKind === "field_card_effect" &&
    resolvedStack.fieldEffectRegistrationIndex !== undefined
      ? options.getRegisteredFieldCardEffectActions?.(
          resolvedStack.effectSourceDefinitionId ??
            resolvedStack.cardDefinitionId
        )?.[resolvedStack.fieldEffectRegistrationIndex]?.effectIndex
      : undefined;

  return resolveDeferredFieldEffectStack({
    state,
    activeStack: resolvedStack,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(fieldEffectTargetIndex !== undefined
      ? { targetEffectIndex: fieldEffectTargetIndex }
      : {}),
    ...(effectiveResolverLookup
      ? {
          getHandWrittenEffectResolver: effectiveResolverLookup,
        }
      : {}),
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
  });
}

/**
 * P3-86/P3-75: 発揮前無効化誘発が指定スタックを対象に保留中か。
 * private declaration (咲夜など手札由来) と public pendingTriggeredEffects (ハルバードなど場由来)
 * の両方を、`eventKind === "flash" | "effect_declaration"` + `relatedInstanceId` 一致で判定する。
 */
export function hasPendingFlashUseTriggerTargeting(
  state: GameState,
  cardInstanceId: string
): boolean {
  const hasPrivateDeclaration = state.pendingPrivateDeclarations.some(
    (d) =>
      (d.eventKind === "flash" || d.eventKind === "effect_declaration") &&
      d.relatedInstanceId === cardInstanceId
  );
  const hasPublicTriggeredEffect = state.pendingTriggeredEffects.some(
    (d) =>
      (d.eventKind === "flash" || d.eventKind === "effect_declaration") &&
      d.relatedInstanceId === cardInstanceId
  );
  return hasPrivateDeclaration || hasPublicTriggeredEffect;
}

export function hasPendingEffectDeclarationTriggerTargeting(
  state: GameState,
  cardInstanceId: string
): boolean {
  return (
    state.pendingPrivateDeclarations.some(
      (d) =>
        d.eventKind === "effect_declaration" &&
        d.relatedInstanceId === cardInstanceId
    ) ||
    state.pendingTriggeredEffects.some(
      (d) =>
        d.eventKind === "effect_declaration" &&
        d.relatedInstanceId === cardInstanceId
    )
  );
}

export function applyPendingStackNegateRequests(options: {
  state: GameState;
  remainingStacks: readonly ActiveStack[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  includePendingRequests?: boolean;
  includeContinuousRequests?: boolean;
}): { state: GameState; remainingStacks: ActiveStack[] } {
  const nextStacks = [...options.remainingStacks];
  // 期限切れ (duration.scope の turn/step を離れた) request はここで除去する。
  // 一致有無に関わらず初回チェックで無条件消費していた旧実装の silent bug 修正
  // (ENGINE-single-target-burst-nullify)。以降のループでは実際に一致し消費した
  // request のみ requests から除去し、不一致の request は次の呼び出しへ持ち越す。
  let requests = options.state.pendingStackNegateRequests.filter(
    (request) => !isPendingStackNegateRequestExpired(request, options.state)
  );
  const suppressionEffects: ContinuousEffect[] = [];
  const logs: string[] = [];
  const includePendingRequests = options.includePendingRequests ?? true;
  const includeContinuousRequests = options.includeContinuousRequests ?? true;
  const pendingRequestEntries = includePendingRequests
    ? requests.map((request) => ({
        request,
        consumePending: true,
      }))
    : [];
  const continuousRequestEntries = includeContinuousRequests
    ? getContinuousStackNegateRequests(options.state).map((request) => ({
        request,
        consumePending: false,
      }))
    : [];

  for (const { request, consumePending } of [
    ...pendingRequestEntries,
    ...continuousRequestEntries,
  ]) {
    const target = nextStacks[0];
    const isMatch =
      !!target &&
      target.isNullified !== true &&
      stackMatchesNegateAction({
        state: options.state,
        stack: target,
        request,
        actingPlayerId: request.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
      });

    // duration 未指定の request (応答宣言型の単発無効化。例: BSTH001-R02「直下の
    // 応答対象を1つ無効化できる」) は、一致有無に関わらずこの1回のチェックで
    // 消費し切る従来仕様を維持する（不一致でも後続の奥のスタックまで探索して
    // 無効化してはならない）。duration 指定の request (例: BSTH02-M02
    // duration:{scope:"step"}) のみ、一致するまで次回呼び出しへ持ち越す。
    if (consumePending && (request.duration === undefined || isMatch)) {
      requests = requests.filter((r) => r.requestId !== request.requestId);
    }
    if (!isMatch) {
      continue;
    }
    nextStacks[0] = { ...target, isNullified: true };
    if (
      request.negateTarget === "effect" &&
      request.targetEffectFilter !== undefined &&
      request.suppressMatchedEffect === true
    ) {
      const targetSourceCard = options.state.cardInstances.find(
        (card) => card.instanceId === target.cardInstanceId
      );
      if (targetSourceCard) {
        const negateSourceCard = options.state.cardInstances.find(
          (card) => card.instanceId === request.sourceInstanceId
        );
        const requestedFilter =
          request.targetEffectFilter as EffectTargetFilter;
        const descriptor = target.suppressionEffectDescriptor;
        const effectFilter: EffectTargetFilter = {
          ...requestedFilter,
          ...(requestedFilter.sourceDefinitionId === undefined
            ? { sourceDefinitionId: target.cardDefinitionId }
            : {}),
          ...(requestedFilter.effectIndex === undefined &&
          descriptor?.effectIndex !== undefined
            ? { effectIndex: descriptor.effectIndex }
            : {}),
          ...(descriptor?.effectLabels !== undefined
            ? { effectLabels: [...descriptor.effectLabels] }
            : {}),
          ...(requestedFilter.timingKind === undefined &&
          descriptor?.timingKind !== undefined
            ? { timingKind: descriptor.timingKind }
            : {}),
          ...(requestedFilter.eventAction === undefined &&
          descriptor?.eventAction !== undefined
            ? { eventAction: descriptor.eventAction as string | string[] }
            : {}),
        };
        suppressionEffects.push({
          effectId: `pending-stack-suppression:${request.requestId}:${target.stackId}`,
          sourceInstanceId: request.sourceInstanceId,
          sourceDefinitionId: negateSourceCard?.definitionId ?? "dsl-unknown",
          actingPlayerId: request.actingPlayerId,
          duration: request.duration ?? { scope: "turn" },
          createdAtTurn: options.state.turnNumber,
          createdAtAttackId: options.state.activeAttack?.attackId ?? null,
          modifierTag: "effect_suppression",
          forceLevel: "prohibition",
          targetInstanceId: targetSourceCard.instanceId,
          metadata: {
            effectFilter,
          },
        });
      }
    }
    logs.push(
      `effect:negate:pending-stack:${request.negateTarget}:${target.stackId}`
    );
  }

  return {
    state: {
      ...options.state,
      pendingStackNegateRequests: requests,
      activeContinuousEffects: suppressionEffects.length
        ? [...options.state.activeContinuousEffects, ...suppressionEffects]
        : options.state.activeContinuousEffects,
      log: logs.length ? [...options.state.log, ...logs] : options.state.log,
    },
    remainingStacks: nextStacks,
  };
}

export function getContinuousStackNegateRequests(
  state: GameState
): PendingStackNegateRequest[] {
  const requests: PendingStackNegateRequest[] = [];
  for (const ce of state.activeContinuousEffects) {
    if (!isCEActiveForScope(ce, state.step, state.activePlayerId)) continue;
    const negateTarget = negateTargetFromContinuousEffectTag(ce.modifierTag);
    if (negateTarget === undefined) continue;
    const metadata = ce.metadata as Partial<StackNegateActionLike> | undefined;
    if (
      (metadata as { continuousStackNegate?: boolean } | undefined)
        ?.continuousStackNegate !== true
    ) {
      continue;
    }
    requests.push({
      requestId: `ce:${ce.effectId}`,
      actingPlayerId: ce.actingPlayerId,
      sourceInstanceId: ce.sourceInstanceId,
      negateTarget,
      duration: ce.duration,
      // continuous (while_on_field) 経由: 期限切れ判定は isCEActiveForScope 側で
      // 済んでいるため isPendingStackNegateRequestExpired の対象外 (scope は
      // "turn"/"step" のみ判定、それ以外は常に false)。ここの createdAt* は型を
      // 満たすための不使用値。
      createdAtStep: state.step,
      createdAtTurn: ce.createdAtTurn,
      ...(metadata?.targetFilter
        ? { targetFilter: metadata.targetFilter }
        : {}),
      ...(metadata?.targetController
        ? { targetController: metadata.targetController }
        : {}),
      ...(metadata?.targetEffectTiming
        ? { targetEffectTiming: metadata.targetEffectTiming }
        : {}),
      ...(metadata?.targetEffectFilter
        ? { targetEffectFilter: metadata.targetEffectFilter }
        : {}),
    });
  }
  return requests;
}

export function negateTargetFromContinuousEffectTag(
  tag: ContinuousEffect["modifierTag"]
): PendingStackNegateRequest["negateTarget"] | undefined {
  switch (tag) {
    case "negate_summon":
      return "summon";
    case "negate_place":
      return "place";
    case "negate_use_magic":
      return "use_magic";
    case "negate_effect":
      return "effect";
    default:
      return undefined;
  }
}

/**
 * スタック窓クローズ後のカスケード解決 (LIFO 順)。resumable。
 *
 * 各スタックを `resolveDeferredStackAction` で解決し、効果対象選択 (`pendingEffectTargetSelection`)
 * が立った時点で残りのスタックを pending に退避して中断する。`applyPendingEffectTargetAction`
 * が対象入力後に残りを継続する。これにより多段カスケード (相手の応答効果など) でも、各スタックが
 * 自身の解決時に窓後の盤面から対象を選べる。
 *
 * P3-86 案X: 各スタック解決の直前に「発揮前チェックポイント」を設ける。対象を狙う発揮前無効化
 * 誘発 (flash-use) が保留中なら、残りスタックを `pendingStackCascade` に退避してカスケードを中断し、
 * 誘発の宣言と本文解決を待つ（対価完了後の無効化を適用し、残りを再開）。
 */
export function resolveStackCascade(
  state: GameState,
  resolvedStacks: readonly ActiveStack[],
  options: DeferredStackResolverOptions,
  cascadeOptions?: {
    allowDuringTargetedDisclosure?: boolean;
  }
): GameState {
  let current = state;
  let workingStacks = [...resolvedStacks];
  const allowedTargetedDisclosurePendingId =
    cascadeOptions?.allowDuringTargetedDisclosure === true
      ? current.pendingTargetedDisclosureContinuation?.pendingId
      : undefined;
  if (
    current.pendingTargetedDisclosureContinuation !== null &&
    cascadeOptions?.allowDuringTargetedDisclosure !== true
  ) {
    return {
      ...current,
      pendingTargetedDisclosureContinuation: {
        ...current.pendingTargetedDisclosureContinuation,
        remainingStacks: [
          ...current.pendingTargetedDisclosureContinuation.remainingStacks,
          ...workingStacks,
        ],
      },
    };
  }
  for (let i = 0; i < workingStacks.length; i++) {
    // 応答は独立した効果。応答元へ因果IDを継承せず、応答とその派生・バーストの
    // 完了を順序上の依存として待つ。対象選択後の再開もこの入口を通る。
    if (hasPendingStackResponseResolution(current, workingStacks[i]!)) {
      return {
        ...current,
        pendingStackCascade: {
          ...current.pendingStackCascade,
          remainingStacks: [
            ...workingStacks.slice(i),
            ...(current.pendingStackCascade?.remainingStacks ?? []),
          ],
        },
      };
    }
    // 本文の入力待ちは共通の分類を使い、選択→別の選択への遷移も待つ。
    // 外側の解決文脈や退避したカスケード自体は本文の入力待ちに含めない。
    // 応答効果の離脱選択・実移動を完了してから、次の宣言の合法性を再検査する。
    // 対象入力の resume からもここへ入るため、ループ入口でも止める (04d)。
    if (
      hasPendingLeaveResolutionChoice(current) ||
      hasPendingEffectResolution(current, "body")
    ) {
      return {
        ...current,
        pendingStackCascade: {
          remainingStacks: [
            ...(current.pendingStackCascade?.remainingStacks ?? []),
            ...workingStacks.slice(i),
          ],
        },
      };
    }
    if (
      workingStacks[i]!.actionKind === "burst_activation" &&
      workingStacks[i]!.burstActivationWindowPending === true
    ) {
      return {
        ...current,
        pendingStackCascade: {
          remainingStacks: [
            ...workingStacks.slice(i),
            ...(current.pendingStackCascade?.remainingStacks ?? []),
          ],
          ...(current.pendingStackCascade?.waitForTriggeredEffects === true
            ? { waitForTriggeredEffects: true }
            : {}),
        },
      };
    }
    if (isBurstActivationSourceMoved(current, workingStacks[i]!)) {
      current = cancelBurstActivation(
        current,
        workingStacks[i]!,
        "source-moved"
      );
      continue;
    }
    if (workingStacks[i]!.actionKind === "burst_activation") {
      current = markBurstActivationEstablished({
        getCardDefinitionById: options.getCardDefinitionById,
        state: current,
        activeStack: workingStacks[i]!,
      });
      // 発揮宣言窓を通過したバースト stack は、選択済み check 自身と親 chain の
      // deferred leave を残したまま解決に進む。これらを通常の発揮前 blocker と
      // 数えると after_triggers がバースト解決を待つ一方で、バーストも同じ
      // after_triggers/親 leave を待つ循環になる (EDH-0022)。判定時だけ除外し、
      // 実際の解決には元の state を渡して burst check を正しく消費する。
      const stateWithoutBurstEffectBlockers =
        getStateWithoutCascadeHeadBurstEffectBlockers(
          current,
          workingStacks[i]!,
          workingStacks.slice(i + 1)
        );
      if (
        workingStacks[i]!.burstEffectDeclarationPending === true ||
        hasPendingEffectsBeforeBurstEffect(stateWithoutBurstEffectBlockers)
      ) {
        return {
          ...current,
          pendingStackCascade: {
            remainingStacks: [
              ...workingStacks.slice(i),
              ...(current.pendingStackCascade?.remainingStacks ?? []),
            ],
            waitForTriggeredEffects: true,
          },
        };
      }
    }
    // 発揮前チェックポイント: 対象を狙う発揮前無効化誘発が保留中ならカスケードを中断。
    if (
      workingStacks[i]!.isNullified !== true &&
      workingStacks[i]!.effectDeclarationTriggerQueued !== true
    ) {
      const queuedStack: ActiveStack = {
        ...workingStacks[i]!,
        effectDeclarationTriggerQueued: true,
      };
      workingStacks[i] = queuedStack;
      current = queueEffectDeclarationTriggers({
        state: current,
        stack: queuedStack,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        getRegisteredBurstActions: options.getRegisteredBurstActions,
      });
    }
    if (
      hasPendingFlashUseTriggerTargeting(
        current,
        workingStacks[i]!.cardInstanceId
      )
    ) {
      const waitForTriggeredEffects =
        hasPendingEffectDeclarationTriggerTargeting(
          current,
          workingStacks[i]!.cardInstanceId
        );
      return {
        ...current,
        pendingStackCascade: {
          remainingStacks: [...workingStacks.slice(i)],
          ...(waitForTriggeredEffects ? { waitForTriggeredEffects: true } : {}),
        },
      };
    }
    const continuousApplied = applyPendingStackNegateRequests({
      state: current,
      remainingStacks: workingStacks.slice(i),
      getCardDefinitionById: options.getCardDefinitionById,
      includePendingRequests: true,
      includeContinuousRequests: true,
    });
    current = continuousApplied.state;
    workingStacks = [
      ...workingStacks.slice(0, i),
      ...continuousApplied.remainingStacks,
    ];
    const beforeRequestCount = current.pendingStackNegateRequests.length;
    const stateBeforeStackResolution = current;
    const previousFlushGuardStacks =
      current.pendingStackCascadeFlushGuardStacks;
    const resolutionFlushGuardStacks = workingStacks.slice(i);
    current = resolveDeferredStackAction(
      resolutionFlushGuardStacks.length > 0
        ? setStackCascadeFlushGuardStacks(current, [
            ...(previousFlushGuardStacks ?? []),
            ...resolutionFlushGuardStacks,
          ])
        : current,
      workingStacks[i]!,
      options
    );
    const postResolutionFlushGuardStacks = workingStacks.slice(i + 1);
    current =
      postResolutionFlushGuardStacks.length > 0 ||
      previousFlushGuardStacks !== undefined
        ? setStackCascadeFlushGuardStacks(current, [
            ...(previousFlushGuardStacks ?? []),
            ...postResolutionFlushGuardStacks,
          ])
        : setStackCascadeFlushGuardStacks(current, previousFlushGuardStacks);
    current = flushPendingLeavesAfterReactionProgress(current, options);
    current = appendPublicDisclosuresForStateTransition({
      before: stateBeforeStackResolution,
      after: current,
      actorPlayerId: workingStacks[i]!.actingPlayerId,
    });
    current = finalizeCardUsageAndQueueTriggers(current, options);
    if (
      current.pendingTriggeredEffects.some(
        (effect) => effect.eventKind === "card_used"
      ) ||
      current.pendingPrivateDeclarations.some(
        (effect) => effect.eventKind === "card_used"
      )
    ) {
      const remainingStacks = [
        ...(current.pendingStackCascade?.remainingStacks ?? []),
        ...workingStacks.slice(i + 1),
      ];
      return {
        ...setStackCascadeFlushGuardStacks(current, previousFlushGuardStacks),
        pendingStackCascade: { remainingStacks, waitForTriggeredEffects: true },
      };
    }
    if (current.pendingStackNegateRequests.length > beforeRequestCount) {
      const parentCascade = current.pendingStackCascade;
      const hasPendingLeaveReaction =
        current.pendingTriggeredEffects.length > 0 ||
        current.pendingBurstChecks.length > 0 ||
        current.pendingPrivateDeclarations.length > 0;
      if (hasPendingLeaveReaction) {
        // 応答先の残りと、別途待機していた cascade の両方を保持する。
        // 片方だけを選ぶと、先に宣言した burst の stack が失われ、
        // activationSelected の check だけが残る (fuzz 3391842970)。
        const remainingStacks = [
          ...workingStacks.slice(i + 1),
          ...(parentCascade?.remainingStacks ?? []),
        ];
        return {
          ...setStackCascadeFlushGuardStacks(current, previousFlushGuardStacks),
          pendingStackCascade:
            remainingStacks.length > 0
              ? {
                  ...parentCascade,
                  remainingStacks,
                  waitForTriggeredEffects: true,
                }
              : null,
        };
      }
      current = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
        state: { ...current, pendingStackCascade: null },
        getCardDefinitionById: options.getCardDefinitionById,
      });
      current = { ...current, pendingStackCascade: parentCascade };
      if (i + 1 < workingStacks.length) {
        const applied = applyPendingStackNegateRequests({
          state: current,
          remainingStacks: workingStacks.slice(i + 1),
          getCardDefinitionById: options.getCardDefinitionById,
          includePendingRequests: true,
          includeContinuousRequests: true,
        });
        current = applied.state;
        workingStacks = [
          ...workingStacks.slice(0, i + 1),
          ...applied.remainingStacks,
        ];
      }
    }
    current = setStackCascadeFlushGuardStacks(
      current,
      previousFlushGuardStacks
    );
    if (
      shouldDiscardRemainingStacksAfterBattleEnded(
        stateBeforeStackResolution,
        current,
        workingStacks.slice(i + 1)
      )
    ) {
      return {
        ...current,
        pendingStackCascade: null,
      };
    }
    if (current.pendingPayToActCoreGate !== null) {
      // 発揮前提コア除去ゲート待ち → 残りスタックを退避して中断。resume 時に継続する。
      return {
        ...current,
        pendingPayToActCoreGate: {
          ...current.pendingPayToActCoreGate,
          remainingStacks: [
            ...current.pendingPayToActCoreGate.remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingPayToActHandDiscardGate !== null) {
      return {
        ...current,
        pendingPayToActHandDiscardGate: {
          ...current.pendingPayToActHandDiscardGate,
          remainingStacks: [
            ...current.pendingPayToActHandDiscardGate.remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingTargetedDisclosureContinuation !== null) {
      if (
        cascadeOptions?.allowDuringTargetedDisclosure === true &&
        current.pendingTargetedDisclosureContinuation.pendingId ===
          allowedTargetedDisclosurePendingId
      ) {
        continue;
      }
      return {
        ...current,
        pendingTargetedDisclosureContinuation: {
          ...current.pendingTargetedDisclosureContinuation,
          remainingStacks: [
            ...current.pendingTargetedDisclosureContinuation.remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingAsIfSoulCoreChoice !== null) {
      return {
        ...current,
        pendingAsIfSoulCoreChoice: {
          ...current.pendingAsIfSoulCoreChoice,
          remainingStacks: [
            ...current.pendingAsIfSoulCoreChoice.remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingEffectTargetSelection !== null) {
      // 対象選択待ち → 残りスタックを退避して中断。resume 時に継続する。
      return {
        ...current,
        pendingEffectTargetSelection: {
          ...current.pendingEffectTargetSelection,
          remainingStacks: [
            ...current.pendingEffectTargetSelection.remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingEffectOptionalRepeatChoice !== null) {
      return {
        ...current,
        pendingEffectOptionalRepeatChoice: {
          ...current.pendingEffectOptionalRepeatChoice,
          remainingStacks: [
            ...current.pendingEffectOptionalRepeatChoice.remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingEffectOptionalRepeatCountSelection !== null) {
      return {
        ...current,
        pendingEffectOptionalRepeatCountSelection: {
          ...current.pendingEffectOptionalRepeatCountSelection,
          remainingStacks: [
            ...current.pendingEffectOptionalRepeatCountSelection
              .remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingEnterFieldPlacement !== null) {
      return {
        ...current,
        pendingEnterFieldPlacement: {
          ...current.pendingEnterFieldPlacement,
          remainingStacks: [
            ...current.pendingEnterFieldPlacement.remainingStacks,
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (current.pendingBraveCombineChoice !== null) {
      return {
        ...current,
        pendingBraveCombineChoice: {
          ...current.pendingBraveCombineChoice,
          remainingStacks: [
            ...(current.pendingBraveCombineChoice.remainingStacks ?? []),
            ...workingStacks.slice(i + 1),
          ],
        },
      };
    }
    if (hasStackCascadeBlockingPendingSelection(current)) {
      const remainingStacks = [
        ...(current.pendingStackCascade?.remainingStacks ?? []),
        ...workingStacks.slice(i + 1),
      ];
      const waitingState: GameState = {
        ...current,
        pendingStackCascade: { remainingStacks },
      };
      if (remainingStacks.length === 0) {
        return resumeStackCascadeIfReady(waitingState, options);
      }
      return waitingState;
    }
  }
  // 対象/選択 pending から再開したバーストは、最初の解決時には安定点へ届かない。
  // そのため battle resolution が保留した battle-end entry をここで再度 drain する。
  // これをしないと、対象選択を要するバーストの後に
  // pendingImmediateBattleEnds が残り、予約済み end_attack_step も finalization
  // blocker のまま進行不能になる (EDH-0002-00)。
  if (!hasOutstandingEffectResolutionContinuation(current)) {
    current = processPendingImmediateBattleEnds({
      state: current,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }
  return startDeferredExtraTurnIfReady(
    finalizeOneShotStackNegateRequestsAtStableBoundary(current),
    options
  );
}

export function shouldDiscardRemainingStacksAfterBattleEnded(
  beforeState: GameState,
  afterState: GameState,
  remainingStacks: readonly ActiveStack[]
): boolean {
  return (
    remainingStacks.length > 0 &&
    beforeState.activeAttack !== null &&
    afterState.activeAttack === null
  );
}

function hasPendingStackResponseResolution(
  state: GameState,
  stack: ActiveStack
): boolean {
  const chainIds = stack.waitForResolutionChainIds;
  if (!chainIds?.length) return false;
  const matches = (id: string | null | undefined) =>
    typeof id === "string" &&
    chainIds.some((chainId) => isChainAtOrUnder(id, chainId));
  return (
    state.pendingTriggeredEffects.some((p) => matches(p.chainId)) ||
    state.pendingPrivateDeclarations.some((p) => matches(p.chainId)) ||
    state.pendingDeferredTriggeredEffects.some((p) => matches(p.chainId)) ||
    state.pendingBurstChecks.some((p) => matches(p.chainId)) ||
    state.pendingEffectCompletions.some((p) => matches(p.chainId)) ||
    state.pendingAfterTriggersContinuations.some(
      (p) => matches(p.chainId) || matches(p.waitChainId)
    ) ||
    state.battleImmediateEffects.some((p) => matches(p.causedByChainId)) ||
    state.pendingLeaveEntities.some(
      (p) => matches(p.chainId) || p.reactionChainIds?.some(matches)
    )
  );
}

function hasStackCascadeBlockingPendingSelection(state: GameState): boolean {
  return (
    hasPendingLeaveResolutionChoice(state) ||
    // 移動先・コア数等を含む本文の入力待ちは同じ正源で判定する。
    // 別列挙では選択から次の選択へ遷移した際に応答元が先に解決される。
    hasPendingEffectResolution(state, "body") ||
    (state.pendingAccelCleanups ?? []).length > 0 ||
    state.pendingAfterTriggersContinuations.length > 0
  );
}

/**
 * An after-triggers continuation normally drains before a delayed burst's
 * effect-declaration window. If that continuation is itself waiting for the
 * selected burst check at this cascade head, making the declaration wait for
 * it creates a cycle: the continuation waits for the burst, while the burst
 * waits for the continuation (fuzz seed 1558393750).
 */
function hasStackCascadeBlockingPendingSelectionBeforeBurstEffect(
  state: GameState,
  head: ActiveStack | undefined
): boolean {
  // A subsequent target prompt belongs to an already-started effect. It must
  // resolve before the delayed burst can establish its activation and open the
  // effect-declaration window.
  if (state.pendingEffectTargetSelection !== null) {
    return true;
  }
  if (head?.actionKind !== "burst_activation" || !head.burstCheckId) {
    return hasStackCascadeBlockingPendingSelection(state);
  }
  const burstCheck = getSelectedBurstCheckAtCascadeHead(state, head);
  if (!burstCheck?.chainId) {
    return hasStackCascadeBlockingPendingSelection(state);
  }
  const unrelatedContinuations = state.pendingAfterTriggersContinuations.filter(
    (continuation) =>
      !isChainAtOrUnder(burstCheck.chainId!, continuation.waitChainId)
  );
  if (
    unrelatedContinuations.length ===
    state.pendingAfterTriggersContinuations.length
  ) {
    return hasStackCascadeBlockingPendingSelection(state);
  }
  return hasStackCascadeBlockingPendingSelection({
    ...state,
    pendingAfterTriggersContinuations: unrelatedContinuations,
  });
}

/**
 * delayed burst の cascade head が発揮宣言へ到達済みかを判定する。
 *
 * 初回の delayed head には `burstEffectDeclarationPending` が付くが、効果発揮
 * 宣言窓を pass した後の head は `:effect-decl` stack でこの marker を持たない。
 * どちらも同じ activationSelected check を指すため、marker の有無ではなく
 * checkId で同一の待機関係を認識する。
 */
function getSelectedBurstCheckAtCascadeHead(
  state: GameState,
  head: ActiveStack | undefined
) {
  if (head?.actionKind !== "burst_activation" || !head.burstCheckId) {
    return undefined;
  }
  const burstCheck = state.pendingBurstChecks.find(
    (pending) => pending.checkId === head.burstCheckId
  );
  return burstCheck?.activationSelected === true ? burstCheck : undefined;
}

/**
 * A selected burst's own pending check is consumed by its resolver. A
 * deferred leave which explicitly waits for that burst must similarly wait
 * until the selected burst and its after-triggers continuation have
 * completed. Exclude only those self-referential blockers while deciding
 * whether the cascade can enter the burst; a shared ancestor chain alone
 * does not make a sibling leave related.
 */
function getStateWithoutCascadeHeadBurstEffectBlockers(
  state: GameState,
  head: ActiveStack | undefined,
  followingStacks: readonly ActiveStack[] = []
): GameState {
  const burstCheck = getSelectedBurstCheckAtCascadeHead(state, head);
  if (!burstCheck?.chainId || !head?.burstCheckId) {
    return state;
  }
  return {
    ...state,
    pendingBurstChecks: state.pendingBurstChecks.filter(
      (check) => check.checkId !== head.burstCheckId
    ),
    pendingLeaveEntities: state.pendingLeaveEntities.filter(
      (pendingLeave) =>
        // An independent outer stack waits for this burst and its reactions.
        // Its own deferred cost leave must remain on the real state, but cannot
        // make the response burst wait for that outer stack in return (02 stack
        // order / fuzz 1558798883). A shared ancestor without this explicit
        // response dependency does not exempt a sibling leave.
        !(
          pendingLeave.deferZoneMoveUntilChainEnd === true &&
          [
            ...followingStacks,
            ...(state.pendingStackCascade?.remainingStacks ?? []),
          ].some(
            (outer) =>
              isChainAtOrUnder(outer.chainId, pendingLeave.chainId) &&
              outer.waitForResolutionChainIds?.some((waitChainId) =>
                isChainAtOrUnder(head.chainId, waitChainId)
              )
          )
        ) &&
        !pendingLeave.reactionChainIds?.some((reactionChainId) =>
          isChainAtOrUnder(burstCheck.chainId!, reactionChainId)
        )
    ),
  };
}

function clearDelayedBurstEffectDeclarationMarkers(
  stack: ActiveStack
): ActiveStack {
  const {
    burstEffectDeclarationPending: _burstEffectDeclarationPending,
    burstEffectDeclarationPreviousWindow: _burstEffectDeclarationPreviousWindow,
    ...stackWithoutDelayedBurstMarkers
  } = stack;
  return stackWithoutDelayedBurstMarkers;
}

function clearDelayedBurstActivationMarkers(stack: ActiveStack): ActiveStack {
  const {
    burstActivationWindowPending: _burstActivationWindowPending,
    burstActivationPreviousWindow: _burstActivationPreviousWindow,
    ...stackWithoutDelayedBurstMarkers
  } = stack;
  return stackWithoutDelayedBurstMarkers;
}

function setStackCascadeFlushGuardStacks(
  state: GameState,
  guardStacks: ActiveStack[] | undefined
): GameState {
  if (guardStacks === undefined) {
    const {
      pendingStackCascadeFlushGuardStacks: _discardFlushGuardStacks,
      ...stateWithoutFlushGuardStacks
    } = state;
    return stateWithoutFlushGuardStacks;
  }
  return {
    ...state,
    pendingStackCascadeFlushGuardStacks: guardStacks,
  };
}

/**
 * 発揮前チェックポイントで止めた通常スタックを再開する前に、実際に解決を待つ
 * player-facing の反応だけを判定する。
 *
 * `hasPendingEffectsBeforeBurstEffect` はバースト発動順を守るため、親スタックの
 * コスト支払いで生じた pending leave と `pendingStackCascade` 自身も blocker として
 * 含める。通常のマジック/効果スタックにそれを流用すると、発揮前誘発を辞退した後に
 * 自分自身を未解決扱いして二度と resume できない。コスト由来の leave は親スタック
 * 解決後の共通 flush に委ね、ここでは宣言誘発そのものの drain だけを待つ。
 */
function hasPendingEffectDeclarationTriggerResolution(
  state: GameState
): boolean {
  return (
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0 ||
    state.battleImmediateEffects.length > 0
  );
}

/**
 * P3-86 案X: 発揮前チェックポイントで中断した `pendingStackCascade` を、誘発が消化されたら再開する。
 * head スタックを狙う発揮前無効化誘発がまだ保留中なら resume しない (次の declare/skip を待つ)。
 * 全て消化済みなら `pendingStackCascade` をクリアして残りスタックのカスケードを続行する。
 */
export function resumeStackCascadeIfReady(
  state: GameState,
  options: DeferredStackResolverOptions
): GameState {
  // 辞退など finalizer を通らない内部呼び出しも、継続再開より先に離脱を再判定する。
  if (options.getRegisteredTriggeredEffectActions) {
    state = pruneIllegalPendingTriggeredEffects({
      state,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    });
  }
  state = flushPendingLeavesAfterReactionProgress(state, options);
  const afterAfterTriggers = resumeAfterTriggersIfReady(state, options);
  if (afterAfterTriggers !== state)
    return resumeStackCascadeIfReady(afterAfterTriggers, options);
  const afterCompletions = flushReadyEffectCompletions(state, options);
  if (afterCompletions !== state)
    return resumeStackCascadeIfReady(afterCompletions, options);

  const afterTargetedDisclosure = resumeTargetedDisclosureIfReady(
    state,
    options
  );
  if (afterTargetedDisclosure !== state) {
    // 子本文の完了待ちを閉じる場合だけ、cleanupから親復帰まで続ける。
    // 通常の対象開示は従来どおり、復元した外側continuationを呼出側へ返す。
    return state.pendingTargetedDisclosureContinuation
      ?.bodyResolutionCompleted === true ||
      afterTargetedDisclosure.pendingTargetedDisclosureContinuation
        ?.bodyResolutionCompleted === true
      ? resumeStackCascadeIfReady(afterTargetedDisclosure, options)
      : afterTargetedDisclosure;
  }

  // engine-magic-field-pre-cost-payment-trigger (BSAZ01-C12「戦力投入」): trigger 済みの
  // pendingFieldMagicPreCostTrigger を、その効果チェーン (core_distribute 等) が汎用
  // パイプラインで完全解決した時点で再開し、中断していた use_magic 呼び出し
  // (コスト支払い) を再投入する。
  const afterFieldMagicPreCostTrigger = resumeFieldMagicPreCostTriggerIfReady(
    state,
    options
  );
  if (afterFieldMagicPreCostTrigger !== state) {
    return afterFieldMagicPreCostTrigger;
  }

  // バースト effect-declaration を含む delayed cascade は、通常 stack だけでなく
  // 宣言前 stack と battle flash sub-stack が完全に閉じるまで再開してはならない。
  // 各 container を個別の caller が見落としても、ここを共通ガードにする。
  if (hasOpenStackWindow(state)) {
    return state;
  }

  // 使用後誘発は、解決した応答とその派生が閉じた後、外側スタックより先。
  // 残りスタックの退避自体は今の使用の未解決処理ではない。
  const savedCascade = state.pendingStackCascade;
  const beforeUsageFinalization = savedCascade
    ? { ...state, pendingStackCascade: null }
    : state;
  const afterUsageFinalization = finalizeCardUsageAndQueueTriggers(
    beforeUsageFinalization,
    options
  );
  if (afterUsageFinalization !== beforeUsageFinalization) {
    state = {
      ...afterUsageFinalization,
      pendingStackCascade: savedCascade
        ? { ...savedCascade, waitForTriggeredEffects: true }
        : null,
    };
  }

  let cascade =
    state.pendingStackCascade?.remainingStacks.length === 0
      ? null
      : state.pendingStackCascade;
  if (!cascade) {
    return state.pendingStackCascade
      ? { ...state, pendingStackCascade: null }
      : state;
  }
  // 完了した本文の無効化を、同時誘発の次の発揮可否より先に対象へ適用する。
  // 宣言時の先取りはしない。本文入力待ち・応答窓中の対価はまだ確定していない。
  // これを次の誘発の後まで遅らせると、同じ効果を2回無効化できると誤判定し、
  // 「召喚することで」の2枚目も対価だけを支払ってしまう。
  if (
    state.pendingStackNegateRequests.length > 0 &&
    !hasPendingEffectResolution(state, "body") &&
    !hasPendingLeaveResolutionChoice(state)
  ) {
    const applied = applyPendingStackNegateRequests({
      state,
      remainingStacks: cascade.remainingStacks,
      getCardDefinitionById: options.getCardDefinitionById,
      includePendingRequests: true,
      includeContinuousRequests: false,
    });
    state = {
      ...applied.state,
      pendingStackCascade: {
        ...cascade,
        remainingStacks: applied.remainingStacks,
      },
    };
    cascade = state.pendingStackCascade!;
  }
  const head = cascade.remainingStacks[0];
  if (
    head?.actionKind === "burst_activation" &&
    head.burstActivationWindowPending === true
  ) {
    if (
      state.pendingPrivateDeclarations.length > 0 ||
      hasPendingBurstActivationSelections(state)
    ) {
      return state;
    }
    const remainingStacks = cascade.remainingStacks.slice(1);
    const remainingCascade =
      remainingStacks.length > 0 ? { ...cascade, remainingStacks } : null;
    const stateWithoutHeadCascade: GameState = {
      ...state,
      window: head.burstActivationPreviousWindow ?? state.window,
      pendingStackCascade: remainingCascade,
    };
    return openQueuedBurstActivationDeclarationWindow({
      stateForWindow: stateWithoutHeadCascade,
      activeStack: clearDelayedBurstActivationMarkers(head),
      actingPlayerId: head.actingPlayerId,
    });
  }
  // バースト効果の宣言/解決に進む前に、待機解除とその実移動後の誘発を確定する。
  //
  // 応答スタックのコスト支払いで発生した離脱は、応答に optional continuation
  // がある間は battle 中の通常 stable-action flush から除外される。応答の完了後、
  // 先頭が選択済み burst へ戻った時点でここで drain しないと、
  // `hasPendingEffectsBeforeBurstEffect` がその離脱を永続 blocker として見続け、
  // cascade が再開しないまま advanceStep の pending-burst guard に到達する。
  if (
    head?.actionKind === "burst_activation" &&
    (head.burstEffectDeclarationPending === true ||
      cascade.waitForTriggeredEffects === true) &&
    state.pendingLeaveEntities.length > 0
  ) {
    state = flushPendingLeavesAndQueueReactions({
      beforeFlushState: state,
      chainId: head.chainId ?? "burst-leave-flush",
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });
  }
  if (state.pendingPrivateDeclarations.length > 0) {
    return state;
  }
  // `hasPendingEffectsBeforeBurstEffect` は未選択バーストの発動順を守るため、
  // activationSelected の check 自身も blocker として数える。ここではその check が
  // cascade の先頭であり、これから effect-declaration window を開く、または
  // `:effect-decl` stack を解決する段階なので判定時だけ除外する。
  const stateWithoutCascadeHeadBurstBlockers =
    getStateWithoutCascadeHeadBurstEffectBlockers(state, head);
  if (
    // Q411: バーストの発揮は派生効果も含めて解決した後。選択入力で cascade が
    // 再構築されても、待機フラグの有無でこの条件を省略してはならない。
    head?.actionKind === "burst_activation"
      ? hasPendingEffectsBeforeBurstEffect(stateWithoutCascadeHeadBurstBlockers)
      : cascade.waitForTriggeredEffects === true &&
        hasPendingEffectDeclarationTriggerResolution(state)
  ) {
    return state;
  }
  if (hasStackCascadeBlockingPendingSelectionBeforeBurstEffect(state, head)) {
    return state;
  }
  if (
    head?.actionKind === "burst_activation" &&
    head.burstEffectDeclarationPending === true
  ) {
    const remainingStacks = cascade.remainingStacks.slice(1);
    const remainingCascade =
      remainingStacks.length > 0 ? { ...cascade, remainingStacks } : null;
    const stateWithoutHeadCascade: GameState = {
      ...state,
      pendingStackCascade: remainingCascade,
    };
    // Q420/Q437: 魂状態等で条件が失われた宣言は本体を発揮せず元に戻す。
    if (
      head.burstCheckId &&
      !state.pendingBurstChecks.some(
        (check) => check.checkId === head.burstCheckId
      )
    ) {
      return resumeStackCascadeIfReady(
        cancelBurstActivation(stateWithoutHeadCascade, head, "condition-lost"),
        options
      );
    }
    const stateAfterActivationSelected = markBurstActivationEstablished({
      getCardDefinitionById: options.getCardDefinitionById,
      state: stateWithoutHeadCascade,
      activeStack: head,
    });
    return openQueuedBurstEffectDeclarationWindow({
      stateForWindow: stateAfterActivationSelected,
      activeStack: clearDelayedBurstEffectDeclarationMarkers(head),
      actingPlayerId: head.actingPlayerId,
      previousWindow: head.burstEffectDeclarationPreviousWindow ?? state.window,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }
  if (head && hasPendingFlashUseTriggerTargeting(state, head.cardInstanceId)) {
    return state;
  }
  return resolveStackCascade(
    { ...state, pendingStackCascade: null },
    cascade.remainingStacks,
    options
  );
}

function hasOpenStackWindow(state: GameState): boolean {
  return (
    state.stackWindow !== null ||
    state.preDeclarationStackWindow !== null ||
    (state.activeAttack?.flashWindowState?.pendingStackAction ?? null) !== null
  );
}

/**
 * duration 無し negate request は、同一 cascade の直後の 1 stack にだけ適用する
 * one-shot である。候補 stack も継続も無い安定点では、次の無関係な action へ
 * 持ち越さず破棄する。duration 指定 request は同一 scope の将来 stack を待つため残す。
 */
export function finalizeOneShotStackNegateRequestsAtStableBoundary(
  state: GameState
): GameState {
  if (
    state.pendingStackCascade !== null ||
    hasOpenStackWindow(state) ||
    hasOutstandingEffectResolutionContinuation(state) ||
    !state.pendingStackNegateRequests.some(
      (request) => request.duration === undefined
    )
  ) {
    return state;
  }
  return {
    ...state,
    pendingStackNegateRequests: state.pendingStackNegateRequests.filter(
      (request) => request.duration !== undefined
    ),
  };
}

function hasAfterTriggersResumeBlocker(state: GameState): boolean {
  // 待機中の outer stack cascade は after_triggers 継続の後に再開する対象である。
  // これを継続自身の blocker に含めると、通常 stack でも継続と cascade が相互待機し、
  // step end の finalization まで進めなくなる。burst の効果発揮宣言待ちも同じ順序である。
  return (
    hasOpenStackWindow(state) ||
    hasPendingLeaveResolutionChoice(state) ||
    hasOutstandingEffectResolutionContinuation({
      ...state,
      pendingAfterTriggersContinuations: [],
      pendingStackCascade: null,
    })
  );
}

function hasChainPendingAfterTriggersDrain(
  state: GameState,
  continuation: PendingAfterTriggersContinuation
): boolean {
  const { waitChainId } = continuation;
  const matches = (candidate: string | null | undefined): boolean =>
    typeof candidate === "string" && isChainAtOrUnder(candidate, waitChainId);
  return (
    state.pendingTriggeredEffects.some((pending) => matches(pending.chainId)) ||
    state.pendingDeferredTriggeredEffects.some((pending) =>
      matches(pending.chainId)
    ) ||
    state.pendingPrivateDeclarations.some((pending) =>
      matches(pending.chainId)
    ) ||
    (state.pendingEffectCompletions ?? []).some(
      (p) =>
        // This effect's completion waits for its remaining body, not vice versa.
        // Completions of derived effects must still drain before that body resumes.
        !(
          p.chainId === continuation.chainId &&
          p.triggerCardInstanceId === continuation.sourceInstanceId
        ) && matches(p.chainId)
    ) ||
    state.pendingAfterTriggersContinuations.some(
      (p) => p.waitChainId !== waitChainId && matches(p.waitChainId)
    )
  );
}

function resolveAfterTriggersContinuationEffect(args: {
  continuation: PendingAfterTriggersContinuation;
  getCardDefinitionById: DeferredStackResolverOptions["getCardDefinitionById"];
}): {
  definition: CardDefinition | undefined;
  effect: import("../dsl-types").Effect;
} {
  const definition = args.getCardDefinitionById(
    args.continuation.sourceDefinitionId
  );
  const effect =
    args.continuation.resumeEffectOverride ??
    resolveContinuationEffect(definition, args.continuation);
  if (!effect) {
    throw new Error(
      `resumeAfterTriggersIfReady: cannot resume effect ${args.continuation.sourceDefinitionId} [${args.continuation.effectIndex}]`
    );
  }
  return { definition, effect };
}

function resumeAfterTriggersIfReady(
  state: GameState,
  options: DeferredStackResolverOptions
): GameState {
  if (hasAfterTriggersResumeBlocker(state)) return state;
  const continuationIndex =
    state.pendingAfterTriggersContinuations.findLastIndex(
      (p) => !hasChainPendingAfterTriggersDrain(state, p)
    );
  if (continuationIndex < 0) return state;
  const continuation =
    state.pendingAfterTriggersContinuations[continuationIndex]!;
  const resolution = createEffectResolutionScope(continuation);
  const remainingContinuations = state.pendingAfterTriggersContinuations.filter(
    (_, i) => i !== continuationIndex
  );
  const pendingStackCascade =
    state.pendingStackCascade?.remainingStacks.length === 0
      ? null
      : state.pendingStackCascade;
  const { effect } = resolveAfterTriggersContinuationEffect({
    continuation,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const beforeResume: GameState = {
    ...state,
    pendingAfterTriggersContinuations: remainingContinuations,
    pendingStackCascade,
    log: [
      ...state.log,
      `effect:after_triggers:resume:${continuation.continuationId}`,
    ],
  };
  let resumed = resolution.execute({
    state: beforeResume,
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
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    ...(options.getRegisteredBurstActions !== undefined
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    startFromStepIndex: continuation.resumeStepIndex,
    restoredStepContext: continuation.stepContext,
    effectResolutionBeforeState:
      continuation.effectResolutionBeforeState ?? beforeResume,
    targetedDisclosureSourceDefinitionId: continuation.sourceDefinitionId,
    // after_triggers の待機中に source instance が転醒・裏返りしても、再開するのは
    // 宣言済み効果本文である。現在のカード定義に解決元を取り替えると、後続の optional
    // continuation が存在しない effectIndex を参照して停止する (EDH-0022)。
    effectSourceDefinitionId:
      continuation.effectSourceDefinitionId ?? continuation.sourceDefinitionId,
    ...(continuation.choiceIndex !== undefined
      ? { choiceIndex: continuation.choiceIndex }
      : {}),
    ...(continuation.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: continuation.sourcePreventionLevel }
      : {}),
    ...(continuation.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: continuation.sourcePreventionBypass }
      : {}),
    ...(continuation.triggerFromZone !== undefined
      ? { triggerFromZone: continuation.triggerFromZone }
      : {}),
    ...(continuation.triggerCause !== undefined
      ? { triggerCause: continuation.triggerCause }
      : {}),
    ...(continuation.triggerRelatedInstanceZone !== undefined
      ? { triggerRelatedInstanceZone: continuation.triggerRelatedInstanceZone }
      : {}),
    ...(continuation.activationZone !== undefined
      ? { activationZone: continuation.activationZone }
      : {}),
    ...(continuation.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: continuation.effectSourceInstanceId }
      : {}),
    ...(continuation.costPaidThisEffect !== undefined
      ? { costPaidThisEffect: continuation.costPaidThisEffect }
      : {}),
    ...(continuation.postResolutionOracle !== undefined
      ? { postResolutionOracle: continuation.postResolutionOracle }
      : {}),
    ...(continuation.targetInstanceIds !== undefined
      ? { targetInstanceIds: [...continuation.targetInstanceIds] }
      : {}),
    ...(continuation.targetStepId !== undefined
      ? { targetStepId: continuation.targetStepId }
      : {}),
    ...(continuation.targetSelectionResolved === true
      ? { targetSelectionResolved: true }
      : {}),
    ...(continuation.targetGroups !== undefined
      ? { targetGroups: continuation.targetGroups }
      : {}),
    ...(continuation.sequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    ...(continuation.recordedUsage !== undefined
      ? { recordedUsage: continuation.recordedUsage }
      : {}),
    ...(continuation.eventAmount !== undefined
      ? { eventAmount: continuation.eventAmount }
      : {}),
    ...(continuation.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            continuation.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(continuation.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: continuation.battleEndDeferralAttackId }
      : {}),
    ...(continuation.rangeAutoResolveStrategy !== undefined
      ? { rangeAutoResolveStrategy: continuation.rangeAutoResolveStrategy }
      : {}),
  });
  const sourceDefinition = options.getCardDefinitionById(
    resumed.cardInstances.find(
      (card) => card.instanceId === continuation.sourceInstanceId
    )?.definitionId ?? continuation.sourceDefinitionId
  );
  resumed = resolution.finalize({
    state: resumed,
    beforeState: beforeResume,
    endLogs: [],
    actingPlayerId: continuation.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(sourceDefinition !== undefined
      ? {
          sourceColors: getEffectResolutionSourceColors(
            resumed,
            continuation.sourceInstanceId,
            sourceDefinition
          ),
          sourceCategory: sourceDefinition.printedCategory,
        }
      : {}),
    causedBySourceInstanceId:
      continuation.effectSourceInstanceId ?? continuation.sourceInstanceId,
    enterFieldCausedByPlayerId: continuation.actingPlayerId,
    ...(continuation.battleEndDeferralAttackId !== undefined
      ? {
          battleEndDeferralAttackId: continuation.battleEndDeferralAttackId,
        }
      : {}),
  });
  resumed = checkAndQueuePostResolutionOracleIfReady(
    resumed,
    continuation.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  return maybeFinalizeBattleEndScopeAfterPendingDrain(resumed, options);
}

export function attachTargetedDisclosureResolutionCleanups(
  state: GameState,
  cleanups: readonly TargetedDisclosureResolutionCleanup[] | undefined
): GameState {
  if (!cleanups || cleanups.length === 0) return state;
  if (cleanups.length > 1) {
    return cleanups.reduce(
      (current, cleanup) =>
        attachTargetedDisclosureResolutionCleanups(current, [cleanup]),
      state
    );
  }
  const continuation = state.pendingTargetedDisclosureContinuation;
  const resolutionChainId = cleanups[0]!.resolutionChainId;
  if (
    continuation &&
    resolutionChainId !== undefined &&
    !isChainAtOrUnder(continuation.chainId, resolutionChainId)
  ) {
    // 復元済みの外側宣言は、この子効果の未完了carrierではない。
    // 子自身が作った入力pendingへだけ預け、なければ呼出側で即時失効する。
    const withoutParent = {
      ...state,
      pendingTargetedDisclosureContinuation: null,
    };
    const attached = attachTargetedDisclosureResolutionCleanups(
      withoutParent,
      cleanups
    );
    return attached === withoutParent
      ? state
      : { ...attached, pendingTargetedDisclosureContinuation: continuation };
  }
  if (continuation) {
    const nextContinuation = {
      ...continuation,
      resolutionCleanups: [
        ...(continuation.resolutionCleanups ?? []),
        ...cleanups,
      ],
    };
    const stepOptional = state.pendingStepOptionalChoice;
    const stepChoice = state.pendingStepChoice;
    const deckBoost = state.pendingDeckRevealCountBoostChoice;
    const nextStepOptional =
      stepOptional?.continuation.targetedDisclosureContinuation !== undefined
        ? {
            ...stepOptional,
            continuation: {
              ...stepOptional.continuation,
              targetedDisclosureContinuation: {
                ...stepOptional.continuation.targetedDisclosureContinuation,
                resolutionCleanups: [
                  ...(stepOptional.continuation.targetedDisclosureContinuation
                    .resolutionCleanups ?? []),
                  ...cleanups,
                ],
              },
            },
          }
        : stepOptional;
    const nextStepChoice =
      stepChoice?.continuation.targetedDisclosureContinuation !== undefined
        ? {
            ...stepChoice,
            continuation: {
              ...stepChoice.continuation,
              targetedDisclosureContinuation: {
                ...stepChoice.continuation.targetedDisclosureContinuation,
                resolutionCleanups: [
                  ...(stepChoice.continuation.targetedDisclosureContinuation
                    .resolutionCleanups ?? []),
                  ...cleanups,
                ],
              },
            },
          }
        : stepChoice;
    const nextDeckBoost =
      deckBoost?.continuation.targetedDisclosureContinuation !== undefined
        ? {
            ...deckBoost,
            continuation: {
              ...deckBoost.continuation,
              targetedDisclosureContinuation: {
                ...deckBoost.continuation.targetedDisclosureContinuation,
                resolutionCleanups: [
                  ...(deckBoost.continuation.targetedDisclosureContinuation
                    .resolutionCleanups ?? []),
                  ...cleanups,
                ],
              },
            },
          }
        : deckBoost;
    return {
      ...state,
      pendingTargetedDisclosureContinuation: nextContinuation,
      pendingStepOptionalChoice: nextStepOptional ?? null,
      pendingStepChoice: nextStepChoice ?? null,
      pendingDeckRevealCountBoostChoice: nextDeckBoost ?? null,
    };
  }
  const capacityChoice = state.pendingZoneSelection;
  if (capacityChoice?.braveCapacityHostInstanceId !== undefined) {
    return {
      ...state,
      pendingZoneSelection: {
        ...capacityChoice,
        targetedDisclosureResolutionCleanups: [
          ...(capacityChoice.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const coreCount = state.pendingCoreCountSelection;
  if (coreCount) {
    return {
      ...state,
      pendingCoreCountSelection: {
        ...coreCount,
        targetedDisclosureResolutionCleanups: [
          ...(coreCount.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const lifeCore = state.pendingLifeCoreSelection;
  if (lifeCore) {
    return {
      ...state,
      pendingLifeCoreSelection: {
        ...lifeCore,
        targetedDisclosureResolutionCleanups: [
          ...(lifeCore.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const coreSource = state.pendingCoreSourceAllocation;
  if (coreSource) {
    return {
      ...state,
      pendingCoreSourceAllocation: {
        ...coreSource,
        targetedDisclosureResolutionCleanups: [
          ...(coreSource.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const coreDistribution = state.pendingCoreDistribution;
  if (coreDistribution) {
    return {
      ...state,
      pendingCoreDistribution: {
        ...coreDistribution,
        targetedDisclosureResolutionCleanups: [
          ...(coreDistribution.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const stepOptional = state.pendingStepOptionalChoice;
  const stepChoice = state.pendingStepChoice;
  if (stepOptional) {
    return {
      ...state,
      pendingStepOptionalChoice: {
        ...stepOptional,
        targetedDisclosureResolutionCleanups: [
          ...(stepOptional.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  if (stepChoice) {
    return {
      ...state,
      pendingStepChoice: {
        ...stepChoice,
        targetedDisclosureResolutionCleanups: [
          ...(stepChoice.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const deckBoost = state.pendingDeckRevealCountBoostChoice;
  if (deckBoost) {
    return {
      ...state,
      pendingDeckRevealCountBoostChoice: {
        ...deckBoost,
        targetedDisclosureResolutionCleanups: [
          ...(deckBoost.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const lifeDamageDiscard = state.pendingLifeDamageDiscardChoice;
  if (lifeDamageDiscard) {
    return {
      ...state,
      pendingLifeDamageDiscardChoice: {
        ...lifeDamageDiscard,
        targetedDisclosureResolutionCleanups: [
          ...(lifeDamageDiscard.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  const lifeGainReplacement = state.pendingLifeGainReplacementChoice;
  if (lifeGainReplacement) {
    return {
      ...state,
      pendingLifeGainReplacementChoice: {
        ...lifeGainReplacement,
        targetedDisclosureResolutionCleanups: [
          ...(lifeGainReplacement.targetedDisclosureResolutionCleanups ?? []),
          ...cleanups,
        ],
      },
    };
  }
  return state;
}

export function applyOrDeferTargetedDisclosureResolutionCleanups(
  state: GameState,
  cleanups: readonly TargetedDisclosureResolutionCleanup[] | undefined
): GameState {
  if (!cleanups || cleanups.length === 0) return state;
  return cleanups.reduce((current, cleanup) => {
    const attached = attachTargetedDisclosureResolutionCleanups(current, [
      cleanup,
    ]);
    return attached !== current
      ? attached
      : applyTargetedDisclosureResolutionCleanups(current, [cleanup]);
  }, state);
}

export function hasPendingTargetedDisclosureCleanupCarrier(
  state: GameState
): boolean {
  return (
    state.pendingTargetedDisclosureContinuation !== null ||
    state.pendingCoreCountSelection !== null ||
    state.pendingLifeCoreSelection !== null ||
    state.pendingCoreSourceAllocation !== null ||
    state.pendingLinkAidCostSourceChoice !== null ||
    state.pendingZoneSelection?.braveCapacityHostInstanceId !== undefined ||
    state.pendingCoreDistribution !== null ||
    state.pendingChangeCleanupChoice !== null ||
    state.pendingStepOptionalChoice !== null ||
    state.pendingDeckRevealCountBoostChoice !== null ||
    state.pendingStepChoice !== null
  );
}

export function applyTargetedDisclosureResolutionCleanupsWhenReady(
  state: GameState,
  cleanups: readonly TargetedDisclosureResolutionCleanup[] | undefined
): GameState {
  if (!cleanups || cleanups.length === 0) return state;
  if (hasPendingTargetedDisclosureCleanupCarrier(state)) {
    return applyOrDeferTargetedDisclosureResolutionCleanups(state, cleanups);
  }
  return applyTargetedDisclosureResolutionCleanups(state, cleanups);
}

export function stashTargetedDisclosureRemainingStackCascade(
  state: GameState,
  remainingStacks: readonly ActiveStack[]
): GameState {
  if (remainingStacks.length === 0) return state;
  return {
    ...state,
    pendingStackCascade: {
      remainingStacks: [
        ...(state.pendingStackCascade?.remainingStacks ?? []),
        ...remainingStacks,
      ],
    },
  };
}

export function applyTargetedDisclosureResolutionCleanups(
  state: GameState,
  cleanups: readonly TargetedDisclosureResolutionCleanup[] | undefined
): GameState {
  if (!cleanups || cleanups.length === 0) return state;
  return cleanups.reduce((current, cleanup) => {
    switch (cleanup.kind) {
      case "burst_activation_immunity":
        return removeBurstActivationImmunity(current, cleanup.checkId, [
          ...cleanup.effectIds,
        ]);
      case "continuous_effects": {
        const effectIds = new Set(cleanup.effectIds);
        return {
          ...current,
          activeContinuousEffects: current.activeContinuousEffects.filter(
            (effect) => !effectIds.has(effect.effectId)
          ),
        };
      }
    }
  }, state);
}

/**
 * targetEffectTiming 未指定の negateTarget:"effect" は stackMatchesNegateTarget 側で意図的に
 * magic を対象外とする (同一マジック内の複数タイミング効果からどれを指すか一般 cascade
 * スキャンでは一意に決まらないため。P3-75 契約テスト p3-75-generic-negate-pending-stack.test.ts
 * で固定済み、変更禁止)。だが targeted disclosure 応答の解決先は candidateStack 1つに
 * 確定済みで曖昧さが無いため、このローカル一致判定に限り candidateStack 自身の確定済み
 * タイミングを補って渡す。補完は state へ永続化せず (unmatched request は元の未指定形へ戻す)、
 * 他の negate request の一般解決には影響させない。deferredStackResolution / negateIdentitySnapshot
 * (P3-131層2) の両経路で共有する SSOT。
 */
function applyTimingProbedStackNegateRequests(options: {
  state: GameState;
  candidateStack: ActiveStack;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): { state: GameState; candidateStack: ActiveStack } {
  const inferredMagicTiming: "main" | "flash" | "stack" | undefined =
    options.candidateStack.actionKind === "magic"
      ? options.candidateStack.activationLabel !== undefined &&
        options.candidateStack.activationLabel !== "none"
        ? options.candidateStack.activationLabel
        : options.candidateStack.chosenTiming
      : undefined;
  const probedRequests =
    inferredMagicTiming !== undefined
      ? options.state.pendingStackNegateRequests.map((request) =>
          request.targetEffectTiming === undefined
            ? { ...request, targetEffectTiming: inferredMagicTiming }
            : request
        )
      : options.state.pendingStackNegateRequests;
  const negateApplied = applyPendingStackNegateRequests({
    state: { ...options.state, pendingStackNegateRequests: probedRequests },
    remainingStacks: [options.candidateStack],
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const reconciledNegateRequests =
    inferredMagicTiming !== undefined
      ? negateApplied.state.pendingStackNegateRequests.map((request) => {
          if (request.targetEffectTiming !== inferredMagicTiming) {
            return request;
          }
          const original = options.state.pendingStackNegateRequests.find(
            (r) => r.requestId === request.requestId
          );
          return original && original.targetEffectTiming === undefined
            ? original
            : request;
        })
      : negateApplied.state.pendingStackNegateRequests;
  return {
    state: {
      ...negateApplied.state,
      pendingStackNegateRequests: reconciledNegateRequests,
    },
    candidateStack: negateApplied.remainingStacks[0]!,
  };
}

export function resumeTargetedDisclosureIfReady(
  state: GameState,
  options: DeferredStackResolverOptions
): GameState {
  const cont = state.pendingTargetedDisclosureContinuation;
  if (!cont) return state;
  const resolution = createEffectResolutionScope(cont);
  const resolutionCleanups = cont.resolutionCleanups?.map((cleanup) => ({
    ...cleanup,
    resolutionChainId: cleanup.resolutionChainId ?? cont.chainId,
  }));
  const isResponse = (pending: { chainId: string | null }) =>
    // 対象開示は :target: 以下の内側区間。元行動と同じchainの配置誘発/神託は
    // 外側の待機であり、ここで待つと合法手の内側優先と相互待機になる。
    pending.chainId !== null &&
    pending.chainId !== cont.chainId &&
    isChainAtOrUnder(pending.chainId, cont.chainId);
  if (
    hasOpenStackWindow(state) ||
    state.pendingPrivateDeclarations.some(isResponse) ||
    state.pendingTriggeredEffects.some(isResponse) ||
    state.pendingDeferredTriggeredEffects.some(isResponse) ||
    // 発動選択済みのバーストは外側 stack の保留であり、対象開示への応答を
    // 解消してから戻る必要がある。ここで全 pendingBurstChecks を blocker に
    // すると、内側の対象開示 continuation が永遠に再開されない。
    state.pendingBurstChecks.some(
      (p) => isResponse(p) && p.activationSelected !== true
    )
  ) {
    return state;
  }
  if (
    hasOutstandingEffectResolutionContinuation({
      ...state,
      pendingTargetedDisclosureContinuation: null,
      pendingStackCascade: null,
      pendingAfterTriggersContinuations:
        state.pendingAfterTriggersContinuations.filter((p) =>
          isChainAtOrUnder(p.chainId, cont.chainId)
        ),
    })
  ) {
    return state;
  }

  if (cont.bodyResolutionCompleted === true) {
    const cleaned = applyTargetedDisclosureResolutionCleanups(
      {
        ...state,
        pendingTargetedDisclosureContinuation:
          cont.previousTargetedDisclosureContinuation ?? null,
      },
      resolutionCleanups
    );
    return resolveStackCascade(cleaned, cont.remainingStacks, options);
  }

  if (resolutionCleanups?.length) {
    // 02/03f: 子効果の入力と派生処理を完了してから親へ戻る。
    // pending種類ごとのcleanup転記ではなく、共通の解決待ちを保持する。
    // 後続入力のcontinuationもこの完了待ちを保存するため、本文を再実行しない。
    const completion: TargetedDisclosureContinuation = {
      ...cont,
      bodyResolutionCompleted: true,
      resolutionCleanups,
    };
    const { resolutionCleanups: _cleanups, ...body } = cont;
    const resumed = resumeTargetedDisclosureIfReady(
      {
        ...state,
        pendingTargetedDisclosureContinuation: {
          ...body,
          remainingStacks: [],
          previousTargetedDisclosureContinuation: completion,
        },
      },
      options
    );
    return resumed.pendingTargetedDisclosureContinuation
      ?.bodyResolutionCompleted === true &&
      resumed.pendingTargetedDisclosureContinuation.pendingId ===
        completion.pendingId
      ? resumeTargetedDisclosureIfReady(resumed, options)
      : resumed;
  }

  if (cont.deferredStackResolution) {
    const previousContinuation =
      cont.previousTargetedDisclosureContinuation ?? null;
    const beforeResume: GameState = {
      ...state,
      pendingTargetedDisclosureContinuation: previousContinuation,
    };
    const {
      targetGroups: _staleTargetGroups,
      ...deferredStackWithoutStaleGroups
    } = cont.deferredStackResolution.deferredStack;
    const targetInstanceIds = filterTargetsStillInSnapshottedZones(
      state,
      cont.targetInstanceIds,
      cont.targetZonesByInstanceId
    );
    const candidateStack: ActiveStack = {
      ...deferredStackWithoutStaleGroups,
      targetInstanceIds,
      ...(cont.targetZonesByInstanceId !== undefined
        ? { targetZonesByInstanceId: cont.targetZonesByInstanceId }
        : {}),
      targetSelectionResolved: true,
      preservePreSelectedTargetRefs: true,
      ...(cont.targetGroups !== undefined
        ? { targetGroups: cont.targetGroups }
        : {}),
      // まとめて確定した対象は宣言時の範囲を保持する。単独stepの対象選択では
      // 継続のstepを復元し、次stepの対象指定・開示を独立に進める。
      ...(!cont.targetGroups?.length && cont.targetStepId !== undefined
        ? { targetStepId: cont.targetStepId }
        : {}),
    };
    // ENGINE-targeted-disclosure-offfield-source: targeted disclosure への応答
    // (game_event:"targeted" 誘発) の negate ステップは executeNegate で
    // pendingStackNegateRequests へ単発 request を積むのみで、通常の
    // resolveStackCascade 側 workingStacks 巡回には乗らない (disclosure 応答は
    // ActiveStack カスケードでなく pendingTriggeredEffects 経由で解決するため)。
    // 開示元 deferredStack をここで applyPendingStackNegateRequests に通し、
    // 既存 SSOT (stackMatchesNegateAction) で一致すれば isNullified を反映してから
    // 解決再開する (BSLH01-T14「対象とした相手の効果すべてを無効にする」)。
    const probed = applyTimingProbedStackNegateRequests({
      state: beforeResume,
      candidateStack,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    const afterResumed = resolveDeferredStackAction(
      probed.state,
      probed.candidateStack,
      options
    );
    if (
      afterResumed.pendingTargetedDisclosureContinuation !==
      previousContinuation
    ) {
      return applyOrDeferTargetedDisclosureResolutionCleanups(
        afterResumed,
        resolutionCleanups
      );
    }
    const cleaned = applyOrDeferTargetedDisclosureResolutionCleanups(
      afterResumed,
      resolutionCleanups
    );
    return resolveStackCascade(cleaned, cont.remainingStacks, options);
  }

  if (cont.handWrittenResolution) {
    return resumeHandWrittenTargetedDisclosure(cont, state, options);
  }

  const previousContinuation =
    cont.previousTargetedDisclosureContinuation ?? null;
  const beforeResume: GameState = {
    ...state,
    pendingTargetedDisclosureContinuation: previousContinuation,
  };
  const targetInstanceIds = filterTargetsStillInSnapshottedZones(
    state,
    cont.targetInstanceIds,
    cont.targetZonesByInstanceId
  );
  if (cont.coreDistributionPending !== undefined) {
    const combinedCleanups = [
      ...(cont.coreDistributionPending.targetedDisclosureResolutionCleanups ??
        []),
      ...(resolutionCleanups ?? []),
    ];
    const coreDistributionPending = {
      ...cont.coreDistributionPending,
      ...(cont.coreDistributionPending.targetInterruption !== undefined
        ? {
            targetInterruption: {
              ...cont.coreDistributionPending.targetInterruption,
              targetedDisclosureResolved: true,
            },
          }
        : {}),
      ...(combinedCleanups.length > 0
        ? { targetedDisclosureResolutionCleanups: combinedCleanups }
        : {}),
    };
    const action = {
      kind: "resolve_pending_core_distribution" as const,
      actionId: `targeted-disclosure-resume:${cont.pendingId}`,
      can: true as const,
      reason: "targeted_disclosure_core_distribution_resume",
      actingPlayerId: coreDistributionPending.actingPlayerId,
      pendingId: coreDistributionPending.pendingId,
      candidates: coreDistributionPending.candidates.map((candidate) => ({
        ...candidate,
      })),
      totalNormalCores: coreDistributionPending.totalNormalCores,
      hasSoulCore: coreDistributionPending.hasSoulCore,
      ...(coreDistributionPending.totalSoulCores !== undefined
        ? { totalSoulCores: coreDistributionPending.totalSoulCores }
        : {}),
      fromKind: coreDistributionPending.fromKind,
      ...(coreDistributionPending.allowedSources !== undefined
        ? { allowedSources: [...coreDistributionPending.allowedSources] }
        : {}),
      ...(coreDistributionPending.sourceAvailable !== undefined
        ? { sourceAvailable: { ...coreDistributionPending.sourceAvailable } }
        : {}),
      ...(coreDistributionPending.soulSourceAvailable !== undefined
        ? {
            soulSourceAvailable: {
              ...coreDistributionPending.soulSourceAvailable,
            },
          }
        : {}),
      ...(coreDistributionPending.minTotal !== undefined
        ? { minTotal: coreDistributionPending.minTotal }
        : {}),
      ...(coreDistributionPending.maxTotal !== undefined
        ? { maxTotal: coreDistributionPending.maxTotal }
        : {}),
      ...(coreDistributionPending.mustPlaceSoulCore !== undefined
        ? { mustPlaceSoulCore: coreDistributionPending.mustPlaceSoulCore }
        : {}),
      ...(coreDistributionPending.maxPerCandidate !== undefined
        ? { maxPerCandidate: coreDistributionPending.maxPerCandidate }
        : {}),
      ...(coreDistributionPending.allocationGroups !== undefined
        ? { allocationGroups: coreDistributionPending.allocationGroups }
        : {}),
      fromPlayerId: coreDistributionPending.fromPlayerId,
      toPlayerId: coreDistributionPending.toPlayerId,
    };
    const result = applyPendingCoreDistributionAction({
      ...options,
      state: {
        ...beforeResume,
        pendingCoreDistribution: coreDistributionPending,
      },
      action,
      coreDistributionAllocations: {
        ...(cont.coreDistributionAllocations ?? {}),
      },
      ...(cont.coreDistributionSourceAllocations !== undefined
        ? {
            coreDistributionSourceAllocations: {
              ...cont.coreDistributionSourceAllocations,
            },
          }
        : {}),
      ...(cont.coreDistributionSoulCoreSourceAllocations !== undefined
        ? {
            coreDistributionSoulCoreSourceAllocations: {
              ...cont.coreDistributionSoulCoreSourceAllocations,
            },
          }
        : {}),
      ...(cont.coreDistributionSoulCoreInstanceId !== undefined
        ? {
            coreDistributionSoulCoreInstanceId:
              cont.coreDistributionSoulCoreInstanceId,
          }
        : {}),
      ...(cont.coreDistributionSoulCoreAllocations !== undefined
        ? {
            coreDistributionSoulCoreAllocations: {
              ...cont.coreDistributionSoulCoreAllocations,
            },
          }
        : {}),
    });
    const resumed = result.state;
    if (hasOutstandingEffectResolutionContinuation(resumed)) {
      return stashTargetedDisclosureRemainingStackCascade(
        resumed,
        cont.remainingStacks
      );
    }
    return resolveStackCascade(resumed, cont.remainingStacks, options);
  }
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  const effect = resolveContinuationEffect(def, cont);
  if (!def || !effect) {
    throw new Error(
      `resumeTargetedDisclosureIfReady: cannot resume effect — definition ${cont.sourceDefinitionId} or effects[${cont.effectIndex}] missing`
    );
  }
  // P3-131層2: 素の step-continuation 形 (deferredStackResolution を持たない) は
  // negateIdentitySnapshot (呼び出し元が渡した元 activeStack のスナップショット) がある
  // 場合のみ、deferredStackResolution 分岐と同じ SSOT で negate 応答を照合する。無ければ
  // 従来通り (未対応の action kind は素通り、既知の残 gap)。
  let stateBeforeStepResume = beforeResume;
  let negatedByTargetedDisclosureResponse = false;
  if (cont.negateIdentitySnapshot) {
    const identityStack: ActiveStack = {
      ...cont.negateIdentitySnapshot,
      targetInstanceIds,
    };
    const probed = applyTimingProbedStackNegateRequests({
      state: beforeResume,
      candidateStack: identityStack,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    stateBeforeStepResume = probed.state;
    negatedByTargetedDisclosureResponse =
      probed.candidateStack.isNullified === true;
  }
  let resumed = negatedByTargetedDisclosureResponse
    ? {
        ...stateBeforeStepResume,
        log: [
          ...stateBeforeStepResume.log,
          `effect:negate:targeted-disclosure-step-continuation:${cont.pendingId}`,
        ],
      }
    : resolution.execute({
        state: stateBeforeStepResume,
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
        targetedDisclosureSourceDefinitionId: cont.sourceDefinitionId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
        ...(options.getRegisteredBurstActions !== undefined
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(cont.effectResolutionBeforeState !== undefined
          ? { effectResolutionBeforeState: cont.effectResolutionBeforeState }
          : {}),
        startFromStepIndex: cont.resumeStepIndex,
        ...(cont.optionalExecuteResumeStepIndex !== undefined
          ? {
              optionalExecuteResumeStepIndex:
                cont.optionalExecuteResumeStepIndex,
            }
          : {}),
        restoredStepContext: cont.stepContext,
        ...(cont.repeatResume !== undefined
          ? { repeatResume: cont.repeatResume }
          : {}),
        targetInstanceIds,
        targetSelectionResolved: true,
        // 03b:112-115: 対象開示済みの TargetRef は対象取得をやり直さず、
        // action 固有の affect gate へ渡す。対象 zone を離れたものは continuation
        // 作成／resume 側の presence revalidation で既に除外されている。
        preservePreSelectedTargetRefs: true,
        ...(cont.targetGroups !== undefined
          ? { targetGroups: cont.targetGroups }
          : {}),
        ...(cont.sequentialTargetConsumption === true
          ? { sequentialTargetConsumption: true }
          : {}),
        ...(cont.targetStepId !== undefined
          ? { targetStepId: cont.targetStepId }
          : {}),
        skipTargetedDisclosureAtStartStep: true,
        skipTargetedDisclosureStepId: cont.targetStepId,
        ...(cont.skipTargetedDisclosureTargetStart !== undefined
          ? {
              skipTargetedDisclosureTargetStartAtStartStep:
                cont.skipTargetedDisclosureTargetStart,
            }
          : {}),
        ...(cont.skipTargetedDisclosureTargetCount !== undefined
          ? {
              skipTargetedDisclosureTargetCountAtStartStep:
                cont.skipTargetedDisclosureTargetCount,
            }
          : {}),
        ...(cont.effectActionKind !== undefined
          ? { effectActionKind: cont.effectActionKind }
          : {}),
        ...(cont.effectActivationTiming !== undefined
          ? { effectActivationTiming: cont.effectActivationTiming }
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
        ...(cont.triggerFromZone !== undefined
          ? { triggerFromZone: cont.triggerFromZone }
          : {}),
        ...(cont.triggerCause !== undefined
          ? { triggerCause: cont.triggerCause }
          : {}),
        ...(cont.triggerRelatedInstanceZone !== undefined
          ? { triggerRelatedInstanceZone: cont.triggerRelatedInstanceZone }
          : {}),
        ...(cont.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: cont.effectSourceInstanceId }
          : {}),
        ...(cont.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
          : {}),
        ...(cont.costPaidThisEffect !== undefined
          ? { costPaidThisEffect: cont.costPaidThisEffect }
          : {}),
        ...(cont.postResolutionOracle !== undefined
          ? { postResolutionOracle: cont.postResolutionOracle }
          : {}),
        ...(cont.battleEndDeferralAttackId !== undefined
          ? {
              battleEndDeferralAttackId: cont.battleEndDeferralAttackId,
            }
          : {}),
      });
  if (resumed.pendingTargetedDisclosureContinuation !== previousContinuation) {
    return applyOrDeferTargetedDisclosureResolutionCleanups(
      resumed,
      resolutionCleanups
    );
  }
  const paused = hasOutstandingEffectResolutionContinuation(resumed);
  resumed = resolution.finalize({
    state: resumed,
    beforeState: cont.effectResolutionBeforeState ?? beforeResume,
    endLogs: [],
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getEffectResolutionSourceColors(
      resumed,
      cont.sourceInstanceId,
      def
    ),
    causedBySourceInstanceId:
      cont.effectSourceInstanceId ?? cont.sourceInstanceId,
    enterFieldCausedByPlayerId: cont.actingPlayerId,
    ...(cont.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
      : {}),
  });
  resumed = paused
    ? applyOrDeferTargetedDisclosureResolutionCleanups(
        resumed,
        resolutionCleanups
      )
    : applyTargetedDisclosureResolutionCleanups(resumed, resolutionCleanups);
  resumed = checkAndQueuePostResolutionOracleIfReady(
    resumed,
    cont.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  if (paused) {
    return stashTargetedDisclosureRemainingStackCascade(
      resumed,
      cont.remainingStacks
    );
  }
  // P3-131層2傍証: この step-continuation resume 経路は resolveMagicMainAndMoveToTrash の
  // 呼び出しフレームを経由しない (中断時に unwind 済み) ため、magic の in_use→trash が
  // 素通りされる (cleanupCompletedBattleEndDeferralMagicSourceIfReady と同型の穴)。
  resumed = moveCompletedInUseMagicCardToTrashIfReady({
    state: resumed,
    sourceInstanceId: cont.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    logLabel: cont.pendingId,
  });
  return maybeFinalizeBattleEndScopeAfterPendingDrain(
    resolveStackCascade(resumed, cont.remainingStacks, options),
    options
  );
}

export function resumeHandWrittenTargetedDisclosure(
  cont: NonNullable<GameState["pendingTargetedDisclosureContinuation"]>,
  state: GameState,
  options: DeferredStackResolverOptions
): GameState {
  const resume = cont.handWrittenResolution;
  if (!resume) return state;
  const resolution = createEffectResolutionScope(
    resume,
    cont.battleEndDeferralAttackId
  );
  const getResolver = options.getHandWrittenEffectResolver;
  if (!getResolver) {
    throw new Error(
      "resumeHandWrittenTargetedDisclosure: getHandWrittenEffectResolver is required"
    );
  }
  const def = options.getCardDefinitionById(cont.sourceDefinitionId);
  if (!def) {
    throw new Error(
      `resumeHandWrittenTargetedDisclosure: cannot resume definition ${cont.sourceDefinitionId}`
    );
  }

  const previousContinuation =
    cont.previousTargetedDisclosureContinuation ?? null;
  const beforeResume: GameState = {
    ...state,
    pendingTargetedDisclosureContinuation: previousContinuation,
  };
  const targetInstanceIds = filterTargetsStillInSnapshottedZones(
    state,
    cont.targetInstanceIds,
    cont.targetZonesByInstanceId
  );
  const sourceCard =
    beforeResume.cardInstances.find(
      (card) => card.instanceId === cont.sourceInstanceId
    ) ?? resume.sourceCard;
  const effectResolutionSourceInstanceId =
    cont.effectSourceInstanceId ?? cont.sourceInstanceId;
  const context = {
    chainId: resolution.chainId,
    resolutionKind: resume.resolutionKind,
    actingPlayerId: cont.actingPlayerId,
    sourceKind: resume.sourceKind,
    sourceCard,
    sourceDefinition: def,
    targetEffectIndex: cont.effectIndex,
    ...(cont.divineSkillIndex !== undefined
      ? { divineSkillIndex: cont.divineSkillIndex }
      : resume.divineSkillIndex !== undefined
        ? { divineSkillIndex: resume.divineSkillIndex }
        : {}),
    ...(cont.isAccelData !== undefined
      ? { isAccelData: cont.isAccelData }
      : resume.isAccelData !== undefined
        ? { isAccelData: resume.isAccelData }
        : {}),
    ...(cont.isChangeData !== undefined
      ? { isChangeData: cont.isChangeData }
      : resume.isChangeData !== undefined
        ? { isChangeData: resume.isChangeData }
        : {}),
    ...(cont.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: cont.effectSourceInstanceId }
      : {}),
    ...(cont.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: cont.effectSourceDefinitionId }
      : {}),
    targetInstanceIds,
    preservePreSelectedTargetRefs: true,
    ...(cont.targetStepId !== undefined
      ? { targetStepId: cont.targetStepId }
      : {}),
    ...(cont.targetGroups !== undefined
      ? { targetGroups: cont.targetGroups }
      : {}),
    ...(cont.sequentialTargetConsumption === true
      ? { sequentialTargetConsumption: true }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.getRegisteredBattleImmediateEffectActions !== undefined
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(resume.choiceIndex !== undefined
      ? { choiceIndex: resume.choiceIndex }
      : {}),
    ...(resume.effectActionKind !== undefined
      ? { effectActionKind: resume.effectActionKind }
      : {}),
    ...(resume.effectActivationTiming !== undefined
      ? { effectActivationTiming: resume.effectActivationTiming }
      : {}),
    ...(resume.forceLevel !== undefined
      ? { forceLevel: resume.forceLevel }
      : {}),
    ...(resume.pendingEffectSimultaneousGroupId !== undefined
      ? {
          pendingEffectSimultaneousGroupId:
            resume.pendingEffectSimultaneousGroupId,
        }
      : {}),
    ...(resume.eventAmount !== undefined
      ? { eventAmount: resume.eventAmount }
      : {}),
    ...(resume.effectFieldEntrySource !== undefined
      ? { effectFieldEntrySource: resume.effectFieldEntrySource }
      : {}),
    ...(resume.effectTimingFilter !== undefined
      ? { effectTimingFilter: resume.effectTimingFilter }
      : {}),
    ...(resume.effectEventAction !== undefined
      ? { effectEventAction: resume.effectEventAction }
      : {}),
    ...(resume.sourcePreventionLevel !== undefined
      ? { sourcePreventionLevel: resume.sourcePreventionLevel }
      : {}),
    ...(resume.sourcePreventionBypass !== undefined
      ? { sourcePreventionBypass: resume.sourcePreventionBypass }
      : {}),
    ...(resume.triggerFromZone !== undefined
      ? { triggerFromZone: resume.triggerFromZone }
      : {}),
    ...(resume.triggerCause !== undefined
      ? { triggerCause: resume.triggerCause }
      : {}),
    ...(resume.triggerRelatedInstanceZone !== undefined
      ? { triggerRelatedInstanceZone: resume.triggerRelatedInstanceZone }
      : {}),
    ...(resume.triggerRelatedCombinedHostInstanceId !== undefined
      ? {
          triggerRelatedCombinedHostInstanceId:
            resume.triggerRelatedCombinedHostInstanceId,
        }
      : {}),
    ...(resume.payCostPaymentSources !== undefined
      ? { payCostPaymentSources: resume.payCostPaymentSources }
      : {}),
    ...(resume.summonPaymentSources !== undefined
      ? { summonPaymentSources: resume.summonPaymentSources }
      : {}),
    ...(resume.summonEnterFieldCorePlacements !== undefined
      ? {
          summonEnterFieldCorePlacements: resume.summonEnterFieldCorePlacements,
        }
      : {}),
    ...(cont.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
      : {}),
  };

  let stateBeforeResolver = beforeResume;
  let negatedByTargetedDisclosureResponse = false;
  if (cont.negateIdentitySnapshot) {
    const identityStack: ActiveStack = {
      ...cont.negateIdentitySnapshot,
      targetInstanceIds,
    };
    const probed = applyTimingProbedStackNegateRequests({
      state: beforeResume,
      candidateStack: identityStack,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    stateBeforeResolver = probed.state;
    negatedByTargetedDisclosureResponse =
      probed.candidateStack.isNullified === true;
  }

  let resolved = negatedByTargetedDisclosureResponse
    ? {
        ...stateBeforeResolver,
        log: [
          ...stateBeforeResolver.log,
          `effect:negate:targeted-disclosure-hand-written:${cont.pendingId}`,
        ],
      }
    : executeHandWrittenEffectResolver({
        state: stateBeforeResolver,
        context,
        getResolver,
      });
  const paused = hasOutstandingEffectResolutionContinuation(resolved);
  resolved = resolution.finalize({
    state: resolved,
    beforeState: cont.effectResolutionBeforeState ?? beforeResume,
    endLogs: paused ? [] : resume.endLogs,
    actingPlayerId: cont.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    sourceColors: getEffectResolutionSourceColors(
      resolved,
      sourceCard.instanceId,
      def
    ),
    causedBySourceInstanceId: effectResolutionSourceInstanceId,
    enterFieldCausedByPlayerId: cont.actingPlayerId,
    ...(cont.battleEndDeferralAttackId !== undefined
      ? { battleEndDeferralAttackId: cont.battleEndDeferralAttackId }
      : {}),
  });
  if (paused && resume.endLogs.length > 0) {
    resolved = {
      ...resolved,
      pendingResolutionEndLogs: [
        ...(resolved.pendingResolutionEndLogs ?? []),
        ...resume.endLogs,
      ],
    };
  }
  resolved = paused
    ? attachTargetedDisclosureResolutionCleanups(
        resolved,
        cont.resolutionCleanups
      )
    : applyTargetedDisclosureResolutionCleanups(
        resolved,
        cont.resolutionCleanups
      );
  resolved = checkAndQueuePostResolutionOracleIfReady(
    resolved,
    cont.postResolutionOracle,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions
  );
  return maybeFinalizeBattleEndScopeAfterPendingDrain(
    resolveStackCascade(resolved, cont.remainingStacks, options),
    options
  );
}
