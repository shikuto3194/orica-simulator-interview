import { replaceCardInstances } from "../zone/card-instance-state";
import { isInHandForOwnEffect } from "../effect/card-access-rules";
import { isChainAtOrUnder } from "../chain-id";
import { getCardById } from "../card/card-lookup";
import { recomputeContinuousEffects } from "../legal/legal-actions-shared";
import { getHandWrittenBurstPostResolutionPolicy as getDefaultHandWrittenBurstPostResolutionPolicy } from "./hand-written-burst-post-resolution-policies";
import type {
  HandWrittenEffectResolver,
  HandWrittenEffectResolverLookup,
} from "../effect/effect-resolution";
import type { EnterFieldCorePlacement } from "../zone/enter-field-placement-execution";
import { getEnterFieldCorePlacementPolicy } from "../zone/enter-field-placement-policy";
import { moveCardZone } from "../core/core-system";
import { getDefaultZoneRoleName } from "../factories";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";
import { recomputeAndRebuildContinuousEffectsForSources } from "../effect/continuous-effect-rebuild";
import {
  resolveCardImmunityAffectDecisions,
  appendImmunityProofDisclosures,
  resolveCardLeaveAffectDecisions,
} from "../effect/effect-affect-adapter";
import {
  playCardWithoutPayingCostWithPlacement,
  type PlayCardWithoutPayingCostActionResult,
} from "../play/play-card-resolution";
import {
  useMagicCardWithoutPayingCostAsAction,
  type MagicEffectResolver,
  type MagicPaymentSource,
  type MagicWithoutCostActionResult,
} from "./magic-system";
import type {
  BurstSetState,
  CardDefinition,
  CardInstance,
  LifeCoreKind,
  GameState,
  ActiveStack,
} from "../model";
import { cardHasPrintedBurstEffectHeader } from "../model";
import type { EffectFilterTag } from "../state-based-actions";

const BURST_SET_OVERRIDE_KEYWORD_TAGS = new Set(["can_set_as_burst"]);

function isMovedBurstActivationStack(
  stack: ActiveStack,
  movedBurstIds: ReadonlySet<string>,
  canceledCheckIds: ReadonlySet<string>
): boolean {
  return (
    stack.actionKind === "burst_activation" &&
    (movedBurstIds.has(stack.cardInstanceId) ||
      (stack.burstCheckId !== undefined &&
        canceledCheckIds.has(stack.burstCheckId)))
  );
}

function removeMovedBurstActivationStackChain(
  stack: ActiveStack | null,
  movedBurstIds: ReadonlySet<string>,
  canceledCheckIds: ReadonlySet<string>
): ActiveStack | null {
  if (stack == null) return null;
  const originalPreviousPendingStackAction =
    stack.previousPendingStackAction ?? null;
  const previousPendingStackAction = removeMovedBurstActivationStackChain(
    originalPreviousPendingStackAction,
    movedBurstIds,
    canceledCheckIds
  );
  if (isMovedBurstActivationStack(stack, movedBurstIds, canceledCheckIds)) {
    return previousPendingStackAction;
  }
  if (previousPendingStackAction === originalPreviousPendingStackAction) {
    return stack;
  }
  return {
    ...stack,
    previousPendingStackAction,
  };
}

function removeMovedBurstActivationFromResponseWindow<
  T extends { pendingStackAction: ActiveStack | null } | null,
>(
  windowState: T,
  movedBurstIds: ReadonlySet<string>,
  canceledCheckIds: ReadonlySet<string>
): T {
  if (windowState === null) return windowState;
  const pendingStackAction = removeMovedBurstActivationStackChain(
    windowState.pendingStackAction,
    movedBurstIds,
    canceledCheckIds
  );
  if (pendingStackAction === windowState.pendingStackAction) {
    return windowState;
  }
  return {
    ...windowState,
    pendingStackAction,
  };
}

