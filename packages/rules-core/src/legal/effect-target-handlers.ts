import { replaceCardInstances } from "../zone/card-instance-state";
import { requireTriggerChainId } from "../chain-id";
import { satisfiesCoreSourceGroupMinimums } from "../model";
// Extracted from legal-actions-apply.ts (P2-11 god-file decomposition).
import {
  applyAsIfSoulCoreChoiceToStack,
  resumeUseCostGateCoreMoveAfterDeferredMagicTargetIfReady,
  resolveDeferredStackAction,
  resolveStackCascade,
  resumeStackCascadeIfReady,
  shouldDiscardRemainingStacksAfterBattleEnded,
} from "./stack-resolution-core";
import type { StackRegistrationLookupOptions } from "./stack-resolution-types";

import { runActionMainResolution } from "../effect/effect-resolution";
import { createEffectResolutionScope } from "../effect/effect-resolution-scope";
import { resumeEffectAfterCoreMoveChoice } from "./pending-action-handlers";

import type {
  ActiveStack,
  CardDefinition,
  GameState,
  EffectActivationTiming,
  PendingTriggeredEffect,
} from "../model";

import {
  getAvailableTriggeredEffectSourceChoices,
  queuePendingReactionsFromTriggerEvents,
} from "../effect/trigger-system";
import type {
  ApplyLegalActionOptions,
  ResolvePendingCoreShootResult,
  ResolvePendingEffectTargetResult,
  ResolvePendingAsIfSoulCoreChoiceLegalAction,
  ResolvePendingEffectOptionalRepeatChoiceResult,
  ResolvePendingEffectOptionalRepeatCountResult,
} from "./legal-actions-types";
import type { CollectedTriggerEvent } from "../effect/trigger-system";
import {
  reserveCoreShootSentinelId,
  getCoreShootSoulSourceId,
} from "../effect/structured-effect-interpreter";
import { getCardById } from "../card/card-lookup";
import { snapshotTargetedDisclosureTargetZones } from "../effect/targeted-disclosure-target-snapshot";

import {
  assertLegalActionTargetGroupsSatisfied,
  getEffectiveColors,
  getMandatoryForcedTargetInclusionIds,
} from "./legal-actions-shared";

import { computePayToActCoreGate } from "./pay-to-act-core-gate";
import { findAtomicHandDiscardAssignment } from "./pay-to-act-hand-discard-gate";

import {
  moveCardZone,
  withSoulCoreLocation,
  moveNormalCores,
  moveSoulCore,
  isNormalCoreMovePrevented,
} from "../core/core-system";
import { coreShootSoulDestinationAllowed } from "../effect/structured-core-shoot";
import { processMovedToTrashEffects } from "../effect/structured-trash-ops";
import { getBattleEndFinalizeAttackIdForActiveStack } from "../battle/battle-end-scope-finalize";

import {
  getActiveStackEffectIndex,
  inferFirstTargetStepIdFromActiveStack,
  lookupRegistrationForStack,
  setActiveStackChoiceIndex,
} from "./stack-target-resolution";
import { revalidatePendingEffectTargets } from "./pending-effect-target-selection";
import { isInstanceInOpenResponseWindowOrPendingCascade } from "../stack/stack-window-shared";

export function hasImplementedTargetedResponderForStackTarget(options: {
  state: GameState;
  event: CollectedTriggerEvent;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: NonNullable<
    ApplyLegalActionOptions["getRegisteredTriggeredEffectActions"]
  >;
}): boolean {
  const pendingEffect: PendingTriggeredEffect = {
    pendingId: `targeted-probe:${options.event.chainId ?? "none"}:${options.event.relatedInstanceId ?? "none"}`,
    actingPlayerId: options.event.actingPlayerId,
    eventKind: "targeted",
    event: {
      family: "targeting",
      ...(options.event.cause !== undefined
        ? { cause: options.event.cause }
        : {}),
      ...(options.event.effectActivationTiming !== undefined
        ? { effectActivationTiming: options.event.effectActivationTiming }
        : {}),
      validationMode: "require_related_instance_on_field",
    },
    source: options.event.source,
    chainId: requireTriggerChainId(options.event.chainId),
    attackId: options.event.attackId,
    relatedPlayerId: options.event.relatedPlayerId,
    relatedInstanceId: options.event.relatedInstanceId,
    ...(options.event.cause !== undefined
      ? { cause: options.event.cause }
      : {}),
    amount: options.event.amount,
    step: options.state.step,
    window: options.state.window,
    resolvedSourceInstanceIds: [],
    ...(options.event.effectSourceInstanceId !== undefined
      ? { effectSourceInstanceId: options.event.effectSourceInstanceId }
      : {}),
    ...(options.event.effectSourceDefinitionId !== undefined
      ? { effectSourceDefinitionId: options.event.effectSourceDefinitionId }
      : {}),
    ...(options.event.effectActionKind !== undefined
      ? { effectActionKind: options.event.effectActionKind }
      : {}),
    ...(options.event.effectActivationTiming !== undefined
      ? { effectActivationTiming: options.event.effectActivationTiming }
      : {}),
  };

  return getAvailableTriggeredEffectSourceChoices({
    state: options.state,
    pendingEffect,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  }).some((choice) => {
    const effectIndex = choice.actionRegistration.effectIndex;
    const effect =
      effectIndex !== undefined
        ? choice.sourceEffectDefinition.effects?.[effectIndex]
        : undefined;
    return effect !== undefined && !(effect.stub && effect.steps.length === 0);
  });
}

export function queueTargetedDisclosureForPendingEffectTarget(
  options: {
    state: GameState;
    pending: NonNullable<GameState["pendingEffectTargetSelection"]>;
    resumedStack: ActiveStack;
    selectedTargetInstanceIds: readonly string[];
    remainingStacks: readonly ActiveStack[];
    getRegisteredTriggeredEffectActions: NonNullable<
      ApplyLegalActionOptions["getRegisteredTriggeredEffectActions"]
    >;
  } & StackRegistrationLookupOptions
): { state: GameState; queued: boolean } {
  if (options.selectedTargetInstanceIds.length === 0) {
    return { state: options.state, queued: false };
  }

  const sourceCard = options.state.cardInstances.find(
    (card) => card.instanceId === options.pending.sourceInstanceId
  );
  const sourceDefinition = options.getCardDefinitionById(
    options.pending.sourceDefinitionId
  );
  if (!sourceCard || !sourceDefinition) {
    return { state: options.state, queued: false };
  }
  const continuationEffectSourceInstanceId =
    options.pending.effectSourceInstanceId ?? sourceCard.instanceId;
  const continuationEffectSourceDefinitionId =
    options.pending.effectSourceDefinitionId ?? sourceDefinition.cardNo;
  const eventEffectSourceInstanceId = continuationEffectSourceInstanceId;
  const eventEffectSourceDefinitionId = continuationEffectSourceDefinitionId;

  const effectActivationTiming: EffectActivationTiming =
    options.resumedStack.activationLabel !== undefined &&
    options.resumedStack.activationLabel !== "none"
      ? options.resumedStack.activationLabel
      : (options.resumedStack.chosenTiming ?? "flash");
  const battleEndDeferralAttackId =
    options.pending.battleEndDeferralAttackId ??
    getBattleEndFinalizeAttackIdForActiveStack(options.resumedStack);
  const events: CollectedTriggerEvent[] = [];
  const seenTargetInstanceIds = new Set<string>();
  for (const targetInstanceId of options.selectedTargetInstanceIds) {
    if (seenTargetInstanceIds.has(targetInstanceId)) continue;
    seenTargetInstanceIds.add(targetInstanceId);
    // ENGINE-targeted-disclosure-offfield-source: 対象カードは通常フィールド上限定
    // だが、フィールド外で自身の効果が「発揮中」(= 開いている応答窓の保留 ActiveStack
    // 鎖に自身の instanceId が乗っている) の場合にも disclosure 対象に含める
    // (BSLH01-T14「フィールド以外で発揮中の自分の系統CBスピリット」型)。
    const target = options.state.cardInstances.find(
      (card) =>
        card.instanceId === targetInstanceId &&
        (card.zone === "field" ||
          isInstanceInOpenResponseWindowOrPendingCascade(
            options.state,
            targetInstanceId
          ))
    );
    if (!target) continue;
    const cause =
      target.controllerPlayerId === options.pending.actingPlayerId
        ? "self_effect"
        : "opponent_effect";
    events.push({
      actingPlayerId: target.controllerPlayerId,
      eventKind: "targeted",
      source: "action_resolution",
      chainId: `${options.resumedStack.chainId}:target:${events.length}`,
      attackId:
        battleEndDeferralAttackId ??
        options.state.activeAttack?.attackId ??
        null,
      relatedPlayerId: target.controllerPlayerId,
      relatedInstanceId: target.instanceId,
      cause,
      amount: 1,
      effectSourceInstanceId: eventEffectSourceInstanceId,
      effectSourceDefinitionId: eventEffectSourceDefinitionId,
      effectActionKind: options.resumedStack.actionKind,
      effectActivationTiming,
      // P3-130: queue 時点 (この時点では窓がまだ開いている) のスナップショット。
      // declare 時点は P3-34 により窓が必ず閉じているため、getAvailableTriggeredEffectSourceChoices
      // 側の再評価はこのスナップショットを優先する (trigger-system.ts 参照)。
      relatedInstanceOffFieldActivating: target.zone !== "field",
    });
  }

  const implementedEvents = events.filter((event) =>
    hasImplementedTargetedResponderForStackTarget({
      state: options.state,
      event,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
    })
  );
  if (implementedEvents.length === 0) {
    return { state: options.state, queued: false };
  }

  const beforePendingCount =
    options.state.pendingTriggeredEffects.length +
    options.state.pendingPrivateDeclarations.length +
    options.state.pendingBurstChecks.length;
  const queuedState = queuePendingReactionsFromTriggerEvents(
    options.state,
    implementedEvents,
    undefined,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
  const afterPendingCount =
    queuedState.pendingTriggeredEffects.length +
    queuedState.pendingPrivateDeclarations.length +
    queuedState.pendingBurstChecks.length;
  if (afterPendingCount <= beforePendingCount) {
    return { state: queuedState, queued: false };
  }

  const previousContinuation =
    options.state.pendingTargetedDisclosureContinuation;
  const registration = lookupRegistrationForStack(
    options.resumedStack,
    options
  );
  const effectIndex =
    registration !== null
      ? (getActiveStackEffectIndex(options.resumedStack, registration) ?? 0)
      : (options.resumedStack.magicEffectIndex ??
        options.resumedStack.handActivatedEffectIndex ??
        0);
  const inferredTargetStepId =
    options.pending.targetStepId ??
    inferFirstTargetStepIdFromActiveStack(
      options.resumedStack,
      options.getCardDefinitionById,
      effectIndex
    );
  const continuationTargetStepId =
    inferredTargetStepId ?? "__active_stack_target__";
  const continuationSourceDefinitionId =
    options.resumedStack.actionKind === "battle_immediate_effect"
      ? (options.resumedStack.battleImmediatePromptSnapshot
          ?.sourceEffectDefinitionId ?? sourceDefinition.cardNo)
      : options.resumedStack.effectSourceDefinitionId !== undefined
        ? options.resumedStack.effectSourceDefinitionId
        : sourceDefinition.cardNo;
  return {
    state: {
      ...queuedState,
      pendingTargetedDisclosureContinuation: {
        chainId: options.resumedStack.chainId,
        pendingId: `targeted-disclosure:${options.resumedStack.chainId}:active-stack:${queuedState.pendingTriggeredEffects.length}`,
        sourceDefinitionId: continuationSourceDefinitionId,
        effectIndex,
        ...(options.resumedStack.divineSkillIndex !== undefined
          ? { divineSkillIndex: options.resumedStack.divineSkillIndex }
          : {}),
        sourceInstanceId: sourceCard.instanceId,
        effectSourceInstanceId: continuationEffectSourceInstanceId,
        effectSourceDefinitionId: continuationEffectSourceDefinitionId,
        effectActionKind: options.resumedStack.actionKind,
        effectActivationTiming,
        actingPlayerId: options.pending.actingPlayerId,
        resumeStepIndex: 0,
        // 対象開示は `resolveDeferredStackAction` が executeEffect に入る前に
        // 開かれる。この中断からは deferred stack ではなく continuation の
        // stepContext で再開するため、on_step の任意反復で先に確定した総対象数も
        // ここへ保存する。これを落とすと、応答後は最初に選んだ 1 体しか
        // `selected_targets(stepId)` から見えず、前段の count 支払いが縮む。
        stepContext: {
          results: {},
          ...(options.resumedStack.optionalRepeatTargetCount !== undefined
            ? {
                selectedTargetCountOverrides: {
                  [continuationTargetStepId]:
                    options.resumedStack.optionalRepeatTargetCount,
                },
              }
            : {}),
        },
        targetInstanceIds: [...options.selectedTargetInstanceIds],
        targetZonesByInstanceId: snapshotTargetedDisclosureTargetZones(
          queuedState,
          options.selectedTargetInstanceIds
        ),
        targetCandidateInstanceIds: [...options.pending.candidateInstanceIds],
        ...(options.pending.targetGroups !== undefined
          ? { targetGroups: options.pending.targetGroups }
          : {}),
        targetStepId: continuationTargetStepId,
        remainingStacks: [...options.remainingStacks],
        effectResolutionBeforeState: options.state,
        ...(battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId }
          : {}),
        deferredStackResolution: {
          deferredStack: options.resumedStack,
        },
        ...(previousContinuation !== null
          ? { previousTargetedDisclosureContinuation: previousContinuation }
          : {}),
      },
      log: [
        ...queuedState.log,
        `effect:target-disclosure:queued:${options.resumedStack.chainId}:${options.selectedTargetInstanceIds.join(",")}`,
      ],
    },
    queued: true,
  };
}