function clearMovedBurstActivationState(
  state: GameState,
  movedBurstIds: ReadonlySet<string>
): { state: GameState; logEntries: string[] } {
  if (movedBurstIds.size === 0) return { state, logEntries: [] };

  const canceledRevealed = state.revealedBurstStates.filter((revealed) =>
    movedBurstIds.has(revealed.cardInstanceId)
  );
  const canceledCheckIds = new Set(
    canceledRevealed.map((revealed) => revealed.checkId)
  );
  for (const pending of state.pendingBurstChecks) {
    if (
      pending.resolvedBurstCardInstanceIds.some((id) => movedBurstIds.has(id))
    ) {
      canceledCheckIds.add(pending.checkId);
    }
  }

  if (canceledCheckIds.size === 0) return { state, logEntries: [] };

  const stackWindow = removeMovedBurstActivationFromResponseWindow(
    state.stackWindow,
    movedBurstIds,
    canceledCheckIds
  );
  const preDeclarationStackWindow =
    removeMovedBurstActivationFromResponseWindow(
      state.preDeclarationStackWindow,
      movedBurstIds,
      canceledCheckIds
    );
  const activeAttack =
    state.activeAttack?.flashWindowState === undefined ||
    state.activeAttack?.flashWindowState === null
      ? state.activeAttack
      : {
          ...state.activeAttack,
          flashWindowState: removeMovedBurstActivationFromResponseWindow(
            state.activeAttack.flashWindowState,
            movedBurstIds,
            canceledCheckIds
          ),
        };
  const pendingStackCascade =
    state.pendingStackCascade === null
      ? null
      : {
          ...state.pendingStackCascade,
          remainingStacks: state.pendingStackCascade.remainingStacks
            .map((stack) =>
              removeMovedBurstActivationStackChain(
                stack,
                movedBurstIds,
                canceledCheckIds
              )
            )
            .filter((stack): stack is ActiveStack => stack !== null),
        };

  return {
    state: {
      ...state,
      activeAttack,
      stackWindow,
      preDeclarationStackWindow,
      pendingStackCascade,
      revealedBurstStates: state.revealedBurstStates.filter(
        (revealed) => !canceledCheckIds.has(revealed.checkId)
      ),
      pendingBurstChecks: state.pendingBurstChecks.filter(
        (pending) => !canceledCheckIds.has(pending.checkId)
      ),
    },
    logEntries: canceledRevealed.map(
      (revealed) =>
        `effect:discard_set_burst:${revealed.playerId}:${revealed.cardInstanceId}:cancelled-burst-activation:${revealed.checkId}`
    ),
  };
}

export type BurstSetBlockReason =
  | "not_main_step"
  | "not_active_player"
  | "source_card_not_found"
  | "source_not_controlled_by_acting_player"
  | "source_not_in_hand"
  | "source_card_has_no_burst"
  | "burst_already_set"
  | "already_set_burst_this_turn";

export interface SetBurstActionResult {
  state: GameState;
  sourceInstanceId: string;
}

export interface PlayBurstSourceCardWithoutPayingCostOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: 下位の queueAfterCostPaidTriggers / collectAndQueueTriggerReactions に forward。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  enterFieldCorePlacements: readonly EnterFieldCorePlacement[];
  targetInstanceIds?: readonly string[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  chainId?: string;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}

export interface UseBurstSourceMagicCardWithoutPayingCostOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: 下位の queueAfterCostPaidTriggers に forward。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  targetInstanceIds?: readonly string[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  paymentSources?: readonly MagicPaymentSource[];
  chainId?: string;
  resolveEffect?: MagicEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}

export interface UseBurstFollowUpMagicCardWithoutPayingCostOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  magicInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: 下位の queueAfterCostPaidTriggers に forward。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  targetInstanceIds?: readonly string[];
  targetEffectFilterTags?: readonly EffectFilterTag[];
  chosenLifeCoreKind?: LifeCoreKind | null;
  chainId?: string;
  paymentSources?: readonly MagicPaymentSource[];
  resolveEffect?: MagicEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}

export interface PlayBurstFollowUpCardWithoutPayingCostOptions {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  targetInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  /** P3-39: 下位の queueAfterCostPaidTriggers / collectAndQueueTriggerReactions に forward。 */
  getRegisteredTriggeredEffectActions: import("../effect/trigger-system").TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions:
    | import("../effect/trigger-system").BurstActionRegistrationLookup
    | undefined;
  enterFieldCorePlacements: readonly EnterFieldCorePlacement[];
  chainId?: string;
  resolveEffect?: HandWrittenEffectResolver;
  getHandWrittenEffectResolver?: HandWrittenEffectResolverLookup;
}

export type HandWrittenBurstPostResolutionPolicy =
  | {
      kind: "stay_in_burst";
    }
  | {
      kind: "move_to_trash";
    };

export type HandWrittenBurstPostResolutionPolicyLookup = (
  cardNo: string
) => HandWrittenBurstPostResolutionPolicy | undefined;

function getCardInstanceOrThrow(
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

function getCardDefinitionOrThrow(options: {
  state: GameState;
  instanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  detail: string;
}): CardDefinition {
  const cardInstance = getCardInstanceOrThrow(
    options.state,
    options.instanceId,
    options.detail
  );
  const definition = options.getCardDefinitionById(cardInstance.definitionId);

  if (!definition) {
    throw new Error(
      `${options.detail}: missing definition=${cardInstance.definitionId}`
    );
  }

  return definition;
}

export function canCardDefinitionBeSetAsBurst(
  definition: CardDefinition
): boolean {
  if (cardHasPrintedBurstEffectHeader(definition)) {
    return true;
  }

  return definition.keywordTags.some((keywordTag) =>
    BURST_SET_OVERRIDE_KEYWORD_TAGS.has(keywordTag)
  );
}

export function getReplaceableBurstSetState(
  state: GameState,
  playerId: string
): BurstSetState | null {
  return (
    state.setBurstStates.find(
      (setBurstState) => setBurstState.playerId === playerId
    ) ?? null
  );
}

export function hasPendingBurstActivationSelections(state: GameState): boolean {
  return state.pendingBurstChecks.some(
    (pendingBurstCheck) => pendingBurstCheck.activationSelected !== true
  );
}

export function hasPendingDelayedBurstActivationWindow(
  state: GameState
): boolean {
  return (
    state.pendingStackCascade?.remainingStacks.some(
      (stack) => stack.burstActivationWindowPending === true
    ) === true
  );
}

export function hasPendingEffectsBeforeBurstEffect(state: GameState): boolean {
  return (
    (state.pendingEffectCompletions ?? []).length > 0 ||
    state.pendingAfterTriggersContinuations.length > 0 ||
    state.pendingPrivateDeclarations.length > 0 ||
    state.pendingTriggeredEffects.length > 0 ||
    state.pendingDeferredTriggeredEffects.length > 0 ||
    state.battleImmediateEffects.length > 0 ||
    state.pendingLeaveEntities.length > 0 ||
    state.pendingSoulStateReplacement !== null ||
    state.pendingBraveLeaveChoice !== null ||
    hasPendingBurstActivationSelections(state) ||
    hasPendingDelayedBurstActivationWindow(state)
  );
}

export function markBurstActivationSelected(options: {
  state: GameState;
  activeStack: ActiveStack;
}): GameState {
  const checkId = options.activeStack.burstCheckId;
  if (!checkId) return options.state;

  const alreadySelected = options.state.pendingBurstChecks.some(
    (pendingBurstCheck) =>
      pendingBurstCheck.checkId === checkId &&
      pendingBurstCheck.activationSelected === true
  );
  if (alreadySelected) return options.state;

  return {
    ...options.state,
    pendingBurstChecks: options.state.pendingBurstChecks.map(
      (pendingBurstCheck) =>
        pendingBurstCheck.checkId === checkId
          ? { ...pendingBurstCheck, activationSelected: true }
          : pendingBurstCheck
    ),
    log: [
      ...options.state.log,
      `burst:activation-selected:${checkId}:${options.activeStack.cardInstanceId}:${options.activeStack.actingPlayerId}`,
    ],
  };
}

/** 発動宣言への応答を解決し終えた時点でのみ、セット中・宣言中の扱いを終了する。 */
export function markBurstActivationEstablished(options: {
  state: GameState;
  activeStack: ActiveStack;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState {
  const state = markBurstActivationSelected(options);
  const sourceId = options.activeStack.cardInstanceId;
  return recomputeContinuousEffects(
    {
      ...state,
      setBurstStates: state.setBurstStates.filter(
        (s) => s.cardInstanceId !== sourceId
      ),
      revealedBurstStates: state.revealedBurstStates.map((s) =>
        s.cardInstanceId === sourceId && s.activationPending === true
          ? { ...s, activationPending: false }
          : s
      ),
    },
    options.getCardDefinitionById
  );
}

/** セット中と発動宣言への応答中を合流する、バースト除去の対象集合。 */
export function getDiscardableBurstStates(
  state: GameState,
  playerId: string
): BurstSetState[] {
  const byId = new Map<string, BurstSetState>();
  for (const burst of [
    ...state.setBurstStates,
    ...state.revealedBurstStates.filter((s) => s.activationPending === true),
  ]) {
    if (
      burst.playerId === playerId &&
      getCardById(state, burst.cardInstanceId)
    ) {
      byId.set(burst.cardInstanceId, {
        playerId,
        cardInstanceId: burst.cardInstanceId,
      });
    }
  }
  return [...byId.values()];
}

/** 宣言元から実際に移動した場合だけ停止する。トラッシュ→トラッシュでは停止しない。 */
export function isBurstActivationSourceMoved(
  state: GameState,
  stack: ActiveStack
): boolean {
  return (
    stack.actionKind === "burst_activation" &&
    stack.burstActivationSourceZone !== undefined &&
    !state.revealedBurstStates.some(
      (s) =>
        s.cardInstanceId === stack.cardInstanceId &&
        s.activationPending === false
    ) &&
    getCardById(state, stack.cardInstanceId)?.zone !==
      stack.burstActivationSourceZone
  );
}

export function queueDelayedBurstActivationStack(options: {
  state: GameState;
  activeStack: ActiveStack;
  previousWindow: GameState["window"];
}): GameState {
  const delayedStack: ActiveStack = {
    ...options.activeStack,
    burstActivationWindowPending: true,
    burstActivationPreviousWindow: options.previousWindow,
  };
  const existingCascade = options.state.pendingStackCascade;
  return {
    ...options.state,
    pendingStackCascade: {
      remainingStacks: [
        delayedStack,
        ...(existingCascade?.remainingStacks ?? []),
      ],
      ...(existingCascade?.waitForTriggeredEffects === true
        ? { waitForTriggeredEffects: true }
        : {}),
    },
    log: [
      ...options.state.log,
      `burst:activation-window:deferred:${options.activeStack.burstCheckId ?? "unknown"}:${options.activeStack.cardInstanceId}`,
    ],
  };
}

export function queueDelayedBurstEffectDeclarationStack(options: {
  state: GameState;
  activeStack: ActiveStack;
  previousWindow: GameState["window"];
}): GameState {
  const delayedStack: ActiveStack = {
    ...options.activeStack,
    burstEffectDeclarationPending: true,
    burstEffectDeclarationPreviousWindow: options.previousWindow,
  };
  const existingCascade = options.state.pendingStackCascade;
  const remainingStacks = [...(existingCascade?.remainingStacks ?? [])];
  const causeChainId = options.activeStack.burstPendingSnapshot?.chainId;
  const waitingIndex = causeChainId
    ? remainingStacks.findIndex((stack) =>
        stack.waitForResolutionChainIds?.some((chainId) =>
          isChainAtOrUnder(causeChainId, chainId)
        )
      )
    : -1;
  // 応答元のスタックは、この応答から発動したバーストとその誘発も待つ。
  // 既に待っている原因効果の依存は保持する。バースト取消時にも早送りしない。
  if (waitingIndex >= 0) {
    const waiting = remainingStacks[waitingIndex]!;
    remainingStacks[waitingIndex] = {
      ...waiting,
      waitForResolutionChainIds: [
        ...(waiting.waitForResolutionChainIds ?? []),
        delayedStack.chainId,
      ],
    };
    remainingStacks.splice(waitingIndex, 0, delayedStack);
  } else {
    remainingStacks.push(delayedStack);
  }
  return {
    ...options.state,
    pendingStackCascade: {
      remainingStacks,
      waitForTriggeredEffects: true,
    },
    log: [
      ...options.state.log,
      `burst:effect-declaration:deferred:${options.activeStack.burstCheckId ?? "unknown"}:${options.activeStack.cardInstanceId}`,
    ],
  };
}

export function getBurstSetBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  settingMode?: "normal" | "effect";
}): BurstSetBlockReason | null {
  if (options.settingMode !== "effect" && options.state.step !== "main") {
    return "not_main_step";
  }

  if (
    options.settingMode !== "effect" &&
    options.state.activePlayerId !== options.actingPlayerId
  ) {
    return "not_active_player";
  }

  if (
    options.settingMode !== "effect" &&
    options.state.burstSetPlayerIdsThisTurn.includes(options.actingPlayerId)
  ) {
    return "already_set_burst_this_turn";
  }

  if (
    options.state.revealedBurstStates.some(
      (revealedBurstState) =>
        revealedBurstState.playerId === options.actingPlayerId
    )
  ) {
    return "burst_already_set";
  }

  const sourceCard = getCardById(options.state, options.sourceInstanceId);

  if (!sourceCard) {
    return "source_card_not_found";
  }

  if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
    return "source_not_controlled_by_acting_player";
  }

  if (
    !isInHandForOwnEffect(
      options.state,
      sourceCard,
      options.actingPlayerId,
      options.getCardDefinitionById
    ) &&
    !(options.settingMode === "effect" && sourceCard.zone === "set_aside")
  ) {
    return "source_not_in_hand";
  }

  const sourceDefinition = options.getCardDefinitionById(
    sourceCard.definitionId
  );

  if (!sourceDefinition || !canCardDefinitionBeSetAsBurst(sourceDefinition)) {
    return "source_card_has_no_burst";
  }

  return null;
}