export function applyPendingEffectTargetAction(
  options: ApplyLegalActionOptions
): ResolvePendingEffectTargetResult {
  if (!options.state.pendingEffectTargetSelection) {
    throw new Error("No pending effect target selection to resolve");
  }
  const pending = revalidatePendingEffectTargets(
    options.state,
    options.state.pendingEffectTargetSelection
  );
  const selected = options.targetInstanceIds ?? [];
  // 件数検証 (required <= n <= max)
  if (
    selected.length < pending.requiredTargetCount ||
    selected.length > pending.maxTargetCount
  ) {
    throw new Error(
      `Effect target count ${selected.length} out of range [${pending.requiredTargetCount}, ${pending.maxTargetCount}]`
    );
  }
  // 候補・重複検証
  const candidateSet = new Set(pending.candidateInstanceIds);
  const seen = new Set<string>();
  for (const id of selected) {
    if (!candidateSet.has(id)) {
      throw new Error(`Effect target ${id} is not a candidate`);
    }
    if (pending.allowDuplicateTargets !== true && seen.has(id)) {
      throw new Error(`Effect target list contains duplicate ${id}`);
    }
    seen.add(id);
  }
  // forced_target_inclusion タウント (「可能なら対象に含めなければならない」): 相手
  // (pending.actingPlayerId) の対象選択が、候補プールに入っている taunt 対象を
  // 除外していないか検証する。GUI/REST 両経路がこの共通関数を通るため単一検証点。
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
        `Effect target selection must include forced target inclusion candidate(s): ${missing.join(",")}`
      );
    }
  }
  assertLegalActionTargetGroupsSatisfied({
    actionId: pending.deferredStack.stackId,
    targetInstanceIds: selected,
    ...(pending.targetGroups !== undefined
      ? { targetGroups: pending.targetGroups }
      : {}),
    ...(pending.allowDuplicateTargets !== undefined
      ? { allowDuplicateTargets: pending.allowDuplicateTargets }
      : {}),
    label: "Effect target group",
  });
  // deferredStack に対象を流し込み、pending をクリアして解決を再開する。
  // targetInstanceIds が非空になるため対象選択注入は走らない。その後、退避していた
  // カスケード残り (remainingStacks) を順に継続する (途中で再度対象選択 pending が立ち得る)。
  // 0..N 選択で player が 0 体を選んだ (selected.length === 0) 場合は targetInstanceIds が
  // 空のままなので、targetSelectionResolved=true で再オープンを抑止する
  // (ENGINE-registration-step-zero-to-n-target-selection)。
  const resumedStack: ActiveStack = {
    ...pending.deferredStack,
    targetInstanceIds: [...selected],
    targetZonesByInstanceId: snapshotTargetedDisclosureTargetZones(
      options.state,
      selected
    ),
    targetSelectionResolved: true,
    ...(pending.targetGroups !== undefined
      ? { targetGroups: pending.targetGroups }
      : {}),
    ...(pending.allowDuplicateTargets !== undefined
      ? { allowDuplicateTargets: pending.allowDuplicateTargets }
      : {}),
    ...(pending.targetStepId !== undefined
      ? { targetStepId: pending.targetStepId }
      : {}),
  };
  const remainingStacks = pending.remainingStacks;
  const stateWithoutPending: GameState = {
    ...options.state,
    pendingEffectTargetSelection: null,
    log: [
      ...options.state.log,
      `effect:target-selection:resolved:${resumedStack.chainId}:${selected.join(",")}`,
    ],
  };
  const disclosure = queueTargetedDisclosureForPendingEffectTarget({
    state: stateWithoutPending,
    pending,
    resumedStack,
    selectedTargetInstanceIds: selected,
    remainingStacks,
    getCardDefinitionById: options.getCardDefinitionById,
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
    ...(options.getRegisteredFieldCardEffectActions !== undefined
      ? {
          getRegisteredFieldCardEffectActions:
            options.getRegisteredFieldCardEffectActions,
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
  });
  if (disclosure.queued) {
    return { state: disclosure.state };
  }
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
  const afterCascade = resumeStackCascadeIfReady(
    resolveStackCascade(afterResumed, remainingStacks, options),
    options
  );
  return {
    // `resolveDeferredStackAction` can complete the chosen stack while a
    // previously deferred burst-activation stack is already waiting in the
    // state-level cascade.  Resolving only this pending input's
    // `remainingStacks` would otherwise leave that selected burst check
    // stranded (fuzz seed 1558393750).  Re-enter the shared resume gate so it
    // can open the delayed activation window once every intervening effect is
    // settled.
    state: resumeUseCostGateCoreMoveAfterDeferredMagicTargetIfReady(
      afterCascade,
      resumedStack,
      options
    ),
  };
}

export function applyPendingAsIfSoulCoreChoiceAction(
  options: ApplyLegalActionOptions
): { state: GameState } {
  const pending = options.state.pendingAsIfSoulCoreChoice;
  if (!pending) {
    throw new Error("No pending as-if soul core choice to resolve");
  }
  const action = options.action;
  if (action.kind !== "resolve_pending_as_if_soul_core_choice") {
    throw new Error("Unexpected action kind for as-if soul core choice");
  }
  const asIfSoulCoreChoiceAction =
    action as ResolvePendingAsIfSoulCoreChoiceLegalAction;
  if (asIfSoulCoreChoiceAction.pendingId !== pending.pendingId) {
    throw new Error(
      `Unknown pendingAsIfSoulCoreChoice: pendingId=${asIfSoulCoreChoiceAction.pendingId}`
    );
  }
  const option = pending.options.find(
    (candidate) => candidate.choiceId === asIfSoulCoreChoiceAction.choiceId
  );
  if (!option) {
    throw new Error(
      `Unknown as-if soul core choice: choiceId=${asIfSoulCoreChoiceAction.choiceId}`
    );
  }

  const resumedStack = applyAsIfSoulCoreChoiceToStack(
    pending.deferredStack,
    option
  );
  const remainingStacks = pending.remainingStacks;
  const stateWithoutPending: GameState = {
    ...options.state,
    pendingAsIfSoulCoreChoice: null,
    log: [
      ...options.state.log,
      `effect:as-if-soul-core-choice:resolved:${resumedStack.chainId}:${option.choiceId}`,
    ],
  };
  const afterResumed = resolveDeferredStackAction(
    stateWithoutPending,
    resumedStack,
    options
  );
  if (afterResumed.pendingEffectTargetSelection !== null) {
    if (remainingStacks.length === 0) return { state: afterResumed };
    return {
      state: {
        ...afterResumed,
        pendingEffectTargetSelection: {
          ...afterResumed.pendingEffectTargetSelection,
          remainingStacks: [
            ...afterResumed.pendingEffectTargetSelection.remainingStacks,
            ...remainingStacks,
          ],
        },
      },
    };
  }
  if (afterResumed.pendingAsIfSoulCoreChoice !== null) {
    if (remainingStacks.length === 0) return { state: afterResumed };
    return {
      state: {
        ...afterResumed,
        pendingAsIfSoulCoreChoice: {
          ...afterResumed.pendingAsIfSoulCoreChoice,
          remainingStacks: [
            ...afterResumed.pendingAsIfSoulCoreChoice.remainingStacks,
            ...remainingStacks,
          ],
        },
      },
    };
  }
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

function resumeDeferredStackAfterOptionalRepeatPending(
  options: ApplyLegalActionOptions,
  stateWithoutPending: GameState,
  resumedStack: ActiveStack,
  remainingStacks: ActiveStack[]
): GameState {
  const afterResumed = resolveDeferredStackAction(
    stateWithoutPending,
    resumedStack,
    options
  );
  if (afterResumed.pendingEffectTargetSelection !== null) {
    if (remainingStacks.length === 0) return afterResumed;
    return {
      ...afterResumed,
      pendingEffectTargetSelection: {
        ...afterResumed.pendingEffectTargetSelection,
        remainingStacks: [
          ...afterResumed.pendingEffectTargetSelection.remainingStacks,
          ...remainingStacks,
        ],
      },
    };
  }
  if (afterResumed.pendingAsIfSoulCoreChoice !== null) {
    if (remainingStacks.length === 0) return afterResumed;
    return {
      ...afterResumed,
      pendingAsIfSoulCoreChoice: {
        ...afterResumed.pendingAsIfSoulCoreChoice,
        remainingStacks: [
          ...afterResumed.pendingAsIfSoulCoreChoice.remainingStacks,
          ...remainingStacks,
        ],
      },
    };
  }
  if (afterResumed.pendingEffectOptionalRepeatChoice !== null) {
    if (remainingStacks.length === 0) return afterResumed;
    return {
      ...afterResumed,
      pendingEffectOptionalRepeatChoice: {
        ...afterResumed.pendingEffectOptionalRepeatChoice,
        remainingStacks: [
          ...afterResumed.pendingEffectOptionalRepeatChoice.remainingStacks,
          ...remainingStacks,
        ],
      },
    };
  }
  if (afterResumed.pendingEffectOptionalRepeatCountSelection !== null) {
    if (remainingStacks.length === 0) return afterResumed;
    return {
      ...afterResumed,
      pendingEffectOptionalRepeatCountSelection: {
        ...afterResumed.pendingEffectOptionalRepeatCountSelection,
        remainingStacks: [
          ...afterResumed.pendingEffectOptionalRepeatCountSelection
            .remainingStacks,
          ...remainingStacks,
        ],
      },
    };
  }
  if (
    shouldDiscardRemainingStacksAfterBattleEnded(
      stateWithoutPending,
      afterResumed,
      remainingStacks
    )
  ) {
    return { ...afterResumed, pendingStackCascade: null };
  }
  return resolveStackCascade(afterResumed, remainingStacks, options);
}

export function applyPendingEffectOptionalRepeatChoiceAction(
  options: ApplyLegalActionOptions
): ResolvePendingEffectOptionalRepeatChoiceResult {
  const pending = options.state.pendingEffectOptionalRepeatChoice;
  if (!pending) {
    throw new Error("No pending effect optional repeat choice to resolve");
  }
  if (options.action.kind !== "resolve_pending_effect_optional_repeat_choice") {
    throw new Error("Action kind mismatch for optional repeat choice");
  }
  if (options.action.pendingId !== pending.pendingId) {
    throw new Error("Optional repeat choice pendingId mismatch");
  }
  const choiceIndex = options.action.choiceIndex;
  if (choiceIndex !== 0 && choiceIndex !== 1) {
    throw new Error(`Invalid optional repeat choice index: ${choiceIndex}`);
  }

  const stateWithoutPending: GameState = {
    ...options.state,
    pendingEffectOptionalRepeatChoice: null,
    log: [
      ...options.state.log,
      `effect:optional-repeat-choice:resolved:${pending.deferredStack.chainId}:${choiceIndex}`,
    ],
  };

  if (choiceIndex === 0) {
    const resumedStack: ActiveStack = {
      ...setActiveStackChoiceIndex(pending.deferredStack, 0),
      optionalRepeatTargetCount: pending.baseTargetCount,
    };
    return {
      state: resumeDeferredStackAfterOptionalRepeatPending(
        options,
        stateWithoutPending,
        resumedStack,
        pending.remainingStacks
      ),
    };
  }

  if (
    pending.maxAdditionalCount === 1 &&
    pending.additionalCountSelectionMode !== "count_decrease"
  ) {
    const resumedStack: ActiveStack = {
      ...setActiveStackChoiceIndex(pending.deferredStack, 1),
      optionalRepeatTargetCount: pending.baseTargetCount * 2,
    };
    return {
      state: resumeDeferredStackAfterOptionalRepeatPending(
        options,
        stateWithoutPending,
        resumedStack,
        pending.remainingStacks
      ),
    };
  }

  return {
    state: {
      ...stateWithoutPending,
      pendingEffectOptionalRepeatCountSelection: {
        pendingId: `${pending.pendingId}:count`,
        actingPlayerId: pending.actingPlayerId,
        sourceInstanceId: pending.sourceInstanceId,
        sourceDefinitionId: pending.sourceDefinitionId,
        ...(pending.effectSourceInstanceId !== undefined
          ? { effectSourceInstanceId: pending.effectSourceInstanceId }
          : {}),
        ...(pending.effectSourceDefinitionId !== undefined
          ? { effectSourceDefinitionId: pending.effectSourceDefinitionId }
          : {}),
        effectIndex: pending.effectIndex,
        repeatStepIndex: pending.repeatStepIndex,
        ...(pending.targetStepId !== undefined
          ? { targetStepId: pending.targetStepId }
          : {}),
        baseTargetCount: pending.baseTargetCount,
        selectionMode: pending.additionalCountSelectionMode,
        min: 1,
        max: pending.maxAdditionalCount,
        deferredStack: setActiveStackChoiceIndex(pending.deferredStack, 1),
        remainingStacks: pending.remainingStacks,
        ...(pending.battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId: pending.battleEndDeferralAttackId }
          : {}),
      },
      log: [
        ...stateWithoutPending.log,
        `effect:optional-repeat-count:pending:${pending.deferredStack.chainId}:max=${pending.maxAdditionalCount}`,
      ],
    },
  };
}

export function applyPendingEffectOptionalRepeatCountAction(
  options: ApplyLegalActionOptions
): ResolvePendingEffectOptionalRepeatCountResult {
  const pending = options.state.pendingEffectOptionalRepeatCountSelection;
  if (!pending) {
    throw new Error("No pending effect optional repeat count selection");
  }
  if (options.action.kind !== "resolve_pending_effect_optional_repeat_count") {
    throw new Error("Action kind mismatch for optional repeat count");
  }
  if (options.action.pendingId !== pending.pendingId) {
    throw new Error("Optional repeat count pendingId mismatch");
  }
  const chosen = options.countDecreaseSelection;
  if (chosen === undefined) {
    throw new Error(
      "countDecreaseSelection is required to resolve optional repeat count"
    );
  }
  if (
    !Number.isInteger(chosen) ||
    chosen < pending.min ||
    chosen > pending.max
  ) {
    throw new Error(
      `Optional repeat count ${chosen} is out of range [${pending.min}, ${pending.max}]`
    );
  }

  const targetCount = pending.baseTargetCount * (1 + chosen);
  const resumedStack: ActiveStack = {
    ...setActiveStackChoiceIndex(pending.deferredStack, 1),
    optionalRepeatTargetCount: targetCount,
  };
  const stateWithoutPending: GameState = {
    ...options.state,
    pendingEffectOptionalRepeatCountSelection: null,
    log: [
      ...options.state.log,
      `effect:optional-repeat-count:resolved:${pending.deferredStack.chainId}:${chosen}`,
    ],
  };
  return {
    state: resumeDeferredStackAfterOptionalRepeatPending(
      options,
      stateWithoutPending,
      resumedStack,
      pending.remainingStacks
    ),
  };
}

/**
 * gate_flash_stack_core (BSTS01-M03) の発揮前提コア除去待ちを解決する。
 *
 * - decline: 対象のフラッシュ/スタック効果を不発にする (isNullified=true + gateResolved=true
 *   で解決再開 → 下流の isNullified スキップ経路でカードはトラッシュへ＝空撃ち類似)。
 * - select: 選んだコア源 (field card instanceId / "reserve") からコア1個をトラッシュへ移し、
 *   SBA を回す (フィールドコアが0になったスピリットの消滅等)。remainingCount を1減らす。
 *   なお残るゲートがあれば候補を再算出して pending を再提示、0 なら gateResolved=true で
 *   deferredStack を解決再開する。
 */
export function applyPendingPayToActCoreGateAction(
  options: ApplyLegalActionOptions
): ResolvePendingEffectTargetResult {
  const pending = options.state.pendingPayToActCoreGate;
  if (!pending) {
    throw new Error("No pending pay-to-act core gate to resolve");
  }
  const remainingStacks = pending.remainingStacks;

  // decline / 候補不在 → そのフラッシュ/スタック効果は発揮されない
  // (ただし耐性①による非拘束 [declineFizzles=false] なら不発にせず解決を再開する)。
  if (options.payToActCoreGateDecline || pending.candidates.length === 0) {
    const resumedStack: ActiveStack = {
      ...pending.deferredStack,
      ...(pending.declineFizzles ? { isNullified: true } : {}),
      payToActGateResolved: true,
    };
    const stateWithoutPending: GameState = {
      ...options.state,
      pendingPayToActCoreGate: null,
      log: [
        ...options.state.log,
        pending.declineFizzles
          ? `effect:gate_flash_stack_core:declined:${pending.deferredStack.chainId}`
          : `effect:gate_flash_stack_core:declined-non-fizzling:${pending.deferredStack.chainId}`,
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

  const containerId = options.payToActCoreSourceContainerId;
  if (!containerId) {
    throw new Error(
      "resolve_pay_to_act_core_gate requires payToActCoreSourceContainerId or payToActCoreGateDecline"
    );
  }
  const candidate = pending.candidates.find(
    (c) => c.containerId === containerId
  );
  if (!candidate || candidate.available <= 0) {
    throw new Error(
      `Pay-to-act core gate source ${containerId} is not a valid candidate`
    );
  }
  const coreKind = options.payToActCoreKind ?? "normal";
  const availableKind =
    coreKind === "soul"
      ? (candidate.soulAvailable ?? 0)
      : (candidate.normalAvailable ?? candidate.available);
  if ((coreKind !== "normal" && coreKind !== "soul") || availableKind <= 0)
    throw new Error("Pay-to-act core gate core kind is not available");

  // 選択した種類のコア1個を、共通プリミティブで持ち主のトラッシュへ移動する。
  const gatedPlayerId = pending.actingPlayerId;
  const chainId = `pay-to-act-core-gate:${pending.pendingId}`;
  const beforeState: GameState = {
    ...options.state,
    pendingPayToActCoreGate: null,
    log: [...options.state.log],
  };
  const sourceDefinition = options.getCardDefinitionById(
    pending.gateSourceDefinitionId
  );
  const context = {
    actingPlayerId: gatedPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(sourceDefinition ? { sourceDefinition } : {}),
  };

  const afterMove = runActionMainResolution({
    state: beforeState,
    chainId,
    startLogs: [],
    endLogs: [],
    context,
    resolveEffect: (s: GameState): GameState => {
      const from =
        containerId === "reserve"
          ? { kind: "reserve" as const, playerId: gatedPlayerId }
          : { kind: "card" as const, instanceId: containerId };
      const to = { kind: "trash" as const, playerId: gatedPlayerId };
      const moved =
        coreKind === "soul"
          ? moveSoulCore(s, gatedPlayerId, from, to)
          : moveNormalCores(s, from, to, 1);
      return {
        ...moved,
        log: [
          ...moved.log,
          `effect:gate_flash_stack_core:core-to-trash:${gatedPlayerId}:from=${containerId}`,
        ],
      };
    },
  });

  const remainingCount = pending.remainingCount - 1;
  if (remainingCount > 0) {
    // まだ支払うべきゲートが残る (別カードの同型ゲート)。候補を再算出して pending 再提示。
    const refreshed = computePayToActCoreGate(
      afterMove,
      pending.deferredStack,
      options.getCardDefinitionById
    );
    if (refreshed) {
      return {
        state: {
          ...afterMove,
          pendingPayToActCoreGate: {
            ...refreshed,
            remainingStacks,
            remainingCount,
          },
        },
      };
    }
    // 再算出でゲート不成立 (耐性発生・候補消滅等) → そのまま解決へ進む。
  }

  // 全ゲート支払い済み → gateResolved=true で解決再開。
  const resumedStack: ActiveStack = {
    ...pending.deferredStack,
    payToActGateResolved: true,
  };
  const afterResumed = resolveDeferredStackAction(
    afterMove,
    resumedStack,
    options
  );
  if (
    shouldDiscardRemainingStacksAfterBattleEnded(
      afterMove,
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

export function applyPendingPayToActHandDiscardGateAction(
  options: ApplyLegalActionOptions
): ResolvePendingEffectTargetResult {
  const pending = options.state.pendingPayToActHandDiscardGate;
  if (!pending) {
    throw new Error("No pending pay-to-act hand discard gate to resolve");
  }
  const remainingStacks = pending.remainingStacks;

  const fizzle = (state: GameState): ResolvePendingEffectTargetResult => {
    const fizzledStack: ActiveStack = {
      ...pending.deferredStack,
      isNullified: true,
      payToActHandDiscardGateResolved: true,
    };
    const stateWithoutPending: GameState = {
      ...state,
      pendingPayToActHandDiscardGate: null,
      log: [
        ...state.log,
        `effect:gate_flash_stack_hand_discard:declined:${pending.deferredStack.chainId}`,
      ],
    };
    const afterResumed = resolveDeferredStackAction(
      stateWithoutPending,
      fizzledStack,
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
  };

  const proceedWithoutDiscard = (
    state: GameState
  ): ResolvePendingEffectTargetResult => {
    // 耐性①(発揮するカード自身)により全スロットが非拘束: 拒否/候補0でも不発にせず、
    // 破棄なしのまま解決を再開する (10_rules/03d.md 耐性①)。
    const resumedStack: ActiveStack = {
      ...pending.deferredStack,
      payToActHandDiscardGateResolved: true,
    };
    const stateWithoutPending: GameState = {
      ...state,
      pendingPayToActHandDiscardGate: null,
      log: [
        ...state.log,
        `effect:gate_flash_stack_hand_discard:declined-non-fizzling:${pending.deferredStack.chainId}`,
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
  };

  if (
    options.payToActHandDiscardGateDecline ||
    pending.candidateCardInstanceIds.length === 0
  ) {
    return pending.declineFizzles
      ? fizzle(options.state)
      : proceedWithoutDiscard(options.state);
  }

  const selected = options.payToActHandDiscardCardInstanceIds;
  if (!selected) {
    throw new Error(
      "resolve_pay_to_act_hand_discard_gate requires payToActHandDiscardCardInstanceIds or payToActHandDiscardGateDecline"
    );
  }
  const distinct = [...new Set(selected)];
  if (distinct.length !== pending.requiredCount) {
    throw new Error(
      `Pay-to-act hand discard gate requires ${pending.requiredCount} distinct cards`
    );
  }
  if (
    distinct.some((id) => !pending.candidateCardInstanceIds.includes(id)) ||
    findAtomicHandDiscardAssignment(pending.candidateSlots, distinct) === null
  ) {
    throw new Error(
      "Pay-to-act hand discard gate selected cards do not satisfy atomic candidates"
    );
  }

  let afterMove: GameState = {
    ...options.state,
    pendingPayToActHandDiscardGate: null,
    log: [...options.state.log],
  };
  for (const cardId of distinct) {
    const card = getCardById(afterMove, cardId);
    if (
      !card ||
      card.zone !== "hand" ||
      card.ownerPlayerId !== pending.actingPlayerId
    ) {
      throw new Error(
        `Pay-to-act hand discard card ${cardId} is not in the gated player's hand`
      );
    }
    afterMove = moveCardZone(afterMove, cardId, "trash");
  }

  const sourceCard = getCardById(afterMove, pending.gateSourceInstanceId);
  const sourceDefinition = options.getCardDefinitionById(
    pending.gateSourceDefinitionId
  );
  afterMove = {
    ...afterMove,
    log: [
      ...afterMove.log,
      `effect:gate_flash_stack_hand_discard:discard:${pending.actingPlayerId}:${distinct.join(",")}`,
    ],
  };
  afterMove = processMovedToTrashEffects(
    afterMove,
    distinct,
    options.getCardDefinitionById,
    {
      sourceColors: getEffectiveColors(afterMove, sourceCard, sourceDefinition),
      sourceTribes: sourceDefinition?.tribe
        ? sourceDefinition.tribe.split("・")
        : [],
      ...(sourceDefinition?.name
        ? { sourceCardName: sourceDefinition.name }
        : {}),
      ...(sourceDefinition?.printedCategory
        ? { sourceCategory: sourceDefinition.printedCategory }
        : {}),
      ...(sourceCard ? { sourcePlayerId: sourceCard.controllerPlayerId } : {}),
      fromZone: "hand",
    }
  );

  const resumedStack: ActiveStack = {
    ...pending.deferredStack,
    payToActHandDiscardGateResolved: true,
  };
  const afterResumed = resolveDeferredStackAction(
    afterMove,
    resumedStack,
    options
  );
  if (
    shouldDiscardRemainingStacksAfterBattleEnded(
      afterMove,
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

export function applyPendingCoreShootAction(
  options: ApplyLegalActionOptions
): ResolvePendingCoreShootResult {
  let pending = options.state.pendingCoreShootSelection;
  if (!pending) {
    throw new Error("No pending core shoot selection to resolve");
  }

  let distribution = options.coreShootDistribution ?? {};
  const soulCoreInstanceId = options.coreShootSoulCoreInstanceId;
  // Q31528: 効果側は除去先ごとの個数、持ち主はその中の通常/ソウルを選ぶ。
  // 元pendingを保持し、全配分・本文継続・原因・神託を内訳決定後に一度だけ適用する。
  const ownerChoice = pending.ownerCoreChoice;
  if (ownerChoice) {
    if (!ownerChoice.originalPending || !ownerChoice.distribution)
      throw new Error(
        "Core shoot owner choice requires authoritative continuation state"
      );
    const sourceId = ownerChoice.soulSourceId;
    if (
      Object.entries(distribution).some(
        ([id, amount]) => id !== sourceId && amount !== 0
      ) ||
      (soulCoreInstanceId !== undefined && soulCoreInstanceId !== sourceId) ||
      (distribution[sourceId] ?? 0) + (soulCoreInstanceId ? 1 : 0) !==
        pending.totalAmount
    )
      throw new Error(
        "Core shoot owner choice must preserve the selected source and amount"
      );
    distribution = {
      ...ownerChoice.distribution,
      [sourceId]: distribution[sourceId] ?? 0,
    };
    pending = ownerChoice.originalPending;
  }

  // ソウルコアも 1 個分として掴める。分配 (通常コア) 合計 + ソウルコア(あれば 1) が
  // totalAmount と一致する必要がある。
  let totalDistributed = 0;
  for (const v of Object.values(distribution)) totalDistributed += v;
  if (soulCoreInstanceId) totalDistributed += 1;
  // P3-88: minTotal 省略時は totalAmount ちょうどを強制（従来の exact 挙動）。
  // minTotal 指定時は minTotal〜totalAmount の under-selection（「コアN個まで」）。
  const minTotal = pending.minTotal ?? pending.totalAmount;
  if (totalDistributed < minTotal || totalDistributed > pending.totalAmount) {
    throw new Error(
      `Core shoot distribution total ${totalDistributed} out of range [${minTotal}, ${pending.totalAmount}]`
    );
  }

  if (
    !satisfiesCoreSourceGroupMinimums(
      pending.sourceGroupMinimums,
      distribution,
      soulCoreInstanceId
    )
  ) {
    throw new Error(
      "Core shoot distribution must preserve each source zone amount"
    );
  }
  // 分配が候補に含まれるか検証
  const candidateMap = new Map(
    pending.candidates.map((c) => [c.instanceId, c.availableCores])
  );
  for (const [id, amount] of Object.entries(distribution)) {
    if (!Number.isInteger(amount) || amount < 0)
      throw new Error("Invalid core shoot amount");
    if (amount === 0) continue;
    const available = candidateMap.get(id);
    if (available === undefined) {
      throw new Error(`Core shoot target ${id} is not a candidate`);
    }
    if (amount > available) {
      throw new Error(
        `Core shoot amount ${amount} exceeds available ${available} for ${id}`
      );
    }
    // availableCores はソウルコア分 (+1) を含み得るため、通常コア分配は
    // カード実体の normalCoreCount を超えないことを別途検証する。
    const card = options.state.cardInstances.find((c) => c.instanceId === id);
    const normalAvailable =
      (card
        ? isNormalCoreMovePrevented(options.state, id)
          ? 0
          : card.normalCoreCount
        : undefined) ??
      (id === reserveCoreShootSentinelId(pending.fromPlayerId)
        ? options.state.players.find((p) => p.id === pending.fromPlayerId)
            ?.reserveNormalCoreCount
        : undefined);
    if (normalAvailable !== undefined && amount > normalAvailable) {
      throw new Error(
        `Core shoot normal-core amount ${amount} exceeds source normal cores ${normalAvailable} for ${id}`
      );
    }
  }
  // ソウルコア指定は候補スピリット (fromPlayer のソウルコアが乗る) でなければならない。
  // cross-player destination (fromPlayerId !== toPlayerId) では soul ownership 移転が
  // 未モデル化のため、soul 指定自体を不正扱いとする (ENGINE-core-move-soul-cross-player-
  // destination option b)。analyzeCoreShootCandidates 側で soul-only カードは候補から
  // 除外するが、normal+soul 両持ちカードは normal を取るために候補として残るため、
  // GUI からの soulCoreInstanceId 指定をここで拒否する。
  if (soulCoreInstanceId) {
    if (pending.fromPlayerId !== pending.toPlayerId) {
      throw new Error(
        `Core shoot soul-core source ${soulCoreInstanceId} is not allowed for cross-player destination`
      );
    }
    const fromPlayer = options.state.players.find(
      (p) => p.id === pending.fromPlayerId
    );
    const soulOnCard =
      getCoreShootSoulSourceId(fromPlayer) === soulCoreInstanceId;
    if (
      !soulOnCard ||
      !candidateMap.has(soulCoreInstanceId) ||
      !coreShootSoulDestinationAllowed(pending.toKind) ||
      (distribution[soulCoreInstanceId] ?? 0) + 1 >
        candidateMap.get(soulCoreInstanceId)!
    ) {
      throw new Error(
        `Core shoot soul-core source ${soulCoreInstanceId} is not a valid candidate`
      );
    }
  }

  // forced_target_inclusion タウント: コアシュートも「対象を選ぶ効果」であり、
  // 候補 (pending.candidates) にタウント対象が入っている間はコア配分先から除外できない。
  // 「可能なら」= コア総数 (totalAmount) が強制対象数以上のときだけ強制する
  // (各対象へ最低1個ずつ割り振れる必要があるため、maxTargetCount 相当として渡す)。
  const mandatoryCoreShootTargetIds = Array.from(
    new Set([
      ...(pending.mandatoryTargetInstanceIds ?? []),
      ...getMandatoryForcedTargetInclusionIds(
        options.state,
        pending.actingPlayerId,
        pending.candidates.map((c) => c.instanceId),
        pending.totalAmount
      ),
    ])
  );
  if (mandatoryCoreShootTargetIds.length > 0) {
    const missing = mandatoryCoreShootTargetIds.filter((id) => {
      const amount = distribution[id] ?? 0;
      return amount <= 0 && soulCoreInstanceId !== id;
    });
    if (missing.length > 0) {
      throw new Error(
        `Core shoot distribution must include forced target inclusion candidate(s): ${missing.join(",")}`
      );
    }
  }

  if (
    !ownerChoice &&
    pending.actingPlayerId !== pending.fromPlayerId &&
    pending.fromPlayerId === pending.toPlayerId &&
    coreShootSoulDestinationAllowed(pending.toKind)
  ) {
    const player = options.state.players.find(
      (p) => p.id === pending.fromPlayerId
    );
    const sourceId = getCoreShootSoulSourceId(player);
    const amount = sourceId
      ? (distribution[sourceId] ?? 0) +
        (soulCoreInstanceId === sourceId ? 1 : 0)
      : 0;
    const normal =
      sourceId === reserveCoreShootSentinelId(pending.fromPlayerId)
        ? (player?.reserveNormalCoreCount ?? 0)
        : isNormalCoreMovePrevented(options.state, sourceId ?? "")
          ? 0
          : (options.state.cardInstances.find((c) => c.instanceId === sourceId)
              ?.normalCoreCount ?? 0);
    if (sourceId && amount > 0 && normal >= amount) {
      const {
        sourceGroupMinimums: _groups,
        mandatoryTargetInstanceIds: _mandatory,
        ...choicePending
      } = pending;
      return {
        state: {
          ...options.state,
          pendingCoreShootSelection: {
            ...choicePending,
            pendingId: pending.pendingId + ":owner-core",
            actingPlayerId: pending.fromPlayerId,
            candidates: pending.candidates.filter(
              (c) => c.instanceId === sourceId
            ),
            minTotal: amount,
            totalAmount: amount,
            ownerCoreChoice: {
              originalPending: pending,
              distribution: { ...distribution },
              soulSourceId: sourceId,
            },
          },
        },
      };
    }
  }

  // コア移動量を確定
  const distMap = new Map(
    Object.entries(distribution).filter(([, v]) => v > 0)
  );
  let movedTotal = 0;
  for (const v of distMap.values()) movedTotal += v;

  // フィールド/リザーブ横断（BSTH001-X01）: reserve sentinel への分配は
  // カードでなく fromPlayer のリザーブ通常コアを減らす。distMap から分離する。
  const reserveSentinelId = reserveCoreShootSentinelId(pending.fromPlayerId);
  const reserveTaken = distMap.get(reserveSentinelId) ?? 0;
  distMap.delete(reserveSentinelId);

  // コア除去そのものは即時だが、その後の「最低コア未満スピリットの消滅 (SBA)・
  // 離脱フラッシュ・離脱/消滅誘発 + 相手起因バーストの収集」を効果チェーンの汎用
  // パイプライン (runActionMainResolution) 経由で必ず走らせる。
  // これがないと player-selected コアシュートでコア0になったスピリットが消滅せず
  // フィールドに残る。本文を再開してから同じ原因で最終化する。
  // causedByPlayerId = pending.actingPlayerId (効果コントローラ) で、相手のコア奪取由来の
  // 消滅を「相手によって離れた」と判定でき、相手側 burst / 魂状態置換が正しく発火する。
  const resolution = createEffectResolutionScope(
    pending.continuation ?? { chainId: `core-shoot:${pending.pendingId}` },
    pending.battleEndDeferralAttackId
  );
  const beforeState: GameState = {
    ...options.state,
    pendingCoreShootSelection: null,
    log: [...options.state.log],
  };
  const sourceDefinition = options.getCardDefinitionById(
    pending.sourceDefinitionId
  );
  const sourceCard = getCardById(beforeState, pending.sourceInstanceId);
  const context = {
    actingPlayerId: pending.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(sourceDefinition ? { sourceDefinition } : {}),
    ...(sourceCard ? { sourceCard } : {}),
    sourceInstanceId: pending.sourceInstanceId,
    ...(pending.sourceEffectIndex !== undefined
      ? { sourceEffectIndex: pending.sourceEffectIndex }
      : {}),
  };

  const finalState = resolution.run({
    state: beforeState,
    startLogs: [],
    endLogs: [],
    context,
    resolveEffect: (s: GameState): GameState => {
      // フィールドのコアを分配どおり減算。行き先が特定カード上 (toCardInstanceId) の
      // ときは同じ map 内でそのカードへ movedTotal を加算する
      // (ENGINE-coreshoot-soul-destination-include-field-card)。
      const updatedInstances = s.cardInstances.map((c) => {
        const take = distMap.get(c.instanceId);
        const withTake = take
          ? { ...c, normalCoreCount: Math.max(0, c.normalCoreCount - take) }
          : c;
        return c.instanceId === pending.toCardInstanceId
          ? {
              ...withTake,
              normalCoreCount: withTake.normalCoreCount + movedTotal,
            }
          : withTake;
      });

      // ソウルコア移動
      let updatedPlayers = s.players;
      const logs = [
        `effect:core_move:field:${pending.fromPlayerId}->${pending.toKind}:${pending.toPlayerId}:${movedTotal}:player-selected`,
      ];
      // cross-player destination で soul transfer をスキップする (上の validation で reject
      // 済みだが、apply 時点での invariant guard として二重防御)。
      let soulDestForFromPlayer:
        | import("../model").PlayerScopedSoulCoreLocation
        | null = null;
      if (soulCoreInstanceId && pending.fromPlayerId === pending.toPlayerId) {
        const fromPlayer = s.players.find((p) => p.id === pending.fromPlayerId);
        if (getCoreShootSoulSourceId(fromPlayer) === soulCoreInstanceId) {
          if (pending.toKind === "void") {
            // ソウルコアはボイドに移動不可 → 移動自体が発生しない
            logs.push(
              `effect:core_move:soul_core:${soulCoreInstanceId}:blocked:void`
            );
          } else {
            // toKind に従って移動。ソウルコアは所有者 (fromPlayer) のものであり、
            // リザーブ/トラッシュ等は所有者スコープなので、必ず fromPlayer の
            // soulCoreLocation を更新する。from===to のとき null にして消失させる
            // 旧バグ (fromPlayerId 分岐が先に当たる) を修正。
            // field/field_card/card_instance 宛では toCardInstanceId (単一候補に
            // 解決済みのカード) が渡っているときのみ card 上に置く
            // (ENGINE-coreshoot-soul-destination-include-field-card)。
            const soulLocation: import("../model").PlayerScopedSoulCoreLocation =
              pending.toCardInstanceId !== undefined
                ? { kind: "card", instanceId: pending.toCardInstanceId }
                : pending.toKind === "trash"
                  ? { kind: "trash" }
                  : pending.toKind === "life"
                    ? { kind: "life" }
                    : { kind: "reserve" };
            soulDestForFromPlayer = soulLocation;
            logs.push(
              `effect:core_move:soul_core:${soulCoreInstanceId}->${pending.toKind}:${pending.fromPlayerId}`
            );
          }
        }
      }

      // フィールド/リザーブ横断（BSTH001-X01）: reserve sentinel 分は fromPlayer の
      // リザーブ通常コアを減らす。movedTotal は既に reserve 分を含むため to 加算は
      // 下の addNormalCoresByKind が担う。
      if (reserveTaken > 0) {
        updatedPlayers = updatedPlayers.map((p) =>
          p.id === pending.fromPlayerId
            ? {
                ...p,
                reserveNormalCoreCount: Math.max(
                  0,
                  p.reserveNormalCoreCount - reserveTaken
                ),
              }
            : p
        );
        logs.push(
          `effect:core_move:reserve:${pending.fromPlayerId}->${pending.toKind}:${reserveTaken}`
        );
      }

      // 通常コアの移動先は toKind に従う (soul core 側の分岐と整合させる)。
      // 現状 pending は to=reserve のみ生成される (executeCoreMove の唯一の
      // field 分岐が to=reserve) が、soul core が toKind を見て trash/life/void へ
      // 振り分けるのに通常コアだけ reserve 固定だと、将来 to≠reserve の field
      // コアシュートが追加された際にコアを reserve へ誤誘導する。両者を統一しておく。
      const addNormalCoresByKind = (p: (typeof updatedPlayers)[number]) => {
        switch (pending.toKind) {
          case "trash":
            return {
              ...p,
              trashNormalCoreCount: p.trashNormalCoreCount + movedTotal,
            };
          case "life":
            return {
              ...p,
              lifeNormalCoreCount: p.lifeNormalCoreCount + movedTotal,
            };
          case "void":
            return {
              ...p,
              voidNormalCoreCount: p.voidNormalCoreCount + movedTotal,
            };
          case "reserve":
          default:
            return {
              ...p,
              reserveNormalCoreCount: p.reserveNormalCoreCount + movedTotal,
            };
        }
      };
      const result = replaceCardInstances(
        {
          ...s,
          // toCardInstanceId 宛のときは通常コアを updatedInstances 側で既にカードへ
          // 加算済みなので、player コンテナへの二重加算はしない。
          players:
            pending.toCardInstanceId !== undefined
              ? updatedPlayers
              : updatedPlayers.map((p) =>
                  p.id === pending.toPlayerId ? addNormalCoresByKind(p) : p
                ),
          log: [...s.log, ...logs],
        },
        updatedInstances
      );
      const movedState = soulDestForFromPlayer
        ? withSoulCoreLocation(
            result,
            pending.fromPlayerId,
            soulDestForFromPlayer
          )
        : result;
      return resumeEffectAfterCoreMoveChoice(
        movedState,
        pending,
        options,
        beforeState,
        false,
        resolution
      );
    },
  });

  return { state: finalState };
}

/**
 * `applyLegalAction` の安全ラッパー。
 * 実行中にエラーが発生した場合、元の state にロールバックログを付けて返す。
 * 不変状態パターンにより、元の `options.state` は常に無傷で残っているため、
 * 中途半端な支払い状態は発生しない。
 */