export function useSetBurstAsAction(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  settingMode?: "normal" | "effect";
}): SetBurstActionResult {
  const blockReason = getBurstSetBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Cannot set burst: ${blockReason}: sourceInstanceId=${options.sourceInstanceId}`
    );
  }

  const sourceDefinition = getCardDefinitionOrThrow({
    state: options.state,
    instanceId: options.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    detail: "Unknown burst source card",
  });
  const replaceableBurstSetState = getReplaceableBurstSetState(
    options.state,
    options.actingPlayerId
  );
  const replacedBurstCard =
    replaceableBurstSetState === null
      ? null
      : getCardInstanceOrThrow(
          options.state,
          replaceableBurstSetState.cardInstanceId,
          "Unknown replaced burst card"
        );
  const replacedBurstDefinition =
    replacedBurstCard === null
      ? null
      : getCardDefinitionOrThrow({
          state: options.state,
          instanceId: replacedBurstCard.instanceId,
          getCardDefinitionById: options.getCardDefinitionById,
          detail: "Unknown replaced burst definition",
        });

  let state = options.state;
  if (replacedBurstCard) {
    state = moveCardZone(
      state,
      replacedBurstCard.instanceId,
      "trash",
      getDefaultZoneRoleName(
        replacedBurstDefinition ?? sourceDefinition,
        "trash"
      )
    );
  }
  state = moveCardZone(
    state,
    options.sourceInstanceId,
    "burst",
    getDefaultZoneRoleName(sourceDefinition, "burst")
  );

  const stateAfterSet: GameState = {
    ...state,
    burstSetPlayerIdsThisTurn:
      options.settingMode === "effect"
        ? state.burstSetPlayerIdsThisTurn
        : [...state.burstSetPlayerIdsThisTurn, options.actingPlayerId],
    setBurstStates: [
      ...options.state.setBurstStates.filter(
        (setBurstState) =>
          setBurstState.cardInstanceId !==
          replaceableBurstSetState?.cardInstanceId
      ),
      {
        playerId: options.actingPlayerId,
        cardInstanceId: options.sourceInstanceId,
      },
    ],
    revealedBurstStates: options.state.revealedBurstStates.filter(
      (revealedBurstState) =>
        revealedBurstState.cardInstanceId !==
        replaceableBurstSetState?.cardInstanceId
    ),
    log: [
      ...options.state.log,
      ...(replaceableBurstSetState === null
        ? []
        : [
            `burst:replace:${options.actingPlayerId}:${replaceableBurstSetState.cardInstanceId}->${options.sourceInstanceId}`,
          ]),
      `burst:set:${options.actingPlayerId}:${options.sourceInstanceId}:${sourceDefinition.cardNo}`,
    ],
  };

  return {
    sourceInstanceId: options.sourceInstanceId,
    state: recomputeAndRebuildContinuousEffectsForSources(
      stateAfterSet,
      options.getCardDefinitionById,
      [options.sourceInstanceId]
    ),
  };
}

export function revealBurstCardForResolution(options: {
  state: GameState;
  activationPending?: boolean;
  actingPlayerId: string;
  sourceInstanceId: string;
  checkId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  if (
    options.state.revealedBurstStates.some(
      (revealedBurstState) =>
        revealedBurstState.cardInstanceId === options.sourceInstanceId
    )
  ) {
    return options.state;
  }

  const revealedState: GameState = {
    ...options.state,
    revealedBurstStates: [
      ...options.state.revealedBurstStates,
      {
        playerId: options.actingPlayerId,
        cardInstanceId: options.sourceInstanceId,
        checkId: options.checkId,
        ...(options.activationPending ? { activationPending: true } : {}),
      },
    ],
    log: [
      ...options.state.log,
      `burst:revealed:${options.checkId}:${options.sourceInstanceId}:${options.actingPlayerId}`,
    ],
  };

  // 不正バーストセット検知: 公開されたカードがバーストカードでなければ敗北
  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  if (sourceCard) {
    const definition = options.getCardDefinitionById(sourceCard.definitionId);
    if (definition && !canCardDefinitionBeSetAsBurst(definition)) {
      return {
        ...revealedState,
        illegalBurstRevealPlayerId: options.actingPlayerId,
        gameResult: {
          kind: "player_loss",
          losingPlayerId: options.actingPlayerId,
          reason: "illegal_burst_set",
        },
        log: [
          ...revealedState.log,
          `illegal_burst_detected:${options.sourceInstanceId}:${options.actingPlayerId}`,
        ],
      };
    }
  }

  return revealedState;
}

/** バーストの解決後移動先。効果によるセットの交換先も同じポリシーを参照する。 */
export function getBurstPostResolutionDestination(
  definition: CardDefinition,
  getPolicy: HandWrittenBurstPostResolutionPolicyLookup = getDefaultHandWrittenBurstPostResolutionPolicy
): "burst" | "trash" {
  return getPolicy(definition.cardNo)?.kind === "stay_in_burst"
    ? "burst"
    : "trash";
}

export function finalizeResolvedBurstCard(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  checkId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getHandWrittenBurstPostResolutionPolicy?: HandWrittenBurstPostResolutionPolicyLookup;
}): GameState {
  const sourceCard = getCardById(options.state, options.sourceInstanceId);
  const nextStateBase: GameState = {
    ...options.state,
    setBurstStates: options.state.setBurstStates.filter(
      (setBurstState) =>
        setBurstState.cardInstanceId !== options.sourceInstanceId
    ),
    revealedBurstStates: options.state.revealedBurstStates.filter(
      (revealedBurstState) =>
        revealedBurstState.cardInstanceId !== options.sourceInstanceId
    ),
  };

  if (!sourceCard) {
    return {
      ...nextStateBase,
      log: [
        ...nextStateBase.log,
        `burst:post-resolution:missing:${options.checkId}:${options.sourceInstanceId}`,
      ],
    };
  }

  if (sourceCard.zone !== "burst") {
    return {
      ...nextStateBase,
      log: [
        ...nextStateBase.log,
        `burst:post-resolution:kept:${options.checkId}:${options.sourceInstanceId}:${sourceCard.zone}`,
      ],
    };
  }

  const sourceDefinition = getCardDefinitionOrThrow({
    state: options.state,
    instanceId: options.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    detail: "Unknown resolved burst source card",
  });
  const destination = getBurstPostResolutionDestination(
    sourceDefinition,
    options.getHandWrittenBurstPostResolutionPolicy
  );

  if (destination === "burst") {
    return {
      ...nextStateBase,
      log: [
        ...nextStateBase.log,
        `burst:post-resolution:stay:${options.checkId}:${options.sourceInstanceId}`,
      ],
    };
  }

  return replaceCardInstances(
    {
      ...nextStateBase,
      log: [
        ...nextStateBase.log,
        `burst:post-resolution:trash:${options.checkId}:${options.sourceInstanceId}`,
      ],
    },
    nextStateBase.cardInstances.map((cardInstance) =>
      cardInstance.instanceId !== options.sourceInstanceId
        ? cardInstance
        : {
            ...cardInstance,
            zone: "trash",
            zoneRoleName: getDefaultZoneRoleName(sourceDefinition, "trash"),
          }
    )
  );
}

export function playBurstSourceCardWithoutPayingCost(
  options: PlayBurstSourceCardWithoutPayingCostOptions
): PlayCardWithoutPayingCostActionResult {
  const sourceCard = getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown burst source card"
  );

  if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Burst source card belongs to ${sourceCard.controllerPlayerId}, not ${options.actingPlayerId}`
    );
  }

  if (sourceCard.zone !== "burst") {
    throw new Error(
      `Burst source card is not in burst zone: ${options.sourceInstanceId}`
    );
  }

  return playBurstFollowUpCardWithoutPayingCost({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    sourceInstanceId: options.sourceInstanceId,
    targetInstanceId: options.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    enterFieldCorePlacements: options.enterFieldCorePlacements,
    ...(options.chainId
      ? {
          chainId: options.chainId,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
  });
}

export function playBurstFollowUpCardWithoutPayingCost(
  options: PlayBurstFollowUpCardWithoutPayingCostOptions
): PlayCardWithoutPayingCostActionResult {
  getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown burst follow-up source card"
  );
  const targetCard = getCardInstanceOrThrow(
    options.state,
    options.targetInstanceId,
    "Unknown burst follow-up target card"
  );

  if (targetCard.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Burst follow-up target card belongs to ${targetCard.controllerPlayerId}, not ${options.actingPlayerId}`
    );
  }

  const targetDefinition = getCardDefinitionOrThrow({
    state: options.state,
    instanceId: options.targetInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    detail: "Unknown burst follow-up target definition",
  });
  const actionKind =
    targetDefinition.printedCategory === "spirit"
      ? "summon"
      : targetDefinition.printedCategory === "nexus"
        ? "place_nexus"
        : null;

  if (actionKind === null) {
    throw new Error(
      `Burst follow-up target card cannot be played onto the field without cost: category=${targetDefinition.printedCategory} cardNo=${targetDefinition.cardNo}`
    );
  }

  const enterFieldCorePlacementPolicy = getEnterFieldCorePlacementPolicy({
    card: targetCard,
    definition: targetDefinition,
  });

  return playCardWithoutPayingCostWithPlacement({
    state: {
      ...options.state,
      log: [
        ...options.state.log,
        `burst:follow-up:play:${options.chainId ?? "none"}:${options.sourceInstanceId}:${options.targetInstanceId}`,
      ],
    },
    actingPlayerId: options.actingPlayerId,
    card: targetCard,
    definition: targetDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    actionKind,
    effectFieldEntrySource: "burst_follow_up",
    enterFieldCorePlacementPolicy,
    enterFieldCorePlacements: options.enterFieldCorePlacements,
    ...(options.chainId
      ? {
          chainId: options.chainId,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
  });
}

export function useBurstSourceMagicCardWithoutPayingCost(
  options: UseBurstSourceMagicCardWithoutPayingCostOptions
): MagicWithoutCostActionResult {
  const sourceCard = getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown burst source magic card"
  );

  if (sourceCard.controllerPlayerId !== options.actingPlayerId) {
    throw new Error(
      `Burst source magic card belongs to ${sourceCard.controllerPlayerId}, not ${options.actingPlayerId}`
    );
  }

  if (sourceCard.zone !== "burst") {
    throw new Error(
      `Burst source magic card is not in burst zone: ${options.sourceInstanceId}`
    );
  }

  return useBurstFollowUpMagicCardWithoutPayingCost({
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    sourceInstanceId: options.sourceInstanceId,
    magicInstanceId: options.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: options.targetInstanceIds,
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.paymentSources !== undefined
      ? {
          paymentSources: options.paymentSources,
        }
      : {}),
    ...(options.chainId
      ? {
          chainId: options.chainId,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
  });
}

export function useBurstFollowUpMagicCardWithoutPayingCost(
  options: UseBurstFollowUpMagicCardWithoutPayingCostOptions
): MagicWithoutCostActionResult {
  getCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown burst follow-up source card"
  );
  const magicCard = getCardInstanceOrThrow(
    options.state,
    options.magicInstanceId,
    "Unknown burst follow-up magic card"
  );
  const magicDefinition = getCardDefinitionOrThrow({
    state: options.state,
    instanceId: options.magicInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    detail: "Unknown burst follow-up magic definition",
  });

  if (magicDefinition.printedCategory !== "magic") {
    throw new Error(
      `Burst follow-up card cannot be used as magic without cost: category=${magicDefinition.printedCategory} cardNo=${magicDefinition.cardNo}`
    );
  }

  const chainId = options.chainId;

  return useMagicCardWithoutPayingCostAsAction({
    state: {
      ...options.state,
      log: [
        ...options.state.log,
        `burst:follow-up:magic-use:${chainId ?? "none"}:${options.sourceInstanceId}:${options.magicInstanceId}`,
      ],
    },
    actingPlayerId: options.actingPlayerId,
    magicInstanceId: options.magicInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    allowedSourceZones: [magicCard.zone],
    ...(options.targetInstanceIds
      ? {
          targetInstanceIds: [...options.targetInstanceIds],
        }
      : {}),
    ...(options.targetEffectFilterTags
      ? {
          targetEffectFilterTags: options.targetEffectFilterTags,
        }
      : {}),
    ...(options.chosenLifeCoreKind !== undefined
      ? {
          chosenLifeCoreKind: options.chosenLifeCoreKind,
        }
      : {}),
    ...(options.paymentSources !== undefined
      ? {
          paymentSources: options.paymentSources,
        }
      : {}),
    ...(chainId
      ? {
          chainId,
        }
      : {}),
    ...(options.resolveEffect
      ? {
          resolveEffect: options.resolveEffect,
        }
      : {}),
    ...(options.getHandWrittenEffectResolver
      ? {
          getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
        }
      : {}),
  });
}

/**
 * 「相手のバーストN個を破棄する/手札に戻す」(BSRK01-C06 / BSES01-M01 等)を実行する。
 *
 * セット中または発動宣言への応答中のバーストを count 枚選び、destination へ移す。
 * 宣言元が手札等でも対象とし、実際の移動があれば保留中の発動を取り消す。
 * カードは裏向きでセット中のため acting プレイヤーは内容を見ずに「枚数分」を選ぶ
 * （公式裁定 Q4185 と同型: 「内容を見ないで1枚選んで破棄」）。実装は決定的な先頭ピック
 * （test/AI 後方互換）で、将来 GUI ピッカーを足す場合は事前 pending を追加可能。
 *
 * 注: discard というラベルだがコア管理は伴わない（burst ゾーンのカードはコアを持たない）。
 * バースト発動を「無効にする」(`negate_opponent_burst`) や「発揮できない」(`burstSuppressKind`)
 * とは別系統。これは set 状態そのものを除去する一発アクション。
 */
export function executeDiscardSetBurst(
  state: GameState,
  targetPlayerId: string,
  count: number,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  destination?: "trash" | "hand" | "deck_bottom",
  unpreventable?: boolean
): GameState;
export function executeDiscardSetBurst(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string | undefined,
  targetPlayerId: string,
  count: number,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  destination?: "trash" | "hand" | "deck_bottom",
  unpreventable?: boolean,
  selectedCardInstanceIds?: readonly string[]
): GameState;
export function executeDiscardSetBurst(
  state: GameState,
  actingOrTargetPlayerId: string,
  sourceOrCount: string | undefined | number,
  targetOrGetDef:
    | string
    | ((definitionId: string) => CardDefinition | undefined),
  countOrDestination?: number | "trash" | "hand" | "deck_bottom",
  getDefOrUnpreventable?:
    | ((definitionId: string) => CardDefinition | undefined)
    | boolean,
  destinationArg: "trash" | "hand" | "deck_bottom" = "trash",
  unpreventableArg = false,
  selectedCardInstanceIdsArg?: readonly string[]
): GameState {
  const legacyCall = typeof sourceOrCount === "number";
  const actingPlayerId = legacyCall ? null : actingOrTargetPlayerId;
  const sourceInstanceId = legacyCall ? undefined : sourceOrCount;
  const targetPlayerId = legacyCall
    ? actingOrTargetPlayerId
    : (targetOrGetDef as string);
  const count = legacyCall ? sourceOrCount : (countOrDestination as number);
  const getCardDefinitionById = legacyCall
    ? (targetOrGetDef as (definitionId: string) => CardDefinition | undefined)
    : (getDefOrUnpreventable as (
        definitionId: string
      ) => CardDefinition | undefined);
  const destination = legacyCall
    ? typeof countOrDestination === "string"
      ? countOrDestination
      : "trash"
    : destinationArg;
  const unpreventable = legacyCall
    ? getDefOrUnpreventable === true
    : unpreventableArg;
  const selectedCardInstanceIds = legacyCall
    ? undefined
    : selectedCardInstanceIdsArg;
  if (count <= 0) {
    return state;
  }
  const targetSet = getDiscardableBurstStates(state, targetPlayerId);
  if (targetSet.length === 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:discard_set_burst:${targetPlayerId}:0:no-bursts`,
      ],
    };
  }
  const source =
    sourceInstanceId !== undefined
      ? getCardById(state, sourceInstanceId)
      : undefined;
  const sourceDef =
    source !== undefined
      ? getCardDefinitionById(source.definitionId)
      : undefined;
  const targetSetById = new Map(
    targetSet.map((setState) => [setState.cardInstanceId, setState])
  );
  const selectedSet =
    selectedCardInstanceIds !== undefined
      ? selectedCardInstanceIds
          .slice(0, count)
          .map((id) => targetSetById.get(id))
          .filter((s): s is (typeof targetSet)[number] => s !== undefined)
      : targetSet.slice(0, count);
  const targetCards = selectedSet
    .map((s) => getCardById(state, s.cardInstanceId))
    .filter((card): card is CardInstance => card !== undefined);
  const sourcePreventionLevel = unpreventable ? "unpreventable" : "none";
  const immunityResults = resolveCardImmunityAffectDecisions(
    state,
    targetCards,
    actingPlayerId,
    sourcePreventionLevel,
    { instance: source, definition: sourceDef },
    getCardDefinitionById
  );
  const leaveOutcome =
    destination === "hand"
      ? "bounce"
      : destination === "deck_bottom"
        ? "send_to_deck"
        : undefined;
  const leaveResults =
    leaveOutcome === undefined
      ? []
      : resolveCardLeaveAffectDecisions(
          state,
          targetCards,
          leaveOutcome,
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel
        );
  // 複数の耐性が成立する場合も、公開情報だけで防げるなら追加の証明は不要。
  const results = immunityResults.map((immunity) => {
    const leave = leaveResults.find(
      (result) => result.card.instanceId === immunity.card.instanceId
    );
    const blockers = [immunity, ...(leave ? [leave] : [])].filter(
      (result) => result.decision.kind === "blocked"
    );
    return (
      blockers.sort(
        (a, b) =>
          (a.proofCardInstanceIds?.length ?? 0) -
          (b.proofCardInstanceIds?.length ?? 0)
      )[0] ?? immunity
    );
  });
  state = appendImmunityProofDisclosures(state, results, sourceInstanceId);
  const allowedIds = new Set(
    results
      .filter((result) => result.decision.kind === "allowed")
      .map((result) => result.card.instanceId)
  );
  const toDiscard = selectedSet.filter((s) => allowedIds.has(s.cardInstanceId));
  if (toDiscard.length === 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:discard_set_burst:${targetPlayerId}:0:blocked`,
      ],
    };
  }
  const discardedIds = new Set(toDiscard.map((s) => s.cardInstanceId));
  const destinationZone = destination === "deck_bottom" ? "deck" : destination;
  const movedIds = new Set(
    toDiscard
      .filter(
        (s) => getCardById(state, s.cardInstanceId)?.zone !== destinationZone
      )
      .map((s) => s.cardInstanceId)
  );
  const logEntries = toDiscard.map(
    (s) =>
      `effect:discard_set_burst:${targetPlayerId}:${s.cardInstanceId}->${destination}`
  );
  let nextState = state;
  if (destination === "deck_bottom") {
    // executeSendToDeck / DiscardAction の deck_bottom 分岐と同じ reset パターン
    // (SSOT)。burst カードはフィールド外なのでコア/合体/アンダーカードは元々空だが、
    // 念のため同じフィールドを明示リセットする。
    nextState = replaceCardInstances(
      {
        ...nextState,
        players: nextState.players.map((p) =>
          p.id === targetPlayerId ? { ...p } : p
        ),
      },
      nextState.cardInstances.map((c) =>
        discardedIds.has(c.instanceId)
          ? applyFaceDownPolicyOnZoneChange(
              {
                ...c,
                zone: "deck" as const,
                normalCoreCount: 0,
                exhaustState: "recovered" as const,
                attachedToInstanceId: null,
                attachedChildrenIds: [],
                underCards: [],
              },
              "deck"
            )
          : c
      )
    );
  } else {
    for (const entry of toDiscard) {
      const card = getCardById(nextState, entry.cardInstanceId);
      if (card === undefined || !movedIds.has(entry.cardInstanceId)) continue;
      const def = getCardDefinitionById(card.definitionId);
      nextState = moveCardZone(
        nextState,
        entry.cardInstanceId,
        destination,
        def ? getDefaultZoneRoleName(def, destination) : card.zoneRoleName
      );
    }
  }
  const burstActivationCancellation = clearMovedBurstActivationState(
    nextState,
    movedIds
  );
  nextState = burstActivationCancellation.state;
  return {
    ...nextState,
    setBurstStates: nextState.setBurstStates.filter(
      (s) => !discardedIds.has(s.cardInstanceId)
    ),
    log: [
      ...nextState.log,
      ...logEntries,
      ...burstActivationCancellation.logEntries,
    ],
  };
}
