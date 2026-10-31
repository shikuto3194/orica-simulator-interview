import { describe, expect, it } from "vitest";
import type {
  AttackDeclarationResult,
  ActiveStack,
  BlockDeclarationResult,
  CardColor,
  CardDefinition,
  ContinuousEffect,
  ConditionalCostCanExecuteCheck,
  CanExecuteCheckAccessor,
  ConditionalResultSuccessCheck,
  SuccessCheckAccessor,
  EffectActionContext,
  GameState,
  HandWrittenEffectResolver,
  HandWrittenEffectResolverLookup,
  RegisteredBattleImmediateEffectAction,
  RegisteredBurstAction,
  RegisteredFieldCardEffectAction,
  RegisteredHandCardEffectAction,
  RegisteredMagicAction,
  RegisteredTriggeredEffectAction,
  TriggerPriority,
} from "../src/index";

import {
  advanceStep,
  applyStateBasedActions,
  applyCardCostPayments,
  assertValidGameState,
  canFlushPendingLeaves,
  calculateReduction,
  canCardBeAffectedByEffect,
  collectAndQueueTriggerReactions,
  collectGameStateInvariantIssues,
  collectTriggerEventsFromStateDelta,
  queuePendingReactionsRawForTesting,
  createChainResolveEffectQueueEntry,
  executeHandWrittenEffectResolver,
  getLegalActions,
  createCardInstance,
  createEmptyGameState,
  createActingPlayerLifeCoreToSourceCardResolver,
  filterTargetCardInstanceIdsByEffectFilter,
  getAvailableLifeCoreMoveChoices,
  ENTER_FIELD_CORE_PLACEMENT_FORBIDDEN_TAG,
  ENTER_FIELD_CORE_PLACEMENT_MAX_TAG_PREFIX,
  ENTER_FIELD_CORE_PLACEMENT_MIN_TAG_PREFIX,
  ENTER_FIELD_CORE_PLACEMENT_RULE_TAG_PREFIX,
  runActionMainResolution,
  flushPendingLeaves,
  resolveBraveLeaveChoice,
  resolveBraveAttackContinuation,
  getAvailableMagicPaymentSources,
  getAllowedEffectFilterTags,
  getNextStep,
  getEffectFilterBlockReason,
  getPlayerReserveCoreCount,
  getPlayerTrashCoreCount,
  getTotalCoresOnCardById,
  createActingPlayerLifeCoreToTargetCardResolver,
  createGlobalResolveEffectQueueEntry,
  createTargetCardPendingLeaveResolver,
  createTargetCardJoinActiveAttackResolver,
  applyLegalAction,
  joinActiveAttackAsAction,
  moveLifeCoreByEffect,
  moveSoulCore,
  queuePendingReactionsFromStepTransition,
  refreshTrashCoresToReserve,
  resolveCardLeavesFieldCores,
  resolveLifeDamage,
  runStateBasedActions,
  isValidGameState,
  STEP_ORDER,
  executeBattleResolution,
  useAttackAsAction,
  useBlockAsAction,
  usePassPreDeclarationStackAsAction,
  confirmAttackDeclarationAsAction,
  confirmBlockDeclarationAsAction,
  useFieldCardEffectAsAction,
  playMagicCardAsAction,
  placeNexusAsAction,
  playSummonAsAction,
  playBurstFollowUpCardWithoutPayingCost,
  playBurstSourceCardWithoutPayingCost,
  useBurstFollowUpMagicCardWithoutPayingCost,
  useBurstSourceMagicCardWithoutPayingCost,
  canCardDefinitionBeSetAsBurst,
  finalizeResolvedBurstCard,
  revealBurstCardForResolution,
  queuePendingLeave,
  tryApplyLegalAction,
  executeReevaluationCheck,
  matchesEffectTargetFilter,
  runReevaluationAtTiming,
  buildReevaluationConfig,
  getPreventionBlockReason,
  getStrongestDefenseLevel,
  filterTargetsByPreventionLevel,
  createContinuousEffectOnTargetResolver,
  createSimultaneousCompositionResolver,
  createConditionalCostCompositionResolver,
  createConditionalResultCompositionResolver,
  buildComposedResolverFromComposition,
  resolveContinuousEffectOnTarget,
  getBpModifierTotal,
  getSimultaneousGroups,
  getEffectiveBp,
  getEffectiveLevel,
  getEffectiveSymbols,
  getSymbolAdditions,
  recomputeBattleEntityBp,
  getAvailableCardCostPaymentSources,
  withSoulCoreLocation,
} from "../src/index";
import { resumeStackCascadeIfReady } from "../src/legal/stack-resolution-core";
import { processPendingImmediateBattleEnds } from "../src/effect/effect-resolution";

function createDemoSpiritDefinition() {
  return {
    cardNo: "DEMO-SPIRIT-001",
    name: "Demo Spirit",
    printedCategory: "spirit",
    colors: ["red"] as const,
    cost: 3,
    reductionSymbols: ["red", "red"] as const,
    levelDefs: [
      { level: 1, requiredCores: 1, bp: 2000 },
      { level: 2, requiredCores: 3, bp: 4000 },
    ],
    symbolColors: ["red"] as const,
    textLines: [],
    keywordTags: [],
    sourceUrls: [],
    sourceConfidence: "C" as const,
  };
}

function createDemoCardDefinition(
  overrides: Partial<CardDefinition> &
    Pick<CardDefinition, "cardNo" | "name" | "printedCategory">
): CardDefinition {
  return {
    cardNo: overrides.cardNo,
    name: overrides.name,
    printedCategory: overrides.printedCategory,
    colors: overrides.colors ?? ["red"],
    cost: overrides.cost ?? 3,
    reductionSymbols: overrides.reductionSymbols ?? [],
    levelDefs: overrides.levelDefs ?? [],
    symbolColors: overrides.symbolColors ?? [],
    textLines: overrides.textLines ?? [],
    keywordTags: overrides.keywordTags ?? [],
    sourceUrls: overrides.sourceUrls ?? [],
    sourceConfidence: overrides.sourceConfidence ?? "C",
  };
}

function createDefinitionLookup(definitions: CardDefinition[]) {
  const definitionMap = new Map(
    definitions.map((definition) => [definition.cardNo, definition])
  );

  return (definitionId: string) => definitionMap.get(definitionId);
}

function createFieldEffectActionRegistrationLookup(
  registrationRecord: Record<string, readonly RegisteredFieldCardEffectAction[]>
) {
  return (cardNo: string) => registrationRecord[cardNo];
}

function createHandCardEffectActionRegistrationLookup(
  registrationRecord: Record<string, RegisteredHandCardEffectAction>
) {
  return (cardNo: string) => registrationRecord[cardNo];
}

function createMagicActionRegistrationLookup(
  registrationRecord: Record<
    string,
    RegisteredMagicAction | RegisteredMagicAction[]
  >
) {
  return (cardNo: string) => {
    const v = registrationRecord[cardNo];
    if (!v) return undefined;
    return Array.isArray(v) ? v : [v];
  };
}

function createBattleImmediateEffectActionRegistrationLookup(
  registrationRecord: Record<
    string,
    readonly RegisteredBattleImmediateEffectAction[]
  >
) {
  return (cardNo: string) => registrationRecord[cardNo];
}

function createTriggeredEffectActionRegistrationLookup(
  registrationRecord: Record<string, readonly RegisteredTriggeredEffectAction[]>
) {
  return (cardNo: string) => registrationRecord[cardNo];
}

function createBurstActionRegistrationLookup(
  registrationRecord: Record<string, readonly RegisteredBurstAction[]>
) {
  return (cardNo: string) => registrationRecord[cardNo];
}

function drainPendingReactions(
  state: GameState,
  definitionLookup: (definitionId: string) => CardDefinition | undefined,
  options?: {
    getRegisteredBurstActions?: Parameters<
      typeof applyLegalAction
    >[0]["getRegisteredBurstActions"];
    getRegisteredTriggeredEffectActions?: Parameters<
      typeof applyLegalAction
    >[0]["getRegisteredTriggeredEffectActions"];
  }
): GameState {
  let current = state;
  for (let i = 0; i < 100; i++) {
    const playerIds = current.players.map((p) => p.id);
    if (current.window === "stack" && current.stackWindow !== null) {
      current = fullyResolveMainStepStack({
        state: current,
        getCardDefinitionById: definitionLookup,
        ...(options?.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options?.getRegisteredTriggeredEffectActions
          ? {
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
            }
          : {}),
      });
      continue;
    }

    let found = false;
    for (const pid of playerIds) {
      const actions = getLegalActions({
        state: current,
        actingPlayerId: pid,
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        ...(options?.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options?.getRegisteredTriggeredEffectActions
          ? {
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
            }
          : {}),
      });
      const burstAction =
        actions.find((a) => a.kind === "resolve_pending_burst_check") ??
        actions.find((a) => a.kind === "decline_pending_burst_check");
      if (burstAction) {
        current = applyLegalAction({
          state: current,
          action: burstAction,
          getCardDefinitionById: definitionLookup,
          ...(options?.getRegisteredBurstActions
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
          ...(options?.getRegisteredTriggeredEffectActions
            ? {
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
              }
            : {}),
        }).state;
        found = true;
        break;
      }
    }
    if (found) continue;

    for (const pid of playerIds) {
      const actions = getLegalActions({
        state: current,
        actingPlayerId: pid,
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        ...(options?.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options?.getRegisteredTriggeredEffectActions
          ? {
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
            }
          : {}),
      });
      const triggerAction = actions.find(
        (a) => a.kind === "resolve_pending_triggered_effect"
      );
      if (triggerAction) {
        current = applyLegalAction({
          state: current,
          action: triggerAction,
          getCardDefinitionById: definitionLookup,
          ...(options?.getRegisteredBurstActions
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
          ...(options?.getRegisteredTriggeredEffectActions
            ? {
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
              }
            : {}),
        }).state;
        found = true;
        break;
      }
    }
    if (found) continue;

    for (const pid of playerIds) {
      const actions = getLegalActions({
        state: current,
        actingPlayerId: pid,
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        ...(options?.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options?.getRegisteredTriggeredEffectActions
          ? {
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
            }
          : {}),
      });
      const selectAction = actions.find(
        (a) => a.kind === "select_pending_to_resolve"
      );
      if (selectAction) {
        current = applyLegalAction({
          state: current,
          action: selectAction,
          getCardDefinitionById: definitionLookup,
          ...(options?.getRegisteredBurstActions
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
          ...(options?.getRegisteredTriggeredEffectActions
            ? {
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
              }
            : {}),
        }).state;
        found = true;
        break;
      }
    }
    if (!found) return current;
  }
  return current;
}

function closeAvailableBattleFlashWindow(
  state: ReturnType<typeof createEmptyGameState>,
  definitionLookup: (definitionId: string) => CardDefinition | undefined,
  options?: {
    getRegisteredBurstActions?: Parameters<
      typeof applyLegalAction
    >[0]["getRegisteredBurstActions"];
    getRegisteredTriggeredEffectActions?: Parameters<
      typeof applyLegalAction
    >[0]["getRegisteredTriggeredEffectActions"];
  }
) {
  const openAction = getLegalActions({
    state,
    actingPlayerId: state.activePlayerId,
    getCardDefinitionById: definitionLookup,
    getRegisteredFieldCardEffectActions:
      createFieldEffectActionRegistrationLookup({}),
    ...(options?.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options?.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
  }).find((legalAction) => legalAction.kind === "open_battle_flash");

  if (!openAction) {
    return state;
  }

  const openedState = applyLegalAction({
    state,
    action: openAction,
    getCardDefinitionById: definitionLookup,
    ...(options?.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options?.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
  }).state;
  const firstPriorityPlayerId =
    openedState.activeAttack?.flashWindowState?.priorityPlayerId ??
    state.activePlayerId;
  const firstPassAction = getLegalActions({
    state: openedState,
    actingPlayerId: firstPriorityPlayerId,
    getCardDefinitionById: definitionLookup,
    getRegisteredFieldCardEffectActions:
      createFieldEffectActionRegistrationLookup({}),
    ...(options?.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options?.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
  }).find((legalAction) => legalAction.kind === "pass_battle_flash");
  const passedState = applyLegalAction({
    state: openedState,
    action: firstPassAction!,
    getCardDefinitionById: definitionLookup,
    ...(options?.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options?.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
  }).state;
  const nextPriorityPlayerId =
    passedState.activeAttack?.flashWindowState?.priorityPlayerId;

  if (!nextPriorityPlayerId) {
    return passedState;
  }

  const secondPassAction = getLegalActions({
    state: passedState,
    actingPlayerId: nextPriorityPlayerId,
    getCardDefinitionById: definitionLookup,
    getRegisteredFieldCardEffectActions:
      createFieldEffectActionRegistrationLookup({}),
    ...(options?.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options?.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
  }).find((legalAction) => legalAction.kind === "pass_battle_flash");

  return applyLegalAction({
    state: passedState,
    action: secondPassAction!,
    getCardDefinitionById: definitionLookup,
    ...(options?.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options?.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
  }).state;
}

function fullyResolveMainStepStack(options: {
  state: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getHandWrittenEffectResolver?: Parameters<
    typeof applyLegalAction
  >[0]["getHandWrittenEffectResolver"];
  getRegisteredBurstActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBurstActions"];
  getRegisteredFieldCardEffectActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredFieldCardEffectActions"];
  getRegisteredTriggeredEffectActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredTriggeredEffectActions"];
  getRegisteredMagicActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredMagicActions"];
  getRegisteredHandCardEffectActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredHandCardEffectActions"];
  getHandWrittenBurstPostResolutionPolicy?: Parameters<
    typeof applyLegalAction
  >[0]["getHandWrittenBurstPostResolutionPolicy"];
  pendingEffectTargetInstanceIds?: readonly string[];
  pendingEffectTargetSelectionQueue?: readonly (readonly string[])[];
}): GameState {
  let currentState = options.state;
  const pendingEffectTargetSelectionQueue =
    options.pendingEffectTargetSelectionQueue ??
    (options.pendingEffectTargetInstanceIds !== undefined
      ? [options.pendingEffectTargetInstanceIds]
      : []);
  let pendingEffectTargetSelectionIndex = 0;

  for (let guard = 0; guard < 12; guard += 1) {
    if (currentState.window !== "stack" || currentState.stackWindow === null) {
      const pendingTarget = currentState.pendingEffectTargetSelection;
      const nextTargetInstanceIds =
        pendingEffectTargetSelectionQueue[pendingEffectTargetSelectionIndex];
      if (pendingTarget !== null && nextTargetInstanceIds !== undefined) {
        const resolveTargetAction = getLegalActions({
          state: currentState,
          actingPlayerId: pendingTarget.actingPlayerId,
          getCardDefinitionById: options.getCardDefinitionById,
          getRegisteredFieldCardEffectActions:
            options.getRegisteredFieldCardEffectActions ??
            createFieldEffectActionRegistrationLookup({}),
          ...(options.getRegisteredBurstActions
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
          ...(options.getRegisteredTriggeredEffectActions
            ? {
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
              }
            : {}),
          ...(options.getRegisteredMagicActions
            ? { getRegisteredMagicActions: options.getRegisteredMagicActions }
            : {}),
          ...(options.getRegisteredHandCardEffectActions
            ? {
                getRegisteredHandCardEffectActions:
                  options.getRegisteredHandCardEffectActions,
              }
            : {}),
        }).find(
          (legalAction) => legalAction.kind === "resolve_pending_effect_target"
        );
        if (!resolveTargetAction) {
          throw new Error(
            "No resolve_pending_effect_target action while resolving stack"
          );
        }
        pendingEffectTargetSelectionIndex += 1;
        currentState = applyLegalAction({
          state: currentState,
          action: resolveTargetAction,
          targetInstanceIds: [...nextTargetInstanceIds],
          getCardDefinitionById: options.getCardDefinitionById,
          ...(options.getHandWrittenEffectResolver
            ? {
                getHandWrittenEffectResolver:
                  options.getHandWrittenEffectResolver,
              }
            : {}),
          ...(options.getRegisteredBurstActions
            ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
            : {}),
          ...(options.getRegisteredFieldCardEffectActions
            ? {
                getRegisteredFieldCardEffectActions:
                  options.getRegisteredFieldCardEffectActions,
              }
            : {}),
          ...(options.getRegisteredTriggeredEffectActions
            ? {
                getRegisteredTriggeredEffectActions:
                  options.getRegisteredTriggeredEffectActions,
              }
            : {}),
          ...(options.getRegisteredMagicActions
            ? { getRegisteredMagicActions: options.getRegisteredMagicActions }
            : {}),
          ...(options.getRegisteredHandCardEffectActions
            ? {
                getRegisteredHandCardEffectActions:
                  options.getRegisteredHandCardEffectActions,
              }
            : {}),
        }).state;
        continue;
      }

      // 召喚/配置はコスト支払い後のスタック窓クローズで pendingEnterFieldPlacement に
      // 遷移する (維持コア配置を遅延)。「スタックを完全解決して場入りまで進める」という
      // ヘルパの意図に合わせ、保留中の配置を最小コア (reserve) で解決してから継続する。
      const pendingPlacement = currentState.pendingEnterFieldPlacement;
      if (pendingPlacement === null) {
        return currentState;
      }
      const resolvePlacement = getLegalActions({
        state: currentState,
        actingPlayerId: pendingPlacement.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredFieldCardEffectActions:
          options.getRegisteredFieldCardEffectActions ??
          createFieldEffectActionRegistrationLookup({}),
        ...(options.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options.getRegisteredTriggeredEffectActions
          ? {
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
            }
          : {}),
        ...(options.getRegisteredMagicActions
          ? {
              getRegisteredMagicActions: options.getRegisteredMagicActions,
            }
          : {}),
        ...(options.getRegisteredHandCardEffectActions
          ? {
              getRegisteredHandCardEffectActions:
                options.getRegisteredHandCardEffectActions,
            }
          : {}),
      }).find(
        (legalAction) =>
          legalAction.kind === "resolve_pending_enter_field_placement"
      );
      if (!resolvePlacement) {
        throw new Error(
          "No resolve_pending_enter_field_placement action while resolving stack"
        );
      }
      currentState = applyLegalAction({
        state: currentState,
        action: resolvePlacement,
        getCardDefinitionById: options.getCardDefinitionById,
        enterFieldCorePlacements:
          pendingPlacement.minimumCoreCount > 0
            ? [
                {
                  kind: "reserve_normal",
                  amount: pendingPlacement.minimumCoreCount,
                },
              ]
            : [],
        ...(options.getHandWrittenEffectResolver
          ? {
              getHandWrittenEffectResolver:
                options.getHandWrittenEffectResolver,
            }
          : {}),
        ...(options.getRegisteredBurstActions
          ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
          : {}),
        ...(options.getRegisteredFieldCardEffectActions
          ? {
              getRegisteredFieldCardEffectActions:
                options.getRegisteredFieldCardEffectActions,
            }
          : {}),
        ...(options.getRegisteredTriggeredEffectActions
          ? {
              getRegisteredTriggeredEffectActions:
                options.getRegisteredTriggeredEffectActions,
            }
          : {}),
      }).state;
      continue;
    }

    const actingPlayerId = currentState.stackWindow.priorityPlayerId;
    const passAction = getLegalActions({
      state: currentState,
      actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        options.getRegisteredFieldCardEffectActions ??
        createFieldEffectActionRegistrationLookup({}),
      ...(options.getRegisteredBurstActions
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      ...(options.getRegisteredTriggeredEffectActions
        ? {
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
          }
        : {}),
      ...(options.getRegisteredMagicActions
        ? {
            getRegisteredMagicActions: options.getRegisteredMagicActions,
          }
        : {}),
      ...(options.getRegisteredHandCardEffectActions
        ? {
            getRegisteredHandCardEffectActions:
              options.getRegisteredHandCardEffectActions,
          }
        : {}),
    }).find((legalAction) => legalAction.kind === "pass_stack");

    const resolvedPassAction =
      passAction ??
      ({
        kind: "pass_stack",
        actionId: `pass:${actingPlayerId}`,
        can: true,
        reason: "test_close",
        actingPlayerId,
      } as const);

    currentState = applyLegalAction({
      state: currentState,
      action: resolvedPassAction,
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.getHandWrittenEffectResolver
        ? {
            getHandWrittenEffectResolver: options.getHandWrittenEffectResolver,
          }
        : {}),
      ...(options.getRegisteredBurstActions
        ? {
            getRegisteredBurstActions: options.getRegisteredBurstActions,
          }
        : {}),
      ...(options.getRegisteredFieldCardEffectActions
        ? {
            getRegisteredFieldCardEffectActions:
              options.getRegisteredFieldCardEffectActions,
          }
        : {}),
      ...(options.getRegisteredTriggeredEffectActions
        ? {
            getRegisteredTriggeredEffectActions:
              options.getRegisteredTriggeredEffectActions,
          }
        : {}),
      ...(options.getRegisteredMagicActions
        ? {
            getRegisteredMagicActions: options.getRegisteredMagicActions,
          }
        : {}),
      ...(options.getRegisteredHandCardEffectActions
        ? {
            getRegisteredHandCardEffectActions:
              options.getRegisteredHandCardEffectActions,
          }
        : {}),
      ...(options.getHandWrittenBurstPostResolutionPolicy
        ? {
            getHandWrittenBurstPostResolutionPolicy:
              options.getHandWrittenBurstPostResolutionPolicy,
          }
        : {}),
    }).state;
  }

  throw new Error("Main-step stack did not resolve within the guard limit");
}

function resolveStackIfOpen(
  options: Parameters<typeof fullyResolveMainStepStack>[0]
): GameState {
  if (options.state.window !== "stack" || options.state.stackWindow === null) {
    return options.state;
  }
  return fullyResolveMainStepStack(options);
}

/**
 * battle_immediate 効果の発揮宣言で開いたスタック窓 (02:200) を、相手の pass_stack 1 回で
 * クローズして deferred 解決まで進める。スタック窓が開いていなければ素通し。
 */
function closeBattleImmediateStackWindow(options: {
  state: GameState;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getHandWrittenEffectResolver?: Parameters<
    typeof applyLegalAction
  >[0]["getHandWrittenEffectResolver"];
  getRegisteredBattleImmediateEffectActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBattleImmediateEffectActions"];
  getRegisteredBurstActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredBurstActions"];
  getRegisteredTriggeredEffectActions?: Parameters<
    typeof applyLegalAction
  >[0]["getRegisteredTriggeredEffectActions"];
}): GameState {
  const { state } = options;
  if (state.window !== "stack" || state.stackWindow === null) {
    return state;
  }
  const actingPlayerId = state.stackWindow.priorityPlayerId;
  return applyLegalAction({
    state,
    action: {
      kind: "pass_stack",
      actionId: `pass:${actingPlayerId}`,
      can: true,
      reason: "test_close",
      actingPlayerId,
    },
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.getHandWrittenEffectResolver
      ? { getHandWrittenEffectResolver: options.getHandWrittenEffectResolver }
      : {}),
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
    ...(options.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
    ...(options.getRegisteredTriggeredEffectActions
      ? {
          getRegisteredTriggeredEffectActions:
            options.getRegisteredTriggeredEffectActions,
        }
      : {}),
    ...(options.getRegisteredMagicActions
      ? {
          getRegisteredMagicActions: options.getRegisteredMagicActions,
        }
      : {}),
    ...(options.getRegisteredHandCardEffectActions
      ? {
          getRegisteredHandCardEffectActions:
            options.getRegisteredHandCardEffectActions,
        }
      : {}),
  }).state;
}

function fullyDeclareAttack(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredBattleImmediateEffectActions?: Parameters<
    typeof useAttackAsAction
  >[0]["getRegisteredBattleImmediateEffectActions"];
}): AttackDeclarationResult {
  const tentativeState = useAttackAsAction(options);
  const opponentId = tentativeState.playerOrder.find(
    (id) => id !== options.actingPlayerId
  )!;
  const afterPass = usePassPreDeclarationStackAsAction({
    state: tentativeState,
    actingPlayerId: opponentId,
  });
  return confirmAttackDeclarationAsAction(
    afterPass.closedWindow!,
    afterPass.state,
    options
  );
}

function fullyConfirmPreDeclarationStack(
  tentativeState: GameState,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredBattleImmediateEffectActions?: Parameters<
    typeof useAttackAsAction
  >[0]["getRegisteredBattleImmediateEffectActions"]
): GameState {
  const declarerId = tentativeState.preDeclarationStackWindow?.actingPlayerId;
  if (!declarerId) {
    throw new Error("No preDeclarationStackWindow found");
  }
  const opponentId = tentativeState.playerOrder.find(
    (id) => id !== declarerId
  )!;
  const opponentPassAction = getLegalActions({
    state: tentativeState,
    actingPlayerId: opponentId,
    getCardDefinitionById,
    getRegisteredFieldCardEffectActions:
      createFieldEffectActionRegistrationLookup({}),
  }).find((a) => a.kind === "pass_pre_declaration_stack");
  return applyLegalAction({
    state: tentativeState,
    action: opponentPassAction!,
    getCardDefinitionById,
    ...(getRegisteredBattleImmediateEffectActions
      ? { getRegisteredBattleImmediateEffectActions }
      : {}),
  }).state;
}

function fullyDeclareBlock(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  participantEntityId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): BlockDeclarationResult {
  const tentativeState = useBlockAsAction(options);
  const opponentId = tentativeState.playerOrder.find(
    (id) => id !== options.actingPlayerId
  )!;
  const afterPass = usePassPreDeclarationStackAsAction({
    state: tentativeState,
    actingPlayerId: opponentId,
  });
  return confirmBlockDeclarationAsAction(
    afterPass.closedWindow!,
    afterPass.state,
    options
  );
}

describe("rules-core step flow", () => {
  it("advances through one full step cycle in the expected order", () => {
    // T2（後攻1ターン目）から開始して全ステップを確認
    let state = createEmptyGameState();
    state = { ...state, turnNumber: 2 };
    const visitedSteps: string[] = [state.step];

    // advance through start→core→draw→refresh→main→attack (5 steps to attack)
    for (let i = 0; i < 5; i += 1) {
      state = { ...state, pendingTriggeredEffects: [] }; // P3-40: drain step_transition pendings
      state = advanceStep(state);
      visitedSteps.push(state.step);
    }

    // attack→end(end_step_effects)→end(end_step_end_effects)→end(end_step_cleanup)→start
    state = { ...state, pendingTriggeredEffects: [] };
    state = advanceStep(state);
    visitedSteps.push(`${state.step}:${state.window}`);
    state = { ...state, pendingTriggeredEffects: [] }; // clear end_step trigger
    state = advanceStep(state);
    visitedSteps.push(`${state.step}:${state.window}`);
    state = { ...state, pendingTriggeredEffects: [] };
    state = advanceStep(state);
    visitedSteps.push(`${state.step}:${state.window}`);
    state = { ...state, pendingTriggeredEffects: [] };
    state = advanceStep(state);
    visitedSteps.push(state.step);

    expect(visitedSteps).toEqual([
      "start",
      "core",
      "draw",
      "refresh",
      "main",
      "attack",
      "end:end_step_effects",
      "end:end_step_end_effects",
      "end:end_step_cleanup",
      "start",
    ]);
  });

  it("skips core and attack steps for first player on turn 1", () => {
    let state = createEmptyGameState();
    const visitedSteps: string[] = [state.step];

    // T1 先攻: start → draw (core skip) → refresh → main → end (attack skip)
    for (let i = 0; i < 3; i += 1) {
      state = { ...state, pendingTriggeredEffects: [] }; // P3-40: drain step_transition pendings
      state = advanceStep(state);
      visitedSteps.push(state.step);
    }
    // main → end (attack skipped)
    state = { ...state, pendingTriggeredEffects: [] };
    state = advanceStep(state);
    visitedSteps.push(`${state.step}:${state.window}`);

    expect(visitedSteps).toEqual([
      "start",
      "draw",
      "refresh",
      "main",
      "end:end_step_effects",
    ]);
  });

  it("wraps at end step to the next turn and the next active player", () => {
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });

    while (state.step !== "end") {
      state = { ...state, pendingTriggeredEffects: [] }; // P3-40: drain step_transition pendings
      state = advanceStep(state);
    }

    // end_step_effects → end_step_end_effects → end_step_cleanup → start
    expect(state.window).toBe("end_step_effects");
    state = { ...state, pendingTriggeredEffects: [] };
    state = advanceStep(state); // → end_step_end_effects
    expect(state.window).toBe("end_step_end_effects");
    state = { ...state, pendingTriggeredEffects: [] };
    state = advanceStep(state); // → end_step_cleanup
    expect(state.window).toBe("end_step_cleanup");
    state = { ...state, pendingTriggeredEffects: [] };
    const wrapped = advanceStep(state); // → start

    expect(wrapped.turnNumber).toBe(2);
    expect(wrapped.activePlayerId).toBe("bob");
    expect(wrapped.step).toBe("start");
    expect(wrapped.window).toBe("none");
  });

  it("clears expired effect usage records on step and turn transitions while preserving game-scoped records", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      turnNumber: 3,
      activePlayerId: "alice",
      step: "main" as const,
      effectUsageRecords: [
        {
          sourceInstanceId: "step-source-1",
          sourceDefinitionId: "STEP-SOURCE-001",
          effectLabel: "step-effect",
          turnNumber: 3,
          step: "main" as const,
          duration: "step" as const,
          count: 1,
        },
        {
          sourceInstanceId: "turn-source-1",
          sourceDefinitionId: "TURN-SOURCE-001",
          effectLabel: "turn-effect",
          turnNumber: 3,
          step: "main" as const,
          duration: "turn" as const,
          count: 1,
        },
        {
          sourceInstanceId: "game-source-1",
          sourceDefinitionId: "GAME-SOURCE-001",
          effectLabel: "game-effect",
          turnNumber: 1,
          step: "start" as const,
          duration: "game" as const,
          count: 1,
        },
      ],
    };

    const afterAttack = advanceStep(state);

    expect(afterAttack.step).toBe("attack");
    expect(afterAttack.effectUsageRecords).toEqual([
      expect.objectContaining({
        effectLabel: "turn-effect",
        duration: "turn",
      }),
      expect.objectContaining({
        effectLabel: "game-effect",
        duration: "game",
      }),
    ]);

    // P3-40: 各 advanceStep 前に step_transition pending を drain
    const afterEnd = advanceStep({
      ...afterAttack,
      pendingTriggeredEffects: [],
    }); // → end:end_step_effects
    const afterEndEffects = advanceStep({
      ...afterEnd,
      pendingTriggeredEffects: [],
    }); // → end:end_step_end_effects
    const afterCleanup = advanceStep({
      ...afterEndEffects,
      pendingTriggeredEffects: [],
    }); // → end:end_step_cleanup
    const wrapped = advanceStep({
      ...afterCleanup,
      pendingTriggeredEffects: [],
    }); // → start

    expect(wrapped.turnNumber).toBe(4);
    expect(wrapped.step).toBe("start");
    expect(wrapped.effectUsageRecords).toEqual([
      expect.objectContaining({
        effectLabel: "game-effect",
        duration: "game",
      }),
    ]);
  });

  it("queues pending reactions from a step transition delta", () => {
    const beforeState = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });
    const afterState = {
      ...beforeState,
      step: "core" as const,
      window: "none" as const,
      players: beforeState.players.map((player) =>
        player.id === "alice"
          ? {
              ...player,
              lifeNormalCoreCount: player.lifeNormalCoreCount - 1,
            }
          : player
      ),
    };

    const transitionedState = queuePendingReactionsFromStepTransition({
      beforeState,
      afterState,
    });

    expect(transitionedState.pendingTriggeredEffects).toHaveLength(1);
    expect(transitionedState.pendingTriggeredEffects[0]).toMatchObject({
      actingPlayerId: "alice",
      eventKind: "reduce_life",
      event: { family: "life", validationMode: "snapshot_only" },
      source: "step_transition",
      relatedPlayerId: "alice",
      amount: 1,
      step: "core",
      window: "none",
    });
    expect(transitionedState.pendingBurstChecks).toHaveLength(1);
    expect(transitionedState.pendingBurstChecks[0]).toMatchObject({
      actingPlayerId: "alice",
      eventKind: "reduce_life",
      event: { family: "life", validationMode: "snapshot_only" },
      source: "step_transition",
      relatedPlayerId: "alice",
      amount: 1,
      step: "core",
      window: "none",
    });
  });

  it("keeps getNextStep aligned with the declared step order", () => {
    expect(STEP_ORDER.map((step) => getNextStep(step))).toEqual([
      "core",
      "draw",
      "refresh",
      "main",
      "attack",
      "end",
      "start",
    ]);
  });

  it("keeps state-based actions as a no-op when there is nothing to process", () => {
    const state = createEmptyGameState();

    expect(applyStateBasedActions(state)).toBe(state);
  });

  it("derives minimumRequiredCores from the card definition", () => {
    const definition = {
      ...createDemoSpiritDefinition(),
      cardNo: "TEST-SPIRIT-001",
      name: "Test Spirit",
      reductionSymbols: ["red"] as const,
    };

    const instance = createCardInstance(definition, {
      instanceId: "test-spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });

    expect(instance.definitionId).toBe("TEST-SPIRIT-001");
    expect(instance.minimumRequiredCores).toBe(1);
    expect(instance.zoneRoleName).toBe("spirit");
    expect(instance.pendingLeaveKind).toBeNull();
    expect(instance.pendingLeaveCause).toBeNull();
    expect(instance.deferZoneMoveUntilChainEnd).toBe(false);
  });

  it("moves a core-deficit field card into pending vanish state", () => {
    const definition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
      ],
    });

    const result = runStateBasedActions(state);
    const updatedCard = result.state.cardInstances[0];

    expect(result.checks).toEqual([
      {
        kind: "vanish_due_to_core_deficit",
        instanceId: "spirit-1",
        detail: "cores=0 < minimum=1",
      },
    ]);
    expect(updatedCard?.pendingLeaveKind).toBe("vanish");
    expect(updatedCard?.pendingLeaveCause).toBe("state_based_action");
    expect(updatedCard?.pendingLeaveChainId).toBe(
      "sba:1:alice:start:vanish_due_to_core_deficit:spirit-1"
    );
    expect(updatedCard?.deferZoneMoveUntilChainEnd).toBe(false);
    expect(result.state.pendingLeaveEntities).toEqual([
      {
        instanceId: "spirit-1",
        kind: "vanish",
        cause: "state_based_action",
        causePlayerId: null,
        chainId: "sba:1:alice:start:vanish_due_to_core_deficit:spirit-1",
        deferZoneMoveUntilChainEnd: false,
        leaveFieldCoreDestinationOverride: null,
      },
    ]);
    expect(result.state.effectQueueSummary).toEqual([]);
    expect(result.state.log).toContain(
      "pending-leave:vanish:spirit-1:sba:1:alice:start:vanish_due_to_core_deficit:spirit-1"
    );
  });

  function createSnapshotDemoDefinition() {
    return createDemoCardDefinition({
      cardNo: "SNAP-DEMO",
      name: "Snapshot Demo",
      printedCategory: "spirit",
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 2000 },
        { level: 2, requiredCores: 2, bp: 5000 },
      ],
    });
  }

  it("P3-83: freezes pendingLeaveLvSnapshot at the pre-deficit Lv when all cores leave at once (例2)", () => {
    const definition = createSnapshotDemoDefinition();
    const lookup = createDefinitionLookup([definition]);

    // 安定 (Lv2, コア2) → snapshot=2 がローリング記録される
    const stable = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    });
    const rolled = runStateBasedActions(stable, lookup).state;
    expect(rolled.cardInstances[0]?.pendingLeaveKind).toBeNull();
    expect(rolled.cardInstances[0]?.pendingLeaveLvSnapshot).toBe(2);

    // コア全移動 (2→0) → 消滅待機。snapshot は直前の Lv2 で凍結される。
    const depleted = {
      ...rolled,
      cardInstances: rolled.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 0,
      })),
    };
    const vanished = runStateBasedActions(depleted, lookup).state;
    expect(vanished.cardInstances[0]?.pendingLeaveKind).toBe("vanish");
    expect(vanished.cardInstances[0]?.pendingLeaveLvSnapshot).toBe(2);
  });

  it("P3-83: lowers pendingLeaveLvSnapshot to Lv1 when cores leave one at a time (2→1→0, 例2)", () => {
    const definition = createSnapshotDemoDefinition();
    const lookup = createDefinitionLookup([definition]);

    let state: ReturnType<typeof createEmptyGameState> = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    });
    state = runStateBasedActions(state, lookup).state;
    expect(state.cardInstances[0]?.pendingLeaveLvSnapshot).toBe(2);

    // 2→1 (Lv1, まだ安定) → snapshot が 1 に下がる
    state = {
      ...state,
      cardInstances: state.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 1,
      })),
    };
    state = runStateBasedActions(state, lookup).state;
    expect(state.cardInstances[0]?.pendingLeaveKind).toBeNull();
    expect(state.cardInstances[0]?.pendingLeaveLvSnapshot).toBe(1);

    // 1→0 → 消滅待機。snapshot=1 で凍結（Lv2 では消滅していない）。
    state = {
      ...state,
      cardInstances: state.cardInstances.map((card) => ({
        ...card,
        normalCoreCount: 0,
      })),
    };
    state = runStateBasedActions(state, lookup).state;
    expect(state.cardInstances[0]?.pendingLeaveKind).toBe("vanish");
    expect(state.cardInstances[0]?.pendingLeaveLvSnapshot).toBe(1);
  });

  it("P3-83: getEffectiveLevel / getEffectiveBp read the vanish snapshot, not current cores", () => {
    const definition = createSnapshotDemoDefinition();
    const lookup = createDefinitionLookup([definition]);
    const vanishCard = {
      ...createCardInstance(definition, {
        instanceId: "spirit-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
        pendingLeaveKind: "vanish" as const,
      }),
      pendingLeaveLvSnapshot: 2,
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [vanishCard],
    });

    // コア0 でも消滅時 Lv2 / Lv2 の印字 BP を返す（現在コア由来の Lv0 / BP0 ではない）。
    expect(getEffectiveLevel(state, vanishCard, definition, lookup)).toBe(2);
    expect(getEffectiveBp(state, vanishCard, definition, lookup)).toBe(5000);
  });

  it("does not flush pending leaves before the effect queue is empty", () => {
    const definition = createDemoSpiritDefinition();
    const pendingState = runStateBasedActions(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(definition, {
            instanceId: "spirit-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
          }),
        ],
      })
    ).state;
    const stateWithPendingEffects = {
      ...pendingState,
      effectQueueEntries: [createGlobalResolveEffectQueueEntry("demo")],
      effectQueueSummary: ["effect:demo-chain:1"],
    };

    expect(canFlushPendingLeaves(stateWithPendingEffects)).toBe(false);
    expect(flushPendingLeaves(stateWithPendingEffects)).toBe(
      stateWithPendingEffects
    );
  });

  it("flushes pending vanish cards to trash when the effect queue is empty", () => {
    const definition = createDemoSpiritDefinition();
    const pendingState = runStateBasedActions(
      createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(definition, {
            instanceId: "spirit-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
          }),
        ],
      })
    ).state;

    expect(canFlushPendingLeaves(pendingState)).toBe(true);

    const flushedState = flushPendingLeaves(pendingState);
    const flushedCard = flushedState.cardInstances[0];

    expect(flushedCard?.zone).toBe("trash");
    expect(flushedCard?.zoneRoleName).toBe("spirit-card");
    expect(flushedCard?.pendingLeaveKind).toBeNull();
    expect(flushedCard?.pendingLeaveCause).toBeNull();
    expect(flushedCard?.pendingLeaveChainId).toBeNull();
    expect(flushedCard?.deferZoneMoveUntilChainEnd).toBe(false);
    expect(flushedState.pendingLeaveEntities).toEqual([]);
    expect(flushedState.log).toContain(
      "pending-leave-flushed:vanish:spirit-1:sba:1:alice:start:vanish_due_to_core_deficit:spirit-1:state_based_action"
    );
  });

  it("keeps a cost-payment vanish pending while its originating chain is still in the queue", () => {
    const definition = createDemoSpiritDefinition();
    const chainId = "magic:alice:main:pay-1";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "cost_payment",
          pendingLeaveChainId: chainId,
          deferZoneMoveUntilChainEnd: true,
        }),
      ],
    });
    const pendingState = {
      ...state,
      pendingLeaveEntities: [
        {
          instanceId: "spirit-1",
          kind: "vanish" as const,
          cause: "cost_payment" as const,
          chainId,
          deferZoneMoveUntilChainEnd: true,
        },
      ],
      effectQueueEntries: [
        createChainResolveEffectQueueEntry(chainId),
        createChainResolveEffectQueueEntry(chainId, "after-effect"),
      ],
      effectQueueSummary: [
        `resolve[chain:${chainId}]:main`,
        `resolve[chain:${chainId}]:after-effect`,
      ],
    };

    expect(canFlushPendingLeaves(pendingState)).toBe(false);
    expect(flushPendingLeaves(pendingState)).toBe(pendingState);
  });

  it("flushes a cost-payment vanish after its originating chain has resolved", () => {
    const definition = createDemoSpiritDefinition();
    const chainId = "magic:alice:main:pay-1";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "cost_payment",
          pendingLeaveChainId: chainId,
          deferZoneMoveUntilChainEnd: true,
        }),
      ],
    });
    const pendingState = {
      ...state,
      pendingLeaveEntities: [
        {
          instanceId: "spirit-1",
          kind: "vanish" as const,
          cause: "cost_payment" as const,
          chainId,
          deferZoneMoveUntilChainEnd: true,
        },
      ],
      effectQueueEntries: [
        createChainResolveEffectQueueEntry("other-chain", "cleanup"),
      ],
      effectQueueSummary: ["resolve[chain:other-chain]:cleanup"],
    };

    expect(canFlushPendingLeaves(pendingState)).toBe(true);

    const flushedState = flushPendingLeaves(pendingState);
    const flushedCard = flushedState.cardInstances[0];

    expect(flushedCard?.zone).toBe("trash");
    expect(flushedCard?.pendingLeaveKind).toBeNull();
    expect(flushedCard?.pendingLeaveCause).toBeNull();
    expect(flushedCard?.pendingLeaveChainId).toBeNull();
    expect(flushedCard?.deferZoneMoveUntilChainEnd).toBe(false);
    expect(flushedState.pendingLeaveEntities).toEqual([]);
    expect(flushedState.log).toContain(
      `pending-leave-flushed:vanish:spirit-1:${chainId}:cost_payment`
    );
  });

  it("uses structured effect queue entries even when the summary is empty", () => {
    const definition = createDemoSpiritDefinition();
    const chainId = "magic:alice:main:pay-1";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "cost_payment",
          pendingLeaveChainId: chainId,
          deferZoneMoveUntilChainEnd: true,
        }),
      ],
    });
    const pendingState = {
      ...state,
      pendingLeaveEntities: [
        {
          instanceId: "spirit-1",
          kind: "vanish" as const,
          cause: "cost_payment" as const,
          chainId,
          deferZoneMoveUntilChainEnd: true,
        },
      ],
      effectQueueEntries: [createChainResolveEffectQueueEntry(chainId)],
      effectQueueSummary: [],
    };

    expect(canFlushPendingLeaves(pendingState)).toBe(false);
    expect(flushPendingLeaves(pendingState)).toBe(pendingState);
  });

  it("treats the summary as display-only once structured queue entries are empty", () => {
    const definition = createDemoSpiritDefinition();
    const chainId = "magic:alice:main:pay-1";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "cost_payment",
          pendingLeaveChainId: chainId,
          deferZoneMoveUntilChainEnd: true,
        }),
      ],
    });
    const pendingState = {
      ...state,
      pendingLeaveEntities: [
        {
          instanceId: "spirit-1",
          kind: "vanish" as const,
          cause: "cost_payment" as const,
          chainId,
          deferZoneMoveUntilChainEnd: true,
        },
      ],
      effectQueueEntries: [],
      effectQueueSummary: [`resolve[chain:${chainId}]:main`],
    };

    expect(canFlushPendingLeaves(pendingState)).toBe(true);
    expect(flushPendingLeaves(pendingState).cardInstances[0]?.zone).toBe(
      "trash"
    );
  });

  it("Ver.17.0: allows general effects to target a vanish-pending card (unified with destroy)", () => {
    const definition = createDemoSpiritDefinition();
    const vanishPendingCard = createCardInstance(definition, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      pendingLeaveKind: "vanish",
      pendingLeaveCause: "state_based_action",
      pendingLeaveChainId:
        "sba:1:alice:start:vanish_due_to_core_deficit:spirit-1",
    });
    const normalCard = createCardInstance(definition, {
      instanceId: "spirit-2",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [vanishPendingCard, normalCard],
    });

    expect(getAllowedEffectFilterTags(vanishPendingCard)).toEqual([
      "general",
      "vanish_related",
      "leave_field_related",
      "suppress_effects",
      "suppress_used_card",
    ]);
    expect(
      getEffectFilterBlockReason(vanishPendingCard, ["general"])
    ).toBeNull();
    expect(canCardBeAffectedByEffect(vanishPendingCard, ["general"])).toBe(
      true
    );
    expect(
      filterTargetCardInstanceIdsByEffectFilter(
        state,
        ["spirit-1", "spirit-2"],
        ["general"]
      )
    ).toEqual(["spirit-1", "spirit-2"]);
  });

  it("allows vanish-related filters to keep targeting a vanish-pending card", () => {
    const definition = createDemoSpiritDefinition();
    const vanishPendingCard = createCardInstance(definition, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      pendingLeaveKind: "vanish",
      pendingLeaveCause: "state_based_action",
      pendingLeaveChainId:
        "sba:1:alice:start:vanish_due_to_core_deficit:spirit-1",
    });

    expect(
      canCardBeAffectedByEffect(vanishPendingCard, ["leave_field_related"])
    ).toBe(true);
    expect(
      canCardBeAffectedByEffect(vanishPendingCard, ["suppress_effects"])
    ).toBe(true);
    expect(
      canCardBeAffectedByEffect(vanishPendingCard, ["vanish_related"])
    ).toBe(true);
    expect(
      getEffectFilterBlockReason(vanishPendingCard, ["vanish_related"])
    ).toBeNull();
  });

  it("blocks effects on cards in in_use zone", () => {
    const definition = createDemoSpiritDefinition();
    const inUseCard = createCardInstance(definition, {
      instanceId: "spirit-in-use",
      ownerPlayerId: "alice",
      zone: "in_use",
    });
    const fieldCard = createCardInstance(definition, {
      instanceId: "spirit-field",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [inUseCard, fieldCard],
    });

    expect(getEffectFilterBlockReason(inUseCard, ["general"])).toBe(
      "card_in_use_zone"
    );
    expect(canCardBeAffectedByEffect(inUseCard, ["general"])).toBe(false);
    expect(
      filterTargetCardInstanceIdsByEffectFilter(
        state,
        ["spirit-in-use", "spirit-field"],
        ["general"]
      )
    ).toEqual(["spirit-field"]);
  });
});

describe("rules-core cost reduction", () => {
  it("applies the maximum mandatory reduction from the acting player's field symbols", () => {
    const targetCard = createDemoCardDefinition({
      cardNo: "DEMO-MAGIC-TARGET",
      name: "Target Magic",
      printedCategory: "magic",
      cost: 5,
      reductionSymbols: ["red", "red", "white"],
    });
    const singleRedSpirit = createDemoCardDefinition({
      cardNo: "RED-SPIRIT-001",
      name: "Single Red Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const doubleRedSpirit = createDemoCardDefinition({
      cardNo: "RED-NEXUS-002",
      name: "Double Red Nexus",
      printedCategory: "nexus",
      symbolColors: ["red", "red"],
    });
    const whiteOpponentSpirit = createDemoCardDefinition({
      cardNo: "WHITE-SPIRIT-003",
      name: "White Opponent Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["white"],
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(singleRedSpirit, {
          instanceId: "alice-red-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(doubleRedSpirit, {
          instanceId: "alice-red-2",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(whiteOpponentSpirit, {
          instanceId: "bob-white-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: targetCard,
      getCardDefinitionById: createDefinitionLookup([
        targetCard,
        singleRedSpirit,
        doubleRedSpirit,
        whiteOpponentSpirit,
      ]),
    });

    expect(result.totalReduction).toBe(2);
    expect(result.reducedCost).toBe(3);
    expect(result.reductionBreakdown).toEqual([
      {
        color: "red",
        requested: 2,
        available: 3,
        applied: 2,
      },
      {
        color: "white",
        requested: 1,
        available: 0,
        applied: 0,
      },
    ]);
  });

  it("uses resolved battle entity symbols and does not count attached cards separately", () => {
    const targetCard = createDemoCardDefinition({
      cardNo: "DEMO-MAGIC-TARGET-2",
      name: "Target Magic 2",
      printedCategory: "magic",
      cost: 4,
      reductionSymbols: ["red", "white"],
    });
    const hostSpirit = createDemoCardDefinition({
      cardNo: "HOST-SPIRIT-001",
      name: "Host Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const attachedBrave = createDemoCardDefinition({
      cardNo: "ATTACHED-BRAVE-001",
      name: "Attached Brave",
      printedCategory: "brave",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(hostSpirit, {
          instanceId: "host-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(attachedBrave, {
          instanceId: "brave-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
          attachedToInstanceId: "host-1",
        }),
      ],
      battleEntities: [
        {
          entityId: "entity-1",
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["red", "white"],
          attackState: "idle",
        },
      ],
    });

    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: targetCard,
      getCardDefinitionById: createDefinitionLookup([
        targetCard,
        hostSpirit,
        attachedBrave,
      ]),
    });

    expect(result.totalReduction).toBe(2);
    expect(result.reducedCost).toBe(2);
    expect(result.fieldSymbolSources).toEqual([
      {
        sourceInstanceId: "host-1",
        sourceDefinitionId: "HOST-SPIRIT-001",
        via: "battle_entity",
        symbolColors: ["red", "white"] as CardColor[],
        symbolEntries: [{ colors: ["red"] }, { colors: ["white"] }],
      },
    ]);
  });

  it("never reduces below zero cost", () => {
    const targetCard = createDemoCardDefinition({
      cardNo: "DEMO-MAGIC-TARGET-3",
      name: "Target Magic 3",
      printedCategory: "magic",
      cost: 1,
      reductionSymbols: ["red", "red"],
    });
    const doubleRedSpirit = createDemoCardDefinition({
      cardNo: "DOUBLE-RED-SPIRIT-001",
      name: "Double Red Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red", "red"],
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(doubleRedSpirit, {
          instanceId: "double-red-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = calculateReduction({
      state,
      actingPlayerId: "alice",
      card: targetCard,
      getCardDefinitionById: createDefinitionLookup([
        targetCard,
        doubleRedSpirit,
      ]),
    });

    expect(result.totalReduction).toBe(2);
    expect(result.reducedCost).toBe(0);
  });
});

describe("rules-core payment system", () => {
  it("can apply reserve and field-card cost payments through the shared payment layer", () => {
    const paymentSpiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
          trashNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(paymentSpiritDefinition, {
          instanceId: "payment-spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const nextState = applyCardCostPayments({
      state,
      actingPlayerId: "alice",
      chainId: "summon:1:alice:main:payment-spirit-1",
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
        {
          kind: "card",
          instanceId: "payment-spirit-1",
          amount: 1,
        },
      ],
    });
    const alice = nextState.players.find((player) => player.id === "alice");
    const paymentSpirit = nextState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "payment-spirit-1"
    );

    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.trashNormalCoreCount).toBe(2);
    expect(paymentSpirit?.normalCoreCount).toBe(0);
    expect(paymentSpirit?.pendingLeaveKind).toBe("vanish");
    expect(paymentSpirit?.pendingLeaveCause).toBe("cost_payment");
    expect(paymentSpirit?.deferZoneMoveUntilChainEnd).toBe(true);
    expect(nextState.pendingLeaveEntities).toEqual([
      {
        instanceId: "payment-spirit-1",
        kind: "vanish",
        cause: "cost_payment",
        causePlayerId: null,
        chainId: "summon:1:alice:main:payment-spirit-1",
        deferZoneMoveUntilChainEnd: true,
        leaveFieldCoreDestinationOverride: null,
      },
    ]);
    expect(nextState.log).toContain(
      "pending-leave:vanish:payment-spirit-1:summon:1:alice:main:payment-spirit-1:cost_payment"
    );
  });
});

describe("rules-core magic action flow", () => {
  it("lists reserve, on-board cores, and soul-core-only payment candidates", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "MAGIC-PAY-001",
      name: "Payment Magic",
      printedCategory: "magic",
      cost: 5,
      reductionSymbols: ["red"],
    });
    const soulCoreSpirit = createDemoCardDefinition({
      cardNo: "SOUL-SPIRIT-001",
      name: "Soul Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const normalSpirit = createDemoCardDefinition({
      cardNo: "NORMAL-SPIRIT-001",
      name: "Normal Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["white"],
    });
    const pendingSpirit = createDemoCardDefinition({
      cardNo: "PENDING-SPIRIT-001",
      name: "Pending Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["green"],
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-pay-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(soulCoreSpirit, {
          instanceId: "soul-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
        createCardInstance(normalSpirit, {
          instanceId: "normal-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(pendingSpirit, {
          instanceId: "pending-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId:
            "sba:1:alice:start:vanish_due_to_core_deficit:pending-1",
        }),
      ],
    });
    const stateWithoutSoul = {
      ...baseState,
      players: baseState.players.map((player) =>
        player.id === "alice"
          ? { ...player, reserveNormalCoreCount: 2 }
          : player
      ),
    };
    const state = withSoulCoreLocation(stateWithoutSoul, "alice", {
      kind: "card",
      instanceId: "soul-1",
    });

    const result = getAvailableMagicPaymentSources({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "magic-pay-1",
      getCardDefinitionById: createDefinitionLookup([
        magicDefinition,
        soulCoreSpirit,
        normalSpirit,
        pendingSpirit,
      ]),
    });

    expect(result.reduction.reducedCost).toBe(4);
    expect(result.reserveSource).toEqual({
      kind: "reserve",
      availableCoreAmount: 2,
    });
    expect(result.onBoardCoreSources).toEqual([
      {
        kind: "card",
        instanceId: "soul-1",
        definitionId: "SOUL-SPIRIT-001",
        zoneRoleName: "spirit",
        availableCoreAmount: 3,
        soulCoreAvailable: true,
      },
      {
        kind: "card",
        instanceId: "normal-1",
        definitionId: "NORMAL-SPIRIT-001",
        zoneRoleName: "spirit",
        availableCoreAmount: 1,
        soulCoreAvailable: false,
      },
      // Ver.17.0: 待機状態 (state_based_action 消滅) のスピリットのコアも支払い源に含める。
      // cost_payment 由来でなければ除外しない。
      {
        kind: "card",
        instanceId: "pending-1",
        definitionId: "PENDING-SPIRIT-001",
        zoneRoleName: "spirit",
        availableCoreAmount: 3,
        soulCoreAvailable: false,
      },
    ]);
    expect(result.soulCoreOnlySources).toEqual([
      {
        kind: "card",
        instanceId: "soul-1",
        definitionId: "SOUL-SPIRIT-001",
        zoneRoleName: "spirit",
        availableSoulCoreAmount: 1,
      },
    ]);
    expect(result.totalAvailableCoreAmount).toBe(9);
    expect(result.canFullyPay).toBe(true);
  });

  it("runs one hand magic through declaration, frozen reduction, payment, effect, pending leaves, and trash move", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "MAGIC-001",
      name: "Test Magic",
      printedCategory: "magic",
      cost: 4,
      reductionSymbols: ["red"],
    });
    const supportSpirit = createDemoCardDefinition({
      cardNo: "SPIRIT-SUPPORT-001",
      name: "Support Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const targetSpirit = createDemoCardDefinition({
      cardNo: "SPIRIT-TARGET-001",
      name: "Target Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["white"],
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(supportSpirit, {
          instanceId: "support-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpirit, {
          instanceId: "target-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const getCardDefinitionById = createDefinitionLookup([
      magicDefinition,
      supportSpirit,
      targetSpirit,
    ]);

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "magic-1",
      targetInstanceIds: ["target-1"],
      paymentSources: [
        {
          kind: "reserve",
          amount: 2,
        },
        {
          kind: "card",
          instanceId: "support-1",
          amount: 1,
        },
      ],
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      resolveEffect: (currentState, context) => {
        expect(context.reduction.reducedCost).toBe(3);

        return {
          ...currentState,
          cardInstances: currentState.cardInstances.map((cardInstance) =>
            cardInstance.instanceId === "target-1"
              ? {
                  ...cardInstance,
                  normalCoreCount: 0,
                }
              : cardInstance
          ),
          log: [
            ...currentState.log,
            `magic:effect:${context.chainId}:target-1:-1core`,
          ],
        };
      },
    });

    const usedMagic = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "magic-1"
    );
    const supportAfterPayment = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "support-1"
    );
    const targetAfterEffect = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );
    const alice = result.state.players.find((player) => player.id === "alice");

    expect(result.reduction.reducedCost).toBe(3);
    expect(result.reduction.totalReduction).toBe(1);
    expect(alice ? getPlayerReserveCoreCount(alice) : null).toBe(2);
    expect(alice ? getPlayerTrashCoreCount(alice) : null).toBe(3);
    expect(usedMagic?.zone).toBe("trash");
    expect(usedMagic?.zoneRoleName).toBe("magic-card");
    expect(supportAfterPayment?.zone).toBe("trash");
    expect(supportAfterPayment?.pendingLeaveKind).toBeNull();
    expect(supportAfterPayment?.pendingLeaveCause).toBeNull();
    expect(targetAfterEffect?.zone).toBe("trash");
    expect(targetAfterEffect?.pendingLeaveKind).toBeNull();
    expect(result.state.pendingLeaveEntities).toEqual([]);
    expect(result.state.effectQueueSummary).toEqual([]);
    expect(result.state.log).toContain(`magic:reduction:${result.chainId}:3:1`);
    expect(result.state.log).toContain(
      `pending-leave:vanish:support-1:${result.chainId}:cost_payment`
    );
    expect(result.state.log).toContain(
      `pending-leave-flushed:vanish:support-1:${result.chainId}:cost_payment`
    );
    expect(result.state.log).toContain(
      "pending-leave-flushed:vanish:target-1:sba:1:alice:start:vanish_due_to_core_deficit:target-1:state_based_action"
    );
    expect(result.state.log).toContain(`magic:trash:${result.chainId}:magic-1`);
    expect(alice?.handCount).toBe(3); // decremented from 4 when magic moved to in_use
  });

  it("Ver.17.0: allows a general magic effect to target a vanish-pending card (unified with destroy)", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "MAGIC-BLOCK-001",
      name: "General Magic",
      printedCategory: "magic",
      cost: 2,
      reductionSymbols: [],
    });
    const pendingSpirit = createDemoCardDefinition({
      cardNo: "PENDING-SPIRIT-002",
      name: "Pending Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-block-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(pendingSpirit, {
          instanceId: "pending-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId:
            "sba:1:alice:start:vanish_due_to_core_deficit:pending-1",
        }),
      ],
    });
    const getCardDefinitionById = createDefinitionLookup([
      magicDefinition,
      pendingSpirit,
    ]);

    // Ver.17.0: 消滅待機でも general 効果を受けられる
    expect(() =>
      playMagicCardAsAction({
        state,
        actingPlayerId: "alice",
        magicInstanceId: "magic-block-1",
        targetInstanceIds: ["pending-1"],
        paymentSources: [
          {
            kind: "reserve",
            amount: 2,
          },
        ],
        getCardDefinitionById,
      })
    ).not.toThrow();
  });

  it("allows a leave-field-related magic effect to target a vanish-pending card", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "MAGIC-ALLOW-001",
      name: "Allowed Magic",
      printedCategory: "magic",
      cost: 2,
      reductionSymbols: [],
    });
    const pendingSpirit = createDemoCardDefinition({
      cardNo: "PENDING-SPIRIT-003",
      name: "Pending Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-allow-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(pendingSpirit, {
          instanceId: "pending-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId:
            "sba:1:alice:start:vanish_due_to_core_deficit:pending-1",
        }),
      ],
    });
    const getCardDefinitionById = createDefinitionLookup([
      magicDefinition,
      pendingSpirit,
    ]);

    expect(() =>
      playMagicCardAsAction({
        state,
        actingPlayerId: "alice",
        magicInstanceId: "magic-allow-1",
        targetInstanceIds: ["pending-1"],
        targetEffectFilterTags: ["leave_field_related"],
        paymentSources: [
          {
            kind: "reserve",
            amount: 2,
          },
        ],
        getCardDefinitionById,
      })
    ).not.toThrow();
  });
});

describe("rules-core core resource layer", () => {
  it("keeps removed-from-game separate from void for the soul core", () => {
    const definition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
      playerOverrides: [
        {
          soulCoreLocation: {
            kind: "card",
            instanceId: "spirit-1",
          },
        },
      ],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const moved = moveSoulCore(
      state,
      "alice",
      {
        kind: "card",
        instanceId: "spirit-1",
      },
      {
        kind: "removed_from_game",
      }
    );
    const alice = moved.players.find((player) => player.id === "alice");

    expect(alice?.soulCoreLocation).toEqual({
      kind: "removed_from_game",
    });
    expect(alice?.voidNormalCoreCount).toBe(0);
  });

  it("returns remaining field cores to reserve before trashing a vanished card", () => {
    const definition = createDemoSpiritDefinition();
    const chainId = "sba:1:alice:start:vanish_due_to_core_deficit:spirit-1";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "spirit-1",
          },
        },
      ],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId: chainId,
        }),
      ],
    });
    const pendingState = {
      ...state,
      pendingLeaveEntities: [
        {
          instanceId: "spirit-1",
          kind: "vanish" as const,
          cause: "state_based_action" as const,
          chainId,
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const flushed = flushPendingLeaves(pendingState);
    const alice = flushed.players.find((player) => player.id === "alice");
    const spirit = flushed.cardInstances[0];

    expect(alice?.reserveNormalCoreCount).toBe(2);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(spirit?.zone).toBe("trash");
    expect(spirit?.normalCoreCount).toBe(0);
    expect(getTotalCoresOnCardById(flushed, "spirit-1")).toBe(0);
  });

  it("refreshes trash normal cores and the soul core back to reserve", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          trashNormalCoreCount: 2,
          soulCoreLocation: {
            kind: "trash",
          },
        },
      ],
    });

    const refreshed = refreshTrashCoresToReserve(state, "alice");
    const alice = refreshed.players.find((player) => player.id === "alice");

    expect(alice?.reserveNormalCoreCount).toBe(2);
    expect(alice?.trashNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(getPlayerReserveCoreCount(alice!)).toBe(3);
    expect(getPlayerTrashCoreCount(alice!)).toBe(0);
  });

  it("lists both normal and soul choices for generic life moves to reserve", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 2,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
    });

    expect(
      getAvailableLifeCoreMoveChoices({
        state,
        playerId: "alice",
        destination: {
          kind: "reserve",
          playerId: "alice",
        },
      })
    ).toEqual([
      {
        coreKind: "normal",
        destination: {
          kind: "reserve",
          playerId: "alice",
        },
      },
      {
        coreKind: "soul",
        destination: {
          kind: "reserve",
          playerId: "alice",
        },
      },
    ]);
  });

  it("keeps generic life moves to void normal-only", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 2,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
    });

    expect(
      getAvailableLifeCoreMoveChoices({
        state,
        playerId: "alice",
        destination: {
          kind: "void",
          playerId: "alice",
        },
      })
    ).toEqual([
      {
        coreKind: "normal",
        destination: {
          kind: "void",
          playerId: "alice",
        },
      },
    ]);
  });

  it("moves the life soul core explicitly when the effect names the soul core", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 2,
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
    });

    const moved = moveLifeCoreByEffect({
      state,
      playerId: "alice",
      destination: {
        kind: "reserve",
        playerId: "alice",
      },
      effectKind: "explicit_soul_core",
    });
    const alice = moved.players.find((player) => player.id === "alice");

    expect(alice?.lifeNormalCoreCount).toBe(2);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "reserve",
    });
  });

  it("lets life damage honor a chosen soul-first sequence while keeping the old fallback", () => {
    const soulFirstState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 2,
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
    });

    const soulFirstResolved = resolveLifeDamage(soulFirstState, "alice", 2, [
      "soul",
      "normal",
    ]);
    const soulFirstAlice = soulFirstResolved.players.find(
      (player) => player.id === "alice"
    );

    expect(soulFirstAlice?.lifeNormalCoreCount).toBe(1);
    expect(soulFirstAlice?.reserveNormalCoreCount).toBe(1);
    expect(soulFirstAlice?.soulCoreLocation).toEqual({
      kind: "reserve",
    });

    const fallbackState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 2,
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
    });

    const fallbackResolved = resolveLifeDamage(fallbackState, "alice", 2);
    const fallbackAlice = fallbackResolved.players.find(
      (player) => player.id === "alice"
    );

    expect(fallbackAlice?.lifeNormalCoreCount).toBe(0);
    expect(fallbackAlice?.reserveNormalCoreCount).toBe(2);
    expect(fallbackAlice?.soulCoreLocation).toEqual({
      kind: "life",
    });
  });

  it("can route leave-field normal cores to void while keeping the soul core on the default reserve path", () => {
    const definition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "spirit-1",
          },
        },
      ],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    });

    const resolved = resolveCardLeavesFieldCores(state, "spirit-1", {
      normalCoreDestination: {
        kind: "void",
        playerId: "alice",
      },
    });
    const alice = resolved.players.find((player) => player.id === "alice");
    const spirit = resolved.cardInstances[0];

    expect(alice?.voidNormalCoreCount).toBe(2);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "reserve",
    });
    expect(spirit?.normalCoreCount).toBe(0);
  });

  it("uses pending-leave core destination overrides during flush", () => {
    const definition = createDemoSpiritDefinition();
    const chainId =
      "effect:1:alice:main:leave-field-trash-and-remove-soul:spirit-1";
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          trashNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "spirit-1",
          },
        },
      ],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "effect_resolution",
          pendingLeaveChainId: chainId,
        }),
      ],
    });
    const pendingState = {
      ...state,
      pendingLeaveEntities: [
        {
          instanceId: "spirit-1",
          kind: "vanish" as const,
          cause: "effect_resolution" as const,
          chainId,
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: {
            normalCoreDestination: {
              kind: "trash",
              playerId: "alice",
            },
            soulCoreDestination: {
              kind: "removed_from_game",
            },
          },
        },
      ],
    };

    const flushed = flushPendingLeaves(pendingState);
    const alice = flushed.players.find((player) => player.id === "alice");
    const spirit = flushed.cardInstances[0];

    expect(alice?.trashNormalCoreCount).toBe(2);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "removed_from_game",
    });
    expect(spirit?.zone).toBe("trash");
    expect(spirit?.normalCoreCount).toBe(0);
  });
});

describe("rules-core hand-written life-core resolvers", () => {
  it("uses a registered generic resolver to move a life normal core onto the target card", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "LIFE-TO-CARD-GENERIC-001",
      name: "Life To Card Generic",
      printedCategory: "magic",
      cost: 1,
      reductionSymbols: [],
    });
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 1,
        },
      ],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "magic-1",
      targetInstanceIds: ["spirit-1"],
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      getCardDefinitionById: createDefinitionLookup([
        magicDefinition,
        spiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LIFE-TO-CARD-GENERIC-001"
          ? createActingPlayerLifeCoreToTargetCardResolver()
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");
    const spirit = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "spirit-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(0);
    expect(spirit?.normalCoreCount).toBe(2);
    expect(result.state.log).toContain(
      `magic:effect:${result.chainId}:life-core-to-card:spirit-1:generic:auto`
    );
  });

  it("lets a direct magic action pass a chosen life-core kind into a generic resolver", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "LIFE-TO-CARD-GENERIC-CHOICE-001",
      name: "Life To Card Generic Choice",
      printedCategory: "magic",
      cost: 1,
      reductionSymbols: [],
    });
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "magic-1",
      targetInstanceIds: ["spirit-1"],
      chosenLifeCoreKind: "soul",
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      getCardDefinitionById: createDefinitionLookup([
        magicDefinition,
        spiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LIFE-TO-CARD-GENERIC-CHOICE-001"
          ? createActingPlayerLifeCoreToTargetCardResolver()
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "spirit-1",
    });
    expect(result.state.log).toContain(
      `magic:effect:${result.chainId}:life-core-to-card:spirit-1:generic:soul`
    );
  });

  it("uses a registered explicit soul-core resolver to move the life soul core onto the target card", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "LIFE-TO-CARD-SOUL-001",
      name: "Life To Card Soul",
      printedCategory: "magic",
      cost: 1,
      reductionSymbols: [],
    });
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "magic-1",
      targetInstanceIds: ["spirit-1"],
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      getCardDefinitionById: createDefinitionLookup([
        magicDefinition,
        spiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LIFE-TO-CARD-SOUL-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "explicit_soul_core",
            })
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "spirit-1",
    });
    expect(result.state.log).toContain(
      `magic:effect:${result.chainId}:life-core-to-card:spirit-1:explicit_soul_core:auto`
    );
  });

  it("uses a registered normal-only resolver to keep the life soul core untouched", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "LIFE-TO-CARD-NORMAL-ONLY-001",
      name: "Life To Card Normal Only",
      printedCategory: "magic",
      cost: 1,
      reductionSymbols: [],
    });
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "magic-1",
      targetInstanceIds: ["spirit-1"],
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      getCardDefinitionById: createDefinitionLookup([
        magicDefinition,
        spiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LIFE-TO-CARD-NORMAL-ONLY-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");
    const spirit = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "spirit-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "life",
    });
    expect(spirit?.normalCoreCount).toBe(2);
    expect(result.state.log).toContain(
      `magic:effect:${result.chainId}:life-core-to-card:spirit-1:normal_only:auto`
    );
  });

  it("runs the same hand-written resolver from a non-magic effect context", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "SPIRIT-SOURCE-001",
      name: "Spirit Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const sourceSpirit = createCardInstance(sourceSpiritDefinition, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        sourceSpirit,
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const context: EffectActionContext = {
      chainId: "spirit-effect:1:alice:main:source-1",
      actingPlayerId: "alice",
      sourceKind: "spirit",
      sourceCard: sourceSpirit,
      sourceDefinition: sourceSpiritDefinition,
      targetInstanceIds: ["target-1"],
    };

    const resolved = executeHandWrittenEffectResolver({
      state,
      context,
      getResolver: (cardNo) =>
        cardNo === "SPIRIT-SOURCE-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    });
    const alice = resolved.players.find((player) => player.id === "alice");
    const target = resolved.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "life",
    });
    expect(target?.normalCoreCount).toBe(2);
  });
});

describe("rules-core field card effect actions", () => {
  it("runs a spirit action flow through the shared hand-written resolver path", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "SPIRIT-ACTION-001",
      name: "Spirit Action",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: createDefinitionLookup([
        sourceSpiritDefinition,
        targetSpiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SPIRIT-ACTION-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");
    const target = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(0);
    expect(target?.normalCoreCount).toBe(2);
    expect(result.state.log).toContain(
      `effect:declare:${result.chainId}:source-1:SPIRIT-ACTION-001:spirit`
    );
  });

  it("runs a nexus action flow through the shared hand-written resolver path", () => {
    const sourceNexusDefinition = createDemoCardDefinition({
      cardNo: "NEXUS-ACTION-001",
      name: "Nexus Action",
      printedCategory: "nexus",
      symbolColors: ["white"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(sourceNexusDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "nexus",
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: createDefinitionLookup([
        sourceNexusDefinition,
        targetSpiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "NEXUS-ACTION-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "explicit_soul_core",
            })
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "target-1",
    });
    expect(result.state.log).toContain(
      `effect:declare:${result.chainId}:source-1:NEXUS-ACTION-001:nexus`
    );
  });

  it("runs a system action flow through the shared hand-written resolver path", () => {
    const sourceDefinition = createDemoCardDefinition({
      cardNo: "SYSTEM-ACTION-001",
      name: "System Action Proxy",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(sourceDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "system",
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: createDefinitionLookup([
        sourceDefinition,
        targetSpiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SYSTEM-ACTION-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");
    const target = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "life",
    });
    expect(target?.normalCoreCount).toBe(2);
    expect(result.state.log).toContain(
      `effect:declare:${result.chainId}:source-1:SYSTEM-ACTION-001:system`
    );
  });
});

describe("rules-core legal actions", () => {
  it("lists summon and place_nexus actions during the acting player's main step", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-001",
      name: "Legal Hand Spirit",
      printedCategory: "spirit",
      cost: 4,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const handNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-001",
      name: "Legal Hand Nexus",
      printedCategory: "nexus",
      cost: 3,
      reductionSymbols: ["red"],
      symbolColors: ["red"],
    });
    const supportSpiritDefinition = createDemoSpiritDefinition();
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 4,
        },
      ],
      cardInstances: [
        createCardInstance(handSpiritDefinition, {
          instanceId: "hand-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handNexusDefinition, {
          instanceId: "hand-nexus-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(supportSpiritDefinition, {
          instanceId: "support-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const state = {
      ...baseState,
      step: "main" as const,
      activePlayerId: "alice",
    };

    const legalActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: createDefinitionLookup([
        handSpiritDefinition,
        handNexusDefinition,
        supportSpiritDefinition,
      ]),
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    const summonAction = legalActions.find(
      (legalAction) => legalAction.kind === "summon"
    );
    const placeAction = legalActions.find(
      (legalAction) => legalAction.kind === "place_nexus"
    );

    expect(summonAction).toMatchObject({
      kind: "summon",
      can: true,
      reason: "legal_summon",
      sourceInstanceId: "hand-spirit-1",
      sourceCardNo: "LEGAL-HAND-SPIRIT-001",
      targetMode: "none",
      requiredTargetCount: 0,
      reducedCost: 3,
      totalReduction: 1,
      availableReserveCoreAmount: 4,
      minimumRequiredCores: 1,
    });
    expect(summonAction?.availableOnBoardCoreSources).toEqual([
      {
        kind: "card",
        instanceId: "support-1",
        definitionId: "DEMO-SPIRIT-001",
        zoneRoleName: "spirit",
        availableCoreAmount: 1,
        soulCoreAvailable: false,
      },
    ]);
    expect(placeAction).toMatchObject({
      kind: "place_nexus",
      can: true,
      reason: "legal_place_nexus",
      sourceInstanceId: "hand-nexus-1",
      sourceCardNo: "LEGAL-HAND-NEXUS-001",
      targetMode: "none",
      requiredTargetCount: 0,
      reducedCost: 2,
      totalReduction: 1,
      availableReserveCoreAmount: 4,
    });
  });

  it("does not list summon or place_nexus outside main step or without enough payment", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-REQ-001",
      name: "Legal Hand Spirit Required",
      printedCategory: "spirit",
      cost: 3,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const handNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-REQ-001",
      name: "Legal Hand Nexus Required",
      printedCategory: "nexus",
      cost: 2,
      reductionSymbols: [],
    });
    const definitionLookup = createDefinitionLookup([
      handSpiritDefinition,
      handNexusDefinition,
    ]);
    const stateOutsideMain = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(handSpiritDefinition, {
          instanceId: "hand-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handNexusDefinition, {
          instanceId: "hand-nexus-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const baseNoPaymentState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(handSpiritDefinition, {
          instanceId: "hand-spirit-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handNexusDefinition, {
          instanceId: "hand-nexus-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const noPaymentMainState = {
      ...baseNoPaymentState,
      step: "main" as const,
      activePlayerId: "alice",
    };

    const outsideMainActions = getLegalActions({
      state: stateOutsideMain,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    const noPaymentActions = getLegalActions({
      state: noPaymentMainState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    expect(
      outsideMainActions.filter(
        (legalAction) =>
          legalAction.kind === "summon" || legalAction.kind === "place_nexus"
      )
    ).toEqual([]);
    expect(
      noPaymentActions.filter(
        (legalAction) =>
          legalAction.kind === "summon" || legalAction.kind === "place_nexus"
      )
    ).toEqual([]);
  });

  it("lists registered field-card effect actions and filters candidate targets", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-SPIRIT-001",
      name: "Legal Spirit Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "pending-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId: "sba:demo:pending-1",
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "bob-target-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const state = { ...baseState, step: "main" as const };

    const legalActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: createDefinitionLookup([
        sourceSpiritDefinition,
        targetSpiritDefinition,
      ]),
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({
          "LEGAL-SPIRIT-001": [
            {
              sourceKind: "spirit",
              requiredTargetCount: 1,
              targetEffectFilterTags: ["general"],
              candidateTargetZones: ["field"],
              candidateTargetPlayerScope: "acting_player",
              reason: "demo_spirit_effect",
            },
            {
              sourceKind: "system",
              requiredTargetCount: 1,
              targetEffectFilterTags: ["general"],
              candidateTargetZones: ["field"],
              candidateTargetPlayerScope: "acting_player",
              reason: "demo_system_effect",
            },
          ],
        }),
    });
    const spiritAction = legalActions.find(
      (legalAction) =>
        legalAction.kind === "use_field_card_effect" &&
        legalAction.sourceKind === "spirit"
    );
    const systemAction = legalActions.find(
      (legalAction) =>
        legalAction.kind === "use_field_card_effect" &&
        legalAction.sourceKind === "system"
    );

    expect(spiritAction).toMatchObject({
      kind: "use_field_card_effect",
      can: true,
      sourceInstanceId: "source-1",
      sourceCardNo: "LEGAL-SPIRIT-001",
      reason: "demo_spirit_effect",
      targetMode: "manual",
      requiredTargetCount: 1,
    });
    expect(spiritAction?.candidateTargetInstanceIds).toContain("source-1");
    expect(spiritAction?.candidateTargetInstanceIds).toContain("target-1");
    // Ver.17.0: 消滅待機でも対象に含まれる（破壊待機と統一）
    expect(spiritAction?.candidateTargetInstanceIds).toContain("pending-1");
    expect(spiritAction?.candidateTargetInstanceIds).not.toContain(
      "bob-target-1"
    );
    expect(systemAction).toMatchObject({
      kind: "use_field_card_effect",
      can: true,
      sourceInstanceId: "source-1",
      sourceCardNo: "LEGAL-SPIRIT-001",
      reason: "demo_system_effect",
    });
  });

  it("blocks a once-per-turn field-card effect until the controller's next turn", () => {
    const sourceNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-FIELD-USAGE-LIMIT-001",
      name: "Legal Field Usage Limit",
      printedCategory: "nexus",
    });
    const definitionLookup = createDefinitionLookup([sourceNexusDefinition]);
    const fieldLookup = createFieldEffectActionRegistrationLookup({
      [sourceNexusDefinition.cardNo]: [
        {
          sourceKind: "nexus",
          reason: "once_per_turn_field_effect",
          usageLimit: {
            kind: "per_instance",
            duration: "turn",
          },
        },
      ],
    });
    const resolverLookup = (cardNo: string) =>
      cardNo === sourceNexusDefinition.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [...currentState.log, `field-usage-limit:resolved:${cardNo}`],
          })
        : undefined;
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(sourceNexusDefinition, {
            instanceId: "field-usage-limit-1",
            ownerPlayerId: "alice",
            zone: "field",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };

    const firstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_field_card_effect" &&
        legalAction.sourceInstanceId === "field-usage-limit-1"
    );

    const openedState = applyLegalAction({
      state,
      action: firstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;
    const afterUse = fullyResolveMainStepStack({
      state: openedState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
    });

    expect(
      getLegalActions({
        state: afterUse,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).some(
        (legalAction) =>
          legalAction.kind === "use_field_card_effect" &&
          legalAction.sourceInstanceId === "field-usage-limit-1"
      )
    ).toBe(false);

    let nextTurnMainState = afterUse;
    for (let guard = 0; guard < 81; guard += 1) {
      if (
        nextTurnMainState.turnNumber > afterUse.turnNumber &&
        nextTurnMainState.step === "main" &&
        nextTurnMainState.activePlayerId === "alice"
      ) {
        break;
      }
      nextTurnMainState = advanceStep(
        nextTurnMainState,
        definitionLookup,
        () => []
      );
      // start_step 誘発は本テストの関心外なのでクリア
      nextTurnMainState = { ...nextTurnMainState, pendingTriggeredEffects: [] };
    }

    expect(nextTurnMainState.turnNumber).toBeGreaterThan(afterUse.turnNumber);
    expect(nextTurnMainState.step).toBe("main");
    expect(
      getLegalActions({
        state: nextTurnMainState,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).find(
        (legalAction) =>
          legalAction.kind === "use_field_card_effect" &&
          legalAction.sourceInstanceId === "field-usage-limit-1"
      )
    ).toBeDefined();
  });

  it("blocks same-name magic reuse for the rest of the turn and allows it again on the controller's next turn", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-MAGIC-USAGE-LIMIT-001",
      name: "Legal Magic Usage Limit",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const definitionLookup = createDefinitionLookup([magicDefinition]);
    const magicLookup = createMagicActionRegistrationLookup({
      [magicDefinition.cardNo]: {
        timing: "main",
        reason: "once_per_turn_same_name_magic",
        usageLimit: {
          kind: "per_card_name",
          duration: "turn",
        },
      },
    });
    const resolverLookup = (cardNo: string) =>
      cardNo === magicDefinition.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [...currentState.log, `magic-usage-limit:resolved:${cardNo}`],
          })
        : undefined;
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(magicDefinition, {
            instanceId: "magic-usage-limit-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(magicDefinition, {
            instanceId: "magic-usage-limit-2",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };

    const firstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "magic-usage-limit-1"
    );

    const openedState = applyLegalAction({
      state,
      action: firstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredMagicActions: magicLookup,
    }).state;
    const resolvedState = fullyResolveMainStepStack({
      state: openedState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
    });

    expect(
      getLegalActions({
        state: resolvedState,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        getRegisteredMagicActions: magicLookup,
      }).some(
        (legalAction) =>
          legalAction.kind === "use_magic" &&
          legalAction.sourceInstanceId === "magic-usage-limit-2"
      )
    ).toBe(false);

    let nextAliceMainState = resolvedState;
    for (let guard = 0; guard < 81; guard += 1) {
      if (
        nextAliceMainState.turnNumber > resolvedState.turnNumber &&
        nextAliceMainState.step === "main" &&
        nextAliceMainState.activePlayerId === "alice"
      ) {
        break;
      }
      nextAliceMainState = advanceStep(
        nextAliceMainState,
        definitionLookup,
        () => []
      );
      // start_step 誘発は本テストの関心外なのでクリア
      nextAliceMainState = {
        ...nextAliceMainState,
        pendingTriggeredEffects: [],
      };
    }

    expect(nextAliceMainState.activePlayerId).toBe("alice");
    expect(nextAliceMainState.step).toBe("main");
    expect(
      getLegalActions({
        state: nextAliceMainState,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        getRegisteredMagicActions: magicLookup,
      }).find(
        (legalAction) =>
          legalAction.kind === "use_magic" &&
          legalAction.sourceInstanceId === "magic-usage-limit-2"
      )
    ).toBeDefined();
  });

  it("exposes when a legal field-card effect needs an explicit life-core choice", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-LIFE-CHOICE-001",
      name: "Legal Life Choice Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const state = { ...baseState, step: "main" as const };

    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: createDefinitionLookup([
        sourceSpiritDefinition,
        targetSpiritDefinition,
      ]),
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({
          "LEGAL-LIFE-CHOICE-001": [
            {
              sourceKind: "spirit",
              requiredTargetCount: 1,
              targetEffectFilterTags: ["general"],
              candidateTargetZones: ["field"],
              candidateTargetPlayerScope: "acting_player",
              actingPlayerLifeCoreChoice: {
                effectKind: "generic",
                destinationKind: "target_card",
              },
            },
          ],
        }),
    })[0];

    expect(action).toMatchObject({
      kind: "use_field_card_effect",
      requiredTargetCount: 1,
      requiresChosenLifeCoreKind: true,
      availableChosenLifeCoreKinds: ["normal", "soul"],
    });
  });

  it("applies a legal field-card effect action through the shared runner", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-SPIRIT-APPLY-001",
      name: "Legal Spirit Apply",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      sourceSpiritDefinition,
      targetSpiritDefinition,
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
          },
        ],
        cardInstances: [
          createCardInstance(sourceSpiritDefinition, {
            instanceId: "source-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({
          "LEGAL-SPIRIT-APPLY-001": [
            {
              sourceKind: "spirit",
              requiredTargetCount: 1,
              targetEffectFilterTags: ["general"],
              candidateTargetZones: ["field"],
              candidateTargetPlayerScope: "acting_player",
            },
          ],
        }),
    })[0];

    expect(action).toBeDefined();
    const fieldLookup = createFieldEffectActionRegistrationLookup({
      "LEGAL-SPIRIT-APPLY-001": [
        {
          sourceKind: "spirit",
          requiredTargetCount: 1,
          targetEffectFilterTags: ["general"],
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "acting_player",
        },
      ],
    });

    const openedState = applyLegalAction({
      state,
      action: action!,
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-SPIRIT-APPLY-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;

    expect(openedState.window).toBe("stack");

    // 1-pass cascade: bob がパス → 窓即クローズ + 効果解決（単一パスで完結）
    const resolvedState = applyLegalAction({
      state: openedState,
      action: getLegalActions({
        state: openedState,
        actingPlayerId: "bob",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).find((legalAction) => legalAction.kind === "pass_stack")!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-SPIRIT-APPLY-001"
          ? createActingPlayerLifeCoreToTargetCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;

    const alice = resolvedState.players.find((player) => player.id === "alice");
    const target = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(0);
    expect(target?.normalCoreCount).toBe(2);
    expect(
      resolvedState.log.some(
        (entry) =>
          entry.includes(`effect:declare:`) &&
          entry.includes(`:source-1:LEGAL-SPIRIT-APPLY-001:spirit`)
      )
    ).toBe(true);
  });

  it("applies a legal field-card effect action with an explicit life-core choice", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-LIFE-APPLY-001",
      name: "Legal Life Apply",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      sourceSpiritDefinition,
      targetSpiritDefinition,
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
            soulCoreLocation: {
              kind: "life",
            },
          },
        ],
        cardInstances: [
          createCardInstance(sourceSpiritDefinition, {
            instanceId: "source-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const fieldLookup = createFieldEffectActionRegistrationLookup({
      "LEGAL-LIFE-APPLY-001": [
        {
          sourceKind: "spirit",
          requiredTargetCount: 1,
          targetEffectFilterTags: ["general"],
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "acting_player",
          actingPlayerLifeCoreChoice: {
            effectKind: "generic",
            destinationKind: "target_card",
          },
        },
      ],
    });
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    })[0];

    const openedState = applyLegalAction({
      state,
      action: action!,
      targetInstanceIds: ["target-1"],
      chosenLifeCoreKind: "soul",
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-LIFE-APPLY-001"
          ? createActingPlayerLifeCoreToTargetCardResolver()
          : undefined,
    }).state;

    expect(openedState.window).toBe("stack");

    // 1-pass cascade: bob のパスで窓即クローズ + 効果解決
    const resolvedState = applyLegalAction({
      state: openedState,
      action: getLegalActions({
        state: openedState,
        actingPlayerId: "bob",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).find((legalAction) => legalAction.kind === "pass_stack")!,
      getCardDefinitionById: definitionLookup,
      chosenLifeCoreKind: "soul",
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-LIFE-APPLY-001"
          ? createActingPlayerLifeCoreToTargetCardResolver()
          : undefined,
    }).state;

    const alice = resolvedState.players.find((player) => player.id === "alice");

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "target-1",
    });
    expect(
      resolvedState.log.some(
        (entry) =>
          entry.includes(`magic:effect:`) &&
          entry.includes(`:life-core-to-card:target-1:generic:soul`)
      )
    ).toBe(true);
  });

  it("defers target selection to after the stack window (no longer requires explicit targets at declaration)", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-SPIRIT-TARGET-REQ-001",
      name: "Legal Spirit Target Required",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      sourceSpiritDefinition,
      targetSpiritDefinition,
    ]);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const state = { ...baseState, step: "main" as const };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({
          "LEGAL-SPIRIT-TARGET-REQ-001": [
            {
              sourceKind: "spirit",
              requiredTargetCount: 1,
              targetEffectFilterTags: ["general"],
              candidateTargetZones: ["field"],
              candidateTargetPlayerScope: "acting_player",
            },
          ],
        }),
    })[0];

    // ルール変更 (03a/08): スタック窓はコスト支払い後・対象選択前に開く。よって対象なしで
    // 宣言しても throw せず、宣言後にスタック窓を開いて対象選択を窓クローズ後へ延期する。
    const result = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: definitionLookup,
    });
    expect(result.state.stackWindow).not.toBeNull();
  });

  it("requires a life-core choice when the legal action reports multiple choices", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-LIFE-TARGET-REQ-001",
      name: "Legal Life Choice Required",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      sourceSpiritDefinition,
      targetSpiritDefinition,
    ]);
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const state = { ...baseState, step: "main" as const };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({
          "LEGAL-LIFE-TARGET-REQ-001": [
            {
              sourceKind: "spirit",
              requiredTargetCount: 1,
              targetEffectFilterTags: ["general"],
              candidateTargetZones: ["field"],
              candidateTargetPlayerScope: "acting_player",
              actingPlayerLifeCoreChoice: {
                effectKind: "generic",
                destinationKind: "target_card",
              },
            },
          ],
        }),
    })[0];

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        targetInstanceIds: ["target-1"],
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError(
      `Legal action requires a life-core choice: ${action?.actionId ?? "missing-action"}`
    );
  });

  it("applies summon through applyLegalAction with cost payment and enter-field placement", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-APPLY-001",
      name: "Legal Hand Spirit Apply",
      printedCategory: "spirit",
      cost: 2,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 3,
          trashNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(handSpiritDefinition, {
          instanceId: "hand-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const state = {
      ...baseState,
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([handSpiritDefinition]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "summon");

    const openedResult = applyLegalAction({
      state,
      action: action!,
      paymentSources: [
        {
          kind: "reserve",
          amount: 2,
        },
      ],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
    });
    const alice = resolvedState.players.find((player) => player.id === "alice");
    const summonedSpirit = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-spirit-1"
    );

    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.trashNormalCoreCount).toBe(2);
    expect(summonedSpirit?.zone).toBe("field");
    expect(summonedSpirit?.zoneRoleName).toBe("spirit");
    expect(summonedSpirit?.normalCoreCount).toBe(1);
    expect(resolvedState.log).toContain(
      `summon:declare:${openedResult.chainId}:hand-spirit-1:LEGAL-HAND-SPIRIT-APPLY-001`
    );
    expect(resolvedState.log).toContain(
      `summon:enter-field:${openedResult.chainId}:hand-spirit-1:1`
    );
  });

  it("applies place_nexus through applyLegalAction and allows zero enter-field cores", () => {
    const handNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-APPLY-001",
      name: "Legal Hand Nexus Apply",
      printedCategory: "nexus",
      cost: 1,
      reductionSymbols: [],
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
          trashNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(handNexusDefinition, {
          instanceId: "hand-nexus-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const state = {
      ...baseState,
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([handNexusDefinition]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    const openedResult = applyLegalAction({
      state,
      action: action!,
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
    });
    const alice = resolvedState.players.find((player) => player.id === "alice");
    const placedNexus = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
    );

    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.trashNormalCoreCount).toBe(1);
    expect(placedNexus?.zone).toBe("field");
    expect(placedNexus?.zoneRoleName).toBe("nexus");
    expect(placedNexus?.normalCoreCount).toBe(0);
    expect(resolvedState.log).toContain(
      `place_nexus:enter-field:${openedResult.chainId}:hand-nexus-1:0`
    );
  });

  it("runs summon resolver handling and chain cleanup through applyLegalAction", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-EFFECT-001",
      name: "Legal Hand Spirit Effect",
      printedCategory: "spirit",
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 2,
          reserveNormalCoreCount: 2,
          trashNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(handSpiritDefinition, {
          instanceId: "hand-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const state = {
      ...baseState,
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([handSpiritDefinition]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "summon");

    const openedResult = applyLegalAction({
      state,
      action: action!,
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-SPIRIT-EFFECT-001"
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-SPIRIT-EFFECT-001"
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    });
    const alice = resolvedState.players.find((player) => player.id === "alice");
    const summonedSpirit = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-spirit-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.trashNormalCoreCount).toBe(1);
    expect(summonedSpirit?.zone).toBe("field");
    expect(summonedSpirit?.normalCoreCount).toBe(2);
    expect(resolvedState.effectQueueSummary).toEqual([]);
    expect(resolvedState.log).toContain(
      `summon:resolve-main:start:${openedResult.chainId}`
    );
    expect(resolvedState.log).toContain(
      `magic:effect:${openedResult.chainId}:life-core-to-source-card:hand-spirit-1:normal_only:auto`
    );
    expect(resolvedState.log).toContain(
      `summon:resolve-main:end:${openedResult.chainId}`
    );
  });

  it("passes chosenLifeCoreKind into summon resolvers", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-SOUL-001",
      name: "Legal Hand Spirit Soul",
      printedCategory: "spirit",
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(handSpiritDefinition, {
          instanceId: "hand-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const state = {
      ...baseState,
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([handSpiritDefinition]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredHandCardEffectActions:
        createHandCardEffectActionRegistrationLookup({
          "LEGAL-HAND-SPIRIT-SOUL-001": {
            actingPlayerLifeCoreChoice: {
              effectKind: "generic",
              destinationKind: "source_card",
            },
          },
        }),
    }).find((legalAction) => legalAction.kind === "summon");

    expect(action).toMatchObject({
      kind: "summon",
      requiresChosenLifeCoreKind: true,
      availableChosenLifeCoreKinds: ["normal", "soul"],
    });

    const openedResult = applyLegalAction({
      state,
      action: action!,
      paymentSources: [],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 1,
        },
      ],
      chosenLifeCoreKind: "soul",
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-SPIRIT-SOUL-001"
          ? createActingPlayerLifeCoreToSourceCardResolver()
          : undefined,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-SPIRIT-SOUL-001"
          ? createActingPlayerLifeCoreToSourceCardResolver()
          : undefined,
    });
    const alice = resolvedState.players.find((player) => player.id === "alice");

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "hand-spirit-1",
    });
    expect(resolvedState.log).toContain(
      `magic:effect:${openedResult.chainId}:life-core-to-source-card:hand-spirit-1:generic:soul`
    );
  });

  it("lists targeted summon and place_nexus actions with legal candidates", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-TARGET-LIST-001",
      name: "Legal Hand Spirit Target List",
      printedCategory: "spirit",
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const handNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-TARGET-LIST-001",
      name: "Legal Hand Nexus Target List",
      printedCategory: "nexus",
      cost: 1,
      reductionSymbols: [],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      handSpiritDefinition,
      handNexusDefinition,
      targetSpiritDefinition,
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 3,
          },
        ],
        cardInstances: [
          createCardInstance(handSpiritDefinition, {
            instanceId: "hand-spirit-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(handNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "pending-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
            pendingLeaveKind: "vanish",
            pendingLeaveCause: "state_based_action",
            pendingLeaveChainId: "sba:demo:pending-1",
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "bob-target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };

    const legalActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredHandCardEffectActions:
        createHandCardEffectActionRegistrationLookup({
          "LEGAL-HAND-SPIRIT-TARGET-LIST-001": {
            requiredTargetCount: 1,
            targetEffectFilterTags: ["general"],
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "acting_player",
          },
          "LEGAL-HAND-NEXUS-TARGET-LIST-001": {
            requiredTargetCount: 1,
            targetEffectFilterTags: ["general"],
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "acting_player",
          },
        }),
    });
    const summonAction = legalActions.find(
      (legalAction) => legalAction.kind === "summon"
    );
    const placeAction = legalActions.find(
      (legalAction) => legalAction.kind === "place_nexus"
    );

    expect(summonAction).toMatchObject({
      kind: "summon",
      targetMode: "manual",
      requiredTargetCount: 1,
    });
    expect(summonAction?.candidateTargetInstanceIds).toContain("target-1");
    // Ver.17.0: 消滅待機でも対象に含まれる（破壊待機と統一）
    expect(summonAction?.candidateTargetInstanceIds).toContain("pending-1");
    expect(summonAction?.candidateTargetInstanceIds).not.toContain(
      "bob-target-1"
    );
    expect(placeAction).toMatchObject({
      kind: "place_nexus",
      targetMode: "manual",
      requiredTargetCount: 1,
    });
    expect(placeAction?.candidateTargetInstanceIds).toContain("target-1");
    // Ver.17.0: 消滅待機でも対象に含まれる（破壊待機と統一）
    expect(placeAction?.candidateTargetInstanceIds).toContain("pending-1");
  });

  it("passes summon targets through applyLegalAction into the resolver flow", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-TARGET-APPLY-001",
      name: "Legal Hand Spirit Target Apply",
      printedCategory: "spirit",
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      handSpiritDefinition,
      targetSpiritDefinition,
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 2,
          },
        ],
        cardInstances: [
          createCardInstance(handSpiritDefinition, {
            instanceId: "hand-spirit-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredHandCardEffectActions:
        createHandCardEffectActionRegistrationLookup({
          "LEGAL-HAND-SPIRIT-TARGET-APPLY-001": {
            requiredTargetCount: 1,
            targetEffectFilterTags: ["general"],
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "acting_player",
          },
        }),
    }).find((legalAction) => legalAction.kind === "summon");

    const openedResult = applyLegalAction({
      state,
      action: action!,
      targetInstanceIds: ["target-1"],
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-SPIRIT-TARGET-APPLY-001"
          ? createTargetCardPendingLeaveResolver()
          : undefined,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-SPIRIT-TARGET-APPLY-001"
          ? createTargetCardPendingLeaveResolver()
          : undefined,
    });
    const summonedSpirit = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-spirit-1"
    );
    const target = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(summonedSpirit?.zone).toBe("field");
    expect(target?.zone).toBe("trash");
    expect(resolvedState.log).toContain(
      `summon:targets:${openedResult.chainId}:target-1`
    );
    expect(resolvedState.log).toContain(
      `effect:resolver:${openedResult.chainId}:pending-leave:target-1:destroy`
    );
  });

  it("passes place_nexus targets through applyLegalAction into the resolver flow", () => {
    const handNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-TARGET-APPLY-001",
      name: "Legal Hand Nexus Target Apply",
      printedCategory: "nexus",
      cost: 1,
      reductionSymbols: [],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      handNexusDefinition,
      targetSpiritDefinition,
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 1,
          },
        ],
        cardInstances: [
          createCardInstance(handNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredHandCardEffectActions:
        createHandCardEffectActionRegistrationLookup({
          "LEGAL-HAND-NEXUS-TARGET-APPLY-001": {
            requiredTargetCount: 1,
            targetEffectFilterTags: ["general"],
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "acting_player",
          },
        }),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    const openedResult = applyLegalAction({
      state,
      action: action!,
      targetInstanceIds: ["target-1"],
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-NEXUS-TARGET-APPLY-001"
          ? createTargetCardPendingLeaveResolver()
          : undefined,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "LEGAL-HAND-NEXUS-TARGET-APPLY-001"
          ? createTargetCardPendingLeaveResolver()
          : undefined,
    });
    const placedNexus = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
    );
    const target = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(placedNexus?.zone).toBe("field");
    expect(target?.zone).toBe("trash");
    expect(resolvedState.log).toContain(
      `place_nexus:targets:${openedResult.chainId}:target-1`
    );
  });

  it("marks special nexus cards as forbidding enter-field core placements", () => {
    const specialNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-NO-CORES-001",
      name: "Legal Hand Nexus No Cores",
      printedCategory: "nexus",
      cost: 1,
      reductionSymbols: [],
      keywordTags: [ENTER_FIELD_CORE_PLACEMENT_FORBIDDEN_TAG],
    });
    const definitionLookup = createDefinitionLookup([specialNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 1,
          },
        ],
        cardInstances: [
          createCardInstance(specialNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(action).toMatchObject({
      kind: "place_nexus",
      enterFieldCorePlacementRule: "forbidden",
      minimumEnterFieldCoreCount: 0,
      requiresEnterFieldCorePlacements: false,
    });
  });

  it("rejects enter-field core placements for special nexus exceptions", () => {
    const specialNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-NO-CORES-APPLY-001",
      name: "Legal Hand Nexus No Cores Apply",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
      keywordTags: [ENTER_FIELD_CORE_PLACEMENT_FORBIDDEN_TAG],
    });
    const definitionLookup = createDefinitionLookup([specialNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 1,
          },
        ],
        cardInstances: [
          createCardInstance(specialNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        paymentSources: [],
        enterFieldCorePlacements: [
          {
            kind: "reserve_normal",
            amount: 1,
          },
        ],
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError("This card does not allow enter-field core placements");

    const openedResult = applyLegalAction({
      state,
      action: action!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
    });
    const placedNexus = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
    );

    expect(placedNexus?.zone).toBe("field");
    expect(placedNexus?.normalCoreCount).toBe(0);
  });

  it("surfaces keyword-tag enter-field placement policies in nexus legal actions", () => {
    const customNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-CUSTOM-PLACEMENT-001",
      name: "Legal Hand Nexus Custom Placement",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
      keywordTags: [
        "enter_field_core_placement_rule_required_minimum",
        "enter_field_core_placement_min_1",
        "enter_field_core_placement_max_1",
      ],
    });
    const definitionLookup = createDefinitionLookup([customNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 2,
          },
        ],
        cardInstances: [
          createCardInstance(customNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(action).toMatchObject({
      kind: "place_nexus",
      enterFieldCorePlacementRule: "required_minimum",
      minimumEnterFieldCoreCount: 1,
      maximumEnterFieldCoreCount: 1,
      requiresEnterFieldCorePlacements: true,
    });
  });

  it("enforces keyword-tag enter-field placement policy limits during place_nexus", () => {
    const customNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-CUSTOM-PLACEMENT-APPLY-001",
      name: "Legal Hand Nexus Custom Placement Apply",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
      keywordTags: [
        "enter_field_core_placement_rule_required_minimum",
        "enter_field_core_placement_min_1",
        "enter_field_core_placement_max_1",
      ],
    });
    const definitionLookup = createDefinitionLookup([customNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 2,
          },
        ],
        cardInstances: [
          createCardInstance(customNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        paymentSources: [],
        enterFieldCorePlacements: [
          {
            kind: "reserve_normal",
            amount: 2,
          },
        ],
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError("Too many enter-field cores selected: maximum=1 selected=2");

    const openedResult = applyLegalAction({
      state,
      action: action!,
      paymentSources: [],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
    });
    const placedNexus = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
    );

    expect(placedNexus?.zone).toBe("field");
    expect(placedNexus?.normalCoreCount).toBe(1);
  });

  it("uses the shared enter-field placement registry in legal action enumeration", () => {
    const customNexusDefinition = createDemoCardDefinition({
      cardNo: "DEMO-NEXUS-CUSTOM-PLACEMENT-001",
      name: "Demo Nexus Custom Placement",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
      keywordTags: [
        "enter_field_core_placement_rule_required_minimum",
        "enter_field_core_placement_min_1",
        "enter_field_core_placement_max_1",
      ],
    });
    const definitionLookup = createDefinitionLookup([customNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 2,
          },
        ],
        cardInstances: [
          createCardInstance(customNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(action).toMatchObject({
      kind: "place_nexus",
      enterFieldCorePlacementRule: "required_minimum",
      minimumEnterFieldCoreCount: 1,
      maximumEnterFieldCoreCount: 1,
      requiresEnterFieldCorePlacements: true,
    });
  });

  it("uses the shared enter-field placement registry in direct place_nexus execution", () => {
    const customNexusDefinition = createDemoCardDefinition({
      cardNo: "DEMO-NEXUS-CUSTOM-PLACEMENT-DIRECT-001",
      name: "Demo Nexus Custom Placement Direct",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
      keywordTags: [
        "enter_field_core_placement_rule_required_minimum",
        "enter_field_core_placement_min_1",
        "enter_field_core_placement_max_1",
      ],
    });
    const definitionLookup = createDefinitionLookup([customNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 2,
          },
        ],
        cardInstances: [
          createCardInstance(customNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };

    expect(() =>
      placeNexusAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: "hand-nexus-1",
        paymentSources: [],
        enterFieldCorePlacements: [
          {
            kind: "reserve_normal",
            amount: 2,
          },
        ],
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError("Too many enter-field cores selected: maximum=1 selected=2");

    const result = placeNexusAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-nexus-1",
      paymentSources: [],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
    });
    const placedNexus = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
    );

    expect(placedNexus?.zone).toBe("field");
    expect(placedNexus?.normalCoreCount).toBe(1);
  });

  it.each([
    ["BS58-X09", "Official Grandwalker Parvati Example"],
    ["BS61-X09", "Official Grandwalker Tezcatlipoca Example"],
    ["BS58-071(A)", "Official Granstone Parvati Example"],
    ["BS59-071(A)", "Registry Granstone Example"],
  ])(
    "treats %s as a shared forbidden enter-field placement card in legal actions",
    (cardNo, name) => {
      const forbiddenNexusDefinition = createDemoCardDefinition({
        cardNo,
        name,
        printedCategory: "nexus",
        cost: 0,
        reductionSymbols: [],
        keywordTags: ["enter_field_core_placement_forbidden"],
      });
      const definitionLookup = createDefinitionLookup([
        forbiddenNexusDefinition,
      ]);
      const state = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            {
              reserveNormalCoreCount: 1,
            },
          ],
          cardInstances: [
            createCardInstance(forbiddenNexusDefinition, {
              instanceId: "hand-nexus-1",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
          ],
        }),
        step: "main" as const,
        activePlayerId: "alice",
      };
      const action = getLegalActions({
        state,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).find((legalAction) => legalAction.kind === "place_nexus");

      expect(action).toMatchObject({
        kind: "place_nexus",
        enterFieldCorePlacementRule: "forbidden",
        minimumEnterFieldCoreCount: 0,
        maximumEnterFieldCoreCount: 0,
        requiresEnterFieldCorePlacements: false,
      });
    }
  );

  it.each([
    ["BS58-X09", "Official Grandwalker Parvati Example Apply"],
    ["BS59-X09", "Official Grandwalker Chronos Example Apply"],
    ["BS58-071(A)", "Official Granstone Parvati Example Apply"],
    ["BS59-071(A)", "Official Granstone Chronos Example Apply"],
  ])(
    "rejects enter-field core placements for shared forbidden card %s during direct place_nexus execution",
    (cardNo, name) => {
      const forbiddenNexusDefinition = createDemoCardDefinition({
        cardNo,
        name,
        printedCategory: "nexus",
        cost: 0,
        reductionSymbols: [],
        keywordTags: ["enter_field_core_placement_forbidden"],
      });
      const definitionLookup = createDefinitionLookup([
        forbiddenNexusDefinition,
      ]);
      const state = {
        ...createEmptyGameState({
          playerIds: ["alice", "bob"],
          playerOverrides: [
            {
              reserveNormalCoreCount: 1,
            },
          ],
          cardInstances: [
            createCardInstance(forbiddenNexusDefinition, {
              instanceId: "hand-nexus-1",
              ownerPlayerId: "alice",
              zone: "hand",
            }),
          ],
        }),
        step: "main" as const,
        activePlayerId: "alice",
      };

      expect(() =>
        placeNexusAsAction({
          state,
          actingPlayerId: "alice",
          cardInstanceId: "hand-nexus-1",
          paymentSources: [],
          enterFieldCorePlacements: [
            {
              kind: "reserve_normal",
              amount: 1,
            },
          ],
          getCardDefinitionById: definitionLookup,
        })
      ).toThrowError("This card does not allow enter-field core placements");

      const result = placeNexusAsAction({
        state,
        actingPlayerId: "alice",
        cardInstanceId: "hand-nexus-1",
        paymentSources: [],
        getCardDefinitionById: definitionLookup,
      });
      const placedNexus = result.state.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
      );

      expect(placedNexus?.zone).toBe("field");
      expect(placedNexus?.normalCoreCount).toBe(0);
    }
  );

  it("surfaces keyword-tag enter-field placement policies in nexus legal actions", () => {
    const taggedNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-TAG-PLACEMENT-001",
      name: "Legal Hand Nexus Tag Placement",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
      keywordTags: [
        `${ENTER_FIELD_CORE_PLACEMENT_RULE_TAG_PREFIX}required_minimum`,
        `${ENTER_FIELD_CORE_PLACEMENT_MIN_TAG_PREFIX}2`,
        `${ENTER_FIELD_CORE_PLACEMENT_MAX_TAG_PREFIX}2`,
      ],
    });
    const definitionLookup = createDefinitionLookup([taggedNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 2,
          },
        ],
        cardInstances: [
          createCardInstance(taggedNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(action).toMatchObject({
      kind: "place_nexus",
      enterFieldCorePlacementRule: "required_minimum",
      minimumEnterFieldCoreCount: 2,
      maximumEnterFieldCoreCount: 2,
      requiresEnterFieldCorePlacements: true,
    });
  });

  it("enforces keyword-tag enter-field placement policy limits during place_nexus", () => {
    const taggedNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-TAG-PLACEMENT-APPLY-001",
      name: "Legal Hand Nexus Tag Placement Apply",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
      keywordTags: [
        `${ENTER_FIELD_CORE_PLACEMENT_RULE_TAG_PREFIX}required_minimum`,
        `${ENTER_FIELD_CORE_PLACEMENT_MIN_TAG_PREFIX}2`,
        `${ENTER_FIELD_CORE_PLACEMENT_MAX_TAG_PREFIX}2`,
      ],
    });
    const definitionLookup = createDefinitionLookup([taggedNexusDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 2,
          },
        ],
        cardInstances: [
          createCardInstance(taggedNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        paymentSources: [],
        enterFieldCorePlacements: [
          {
            kind: "reserve_normal",
            amount: 1,
          },
        ],
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError(
      "Not enough enter-field cores selected: required=2 selected=1"
    );

    const openedResult = applyLegalAction({
      state,
      action: action!,
      paymentSources: [],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 2,
        },
      ],
      getCardDefinitionById: definitionLookup,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: openedResult.state,
      getCardDefinitionById: definitionLookup,
    });
    const placedNexus = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
    );

    expect(placedNexus?.zone).toBe("field");
    expect(placedNexus?.normalCoreCount).toBe(2);
  });

  it("requires explicit targets for targeted hand-card legal actions", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-TARGET-REQ-001",
      name: "Legal Hand Spirit Target Required",
      printedCategory: "spirit",
      cost: 0,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      handSpiritDefinition,
      targetSpiritDefinition,
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 1,
          },
        ],
        cardInstances: [
          createCardInstance(handSpiritDefinition, {
            instanceId: "hand-spirit-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredHandCardEffectActions:
        createHandCardEffectActionRegistrationLookup({
          "LEGAL-HAND-SPIRIT-TARGET-REQ-001": {
            requiredTargetCount: 1,
            targetEffectFilterTags: ["general"],
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "acting_player",
          },
        }),
    }).find((legalAction) => legalAction.kind === "summon");

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        paymentSources: [],
        enterFieldCorePlacements: [
          {
            kind: "reserve_normal",
            amount: 1,
          },
        ],
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError(
      `Legal action requires targets: ${action?.actionId ?? "missing-action"}`
    );
  });

  it("rejects non-candidate targets for targeted hand-card legal actions", () => {
    const handNexusDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-NEXUS-TARGET-INVALID-001",
      name: "Legal Hand Nexus Target Invalid",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      handNexusDefinition,
      targetSpiritDefinition,
    ]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(handNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "bob-target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredHandCardEffectActions:
        createHandCardEffectActionRegistrationLookup({
          "LEGAL-HAND-NEXUS-TARGET-INVALID-001": {
            requiredTargetCount: 1,
            targetEffectFilterTags: ["general"],
            candidateTargetZones: ["field"],
            candidateTargetPlayerScope: "acting_player",
          },
        }),
    }).find((legalAction) => legalAction.kind === "place_nexus");

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        targetInstanceIds: ["bob-target-1"],
        paymentSources: [],
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError(
      `Target is not a legal candidate for action ${action?.actionId ?? "missing-action"}: bob-target-1`
    );
  });

  it("requires payment sources and defers summon enter-field cores until after the stack", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "LEGAL-HAND-SPIRIT-REQ-APPLY-001",
      name: "Legal Hand Spirit Apply Required",
      printedCategory: "spirit",
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const baseState = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 2,
        },
      ],
      cardInstances: [
        createCardInstance(handSpiritDefinition, {
          instanceId: "hand-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });
    const state = {
      ...baseState,
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([handSpiritDefinition]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "summon");

    expect(() =>
      applyLegalAction({
        state,
        action: action!,
        getCardDefinitionById: definitionLookup,
      })
    ).toThrowError(
      `Legal action requires payment sources: ${action?.actionId ?? "missing-action"}`
    );
    const opened = applyLegalAction({
      state,
      action: action!,
      paymentSources: [
        {
          kind: "reserve",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions: () => [],
    }).state;
    expect(opened.window).toBe("stack");
    expect(opened.pendingEnterFieldPlacement).toBeNull();
    expect(
      opened.cardInstances.find((card) => card.instanceId === "hand-spirit-1")
        ?.zone
    ).toBe("in_use");
  });
});

describe("rules-core hand-card action pending-leave handling", () => {
  it("keeps cost-payment vanish pending during summon resolution and flushes it at chain end", () => {
    const handSpiritDefinition = createDemoCardDefinition({
      cardNo: "SUMMON-PENDING-LEAVE-001",
      name: "Summon Pending Leave",
      printedCategory: "spirit",
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    });
    const supportSpiritDefinition = createDemoSpiritDefinition();
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 1,
            trashNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(handSpiritDefinition, {
            instanceId: "hand-spirit-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(supportSpiritDefinition, {
            instanceId: "support-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      handSpiritDefinition,
      supportSpiritDefinition,
      targetSpiritDefinition,
    ]);

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-spirit-1",
      paymentSources: [
        {
          kind: "card",
          instanceId: "support-1",
          amount: 1,
        },
      ],
      enterFieldCorePlacements: [
        {
          kind: "reserve_normal",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions: () => [],
      resolveEffect: (currentState, context) => {
        const supportDuringResolve = currentState.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === "support-1"
        );
        const targetDuringResolve = currentState.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === "target-1"
        );

        expect(supportDuringResolve?.zone).toBe("field");
        expect(supportDuringResolve?.pendingLeaveKind).toBe("vanish");
        expect(supportDuringResolve?.pendingLeaveCause).toBe("cost_payment");
        expect(supportDuringResolve?.pendingLeaveChainId).toBe(context.chainId);
        expect(currentState.pendingLeaveEntities).toEqual([
          {
            instanceId: "support-1",
            kind: "vanish",
            cause: "cost_payment",
            causePlayerId: null,
            chainId: context.chainId,
            deferZoneMoveUntilChainEnd: true,
            leaveFieldCoreDestinationOverride: null,
          },
        ]);
        expect(currentState.effectQueueSummary).toEqual([
          `resolve[chain:${context.chainId}]:main`,
        ]);
        expect(targetDuringResolve?.zone).toBe("field");

        return {
          ...currentState,
          cardInstances: currentState.cardInstances.map((cardInstance) =>
            cardInstance.instanceId === "target-1"
              ? {
                  ...cardInstance,
                  normalCoreCount: 0,
                }
              : cardInstance
          ),
          log: [
            ...currentState.log,
            `summon:effect:${context.chainId}:target-1:-1core`,
          ],
        };
      },
    });
    const summonedSpirit = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-spirit-1"
    );
    const supportAfterResolve = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "support-1"
    );
    const targetAfterResolve = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(summonedSpirit?.zone).toBe("field");
    expect(summonedSpirit?.normalCoreCount).toBe(1);
    expect(supportAfterResolve?.zone).toBe("trash");
    expect(supportAfterResolve?.pendingLeaveKind).toBeNull();
    expect(targetAfterResolve?.zone).toBe("trash");
    expect(result.state.pendingLeaveEntities).toEqual([]);
    expect(result.state.effectQueueSummary).toEqual([]);
    expect(result.state.log).toContain(
      `pending-leave:vanish:support-1:${result.chainId}:cost_payment`
    );
    expect(result.state.log).toContain(
      `pending-leave-flushed:vanish:support-1:${result.chainId}:cost_payment`
    );
    expect(result.state.log).toContain(
      `summon:resolve-main:end:${result.chainId}`
    );
    const aliceAfter = result.state.players.find((p) => p.id === "alice");
    expect(aliceAfter?.handCount).toBe(3); // decremented from 4 when spirit moved to in_use
  });

  it("keeps cost-payment vanish pending during place_nexus resolution and flushes it at chain end", () => {
    const handNexusDefinition = createDemoCardDefinition({
      cardNo: "PLACE-PENDING-LEAVE-001",
      name: "Place Pending Leave",
      printedCategory: "nexus",
      cost: 1,
      reductionSymbols: [],
    });
    const supportSpiritDefinition = createDemoSpiritDefinition();
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            reserveNormalCoreCount: 0,
            trashNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(handNexusDefinition, {
            instanceId: "hand-nexus-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(supportSpiritDefinition, {
            instanceId: "support-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetSpiritDefinition, {
            instanceId: "target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      handNexusDefinition,
      supportSpiritDefinition,
      targetSpiritDefinition,
    ]);

    const result = placeNexusAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-nexus-1",
      paymentSources: [
        {
          kind: "card",
          instanceId: "support-1",
          amount: 1,
        },
      ],
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions: () => [],
      resolveEffect: (currentState, context) => {
        const supportDuringResolve = currentState.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === "support-1"
        );

        expect(supportDuringResolve?.zone).toBe("field");
        expect(supportDuringResolve?.pendingLeaveKind).toBe("vanish");
        expect(supportDuringResolve?.pendingLeaveCause).toBe("cost_payment");
        expect(currentState.pendingLeaveEntities).toEqual([
          {
            instanceId: "support-1",
            kind: "vanish",
            cause: "cost_payment",
            causePlayerId: null,
            chainId: context.chainId,
            deferZoneMoveUntilChainEnd: true,
            leaveFieldCoreDestinationOverride: null,
          },
        ]);

        return {
          ...currentState,
          cardInstances: currentState.cardInstances.map((cardInstance) =>
            cardInstance.instanceId === "target-1"
              ? {
                  ...cardInstance,
                  normalCoreCount: 0,
                }
              : cardInstance
          ),
          log: [
            ...currentState.log,
            `place_nexus:effect:${context.chainId}:target-1:-1core`,
          ],
        };
      },
    });
    const placedNexus = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "hand-nexus-1"
    );
    const supportAfterResolve = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "support-1"
    );
    const targetAfterResolve = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(placedNexus?.zone).toBe("field");
    expect(placedNexus?.normalCoreCount).toBe(0);
    expect(supportAfterResolve?.zone).toBe("trash");
    expect(supportAfterResolve?.pendingLeaveKind).toBeNull();
    expect(targetAfterResolve?.zone).toBe("trash");
    expect(result.state.pendingLeaveEntities).toEqual([]);
    expect(result.state.effectQueueSummary).toEqual([]);
    expect(result.state.log).toContain(
      `pending-leave:vanish:support-1:${result.chainId}:cost_payment`
    );
    expect(result.state.log).toContain(
      `pending-leave-flushed:vanish:support-1:${result.chainId}:cost_payment`
    );
    expect(result.state.log).toContain(
      `place_nexus:resolve-main:end:${result.chainId}`
    );
  });
});

describe("rules-core shared action main resolution", () => {
  it("keeps pre-existing cost-payment vanish pending during a generic action and flushes it at chain end", () => {
    const sourceSpiritDefinition = createDemoSpiritDefinition();
    const supportSpiritDefinition = createDemoSpiritDefinition();
    const chainId = "battle:1:alice:attack:support-1";
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(sourceSpiritDefinition, {
            instanceId: "source-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(supportSpiritDefinition, {
            instanceId: "support-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
            pendingLeaveKind: "vanish",
            pendingLeaveCause: "cost_payment",
            pendingLeaveChainId: chainId,
            deferZoneMoveUntilChainEnd: true,
          }),
        ],
      }),
      pendingLeaveEntities: [
        {
          instanceId: "support-1",
          kind: "vanish",
          cause: "cost_payment",
          causePlayerId: null,
          chainId,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const resultState = runActionMainResolution({
      state,
      chainId,
      context: {
        chainId,
        resolutionKind: "battle_immediate_effect" as const,
        actingPlayerId: "alice",
        sourceKind: "spirit" as const,
        sourceCard: state.cardInstances[0]!,
        sourceDefinition: sourceSpiritDefinition,
        targetInstanceIds: [],
        getCardDefinitionById: () => sourceSpiritDefinition,
        getRegisteredTriggeredEffectActions: () => [],
      },
      startLogs: [
        `battle:declare:${chainId}:source-1`,
        `battle:resolve-main:start:${chainId}`,
      ],
      endLogs: [
        `battle:resolve-main:end:${chainId}`,
        `battle:resolve-derived:end:${chainId}`,
      ],
      resolveEffect: (currentState) => {
        const supportDuringResolve = currentState.cardInstances.find(
          (cardInstance) => cardInstance.instanceId === "support-1"
        );

        expect(supportDuringResolve?.zone).toBe("field");
        expect(supportDuringResolve?.pendingLeaveKind).toBe("vanish");
        expect(currentState.pendingLeaveEntities).toEqual([
          {
            instanceId: "support-1",
            kind: "vanish",
            cause: "cost_payment",
            causePlayerId: null,
            chainId,
            deferZoneMoveUntilChainEnd: true,
            leaveFieldCoreDestinationOverride: null,
          },
        ]);
        expect(currentState.effectQueueSummary).toEqual([
          `resolve[chain:${chainId}]:main`,
        ]);

        return {
          ...currentState,
          log: [...currentState.log, `battle:effect:${chainId}:noop`],
        };
      },
    });
    const supportAfterResolve = resultState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "support-1"
    );

    expect(supportAfterResolve?.zone).toBe("trash");
    expect(supportAfterResolve?.pendingLeaveKind).toBeNull();
    expect(resultState.pendingLeaveEntities).toEqual([]);
    expect(resultState.effectQueueSummary).toEqual([]);
    expect(resultState.log).toContain(
      `pending-leave-flushed:vanish:support-1:${chainId}:cost_payment`
    );
    expect(resultState.log).toContain(`battle:resolve-main:end:${chainId}`);
  });
});

describe("rules-core pending reaction queues", () => {
  it("does not queue listenerless reactions after life reduction from a generic action", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "TRIGGER-SOURCE-001",
      name: "Trigger Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([sourceSpiritDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          reserveNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });
    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "spirit",
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions:
        createTriggeredEffectActionRegistrationLookup({}),
      getRegisteredBurstActions: createBurstActionRegistrationLookup({}),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === sourceSpiritDefinition.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver()
          : undefined,
    });

    expect(result.state.pendingTriggeredEffects).toEqual([]);
    expect(result.state.pendingBurstChecks).toEqual([]);
    expect(
      getLegalActions({
        state: result.state,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).some(
        (legalAction) => legalAction.kind === "resolve_pending_burst_check"
      )
    ).toBe(false);
    expect(
      getLegalActions({
        state: result.state,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).some(
        (legalAction) => legalAction.kind === "resolve_pending_triggered_effect"
      )
    ).toBe(false);
  });

  it("queues battle-resolution life-reduced and card-destroyed reactions before progressing", () => {
    const strongAttackerDefinition = createDemoCardDefinition({
      cardNo: "ATTACKER-STRONG-TRIGGER-001",
      name: "Strong Attacker Trigger",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const weakAttackerDefinition = createDemoCardDefinition({
      cardNo: "ATTACKER-WEAK-TRIGGER-001",
      name: "Weak Attacker Trigger",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const weakBlockerDefinition = createDemoCardDefinition({
      cardNo: "BLOCKER-WEAK-TRIGGER-001",
      name: "Weak Blocker Trigger",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    });
    const battleTriggerSourceDefinition = createDemoCardDefinition({
      cardNo: "BATTLE-REACTION-SOURCE-001",
      name: "Battle Reaction Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([
      strongAttackerDefinition,
      weakAttackerDefinition,
      weakBlockerDefinition,
      battleTriggerSourceDefinition,
    ]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [battleTriggerSourceDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            reason: "battle_life_reduced_trigger",
          },
          {
            sourceKind: "spirit",
            eventKind: "destroy",
            eventMatcher: { family: "leave_field", causeKind: "destroy" },
            reason: "battle_destroy_trigger",
          },
        ],
      });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 5,
            reserveNormalCoreCount: 0,
          },
          {
            lifeNormalCoreCount: 2,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(strongAttackerDefinition, {
            instanceId: "attacker-trigger-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(weakAttackerDefinition, {
            instanceId: "attacker-trigger-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(weakBlockerDefinition, {
            instanceId: "blocker-trigger-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(battleTriggerSourceDefinition, {
            instanceId: "battle-reaction-source-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-trigger-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackedState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-trigger-2",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyToBlockState = closeAvailableBattleFlashWindow(
      joinedState,
      definitionLookup
    );
    const blockAction = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: readyToBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup
    );
    // P3-55 Phase B: after_block flash close で auto-chain によりバトル解決まで完了する
    const resolvedState = closeAvailableBattleFlashWindow(
      blockedState,
      definitionLookup,
      { getRegisteredTriggeredEffectActions }
    );

    expect(resolvedState.pendingTriggeredEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "reduce_life",
          event: {
            family: "life",
            validationMode: "snapshot_only",
            cause: "battle",
          },
          source: "battle_resolution",
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
          amount: 1,
        }),
        expect.objectContaining({
          eventKind: "destroy",
          event: expect.objectContaining({
            family: "leave_field",
            causeKind: "destroy",
            cause: "battle",
            validationMode: "snapshot_only",
            effectSourceInstanceId: "attacker-trigger-1",
          }),
          source: "battle_resolution",
          actingPlayerId: "bob",
          relatedInstanceId: "blocker-trigger-1",
          effectSourceInstanceId: "attacker-trigger-1",
        }),
      ])
    );
    expect(resolvedState.pendingBurstChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "reduce_life",
          event: {
            family: "life",
            validationMode: "snapshot_only",
            cause: "battle",
          },
          source: "battle_resolution",
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
          amount: 1,
        }),
      ])
    );
    // life_reduced + leave_field (from card_destroyed)
    expect(resolvedState.pendingBurstChecks.length).toBeGreaterThanOrEqual(1);

    const aliceActions = getLegalActions({
      state: resolvedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    const bobActions = getLegalActions({
      state: resolvedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    expect(aliceActions).toEqual([]);
    expect(
      bobActions.every(
        (legalAction) => legalAction.kind === "resolve_pending_burst_check"
      )
    ).toBe(true);
    expect(bobActions.length).toBeGreaterThanOrEqual(1);

    const settledState = drainPendingReactions(
      resolvedState,
      definitionLookup,
      {
        getRegisteredTriggeredEffectActions,
      }
    );
    expect(settledState.pendingBurstChecks).toEqual([]);
    expect(settledState.pendingTriggeredEffects).toEqual([]);
  });

  it("resolves battle-queued pending triggers before burst checks through source-backed legal actions", () => {
    const attackerDefinition = createDemoSpiritDefinition();
    const triggerSourceDefinition = createDemoCardDefinition({
      cardNo: "BATTLE-TRIGGER-SOURCE-001",
      name: "Battle Trigger Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const burstSourceDefinition = createDemoCardDefinition({
      cardNo: "BATTLE-BURST-SOURCE-001",
      name: "Battle Burst Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const definitionLookup = createDefinitionLookup([
      attackerDefinition,
      triggerSourceDefinition,
      burstSourceDefinition,
    ]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            reason: "legal_battle_life_reduced_trigger",
          },
        ],
      });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSourceDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          reason: "legal_battle_life_reduced_burst",
        },
      ],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 5,
            reserveNormalCoreCount: 0,
          },
          {
            lifeNormalCoreCount: 2,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(attackerDefinition, {
            instanceId: "battle-attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(triggerSourceDefinition, {
            instanceId: "battle-trigger-source-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(burstSourceDefinition, {
            instanceId: "battle-burst-source-1",
            ownerPlayerId: "bob",
            zone: "burst",
          }),
        ],
        setBurstStates: [
          {
            playerId: "bob",
            cardInstanceId: "battle-burst-source-1",
          },
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "battle-attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyForResolutionState = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup,
      { getRegisteredTriggeredEffectActions, getRegisteredBurstActions }
    );
    // P3-55 Phase B: ブロック宣言なしのケースでは defender (bob) の decline_block apply で
    // バトル解決まで一括完了する。
    const declineAction = getLegalActions({
      state: readyForResolutionState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "decline_block");
    const battleResolvedState = applyLegalAction({
      state: readyForResolutionState,
      action: declineAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).state;

    expect(battleResolvedState.window).toBe("none");
    expect(battleResolvedState.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        eventKind: "reduce_life",
        source: "battle_resolution",
        actingPlayerId: "bob",
        relatedPlayerId: "bob",
        amount: 1,
      }),
    ]);
    expect(battleResolvedState.pendingBurstChecks).toEqual([
      expect.objectContaining({
        eventKind: "reduce_life",
        source: "battle_resolution",
        actingPlayerId: "bob",
        relatedPlayerId: "bob",
        amount: 1,
      }),
    ]);

    const burstActions = getLegalActions({
      state: battleResolvedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    // P3-71: 発動 (resolve) に加え「発動しない」(decline) も任意発動として提供。
    expect(burstActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "resolve_pending_burst_check",
          sourceInstanceId: "battle-burst-source-1",
          sourceCardNo: burstSourceDefinition.cardNo,
          reason: "legal_battle_life_reduced_burst",
        }),
        expect.objectContaining({ kind: "decline_pending_burst_check" }),
      ])
    );
    const burstResolveAction = burstActions.find(
      (a) => a.kind === "resolve_pending_burst_check"
    )!;

    const triggerResolverLookup = (cardNo: string) =>
      cardNo === triggerSourceDefinition.cardNo
        ? (
            currentState: ReturnType<typeof createEmptyGameState>,
            context: EffectActionContext
          ) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `battle:test-trigger-resolver:${context.sourceCard.instanceId}`,
            ],
          })
        : undefined;
    const burstResolverLookup = (cardNo: string) =>
      cardNo === burstSourceDefinition.cardNo
        ? (currentState: GameState, context: EffectActionContext) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `battle:test-burst-resolver:${context.sourceCard.instanceId}`,
            ],
          })
        : undefined;
    const resolverLookup = (cardNo: string) =>
      triggerResolverLookup(cardNo) ?? burstResolverLookup(cardNo);

    const afterBurstActivationSelection = applyLegalAction({
      state: battleResolvedState,
      action: burstResolveAction,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: burstResolverLookup,
    }).state;

    expect(afterBurstActivationSelection.stackWindow?.burstWindowKind).toBe(
      "activation"
    );
    expect(afterBurstActivationSelection.pendingTriggeredEffects).toHaveLength(
      1
    );

    const afterActivationWindow = resolveStackIfOpen({
      state: afterBurstActivationSelection,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: burstResolverLookup,
    });

    expect(afterActivationWindow.stackWindow).toBeNull();
    expect(
      afterActivationWindow.pendingStackCascade?.remainingStacks[0]
    ).toMatchObject({
      actionKind: "burst_activation",
      burstEffectDeclarationPending: true,
    });

    const triggerActions = getLegalActions({
      state: afterActivationWindow,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(triggerActions).toEqual([
      expect.objectContaining({
        kind: "resolve_pending_triggered_effect",
        sourceInstanceId: "battle-trigger-source-1",
        sourceCardNo: triggerSourceDefinition.cardNo,
        reason: "legal_battle_life_reduced_trigger",
      }),
    ]);

    const triggerDeclaredState = applyLegalAction({
      state: afterActivationWindow,
      action: triggerActions[0]!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;
    // P3-34: 誘発効果発揮宣言は stack window を経由する。解決後、遅延していたバースト効果発揮宣言窓も再開される。
    const burstResolvedState = fullyResolveMainStepStack({
      state: triggerDeclaredState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(burstResolvedState.pendingBurstChecks).toEqual([]);
    expect(burstResolvedState.setBurstStates).toEqual([]);
    expect(
      burstResolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "battle-burst-source-1"
      )?.zone
    ).toBe("trash");
    expect(burstResolvedState.log).toContain(
      "battle:test-trigger-resolver:battle-trigger-source-1"
    );
    expect(burstResolvedState.log).toContain(
      "battle:test-burst-resolver:battle-burst-source-1"
    );
    expect(burstResolvedState.log).toContain(
      `burst:revealed:${battleResolvedState.pendingBurstChecks[0]?.checkId}:battle-burst-source-1:bob`
    );
  });

  it("matches triggered effect registrations using eventMatcher instead of eventKind", () => {
    const triggerSourceDefinition = createDemoCardDefinition({
      cardNo: "TRIGGER-MATCHER-001",
      name: "Trigger Matcher Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([triggerSourceDefinition]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            eventMatcher: { family: "life" },
            reason: "matcher_based_trigger",
          },
        ],
      });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(triggerSourceDefinition, {
            instanceId: "matcher-source-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:matcher-test:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life" as const,
          event: {
            family: "life" as const,
            validationMode: "snapshot_only" as const,
          },
          source: "action_resolution" as const,
          chainId: "test:index:6672",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "attack" as const,
          turnNumber: 2,
          window: "battle_resolution" as const,
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });

    const triggerActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(triggerActions).toHaveLength(1);
    expect(triggerActions[0]).toMatchObject({
      reason: "matcher_based_trigger",
      sourceInstanceId: "matcher-source-1",
    });
  });

  it("does not match a triggered effect registration when eventMatcher family differs", () => {
    const triggerSourceDefinition = createDemoCardDefinition({
      cardNo: "TRIGGER-MISMATCH-001",
      name: "Trigger Mismatch Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([triggerSourceDefinition]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            eventMatcher: { family: "leave_field", causeKind: "destroy" },
            reason: "should_not_match",
          },
        ],
      });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(triggerSourceDefinition, {
            instanceId: "mismatch-source-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:mismatch-test:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life" as const,
          event: {
            family: "life" as const,
            validationMode: "snapshot_only" as const,
          },
          source: "action_resolution" as const,
          chainId: "test:index:6746",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "attack" as const,
          turnNumber: 2,
          window: "battle_resolution" as const,
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });

    const triggerActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    // Fallback action is always generated, but no source-backed action should match
    expect(triggerActions).toHaveLength(1);
    expect(triggerActions[0]).toMatchObject({
      kind: "resolve_pending_triggered_effect",
    });
    // No sourceInstanceId means no registered source matched
    expect(triggerActions[0]).not.toHaveProperty(
      "sourceInstanceId",
      "mismatch-source-1"
    );
  });

  it("runs a pending triggered effect through a resolver and stages downstream reactions", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "TRIGGER-RESOLVER-001",
      name: "Trigger Resolver Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      sourceSpiritDefinition,
      targetSpiritDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:life-reduced:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    });
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [targetSpiritDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "destroy",
            eventMatcher: { family: "leave_field", causeKind: "destroy" },
            reason: "resolver_downstream_destroy_trigger",
          },
        ],
      });
    const triggerAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find(
      (legalAction) => legalAction.kind === "resolve_pending_triggered_effect"
    );

    const resolvedState = applyLegalAction({
      state,
      action: triggerAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      resolvePendingTriggeredEffect: (currentState) =>
        queuePendingLeave({
          state: currentState,
          instanceId: "target-1",
          kind: "destroy",
          cause: "effect_resolution",
          chainId: "trigger:life-reduced:1",
        }),
    }).state;

    // 実移動後には破壊待機状態を参照できず、発揮できる未宣言の発生源がない。
    expect(resolvedState.pendingTriggeredEffects).toEqual([]);
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "target-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
      })
    );
    expect(resolvedState.log).toContain(
      "trigger:resolve-main:start:trigger:life-reduced:1:reduce_life:alice"
    );
    expect(resolvedState.log).toContain(
      "trigger:resolved:trigger:life-reduced:1:reduce_life:alice"
    );
  });

  it("runs a pending burst check through a resolver and stages downstream reactions", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-RESOLVER-001",
      name: "Burst Resolver Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([sourceSpiritDefinition]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [sourceSpiritDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            reason: "burst_downstream_life_trigger",
          },
        ],
      });
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 2,
          reserveNormalCoreCount: 0,
        },
      ],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:life-reduced:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:6929",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find(
      (legalAction) => legalAction.kind === "resolve_pending_burst_check"
    );

    const resolvedState = applyLegalAction({
      state,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      resolvePendingBurstCheck: (currentState, context) =>
        moveLifeCoreByEffect({
          state: currentState,
          playerId: context.pendingBurstCheck.relatedPlayerId,
          destination: {
            kind: "card",
            instanceId: "source-1",
          },
          effectKind: "normal_only",
        }),
    }).state;
    const alice = resolvedState.players.find((player) => player.id === "alice");
    const sourceCard = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "source-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(sourceCard?.normalCoreCount).toBe(2);
    expect(resolvedState.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        eventKind: "reduce_life",
        source: "action_resolution",
        relatedPlayerId: "alice",
        amount: 1,
      }),
    ]);
    expect(resolvedState.pendingBurstChecks).toEqual([
      expect.objectContaining({
        eventKind: "reduce_life",
        source: "action_resolution",
        relatedPlayerId: "alice",
        amount: 1,
      }),
    ]);
    expect(resolvedState.log).toContain(
      "burst:resolve-main:start:burst:life-reduced:1:reduce_life:alice"
    );
    expect(resolvedState.log).toContain(
      "burst:resolved:burst:life-reduced:1:reduce_life:alice"
    );
  });

  it("sets a burst card from hand during main step and tracks the once-per-turn use", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-SET-001",
      name: "Burst Set Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗相手のスピリット1体を破壊する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(burstSpiritDefinition, {
            instanceId: "burst-hand-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(burstSpiritDefinition, {
            instanceId: "burst-hand-2",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };

    const setBurstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "set_burst");

    expect(setBurstAction).toEqual(
      expect.objectContaining({
        kind: "set_burst",
        sourceInstanceId: "burst-hand-1",
        replacedBurstInstanceId: null,
      })
    );

    const setBurstState = applyLegalAction({
      state,
      action: setBurstAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(setBurstState.burstSetPlayerIdsThisTurn).toEqual(["alice"]);
    expect(setBurstState.setBurstStates).toEqual([
      {
        playerId: "alice",
        cardInstanceId: "burst-hand-1",
      },
    ]);
    expect(
      setBurstState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-hand-1"
      )?.zone
    ).toBe("burst");

    const remainingSetBurstActions = getLegalActions({
      state: setBurstState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).filter((legalAction) => legalAction.kind === "set_burst");

    expect(remainingSetBurstActions).toEqual([]);
    const aliceAfterBurstSet = setBurstState.players.find(
      (p) => p.id === "alice"
    );
    expect(aliceAfterBurstSet?.handCount).toBe(3); // decremented from 4 when burst card moved from hand
  });

  it("replaces an existing set burst when setting another burst", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-SET-LOCK-001",
      name: "Burst Set Lock Spirit",
      printedCategory: "spirit",
      textLines: ["〖バースト：自分のライフ減少後〗1枚ドローする。"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(burstSpiritDefinition, {
            instanceId: "burst-set-current",
            ownerPlayerId: "alice",
            zone: "burst",
          }),
          createCardInstance(burstSpiritDefinition, {
            instanceId: "burst-set-hand",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
        setBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-set-current",
          },
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };

    const setBurstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "set_burst");

    expect(setBurstAction).toEqual(
      expect.objectContaining({
        kind: "set_burst",
        sourceInstanceId: "burst-set-hand",
        replacedBurstInstanceId: "burst-set-current",
      })
    );

    const replacedState = applyLegalAction({
      state,
      action: setBurstAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(replacedState.setBurstStates).toEqual([
      {
        playerId: "alice",
        cardInstanceId: "burst-set-hand",
      },
    ]);
    expect(
      replacedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-set-current"
      )?.zone
    ).toBe("trash");
    expect(
      replacedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-set-hand"
      )?.zone
    ).toBe("burst");
    expect(replacedState.log).toContain(
      "burst:replace:alice:burst-set-current->burst-set-hand"
    );
  });

  it("lists source-backed pending burst actions for matching set burst cards", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-SOURCE-001",
      name: "Burst Source Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-source-2",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-source-1",
        },
        {
          playerId: "alice",
          cardInstanceId: "burst-source-2",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:life-reduced:multi",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:7196",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    const burstActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions: createBurstActionRegistrationLookup({
        "BURST-SOURCE-001": [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
          },
        ],
      }),
    }).filter(
      (legalAction) => legalAction.kind === "resolve_pending_burst_check"
    );

    expect(burstActions).toHaveLength(2);
    expect(burstActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "burst-source-1",
          sourceCardNo: "BURST-SOURCE-001",
        }),
        expect.objectContaining({
          sourceInstanceId: "burst-source-2",
          sourceCardNo: "BURST-SOURCE-001",
        }),
      ])
    );
  });

  it("delays the burst activation window until private declarations are completed", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-PRIVATE-DELAY-001",
      name: "Burst Private Delay Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-PRIVATE-DELAY-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });
    const privateDeclaration: GameState["pendingPrivateDeclarations"][number] =
      {
        declarationId: "private:before-burst-window",
        ownerPlayerId: "alice",
        actingPlayerId: "alice",
        sourceInstanceId: "private-source-1",
        sourceDefinitionId: "PRIVATE-SOURCE-001",
        sourceKind: "field_card",
        sourceZone: "field",
        registrationIndex: 0,
        pendingId: "private:pending-before-burst-window",
        eventKind: "reduce_life",
        source: "battle_resolution",
        chainId: "test:index:7265",
        attackId: "attack-1",
        relatedPlayerId: "alice",
        relatedInstanceId: null,
        amount: 1,
        step: "attack",
        window: "battle_resolution",
      };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-private-delay-1",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "bob",
          cardInstanceId: "burst-private-delay-1",
        },
      ],
      pendingPrivateDeclarations: [privateDeclaration],
      pendingBurstChecks: [
        {
          checkId: "burst:private-delay",
          actingPlayerId: "bob",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:7302",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) => legalAction.kind === "resolve_pending_burst_check"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        kind: "resolve_pending_burst_check",
        sourceInstanceId: "burst-private-delay-1",
      })
    );

    const afterBurstSelection = applyLegalAction({
      state,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === burstSpiritDefinition.cardNo
          ? (currentState) => currentState
          : undefined,
    }).state;

    expect(afterBurstSelection.stackWindow).toBeNull();
    expect(afterBurstSelection.pendingPrivateDeclarations).toHaveLength(1);
    expect(afterBurstSelection.pendingBurstChecks[0]?.activationSelected).toBe(
      true
    );
    expect(
      afterBurstSelection.pendingStackCascade?.remainingStacks[0]
    ).toMatchObject({
      actionKind: "burst_activation",
      burstActivationWindowPending: true,
    });
    expect(afterBurstSelection.setBurstStates).toEqual(state.setBurstStates);
    expect(afterBurstSelection.revealedBurstStates).toEqual([
      {
        playerId: "bob",
        cardInstanceId: "burst-private-delay-1",
        checkId: "burst:private-delay",
        activationPending: true,
      },
    ]);

    const stillWaiting = resumeStackCascadeIfReady(afterBurstSelection, {
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    });

    expect(stillWaiting.stackWindow).toBeNull();

    const afterPrivateDeclarations = resumeStackCascadeIfReady(
      {
        ...afterBurstSelection,
        pendingPrivateDeclarations: [],
      },
      {
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
      }
    );

    expect(afterPrivateDeclarations.stackWindow?.burstWindowKind).toBe(
      "activation"
    );
    expect(afterPrivateDeclarations.pendingStackCascade).toBeNull();
  });

  function createPrivateAndPublicTriggerPriorityFixture(options: {
    privatePriority: TriggerPriority;
    publicPriority: TriggerPriority;
  }) {
    const privateSourceDefinition = createDemoCardDefinition({
      cardNo: "PRIVATE-BEFORE-PUBLIC-001",
      name: "Private Before Public",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([privateSourceDefinition]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [privateSourceDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "spirit_destroyed",
            reason: "legal_private_before_public",
          },
        ],
      });
    const privateDeclaration: GameState["pendingPrivateDeclarations"][number] =
      {
        declarationId: "private:before-public-select",
        ownerPlayerId: "bob",
        actingPlayerId: "bob",
        sourceInstanceId: "private-before-public-1",
        sourceDefinitionId: privateSourceDefinition.cardNo,
        sourceKind: "spirit",
        sourceZone: "hand",
        registrationIndex: 0,
        pendingId: "private:pending-before-public-select",
        eventKind: "spirit_destroyed",
        source: "battle",
        chainId: "test:index:7415",
        attackId: null,
        relatedPlayerId: null,
        relatedInstanceId: null,
        amount: null,
        step: "attack",
        window: "battle",
        triggerPriority: options.privatePriority,
      };
    const publicPending: GameState["pendingTriggeredEffects"][number] = {
      pendingId: "public-priority-1",
      actingPlayerId: "alice",
      eventKind: "spirit_destroyed",
      source: "battle",
      chainId: "test:index:7436",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      resolvedSourceInstanceIds: [],
      triggerPriority: options.publicPriority,
    };
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(privateSourceDefinition, {
            instanceId: "private-before-public-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      activePlayerId: "alice",
      pendingPrivateDeclarations: [privateDeclaration],
      pendingTriggeredEffects: [
        publicPending,
        { ...publicPending, pendingId: "public-priority-2" },
      ],
    };
    return { state, definitionLookup, getRegisteredTriggeredEffectActions };
  }

  it("lets public immediate resolution-order selection preempt normal private declarations", () => {
    const { state, definitionLookup, getRegisteredTriggeredEffectActions } =
      createPrivateAndPublicTriggerPriorityFixture({
        privatePriority: "normal",
        publicPriority: "immediate",
      });
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });
    expect(aliceActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "select_pending_to_resolve" }),
      ])
    );

    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });
    expect(bobActions).toEqual([]);
  });

  it("keeps public immediate resolution-order selection hidden until immediate private declarations are completed", () => {
    const { state, definitionLookup, getRegisteredTriggeredEffectActions } =
      createPrivateAndPublicTriggerPriorityFixture({
        privatePriority: "immediate",
        publicPriority: "immediate",
      });
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });
    expect(aliceActions).toEqual([]);

    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });
    expect(bobActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "declare_private_triggered_effect" }),
        expect.objectContaining({ kind: "skip_private_triggered_effect" }),
      ])
    );
  });

  it("keeps public normal resolution-order selection hidden until normal private declarations are completed", () => {
    const { state, definitionLookup, getRegisteredTriggeredEffectActions } =
      createPrivateAndPublicTriggerPriorityFixture({
        privatePriority: "normal",
        publicPriority: "normal",
      });
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });
    expect(aliceActions).toEqual([]);

    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });
    expect(bobActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "declare_private_triggered_effect" }),
        expect.objectContaining({ kind: "skip_private_triggered_effect" }),
      ])
    );
  });

  it("keeps burst activation selection behind public immediate triggered effects", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-WAITS-FOR-IMMEDIATE-001",
      name: "Burst Waits For Immediate",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });
    const publicImmediate: GameState["pendingTriggeredEffects"][number] = {
      pendingId: "public-immediate-before-burst-1",
      actingPlayerId: "alice",
      eventKind: "reduce_life",
      source: "battle_resolution",
      chainId: "test:index:7587",
      attackId: "attack-1",
      relatedPlayerId: "alice",
      relatedInstanceId: null,
      amount: 1,
      step: "attack",
      window: "battle_resolution",
      resolvedSourceInstanceIds: [],
      triggerPriority: "immediate",
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-waits-for-immediate-1",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "bob",
          cardInstanceId: "burst-waits-for-immediate-1",
        },
      ],
      pendingTriggeredEffects: [
        publicImmediate,
        { ...publicImmediate, pendingId: "public-immediate-before-burst-2" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:waits-for-immediate",
          actingPlayerId: "bob",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:7622",
          attackId: "attack-1",
          relatedPlayerId: "bob",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    });
    expect(aliceActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "select_pending_to_resolve" }),
      ])
    );

    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    });
    expect(bobActions).toEqual([]);
  });

  it("publishes an immediate private declaration without waiting for normal private siblings", () => {
    const privateSourceDefinition = createDemoCardDefinition({
      cardNo: "PRIVATE-PRIORITY-FLUSH-001",
      name: "Private Priority Flush",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([privateSourceDefinition]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [privateSourceDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            sourceZone: "hand",
            eventMatcher: { family: "leave_field", causeKind: "destroy" },
            eventKind: "destroy",
            reason: "legal_private_priority_flush",
          },
        ],
      });
    const makeDeclaration = (
      id: string,
      priority: TriggerPriority
    ): GameState["pendingPrivateDeclarations"][number] => ({
      declarationId: `private:priority-flush:${id}`,
      ownerPlayerId: "bob",
      actingPlayerId: "bob",
      sourceInstanceId: "private-priority-flush-1",
      sourceDefinitionId: privateSourceDefinition.cardNo,
      sourceKind: "spirit",
      sourceZone: "hand",
      registrationIndex: 0,
      pendingId: `private:priority-flush-pending:${id}`,
      eventKind: "destroy",
      source: "battle",
      chainId: "test:index:7687",
      attackId: null,
      relatedPlayerId: null,
      relatedInstanceId: null,
      amount: null,
      step: "attack",
      window: "battle",
      simultaneousGroupId: "sim-group:private-priority-flush",
      triggerPriority: priority,
    });
    const immediateDeclaration = makeDeclaration("immediate", "immediate");
    const normalDeclaration = makeDeclaration("normal", "normal");
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(privateSourceDefinition, {
            instanceId: "private-priority-flush-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      activePlayerId: "alice",
      pendingPrivateDeclarations: [immediateDeclaration, normalDeclaration],
    };

    const declared = applyLegalAction({
      state,
      action: {
        chainId: "test:index:7729",
        kind: "declare_private_triggered_effect",
        actionId:
          "declare_private_triggered_effect:private:priority-flush:immediate",
        can: true,
        reason: "legal_declare_private_triggered_effect_spirit_destroyed",
        actingPlayerId: "bob",
        declarationId: immediateDeclaration.declarationId,
        eventKind: "destroy",
        sourceInstanceId: "private-priority-flush-1",
        sourceDefinitionId: privateSourceDefinition.cardNo,
        sourceCardNo: privateSourceDefinition.cardNo,
        registrationIndex: 0,
      },
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
    }).state;

    expect(declared.pendingPrivateDeclarations).toEqual([normalDeclaration]);
    expect(declared.pendingDeferredTriggeredEffects).toEqual([]);
    expect(declared.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        pendingId: "private:priority-flush-pending:immediate",
        triggerPriority: "immediate",
      }),
    ]);
  });

  it("resolves source-backed pending burst checks one burst card at a time", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-SOURCE-STEP-001",
      name: "Burst Source Step Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-SOURCE-STEP-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === "BURST-SOURCE-STEP-001"
        ? (
            currentState: ReturnType<typeof createEmptyGameState>,
            context: EffectActionContext
          ) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `burst:test-resolver:${context.sourceCard.instanceId}`,
            ],
          })
        : undefined;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-source-2",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-source-1",
        },
        {
          playerId: "alice",
          cardInstanceId: "burst-source-2",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:life-reduced:step",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:7814",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    const firstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-source-1"
    );

    const firstResolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: firstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getHandWrittenEffectResolver,
      }).state,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    });

    expect(firstResolvedState.pendingBurstChecks).toEqual([]);
    expect(firstResolvedState.setBurstStates).toEqual([
      {
        playerId: "alice",
        cardInstanceId: "burst-source-2",
      },
    ]);
    expect(firstResolvedState.revealedBurstStates).toEqual([]);
    expect(
      firstResolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-source-1"
      )?.zone
    ).toBe("trash");
    expect(firstResolvedState.log).toContain(
      "burst:revealed:burst:life-reduced:step:burst-source-1:alice"
    );
    expect(firstResolvedState.log).toContain(
      "burst:test-resolver:burst-source-1"
    );
  });

  it("keeps a resolved burst card outside trash when the burst effect moves it elsewhere", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-SOURCE-FIELD-001",
      name: "Burst Source Field Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-SOURCE-FIELD-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === "BURST-SOURCE-FIELD-001"
        ? (
            currentState: ReturnType<typeof createEmptyGameState>,
            context: EffectActionContext
          ) => ({
            ...currentState,
            cardInstances: currentState.cardInstances.map((cardInstance) =>
              cardInstance.instanceId !== context.sourceCard.instanceId
                ? cardInstance
                : {
                    ...cardInstance,
                    zone: "hand",
                    zoneRoleName: "spirit-card",
                  }
            ),
            log: [
              ...currentState.log,
              `burst:move-to-hand:${context.sourceCard.instanceId}`,
            ],
          })
        : undefined;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-source-field",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-source-field",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:life-reduced:field",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "alice",
          amount: 1,
          step: "main",
          window: "none",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-source-field"
    );

    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getHandWrittenEffectResolver,
        getRegisteredTriggeredEffectActions: () => undefined,
      }).state,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
      getRegisteredTriggeredEffectActions: () => undefined,
    });

    expect(resolvedState.pendingBurstChecks).toEqual([]);
    expect(resolvedState.setBurstStates).toEqual([]);
    expect(resolvedState.revealedBurstStates).toEqual([]);
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-source-field"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "hand",
        zoneRoleName: "spirit-card",
      })
    );
    expect(resolvedState.log).toContain(
      "burst:post-resolution:kept:burst:life-reduced:field:burst-source-field:hand"
    );
  });

  it("reveals a burst before resolution while keeping it set until post-resolution cleanup", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-REVEAL-TIMING-001",
      name: "Burst Reveal Timing Spirit",
      printedCategory: "spirit",
      textLines: ["〖バースト：自分のライフ減少後〗1枚ドローする。"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-reveal-timing-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-reveal-timing-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:reveal-timing:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:8022",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-REVEAL-TIMING-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });
    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) => legalAction.kind === "resolve_pending_burst_check"
    );

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === burstSpiritDefinition.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `burst:test-reveal:set=${currentState.setBurstStates.some(
                (setBurstState) =>
                  setBurstState.cardInstanceId === "burst-reveal-timing-1"
              )}`,
              `burst:test-reveal:revealed=${currentState.revealedBurstStates.some(
                (revealedBurstState) =>
                  revealedBurstState.cardInstanceId === "burst-reveal-timing-1"
              )}`,
            ],
          })
        : undefined;
    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getHandWrittenEffectResolver,
      }).state,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    });
    const revealIndex = resolvedState.log.findIndex(
      (entry) =>
        entry ===
        "burst:revealed:burst:reveal-timing:test:burst-reveal-timing-1:alice"
    );
    const resolveStartIndex = resolvedState.log.findIndex(
      (entry) =>
        entry ===
        "burst:resolve-main:start:burst:reveal-timing:test:reduce_life:alice"
    );

    expect(resolvedState.log).toContain("burst:test-reveal:set=false");
    expect(resolvedState.log).toContain("burst:test-reveal:revealed=true");
    expect(revealIndex).toBeGreaterThan(-1);
    expect(resolveStartIndex).toBeGreaterThan(-1);
    expect(revealIndex).toBeLessThan(resolveStartIndex);
    expect(resolvedState.setBurstStates).toEqual([]);
    expect(resolvedState.revealedBurstStates).toEqual([]);
  });

  it("keeps a burst card in the burst zone when a post-resolution exception policy says to stay", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "DEMO-BURST-STAY-001",
      name: "Demo Burst Stay Spirit",
      printedCategory: "spirit",
      textLines: ["〖バースト：自分のライフ減少後〗このカードは残る。"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-stay-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-stay-source-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:stay:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:8131",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "DEMO-BURST-STAY-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });
    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) => legalAction.kind === "resolve_pending_burst_check"
    );

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === burstSpiritDefinition.cardNo
        ? (currentState: GameState) => currentState
        : undefined;
    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getHandWrittenEffectResolver,
      }).state,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    });

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-stay-source-1"
      )?.zone
    ).toBe("burst");
    expect(resolvedState.setBurstStates).toEqual([]);
    expect(resolvedState.revealedBurstStates).toEqual([]);
    expect(resolvedState.log).toContain(
      "burst:post-resolution:stay:burst:stay:test:burst-stay-source-1"
    );
  });

  it("can summon a burst source card without paying cost and keep the moved zone after cleanup", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-SUMMON-SELF-001",
      name: "Burst Summon Self Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗この効果発揮後、このカードをコストを支払わずに召喚する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
        },
      ],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-summon-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
    });
    const playedState = playBurstSourceCardWithoutPayingCost({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "burst-summon-source-1",
      getCardDefinitionById: definitionLookup,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      chainId: "burst:self-summon:test",
    }).state;
    const finalizedState = finalizeResolvedBurstCard({
      state: {
        ...playedState,
        setBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-summon-source-1",
          },
        ],
        revealedBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-summon-source-1",
            checkId: "burst:self-summon:test",
          },
        ],
      },
      actingPlayerId: "alice",
      sourceInstanceId: "burst-summon-source-1",
      checkId: "burst:self-summon:test",
      getCardDefinitionById: definitionLookup,
    });

    expect(
      finalizedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-summon-source-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "field",
        normalCoreCount: 1,
      })
    );
    expect(finalizedState.setBurstStates).toEqual([]);
    expect(finalizedState.revealedBurstStates).toEqual([]);
    expect(finalizedState.log).toContain(
      "summon:without-cost:burst:self-summon:test"
    );
    expect(finalizedState.log).toContain(
      "burst:post-resolution:kept:burst:self-summon:test:burst-summon-source-1:field"
    );
  });

  it("can resolve a burst check by auto-playing the source spirit without paying cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-SUMMON-001",
      name: "Burst Auto Summon Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗この効果発揮後、このカードをコストを支払わずに召喚する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
        },
      ],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-auto-summon-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-auto-summon-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:auto-summon:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:8305",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-AUTO-SUMMON-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          playSourceCardWithoutCostAfterResolve: true,
        },
      ],
    });
    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-auto-summon-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        playsSourceCardWithoutCostAfterResolve: true,
        minimumEnterFieldCoreCount: 1,
        requiresEnterFieldCorePlacements: true,
        enterFieldCorePlacementRule: "required_minimum",
      })
    );

    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      }).state,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    });

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-auto-summon-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "field",
        normalCoreCount: 1,
      })
    );
    expect(resolvedState.setBurstStates).toEqual([]);
    expect(resolvedState.revealedBurstStates).toEqual([]);
    // spirit_summoned burst check may be generated when the source spirit enters field
    expect(
      resolvedState.pendingBurstChecks.every((bc) => bc.eventKind === "summon")
    ).toBe(true);
    expect(resolvedState.log).toContain(
      "summon:without-cost:burst:burst:auto-summon:test"
    );
    expect(resolvedState.log).toContain(
      "burst:post-resolution:kept:burst:auto-summon:test:burst-auto-summon-1:field"
    );
  });

  it("can place a burst source nexus without paying cost and keep the moved zone after cleanup", () => {
    const burstNexusDefinition = createDemoCardDefinition({
      cardNo: "BURST-PLACE-SELF-001",
      name: "Burst Place Self Nexus",
      printedCategory: "nexus",
      textLines: [
        "〖バースト：自分のライフ減少後〗この効果発揮後、このカードをコストを支払わずに配置する。",
      ],
    });
    const definitionLookup = createDefinitionLookup([burstNexusDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstNexusDefinition, {
          instanceId: "burst-place-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
    });

    const playedState = playBurstSourceCardWithoutPayingCost({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "burst-place-source-1",
      getCardDefinitionById: definitionLookup,
      enterFieldCorePlacements: [],
      chainId: "burst:self-place:test",
    }).state;
    const finalizedState = finalizeResolvedBurstCard({
      state: {
        ...playedState,
        setBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-place-source-1",
          },
        ],
        revealedBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-place-source-1",
            checkId: "burst:self-place:test",
          },
        ],
      },
      actingPlayerId: "alice",
      sourceInstanceId: "burst-place-source-1",
      checkId: "burst:self-place:test",
      getCardDefinitionById: definitionLookup,
    });

    expect(
      finalizedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-place-source-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "field",
      })
    );
    expect(finalizedState.setBurstStates).toEqual([]);
    expect(finalizedState.revealedBurstStates).toEqual([]);
    expect(finalizedState.log).toContain(
      "place_nexus:without-cost:burst:self-place:test"
    );
    expect(finalizedState.log).toContain(
      "burst:post-resolution:kept:burst:self-place:test:burst-place-source-1:field"
    );
  });

  it("can use a burst source magic card without paying cost and keep the moved zone after cleanup", () => {
    const burstMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-USE-SELF-001",
      name: "Burst Use Self Magic",
      printedCategory: "magic",
      cost: 5,
      textLines: [
        "〖バースト：自分のライフ減少後〗この効果発揮後、このカードをコストを支払わずに使用する。",
      ],
    });
    const definitionLookup = createDefinitionLookup([burstMagicDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstMagicDefinition, {
          instanceId: "burst-use-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
    });

    const usedState = useBurstSourceMagicCardWithoutPayingCost({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "burst-use-source-1",
      getCardDefinitionById: definitionLookup,
      chainId: "burst:self-use:test",
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === burstMagicDefinition.cardNo
          ? (currentState, context) => ({
              ...currentState,
              log: [
                ...currentState.log,
                `burst:magic-use:${context.resolutionKind}:${context.sourceCard.instanceId}`,
              ],
            })
          : undefined,
    }).state;
    const finalizedState = finalizeResolvedBurstCard({
      state: {
        ...usedState,
        setBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-use-source-1",
          },
        ],
        revealedBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-use-source-1",
            checkId: "burst:self-use:test",
          },
        ],
      },
      actingPlayerId: "alice",
      sourceInstanceId: "burst-use-source-1",
      checkId: "burst:self-use:test",
      getCardDefinitionById: definitionLookup,
    });

    expect(
      finalizedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-use-source-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "magic-card",
      })
    );
    expect(finalizedState.setBurstStates).toEqual([]);
    expect(finalizedState.revealedBurstStates).toEqual([]);
    expect(finalizedState.log).toContain(
      "magic:without-cost:burst:self-use:test"
    );
    expect(finalizedState.log).toContain(
      "burst:magic-use:magic_action:burst-use-source-1"
    );
    expect(finalizedState.log).toContain(
      "burst:post-resolution:kept:burst:self-use:test:burst-use-source-1:trash"
    );
  });

  it("can use another follow-up magic card after burst resolution without paying cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-FOLLOW-UP-SOURCE-001",
      name: "Burst Follow-up Source Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗この効果発揮後、手札のマジックカード1枚をコストを支払わずに使用する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const followUpMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-FOLLOW-UP-TARGET-001",
      name: "Burst Follow-up Target Magic",
      printedCategory: "magic",
      cost: 3,
    });
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpMagicDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-follow-up-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpMagicDefinition, {
          instanceId: "follow-up-magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const usedState = useBurstFollowUpMagicCardWithoutPayingCost({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "burst-follow-up-source-1",
      magicInstanceId: "follow-up-magic-1",
      getCardDefinitionById: definitionLookup,
      chainId: "burst:follow-up:magic:test",
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === followUpMagicDefinition.cardNo
          ? (currentState, context) => ({
              ...currentState,
              log: [
                ...currentState.log,
                `burst:follow-up-target:${context.resolutionKind}:${context.sourceCard.instanceId}`,
              ],
            })
          : undefined,
    }).state;
    const finalizedState = finalizeResolvedBurstCard({
      state: {
        ...usedState,
        setBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-follow-up-source-1",
          },
        ],
        revealedBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-follow-up-source-1",
            checkId: "burst:follow-up:magic:test",
          },
        ],
      },
      actingPlayerId: "alice",
      sourceInstanceId: "burst-follow-up-source-1",
      checkId: "burst:follow-up:magic:test",
      getCardDefinitionById: definitionLookup,
    });

    expect(
      finalizedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "follow-up-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "magic-card",
      })
    );
    expect(
      finalizedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-follow-up-source-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "spirit-card",
      })
    );
    expect(finalizedState.log).toContain(
      "burst:follow-up:magic-use:burst:follow-up:magic:test:burst-follow-up-source-1:follow-up-magic-1"
    );
    expect(finalizedState.log).toContain(
      "burst:follow-up-target:magic_action:follow-up-magic-1"
    );
    expect(finalizedState.log).toContain(
      "burst:post-resolution:trash:burst:follow-up:magic:test:burst-follow-up-source-1"
    );
  });

  it("auto-pays remaining additional_cost for burst follow-up magic without cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-FOLLOW-UP-TAXED-SOURCE-001",
      name: "Burst Follow-up Taxed Source Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗この効果発揮後、手札のマジックカード1枚をコストを支払わずに使用する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const followUpMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-FOLLOW-UP-TAXED-MAGIC-001",
      name: "Burst Follow-up Taxed Magic",
      printedCategory: "magic",
      cost: 3,
    });
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpMagicDefinition,
    ]);
    const additionalCost: ContinuousEffect = {
      effectId: "ce-burst-follow-up-magic-tax",
      sourceInstanceId: "tax-source",
      sourceDefinitionId: "tax-source-def",
      actingPlayerId: "bob",
      duration: { scope: "permanent" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "additional_cost",
      modifierAmount: 2,
      targetFilter: {
        player: "opponent",
        category: ["magic"],
      },
    };
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-follow-up-taxed-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpMagicDefinition, {
          instanceId: "follow-up-taxed-magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 3 }, {}],
    });

    const usedState = useBurstFollowUpMagicCardWithoutPayingCost({
      state: {
        ...state,
        activeContinuousEffects: [additionalCost],
      },
      actingPlayerId: "alice",
      sourceInstanceId: "burst-follow-up-taxed-source-1",
      magicInstanceId: "follow-up-taxed-magic-1",
      getCardDefinitionById: definitionLookup,
      chainId: "burst:follow-up:magic:taxed",
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
      resolveEffect: (currentState) => currentState,
    }).state;

    expect(
      usedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "follow-up-taxed-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "magic-card",
      })
    );
    const alice = usedState.players.find((player) => player.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(1);
    expect(alice.trashNormalCoreCount).toBe(2);
    expect(usedState.log).toContain(
      "magic:cost-paid:burst:follow-up:magic:taxed:alice:2"
    );
  });

  it("can resolve a burst check by auto-using the source magic without paying cost", () => {
    const burstMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-001",
      name: "Burst Auto Use Magic",
      printedCategory: "magic",
      cost: 4,
      textLines: [
        "〖バースト：自分のライフ減少後〗この効果発揮後、このカードをコストを支払わずに使用する。",
      ],
    });
    const definitionLookup = createDefinitionLookup([burstMagicDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstMagicDefinition, {
          instanceId: "burst-auto-use-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-auto-use-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:auto-use:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:8765",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstMagicDefinition.cardNo]: [
        {
          sourceKind: "magic",
          eventKind: "reduce_life",
          useSourceCardWithoutCostAfterResolve: true,
        },
      ],
    });
    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-auto-use-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        usesSourceCardWithoutCostAfterResolve: true,
        playsSourceCardWithoutCostAfterResolve: false,
        requiresEnterFieldCorePlacements: false,
      })
    );

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === burstMagicDefinition.cardNo
        ? (currentState: GameState, context: EffectActionContext) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `burst:auto-use:${context.resolutionKind}:${context.sourceCard.instanceId}`,
            ],
          })
        : undefined;
    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getHandWrittenEffectResolver,
      }).state,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    });

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "burst-auto-use-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "magic-card",
      })
    );
    expect(resolvedState.setBurstStates).toEqual([]);
    expect(resolvedState.revealedBurstStates).toEqual([]);
    expect(resolvedState.pendingBurstChecks).toEqual([]);
    expect(resolvedState.log).toContain(
      "burst:auto-use:pending_burst_check:burst-auto-use-1"
    );
    expect(resolvedState.log).toContain(
      "burst:auto-use:magic_action:burst-auto-use-1"
    );
    expect(resolvedState.log).toContain(
      "magic:without-cost:burst:burst:auto-use:test"
    );
    expect(resolvedState.log).toContain(
      "burst:post-resolution:kept:burst:auto-use:test:burst-auto-use-1:trash"
    );
  });

  it("can resolve a burst check by auto-using a selected target magic without paying cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-TARGET-SOURCE-001",
      name: "Burst Auto Use Target Source Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗手札のマジックカード1枚をコストを支払わずに使用する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const followUpMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-TARGET-OK-001",
      name: "Burst Auto Use Target Magic",
      printedCategory: "magic",
      cost: 3,
    });
    const targetfulMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-TARGET-NG-001",
      name: "Burst Auto Use Target Needs Target",
      printedCategory: "magic",
      cost: 4,
    });
    const handSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpMagicDefinition,
      targetfulMagicDefinition,
      handSpiritDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-auto-use-target-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpMagicDefinition, {
          instanceId: "follow-up-magic-ok-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(targetfulMagicDefinition, {
          instanceId: "follow-up-magic-needs-target-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(handSpiritDefinition, {
          instanceId: "follow-up-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-auto-use-target-source-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:auto-use-target:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:8921",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          requiredTargetCount: 1,
          candidateTargetZones: ["hand"],
          candidateTargetPlayerScope: "acting_player",
          useTargetCardWithoutCostAfterResolve: true,
        },
      ],
    });
    const getRegisteredMagicActions = createMagicActionRegistrationLookup({
      [followUpMagicDefinition.cardNo]: {
        timing: "main",
      },
      [targetfulMagicDefinition.cardNo]: {
        timing: "main",
        requiredTargetCount: 1,
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "any",
        targetEffectFilterTags: ["general"],
      },
    });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
      getRegisteredMagicActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-auto-use-target-source-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        usesTargetCardWithoutCostAfterResolve: true,
        usesSourceCardWithoutCostAfterResolve: false,
        playsSourceCardWithoutCostAfterResolve: false,
        targetMode: "none",
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
        requiresEnterFieldCorePlacements: false,
      })
    );

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === followUpMagicDefinition.cardNo
        ? (currentState: GameState, context: EffectActionContext) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `burst:auto-use-target:${context.resolutionKind}:${context.sourceCard.instanceId}`,
            ],
          })
        : undefined;
    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getRegisteredMagicActions,
        getHandWrittenEffectResolver,
      }).state,
      pendingEffectTargetInstanceIds: ["follow-up-magic-ok-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredMagicActions,
      getHandWrittenEffectResolver,
    });

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "follow-up-magic-ok-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "magic-card",
      })
    );
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "burst-auto-use-target-source-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "spirit-card",
      })
    );
    expect(resolvedState.pendingBurstChecks).toEqual([]);
    expect(resolvedState.log).toContain(
      "burst:follow-up:magic-use:burst:burst:auto-use-target:test:burst-auto-use-target-source-1:follow-up-magic-ok-1"
    );
    expect(resolvedState.log).toContain(
      "burst:auto-use-target:magic_action:follow-up-magic-ok-1"
    );
    expect(resolvedState.log).toContain(
      "burst:post-resolution:trash:burst:auto-use-target:test:burst-auto-use-target-source-1"
    );
  });

  it("can resolve a burst check by auto-using a selected target magic with follow-up targets", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-TARGETED-SOURCE-001",
      name: "Burst Auto Use Targeted Source Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const followUpMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-TARGETED-MAGIC-001",
      name: "Burst Auto Use Targeted Magic",
      printedCategory: "magic",
      cost: 3,
    });
    const followUpTargetDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpMagicDefinition,
      followUpTargetDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-auto-use-targeted-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpMagicDefinition, {
          instanceId: "follow-up-targeted-magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(followUpTargetDefinition, {
          instanceId: "follow-up-target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-auto-use-targeted-source-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:auto-use-targeted:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:9095",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          requiredTargetCount: 1,
          candidateTargetZones: ["hand"],
          candidateTargetPlayerScope: "acting_player",
          useTargetCardWithoutCostAfterResolve: true,
        },
      ],
    });
    const getRegisteredMagicActions = createMagicActionRegistrationLookup({
      [followUpMagicDefinition.cardNo]: {
        timing: "main",
        requiredTargetCount: 1,
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "acting_player",
        targetEffectFilterTags: ["general"],
      },
    });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
      getRegisteredMagicActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-auto-use-targeted-source-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        usesTargetCardWithoutCostAfterResolve: true,
        targetMode: "none",
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
        targetFollowUpMagicOptions: [
          expect.objectContaining({
            targetInstanceId: "follow-up-targeted-magic-1",
            targetMode: "manual",
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["follow-up-target-1"],
            requiresChosenLifeCoreKind: false,
          }),
        ],
      })
    );

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === followUpMagicDefinition.cardNo
        ? (currentState: GameState, context: EffectActionContext) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `burst:auto-use-targeted:magic_action:${context.targetInstanceIds.join(",")}`,
            ],
          })
        : undefined;
    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        followUpTargetInstanceIds: ["follow-up-target-1"],
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getRegisteredMagicActions,
        getHandWrittenEffectResolver,
      }).state,
      pendingEffectTargetInstanceIds: ["follow-up-targeted-magic-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredMagicActions,
      getHandWrittenEffectResolver,
    });

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "follow-up-targeted-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "magic-card",
      })
    );
    expect(resolvedState.log).toContain(
      "burst:auto-use-targeted:magic_action:follow-up-target-1"
    );
  });

  it("can resolve a burst check by auto-using a selected target magic with follow-up life-core choice", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-CHOICE-SOURCE-001",
      name: "Burst Auto Use Choice Source Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const followUpMagicDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-USE-CHOICE-MAGIC-001",
      name: "Burst Auto Use Choice Magic",
      printedCategory: "magic",
      cost: 3,
    });
    const followUpTargetDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpMagicDefinition,
      followUpTargetDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          lifeNormalCoreCount: 1,
          soulCoreLocation: {
            kind: "life",
          },
        },
      ],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-auto-use-choice-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpMagicDefinition, {
          instanceId: "follow-up-choice-magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(followUpTargetDefinition, {
          instanceId: "follow-up-choice-target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-auto-use-choice-source-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:auto-use-choice:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:9264",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          requiredTargetCount: 1,
          candidateTargetZones: ["hand"],
          candidateTargetPlayerScope: "acting_player",
          useTargetCardWithoutCostAfterResolve: true,
        },
      ],
    });
    const getRegisteredMagicActions = createMagicActionRegistrationLookup({
      [followUpMagicDefinition.cardNo]: {
        timing: "main",
        requiredTargetCount: 1,
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "acting_player",
        targetEffectFilterTags: ["general"],
        actingPlayerLifeCoreChoice: {
          effectKind: "generic",
          destinationKind: "target_card",
        },
      },
    });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
      getRegisteredMagicActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-auto-use-choice-source-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        usesTargetCardWithoutCostAfterResolve: true,
        targetMode: "none",
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
        targetFollowUpMagicOptions: [
          expect.objectContaining({
            targetInstanceId: "follow-up-choice-magic-1",
            targetMode: "manual",
            requiredTargetCount: 1,
            candidateTargetInstanceIds: ["follow-up-choice-target-1"],
            availableChosenLifeCoreKinds: ["normal", "soul"],
            requiresChosenLifeCoreKind: true,
          }),
        ],
      })
    );

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === followUpMagicDefinition.cardNo
        ? createActingPlayerLifeCoreToTargetCardResolver()
        : undefined;
    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        followUpTargetInstanceIds: ["follow-up-choice-target-1"],
        followUpChosenLifeCoreKind: "soul",
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getRegisteredMagicActions,
        getHandWrittenEffectResolver,
      }).state,
      pendingEffectTargetInstanceIds: ["follow-up-choice-magic-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredMagicActions,
      getHandWrittenEffectResolver,
    });
    const alice = resolvedState.players.find((player) => player.id === "alice");

    expect(alice?.soulCoreLocation).toEqual({
      kind: "card",
      instanceId: "follow-up-choice-target-1",
    });
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "follow-up-choice-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "magic-card",
      })
    );
  });

  it("can play another follow-up spirit card after burst resolution without paying cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-FOLLOW-UP-PLAY-SOURCE-001",
      name: "Burst Follow-up Play Source Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗手札のスピリットカード1枚をコストを支払わずに召喚する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const followUpSpiritDefinition = createDemoSpiritDefinition();
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpSpiritDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
        },
      ],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-follow-up-play-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpSpiritDefinition, {
          instanceId: "follow-up-spirit-play-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    });

    const playedState = playBurstFollowUpCardWithoutPayingCost({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "burst-follow-up-play-source-1",
      targetInstanceId: "follow-up-spirit-play-1",
      getCardDefinitionById: definitionLookup,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
      chainId: "burst:follow-up:play:test",
    }).state;
    const finalizedState = finalizeResolvedBurstCard({
      state: {
        ...playedState,
        setBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-follow-up-play-source-1",
          },
        ],
        revealedBurstStates: [
          {
            playerId: "alice",
            cardInstanceId: "burst-follow-up-play-source-1",
            checkId: "burst:follow-up:play:test",
          },
        ],
      },
      actingPlayerId: "alice",
      sourceInstanceId: "burst-follow-up-play-source-1",
      checkId: "burst:follow-up:play:test",
      getCardDefinitionById: definitionLookup,
    });

    expect(
      finalizedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "follow-up-spirit-play-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "field",
        normalCoreCount: 1,
      })
    );
    expect(
      finalizedState.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "burst-follow-up-play-source-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        zoneRoleName: "spirit-card",
      })
    );
    expect(finalizedState.log).toContain(
      "burst:follow-up:play:burst:follow-up:play:test:burst-follow-up-play-source-1:follow-up-spirit-play-1"
    );
    expect(finalizedState.log).toContain(
      "summon:without-cost:burst:follow-up:play:test"
    );
    expect(finalizedState.log).toContain(
      "burst:post-resolution:trash:burst:follow-up:play:test:burst-follow-up-play-source-1"
    );
  });

  it("can resolve a burst check by auto-playing a selected target spirit without paying cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-PLAY-TARGET-SOURCE-001",
      name: "Burst Auto Play Target Source Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗手札のスピリットカード1枚をコストを支払わずに召喚する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const followUpSpiritDefinition = createDemoSpiritDefinition();
    const targetfulSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-PLAY-TARGET-NG-001",
      name: "Burst Auto Play Target Needs Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["red"],
    });
    const followUpNexusDefinition = createDemoCardDefinition({
      cardNo: "BURST-AUTO-PLAY-TARGET-NEXUS-001",
      name: "Burst Auto Play Target Nexus",
      printedCategory: "nexus",
    });
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpSpiritDefinition,
      targetfulSpiritDefinition,
      followUpNexusDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 1,
        },
      ],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-auto-play-target-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpSpiritDefinition, {
          instanceId: "follow-up-spirit-ok-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(targetfulSpiritDefinition, {
          instanceId: "follow-up-spirit-needs-target-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(followUpNexusDefinition, {
          instanceId: "follow-up-nexus-ok-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-auto-play-target-source-1",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:auto-play-target:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:9544",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          requiredTargetCount: 1,
          candidateTargetZones: ["hand"],
          candidateTargetPlayerScope: "acting_player",
          playTargetCardWithoutCostAfterResolve: true,
        },
      ],
    });
    const getRegisteredHandCardEffectActions =
      createHandCardEffectActionRegistrationLookup({
        [targetfulSpiritDefinition.cardNo]: {
          requiredTargetCount: 1,
          targetEffectFilterTags: ["general"],
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "any",
        },
      });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
      getRegisteredHandCardEffectActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-auto-play-target-source-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        playsTargetCardWithoutCostAfterResolve: true,
        playsSourceCardWithoutCostAfterResolve: false,
        usesSourceCardWithoutCostAfterResolve: false,
        usesTargetCardWithoutCostAfterResolve: false,
        targetMode: "none",
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
      })
    );
    expect(burstAction?.targetEnterFieldCorePlacementOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetInstanceId: "follow-up-spirit-ok-1",
          minimumEnterFieldCoreCount: 1,
          requiresEnterFieldCorePlacements: true,
        }),
        expect.objectContaining({
          targetInstanceId: "follow-up-nexus-ok-1",
          minimumEnterFieldCoreCount: 0,
          requiresEnterFieldCorePlacements: false,
        }),
      ])
    );

    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        followUpPerTargetInputs: [
          {
            targetInstanceId: "follow-up-spirit-ok-1",
            enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getRegisteredHandCardEffectActions,
      }).state,
      pendingEffectTargetInstanceIds: ["follow-up-spirit-ok-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredHandCardEffectActions,
    });

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "follow-up-spirit-ok-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "field",
        normalCoreCount: 1,
      })
    );
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "burst-auto-play-target-source-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
      })
    );
    // spirit_summoned burst check may be generated when the target spirit enters field
    expect(
      resolvedState.pendingBurstChecks.every((bc) => bc.eventKind === "summon")
    ).toBe(true);
    expect(resolvedState.log).toContain(
      "burst:follow-up:play:burst:burst:auto-play-target:test:burst-auto-play-target-source-1:follow-up-spirit-ok-1"
    );
    expect(resolvedState.log).toContain(
      "burst:post-resolution:trash:burst:auto-play-target:test:burst-auto-play-target-source-1"
    );
  });

  it("lists source-backed pending triggered effect actions for matching cards", () => {
    const triggerSpiritDefinition = createDemoCardDefinition({
      cardNo: "TRIGGER-SOURCE-001",
      name: "Triggered Source Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([triggerSpiritDefinition]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(triggerSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(triggerSpiritDefinition, {
          instanceId: "source-2",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:life-reduced:multi",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    });

    const triggerActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions:
        createTriggeredEffectActionRegistrationLookup({
          "TRIGGER-SOURCE-001": [
            {
              sourceKind: "spirit",
              eventKind: "reduce_life",
            },
          ],
        }),
    }).filter(
      (legalAction) => legalAction.kind === "resolve_pending_triggered_effect"
    );

    expect(triggerActions).toHaveLength(2);
    expect(triggerActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceInstanceId: "source-1",
          sourceCardNo: "TRIGGER-SOURCE-001",
        }),
        expect.objectContaining({
          sourceInstanceId: "source-2",
          sourceCardNo: "TRIGGER-SOURCE-001",
        }),
      ])
    );
  });

  it("resolves source-backed pending triggered effects one source at a time", () => {
    const triggerSpiritDefinition = createDemoCardDefinition({
      cardNo: "TRIGGER-SOURCE-STEP-001",
      name: "Triggered Source Step Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([triggerSpiritDefinition]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        "TRIGGER-SOURCE-STEP-001": [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
          },
        ],
      });
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === "TRIGGER-SOURCE-STEP-001"
        ? (
            currentState: ReturnType<typeof createEmptyGameState>,
            context: EffectActionContext
          ) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `trigger:test-resolver:${context.sourceCard.instanceId}`,
            ],
          })
        : undefined;
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(triggerSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(triggerSpiritDefinition, {
          instanceId: "source-2",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:life-reduced:step",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    });

    const firstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_triggered_effect" &&
        legalAction.sourceInstanceId === "source-1"
    );

    // P3-34: 誘発効果発揮宣言は stack window を経由するため、宣言→pass で完全解決する。
    const firstDeclaredState = applyLegalAction({
      state,
      action: firstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      getHandWrittenEffectResolver,
    }).state;
    const firstResolvedState = fullyResolveMainStepStack({
      state: firstDeclaredState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver,
      getRegisteredTriggeredEffectActions,
    });

    expect(firstResolvedState.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        pendingId: "trigger:life-reduced:step",
        // 解決済みは effect 単位キー (instanceId#registrationIndex) で記録される
        resolvedSourceRegistrationKeys: ["source-1#0"],
      }),
    ]);
    expect(firstResolvedState.log).toContain("trigger:test-resolver:source-1");

    const secondAction = getLegalActions({
      state: firstResolvedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_triggered_effect" &&
        legalAction.sourceInstanceId === "source-2"
    );

    const secondDeclaredState = applyLegalAction({
      state: firstResolvedState,
      action: secondAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      getHandWrittenEffectResolver,
    }).state;
    const secondResolvedState = fullyResolveMainStepStack({
      state: secondDeclaredState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver,
      getRegisteredTriggeredEffectActions,
    });

    expect(secondResolvedState.pendingTriggeredEffects).toEqual([]);
    expect(secondResolvedState.log).toContain("trigger:test-resolver:source-2");
  });
});

describe("rules-core game state invariants", () => {
  it("accepts the empty baseline state", () => {
    const state = createEmptyGameState();

    expect(collectGameStateInvariantIssues(state)).toEqual([]);
    expect(isValidGameState(state)).toBe(true);
    expect(() => assertValidGameState(state)).not.toThrow();
  });

  it("detects a structured effect queue and summary mismatch", () => {
    const state = {
      ...createEmptyGameState(),
      effectQueueEntries: [createGlobalResolveEffectQueueEntry("demo")],
      effectQueueSummary: [],
    };

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "effect_queue_summary_mismatch",
          path: "effectQueueSummary",
        }),
      ])
    );
    expect(isValidGameState(state)).toBe(false);
    expect(() => assertValidGameState(state)).toThrowError(
      /effect_queue_summary_mismatch/
    );
  });

  // soul_core_location_card_mismatch は P3-66 で SSOT 化により消滅 (card 側フラグなし)

  it("detects pending-leave mismatches between card state and pendingLeaveEntities", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 0,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId: "demo-chain",
        }),
      ],
    });

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "card_pending_leave_without_entity",
        }),
      ])
    );
  });

  it("detects an activeAttack that points at a non-attacking battle entity", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "idle",
        },
      ],
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:spirit-1",
        primaryEntityId: "battle-entity:spirit-1",
        participantEntityIds: ["battle-entity:spirit-1"],
        groupMode: "single",
        target: {
          kind: "player",
          playerId: "bob",
        },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:spirit-1",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:spirit-1"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    });

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "active_attack_participant_not_attacking",
        }),
      ])
    );
  });

  it("detects an activeAttack whose symbol resolution order omits a participant", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-2",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:spirit-2",
          memberInstanceIds: ["spirit-2"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:spirit-1",
        primaryEntityId: "battle-entity:spirit-1",
        participantEntityIds: [
          "battle-entity:spirit-1",
          "battle-entity:spirit-2",
        ],
        groupMode: "simultaneous",
        target: {
          kind: "player",
          playerId: "bob",
        },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:spirit-1",
            blockedByEntityIds: [],
          },
          {
            participantEntityId: "battle-entity:spirit-2",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:spirit-1"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    });

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "active_attack_symbol_resolution_order_length_mismatch",
        }),
      ])
    );
  });

  it("detects a flash window state whose kind does not match the current window", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "attack-group:1:alice:battle-entity:spirit-1",
        primaryEntityId: "battle-entity:spirit-1",
        participantEntityIds: ["battle-entity:spirit-1"],
        groupMode: "single",
        target: {
          kind: "player",
          playerId: "bob",
        },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:spirit-1",
            blockedByEntityIds: [],
          },
        ],
        symbolResolutionOrder: ["battle-entity:spirit-1"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: {
          kind: "before_block",
          priorityPlayerId: "alice",
          consecutivePassCount: 0,
          stackResponseSourcePlayerId: "alice",
        },
      },
    });
    state.window = "declare_attack";

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "active_attack_flash_window_state_window_mismatch",
        }),
      ])
    );
  });

  it("detects a blocker battle entity when activeAttack is missing", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDefinition, {
          instanceId: "spirit-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "blocking",
        },
      ],
    });

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "blocking_battle_entity_without_active_attack",
        }),
      ])
    );
  });

  it("detects an assigned blocker that is not marked as blocking", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDefinition, {
          instanceId: "attacker-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(spiritDefinition, {
          instanceId: "blocker-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
      battleEntities: [
        {
          entityId: "battle-entity:attacker-1",
          memberInstanceIds: ["attacker-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:blocker-1",
          memberInstanceIds: ["blocker-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "idle",
        },
      ],
      activeAttack: {
        attackId: "attack-group:2:alice:battle-entity:attacker-1",
        primaryEntityId: "battle-entity:attacker-1",
        participantEntityIds: ["battle-entity:attacker-1"],
        groupMode: "single",
        target: {
          kind: "player",
          playerId: "bob",
        },
        blockAssignments: [
          {
            participantEntityId: "battle-entity:attacker-1",
            blockedByEntityIds: ["battle-entity:blocker-1"],
          },
        ],
        symbolResolutionOrder: ["battle-entity:attacker-1"],
        flashBeforeBlockCompleted: false,
        flashAfterBlockCompleted: false,
        flashWindowState: null,
      },
    });

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "active_attack_blocker_not_blocking",
        }),
      ])
    );
  });

  it("detects a battle immediate effect prompt when activeAttack is missing", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDefinition, {
          instanceId: "attacker-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
      battleImmediateEffects: [
        {
          promptId: "battle-immediate:demo",
          attackId: "attack-group:2:alice:battle-entity:attacker-1",
          timing: "attack",
          sourceKind: "spirit",
          sourceInstanceId: "attacker-1",
          sourceDefinitionId: spiritDefinition.cardNo,
          sourceCardNo: spiritDefinition.cardNo,
          actingPlayerId: "alice",
          participantEntityId: "battle-entity:attacker-1",
          registrationIndex: 0,
        },
      ],
    });

    const issues = collectGameStateInvariantIssues(state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "battle_immediate_effect_without_active_attack",
        }),
      ])
    );
  });
});

describe("rules-core attack declaration", () => {
  it("lists ready field spirits as attack legal actions during the attack step", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const exhaustedSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(exhaustedSpiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
            exhaustState: "exhausted",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
      exhaustedSpiritDefinition,
    ]);

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).filter((legalAction) => legalAction.kind === "attack");

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      kind: "attack",
      sourceInstanceId: "attacker-1",
      sourceCardNo: attackingSpiritDefinition.cardNo,
      battleEntityId: "battle-entity:attacker-1",
    });
  });

  it("declares an attack by exhausting the source card and marking its battle entity as attacking", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
    ]);
    const action = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "attack");
    const tentativeResult = applyLegalAction({
      state,
      action: action!,
      getCardDefinitionById: definitionLookup,
    });

    expect(tentativeResult.state.window).toBe("pre_declaration_stack");
    expect(tentativeResult.state.preDeclarationStackWindow).not.toBeNull();

    const bobPassAction = getLegalActions({
      state: tentativeResult.state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "pass_pre_declaration_stack");
    const result = applyLegalAction({
      state: tentativeResult.state,
      action: bobPassAction!,
      getCardDefinitionById: definitionLookup,
    });
    const attacker = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "attacker-1"
    );

    expect(result.entityId).toBe("battle-entity:attacker-1");
    expect(result.attackId).toBe(
      "attack-group:2:alice:battle-entity:attacker-1"
    );
    expect(result.state.step).toBe("attack");
    expect(result.state.window).toBe("declare_attack");
    expect(attacker?.exhaustState).toBe("exhausted");
    expect(result.state.activeAttack).toEqual({
      attackId: "attack-group:2:alice:battle-entity:attacker-1",
      primaryEntityId: "battle-entity:attacker-1",
      immediateTimingSources: [
        {
          timing: "attack",
          sourceInstanceId: "attacker-1",
          sourceDefinitionId: attackingSpiritDefinition.cardNo,
          fieldInstanceGeneration: 0,
          participantEntityId: "battle-entity:attacker-1",
          queuedPromptIds: [],
          effectSourceRefs: [
            {
              instanceId: "attacker-1",
              definitionId: attackingSpiritDefinition.cardNo,
              fieldInstanceGeneration: 0,
            },
          ],
        },
      ],
      participantEntityIds: ["battle-entity:attacker-1"],
      groupMode: "single",
      target: {
        kind: "player",
        playerId: "bob",
      },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:attacker-1",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: ["battle-entity:attacker-1"],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    });
    expect(result.state.battleEntities).toEqual([
      expect.objectContaining({
        entityId: "battle-entity:attacker-1",
        memberInstanceIds: ["attacker-1"],
        attackState: "attacking",
      }),
    ]);
    expect(result.state.log).toContain(
      "attack:declare:2:alice:attacker-1:battle-entity:attacker-1"
    );
  });

  it("does not allow another attack declaration while one attack is in progress", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
    ]);
    const firstAttackState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });

    const actionsAfterDeclaration = getLegalActions({
      state: firstAttackState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).filter((legalAction) => legalAction.kind === "attack");

    expect(actionsAfterDeclaration).toEqual([]);
  });

  it("allows another ready spirit to join the current active attack group", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
    ]);
    const firstAttack = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    const joinResult = joinActiveAttackAsAction({
      state: firstAttack.state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
    });

    expect(joinResult.attackId).toBe(firstAttack.attackId);
    expect(joinResult.entityId).toBe("battle-entity:attacker-2");
    expect(joinResult.state.activeAttack).toEqual({
      attackId: "attack-group:2:alice:battle-entity:attacker-1",
      primaryEntityId: "battle-entity:attacker-1",
      immediateTimingSources: [
        ["attacker-1", "attack"],
        ["attacker-2", "attack"],
        ["attacker-2", "join"],
      ].map(([instanceId, timing]) => ({
        timing,
        sourceInstanceId: instanceId,
        sourceDefinitionId: attackingSpiritDefinition.cardNo,
        fieldInstanceGeneration: 0,
        participantEntityId: `battle-entity:${instanceId}`,
        queuedPromptIds: [],
        effectSourceRefs: [
          {
            instanceId,
            definitionId: attackingSpiritDefinition.cardNo,
            fieldInstanceGeneration: 0,
          },
        ],
      })),
      participantEntityIds: [
        "battle-entity:attacker-1",
        "battle-entity:attacker-2",
      ],
      groupMode: "simultaneous",
      target: {
        kind: "player",
        playerId: "bob",
      },
      blockAssignments: [
        {
          participantEntityId: "battle-entity:attacker-1",
          blockedByEntityIds: [],
        },
        {
          participantEntityId: "battle-entity:attacker-2",
          blockedByEntityIds: [],
        },
      ],
      symbolResolutionOrder: [
        "battle-entity:attacker-1",
        "battle-entity:attacker-2",
      ],
      flashBeforeBlockCompleted: false,
      flashAfterBlockCompleted: false,
      flashWindowState: null,
    });
    expect(
      joinResult.state.battleEntities.map((battleEntity) => ({
        entityId: battleEntity.entityId,
        attackState: battleEntity.attackState,
      }))
    ).toEqual(
      expect.arrayContaining([
        {
          entityId: "battle-entity:attacker-1",
          attackState: "attacking",
        },
        {
          entityId: "battle-entity:attacker-2",
          attackState: "attacking",
        },
      ])
    );
    expect(
      joinResult.state.cardInstances
        .filter((cardInstance) =>
          ["attacker-1", "attacker-2"].includes(cardInstance.instanceId)
        )
        .every((cardInstance) => cardInstance.exhaustState === "exhausted")
    ).toBe(true);
    expect(joinResult.state.log).toContain(
      "attack:join:2:alice:attacker-2:battle-entity:attacker-2:attack-group:2:alice:battle-entity:attacker-1"
    );
  });

  it("opens and closes flash_before_block before block declarations become available", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "open_battle_flash");

    expect(flashOpenAction).toEqual(
      expect.objectContaining({
        kind: "open_battle_flash",
        flashKind: "before_block",
      })
    );
    expect(
      getLegalActions({
        state: attackedState,
        actingPlayerId: "bob",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).filter((legalAction) => legalAction.kind === "block")
    ).toEqual([]);

    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(flashOpenedState.window).toBe("flash_before_block");
    expect(flashOpenedState.activeAttack?.flashWindowState).toEqual({
      kind: "before_block",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
      stackResponseSourcePlayerId: "bob",
      pendingStackAction: null,
    });

    const firstPassAction = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const passedToDefenderState = applyLegalAction({
      state: flashOpenedState,
      action: firstPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(passedToDefenderState.activeAttack?.flashWindowState).toEqual({
      kind: "before_block",
      priorityPlayerId: "alice",
      consecutivePassCount: 1,
      // 優先権を得たアクティブプレイヤーが新たな flash 宣言者になるため、
      // stackResponseSourcePlayerId は priorityPlayerId に追従する
      // (両プレイヤーが交互にフラッシュ効果を使用する優先権ループ。
      //  declarer=flash timing — model.ts / 08_stack-window-and-priority-loop.md §4)。
      stackResponseSourcePlayerId: "alice",
      pendingStackAction: null,
    });

    const secondPassAction = getLegalActions({
      state: passedToDefenderState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const flashClosedState = applyLegalAction({
      state: passedToDefenderState,
      action: secondPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(flashClosedState.window).toBe("declare_block");
    expect(flashClosedState.activeAttack?.flashBeforeBlockCompleted).toBe(true);
    expect(flashClosedState.activeAttack?.flashWindowState).toBeNull();
    expect(
      getLegalActions({
        state: flashClosedState,
        actingPlayerId: "bob",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).some((legalAction) => legalAction.kind === "block")
    ).toBe(true);
  });

  it("allows the priority player to use flash magic during battle flash and then passes priority", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const flashMagicDefinition = createDemoCardDefinition({
      cardNo: "FLASH-MAGIC-001",
      name: "Flash Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(flashMagicDefinition, {
            instanceId: "flash-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      flashMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [flashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "flash_magic_window",
      },
    });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // NEW: bob (non-active) has priority first with flash timing → can use flash magic
    const defenderFlashActions = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });

    expect(defenderFlashActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "flash-magic-1",
          timing: "flash",
        }),
        expect.objectContaining({
          kind: "pass_battle_flash",
          flashKind: "before_block",
        }),
      ])
    );

    const magicAction = defenderFlashActions.find(
      (legalAction) => legalAction.kind === "use_magic"
    );
    const flashedState = applyLegalAction({
      state: flashOpenedState,
      action: magicAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(flashedState.window).toBe("stack_before_block");
    expect(
      flashedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "flash-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "in_use",
      })
    );
    expect(
      flashedState.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();
    expect(flashedState.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    // 1-pass cascade: alice のパスでサブ窓即閉じ + 効果解決
    const subPass1Action = getLegalActions({
      state: flashedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const subPass1State = applyLegalAction({
      state: flashedState,
      action: subPass1Action!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const resolvedState = subPass1State;

    expect(resolvedState.window).toBe("flash_before_block");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "flash-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
      })
    );
    expect(
      resolvedState.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
    expect(resolvedState.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );
    expect(
      resolvedState.activeAttack?.flashWindowState?.stackResponseSourcePlayerId
    ).toBe("alice");
  });

  it("allows only the non-acting player to use stack magic in response to attack declaration during battle flash", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const flashMagicDefinition = createDemoCardDefinition({
      cardNo: "FLASH-MAGIC-RESPONSE-001",
      name: "Flash Magic Response",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "STACK-MAGIC-001",
      name: "Stack Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "stack-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(flashMagicDefinition, {
            instanceId: "flash-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      flashMagicDefinition,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [flashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "flash_magic_response_window",
      },
      [stackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_magic_window",
      },
    });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // NEW: bob (non-active) has priority first with flash timing
    const defenderFlashActions = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });

    // Bob (priority) gets flash-timing magic, NOT stack-timing magic
    expect(defenderFlashActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "flash-magic-1",
          timing: "flash",
        }),
        expect.objectContaining({
          kind: "pass_battle_flash",
          flashKind: "before_block",
        }),
      ])
    );
    expect(defenderFlashActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "stack-magic-1",
          timing: "stack",
        }),
      ])
    );

    const defenderPassAction = defenderFlashActions.find(
      (legalAction) => legalAction.kind === "pass_battle_flash"
    );
    // フラッシュ本体 (pendingStackAction === null) のパスは responseTiming = "flash"
    // (GUI は「フラッシュパス」と表示する)。
    expect(defenderPassAction).toEqual(
      expect.objectContaining({
        kind: "pass_battle_flash",
        responseTiming: "flash",
      })
    );
    const passedState = applyLegalAction({
      state: flashOpenedState,
      action: defenderPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // Alice (active, responding) gets stack timing
    const attackerFlashActions = getLegalActions({
      state: passedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });

    expect(attackerFlashActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          timing: "flash",
        }),
      ])
    );
    expect(attackerFlashActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pass_battle_flash",
          flashKind: "before_block",
        }),
      ])
    );

    // Now test: bob uses flash magic, then alice responds with stack timing
    // Re-open from flashOpenedState: bob uses flash magic
    const magicAction = defenderFlashActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "flash-magic-1"
    );
    const stackedState = applyLegalAction({
      state: flashOpenedState,
      action: magicAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(stackedState.window).toBe("stack_before_block");
    expect(
      stackedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "flash-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "in_use",
      })
    );
    expect(
      stackedState.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();
    expect(stackedState.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    // Sub-window: alice passes (pass 1)
    const subPass1Action = getLegalActions({
      state: stackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    // 内側 stack サブ窓への応答パスは responseTiming = "stack"
    // (GUI は「スタックパス」と表示する)。
    expect(subPass1Action).toEqual(
      expect.objectContaining({
        kind: "pass_battle_flash",
        responseTiming: "stack",
      })
    );
    const subPass1State = applyLegalAction({
      state: stackedState,
      action: subPass1Action!,
      getCardDefinitionById: definitionLookup,
    }).state;

    const resolvedState = subPass1State;

    expect(resolvedState.window).toBe("flash_before_block");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "flash-magic-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
      })
    );
    expect(
      resolvedState.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
  });

  it("allows stack magic to respond to another stack magic during battle flash and resolves in LIFO order", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const bobStackMagicDefinition = createDemoCardDefinition({
      cardNo: "STACK-MAGIC-NESTED-BOB-001",
      name: "Nested Stack Magic Bob",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const aliceStackMagicDefinition = createDemoCardDefinition({
      cardNo: "STACK-MAGIC-NESTED-ALICE-001",
      name: "Nested Stack Magic Alice",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(bobStackMagicDefinition, {
            instanceId: "bob-stack-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(aliceStackMagicDefinition, {
            instanceId: "alice-stack-magic-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      bobStackMagicDefinition,
      aliceStackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [bobStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "battle_flash_nested_stack_bob",
      },
      [aliceStackMagicDefinition.cardNo]: {
        // alice (アクティブ) は優先権を得て flash 本体で proactively に宣言する側
        // (declarer=flash timing)。bob はそれに応答するため stack timing。
        timing: "flash",
        reason: "battle_flash_nested_stack_alice",
      },
    });

    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // NEW: bob (non-active) has priority first with flash timing, but only has stack-timing cards → passes
    const bobPassAction = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const passedState = applyLegalAction({
      state: flashOpenedState,
      action: bobPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // Alice (active) が優先権を得て flash 本体で flash magic を能動的に宣言する。
    // 優先権保持者は宣言者なので flash timing (両プレイヤーが交互にフラッシュ効果を使用)。
    const aliceStackActions = getLegalActions({
      state: passedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    expect(aliceStackActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "alice-stack-magic-1",
          timing: "flash",
        }),
      ])
    );
    // flash 本体 (pendingStackAction なし) では宣言者は flash timing のみ。
    // stack timing は保留スタックへの応答時にだけ提供される。
    expect(aliceStackActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          timing: "stack",
        }),
      ])
    );

    const aliceStackAction = aliceStackActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "alice-stack-magic-1"
    );
    const aliceStackState = applyLegalAction({
      state: passedState,
      action: aliceStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    // Bob responds to alice's stack magic with bob-stack-magic-1
    const bobStackActions = getLegalActions({
      state: aliceStackState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    const bobStackAction = bobStackActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "bob-stack-magic-1"
    );
    const nestedStackState = applyLegalAction({
      state: aliceStackState,
      action: bobStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(
      nestedStackState.activeAttack?.flashWindowState?.pendingStackAction
        ?.cardInstanceId
    ).toBe("bob-stack-magic-1");
    expect(
      nestedStackState.activeAttack?.flashWindowState?.pendingStackAction
        ?.previousPendingStackAction?.cardInstanceId
    ).toBe("alice-stack-magic-1");

    // 1-pass cascade: alice のパスで両方の pending stack が LIFO 順で一括解決
    // （bob-stack-magic → alice-stack-magic の順でトラッシュ行き）
    const alicePassNestedAction = getLegalActions({
      state: nestedStackState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const afterAliceStackResolves = applyLegalAction({
      state: nestedStackState,
      action: alicePassNestedAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(
      afterAliceStackResolves.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-stack-magic-1"
      )?.zone
    ).toBe("trash");
    expect(
      afterAliceStackResolves.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "alice-stack-magic-1"
      )?.zone
    ).toBe("trash");
    expect(
      afterAliceStackResolves.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
  });

  it("allows the priority player to use flash field effects during battle flash and then passes priority", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
          },
          {
            lifeNormalCoreCount: 5,
          },
        ],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const fieldEffectLookup = createFieldEffectActionRegistrationLookup({
      [spiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          timing: "flash",
          reason: "flash_field_effect_window",
        },
      ],
    });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // NEW: bob (non-active) has priority first with flash timing → can use blocker-1's flash field effect
    const defenderFlashActions = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });

    expect(defenderFlashActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_field_card_effect",
          timing: "flash",
          sourceInstanceId: "blocker-1",
        }),
        expect.objectContaining({
          kind: "pass_battle_flash",
          flashKind: "before_block",
        }),
      ])
    );

    const fieldEffectAction = defenderFlashActions.find(
      (legalAction) => legalAction.kind === "use_field_card_effect"
    );
    const flashedState = applyLegalAction({
      state: flashOpenedState,
      action: fieldEffectAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === spiritDefinition.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;
    // Effect not yet resolved - verify deferred state
    expect(flashedState.window).toBe("stack_before_block");
    expect(
      flashedState.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();
    expect(flashedState.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    // 1-pass cascade: alice のパスでサブ窓が即閉じ、効果解決
    const subPassAction = getLegalActions({
      state: flashedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const resolvedState = applyLegalAction({
      state: flashedState,
      action: subPassAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === spiritDefinition.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;

    const blocker = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "blocker-1"
    );
    const bob = resolvedState.players.find((player) => player.id === "bob");

    expect(resolvedState.window).toBe("flash_before_block");
    expect(blocker?.normalCoreCount).toBe(2);
    expect(bob?.lifeNormalCoreCount).toBe(4);
    expect(
      resolvedState.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
  });

  it("lets a flash field effect join another spirit into the active attack and queues join immediate prompts during battle flash", () => {
    const attackingSpiritDefinition = createDemoCardDefinition({
      cardNo: "FLASH-JOIN-ATTACKER-001",
      name: "Flash Join Attacker",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const joiningSpiritDefinition = createDemoCardDefinition({
      cardNo: "FLASH-JOINER-001",
      name: "Flash Joiner",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const blockerDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
          },
          {
            lifeNormalCoreCount: 5,
          },
        ],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(joiningSpiritDefinition, {
            instanceId: "joiner-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(blockerDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
      joiningSpiritDefinition,
      blockerDefinition,
    ]);
    const fieldEffectLookup = createFieldEffectActionRegistrationLookup({
      [attackingSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          // alice (アクティブ) が flash 本体で能動宣言する効果。優先権保持者=宣言者=flash timing。
          timing: "flash",
          reason: "flash_join_attack_window",
          requiredTargetCount: 1,
          candidateTargetZones: ["field"],
          candidateTargetPlayerScope: "acting_player",
        },
      ],
    });
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [joiningSpiritDefinition.cardNo]: [
          {
            timing: "join",
            sourceKind: "spirit",
            reason: "join_triggered_core_gain",
          },
        ],
      });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;

    // NEW: bob (non-active) has priority first → passes
    const bobPassAction = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const bobPassedState = applyLegalAction({
      state: flashOpenedState,
      action: bobPassAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;

    // Alice (active) は優先権を得て flash 本体で attacker-1 の flash 効果を能動宣言し join する。
    const fieldEffectAction = getLegalActions({
      state: bobPassedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_field_card_effect" &&
        legalAction.sourceInstanceId === "attacker-1"
    );
    const joinedState = applyLegalAction({
      state: bobPassedState,
      action: fieldEffectAction!,
      targetInstanceIds: ["joiner-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === attackingSpiritDefinition.cardNo
          ? createTargetCardJoinActiveAttackResolver()
          : cardNo === joiningSpiritDefinition.cardNo
            ? createActingPlayerLifeCoreToSourceCardResolver({
                effectKind: "normal_only",
              })
            : undefined,
    }).state;

    // Effect not yet resolved - deferred state
    expect(
      joinedState.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();

    // 1-pass cascade: bob のパスでサブ窓即閉じ + 効果解決
    const subPassAction = getLegalActions({
      state: joinedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const effectResolvedState = applyLegalAction({
      state: joinedState,
      action: subPassAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      // 2026-07-19 (ENGINE-exhaust-third-party-opt-in-gap): join のコア支払いで joiner-1 が
      // exhaust される。lookup 省略のまま stack 解決すると raw push フォールバック
      // (queuePendingReactionsFromTriggerEvents 未配線時) が listener 有無を無視して
      // pendingTriggeredEffect を積んでしまうため、明示的に空 registration を渡す。
      getRegisteredTriggeredEffectActions: () => [],
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === attackingSpiritDefinition.cardNo
          ? createTargetCardJoinActiveAttackResolver()
          : cardNo === joiningSpiritDefinition.cardNo
            ? createActingPlayerLifeCoreToSourceCardResolver({
                effectKind: "normal_only",
              })
            : undefined,
    }).state;

    expect(effectResolvedState.activeAttack?.groupMode).toBe("simultaneous");
    expect(effectResolvedState.activeAttack?.participantEntityIds).toEqual([
      "battle-entity:attacker-1",
      "battle-entity:joiner-1",
    ]);
    expect(
      effectResolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "joiner-1"
      )?.exhaustState
    ).toBe("exhausted");
    expect(effectResolvedState.battleImmediateEffects).toEqual([
      expect.objectContaining({
        timing: "join",
        sourceInstanceId: "joiner-1",
        sourceCardNo: joiningSpiritDefinition.cardNo,
        participantEntityId: "battle-entity:joiner-1",
      }),
    ]);

    const aliceActions = getLegalActions({
      state: effectResolvedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const bobActions = getLegalActions({
      state: effectResolvedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    expect(aliceActions).toEqual([
      expect.objectContaining({
        kind: "resolve_battle_immediate_effect",
        reason: "join_triggered_core_gain",
      }),
    ]);
    expect(bobActions).toEqual([]);

    const joinImmediateAction = aliceActions.find(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );
    // P3-29 Phase 2: 発揮宣言で battle flash sub-stack 窓が開き、bob priority になる
    const declaredJoinImmediateState = applyLegalAction({
      state: effectResolvedState,
      action: joinImmediateAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === joiningSpiritDefinition.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;
    expect(declaredJoinImmediateState.window).toBe("stack_before_block");

    // bob が pass で stack 窓を閉じ、deferred resolver が走る
    const resolvedJoinImmediateState = applyLegalAction({
      state: declaredJoinImmediateState,
      action: {
        kind: "pass_battle_flash",
        actionId: "pass:bob",
        can: true,
        reason: "p3_29_test_close",
        actingPlayerId: "bob",
      },
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === joiningSpiritDefinition.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;
    const joiner = resolvedJoinImmediateState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "joiner-1"
    );
    const alice = resolvedJoinImmediateState.players.find(
      (player) => player.id === "alice"
    );

    expect(resolvedJoinImmediateState.window).toBe("flash_before_block");
    expect(resolvedJoinImmediateState.battleImmediateEffects).toEqual([]);
    expect(joiner?.normalCoreCount).toBe(2);
    expect(alice?.lifeNormalCoreCount).toBe(0);
  });

  it("allows only the non-acting player to use stack field effects in response to attack declaration during battle flash", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const defendingSpiritDefinition = createDemoCardDefinition({
      cardNo: "STACK-SPIRIT-001",
      name: "Stack Spirit",
      colors: ["red"],
      printedCategory: "spirit",
      cost: 3,
      reductionSymbols: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
          },
          {
            lifeNormalCoreCount: 5,
          },
        ],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(defendingSpiritDefinition, {
            instanceId: "defender-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
      defendingSpiritDefinition,
    ]);
    const fieldEffectLookup = createFieldEffectActionRegistrationLookup({
      [defendingSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          timing: "flash",
          reason: "flash_field_effect_response_window",
        },
        {
          sourceKind: "spirit",
          timing: "stack",
          reason: "stack_field_effect_window",
        },
      ],
    });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // NEW: bob (non-active) has priority first with flash timing
    const defenderFlashActions = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });

    // Bob (priority) gets flash-timing field effect, NOT stack-timing
    expect(defenderFlashActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_field_card_effect",
          timing: "flash",
          sourceInstanceId: "defender-1",
        }),
        expect.objectContaining({
          kind: "pass_battle_flash",
          flashKind: "before_block",
        }),
      ])
    );
    expect(defenderFlashActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_field_card_effect",
          timing: "stack",
          sourceInstanceId: "defender-1",
        }),
      ])
    );

    const defenderPassAction = defenderFlashActions.find(
      (legalAction) => legalAction.kind === "pass_battle_flash"
    );
    // フラッシュ本体 (pendingStackAction === null) のパスは responseTiming = "flash"
    // (GUI は「フラッシュパス」と表示する)。
    expect(defenderPassAction).toEqual(
      expect.objectContaining({
        kind: "pass_battle_flash",
        responseTiming: "flash",
      })
    );
    const passedState = applyLegalAction({
      state: flashOpenedState,
      action: defenderPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // Alice (active, responding) gets stack timing
    const attackerFlashActions = getLegalActions({
      state: passedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    });

    expect(attackerFlashActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_field_card_effect",
          timing: "flash",
        }),
      ])
    );
    expect(attackerFlashActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "pass_battle_flash",
          flashKind: "before_block",
        }),
      ])
    );

    // Now test: bob uses flash field effect, then alice responds with stack timing
    const fieldEffectAction = defenderFlashActions.find(
      (legalAction) =>
        legalAction.kind === "use_field_card_effect" &&
        legalAction.timing === "flash" &&
        legalAction.sourceInstanceId === "defender-1"
    );
    const stackedState = applyLegalAction({
      state: flashOpenedState,
      action: fieldEffectAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === defendingSpiritDefinition.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;
    // Effect not yet resolved - verify deferred state
    expect(stackedState.window).toBe("stack_before_block");
    expect(
      stackedState.activeAttack?.flashWindowState?.pendingStackAction
    ).not.toBeNull();
    expect(stackedState.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    // 1-pass cascade: alice のパスでサブ窓即閉じ + 効果解決
    const subPassAction = getLegalActions({
      state: stackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldEffectLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const resolvedState = applyLegalAction({
      state: stackedState,
      action: subPassAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === defendingSpiritDefinition.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver({
              effectKind: "normal_only",
            })
          : undefined,
    }).state;

    const defender = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "defender-1"
    );
    const bob = resolvedState.players.find((player) => player.id === "bob");

    expect(resolvedState.window).toBe("flash_before_block");
    expect(defender?.normalCoreCount).toBe(2);
    expect(bob?.lifeNormalCoreCount).toBe(4);
    expect(
      resolvedState.activeAttack?.flashWindowState?.pendingStackAction
    ).toBeNull();
  });

  it("keeps flash_before_block open when the attacker leaves, then auto-ends after it closes", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "STACK-MAGIC-CANCEL-ATTACK-001",
      name: "Stack Cancel Attack Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "stack-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "stack_cancel_attack_window",
        requiredTargetCount: 1,
        targetEffectFilterTags: ["general"],
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "any",
      },
    });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const attackId = attackedState.activeAttack?.attackId;
    const flashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const flashOpenedState = applyLegalAction({
      state: attackedState,
      action: flashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    // NEW: bob (non-active) has priority first with flash timing → uses flash magic to remove attacker
    const defenderFlashActions = getLegalActions({
      state: flashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    const stackMagicAction = defenderFlashActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "stack-magic-1"
    );
    const stackedState = applyLegalAction({
      state: flashOpenedState,
      action: stackMagicAction!,
      targetInstanceIds: ["attacker-1"],
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === stackMagicDefinition.cardNo
          ? createTargetCardPendingLeaveResolver({
              pendingLeaveKind: "bounce",
            })
          : undefined,
    }).state;

    // 1-pass cascade: alice のパスでサブ窓即閉じ + 効果解決（attacker-1 消滅）
    const subPassAction = getLegalActions({
      state: stackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const resolvedState = applyLegalAction({
      state: stackedState,
      action: subPassAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions:
        createTriggeredEffectActionRegistrationLookup({}),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === stackMagicDefinition.cardNo
          ? createTargetCardPendingLeaveResolver({
              pendingLeaveKind: "bounce",
            })
          : undefined,
    }).state;

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "attacker-1"
      )?.zone
    ).toBe("trash");

    // Drain any pending triggered effects and burst checks (e.g. card_bounced from the bounce leave).
    const drainedState = drainPendingReactions(resolvedState, definitionLookup);

    expect(drainedState.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "alice"
    );

    // Close the flash window: alice has priority after bob's flash resolves
    const aliceClosePassAction = getLegalActions({
      state: drainedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const passedBackState = applyLegalAction({
      state: drainedState,
      action: aliceClosePassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const bobClosePassAction = getLegalActions({
      state: passedBackState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const postFlashState = applyLegalAction({
      state: passedBackState,
      action: bobClosePassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(postFlashState.window).toBe("none");
    expect(postFlashState.activeAttack).toBeNull();
    expect(postFlashState.log).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(`attack:cancelled:${attackId}:`),
      ])
    );
    expect(postFlashState.log).toEqual(
      expect.arrayContaining([`battle:end:${attackId}`])
    );
    expect(postFlashState.log).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(`battle:resolution:life-damage:${attackId}:`),
      ])
    );
  });

  it("opens and closes flash_after_block before battle resolution can start", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const beforeFlashOpenAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const beforeFlashOpenedState = applyLegalAction({
      state: attackedState,
      action: beforeFlashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const beforeFirstPassAction = getLegalActions({
      state: beforeFlashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const beforePassedState = applyLegalAction({
      state: beforeFlashOpenedState,
      action: beforeFirstPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const beforeSecondPassAction = getLegalActions({
      state: beforePassedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const preBlockState = applyLegalAction({
      state: beforePassedState,
      action: beforeSecondPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockAction = getLegalActions({
      state: preBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: preBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup
    );

    expect(
      getLegalActions({
        state: blockedState,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).find((legalAction) => legalAction.kind === "open_battle_flash")
    ).toEqual(
      expect.objectContaining({
        kind: "open_battle_flash",
        flashKind: "after_block",
      })
    );

    const afterFlashOpenAction = getLegalActions({
      state: blockedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const afterFlashOpenedState = applyLegalAction({
      state: blockedState,
      action: afterFlashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const afterFirstPassAction = getLegalActions({
      state: afterFlashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const afterPassedState = applyLegalAction({
      state: afterFlashOpenedState,
      action: afterFirstPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const afterSecondPassAction = getLegalActions({
      state: afterPassedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const postFlashState = applyLegalAction({
      state: afterPassedState,
      action: afterSecondPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // P3-55 Phase B: after_block flash close は pass_battle_flash apply 内で
    // バトル解決まで auto-chain する。close 直後の状態は resolution 完了後 (window=none,
    // activeAttack=null) で、両者破壊の destroy 誘発が pending として並ぶ。
    expect(postFlashState.window).toBe("none");
    expect(postFlashState.activeAttack).toBeNull();
    expect(postFlashState.pendingTriggeredEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "destroy",
          source: "battle_resolution",
        }),
      ])
    );
  });

  it("keeps the block assignment when a stack magic removes the blocker before flash_after_block closes", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "STACK-MAGIC-CANCEL-BLOCK-001",
      name: "Stack Cancel Block Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        // alice (アクティブ) が flash_after_block 本体で能動宣言する。優先権保持者=宣言者=flash timing。
        timing: "flash",
        reason: "stack_cancel_block_window",
        requiredTargetCount: 1,
        targetEffectFilterTags: ["general"],
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "any",
      },
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "stack-magic-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const preBlockState = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    const blockAction = getLegalActions({
      state: preBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: preBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup
    );
    const attackId = blockedState.activeAttack?.attackId;
    const participantEntityId =
      blockedState.activeAttack?.participantEntityIds[0] ?? null;

    const afterFlashOpenAction = getLegalActions({
      state: blockedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "open_battle_flash");
    const afterFlashOpenedState = applyLegalAction({
      state: blockedState,
      action: afterFlashOpenAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // NEW: bob (non-active) has priority first → passes
    const bobPassAction = getLegalActions({
      state: afterFlashOpenedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const bobPassedState = applyLegalAction({
      state: afterFlashOpenedState,
      action: bobPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // Alice (active) は優先権を得て flash 本体で flash magic を能動宣言する。
    const attackerFlashActions = getLegalActions({
      state: bobPassedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    const stackMagicAction = attackerFlashActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "stack-magic-1"
    );
    const stackedState = applyLegalAction({
      state: bobPassedState,
      action: stackMagicAction!,
      targetInstanceIds: ["blocker-1"],
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === stackMagicDefinition.cardNo
          ? createTargetCardPendingLeaveResolver({
              pendingLeaveKind: "bounce",
            })
          : undefined,
    }).state;

    // 1-pass cascade: bob のパスでサブ窓即閉じ + 効果解決（blocker-1 消滅）
    const subPassAction = getLegalActions({
      state: stackedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const resolvedState = applyLegalAction({
      state: stackedState,
      action: subPassAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions:
        createTriggeredEffectActionRegistrationLookup({}),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === stackMagicDefinition.cardNo
          ? createTargetCardPendingLeaveResolver({
              pendingLeaveKind: "bounce",
            })
          : undefined,
    }).state;

    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "blocker-1"
      )?.zone
    ).toBe("trash");

    // Drain any pending triggered effects and burst checks (e.g. card_bounced from the bounce leave).
    const drainedState = drainPendingReactions(resolvedState, definitionLookup);

    expect(drainedState.activeAttack?.flashWindowState?.priorityPlayerId).toBe(
      "bob"
    );

    // Close the flash window: bob has priority after alice's flash resolves
    const defenderClosePassAction = getLegalActions({
      state: drainedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const passedBackState = applyLegalAction({
      state: drainedState,
      action: defenderClosePassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const attackerClosePassAction = getLegalActions({
      state: passedBackState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_battle_flash");
    const postFlashState = applyLegalAction({
      state: passedBackState,
      action: attackerClosePassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // P3-55 Phase B: after_block flash close 後にバトル解決まで auto-chain する。
    // 解決完了後は window=none, activeAttack=null, blockAssignments は activeAttack に
    // 含まれていたため参照できないが、block 系 log が残らないことを log で確認する。
    expect(postFlashState.window).toBe("none");
    expect(postFlashState.activeAttack).toBeNull();
    expect(postFlashState.log).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining(`block:cancelled:${attackId}:`),
      ])
    );
    // 解決ログ (battle:resolution:start) に participant + blocker entity が含まれる
    expect(postFlashState.log).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          `battle:resolution:start:${attackId}:${participantEntityId}`
        ),
      ])
    );
    expect(
      getLegalActions({
        state: postFlashState,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        getRegisteredMagicActions: magicLookup,
      }).find((legalAction) => legalAction.kind === "end_attack_step")
    ).toBeDefined();
  });

  it("lists ready defending spirits as block legal actions for unblocked participants", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const blockingSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(blockingSpiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
      blockingSpiritDefinition,
    ]);
    const attackState = closeAvailableBattleFlashWindow(
      fullyDeclareAttack({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById: definitionLookup,
      }).state,
      definitionLookup
    );

    const actions = getLegalActions({
      state: attackState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).filter((legalAction) => legalAction.kind === "block");

    expect(actions).toEqual([
      {
        kind: "block",
        actionId: "legal:block:blocker-1:battle-entity:attacker-1",
        can: true,
        reason: "legal_block_declaration",
        actingPlayerId: "bob",
        sourceInstanceId: "blocker-1",
        sourceDefinitionId: blockingSpiritDefinition.cardNo,
        sourceCardNo: blockingSpiritDefinition.cardNo,
        blockerEntityId: "battle-entity:blocker-1",
        participantEntityId: "battle-entity:attacker-1",
        attackId: "attack-group:2:alice:battle-entity:attacker-1",
      },
    ]);
  });

  it("declares a block by exhausting the source card and updating activeAttack.blockAssignments", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const blockingSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(blockingSpiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
      blockingSpiritDefinition,
    ]);
    const attackState = closeAvailableBattleFlashWindow(
      fullyDeclareAttack({
        state,
        actingPlayerId: "alice",
        sourceInstanceId: "attacker-1",
        getCardDefinitionById: definitionLookup,
      }).state,
      definitionLookup
    );
    const result = fullyDeclareBlock({
      state: attackState,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "battle-entity:attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    const blocker = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "blocker-1"
    );

    expect(result.attackId).toBe(
      "attack-group:2:alice:battle-entity:attacker-1"
    );
    expect(result.blockerEntityId).toBe("battle-entity:blocker-1");
    expect(result.participantEntityId).toBe("battle-entity:attacker-1");
    expect(result.state.window).toBe("declare_block");
    expect(blocker?.exhaustState).toBe("exhausted");
    expect(result.state.activeAttack?.blockAssignments).toEqual([
      {
        participantEntityId: "battle-entity:attacker-1",
        blockedByEntityIds: ["battle-entity:blocker-1"],
      },
    ]);
    expect(result.state.battleEntities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityId: "battle-entity:blocker-1",
          attackState: "blocking",
        }),
      ])
    );
    expect(result.state.log).toContain(
      "block:declare:2:bob:blocker-1:battle-entity:blocker-1:battle-entity:attacker-1:attack-group:2:alice:battle-entity:attacker-1"
    );
  });

  it("stops offering block legal actions after one block in a simultaneous attack (Q26724: capacity 1 by default)", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-2",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const attackState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyToBlockState = closeAvailableBattleFlashWindow(
      joinedState,
      definitionLookup
    );
    const firstBlockAction = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find(
      (legalAction) =>
        legalAction.kind === "block" &&
        legalAction.sourceInstanceId === "blocker-1" &&
        legalAction.participantEntityId === "battle-entity:attacker-1"
    );
    const firstBlockTentative = applyLegalAction({
      state: readyToBlockState,
      action: firstBlockAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      firstBlockTentative,
      definitionLookup
    );

    const remainingBlockActions = getLegalActions({
      state: blockedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).filter((legalAction) => legalAction.kind === "block");

    // P2-05 / 公式 Q26724: 複数体の同時アタックには、効果による拡張
    // (allow_simultaneous_attack の blockerCapacity) が無い限り group 全体で
    // 1 体しかブロックできない。1 件宣言済みのため追加 block は出ない。
    // 正源: 10_rules/05 §複数体同時アタック。
    expect(remainingBlockActions).toEqual([]);
  });

  it("queues attack-triggered battle immediate effects after attack declaration and resolves them through legal actions", () => {
    const attackingSpiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 2,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(attackingSpiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(createDemoSpiritDefinition(), {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackingSpiritDefinition,
    ]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [attackingSpiritDefinition.cardNo]: [
          {
            timing: "attack",
            sourceKind: "spirit",
            reason: "attack_triggered_core_gain",
          },
        ],
      });
    const attackAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((legalAction) => legalAction.kind === "attack");
    const attackedState = fullyConfirmPreDeclarationStack(
      applyLegalAction({
        state,
        action: attackAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      }).state,
      definitionLookup,
      battleImmediateLookup
    );

    expect(attackedState.battleImmediateEffects).toEqual([
      expect.objectContaining({
        timing: "attack",
        sourceInstanceId: "attacker-1",
        sourceCardNo: attackingSpiritDefinition.cardNo,
        participantEntityId: "battle-entity:attacker-1",
      }),
    ]);

    const attackTriggeredAction = getLegalActions({
      state: attackedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );
    const lifeCoreResolver = (cardNo: string) =>
      cardNo === attackingSpiritDefinition.cardNo
        ? createActingPlayerLifeCoreToSourceCardResolver({
            effectKind: "normal_only",
          })
        : undefined;
    // 発揮宣言でスタック窓が開く (02:200) → 相手 pass でクローズして解決まで進める。
    const declaredState = applyLegalAction({
      state: attackedState,
      action: attackTriggeredAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: lifeCoreResolver,
    }).state;
    const resolvedState = closeBattleImmediateStackWindow({
      state: declaredState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: lifeCoreResolver,
      getRegisteredTriggeredEffectActions:
        createTriggeredEffectActionRegistrationLookup({}),
    });
    const alice = resolvedState.players.find((player) => player.id === "alice");
    const attacker = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "attacker-1"
    );

    expect(alice?.lifeNormalCoreCount).toBe(1);
    expect(attacker?.normalCoreCount).toBe(2);
    expect(resolvedState.battleImmediateEffects).toEqual([]);
    expect(resolvedState.pendingTriggeredEffects).toEqual([]);
    expect(resolvedState.pendingBurstChecks).toEqual([
      expect.objectContaining({
        eventKind: "reduce_life",
        source: "action_resolution",
        actingPlayerId: "alice",
        relatedPlayerId: "alice",
        relatedInstanceId: "attacker-1",
        amount: 1,
      }),
    ]);
    expect(
      resolvedState.log.some((entry) =>
        entry.startsWith("battle:immediate:declare:")
      )
    ).toBe(true);
  });

  it("queues battle-triggered battle immediate effects after block declaration", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [spiritDefinition.cardNo]: [
          {
            timing: "battle",
            sourceKind: "spirit",
            reason: "battle_triggered_prompt",
          },
        ],
      });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    const readyToBlockState = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    const blockAction = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: readyToBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup,
      battleImmediateLookup
    );

    expect(blockedState.battleImmediateEffects).toEqual([
      expect.objectContaining({
        timing: "battle",
        sourceInstanceId: "blocker-1",
        sourceCardNo: spiritDefinition.cardNo,
        actingPlayerId: "bob",
        participantEntityId: "battle-entity:blocker-1",
      }),
    ]);
  });

  it("lets the turn player choose the resolution order of simultaneous attack-triggered effects", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [spiritDefinition.cardNo]: [
          {
            timing: "attack",
            sourceKind: "spirit",
          },
        ],
      });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackedState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;

    const beforeActions = getLegalActions({
      state: joinedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).filter(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );

    expect(beforeActions.map((action) => action.sourceInstanceId)).toEqual([
      "attacker-1",
      "attacker-2",
    ]);

    // 1 件目 (attacker-2) を発揮宣言 → スタック窓 → 相手 pass でクローズして解決。
    const firstDeclared = applyLegalAction({
      state: joinedState,
      action: beforeActions[1]!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const firstChosenResult = closeBattleImmediateStackWindow({
      state: firstDeclared,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const remainingActions = getLegalActions({
      state: firstChosenResult,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).filter(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );

    expect(firstChosenResult.battleImmediateEffects).toHaveLength(1);
    expect(remainingActions).toHaveLength(1);
    expect(remainingActions[0]?.sourceInstanceId).toBe("attacker-1");
  });

  it("queues join-triggered battle immediate effects when a participant enters an active attack mid-battle", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [spiritDefinition.cardNo]: [
          {
            timing: "join",
            sourceKind: "spirit",
            reason: "join_triggered_core_gain",
          },
        ],
      });
    const attackState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;

    expect(joinedState.battleImmediateEffects).toEqual([
      expect.objectContaining({
        timing: "join",
        sourceInstanceId: "attacker-2",
        sourceCardNo: spiritDefinition.cardNo,
        participantEntityId: "battle-entity:attacker-2",
      }),
    ]);

    const joinTriggeredAction = getLegalActions({
      state: joinedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );
    const joinLifeCoreResolver = (cardNo: string) =>
      cardNo === spiritDefinition.cardNo
        ? createActingPlayerLifeCoreToSourceCardResolver({
            effectKind: "normal_only",
          })
        : undefined;
    const joinDeclaredState = applyLegalAction({
      state: joinedState,
      action: joinTriggeredAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: joinLifeCoreResolver,
    }).state;
    const resolvedState = closeBattleImmediateStackWindow({
      state: joinDeclaredState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: joinLifeCoreResolver,
    });
    const alice = resolvedState.players.find((player) => player.id === "alice");
    const joiningAttacker = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "attacker-2"
    );

    expect(alice?.lifeNormalCoreCount).toBe(0);
    expect(joiningAttacker?.normalCoreCount).toBe(2);
    expect(resolvedState.battleImmediateEffects).toEqual([]);
  });

  it("does not expose block legal actions while attack-triggered battle immediate effects are pending", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [spiritDefinition.cardNo]: [
          {
            timing: "attack",
            sourceKind: "spirit",
          },
        ],
      });
    const attackState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;

    const defendingActionsWhilePending = getLegalActions({
      state: attackState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    expect(defendingActionsWhilePending).toEqual([]);

    const immediateAction = getLegalActions({
      state: attackState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );
    const immediateDeclaredState = applyLegalAction({
      state: attackState,
      action: immediateAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const resolvedState = closeBattleImmediateStackWindow({
      state: immediateDeclaredState,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const readyToBlockState = closeAvailableBattleFlashWindow(
      resolvedState,
      definitionLookup
    );
    const defendingActionsAfterResolution = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).filter((legalAction) => legalAction.kind === "block");

    expect(defendingActionsAfterResolution).toHaveLength(1);
  });

  it("exposes a decline_block legal action to the defender once before_block flash closes (P3-55 Phase B)", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyForResolutionState = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );

    // P3-55 Phase B: 旧 start_battle_resolution (active 側) は廃止。
    // before_block flash 完了後は defender (bob) の decline_block で直接バトル解決を発火する。
    const defenderActions = getLegalActions({
      state: readyForResolutionState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    expect(defenderActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "decline_block",
          attackId: readyForResolutionState.activeAttack?.attackId,
          actingPlayerId: "bob",
        }),
      ])
    );

    // active 側 (alice) には decline_block / start_battle_resolution どちらも提示されない。
    const activePlayerActions = getLegalActions({
      state: readyForResolutionState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    expect(activePlayerActions.some((a) => a.kind === "decline_block")).toBe(
      false
    );
  });

  it("creates a battleResolutionGroup snapshot for blocked and unblocked participants", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackedState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyToBlockState = closeAvailableBattleFlashWindow(
      joinedState,
      definitionLookup
    );
    const blockAction = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: readyToBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup
    );
    const attackId = blockedState.activeAttack?.attackId;
    // P3-55 Phase B: after_block flash close で auto-chain によりバトル解決まで完了する。
    // 旧中継 kind が保持していた battleResolutionGroup snapshot は log 行で痕跡を確認する。
    const resolutionState = closeAvailableBattleFlashWindow(
      blockedState,
      definitionLookup
    );

    expect(resolutionState.window).toBe("none");
    expect(resolutionState.battleResolutionGroup).toBeNull();
    expect(resolutionState.log).toContain(
      `battle:resolution:start:${attackId}:battle-entity:attacker-1,battle-entity:attacker-2`
    );
    expect(resolutionState.log).toContain(
      `battle:resolution:bp-compare:${attackId}:battle-entity:attacker-1:battle-entity:blocker-1:2000:2000:both_destroyed`
    );
  });

  it("resolves grouped life damage and blocked BP comparison from battleResolutionGroup", () => {
    const strongAttackerDefinition = createDemoCardDefinition({
      cardNo: "ATTACKER-STRONG-001",
      name: "Strong Attacker",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const weakAttackerDefinition = createDemoCardDefinition({
      cardNo: "ATTACKER-WEAK-001",
      name: "Weak Attacker",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const weakBlockerDefinition = createDemoCardDefinition({
      cardNo: "BLOCKER-WEAK-001",
      name: "Weak Blocker",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 5,
            reserveNormalCoreCount: 0,
          },
          {
            lifeNormalCoreCount: 2,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(strongAttackerDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(weakAttackerDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(weakBlockerDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      strongAttackerDefinition,
      weakAttackerDefinition,
      weakBlockerDefinition,
    ]);
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackedState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyToBlockState = closeAvailableBattleFlashWindow(
      joinedState,
      definitionLookup
    );
    const blockAction = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: readyToBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup
    );
    const attackId = blockedState.activeAttack?.attackId;
    // P3-55 Phase B: after_block flash close で auto-chain によりバトル解決まで完了する。
    // 旧 result.totalLifeDamage / result.destroyedEntityIds は state 側 assertion で代替確認。
    const resolvedState = closeAvailableBattleFlashWindow(
      blockedState,
      definitionLookup
    );

    expect(resolvedState.window).toBe("none");
    expect(resolvedState.activeAttack).toBeNull();
    expect(resolvedState.battleResolutionGroup).toBeNull();
    expect(resolvedState.players.find((player) => player.id === "bob")).toEqual(
      expect.objectContaining({
        lifeNormalCoreCount: 1,
        reserveNormalCoreCount: 2,
      })
    );
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "blocker-1"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "trash",
        normalCoreCount: 0,
      })
    );
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "attacker-1"
      )
    ).toEqual(expect.objectContaining({ zone: "field" }));
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "attacker-2"
      )
    ).toEqual(expect.objectContaining({ zone: "field" }));
    expect(resolvedState.log).toContain(
      `battle:resolution:life-damage:${attackId}:bob:1`
    );
    expect(resolvedState.log).toContain(
      `battle:resolution:bp-compare:${attackId}:battle-entity:attacker-1:battle-entity:blocker-1:3000:1000:blocker_destroyed`
    );
    expect(resolvedState.log).toContain(`battle:resolution:end:${attackId}`);
    expect(resolvedState.log).toContain(`battle:end:${attackId}`);
    expect(resolvedState.log).toContain(`attack:end:${attackId}`);
    expect(resolvedState.log.indexOf(`battle:end:${attackId}`)).toBeLessThan(
      resolvedState.log.indexOf(`attack:end:${attackId}`)
    );
  });

  it("keeps simultaneous mixed battle reactions hidden until grouped resolution fully completes", () => {
    const strongAttackerDefinition = createDemoCardDefinition({
      cardNo: "SIMUL-ATTACKER-STRONG-001",
      name: "Simultaneous Strong Attacker",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const weakAttackerDefinition = createDemoCardDefinition({
      cardNo: "SIMUL-ATTACKER-WEAK-001",
      name: "Simultaneous Weak Attacker",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const weakBlockerDefinition = createDemoCardDefinition({
      cardNo: "SIMUL-BLOCKER-WEAK-001",
      name: "Simultaneous Weak Blocker",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    });
    const triggerSourceDefinition = createDemoCardDefinition({
      cardNo: "SIMUL-TRIGGER-SOURCE-001",
      name: "Simultaneous Trigger Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const burstSourceDefinition = createDemoCardDefinition({
      cardNo: "SIMUL-BURST-SOURCE-001",
      name: "Simultaneous Burst Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const definitionLookup = createDefinitionLookup([
      strongAttackerDefinition,
      weakAttackerDefinition,
      weakBlockerDefinition,
      triggerSourceDefinition,
      burstSourceDefinition,
    ]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            reason: "legal_simultaneous_life_reduced_trigger",
          },
          {
            sourceKind: "spirit",
            eventKind: "destroy",
            reason: "legal_simultaneous_destroy_trigger",
          },
        ],
      });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSourceDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          reason: "legal_simultaneous_life_reduced_burst",
        },
      ],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 2,
            reserveNormalCoreCount: 0,
          },
          {
            lifeNormalCoreCount: 2,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(strongAttackerDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(weakAttackerDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(weakBlockerDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(triggerSourceDefinition, {
            instanceId: "trigger-source-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(burstSourceDefinition, {
            instanceId: "burst-source-1",
            ownerPlayerId: "bob",
            zone: "burst",
          }),
        ],
        setBurstStates: [
          {
            playerId: "bob",
            cardInstanceId: "burst-source-1",
          },
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackedState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyToBlockState = closeAvailableBattleFlashWindow(
      joinedState,
      definitionLookup
    );
    const blockAction = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: readyToBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup
    );
    // P3-55 Phase B: after_block flash close で auto-chain によりバトル解決まで完了する。
    const battleResolvedState = closeAvailableBattleFlashWindow(
      blockedState,
      definitionLookup
    );

    expect(battleResolvedState.pendingTriggeredEffects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "reduce_life",
          source: "battle_resolution",
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
          amount: 1,
        }),
        expect.objectContaining({
          eventKind: "destroy",
          source: "battle_resolution",
          actingPlayerId: "bob",
          relatedInstanceId: "blocker-1",
        }),
      ])
    );
    // 待機入りの破壊と実移動後の離脱・トラッシュ増加は別イベント。同じバトル束を保つ。
    expect(battleResolvedState.pendingTriggeredEffects).toHaveLength(4);
    expect(
      battleResolvedState.pendingTriggeredEffects.map(
        (effect) => effect.eventKind
      )
    ).toEqual(expect.arrayContaining(["trash_increase", "leave_field"]));
    expect(
      new Set(
        battleResolvedState.pendingTriggeredEffects.map(
          (effect) => effect.simultaneousGroupId
        )
      ).size
    ).toBe(1);
    expect(
      battleResolvedState.pendingTriggeredEffects.every(
        (effect) => effect.source === "battle_resolution"
      )
    ).toBe(true);
    expect(battleResolvedState.pendingBurstChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventKind: "reduce_life",
          source: "battle_resolution",
          actingPlayerId: "bob",
          relatedPlayerId: "bob",
          amount: 1,
        }),
      ])
    );
    // life_reduced + leave_field (from card_destroyed)
    expect(
      battleResolvedState.pendingBurstChecks.length
    ).toBeGreaterThanOrEqual(1);

    const aliceActionsBeforeBurst = getLegalActions({
      state: battleResolvedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(aliceActionsBeforeBurst).toEqual([]);

    const bobBurstActions = getLegalActions({
      state: battleResolvedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    expect(bobBurstActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "resolve_pending_burst_check",
          reason: "legal_simultaneous_life_reduced_burst",
        }),
        expect.objectContaining({ kind: "decline_pending_burst_check" }),
      ])
    );

    const settledState = drainPendingReactions(
      battleResolvedState,
      definitionLookup,
      {
        getRegisteredBurstActions,
      }
    );
    expect(settledState.pendingBurstChecks).toEqual([]);
    expect(settledState.pendingTriggeredEffects).toEqual([]);
    expect(
      settledState.log.some((entry) => entry.startsWith("burst:resolved:"))
    ).toBe(true);
  });

  it("aggregates simultaneous unblocked life damage into one post-resolution wait", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 2,
            reserveNormalCoreCount: 0,
          },
          {
            lifeNormalCoreCount: 3,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-2",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);

    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const joinedState = joinActiveAttackAsAction({
      state: attackedState,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-2",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyForResolutionState = closeAvailableBattleFlashWindow(
      joinedState,
      definitionLookup
    );
    // P3-55 Phase B: ブロック宣言なしのケースでは defender (bob) の decline_block apply で
    // バトル解決まで一括完了する。
    const declineAction = getLegalActions({
      state: readyForResolutionState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "decline_block");
    const battleResolvedState = applyLegalAction({
      state: readyForResolutionState,
      action: declineAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(battleResolvedState.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        eventKind: "reduce_life",
        source: "battle_resolution",
        actingPlayerId: "bob",
        relatedPlayerId: "bob",
        amount: 2,
      }),
    ]);
    expect(battleResolvedState.pendingBurstChecks).toEqual([
      expect.objectContaining({
        eventKind: "reduce_life",
        source: "battle_resolution",
        actingPlayerId: "bob",
        relatedPlayerId: "bob",
        amount: 2,
      }),
    ]);
  });

  it("ends the game immediately when lethal life damage is applied", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          { lifeNormalCoreCount: 5, reserveNormalCoreCount: 0 },
          { lifeNormalCoreCount: 1, reserveNormalCoreCount: 0 },
        ],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);

    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyForResolutionState = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    const declineAction = getLegalActions({
      state: readyForResolutionState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((legalAction) => legalAction.kind === "decline_block");
    const battleResolvedState = applyLegalAction({
      state: readyForResolutionState,
      action: declineAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // ライフ0は誘発やバーストの解決を待たず敗北が確定する。
    expect(
      battleResolvedState.players.find((p) => p.id === "bob")
        ?.lifeNormalCoreCount
    ).toBe(0);

    expect(battleResolvedState.gameResult).toEqual({
      kind: "player_loss",
      losingPlayerId: "bob",
      reason: "life_zero",
    });
  });

  it("queues block-triggered battle immediate effects after block declaration and resolves them through legal actions", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [
          {
            lifeNormalCoreCount: 1,
            reserveNormalCoreCount: 0,
          },
          {
            lifeNormalCoreCount: 1,
            reserveNormalCoreCount: 0,
          },
        ],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [spiritDefinition.cardNo]: [
          {
            timing: "block",
            sourceKind: "spirit",
            reason: "block_triggered_core_gain",
          },
        ],
      });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    const readyToBlockState = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    const blockAction = getLegalActions({
      state: readyToBlockState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((legalAction) => legalAction.kind === "block");
    const blockTentative = applyLegalAction({
      state: readyToBlockState,
      action: blockAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).state;
    const blockedState = fullyConfirmPreDeclarationStack(
      blockTentative,
      definitionLookup,
      battleImmediateLookup
    );

    expect(blockedState.battleImmediateEffects).toEqual([
      expect.objectContaining({
        timing: "block",
        sourceInstanceId: "blocker-1",
        sourceCardNo: spiritDefinition.cardNo,
        participantEntityId: "battle-entity:blocker-1",
      }),
    ]);

    const attackerSideActions = getLegalActions({
      state: blockedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).filter(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );
    const blockerSideAction = getLegalActions({
      state: blockedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );

    expect(attackerSideActions).toEqual([]);
    expect(blockerSideAction).toEqual(
      expect.objectContaining({
        timing: "block",
        sourceInstanceId: "blocker-1",
      })
    );

    const blockLifeCoreResolver = (cardNo: string) =>
      cardNo === spiritDefinition.cardNo
        ? createActingPlayerLifeCoreToSourceCardResolver({
            effectKind: "normal_only",
          })
        : undefined;
    const blockDeclaredState = applyLegalAction({
      state: blockedState,
      action: blockerSideAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: blockLifeCoreResolver,
    }).state;
    const resolvedState = closeBattleImmediateStackWindow({
      state: blockDeclaredState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: blockLifeCoreResolver,
    });
    const bob = resolvedState.players.find((player) => player.id === "bob");
    const blocker = resolvedState.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "blocker-1"
    );

    expect(bob?.lifeNormalCoreCount).toBe(0);
    expect(blocker?.normalCoreCount).toBe(2);
    expect(resolvedState.battleImmediateEffects).toEqual([]);
    expect(
      resolvedState.log.some((entry) =>
        entry.startsWith("battle:immediate:declare:")
      )
    ).toBe(true);
  });

  it("keeps selected burst effects behind pending triggered effects until the trigger queue is cleared", () => {
    const triggerSpiritDefinition = createDemoCardDefinition({
      cardNo: "TRIGGER-BEFORE-BURST-001",
      name: "Trigger Before Burst Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-REVEAL-ORDER-001",
      name: "Burst Reveal Order Spirit",
      printedCategory: "spirit",
      textLines: ["〖バースト：自分のライフ減少後〗1枚ドローする。"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([
      triggerSpiritDefinition,
      burstSpiritDefinition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(triggerSpiritDefinition, {
          instanceId: "trigger-source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-source-order-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        {
          playerId: "alice",
          cardInstanceId: "burst-source-order-1",
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:pending-before-burst",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:14074",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedSourceInstanceIds: [],
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:pending-after-trigger",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:14090",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSpiritDefinition.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
          },
        ],
      });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });

    const initialLegalActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(initialLegalActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "resolve_pending_burst_check",
          sourceInstanceId: "burst-source-order-1",
        }),
        expect.objectContaining({ kind: "decline_pending_burst_check" }),
      ])
    );
    expect(state.revealedBurstStates).toEqual([]);

    const triggerResolverLookup = (cardNo: string) =>
      cardNo === triggerSpiritDefinition.cardNo
        ? (currentState: ReturnType<typeof createEmptyGameState>) =>
            currentState
        : undefined;
    const burstResolverLookup = (cardNo: string) =>
      cardNo === burstSpiritDefinition.cardNo
        ? (currentState: ReturnType<typeof createEmptyGameState>) =>
            currentState
        : undefined;
    const resolverLookup = (cardNo: string) =>
      triggerResolverLookup(cardNo) ?? burstResolverLookup(cardNo);

    const burstLegalAction = initialLegalActions.find(
      (legalAction) => legalAction.kind === "resolve_pending_burst_check"
    );
    const burstSelectedState = applyLegalAction({
      state,
      action: burstLegalAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: burstResolverLookup,
    }).state;

    expect(burstSelectedState.stackWindow?.burstWindowKind).toBe("activation");
    expect(burstSelectedState.revealedBurstStates).toEqual([
      {
        playerId: "alice",
        cardInstanceId: "burst-source-order-1",
        checkId: "burst:pending-after-trigger",
        activationPending: true,
      },
    ]);

    const afterActivationWindow = resolveStackIfOpen({
      state: burstSelectedState,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: burstResolverLookup,
    });

    expect(
      afterActivationWindow.pendingStackCascade?.remainingStacks[0]
    ).toMatchObject({
      actionKind: "burst_activation",
      burstEffectDeclarationPending: true,
    });

    const triggerLegalActions = getLegalActions({
      state: afterActivationWindow,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    }).filter(
      (legalAction) => legalAction.kind === "resolve_pending_triggered_effect"
    );

    expect(triggerLegalActions).toEqual([
      expect.objectContaining({
        sourceInstanceId: "trigger-source-1",
      }),
    ]);

    const triggerDeclaredState = applyLegalAction({
      state: afterActivationWindow,
      action: triggerLegalActions[0]!,
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;
    const burstResolvedState = fullyResolveMainStepStack({
      state: triggerDeclaredState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });

    expect(burstResolvedState.log).toContain(
      "burst:revealed:burst:pending-after-trigger:burst-source-order-1:alice"
    );
  });

  it("opens a pre-declaration stack window when attack is tentatively declared", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });

    expect(tentativeState.window).toBe("pre_declaration_stack");
    expect(tentativeState.preDeclarationStackWindow).toMatchObject({
      kind: "attack",
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      priorityPlayerId: "bob",
      consecutivePassCount: 0,
    });
    expect(tentativeState.activeAttack).toBeNull();
    const attacker = tentativeState.cardInstances.find(
      (c) => c.instanceId === "attacker-1"
    );
    expect(attacker?.exhaustState).toBe("recovered");
  });

  it("confirms attack declaration after opponent passes the pre-declaration stack", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    const afterPass = usePassPreDeclarationStackAsAction({
      state: tentativeState,
      actingPlayerId: "bob",
    });

    expect(afterPass.outcome).toBe("stack_closed");
    expect(afterPass.closedWindow).not.toBeNull();

    const confirmResult = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: definitionLookup }
    );

    expect(confirmResult.state.window).toBe("declare_attack");
    expect(confirmResult.state.preDeclarationStackWindow).toBeNull();
    expect(confirmResult.state.activeAttack).not.toBeNull();
    const attacker = confirmResult.state.cardInstances.find(
      (c) => c.instanceId === "attacker-1"
    );
    expect(attacker?.exhaustState).toBe("exhausted");
  });

  it("cancels attack declaration when attacker leaves field during pre-declaration stack", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    // Simulate attacker leaving field during the stack window
    const stateWithAttackerGone: GameState = {
      ...tentativeState,
      cardInstances: tentativeState.cardInstances.map((c) =>
        c.instanceId === "attacker-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const afterPass = usePassPreDeclarationStackAsAction({
      state: stateWithAttackerGone,
      actingPlayerId: "bob",
    });
    const cancelResult = confirmAttackDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: definitionLookup }
    );

    // Cancelled: window restored to previous (attack declaration requires window "none"),
    // no activeAttack
    expect(cancelResult.state.window).toBe("none");
    expect(cancelResult.state.preDeclarationStackWindow).toBeNull();
    expect(cancelResult.state.activeAttack).toBeNull();
    expect(cancelResult.attackId).toBe("");
  });

  it("opens a pre-declaration stack window when block is tentatively declared", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const afterFlash = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    const tentativeBlockState = useBlockAsAction({
      state: afterFlash,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "battle-entity:attacker-1",
      getCardDefinitionById: definitionLookup,
    });

    expect(tentativeBlockState.window).toBe("pre_declaration_stack");
    expect(tentativeBlockState.preDeclarationStackWindow).toMatchObject({
      kind: "block",
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "battle-entity:attacker-1",
      priorityPlayerId: "alice",
      consecutivePassCount: 0,
    });
    const blocker = tentativeBlockState.cardInstances.find(
      (c) => c.instanceId === "blocker-1"
    );
    expect(blocker?.exhaustState).toBe("recovered");
  });

  it("cancels block declaration when blocker leaves field during pre-declaration stack", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const afterFlash = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    const tentativeBlockState = useBlockAsAction({
      state: afterFlash,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "battle-entity:attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    // Simulate blocker leaving field
    const stateWithBlockerGone: GameState = {
      ...tentativeBlockState,
      cardInstances: tentativeBlockState.cardInstances.map((c) =>
        c.instanceId === "blocker-1" ? { ...c, zone: "trash" as const } : c
      ),
    };
    const afterPass = usePassPreDeclarationStackAsAction({
      state: stateWithBlockerGone,
      actingPlayerId: "alice",
    });
    const cancelResult = confirmBlockDeclarationAsAction(
      afterPass.closedWindow!,
      afterPass.state,
      { getCardDefinitionById: definitionLookup }
    );

    // Cancelled: block declaration window remains open.
    expect(cancelResult.state.window).toBe("declare_block");
    expect(cancelResult.state.preDeclarationStackWindow).toBeNull();
    expect(cancelResult.blockerEntityId).toBe("");
    // Block assignment still unblocked
    expect(
      cancelResult.state.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual([]);
  });

  it("only exposes pass_pre_declaration_stack for the priority player during pre-declaration stack", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });

    // Bob (opponent) has priority first
    const bobActions = getLegalActions({
      state: tentativeState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    expect(bobActions).toHaveLength(1);
    expect(bobActions[0]).toMatchObject({
      kind: "pass_pre_declaration_stack",
      actingPlayerId: "bob",
      declarationKind: "attack",
    });

    // Alice (declarer) has no actions yet
    const aliceActions = getLegalActions({
      state: tentativeState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    expect(aliceActions).toHaveLength(0);
  });

  it("opens a sub-stack when the opponent uses stack magic during the pre-declaration stack window", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "PRE-DEC-STACK-MAGIC-001",
      name: "Stack Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "stack-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_magic_pre_declaration",
      },
    });

    // Alice tentatively declares attack → Bob has priority
    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });

    // Bob can use stack magic
    const bobActions = getLegalActions({
      state: tentativeState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    const magicAction = bobActions.find((a) => a.kind === "use_magic");
    expect(magicAction).toBeDefined();
    expect(magicAction).toMatchObject({
      kind: "use_magic",
      timing: "stack",
      sourceInstanceId: "stack-magic-1",
    });

    // Bob uses the magic → sub-stack opens
    const afterMagicState = applyLegalAction({
      state: tentativeState,
      action: magicAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(
      afterMagicState.preDeclarationStackWindow?.pendingStackAction
    ).not.toBeNull();
    expect(afterMagicState.preDeclarationStackWindow?.priorityPlayerId).toBe(
      "alice"
    ); // declarer responds
    expect(
      afterMagicState.preDeclarationStackWindow?.consecutivePassCount
    ).toBe(0);
    expect(
      afterMagicState.cardInstances.find(
        (c) => c.instanceId === "stack-magic-1"
      )?.zone
    ).toBe("in_use");
  });

  it("resolves sub-stack magic and closes the pre-declaration stack on a single pass (1-pass cascade)", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "PRE-DEC-STACK-MAGIC-002",
      name: "Stack Magic 2",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "stack-magic-2",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_magic_pre_declaration",
      },
    });

    // Tentative attack → Bob uses magic → sub-stack open (Alice has priority, count=0)
    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    const magicAction = getLegalActions({
      state: tentativeState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "use_magic");
    const subStackState = applyLegalAction({
      state: tentativeState,
      action: magicAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    // 1-pass cascade: alice のパスで sub-stack 解決 + pre-declaration 窓も同時クローズ
    const alicePassAction = getLegalActions({
      state: subStackState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "pass_pre_declaration_stack");
    const afterCascadeResolved = applyLegalAction({
      state: subStackState,
      action: alicePassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // pre-declaration stack closed; attack declaration confirmed; magic in trash
    expect(afterCascadeResolved.preDeclarationStackWindow).toBeNull();
    expect(afterCascadeResolved.pendingPreDeclarationConfirmation).toBeNull();
    expect(afterCascadeResolved.window).toBe("declare_attack");
    expect(afterCascadeResolved.activeAttack).not.toBeNull();
    expect(
      afterCascadeResolved.cardInstances.find(
        (c) => c.instanceId === "stack-magic-2"
      )?.zone
    ).toBe("trash");
  });

  it("resolves a pre-declaration stack response before confirming a block exactly once", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "PRE-DEC-STACK-BLOCK-MAGIC-001",
      name: "Block Stack Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(spiritDefinition, {
            instanceId: "blocker-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "alice-block-stack-magic-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_magic_pre_declaration_block",
      },
    });
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const afterFlash = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    const tentativeBlockState = useBlockAsAction({
      state: afterFlash,
      actingPlayerId: "bob",
      sourceInstanceId: "blocker-1",
      participantEntityId: "battle-entity:attacker-1",
      getCardDefinitionById: definitionLookup,
    });

    const stackMagicAction = getLegalActions({
      state: tentativeBlockState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "alice-block-stack-magic-1"
    );
    expect(stackMagicAction).toBeDefined();
    const subStackState = applyLegalAction({
      state: tentativeBlockState,
      action: stackMagicAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    const bobPassAction = getLegalActions({
      state: subStackState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((action) => action.kind === "pass_pre_declaration_stack");
    expect(bobPassAction).toBeDefined();
    const resolved = applyLegalAction({
      state: subStackState,
      action: bobPassAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(resolved.preDeclarationStackWindow).toBeNull();
    expect(resolved.pendingPreDeclarationConfirmation).toBeNull();
    expect(resolved.window).toBe("declare_block");
    expect(
      resolved.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual(["battle-entity:blocker-1"]);
    expect(
      resolved.cardInstances.find((card) => card.instanceId === "blocker-1")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("allows stack magic to respond to another stack magic during the pre-declaration stack window and resolves in LIFO order", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const bobStackMagicDefinition = createDemoCardDefinition({
      cardNo: "PRE-DEC-STACK-MAGIC-003-BOB",
      name: "Stack Magic 3 Bob",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const aliceStackMagicDefinition = createDemoCardDefinition({
      cardNo: "PRE-DEC-STACK-MAGIC-003-ALICE",
      name: "Stack Magic 3 Alice",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(bobStackMagicDefinition, {
            instanceId: "bob-stack-magic-3",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(aliceStackMagicDefinition, {
            instanceId: "alice-stack-magic-3",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      bobStackMagicDefinition,
      aliceStackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [bobStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_magic_pre_declaration_bob",
      },
      [aliceStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_magic_pre_declaration_alice",
      },
    });

    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    const bobStackAction = getLegalActions({
      state: tentativeState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "bob-stack-magic-3"
    );
    const bobStackState = applyLegalAction({
      state: tentativeState,
      action: bobStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    const aliceStackActions = getLegalActions({
      state: bobStackState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    expect(aliceStackActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "alice-stack-magic-3",
          timing: "stack",
        }),
      ])
    );
    expect(aliceStackActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          timing: "flash",
        }),
      ])
    );

    const aliceStackAction = aliceStackActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "alice-stack-magic-3"
    );
    const nestedStackState = applyLegalAction({
      state: bobStackState,
      action: aliceStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(
      nestedStackState.preDeclarationStackWindow?.pendingStackAction
        ?.cardInstanceId
    ).toBe("alice-stack-magic-3");
    expect(
      nestedStackState.preDeclarationStackWindow?.pendingStackAction
        ?.previousPendingStackAction?.cardInstanceId
    ).toBe("bob-stack-magic-3");

    // 1-pass cascade: bob のパスで全 pending スタックが LIFO 順に一括解決され、
    // pre-declaration 窓も同時にクローズして宣言確定に進む
    const bobPassNestedAction = getLegalActions({
      state: nestedStackState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((legalAction) => legalAction.kind === "pass_pre_declaration_stack");
    const afterCascadeResolved = applyLegalAction({
      state: nestedStackState,
      action: bobPassNestedAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(
      afterCascadeResolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "alice-stack-magic-3"
      )?.zone
    ).toBe("trash");
    expect(
      afterCascadeResolved.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-stack-magic-3"
      )?.zone
    ).toBe("trash");
    expect(afterCascadeResolved.preDeclarationStackWindow).toBeNull();
  });

  it("confirms attack declaration after sub-stack resolves and both players pass the outer stack", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "PRE-DEC-STACK-MAGIC-004",
      name: "Stack Magic 4",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "stack-magic-4",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      spiritDefinition,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_magic_pre_declaration",
      },
    });

    // Tentative attack → Bob uses magic → sub-stack open
    const tentativeState = useAttackAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    });
    const magicAction = getLegalActions({
      state: tentativeState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "use_magic");
    const subStackOpenState = applyLegalAction({
      state: tentativeState,
      action: magicAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    // 1-pass cascade: alice のパスでサブスタック解決 + 窓クローズ + 宣言確定が連鎖
    const alicePass = getLegalActions({
      state: subStackOpenState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "pass_pre_declaration_stack");
    const confirmedState = applyLegalAction({
      state: subStackOpenState,
      action: alicePass!,
      getCardDefinitionById: definitionLookup,
    }).state;

    // Attack confirmed: attacker is exhausted and activeAttack is set
    expect(confirmedState.preDeclarationStackWindow).toBeNull();
    expect(confirmedState.activeAttack).not.toBeNull();
    expect(
      confirmedState.cardInstances.find((c) => c.instanceId === "attacker-1")
        ?.exhaustState
    ).toBe("exhausted");
  });

  it("lists main-step main/flash magic and flash field effects only for the active player", () => {
    const mainMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-MAIN-MAGIC-001",
      name: "Main Step Main Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const flashMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-FLASH-MAGIC-001",
      name: "Main Step Flash Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const flashNexusDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-FLASH-NEXUS-001",
      name: "Main Step Flash Nexus",
      printedCategory: "nexus",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(mainMagicDefinition, {
            instanceId: "main-magic-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(flashMagicDefinition, {
            instanceId: "flash-magic-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(flashNexusDefinition, {
            instanceId: "flash-nexus-1",
            ownerPlayerId: "alice",
            zone: "field",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      mainMagicDefinition,
      flashMagicDefinition,
      flashNexusDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [mainMagicDefinition.cardNo]: {
        timing: "main",
        reason: "main_magic_window",
      },
      [flashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "main_flash_magic_window",
      },
    });
    const fieldLookup = createFieldEffectActionRegistrationLookup({
      [flashNexusDefinition.cardNo]: [
        {
          sourceKind: "nexus",
          timing: "flash",
          reason: "main_flash_field_window",
        },
      ],
    });

    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredMagicActions: magicLookup,
    });

    expect(aliceActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "main-magic-1",
          timing: "main",
        }),
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "flash-magic-1",
          timing: "flash",
        }),
        expect.objectContaining({
          kind: "use_field_card_effect",
          sourceInstanceId: "flash-nexus-1",
          timing: "flash",
        }),
      ])
    );

    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredMagicActions: magicLookup,
    });

    expect(
      bobActions.filter(
        (legalAction) =>
          legalAction.kind === "use_magic" ||
          legalAction.kind === "use_field_card_effect"
      )
    ).toEqual([]);
  });

  it("opens a main-step stack window for flash magic and resolves nested stack responses in LIFO order", () => {
    const rootFlashMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STACK-FLASH-MAGIC-001",
      name: "Main Stack Flash Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const aliceStackMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STACK-ALICE-MAGIC-001",
      name: "Main Stack Alice Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const bobStackMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STACK-BOB-MAGIC-001",
      name: "Main Stack Bob Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const bobFlashMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STACK-BOB-FLASH-001",
      name: "Main Stack Bob Flash Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(rootFlashMagicDefinition, {
            instanceId: "main-root-flash-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(aliceStackMagicDefinition, {
            instanceId: "alice-stack-magic-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(bobStackMagicDefinition, {
            instanceId: "bob-stack-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(bobFlashMagicDefinition, {
            instanceId: "bob-flash-magic-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      rootFlashMagicDefinition,
      aliceStackMagicDefinition,
      bobStackMagicDefinition,
      bobFlashMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [rootFlashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "main_step_flash_root",
      },
      [aliceStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_alice",
      },
      [bobStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "stack_bob",
      },
      [bobFlashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "main_step_flash_bob",
      },
    });
    const resolverLookup = (cardNo: string) => {
      switch (cardNo) {
        case rootFlashMagicDefinition.cardNo:
        case aliceStackMagicDefinition.cardNo:
        case bobStackMagicDefinition.cardNo:
          return (currentState: GameState) => ({
            ...currentState,
            log: [...currentState.log, `main-step-stack:resolved:${cardNo}`],
          });
        default:
          return undefined;
      }
    };

    const rootAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "main-root-flash-1"
    );
    const rootStackState = applyLegalAction({
      state,
      action: rootAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(rootStackState.window).toBe("stack");
    expect(rootStackState.stackWindow?.priorityPlayerId).toBe("bob");
    expect(rootStackState.stackWindow?.pendingStackAction).not.toBeNull();
    expect(
      rootStackState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "main-root-flash-1"
      )?.zone
    ).toBe("in_use");
    assertValidGameState(rootStackState);

    const bobResponseActions = getLegalActions({
      state: rootStackState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });

    expect(bobResponseActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "bob-stack-magic-1",
          timing: "stack",
        }),
        expect.objectContaining({
          kind: "pass_stack",
        }),
      ])
    );
    expect(bobResponseActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "bob-flash-magic-1",
          timing: "flash",
        }),
      ])
    );

    const bobStackAction = bobResponseActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "bob-stack-magic-1"
    );
    const bobStackState = applyLegalAction({
      state: rootStackState,
      action: bobStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(bobStackState.stackWindow?.priorityPlayerId).toBe("alice");
    assertValidGameState(bobStackState);

    const aliceResponseActions = getLegalActions({
      state: bobStackState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    const aliceStackAction = aliceResponseActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "alice-stack-magic-1"
    );
    const nestedStackState = applyLegalAction({
      state: bobStackState,
      action: aliceStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(nestedStackState.stackWindow?.priorityPlayerId).toBe("bob");
    assertValidGameState(nestedStackState);

    const passStack = (
      currentState: GameState,
      actingPlayerId: string
    ): GameState =>
      applyLegalAction({
        state: currentState,
        action: getLegalActions({
          state: currentState,
          actingPlayerId,
          getCardDefinitionById: definitionLookup,
          getRegisteredFieldCardEffectActions:
            createFieldEffectActionRegistrationLookup({}),
          getRegisteredMagicActions: magicLookup,
        }).find((legalAction) => legalAction.kind === "pass_stack")!,
        getCardDefinitionById: definitionLookup,
        getHandWrittenEffectResolver: resolverLookup,
      }).state;

    // 1-pass cascade: bob のパスで全 pending (alice-stack, bob-stack, root-flash) が LIFO 解決
    const resolvedState = passStack(nestedStackState, "bob");

    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "main-root-flash-1"
      )?.zone
    ).toBe("trash");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "alice-stack-magic-1"
      )?.zone
    ).toBe("trash");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-stack-magic-1"
      )?.zone
    ).toBe("trash");
    expect(
      resolvedState.log.filter((entry) =>
        entry.startsWith("main-step-stack:resolved:")
      )
    ).toEqual([
      `main-step-stack:resolved:${aliceStackMagicDefinition.cardNo}`,
      `main-step-stack:resolved:${bobStackMagicDefinition.cardNo}`,
      `main-step-stack:resolved:${rootFlashMagicDefinition.cardNo}`,
    ]);
    assertValidGameState(resolvedState);
  });

  it("opens a main-step stack window for main magic and resolves stack responses before the root effect", () => {
    const rootMainMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STACK-MAIN-MAGIC-001",
      name: "Main Stack Main Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const bobStackMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STACK-MAIN-BOB-001",
      name: "Main Stack Main Bob",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const bobFlashMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STACK-MAIN-BOB-FLASH-001",
      name: "Main Stack Main Bob Flash",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(rootMainMagicDefinition, {
            instanceId: "main-root-main-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(bobStackMagicDefinition, {
            instanceId: "bob-main-stack-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(bobFlashMagicDefinition, {
            instanceId: "bob-main-flash-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      rootMainMagicDefinition,
      bobStackMagicDefinition,
      bobFlashMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [rootMainMagicDefinition.cardNo]: {
        timing: "main",
        reason: "main_step_main_root",
      },
      [bobStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "main_step_main_bob_stack",
      },
      [bobFlashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "main_step_main_bob_flash",
      },
    });
    const resolverLookup = (cardNo: string) => {
      switch (cardNo) {
        case rootMainMagicDefinition.cardNo:
        case bobStackMagicDefinition.cardNo:
          return (currentState: GameState) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `main-step-main-stack:resolved:${cardNo}`,
            ],
          });
        default:
          return undefined;
      }
    };

    const rootAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "main-root-main-1" &&
        legalAction.timing === "main"
    );

    const openedState = applyLegalAction({
      state,
      action: rootAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(openedState.window).toBe("stack");
    expect(openedState.stackWindow?.priorityPlayerId).toBe("bob");
    expect(
      openedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "main-root-main-1"
      )?.zone
    ).toBe("in_use");
    assertValidGameState(openedState);

    const bobResponseActions = getLegalActions({
      state: openedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });

    expect(bobResponseActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "bob-main-stack-1",
          timing: "stack",
        }),
        expect.objectContaining({
          kind: "pass_stack",
        }),
      ])
    );
    expect(bobResponseActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "bob-main-flash-1",
          timing: "flash",
        }),
      ])
    );

    const bobStackAction = bobResponseActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "bob-main-stack-1"
    );
    const bobStackState = applyLegalAction({
      state: openedState,
      action: bobStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(bobStackState.stackWindow?.priorityPlayerId).toBe("alice");
    assertValidGameState(bobStackState);

    const passStack = (
      currentState: GameState,
      actingPlayerId: string
    ): GameState =>
      applyLegalAction({
        state: currentState,
        action: getLegalActions({
          state: currentState,
          actingPlayerId,
          getCardDefinitionById: definitionLookup,
          getRegisteredFieldCardEffectActions:
            createFieldEffectActionRegistrationLookup({}),
          getRegisteredMagicActions: magicLookup,
        }).find((legalAction) => legalAction.kind === "pass_stack")!,
        getCardDefinitionById: definitionLookup,
        getHandWrittenEffectResolver: resolverLookup,
      }).state;

    // 1-pass cascade: alice のパスで bob-stack → main-root-main が LIFO 解決
    const resolvedState = passStack(bobStackState, "alice");

    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "main-root-main-1"
      )?.zone
    ).toBe("trash");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "bob-main-stack-1"
      )?.zone
    ).toBe("trash");
    expect(
      resolvedState.log.filter((entry) =>
        entry.startsWith("main-step-main-stack:resolved:")
      )
    ).toEqual([
      `main-step-main-stack:resolved:${bobStackMagicDefinition.cardNo}`,
      `main-step-main-stack:resolved:${rootMainMagicDefinition.cardNo}`,
    ]);
    assertValidGameState(resolvedState);
  });

  it("opens and resolves a main-step stack window for flash field effects", () => {
    const flashNexusDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-FLASH-FIELD-002",
      name: "Main Step Flash Field",
      printedCategory: "nexus",
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(flashNexusDefinition, {
            instanceId: "flash-field-1",
            ownerPlayerId: "alice",
            zone: "field",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([flashNexusDefinition]);
    const fieldLookup = createFieldEffectActionRegistrationLookup({
      [flashNexusDefinition.cardNo]: [
        {
          sourceKind: "nexus",
          timing: "flash",
          reason: "main_step_flash_field",
        },
      ],
    });
    const resolverLookup = (cardNo: string) =>
      cardNo === flashNexusDefinition.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [...currentState.log, `main-step-field:resolved:${cardNo}`],
          })
        : undefined;

    const fieldAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_field_card_effect" &&
        legalAction.sourceInstanceId === "flash-field-1"
    );
    const openedState = applyLegalAction({
      state,
      action: fieldAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(openedState.window).toBe("stack");
    expect(openedState.stackWindow?.priorityPlayerId).toBe("bob");
    assertValidGameState(openedState);

    // 1-pass cascade: bob のパスで窓即クローズ + 効果解決
    const resolvedState = applyLegalAction({
      state: openedState,
      action: getLegalActions({
        state: openedState,
        actingPlayerId: "bob",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions: fieldLookup,
      }).find((legalAction) => legalAction.kind === "pass_stack")!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;

    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(resolvedState.log).toContain(
      `main-step-field:resolved:${flashNexusDefinition.cardNo}`
    );
    assertValidGameState(resolvedState);
  });

  it("opens a main-step stack window for normal field effects and resolves stack responses before the root effect", () => {
    const rootFieldDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-NORMAL-FIELD-001",
      name: "Main Step Normal Field",
      printedCategory: "nexus",
    });
    const bobStackMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-NORMAL-FIELD-BOB-STACK-001",
      name: "Main Step Normal Field Bob Stack",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const bobFlashMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-NORMAL-FIELD-BOB-FLASH-001",
      name: "Main Step Normal Field Bob Flash",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(rootFieldDefinition, {
            instanceId: "normal-field-1",
            ownerPlayerId: "alice",
            zone: "field",
          }),
          createCardInstance(bobStackMagicDefinition, {
            instanceId: "bob-normal-field-stack-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(bobFlashMagicDefinition, {
            instanceId: "bob-normal-field-flash-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      rootFieldDefinition,
      bobStackMagicDefinition,
      bobFlashMagicDefinition,
    ]);
    const fieldLookup = createFieldEffectActionRegistrationLookup({
      [rootFieldDefinition.cardNo]: [
        {
          sourceKind: "nexus",
          timing: "normal",
          reason: "main_step_normal_field_root",
        },
      ],
    });
    const magicLookup = createMagicActionRegistrationLookup({
      [bobStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "main_step_normal_field_bob_stack",
      },
      [bobFlashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "main_step_normal_field_bob_flash",
      },
    });
    const resolverLookup = (cardNo: string) => {
      switch (cardNo) {
        case rootFieldDefinition.cardNo:
        case bobStackMagicDefinition.cardNo:
          return (currentState: GameState) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `main-step-normal-field:resolved:${cardNo}`,
            ],
          });
        default:
          return undefined;
      }
    };

    const rootAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredMagicActions: magicLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_field_card_effect" &&
        legalAction.sourceInstanceId === "normal-field-1" &&
        legalAction.timing === "normal"
    );

    const openedState = applyLegalAction({
      state,
      action: rootAction!,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(openedState.window).toBe("stack");
    expect(openedState.stackWindow?.priorityPlayerId).toBe("bob");
    assertValidGameState(openedState);

    const bobResponseActions = getLegalActions({
      state: openedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions: fieldLookup,
      getRegisteredMagicActions: magicLookup,
    });

    expect(bobResponseActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "bob-normal-field-stack-1",
          timing: "stack",
        }),
        expect.objectContaining({
          kind: "pass_stack",
        }),
      ])
    );
    expect(bobResponseActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "bob-normal-field-flash-1",
          timing: "flash",
        }),
      ])
    );

    const bobStackAction = bobResponseActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "bob-normal-field-stack-1"
    );
    const bobStackState = applyLegalAction({
      state: openedState,
      action: bobStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(bobStackState.stackWindow?.priorityPlayerId).toBe("alice");
    assertValidGameState(bobStackState);

    const passStack = (
      currentState: GameState,
      actingPlayerId: string
    ): GameState =>
      applyLegalAction({
        state: currentState,
        action: getLegalActions({
          state: currentState,
          actingPlayerId,
          getCardDefinitionById: definitionLookup,
          getRegisteredFieldCardEffectActions: fieldLookup,
          getRegisteredMagicActions: magicLookup,
        }).find((legalAction) => legalAction.kind === "pass_stack")!,
        getCardDefinitionById: definitionLookup,
        getHandWrittenEffectResolver: resolverLookup,
      }).state;

    // 1-pass cascade: alice のパスで bob-stack → root-field が LIFO 解決
    const resolvedState = passStack(bobStackState, "alice");

    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(
      resolvedState.log.filter((entry) =>
        entry.startsWith("main-step-normal-field:resolved:")
      )
    ).toEqual([
      `main-step-normal-field:resolved:${bobStackMagicDefinition.cardNo}`,
      `main-step-normal-field:resolved:${rootFieldDefinition.cardNo}`,
    ]);
    assertValidGameState(resolvedState);
  });

  // 2026-03-31 ユーザー確認ルール: 片方がパスした時点でスタック窓は即閉じる
  // 以下のテストは 1-pass cascade モデルの核心仕様を直接検証する
  it("1-pass close: アクセル宣言後、相手が即 pass すると宣言者に priority が渡らず効果即解決", () => {
    const rootFlashMagicDefinition = createDemoCardDefinition({
      cardNo: "CASCADE-ROOT-001",
      name: "Cascade Root",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(rootFlashMagicDefinition, {
            instanceId: "cascade-root-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([rootFlashMagicDefinition]);
    const magicLookup = createMagicActionRegistrationLookup({
      [rootFlashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "cascade_root_flash",
      },
    });
    const resolverLookup = (cardNo: string) =>
      cardNo === rootFlashMagicDefinition.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [...currentState.log, `cascade-root:resolved:${cardNo}`],
          })
        : undefined;

    const useAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "cascade-root-1"
    );
    const openedState = applyLegalAction({
      state,
      action: useAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(openedState.window).toBe("stack");
    expect(openedState.stackWindow?.priorityPlayerId).toBe("bob");
    expect(openedState.stackWindow?.consecutivePassCount).toBe(0);

    // alice は宣言者なので stack 優先権を持たない
    const aliceLegalActions = getLegalActions({
      state: openedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    expect(aliceLegalActions.some((a) => a.kind === "pass_stack")).toBe(false);

    // bob が即パス → 1-pass で窓即クローズ + 効果解決
    const bobPass = getLegalActions({
      state: openedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "pass_stack");
    const resolvedState = applyLegalAction({
      state: openedState,
      action: bobPass!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;

    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(resolvedState.log).toContain(
      `cascade-root:resolved:${rootFlashMagicDefinition.cardNo}`
    );
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "cascade-root-1"
      )?.zone
    ).toBe("trash");
    assertValidGameState(resolvedState);
  });

  it("1-pass cascade: 深いネスト（相手 stack → 自分 stack → 相手 pass）で LIFO 順に全解決", () => {
    const rootDef = createDemoCardDefinition({
      cardNo: "CASCADE-DEEP-ROOT",
      name: "Cascade Deep Root",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const bobStackDef = createDemoCardDefinition({
      cardNo: "CASCADE-DEEP-BOB",
      name: "Cascade Deep Bob",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const aliceStackDef = createDemoCardDefinition({
      cardNo: "CASCADE-DEEP-ALICE",
      name: "Cascade Deep Alice",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(rootDef, {
            instanceId: "root-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(bobStackDef, {
            instanceId: "bob-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(aliceStackDef, {
            instanceId: "alice-stack-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      rootDef,
      bobStackDef,
      aliceStackDef,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [rootDef.cardNo]: { timing: "flash", reason: "cascade_deep_root" },
      [bobStackDef.cardNo]: { timing: "stack", reason: "cascade_deep_bob" },
      [aliceStackDef.cardNo]: { timing: "stack", reason: "cascade_deep_alice" },
    });
    const resolverLookup = (cardNo: string) =>
      [rootDef.cardNo, bobStackDef.cardNo, aliceStackDef.cardNo].includes(
        cardNo
      )
        ? (currentState: GameState) => ({
            ...currentState,
            log: [...currentState.log, `cascade-deep:resolved:${cardNo}`],
          })
        : undefined;

    // alice が root を使う (flash timing)
    const useRoot = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "root-1");
    const s1 = applyLegalAction({
      state,
      action: useRoot!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    // bob が stack
    const bobStack = getLegalActions({
      state: s1,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "use_magic" && a.sourceInstanceId === "bob-1");
    const s2 = applyLegalAction({
      state: s1,
      action: bobStack!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    // alice が stack（bob の stack に対して）
    const aliceStack = getLegalActions({
      state: s2,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (a) => a.kind === "use_magic" && a.sourceInstanceId === "alice-stack-1"
    );
    const s3 = applyLegalAction({
      state: s2,
      action: aliceStack!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    // この時点で 3 段のチェーン: alice-stack (内) → bob (中) → root (外)
    // 優先権は bob（alice-stack の非宣言者）
    expect(s3.stackWindow?.priorityPlayerId).toBe("bob");

    // bob が 1 pass → alice-stack → bob → root の LIFO 順で全解決
    const bobPass = getLegalActions({
      state: s3,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "pass_stack");
    const resolved = applyLegalAction({
      state: s3,
      action: bobPass!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
    }).state;

    expect(resolved.stackWindow).toBeNull();
    expect(resolved.window).toBe("none");
    // LIFO 順: alice-stack → bob → root
    expect(
      resolved.log.filter((e) => e.startsWith("cascade-deep:resolved:"))
    ).toEqual([
      `cascade-deep:resolved:${aliceStackDef.cardNo}`,
      `cascade-deep:resolved:${bobStackDef.cardNo}`,
      `cascade-deep:resolved:${rootDef.cardNo}`,
    ]);
    assertValidGameState(resolved);
  });

  it("opens a main-step stack window for place_nexus and resolves stack responses before the root play", () => {
    const rootNexusDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-PLACE-NEXUS-STACK-001",
      name: "Main Step Place Nexus Stack",
      printedCategory: "nexus",
      cost: 0,
      reductionSymbols: [],
    });
    const bobStackMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-PLACE-NEXUS-BOB-STACK-001",
      name: "Main Step Place Nexus Bob Stack",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const bobFlashMagicDefinition = createDemoCardDefinition({
      cardNo: "MAIN-STEP-PLACE-NEXUS-BOB-FLASH-001",
      name: "Main Step Place Nexus Bob Flash",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(rootNexusDefinition, {
            instanceId: "main-step-place-root-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(bobStackMagicDefinition, {
            instanceId: "main-step-place-bob-stack-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
          createCardInstance(bobFlashMagicDefinition, {
            instanceId: "main-step-place-bob-flash-1",
            ownerPlayerId: "bob",
            zone: "hand",
          }),
        ],
      }),
      step: "main" as const,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      rootNexusDefinition,
      bobStackMagicDefinition,
      bobFlashMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [bobStackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "main_step_place_bob_stack",
      },
      [bobFlashMagicDefinition.cardNo]: {
        timing: "flash",
        reason: "main_step_place_bob_flash",
      },
    });
    const resolverLookup = (cardNo: string) => {
      switch (cardNo) {
        case rootNexusDefinition.cardNo:
        case bobStackMagicDefinition.cardNo:
          return (currentState: GameState) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `main-step-place-stack:resolved:${cardNo}`,
            ],
          });
        default:
          return undefined;
      }
    };

    const rootAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (legalAction) =>
        legalAction.kind === "place_nexus" &&
        legalAction.sourceInstanceId === "main-step-place-root-1"
    );

    const openedState = applyLegalAction({
      state,
      action: rootAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(openedState.window).toBe("stack");
    expect(openedState.stackWindow?.priorityPlayerId).toBe("bob");
    expect(
      openedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "main-step-place-root-1"
      )?.zone
    ).toBe("in_use");
    assertValidGameState(openedState);

    const bobResponseActions = getLegalActions({
      state: openedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });

    expect(bobResponseActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "main-step-place-bob-stack-1",
          timing: "stack",
        }),
        expect.objectContaining({
          kind: "pass_stack",
        }),
      ])
    );
    expect(bobResponseActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "use_magic",
          sourceInstanceId: "main-step-place-bob-flash-1",
          timing: "flash",
        }),
      ])
    );

    const bobStackAction = bobResponseActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "main-step-place-bob-stack-1"
    );
    const bobStackState = applyLegalAction({
      state: openedState,
      action: bobStackAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(bobStackState.stackWindow?.priorityPlayerId).toBe("alice");
    assertValidGameState(bobStackState);

    const resolvedState = fullyResolveMainStepStack({
      state: bobStackState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver: resolverLookup,
    });

    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "main-step-place-root-1"
      )?.zone
    ).toBe("field");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) =>
          cardInstance.instanceId === "main-step-place-bob-stack-1"
      )?.zone
    ).toBe("trash");
    expect(
      resolvedState.log.filter((entry) =>
        entry.startsWith("main-step-place-stack:resolved:")
      )
    ).toEqual([
      `main-step-place-stack:resolved:${bobStackMagicDefinition.cardNo}`,
      `main-step-place-stack:resolved:${rootNexusDefinition.cardNo}`,
    ]);
    assertValidGameState(resolvedState);
  });
});

describe("rules-core hand-written pending-leave resolvers", () => {
  it("can issue a leave-field override from a magic resolver and flush it at chain end", () => {
    const magicDefinition = createDemoCardDefinition({
      cardNo: "MAGIC-PENDING-LEAVE-001",
      name: "Magic Pending Leave",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          trashNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "target-1",
          },
        },
      ],
      cardInstances: [
        createCardInstance(magicDefinition, {
          instanceId: "magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    });

    const result = playMagicCardAsAction({
      state,
      actingPlayerId: "alice",
      magicInstanceId: "magic-1",
      targetInstanceIds: ["target-1"],
      paymentSources: [],
      getCardDefinitionById: createDefinitionLookup([
        magicDefinition,
        targetSpiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "MAGIC-PENDING-LEAVE-001"
          ? createTargetCardPendingLeaveResolver({
              leaveFieldCoreDestinationOverride: {
                normalCoreDestination: {
                  kind: "trash",
                  playerId: "alice",
                },
                soulCoreDestination: {
                  kind: "removed_from_game",
                },
              },
            })
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");
    const target = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(alice?.trashNormalCoreCount).toBe(2);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "removed_from_game",
    });
    expect(target?.zone).toBe("trash");
    expect(target?.normalCoreCount).toBe(0);
    expect(result.state.log).toContain(
      `pending-leave:destroy:target-1:${result.chainId}:effect_resolution`
    );
    expect(result.state.log).toContain(
      `pending-leave-flushed:destroy:target-1:${result.chainId}:effect_resolution`
    );
  });

  it("can issue a leave-field override from a field-card resolver and route normal cores to void", () => {
    const sourceSpiritDefinition = createDemoCardDefinition({
      cardNo: "FIELD-PENDING-LEAVE-001",
      name: "Field Pending Leave",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const targetSpiritDefinition = createDemoSpiritDefinition();
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      startingVoidNormalCoreCount: 0,
      playerOverrides: [
        {
          reserveNormalCoreCount: 0,
          soulCoreLocation: {
            kind: "card",
            instanceId: "target-1",
          },
        },
      ],
      cardInstances: [
        createCardInstance(sourceSpiritDefinition, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetSpiritDefinition, {
          instanceId: "target-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
    });

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: createDefinitionLookup([
        sourceSpiritDefinition,
        targetSpiritDefinition,
      ]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "FIELD-PENDING-LEAVE-001"
          ? createTargetCardPendingLeaveResolver({
              leaveFieldCoreDestinationOverride: {
                normalCoreDestination: {
                  kind: "void",
                  playerId: "alice",
                },
                soulCoreDestination: {
                  kind: "removed_from_game",
                },
              },
            })
          : undefined,
    });
    const alice = result.state.players.find((player) => player.id === "alice");
    const target = result.state.cardInstances.find(
      (cardInstance) => cardInstance.instanceId === "target-1"
    );

    expect(alice?.voidNormalCoreCount).toBe(2);
    expect(alice?.reserveNormalCoreCount).toBe(0);
    expect(alice?.soulCoreLocation).toEqual({
      kind: "removed_from_game",
    });
    expect(target?.zone).toBe("trash");
    expect(target?.normalCoreCount).toBe(0);
    expect(result.state.log).toContain(
      `effect:declare:${result.chainId}:source-1:FIELD-PENDING-LEAVE-001:spirit`
    );
    expect(result.state.log).toContain(
      `pending-leave-flushed:destroy:target-1:${result.chainId}:effect_resolution`
    );
  });

  it("can resolve a burst check by auto-playing two selected target spirits without paying cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-MULTI-PLAY-TARGET-SOURCE-001",
      name: "Burst Multi Play Target Source Spirit",
      printedCategory: "spirit",
      textLines: [
        "〖バースト：自分のライフ減少後〗手札のスピリット2枚をコストを支払わずに召喚する。",
      ],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const followUpSpirit1Definition = createDemoCardDefinition({
      cardNo: "BURST-MULTI-PLAY-TARGET-SPIRIT-001",
      name: "Burst Multi Play Target Spirit 1",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const followUpSpirit2Definition = createDemoCardDefinition({
      cardNo: "BURST-MULTI-PLAY-TARGET-SPIRIT-002",
      name: "Burst Multi Play Target Spirit 2",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpSpirit1Definition,
      followUpSpirit2Definition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-multi-play-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpSpirit1Definition, {
          instanceId: "follow-up-multi-spirit-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(followUpSpirit2Definition, {
          instanceId: "follow-up-multi-spirit-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "burst-multi-play-source-1" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:multi-play-target:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:16561",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          requiredTargetCount: 2,
          candidateTargetZones: ["hand"],
          candidateTargetPlayerScope: "acting_player",
          playTargetCardWithoutCostAfterResolve: true,
        },
      ],
    });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-multi-play-source-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        playsTargetCardWithoutCostAfterResolve: true,
        targetMode: "none",
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
      })
    );
    expect(burstAction?.targetEnterFieldCorePlacementOptions).toHaveLength(2);

    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        followUpPerTargetInputs: [
          {
            targetInstanceId: "follow-up-multi-spirit-1",
            enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
          },
          {
            targetInstanceId: "follow-up-multi-spirit-2",
            enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
      }).state,
      pendingEffectTargetInstanceIds: [
        "follow-up-multi-spirit-1",
        "follow-up-multi-spirit-2",
      ],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    });

    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "follow-up-multi-spirit-1"
      )
    ).toEqual(expect.objectContaining({ zone: "field", normalCoreCount: 1 }));
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "follow-up-multi-spirit-2"
      )
    ).toEqual(expect.objectContaining({ zone: "field", normalCoreCount: 1 }));
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "burst-multi-play-source-1"
      )
    ).toEqual(expect.objectContaining({ zone: "trash" }));
    // spirit_summoned burst checks may be generated when target spirits enter field
    expect(
      resolvedState.pendingBurstChecks.every((bc) => bc.eventKind === "summon")
    ).toBe(true);
    expect(resolvedState.log).toContain(
      "burst:follow-up:play:burst:burst:multi-play-target:test:burst-multi-play-source-1:follow-up-multi-spirit-1"
    );
    expect(resolvedState.log).toContain(
      "burst:follow-up:play:burst:burst:multi-play-target:test:burst-multi-play-source-1:follow-up-multi-spirit-2"
    );
  });

  it("can resolve a burst check by auto-using two selected target magics without paying cost", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-MULTI-USE-TARGET-SOURCE-001",
      name: "Burst Multi Use Target Source Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });
    const followUpMagic1Definition = createDemoCardDefinition({
      cardNo: "BURST-MULTI-USE-TARGET-MAGIC-001",
      name: "Burst Multi Use Target Magic 1",
      printedCategory: "magic",
      cost: 2,
    });
    const followUpMagic2Definition = createDemoCardDefinition({
      cardNo: "BURST-MULTI-USE-TARGET-MAGIC-002",
      name: "Burst Multi Use Target Magic 2",
      printedCategory: "magic",
      cost: 2,
    });
    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      followUpMagic1Definition,
      followUpMagic2Definition,
    ]);
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-multi-use-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpMagic1Definition, {
          instanceId: "follow-up-multi-magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
        createCardInstance(followUpMagic2Definition, {
          instanceId: "follow-up-multi-magic-2",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "burst-multi-use-source-1" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:multi-use-target:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:16714",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSpiritDefinition.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          requiredTargetCount: 2,
          candidateTargetZones: ["hand"],
          candidateTargetPlayerScope: "acting_player",
          useTargetCardWithoutCostAfterResolve: true,
        },
      ],
    });
    const getRegisteredMagicActions = createMagicActionRegistrationLookup({
      [followUpMagic1Definition.cardNo]: { timing: "main" },
      [followUpMagic2Definition.cardNo]: { timing: "main" },
    });

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
      getRegisteredMagicActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-multi-use-source-1"
    );

    expect(burstAction).toEqual(
      expect.objectContaining({
        usesTargetCardWithoutCostAfterResolve: true,
        targetMode: "none",
        requiredTargetCount: 0,
        candidateTargetInstanceIds: [],
      })
    );
    expect(burstAction?.targetFollowUpMagicOptions).toHaveLength(2);

    const getHandWrittenEffectResolver = (cardNo: string) => {
      if (
        cardNo === followUpMagic1Definition.cardNo ||
        cardNo === followUpMagic2Definition.cardNo
      ) {
        return (currentState: GameState, context: EffectActionContext) => ({
          ...currentState,
          log: [
            ...currentState.log,
            `burst:multi-use-target:${context.resolutionKind}:${context.sourceCard.instanceId}`,
          ],
        });
      }
      return undefined;
    };
    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getRegisteredMagicActions,
        getHandWrittenEffectResolver,
      }).state,
      pendingEffectTargetInstanceIds: [
        "follow-up-multi-magic-1",
        "follow-up-multi-magic-2",
      ],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredMagicActions,
      getHandWrittenEffectResolver,
    });

    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "follow-up-multi-magic-1"
      )
    ).toEqual(expect.objectContaining({ zone: "trash" }));
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "follow-up-multi-magic-2"
      )
    ).toEqual(expect.objectContaining({ zone: "trash" }));
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "burst-multi-use-source-1"
      )
    ).toEqual(expect.objectContaining({ zone: "trash" }));
    expect(resolvedState.pendingBurstChecks).toEqual([]);
    expect(resolvedState.log).toContain(
      "burst:follow-up:magic-use:burst:burst:multi-use-target:test:burst-multi-use-source-1:follow-up-multi-magic-1"
    );
    expect(resolvedState.log).toContain(
      "burst:follow-up:magic-use:burst:burst:multi-use-target:test:burst-multi-use-source-1:follow-up-multi-magic-2"
    );
  });

  it("opens a stack window for the opponent when a burst activates during the main step", () => {
    // バースト発動が main step 中に起きた場合、相手に stack 応答権を与えてから解決する
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-MAIN-STEP-STACK-001",
      name: "Main Step Burst Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      keywordTags: ["burst"],
      textLines: ["〖バースト：相手のライフ減少後〗バースト解決ログを残す。"],
    });

    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);

    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-MAIN-STEP-STACK-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === "BURST-MAIN-STEP-STACK-001"
        ? (currentState: ReturnType<typeof createEmptyGameState>) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `burst-main-step-stack:resolved:${cardNo}`,
            ],
          })
        : undefined;

    // main step 中に bob の life が減ったため pendingBurstCheck が存在する
    // alice が active player, bob のバーストが発動する
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-main-step-001",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        { playerId: "bob", cardInstanceId: "burst-main-step-001" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:main-step:life-reduced:001",
          actingPlayerId: "bob",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "bob",
          amount: 1,
          step: "main",
          window: "none",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    // state.step を "main" に設定する
    const mainStepState = { ...state, step: "main" as const };

    // bob が resolve_pending_burst_check を実行する
    const burstAction = getLegalActions({
      state: mainStepState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-main-step-001"
    );

    expect(burstAction).toBeDefined();

    const openedState = applyLegalAction({
      state: mainStepState,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;

    // stack window が開き、alice (active player = opponent of burst holder) が priority を持つ
    expect(openedState.window).toBe("stack");
    expect(openedState.stackWindow).not.toBeNull();
    expect(openedState.stackWindow?.priorityPlayerId).toBe("alice");
    expect(openedState.stackWindow?.actingPlayerId).toBe("bob");
    // バーストカードはすでに reveal されている
    expect(openedState.revealedBurstStates).toHaveLength(1);
    expect(openedState.revealedBurstStates[0]?.cardInstanceId).toBe(
      "burst-main-step-001"
    );
    // pendingBurstChecks はまだ残っている (スタック解決後に処理される)
    expect(openedState.pendingBurstChecks).toHaveLength(1);
    assertValidGameState(openedState);

    // alice がスタック窓でパス、bob もパス → バースト解決
    const resolvedState = fullyResolveMainStepStack({
      state: openedState,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver,
      getRegisteredBurstActions,
    });

    // バースト解決後: スタック窓が閉じ、バースト処理が完了する
    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(resolvedState.pendingBurstChecks).toHaveLength(0);
    expect(resolvedState.setBurstStates).toHaveLength(0);
    expect(resolvedState.revealedBurstStates).toHaveLength(0);
    // バーストカードはトラッシュへ
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "burst-main-step-001"
      )?.zone
    ).toBe("trash");
    // 手書き resolver が呼ばれた
    expect(resolvedState.log).toContain(
      "burst-main-step-stack:resolved:BURST-MAIN-STEP-STACK-001"
    );
  });

  it("発動宣言窓で alice がパス → 効果発揮宣言窓が開き、再度パスでバースト解決する (1-pass cascade)", () => {
    // バースト発動宣言でサブスタックが使われなかった場合、
    // 効果発揮宣言窓が追加で開き「どちらかでしかスタックタイミングは行えない」を実現する
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-EFFECT-DECL-001",
      name: "Burst Effect Declaration Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["〖バースト：相手のライフ減少後〗バースト解決ログを残す。"],
    });

    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);

    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-EFFECT-DECL-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });

    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === "BURST-EFFECT-DECL-001"
        ? (currentState: ReturnType<typeof createEmptyGameState>) => ({
            ...currentState,
            log: [...currentState.log, `burst-effect-decl:resolved:${cardNo}`],
          })
        : undefined;

    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(burstSpiritDefinition, {
            instanceId: "burst-effect-decl-001",
            ownerPlayerId: "bob",
            zone: "burst",
          }),
        ],
        setBurstStates: [
          { playerId: "bob", cardInstanceId: "burst-effect-decl-001" },
        ],
        pendingBurstChecks: [
          {
            checkId: "burst:effect-decl:001",
            actingPlayerId: "bob",
            eventKind: "reduce_life" as const,
            source: "action_resolution" as const,
            chainId: "demo-chain",
            attackId: null,
            relatedPlayerId: "bob",
            amount: 1,
            step: "main" as const,
            window: "none" as const,
            resolvedBurstCardInstanceIds: [],
          },
        ],
      }),
      step: "main" as const,
    };

    // bob が resolve_pending_burst_check を実行 → 発動宣言窓が開く
    const burstAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        (a as { sourceInstanceId?: string }).sourceInstanceId ===
          "burst-effect-decl-001"
    );

    expect(burstAction).toBeDefined();

    const afterBurstAction = applyLegalAction({
      state,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;

    // 発動宣言窓が開いた
    expect(afterBurstAction.window).toBe("stack");
    expect(afterBurstAction.stackWindow?.burstWindowKind).toBe("activation");
    expect(afterBurstAction.stackWindow?.subStackEverOpened).toBe(false);
    assertValidGameState(afterBurstAction);

    // 1-pass cascade: alice のパスで発動宣言窓即クローズ + subStackEverOpened=false なので
    // 効果発揮宣言窓へ直接遷移する
    const afterAlicePass = applyLegalAction({
      state: afterBurstAction,
      action: {
        kind: "pass_stack",
        actionId: "pass-alice",
        actingPlayerId: "alice",
        can: true,
        reason: "legal_pass_stack",
      },
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;

    // 効果発揮宣言窓が開いている
    expect(afterAlicePass.window).toBe("stack");
    expect(afterAlicePass.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    expect(afterAlicePass.stackWindow?.subStackEverOpened).toBe(false);
    // バーストカードはまだ解決されていない
    expect(afterAlicePass.pendingBurstChecks).toHaveLength(1);
    // 発動が成立 → setBurstStates から除去済み (もはやセット中ではない)
    expect(afterAlicePass.setBurstStates).toHaveLength(0);
    // revealedBurstStates にはまだある (効果発揮中)
    expect(afterAlicePass.revealedBurstStates).toHaveLength(1);
    assertValidGameState(afterAlicePass);

    // 効果発揮宣言窓も 1-pass でクローズ → バースト解決
    const resolvedState = fullyResolveMainStepStack({
      state: afterAlicePass,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver,
      getRegisteredBurstActions,
    });

    expect(resolvedState.stackWindow).toBeNull();
    expect(resolvedState.window).toBe("none");
    expect(resolvedState.pendingBurstChecks).toHaveLength(0);
    expect(resolvedState.setBurstStates).toHaveLength(0);
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "burst-effect-decl-001"
      )?.zone
    ).toBe("trash");
    expect(resolvedState.log).toContain(
      "burst-effect-decl:resolved:BURST-EFFECT-DECL-001"
    );
  });

  it("battle end 再評価は先行誘発後に解決する deferred burst cascade を保持する", () => {
    const burstDefinition = createDemoCardDefinition({
      cardNo: "TEST-BATTLE-END-DEFERRED-BURST-001",
      name: "Battle End Deferred Burst",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["〖バースト：相手のライフ減少後〗解決ログを残す。"],
    });
    const getCardDefinitionById = createDefinitionLookup([burstDefinition]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstDefinition.cardNo]: [
        { sourceKind: "spirit", eventKind: "reduce_life" },
      ],
    });
    const getHandWrittenEffectResolver = (cardNo: string) =>
      cardNo === burstDefinition.cardNo
        ? (currentState: GameState) => ({
            ...currentState,
            log: [
              ...currentState.log,
              `battle-end-deferred-burst:resolved:${cardNo}`,
            ],
          })
        : undefined;
    const attackId = "attack:battle-end-deferred-burst:1";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(burstDefinition, {
            instanceId: "battle-end-deferred-burst-1",
            ownerPlayerId: "bob",
            zone: "burst",
          }),
        ],
        setBurstStates: [
          { playerId: "bob", cardInstanceId: "battle-end-deferred-burst-1" },
        ],
        pendingBurstChecks: [
          {
            checkId: "burst:battle-end-deferred:001",
            actingPlayerId: "bob",
            eventKind: "reduce_life",
            source: "battle_resolution",
            chainId: "chain:battle-end-deferred-burst",
            attackId,
            relatedPlayerId: "bob",
            amount: 1,
            step: "attack",
            window: "battle_resolution",
            resolvedBurstCardInstanceIds: [],
          },
        ],
        pendingTriggeredEffects: [
          {
            pendingId: "trigger:before-deferred-burst",
            actingPlayerId: "alice",
            eventKind: "spirit_destroyed",
            source: "battle_resolution",
            chainId: "chain:battle-end-deferred-burst",
            attackId,
            relatedPlayerId: "alice",
            relatedInstanceId: null,
            amount: null,
            step: "attack",
            window: "battle_resolution",
            resolvedSourceInstanceIds: [],
          },
        ],
      }),
      activePlayerId: "alice",
      step: "attack",
      window: "battle_resolution",
    };

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (action) =>
        action.kind === "resolve_pending_burst_check" &&
        action.sourceInstanceId === "battle-end-deferred-burst-1"
    );
    expect(burstAction).toBeDefined();

    const afterBurstSelection = applyLegalAction({
      state,
      action: burstAction!,
      getCardDefinitionById,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;
    const afterActivationPass = applyLegalAction({
      state: afterBurstSelection,
      action: {
        kind: "pass_stack",
        actionId: "pass:alice:battle-end-deferred-burst",
        actingPlayerId: "alice",
        can: true,
        reason: "legal_pass_stack",
      },
      getCardDefinitionById,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;
    expect(afterActivationPass.pendingBurstChecks[0]?.activationSelected).toBe(
      true
    );
    expect(
      afterActivationPass.pendingStackCascade?.remainingStacks[0]
    ).toMatchObject({
      actionKind: "burst_activation",
      burstEffectDeclarationPending: true,
    });

    const afterBattleEndRecheck = processPendingImmediateBattleEnds({
      state: {
        ...afterActivationPass,
        pendingImmediateBattleEnds: [
          {
            attackId,
            participantInstanceIds: [],
            blockSideInstanceIds: [],
            participantSnapshots: [],
            appliedLifeDamage: 1,
          },
        ],
      },
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions,
    });
    expect(afterBattleEndRecheck.pendingImmediateBattleEnds).toHaveLength(1);
    expect(
      afterBattleEndRecheck.pendingStackCascade?.remainingStacks[0]
    ).toMatchObject({
      actionKind: "burst_activation",
      burstEffectDeclarationPending: true,
    });

    const afterTriggeredEffect = resumeStackCascadeIfReady(
      { ...afterBattleEndRecheck, pendingTriggeredEffects: [] },
      { getCardDefinitionById, getRegisteredBurstActions }
    );
    expect(afterTriggeredEffect.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );

    const burstResolved = fullyResolveMainStepStack({
      state: afterTriggeredEffect,
      getCardDefinitionById,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    });
    expect(burstResolved.pendingBurstChecks).toHaveLength(0);
    expect(burstResolved.pendingStackCascade).toBeNull();
    expect(burstResolved.log).toContain(
      `battle-end-deferred-burst:resolved:${burstDefinition.cardNo}`
    );
  });

  it("他の誘発効果が残る間はバースト効果発揮宣言窓を開かず、表向きバーストとして待機する", () => {
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-DELAY-EFFECT-DECL-001",
      name: "Burst Delayed Effect Declaration Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["〖バースト：相手のライフ減少後〗バースト解決ログを残す。"],
    });

    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-DELAY-EFFECT-DECL-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });

    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(burstSpiritDefinition, {
            instanceId: "burst-delay-effect-decl-001",
            ownerPlayerId: "bob",
            zone: "burst",
          }),
        ],
        setBurstStates: [
          { playerId: "bob", cardInstanceId: "burst-delay-effect-decl-001" },
        ],
        pendingBurstChecks: [
          {
            checkId: "burst:delay-effect-decl:001",
            actingPlayerId: "bob",
            eventKind: "reduce_life" as const,
            source: "action_resolution" as const,
            chainId: "demo-chain",
            attackId: null,
            relatedPlayerId: "bob",
            amount: 1,
            step: "main" as const,
            window: "none" as const,
            resolvedBurstCardInstanceIds: [],
          },
        ],
        pendingTriggeredEffects: [
          {
            pendingId: "te-before-burst-1",
            actingPlayerId: "alice",
            eventKind: "spirit_destroyed" as const,
            source: "action_resolution" as const,
            chainId: "demo-chain",
            attackId: null,
            relatedPlayerId: "alice",
            relatedInstanceId: null,
            amount: null,
            step: "main" as const,
            window: "none" as const,
            resolvedSourceInstanceIds: [],
          },
        ],
      }),
      step: "main" as const,
    };

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        (a as { sourceInstanceId?: string }).sourceInstanceId ===
          "burst-delay-effect-decl-001"
    );

    expect(burstAction).toBeDefined();

    const afterBurstAction = applyLegalAction({
      state,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    }).state;

    expect(afterBurstAction.stackWindow?.burstWindowKind).toBe("activation");

    const afterActivationPass = applyLegalAction({
      state: afterBurstAction,
      action: {
        kind: "pass_stack",
        actionId: "pass-alice",
        actingPlayerId: "alice",
        can: true,
        reason: "legal_pass_stack",
      },
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    }).state;

    expect(afterActivationPass.stackWindow).toBeNull();
    expect(afterActivationPass.window).toBe("none");
    expect(afterActivationPass.pendingTriggeredEffects).toHaveLength(1);
    expect(
      afterActivationPass.pendingStackCascade?.remainingStacks[0]
    ).toMatchObject({
      actionKind: "burst_activation",
      burstEffectDeclarationPending: true,
    });
    expect(afterActivationPass.pendingBurstChecks[0]?.activationSelected).toBe(
      true
    );
    expect(afterActivationPass.setBurstStates).toHaveLength(0);
    expect(afterActivationPass.revealedBurstStates).toEqual([
      {
        playerId: "bob",
        cardInstanceId: "burst-delay-effect-decl-001",
        checkId: "burst:delay-effect-decl:001",
        activationPending: false,
      },
    ]);
    assertValidGameState(afterActivationPass);

    const afterOtherEffects = resumeStackCascadeIfReady(
      {
        ...afterActivationPass,
        pendingTriggeredEffects: [],
      },
      {
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
      }
    );

    expect(afterOtherEffects.window).toBe("stack");
    expect(afterOtherEffects.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
    expect(afterOtherEffects.setBurstStates).toHaveLength(0);
    expect(afterOtherEffects.revealedBurstStates).toHaveLength(1);

    // EDH-0008 regression: an after_triggers continuation must drain before the
    // revealed burst opens its effect-declaration window.  Treating this deferred
    // burst cascade itself as a continuation blocker exposed unrelated main actions
    // and eventually left the selected burst check stranded.
    const afterAfterTriggersContinuation = resumeStackCascadeIfReady(
      {
        ...afterActivationPass,
        pendingTriggeredEffects: [],
        pendingAfterTriggersContinuations: [
          {
            chainId: "test:index:17428",
            continuationId: "after-triggers:edh-0008",
            waitChainId: "after-triggers:edh-0008",
            sourceDefinitionId: burstSpiritDefinition.cardNo,
            effectIndex: 0,
            resumeEffectOverride: {
              timing: { kind: "continuous" },
              steps: [],
            },
            sourceInstanceId: "burst-delay-effect-decl-001",
            actingPlayerId: "bob",
            resumeStepIndex: 0,
            stepContext: { results: {} },
          },
        ],
      },
      { getCardDefinitionById: definitionLookup, getRegisteredBurstActions }
    );

    expect(
      afterAfterTriggersContinuation.pendingAfterTriggersContinuations
    ).toHaveLength(0);
    expect(afterAfterTriggersContinuation.stackWindow?.burstWindowKind).toBe(
      "effect_declaration"
    );
  });

  it("EDH-0029: after_triggers 継続は通常の outer stack cascade より先に drain する", () => {
    const continuationSourceDefinition = createDemoCardDefinition({
      cardNo: "EDH-0029-CONTINUATION-SOURCE",
      name: "EDH-0029 Continuation Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    });
    const outerMagicDefinition = createDemoCardDefinition({
      cardNo: "EDH-0029-OUTER-MAGIC",
      name: "EDH-0029 Outer Magic",
      printedCategory: "magic",
      cost: 0,
      levelDefs: [],
      symbolColors: [],
    });
    const definitionLookup = createDefinitionLookup([
      continuationSourceDefinition,
      outerMagicDefinition,
    ]);
    const outerStack: ActiveStack = {
      stackId: "stack:edh-0029:outer-magic",
      actionKind: "magic",
      chainId: "chain:edh-0029:outer-magic",
      actingPlayerId: "bob",
      cardInstanceId: "edh-0029-outer-magic",
      cardDefinitionId: outerMagicDefinition.cardNo,
      targetInstanceIds: [],
      targetEffectFilterTags: [],
      chosenTiming: "stack",
      previousResponseSourcePlayerId: null,
      previousPendingStackAction: null,
      isNullified: true,
    };
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(continuationSourceDefinition, {
            instanceId: "edh-0029-continuation-source",
            ownerPlayerId: "alice",
            zone: "field",
            normalCoreCount: 1,
          }),
          createCardInstance(outerMagicDefinition, {
            instanceId: "edh-0029-outer-magic",
            ownerPlayerId: "bob",
            zone: "in_use",
          }),
        ],
      }),
      step: "attack",
      pendingAfterTriggersContinuations: [
        {
          chainId: "test:index:17508",
          continuationId: "after-triggers:edh-0029",
          waitChainId: "chain:edh-0029:continuation",
          sourceDefinitionId: continuationSourceDefinition.cardNo,
          effectIndex: 0,
          resumeEffectOverride: {
            timing: { kind: "continuous" },
            steps: [],
          },
          sourceInstanceId: "edh-0029-continuation-source",
          actingPlayerId: "alice",
          resumeStepIndex: 0,
          stepContext: { results: {} },
        },
      ],
      pendingStackCascade: { remainingStacks: [outerStack] },
    };

    const afterResume = resumeStackCascadeIfReady(state, {
      getCardDefinitionById: definitionLookup,
    });

    expect(afterResume.pendingAfterTriggersContinuations).toHaveLength(0);
    expect(afterResume.pendingStackCascade).toBeNull();
    expect(
      afterResume.cardInstances.find(
        (card) => card.instanceId === "edh-0029-outer-magic"
      )?.zone
    ).toBe("trash");
    assertValidGameState(afterResume);
  });

  it("発動宣言窓でサブスタックが使われた場合、効果発揮宣言窓は開かず直接解決される", () => {
    // バースト発動宣言でサブスタック (magic 等) が使われた場合:
    // 発動宣言でスタックタイミングを使い切ったので効果発揮宣言窓は開かない
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-NO-EFFECT-DECL-001",
      name: "Burst No Effect Decl Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["〖バースト：相手のライフ減少後〗バースト解決ログを残す。"],
    });

    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "STACK-MAGIC-001",
      name: "Stack Magic",
      printedCategory: "magic",
      cost: 0,
      levelDefs: [],
      symbolColors: [],
      textLines: ["フラッシュ[コスト0]：スタックマジックログを残す。"],
    });

    const definitionLookup = createDefinitionLookup([
      burstSpiritDefinition,
      stackMagicDefinition,
    ]);

    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-NO-EFFECT-DECL-001": [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
        },
      ],
    });

    const getRegisteredMagicActions = createMagicActionRegistrationLookup({
      "STACK-MAGIC-001": {
        timing: "stack",
      },
    });

    const getHandWrittenEffectResolver = (cardNo: string) => {
      if (cardNo === "BURST-NO-EFFECT-DECL-001") {
        return (currentState: ReturnType<typeof createEmptyGameState>) => ({
          ...currentState,
          log: [...currentState.log, `burst-no-effect-decl:resolved:${cardNo}`],
        });
      }
      if (cardNo === "STACK-MAGIC-001") {
        return (currentState: ReturnType<typeof createEmptyGameState>) => ({
          ...currentState,
          log: [...currentState.log, `stack-magic:resolved:${cardNo}`],
        });
      }
      return undefined;
    };

    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(burstSpiritDefinition, {
            instanceId: "burst-no-effect-decl-001",
            ownerPlayerId: "bob",
            zone: "burst",
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "stack-magic-001",
            ownerPlayerId: "alice",
            zone: "hand",
            normalCoreCount: 0,
          }),
        ],
        setBurstStates: [
          { playerId: "bob", cardInstanceId: "burst-no-effect-decl-001" },
        ],
        pendingBurstChecks: [
          {
            checkId: "burst:no-effect-decl:001",
            actingPlayerId: "bob",
            eventKind: "reduce_life" as const,
            source: "action_resolution" as const,
            chainId: "demo-chain",
            attackId: null,
            relatedPlayerId: "bob",
            amount: 1,
            step: "main" as const,
            window: "none" as const,
            resolvedBurstCardInstanceIds: [],
          },
        ],
      }),
      step: "main" as const,
    };

    // bob がバースト発動 → 発動宣言窓が開く
    const burstAction = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        (a as { sourceInstanceId?: string }).sourceInstanceId ===
          "burst-no-effect-decl-001"
    );

    expect(burstAction).toBeDefined();

    const activationWindowState = applyLegalAction({
      state,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getHandWrittenEffectResolver,
    }).state;

    expect(activationWindowState.stackWindow?.burstWindowKind).toBe(
      "activation"
    );
    expect(activationWindowState.stackWindow?.subStackEverOpened).toBe(false);

    // alice が stack タイミングで magic を使う (発動宣言にスタック)
    const magicAction = getLegalActions({
      state: activationWindowState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions,
    }).find(
      (a) =>
        a.kind === "use_magic" &&
        (a as { sourceInstanceId?: string }).sourceInstanceId ===
          "stack-magic-001"
    );

    expect(magicAction).toBeDefined();

    const afterMagicAction = applyLegalAction({
      state: activationWindowState,
      action: magicAction!,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver,
    }).state;

    // subStackEverOpened が true になっている
    expect(afterMagicAction.stackWindow?.subStackEverOpened).toBe(true);
    assertValidGameState(afterMagicAction);

    // 両者パス → サブスタック (magic) 解決 → 発動宣言窓に戻る (subStackEverOpened: true のまま)
    const afterSubStackResolve = fullyResolveMainStepStack({
      state: afterMagicAction,
      getCardDefinitionById: definitionLookup,
      getHandWrittenEffectResolver,
      getRegisteredBurstActions,
    });

    // バースト解決が完了 (効果発揮宣言窓は開かれなかった)
    expect(afterSubStackResolve.stackWindow).toBeNull();
    expect(afterSubStackResolve.window).toBe("none");
    expect(afterSubStackResolve.pendingBurstChecks).toHaveLength(0);
    expect(
      afterSubStackResolve.cardInstances.find(
        (c) => c.instanceId === "burst-no-effect-decl-001"
      )?.zone
    ).toBe("trash");
    expect(afterSubStackResolve.log).toContain(
      "burst-no-effect-decl:resolved:BURST-NO-EFFECT-DECL-001"
    );
    // magic も解決されている
    expect(afterSubStackResolve.log).toContain(
      "stack-magic:resolved:STACK-MAGIC-001"
    );
  });

  it("hasFollowUp=true (ソースカード自動召喚) のバーストが main step で発動する場合、stack window を経て効果解決後にソースカードが召喚される", () => {
    // playsSourceCardWithoutCostAfterResolve=true:
    // 効果解決後にソースカード(spirit)をフィールドに召喚する
    // 発動宣言窓→効果発揮宣言窓の2段階スタック窓を経由してから解決する
    const burstSpiritDefinition = createDemoCardDefinition({
      cardNo: "BURST-FOLLOW-UP-SOURCE-001",
      name: "Burst Follow-Up Source Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: [
        "〖バースト：相手のライフ減少後〗この効果発揮後、このカードをコストを支払わずに召喚する。",
      ],
    });
    const definitionLookup = createDefinitionLookup([burstSpiritDefinition]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      "BURST-FOLLOW-UP-SOURCE-001": [
        {
          sourceKind: "spirit" as const,
          eventKind: "reduce_life" as const,
          playSourceCardWithoutCostAfterResolve: true,
        },
      ],
    });

    // alice が active player, bob がバーストオーナー (bob は reserve core 1 個必要)
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{}, { reserveNormalCoreCount: 1 }],
      cardInstances: [
        createCardInstance(burstSpiritDefinition, {
          instanceId: "burst-follow-up-source-001",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        { playerId: "bob", cardInstanceId: "burst-follow-up-source-001" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:follow-up-source:test",
          actingPlayerId: "bob",
          eventKind: "reduce_life" as const,
          source: "action_resolution" as const,
          chainId: "test:index:17760",
          attackId: null,
          relatedPlayerId: "bob",
          amount: 1,
          step: "main" as const,
          window: "none" as const,
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    const mainStepState = { ...state, step: "main" as const };

    // bob が resolve_pending_burst_check を実行 → stack window が開く (hasFollowUp=true)
    const burstAction = getLegalActions({
      state: mainStepState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        (a as { sourceInstanceId?: string }).sourceInstanceId ===
          "burst-follow-up-source-001"
    );

    expect(burstAction).toBeDefined();

    // enterFieldCorePlacements を渡す → burstActiveStack.enterFieldCorePlacements に保存される
    const openedState = applyLegalAction({
      state: mainStepState,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    }).state;

    // stack window (activation 窓) が開いた
    expect(openedState.window).toBe("stack");
    expect(openedState.stackWindow?.burstWindowKind).toBe("activation");
    expect(openedState.stackWindow?.actingPlayerId).toBe("bob");
    // バーストカードはまだフィールドにない (スタック解決待ち)
    expect(
      openedState.cardInstances.find(
        (c) => c.instanceId === "burst-follow-up-source-001"
      )?.zone
    ).toBe("burst");
    assertValidGameState(openedState);

    // alice/bob がパス × 2 (activation 窓) → effect_declaration 窓
    // alice/bob がパス × 2 (effect_declaration 窓) → バースト解決 + ソースカード召喚
    const resolvedState = fullyResolveMainStepStack({
      state: openedState,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    });

    // スタック窓が閉じ、バースト処理完了
    expect(resolvedState.window).toBe("none");
    expect(resolvedState.stackWindow).toBeNull();
    // spirit_summoned burst check may be generated when the source spirit enters field
    expect(
      resolvedState.pendingBurstChecks.every((bc) => bc.eventKind === "summon")
    ).toBe(true);

    // ソースカードがフィールドに召喚されている
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "burst-follow-up-source-001"
      )
    ).toEqual(
      expect.objectContaining({
        zone: "field",
        normalCoreCount: 1,
      })
    );
    // setBurstStates から除去されている (セット中ではない)
    expect(resolvedState.setBurstStates).toHaveLength(0);
  });
});

describe("end_attack_step action", () => {
  it("end_attack_step は attack ステップ・window=none・activeAttack=null のとき利用可能", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    expect(actions.some((a) => a.kind === "end_attack_step")).toBe(true);
  });

  it("end_attack_step を実行すると end step へ遷移する", () => {
    const spiritDefinition = createDemoSpiritDefinition();
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);
    const endAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "end_attack_step")!;

    const result = applyLegalAction({
      state,
      action: endAction,
      getCardDefinitionById: definitionLookup,
    });

    expect(result.state.step).toBe("end");
    expect(result.state.window).toBe("end_step_effects");
    expect(result.state.activePlayerId).toBe("alice");
  });

  it("バトル解決後 (window=none, activeAttack=null) に end_attack_step が利用可能になる", () => {
    // シンボルなしの攻撃者を使い、ライフダメージとバーストチェックを回避する
    const spiritDefinition = createDemoCardDefinition({
      cardNo: "DEMO-NO-SYMBOL-001",
      name: "No Symbol Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDefinition, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([spiritDefinition]);

    // attack → flash → start_battle_resolution (P3-55: BP 比較 + listener pending まで一括)
    const attackedState = fullyDeclareAttack({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "attacker-1",
      getCardDefinitionById: definitionLookup,
    }).state;
    const readyForResolutionState = closeAvailableBattleFlashWindow(
      attackedState,
      definitionLookup
    );
    // P3-55 Phase B: ブロック宣言なしのケースでは defender (bob) の decline_block apply で
    // バトル解決まで一括完了する。
    const declineAction = getLegalActions({
      state: readyForResolutionState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "decline_block")!;
    const resolvedState = applyLegalAction({
      state: readyForResolutionState,
      action: declineAction,
      getCardDefinitionById: definitionLookup,
    }).state;

    expect(resolvedState.window).toBe("none");
    expect(resolvedState.activeAttack).toBeNull();

    const endAttackActions = getLegalActions({
      state: resolvedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).filter((a) => a.kind === "end_attack_step");

    expect(endAttackActions).toHaveLength(1);
  });
});

describe("spirit-targeted attack (指定アタック)", () => {
  function makeBaseState(attackerCores = 1, targetCores = 1) {
    const attackerDef = createDemoCardDefinition({
      cardNo: "ATTACKER-001",
      name: "Attacker",
      printedCategory: "spirit",
      symbolColors: [],
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "TARGET-001",
      name: "Target",
      printedCategory: "spirit",
      symbolColors: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: attackerCores,
          }),
          createCardInstance(targetDef, {
            instanceId: "target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: targetCores,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([attackerDef, targetDef]);
    return { state, definitionLookup, attackerDef, targetDef };
  }

  function passPreDeclarationStack(
    state: GameState,
    playerId: string,
    definitionLookup: (id: string) => CardDefinition | undefined,
    options?: {
      getRegisteredBattleImmediateEffectActions?: Parameters<
        typeof applyLegalAction
      >[0]["getRegisteredBattleImmediateEffectActions"];
      getRegisteredBurstActions?: Parameters<
        typeof applyLegalAction
      >[0]["getRegisteredBurstActions"];
      getHandWrittenEffectResolver?: Parameters<
        typeof applyLegalAction
      >[0]["getHandWrittenEffectResolver"];
    }
  ) {
    const passAction = getLegalActions({
      state,
      actingPlayerId: playerId,
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "pass_pre_declaration_stack");
    return applyLegalAction({
      state,
      action: passAction!,
      getCardDefinitionById: definitionLookup,
      ...(options?.getRegisteredBurstActions
        ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
        : {}),
      ...(options?.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
      ...(options?.getHandWrittenEffectResolver
        ? { getHandWrittenEffectResolver: options.getHandWrittenEffectResolver }
        : {}),
    });
  }

  it("opponent spirit on field generates a spirit-targeting attack action", () => {
    const { state, definitionLookup } = makeBaseState();

    const attackActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).filter((a) => a.kind === "attack");

    // normal player-targeting + 1 spirit-targeting = 2
    expect(attackActions).toHaveLength(2);
    const spiritTargetAction = attackActions.find(
      (a) => a.kind === "attack" && a.targetInstanceId !== undefined
    );
    expect(spiritTargetAction).toMatchObject({
      kind: "attack",
      sourceInstanceId: "attacker-1",
      targetInstanceId: "target-1",
    });
  });

  it("spirit-targeted attack opens a forced-block pre-declaration stack before declare_block", () => {
    const { state, definitionLookup } = makeBaseState();

    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");

    // Tentative (pre-declaration stack)
    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    });
    expect(tentative.state.window).toBe("pre_declaration_stack");
    expect(tentative.state.preDeclarationStackWindow?.targetInstanceId).toBe(
      "target-1"
    );

    // Bob passes → stack closes, attack confirmed, forced_block pre-declaration stack opens
    const forcedBlockTentative = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup
    );

    expect(forcedBlockTentative.state.window).toBe("pre_declaration_stack");
    expect(forcedBlockTentative.state.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      actingPlayerId: "bob",
      sourceInstanceId: "target-1",
      participantEntityId: "battle-entity:attacker-1",
      priorityPlayerId: "alice",
    });
    expect(forcedBlockTentative.state.activeAttack?.target).toEqual({
      kind: "battle_entity",
      entityId: "battle-entity:target-1",
    });
    expect(
      forcedBlockTentative.state.activeAttack?.flashBeforeBlockCompleted
    ).toBe(false);

    const result = fullyConfirmPreDeclarationStack(
      forcedBlockTentative.state,
      definitionLookup
    );

    expect(result.window).toBe("declare_block");
    expect(result.activeAttack?.target).toEqual({
      kind: "battle_entity",
      entityId: "battle-entity:target-1",
    });
    expect(result.activeAttack?.flashBeforeBlockCompleted).toBe(true);
    expect(result.activeAttack?.flashAfterBlockCompleted).toBe(false);
    expect(result.activeAttack?.blockAssignments).toEqual([
      {
        participantEntityId: "battle-entity:attacker-1",
        blockedByEntityIds: ["battle-entity:target-1"],
      },
    ]);
    // Target entity is created and marked as blocking
    const targetEntity = result.battleEntities.find(
      (e) => e.entityId === "battle-entity:target-1"
    );
    expect(targetEntity?.attackState).toBe("blocking");
  });

  it("after-block flash must open before resolution can fire (P3-55 Phase B: decline_block も提示されない)", () => {
    const { state, definitionLookup } = makeBaseState();
    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");
    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    });
    const forcedBlockTentative = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup
    );
    const confirmed = fullyConfirmPreDeclarationStack(
      forcedBlockTentative.state,
      definitionLookup
    );
    // P3-55 Phase B: forced block 確定直後は after_block flash を開ける必要がある。
    // defender (bob) の decline_block は既にブロック確定 (block_already_declared) のため不発。
    const immediateActions = getLegalActions({
      state: confirmed,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    const defenderImmediateActions = getLegalActions({
      state: confirmed,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    expect(
      defenderImmediateActions.some((a) => a.kind === "decline_block")
    ).toBe(false);
    // After-block flash can be opened
    expect(
      immediateActions.some(
        (a) => a.kind === "open_battle_flash" && a.flashKind === "after_block"
      )
    ).toBe(true);
  });

  it("queues block-triggered battle immediate effects when a spirit-targeted attack becomes a forced block", () => {
    const attackerDef = createDemoCardDefinition({
      cardNo: "ATTACKER-BLOCK-IMMEDIATE-001",
      name: "Attacker Block Immediate",
      printedCategory: "spirit",
      symbolColors: [],
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "TARGET-BLOCK-IMMEDIATE-001",
      name: "Target Block Immediate",
      printedCategory: "spirit",
      symbolColors: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetDef, {
            instanceId: "target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([attackerDef, targetDef]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [targetDef.cardNo]: [
          {
            timing: "block",
            sourceKind: "spirit",
            reason: "designated_forced_block_trigger",
          },
        ],
      });

    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");

    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const forcedBlockTentative = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup,
      { getRegisteredBattleImmediateEffectActions: battleImmediateLookup }
    );
    const confirmedState = fullyConfirmPreDeclarationStack(
      forcedBlockTentative.state,
      definitionLookup,
      battleImmediateLookup
    );

    expect(confirmedState.window).toBe("declare_block");
    expect(confirmedState.battleImmediateEffects).toEqual([
      expect.objectContaining({
        timing: "block",
        sourceInstanceId: "target-1",
        sourceCardNo: targetDef.cardNo,
        actingPlayerId: "bob",
        participantEntityId: "battle-entity:target-1",
      }),
    ]);

    const attackerSideActions = getLegalActions({
      state: confirmedState,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    expect(
      attackerSideActions.some(
        (legalAction) =>
          legalAction.kind === "open_battle_flash" &&
          legalAction.flashKind === "after_block"
      )
    ).toBe(false);

    const blockImmediateAction = getLegalActions({
      state: confirmedState,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find(
      (legalAction) => legalAction.kind === "resolve_battle_immediate_effect"
    );

    expect(blockImmediateAction).toBeDefined();

    const blockImmediateDeclared = applyLegalAction({
      state: confirmedState,
      action: blockImmediateAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const afterImmediate = closeBattleImmediateStackWindow({
      state: blockImmediateDeclared,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });

    expect(afterImmediate.battleImmediateEffects).toEqual([]);
    expect(
      getLegalActions({
        state: afterImmediate,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
      }).find(
        (legalAction) =>
          legalAction.kind === "open_battle_flash" &&
          legalAction.flashKind === "after_block"
      )
    ).toBeDefined();
  });

  it("queues battle-triggered battle immediate effects when a spirit-targeted attack becomes a forced block", () => {
    const attackerDef = createDemoCardDefinition({
      cardNo: "ATTACKER-BATTLE-IMMEDIATE-001",
      name: "Attacker Battle Immediate",
      printedCategory: "spirit",
      symbolColors: [],
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "TARGET-BATTLE-IMMEDIATE-001",
      name: "Target Battle Immediate",
      printedCategory: "spirit",
      symbolColors: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetDef, {
            instanceId: "target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([attackerDef, targetDef]);
    const battleImmediateLookup =
      createBattleImmediateEffectActionRegistrationLookup({
        [targetDef.cardNo]: [
          {
            timing: "battle",
            sourceKind: "spirit",
            reason: "designated_forced_battle_trigger",
          },
        ],
      });

    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");

    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBattleImmediateEffectActions: battleImmediateLookup,
    });
    const forcedBlockTentative = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup,
      { getRegisteredBattleImmediateEffectActions: battleImmediateLookup }
    );
    const confirmedState = fullyConfirmPreDeclarationStack(
      forcedBlockTentative.state,
      definitionLookup,
      battleImmediateLookup
    );

    expect(confirmedState.window).toBe("declare_block");
    expect(confirmedState.battleImmediateEffects).toEqual([
      expect.objectContaining({
        timing: "battle",
        sourceInstanceId: "target-1",
        sourceCardNo: targetDef.cardNo,
        actingPlayerId: "bob",
        participantEntityId: "battle-entity:target-1",
      }),
    ]);
  });

  it("can complete the designated-attack flow through after-block flash, battle resolution, and end_attack_step", () => {
    const attackerDef = createDemoCardDefinition({
      cardNo: "ATTACKER-RES-001",
      name: "Attacker Resolve",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: [],
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "TARGET-RES-001",
      name: "Target Resolve",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetDef, {
            instanceId: "target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([attackerDef, targetDef]);

    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");

    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    });
    const forcedBlockTentative = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup
    );
    const confirmed = fullyConfirmPreDeclarationStack(
      forcedBlockTentative.state,
      definitionLookup
    );
    // P3-55 Phase B: after_block flash close で auto-chain によりバトル解決まで完了する。
    const resolvedState = closeAvailableBattleFlashWindow(
      confirmed,
      definitionLookup
    );

    expect(resolvedState.window).toBe("none");
    expect(resolvedState.activeAttack).toBeNull();
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "attacker-1"
      )?.zone
    ).toBe("trash");
    expect(
      resolvedState.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "target-1"
      )?.zone
    ).toBe("field");
    expect(resolvedState.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        eventKind: "destroy",
        actingPlayerId: "alice",
        relatedInstanceId: "attacker-1",
      }),
      expect.objectContaining({
        eventKind: "trash_increase",
        relatedInstanceId: "attacker-1",
        source: "battle_resolution",
      }),
      expect.objectContaining({
        eventKind: "leave_field",
        relatedInstanceId: "attacker-1",
        source: "battle_resolution",
        cause: "battle",
      }),
    ]);
    // leave_field burst check may be generated from card_destroyed
    expect(
      resolvedState.pendingBurstChecks.every(
        (bc) => bc.eventKind === "leave_field"
      )
    ).toBe(true);
    expect(resolvedState.log).toContain("attack:flash-before-block-skipped");
    expect(
      resolvedState.log.some((entry) => entry.includes("attacker_destroyed"))
    ).toBe(true);

    const afterAllReactions = drainPendingReactions(
      resolvedState,
      definitionLookup
    );

    expect(afterAllReactions.pendingTriggeredEffects).toEqual([]);
    expect(afterAllReactions.pendingBurstChecks).toEqual([]);

    const endAttackAction = getLegalActions({
      state: afterAllReactions,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "end_attack_step");

    expect(endAttackAction).toBeDefined();
  });

  it("falls back to a normal attack if the designated target disappears during the forced-block stack", () => {
    const { state, definitionLookup } = makeBaseState();
    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");
    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    });
    const forcedBlockTentative = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup
    );

    expect(forcedBlockTentative.state.preDeclarationStackWindow?.kind).toBe(
      "forced_block"
    );

    const stateWithTargetGone = {
      ...forcedBlockTentative.state,
      cardInstances: forcedBlockTentative.state.cardInstances.map((card) =>
        card.instanceId === "target-1"
          ? { ...card, zone: "trash" as const }
          : card
      ),
    };
    const result = passPreDeclarationStack(
      stateWithTargetGone,
      "alice",
      definitionLookup
    );

    expect(result.state.window).toBe("declare_attack");
    expect(result.state.activeAttack?.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(result.state.activeAttack?.flashBeforeBlockCompleted).toBe(false);
    expect(result.state.log).toContain(
      "attack:spirit-target-cancelled:target-1:target-no-longer-valid-after-forced-block-stack"
    );
    expect(
      getLegalActions({
        state: result.state,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).some(
        (legalAction) =>
          legalAction.kind === "open_battle_flash" &&
          legalAction.flashKind === "before_block"
      )
    ).toBe(true);
  });

  it("resolves a forced-block stack response before confirming the forced block exactly once", () => {
    const { state: baseState, attackerDef, targetDef } = makeBaseState();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "DESIGNATED-FORCED-BLOCK-STACK-ONCE-001",
      name: "Designated Forced Block Stack Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...baseState,
      cardInstances: [
        ...baseState.cardInstances,
        createCardInstance(stackMagicDefinition, {
          instanceId: "alice-forced-block-stack-magic-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
    };
    const definitionLookup = createDefinitionLookup([
      attackerDef,
      targetDef,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "designated_forced_block_stack_response",
      },
    });
    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (action) =>
        action.kind === "attack" && action.targetInstanceId === "target-1"
    );
    expect(spiritTargetAction).toBeDefined();
    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    }).state;
    const forcedBlockTentative = passPreDeclarationStack(
      tentative,
      "bob",
      definitionLookup
    ).state;
    expect(forcedBlockTentative.preDeclarationStackWindow?.kind).toBe(
      "forced_block"
    );

    const stackMagicAction = getLegalActions({
      state: forcedBlockTentative,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find(
      (action) =>
        action.kind === "use_magic" &&
        action.sourceInstanceId === "alice-forced-block-stack-magic-1"
    );
    expect(stackMagicAction).toBeDefined();
    const subStackState = applyLegalAction({
      state: forcedBlockTentative,
      action: stackMagicAction!,
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
    }).state;

    const resolved = passPreDeclarationStack(
      subStackState,
      "bob",
      definitionLookup
    ).state;

    expect(resolved.preDeclarationStackWindow).toBeNull();
    expect(resolved.pendingPreDeclarationConfirmation).toBeNull();
    expect(resolved.window).toBe("declare_block");
    expect(resolved.activeAttack?.target).toEqual({
      kind: "battle_entity",
      entityId: "battle-entity:target-1",
    });
    expect(
      resolved.activeAttack?.blockAssignments[0]?.blockedByEntityIds
    ).toEqual(["battle-entity:target-1"]);
  });

  it("falls back to a normal attack if a stack magic removes the designated target during the forced-block stack", () => {
    const attackerDef = createDemoSpiritDefinition();
    const targetDef = createDemoSpiritDefinition();
    const stackMagicDefinition = createDemoCardDefinition({
      cardNo: "DESIGNATED-FORCED-BLOCK-STACK-001",
      name: "Designated Forced Block Stack Magic",
      printedCategory: "magic",
      cost: 0,
      reductionSymbols: [],
    });
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(attackerDef, {
            instanceId: "attacker-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(targetDef, {
            instanceId: "target-1",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(stackMagicDefinition, {
            instanceId: "alice-stack-magic-1",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
        ],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };
    const definitionLookup = createDefinitionLookup([
      attackerDef,
      targetDef,
      stackMagicDefinition,
    ]);
    const magicLookup = createMagicActionRegistrationLookup({
      [stackMagicDefinition.cardNo]: {
        timing: "stack",
        reason: "designated_forced_block_stack_response",
        requiredTargetCount: 1,
        candidateTargetZones: ["field"],
        candidateTargetPlayerScope: "any",
      },
    });
    const removeTargetResolver = (cardNo: string) =>
      cardNo === stackMagicDefinition.cardNo
        ? (currentState: GameState, context: EffectActionContext) => ({
            ...currentState,
            cardInstances: currentState.cardInstances.map((cardInstance) =>
              cardInstance.instanceId === context.targetInstanceIds[0]
                ? { ...cardInstance, zone: "trash" as const }
                : cardInstance
            ),
          })
        : undefined;

    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");

    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredMagicActions: magicLookup,
    });
    const forcedBlockTentative = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup
    );

    expect(forcedBlockTentative.state.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      actingPlayerId: "bob",
      priorityPlayerId: "alice",
    });

    const aliceActions = getLegalActions({
      state: forcedBlockTentative.state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions: magicLookup,
    });
    const stackMagicAction = aliceActions.find(
      (legalAction) =>
        legalAction.kind === "use_magic" &&
        legalAction.sourceInstanceId === "alice-stack-magic-1"
    );

    expect(stackMagicAction).toMatchObject({
      kind: "use_magic",
      timing: "stack",
      sourceInstanceId: "alice-stack-magic-1",
    });

    const stackedState = applyLegalAction({
      state: forcedBlockTentative.state,
      action: stackMagicAction!,
      targetInstanceIds: ["target-1"],
      paymentSources: [],
      getCardDefinitionById: definitionLookup,
      getRegisteredMagicActions: magicLookup,
      getHandWrittenEffectResolver: removeTargetResolver,
    }).state;

    // 1-pass cascade: bob のパスで sub-stack 解決 + pre-declaration 窓クローズ +
    // forced_block 確定ロジックが走り、target 消滅により通常アタックへフォールバック
    const result = passPreDeclarationStack(
      stackedState,
      "bob",
      definitionLookup,
      {
        getHandWrittenEffectResolver: removeTargetResolver,
      }
    );

    expect(
      result.state.cardInstances.find(
        (cardInstance) => cardInstance.instanceId === "target-1"
      )?.zone
    ).toBe("trash");
    expect(result.state.window).toBe("declare_attack");
    expect(result.state.activeAttack?.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(result.state.activeAttack?.flashBeforeBlockCompleted).toBe(false);
    expect(result.state.log).toContain(
      "attack:spirit-target-cancelled:target-1:target-no-longer-valid-after-forced-block-stack"
    );
    expect(
      result.state.pendingBurstChecks.some(
        (check) =>
          check.eventKind === "leave_field" &&
          check.relatedInstanceId === "target-1"
      )
    ).toBe(true);
    const afterLeaveReactions = drainPendingReactions(
      result.state,
      definitionLookup
    );
    expect(
      getLegalActions({
        state: afterLeaveReactions,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
      }).some(
        (legalAction) =>
          legalAction.kind === "open_battle_flash" &&
          legalAction.flashKind === "before_block"
      )
    ).toBe(true);
  });

  it("if spirit target disappears during pre-declaration stack, attack falls back to player-targeting", () => {
    const { state, definitionLookup } = makeBaseState();
    const spiritTargetAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");
    const tentative = applyLegalAction({
      state,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    });

    // Simulate target leaving field during pre-declaration stack
    const stateWithTargetGone = {
      ...tentative.state,
      cardInstances: tentative.state.cardInstances.map((c) =>
        c.instanceId === "target-1" ? { ...c, zone: "trash" as const } : c
      ),
    };

    const result = passPreDeclarationStack(
      stateWithTargetGone,
      "bob",
      definitionLookup
    );

    // Reverted to normal player-targeting attack
    expect(result.state.window).toBe("declare_attack");
    expect(result.state.activeAttack?.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(result.state.activeAttack?.flashBeforeBlockCompleted).toBe(false);
    expect(result.state.log).toContain(
      "attack:spirit-target-cancelled:target-1:target-no-longer-valid"
    );
  });

  it("waits for attack-after burst resolution before finalizing the designated block flow", () => {
    const { state, attackerDef, targetDef } = makeBaseState();
    const burstDef = createDemoCardDefinition({
      cardNo: "BURST-ATTACK-AFTER-001",
      name: "Burst Attack After",
      printedCategory: "spirit",
      symbolColors: [],
      textLines: ["【バースト：相手のスピリットのアタック後】"],
      keywordTags: ["burst"],
    });
    const definitionLookup = createDefinitionLookup([
      attackerDef,
      targetDef,
      burstDef,
    ]);
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstDef.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "attack_after",
        },
      ],
    });
    const stateWithBurst: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(burstDef, {
          instanceId: "burst-attack-after-1",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
      ],
      setBurstStates: [
        { playerId: "bob", cardInstanceId: "burst-attack-after-1" },
      ],
    };

    const spiritTargetAction = getLegalActions({
      state: stateWithBurst,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");

    const tentative = applyLegalAction({
      state: stateWithBurst,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    });
    const confirmed = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup,
      { getRegisteredBurstActions }
    );

    expect(confirmed.state.window).toBe("declare_attack");
    expect(confirmed.state.activeAttack?.target).toEqual({
      kind: "battle_entity",
      entityId: "battle-entity:target-1",
    });
    expect(confirmed.state.activeAttack?.flashBeforeBlockCompleted).toBe(false);
    expect(confirmed.state.pendingBurstChecks).toEqual([
      expect.objectContaining({
        eventKind: "attack_after",
        event: {
          family: "action_after",
          actionKind: "attack",
          validationMode: "require_related_instance_on_field",
        },
        actingPlayerId: "bob",
        relatedPlayerId: "alice",
        relatedInstanceId: "attacker-1",
      }),
    ]);

    const burstActions = getLegalActions({
      state: confirmed.state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    const burstAction = burstActions.find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-attack-after-1"
    );

    expect(burstAction).toBeDefined();

    const declaredBurst = applyLegalAction({
      state: confirmed.state,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    });
    const resolvedState = fullyResolveMainStepStack({
      state: declaredBurst.state,
      getRegisteredTriggeredEffectActions: () => [],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
    });

    expect(resolvedState.window).toBe("pre_declaration_stack");
    expect(resolvedState.preDeclarationStackWindow).toMatchObject({
      kind: "forced_block",
      actingPlayerId: "bob",
      sourceInstanceId: "target-1",
      participantEntityId: "battle-entity:attacker-1",
      priorityPlayerId: "alice",
    });
    expect(resolvedState.activeAttack?.flashBeforeBlockCompleted).toBe(false);

    const finalized = fullyConfirmPreDeclarationStack(
      resolvedState,
      definitionLookup
    );

    expect(finalized.window).toBe("declare_block");
    expect(finalized.activeAttack?.flashBeforeBlockCompleted).toBe(true);
    expect(finalized.activeAttack?.blockAssignments).toEqual([
      {
        participantEntityId: "battle-entity:attacker-1",
        blockedByEntityIds: ["battle-entity:target-1"],
      },
    ]);
    const targetEntity = finalized.battleEntities.find(
      (battleEntity) => battleEntity.entityId === "battle-entity:target-1"
    );
    expect(targetEntity?.attackState).toBe("blocking");
  });

  it("falls back to a normal attack if the designated target disappears while the attack-after burst resolves", () => {
    const { state, attackerDef, targetDef } = makeBaseState();
    const burstDef = createDemoCardDefinition({
      cardNo: "BURST-ATTACK-AFTER-REMOVE-001",
      name: "Burst Attack After Remove",
      printedCategory: "spirit",
      symbolColors: [],
      textLines: ["【バースト：相手のスピリットのアタック後】"],
      keywordTags: ["burst"],
    });
    const destroyTriggerDef = createDemoCardDefinition({
      cardNo: "DESTROY-REACTION-SOURCE-001",
      name: "Destroy Reaction Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([
      attackerDef,
      targetDef,
      burstDef,
      destroyTriggerDef,
    ]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [destroyTriggerDef.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "destroy",
            eventMatcher: { family: "leave_field", causeKind: "destroy" },
            reason: "target_destroy_reaction",
          },
        ],
      });
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstDef.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "attack_after",
          requiredTargetCount: 1,
          candidateTargetZones: ["field"],
          targetEffectFilterTags: ["general"],
        },
      ],
    });
    const stateWithBurst: GameState = {
      ...state,
      cardInstances: [
        ...state.cardInstances,
        createCardInstance(burstDef, {
          instanceId: "burst-attack-after-remove-1",
          ownerPlayerId: "bob",
          zone: "burst",
        }),
        createCardInstance(destroyTriggerDef, {
          instanceId: "destroy-reaction-source-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
      setBurstStates: [
        { playerId: "bob", cardInstanceId: "burst-attack-after-remove-1" },
      ],
    };
    const spiritTargetAction = getLegalActions({
      state: stateWithBurst,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "attack" && a.targetInstanceId === "target-1");

    const tentative = applyLegalAction({
      state: stateWithBurst,
      action: spiritTargetAction!,
      getCardDefinitionById: definitionLookup,
    });
    const confirmed = passPreDeclarationStack(
      tentative.state,
      "bob",
      definitionLookup,
      { getRegisteredBurstActions }
    );
    const burstAction = getLegalActions({
      state: confirmed.state,
      actingPlayerId: "bob",
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find(
      (legalAction) =>
        legalAction.kind === "resolve_pending_burst_check" &&
        legalAction.sourceInstanceId === "burst-attack-after-remove-1"
    );

    expect(burstAction).toBeDefined();

    const declaredBurst = applyLegalAction({
      state: confirmed.state,
      action: burstAction!,
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions,
      getHandWrittenEffectResolver: () =>
        createTargetCardPendingLeaveResolver({ pendingLeaveKind: "destroy" }),
    });
    const resolvedState = fullyResolveMainStepStack({
      state: declaredBurst.state,
      pendingEffectTargetInstanceIds: ["target-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredTriggeredEffectActions,
      getHandWrittenEffectResolver: () =>
        createTargetCardPendingLeaveResolver({ pendingLeaveKind: "destroy" }),
    });

    expect(resolvedState.window).toBe("declare_attack");
    expect(resolvedState.activeAttack?.flashBeforeBlockCompleted).toBe(false);
    expect(resolvedState.activeAttack?.target).toEqual({
      kind: "battle_entity",
      entityId: "battle-entity:target-1",
    });
    expect(
      resolvedState.pendingTriggeredEffects.map((pendingEffect) => ({
        eventKind: pendingEffect.eventKind,
        relatedInstanceId: pendingEffect.relatedInstanceId,
      }))
    ).toContainEqual({
      eventKind: "destroy",
      relatedInstanceId: "target-1",
    });
    expect(
      getLegalActions({
        state: resolvedState,
        actingPlayerId: "alice",
        getCardDefinitionById: definitionLookup,
        getRegisteredFieldCardEffectActions:
          createFieldEffectActionRegistrationLookup({}),
        getRegisteredBurstActions,
      }).some(
        (legalAction) =>
          legalAction.kind === "open_battle_flash" &&
          legalAction.flashKind === "before_block"
      )
    ).toBe(false);

    // Drain any remaining pending reactions (triggered effects + burst checks from new events)
    const afterAllReactions = drainPendingReactions(
      resolvedState,
      definitionLookup,
      { getRegisteredBurstActions, getRegisteredTriggeredEffectActions }
    );

    expect(afterAllReactions.window).toBe("declare_attack");
    expect(afterAllReactions.activeAttack?.target).toEqual({
      kind: "player",
      playerId: "bob",
    });
    expect(afterAllReactions.activeAttack?.flashBeforeBlockCompleted).toBe(
      false
    );
    expect(afterAllReactions.log).toContain(
      "attack:spirit-target-cancelled:target-1:target-no-longer-valid-after-burst"
    );

    const nextActions = getLegalActions({
      state: afterAllReactions,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    expect(
      nextActions.some(
        (legalAction) =>
          legalAction.kind === "open_battle_flash" &&
          legalAction.flashKind === "before_block"
      )
    ).toBe(true);
  });

  it("tryApplyLegalAction がエラー時に元の state にロールバックする", () => {
    const baseState = createEmptyGameState({
      turnPlayerId: "alice",
      nonTurnPlayerId: "bob",
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      window: "main_step",
      log: ["existing-log-entry"],
    };

    // 存在しない instanceId で use_magic を試みると throw される
    const result = tryApplyLegalAction({
      state,
      action: {
        kind: "use_magic",
        actingPlayerId: "alice",
        instanceId: "nonexistent-magic-card",
        definitionId: "NONEXISTENT-DEF",
        timing: "action",
        reducedCost: 0,
        additionalCost: 0,
        finalCost: 0,
      },
      getCardDefinitionById: () => undefined,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // 元の state が保持されている (cardInstances, players 等は変更なし)
      expect(result.state.cardInstances).toEqual(state.cardInstances);
      expect(result.state.players).toEqual(state.players);
      expect(result.state.step).toBe("main");
      expect(result.state.window).toBe("main_step");
      // 元のログが保持されている
      expect(result.state.log).toContain("existing-log-entry");
      // ロールバックログが追加されている
      expect(
        result.state.log.some((entry) =>
          entry.startsWith("action:rollback:use_magic:")
        )
      ).toBe(true);
      // エラーメッセージが設定されている
      expect(result.error).toBeTruthy();
    }
  });

  it("tryApplyLegalAction が成功時に ok: true と結果を返す", () => {
    const baseState = createEmptyGameState({
      turnPlayerId: "alice",
      nonTurnPlayerId: "bob",
    });
    const state: GameState = {
      ...baseState,
      step: "main",
      window: "main_step",
    };

    // end_attack_step は最も単純なアクション (advanceStep するだけ)。
    // P3-40: end_attack_step は activeAttack=null かつ window=none でのみ legal なので
    // fixture も同様にクリア状態で advanceStep が成功することを検証する。
    const result = tryApplyLegalAction({
      state: {
        ...state,
        step: "attack",
        window: "none",
        activeAttack: null,
      },
      action: {
        kind: "end_attack_step",
        actingPlayerId: "alice",
      },
      getCardDefinitionById: () => undefined,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.state).toBeDefined();
    }
  });
});

describe("reevaluation checks", () => {
  function createReevalDef(cardNo: string): CardDefinition {
    return {
      cardNo,
      name: `Reeval ${cardNo}`,
      printedCategory: "spirit",
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C",
    };
  }

  function createReevalState(): GameState {
    const base = createEmptyGameState();
    const sourceDef = createReevalDef("REEVAL-001");
    const targetDef = createReevalDef("REEVAL-002");
    const sourceCard = createCardInstance(sourceDef, {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    return {
      ...base,
      cardInstances: [...base.cardInstances, sourceCard, targetCard],
    };
  }

  it("target_validity passes when all targets are on field", () => {
    const state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "target_validity",
        sourceInstanceId: "irrelevant",
        targetInstanceIds: [target.instanceId],
      })
    ).toBe(true);
  });

  it("target_validity fails when target left the field", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === target.instanceId ? { ...c, zone: "trash" } : c
      ),
    };
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "target_validity",
        sourceInstanceId: "irrelevant",
        targetInstanceIds: [target.instanceId],
      })
    ).toBe(false);
  });

  it("effect_suppression passes when no suppression effect exists", () => {
    const state = createReevalState();
    const source = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-001"
    )!;
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
      })
    ).toBe(true);
  });

  it("effect_suppression fails when a continuous effect suppresses the source", () => {
    let state = createReevalState();
    const source = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-001"
    )!;
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-suppress-1",
          sourceInstanceId: "some-other-card",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "effect_suppression",
          targetInstanceId: source.instanceId,
        },
      ],
    };
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
      })
    ).toBe(false);
  });

  function suppressionCE(
    targetInstanceId: string,
    metadata?: Record<string, unknown>
  ): ContinuousEffect {
    return {
      effectId: "ce-suppress-blanket",
      sourceInstanceId: "some-other-card",
      sourceDefinitionId: "OTHER-001",
      actingPlayerId: "bob",
      duration: { scope: "turn" },
      createdAtTurn: 1,
      createdAtAttackId: null,
      modifierTag: "effect_suppression",
      targetInstanceId,
      ...(metadata ? { metadata } : {}),
    };
  }

  it("blanket suppress_effect (no effectFilter) suppresses every effect regardless of descriptor", () => {
    let state = createReevalState();
    const source = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-001"
    )!;
    // metadata 無し = blanket。異なる timing の効果すべてが抑止される。
    state = {
      ...state,
      activeContinuousEffects: [suppressionCE(source.instanceId)],
    };
    for (const descriptor of [
      undefined,
      { timingKind: "card_event", triggerPhrases: ["召喚時"] },
      { timingKind: "card_event", triggerPhrases: ["アタック時"] },
      { timingKind: "activated", activatedMode: "flash" },
    ]) {
      expect(
        executeReevaluationCheck({
          state,
          checkKind: "effect_suppression",
          sourceInstanceId: source.instanceId,
          targetInstanceIds: [],
          ...(descriptor ? { suppressionEffectDescriptor: descriptor } : {}),
        })
      ).toBe(false);
    }
  });

  it("filtered suppress_effect suppresses only the matching effect", () => {
    let state = createReevalState();
    const source = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-001"
    )!;
    // 「アタック時」効果だけを発揮させない filter。
    state = {
      ...state,
      activeContinuousEffects: [
        suppressionCE(source.instanceId, {
          effectFilter: { triggerPhrase: "アタック時" },
        }),
      ],
    };
    // マッチする効果 → 抑止 (passed=false)
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          triggerPhrases: ["アタック時"],
        },
      })
    ).toBe(false);
    // マッチしない効果 → 抑止されない (passed=true)
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
        suppressionEffectDescriptor: {
          timingKind: "card_event",
          triggerPhrases: ["召喚時"],
        },
      })
    ).toBe(true);
    // descriptor 無し → filter 付き CE はマッチ判定不能なので抑止されない
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
      })
    ).toBe(true);
  });

  it("matchesEffectTargetFilter requires all specified sub-conditions", () => {
    const descriptor = {
      timingKind: "activated",
      heading: "このスピリットのアタック時",
      triggerPhrases: ["アタック時"],
      keywords: ["記憶開放術"],
      activatedMode: "flash",
    };
    // すべて一致
    expect(
      matchesEffectTargetFilter(
        {
          effectIndex: [1, 2],
          timingKind: ["activated", "continuous"],
          triggerPhrase: "アタック時",
          keywords: ["記憶開放術"],
          activatedMode: ["flash"],
        },
        { ...descriptor, effectIndex: 2 }
      )
    ).toBe(true);
    // effectIndex 配列の不一致
    expect(
      matchesEffectTargetFilter(
        { effectIndex: [1, 2] },
        { ...descriptor, effectIndex: 3 }
      )
    ).toBe(false);
    // timingKind 不一致
    expect(
      matchesEffectTargetFilter({ timingKind: "card_event" }, descriptor)
    ).toBe(false);
    // keyword 不足
    expect(
      matchesEffectTargetFilter({ keywords: ["不在キーワード"] }, descriptor)
    ).toBe(false);
    // descriptor 無し → 常に false
    expect(
      matchesEffectTargetFilter({ triggerPhrase: "アタック時" }, undefined)
    ).toBe(false);
  });

  it("blanket suppression lifts when the continuous effect is gone (duration/scope)", () => {
    let state = createReevalState();
    const source = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-001"
    )!;
    state = {
      ...state,
      activeContinuousEffects: [suppressionCE(source.instanceId)],
    };
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
      })
    ).toBe(false);
    // CE が満了・除去されたら抑止は解ける。
    state = { ...state, activeContinuousEffects: [] };
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "effect_suppression",
        sourceInstanceId: source.instanceId,
        targetInstanceIds: [],
      })
    ).toBe(true);
  });

  it("prevention_clash passes when target has no defense", () => {
    const state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "prevention_clash",
        sourceInstanceId: "irrelevant",
        targetInstanceIds: [target.instanceId],
        sourcePreventionLevel: "none",
      })
    ).toBe(true);
  });

  it("prevention_clash fails when target has immune defense and source is not unpreventable", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-immune-1",
          sourceInstanceId: "some-other-card",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
        },
      ],
    };
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "prevention_clash",
        sourceInstanceId: "irrelevant",
        targetInstanceIds: [target.instanceId],
        sourcePreventionLevel: "immune",
      })
    ).toBe(false);
  });

  it("prevention_clash passes when source is unpreventable against immune defense", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-immune-2",
          sourceInstanceId: "some-other-card",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
        },
      ],
    };
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "prevention_clash",
        sourceInstanceId: "irrelevant",
        targetInstanceIds: [target.instanceId],
        sourcePreventionLevel: "unpreventable",
      })
    ).toBe(true);
  });

  it("runReevaluationAtTiming returns skip_step policy on failure", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === target.instanceId ? { ...c, zone: "trash" } : c
      ),
    };
    const result = runReevaluationAtTiming({
      state,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["target_validity"],
            failurePolicy: "skip_step",
          },
        ],
      },
      timing: "after_sba",
      sourceInstanceId: "irrelevant",
      targetInstanceIds: [target.instanceId],
    });
    expect(result.passed).toBe(false);
    expect(result.failurePolicy).toBe("skip_step");
    expect(result.failedChecks).toEqual(["target_validity"]);
  });

  it("runReevaluationAtTiming returns abort_remaining policy on failure", () => {
    let state = createReevalState();
    const source = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-001"
    )!;
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-suppress-2",
          sourceInstanceId: "some-other-card",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "effect_suppression",
          targetInstanceId: source.instanceId,
        },
      ],
    };
    const result = runReevaluationAtTiming({
      state,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["effect_suppression"],
            failurePolicy: "abort_remaining",
          },
        ],
      },
      timing: "after_sba",
      sourceInstanceId: source.instanceId,
      targetInstanceIds: [],
    });
    expect(result.passed).toBe(false);
    expect(result.failurePolicy).toBe("abort_remaining");
    expect(result.failedChecks).toEqual(["effect_suppression"]);
  });

  it("runReevaluationAtTiming returns remove_target policy on prevention_clash failure", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-suppress-defense",
          sourceInstanceId: "some-other-card",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_suppress",
          targetInstanceId: target.instanceId,
        },
      ],
    };
    const result = runReevaluationAtTiming({
      state,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["prevention_clash"],
            failurePolicy: "remove_target",
          },
        ],
        preventionLevel: "none",
      },
      timing: "after_sba",
      sourceInstanceId: "irrelevant",
      targetInstanceIds: [target.instanceId],
    });
    expect(result.passed).toBe(false);
    expect(result.failurePolicy).toBe("remove_target");
    expect(result.failedChecks).toEqual(["prevention_clash"]);
  });

  it("runReevaluationAtTiming defaults to skip_step when no failurePolicy is specified", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === target.instanceId ? { ...c, zone: "trash" } : c
      ),
    };
    const result = runReevaluationAtTiming({
      state,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["target_validity"],
          },
        ],
      },
      timing: "after_sba",
      sourceInstanceId: "irrelevant",
      targetInstanceIds: [target.instanceId],
    });
    expect(result.passed).toBe(false);
    expect(result.failurePolicy).toBe("skip_step");
  });

  it("runReevaluationAtTiming passes when all checks succeed", () => {
    const state = createReevalState();
    const source = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-001"
    )!;
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    const result = runReevaluationAtTiming({
      state,
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: [
              "target_validity",
              "effect_suppression",
              "prevention_clash",
            ],
            failurePolicy: "abort_remaining",
          },
        ],
        preventionLevel: "unpreventable",
      },
      timing: "after_sba",
      sourceInstanceId: source.instanceId,
      targetInstanceIds: [target.instanceId],
    });
    expect(result.passed).toBe(true);
    expect(result.failedChecks).toEqual([]);
  });

  it("runReevaluationAtTiming skips points with non-matching timing", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    state = {
      ...state,
      cardInstances: state.cardInstances.map((c) =>
        c.instanceId === target.instanceId ? { ...c, zone: "trash" } : c
      ),
    };
    const result = runReevaluationAtTiming({
      state,
      registration: {
        reevaluationPoints: [
          {
            timing: "before_each_step",
            checks: ["target_validity"],
            failurePolicy: "abort_remaining",
          },
        ],
      },
      timing: "after_sba",
      sourceInstanceId: "irrelevant",
      targetInstanceIds: [target.instanceId],
    });
    expect(result.passed).toBe(true);
  });

  it("prevention_clash picks strongest defense among multiple continuous effects", () => {
    let state = createReevalState();
    const target = state.cardInstances.find(
      (c) => c.definitionId === "REEVAL-002"
    )!;
    // target has both suppress (weaker) and immune (stronger) defenses
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-suppress-multi",
          sourceInstanceId: "other-card-1",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_suppress",
          targetInstanceId: target.instanceId,
        },
        {
          effectId: "ce-immune-multi",
          sourceInstanceId: "other-card-2",
          sourceDefinitionId: "OTHER-002",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: target.instanceId,
        },
      ],
    };
    // immune (source) vs immune (strongest defense) → fails (same level can't penetrate)
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "prevention_clash",
        sourceInstanceId: "irrelevant",
        targetInstanceIds: [target.instanceId],
        sourcePreventionLevel: "immune",
      })
    ).toBe(false);
    // unpreventable (source) vs immune (strongest defense) → passes
    expect(
      executeReevaluationCheck({
        state,
        checkKind: "prevention_clash",
        sourceInstanceId: "irrelevant",
        targetInstanceIds: [target.instanceId],
        sourcePreventionLevel: "unpreventable",
      })
    ).toBe(true);
  });
});

describe("reevaluation integration — resolution paths", () => {
  function createIntegrationDef(
    cardNo: string,
    category: "spirit" | "magic" = "spirit"
  ): CardDefinition {
    return {
      cardNo,
      name: `IntegrationTest ${cardNo}`,
      printedCategory: category,
      colors: ["red"],
      cost: 1,
      reductionSymbols: [],
      levelDefs:
        category === "spirit" ? [{ level: 1, requiredCores: 1, bp: 1000 }] : [],
      symbolColors: category === "spirit" ? ["red"] : [],
      textLines: [],
      keywordTags: [],
      sourceUrls: [],
      sourceConfidence: "C" as const,
    };
  }

  it("useFieldCardEffectAsAction: reevaluation failure skips trigger collection", () => {
    // Setup: source spirit on field, target spirit on field
    const sourceDef = createIntegrationDef("REEVAL-INT-001");
    const targetDef = createIntegrationDef("REEVAL-INT-002");
    const definitionLookup = createDefinitionLookup([sourceDef, targetDef]);

    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ lifeNormalCoreCount: 3, reserveNormalCoreCount: 5 }],
      cardInstances: [
        createCardInstance(sourceDef, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetDef, {
          instanceId: "target-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    // resolveEffect moves the target to trash (simulating destruction)
    // then the after_sba reevaluation checks target_validity → target is in trash → fails
    const reevalConfig = buildReevaluationConfig(
      {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["target_validity"],
            failurePolicy: "abort_remaining",
          },
        ],
      },
      "source-1",
      ["target-1"]
    );

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: definitionLookup,
      resolveEffect: (currentState) => {
        // Move the target to trash during resolution
        return {
          ...currentState,
          cardInstances: currentState.cardInstances.map((c) =>
            c.instanceId === "target-1"
              ? { ...c, zone: "trash" as const, normalCoreCount: 0 }
              : c
          ),
          log: [...currentState.log, `effect:destroy:target-1`],
        };
      },
      reevaluation: reevalConfig,
    });

    // Reevaluation should have failed → no pending triggers queued
    expect(result.state.pendingTriggeredEffects).toEqual([]);
    expect(result.state.pendingBurstChecks).toEqual([]);
    // Verify the failure was logged
    const failLog = result.state.log.find((l) =>
      l.startsWith("reevaluation:after_sba:failed:")
    );
    expect(failLog).toBeDefined();
    expect(failLog).toContain("target_validity");
    expect(failLog).toContain("abort_remaining");
  });

  it("useFieldCardEffectAsAction: reevaluation passes → triggers fire normally", () => {
    const sourceDef = createIntegrationDef("REEVAL-INT-003");
    const targetDef = createIntegrationDef("REEVAL-INT-004");
    const triggerSourceDef = createDemoCardDefinition({
      cardNo: "REEVAL-TRIGGER-SOURCE-001",
      name: "Reevaluation Trigger Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["red"],
    });
    const definitionLookup = createDefinitionLookup([
      sourceDef,
      targetDef,
      triggerSourceDef,
    ]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            reason: "reevaluation_life_reduced_trigger",
          },
        ],
      });

    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ lifeNormalCoreCount: 2, reserveNormalCoreCount: 5 }],
      cardInstances: [
        createCardInstance(sourceDef, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(targetDef, {
          instanceId: "target-1",
          ownerPlayerId: "bob",
          zone: "field",
          cores: 1,
        }),
        createCardInstance(triggerSourceDef, {
          instanceId: "reeval-trigger-source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const reevalConfig = buildReevaluationConfig(
      {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["target_validity"],
            failurePolicy: "abort_remaining",
          },
        ],
      },
      "source-1",
      ["target-1"]
    );

    // resolveEffect reduces alice's life (triggers life_reduced) but target stays on field
    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredTriggeredEffectActions,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === sourceDef.cardNo
          ? createActingPlayerLifeCoreToSourceCardResolver()
          : undefined,
      reevaluation: reevalConfig,
    });

    // Target is still on field → reevaluation passes → triggers queued
    expect(result.state.pendingTriggeredEffects.length).toBeGreaterThan(0);
    expect(
      result.state.pendingTriggeredEffects.some(
        (t) => t.eventKind === "reduce_life"
      )
    ).toBe(true);
    // No reevaluation failure log
    const failLog = result.state.log.find((l) =>
      l.startsWith("reevaluation:after_sba:failed:")
    );
    expect(failLog).toBeUndefined();
  });

  it("runActionMainResolution: effect_suppression reevaluation failure skips triggers", () => {
    const sourceDef = createIntegrationDef("REEVAL-INT-005");
    const definitionLookup = createDefinitionLookup([sourceDef]);

    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [{ lifeNormalCoreCount: 1, reserveNormalCoreCount: 5 }],
      cardInstances: [
        createCardInstance(sourceDef, {
          instanceId: "source-1",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 1,
        }),
      ],
    });

    const sourceCard = state.cardInstances.find(
      (c) => c.instanceId === "source-1"
    )!;

    // Add effect_suppression on the source
    state = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-suppress-int",
          sourceInstanceId: "enemy-card",
          sourceDefinitionId: "ENEMY-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "effect_suppression",
          targetInstanceId: "source-1",
        },
      ],
    };

    const chainId = "test:reeval:effect-suppression:1";
    const resultState = runActionMainResolution({
      state,
      chainId,
      context: {
        chainId,
        actingPlayerId: "alice",
        sourceKind: "spirit" as const,
        sourceCard,
        sourceDefinition: sourceDef,
        targetInstanceIds: [],
        getCardDefinitionById: definitionLookup,
      },
      startLogs: [`resolve-main:start:${chainId}`],
      endLogs: [
        `resolve-main:end:${chainId}`,
        `resolve-derived:end:${chainId}`,
      ],
      resolveEffect: (currentState) => {
        // Effect that reduces life — but reevaluation should abort before triggers
        return {
          ...currentState,
          players: currentState.players.map((p) =>
            p.playerId === "alice"
              ? {
                  ...p,
                  lifeNormalCoreCount: 0,
                  reserveNormalCoreCount: p.reserveNormalCoreCount + 1,
                }
              : p
          ),
          log: [...currentState.log, `effect:life-reduce:${chainId}:alice`],
        };
      },
      reevaluation: {
        registration: {
          reevaluationPoints: [
            {
              timing: "after_sba",
              checks: ["effect_suppression"],
              failurePolicy: "skip_step",
            },
          ],
        },
        sourceInstanceId: "source-1",
        targetInstanceIds: [],
      },
    });

    // Reevaluation failed (source is suppressed) → no triggers
    expect(resultState.pendingTriggeredEffects).toEqual([]);
    expect(resultState.pendingBurstChecks).toEqual([]);
    const failLog = resultState.log.find((l) =>
      l.startsWith("reevaluation:after_sba:failed:")
    );
    expect(failLog).toBeDefined();
    expect(failLog).toContain("effect_suppression");
    expect(failLog).toContain("skip_step");
  });

  it("buildReevaluationConfig returns undefined when no reevaluation points", () => {
    expect(
      buildReevaluationConfig(undefined, "source-1", ["target-1"])
    ).toBeUndefined();
    expect(
      buildReevaluationConfig({ reevaluationPoints: [] }, "source-1", [
        "target-1",
      ])
    ).toBeUndefined();
    expect(
      buildReevaluationConfig({}, "source-1", ["target-1"])
    ).toBeUndefined();
  });

  it("buildReevaluationConfig creates config with preventionLevel", () => {
    const config = buildReevaluationConfig(
      {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["target_validity"],
            failurePolicy: "abort_remaining",
          },
        ],
        preventionLevel: "immune",
      },
      "source-1",
      ["target-1", "target-2"]
    );
    expect(config).toEqual({
      registration: {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["target_validity"],
            failurePolicy: "abort_remaining",
          },
        ],
        preventionLevel: "immune",
      },
      sourceInstanceId: "source-1",
      targetInstanceIds: ["target-1", "target-2"],
    });
  });

  it("buildReevaluationConfig omits preventionLevel when undefined", () => {
    const config = buildReevaluationConfig(
      {
        reevaluationPoints: [
          {
            timing: "after_sba",
            checks: ["target_validity"],
          },
        ],
      },
      "source-1",
      []
    );
    expect(config).toBeDefined();
    expect(config!.registration).not.toHaveProperty("preventionLevel");
  });

  it("runActionMainResolution: reevaluation failure still flushes pending leaves", () => {
    const sourceDef = createIntegrationDef("REEVAL-FLUSH-001");
    const supportDef = createIntegrationDef("REEVAL-FLUSH-002");
    const definitionLookup = createDefinitionLookup([sourceDef, supportDef]);
    const chainId = "test:reeval:flush-pending:1";

    // Setup: source on field, support on field with pending vanish (cost_payment)
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(sourceDef, {
            instanceId: "source-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
          createCardInstance(supportDef, {
            instanceId: "support-1",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 0,
            pendingLeaveKind: "vanish",
            pendingLeaveCause: "cost_payment",
            pendingLeaveChainId: chainId,
            deferZoneMoveUntilChainEnd: true,
          }),
        ],
      }),
      // Add effect_suppression on the source so reevaluation will fail
      activeContinuousEffects: [
        {
          effectId: "ce-suppress-flush",
          sourceInstanceId: "enemy-card",
          sourceDefinitionId: "ENEMY-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "effect_suppression" as const,
          targetInstanceId: "source-1",
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "support-1",
          kind: "vanish" as const,
          cause: "cost_payment" as const,
          chainId,
          deferZoneMoveUntilChainEnd: true,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const resultState = runActionMainResolution({
      state,
      chainId,
      context: {
        chainId,
        actingPlayerId: "alice",
        sourceKind: "spirit" as const,
        sourceCard: state.cardInstances[0]!,
        sourceDefinition: sourceDef,
        targetInstanceIds: [],
        getCardDefinitionById: definitionLookup,
      },
      startLogs: [`resolve-main:start:${chainId}`],
      endLogs: [`resolve-main:end:${chainId}`],
      resolveEffect: (currentState) => ({
        ...currentState,
        log: [...currentState.log, `effect:noop:${chainId}`],
      }),
      reevaluation: {
        registration: {
          reevaluationPoints: [
            {
              timing: "after_sba",
              checks: ["effect_suppression"],
              failurePolicy: "abort_remaining",
            },
          ],
        },
        sourceInstanceId: "source-1",
        targetInstanceIds: [],
      },
    });

    // Reevaluation should have failed
    const failLog = resultState.log.find((l) =>
      l.startsWith("reevaluation:after_sba:failed:")
    );
    expect(failLog).toBeDefined();
    expect(failLog).toContain("effect_suppression");

    // Main-resolution trigger collection is skipped, but the flush itself
    // still emits leave_field from the pending leave delta.
    expect(resultState.pendingTriggeredEffects).toEqual([
      expect.objectContaining({
        eventKind: "trash_increase",
        relatedInstanceId: "support-1",
      }),
      expect.objectContaining({
        eventKind: "leave_field",
        relatedInstanceId: "support-1",
      }),
    ]);
    // 発動宣言のタイミングは待機入り時なので、実移動では追加しない。
    expect(resultState.pendingBurstChecks).toEqual([]);

    // But pending leave SHOULD have been flushed — support-1 moved to trash
    const supportCard = resultState.cardInstances.find(
      (c) => c.instanceId === "support-1"
    );
    expect(supportCard?.zone).toBe("trash");
    expect(supportCard?.pendingLeaveKind).toBeNull();
    expect(resultState.pendingLeaveEntities).toEqual([]);
    expect(resultState.log).toContain(
      `pending-leave-flushed:vanish:support-1:${chainId}:cost_payment`
    );
  });
});

// ===== E-4: Prevention priority integration tests =====

describe("getStrongestDefenseLevel", () => {
  it("returns none when no defense effects exist", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCard = {
      ...state,
      cardInstances: [...state.cardInstances, card],
    };
    expect(getStrongestDefenseLevel(stateWithCard, card.instanceId)).toBe(
      "none"
    );
  });

  it("returns immune when target has defense_immune", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithDefense = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "other",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: card.instanceId,
        },
      ],
    };
    expect(getStrongestDefenseLevel(stateWithDefense, card.instanceId)).toBe(
      "immune"
    );
  });

  it("returns strongest among multiple defense effects", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithDefense = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-suppress",
          sourceInstanceId: "other1",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_suppress",
          targetInstanceId: card.instanceId,
        },
        {
          effectId: "ce-immune",
          sourceInstanceId: "other2",
          sourceDefinitionId: "OTHER-002",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: card.instanceId,
        },
      ],
    };
    expect(getStrongestDefenseLevel(stateWithDefense, card.instanceId)).toBe(
      "immune"
    );
  });
});

describe("getPreventionBlockReason", () => {
  it("returns null when no defense exists", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCard = {
      ...state,
      cardInstances: [...state.cardInstances, card],
    };
    expect(
      getPreventionBlockReason(stateWithCard, card.instanceId, "none")
    ).toBeNull();
  });

  it("returns block reason when suppress defense blocks none-level source", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithDefense = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "other",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_suppress",
          targetInstanceId: card.instanceId,
        },
      ],
    };
    expect(
      getPreventionBlockReason(stateWithDefense, card.instanceId, "none")
    ).toBe("prevented_by_defense:suppress");
  });

  it("returns null when immune source penetrates suppress defense", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithDefense = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "other",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_suppress",
          targetInstanceId: card.instanceId,
        },
      ],
    };
    expect(
      getPreventionBlockReason(stateWithDefense, card.instanceId, "immune")
    ).toBeNull();
  });

  it("returns block reason when immune defense blocks immune source (same rank)", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithDefense = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "other",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: card.instanceId,
        },
      ],
    };
    expect(
      getPreventionBlockReason(stateWithDefense, card.instanceId, "immune")
    ).toBe("prevented_by_defense:immune");
  });

  it("returns null when unpreventable source penetrates immune defense", () => {
    const state = createEmptyGameState();
    const card = createCardInstance(createDemoSpiritDefinition(), {
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithDefense = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "other",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: card.instanceId,
        },
      ],
    };
    expect(
      getPreventionBlockReason(
        stateWithDefense,
        card.instanceId,
        "unpreventable"
      )
    ).toBeNull();
  });
});

describe("filterTargetsByPreventionLevel", () => {
  it("filters out targets blocked by defense", () => {
    const state = createEmptyGameState();
    const protectedCard = createCardInstance(
      createDemoCardDefinition({
        cardNo: "T-001",
        name: "Protected",
        printedCategory: "spirit",
      }),
      {
        instanceId: "protected-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }
    );
    const unprotectedCard = createCardInstance(
      createDemoCardDefinition({
        cardNo: "T-002",
        name: "Unprotected",
        printedCategory: "spirit",
      }),
      {
        instanceId: "unprotected-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }
    );
    const stateWithCards = {
      ...state,
      cardInstances: [...state.cardInstances, protectedCard, unprotectedCard],
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "other",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: "protected-1",
        },
      ],
    };

    const result = filterTargetsByPreventionLevel(
      stateWithCards,
      ["protected-1", "unprotected-1"],
      "none"
    );
    expect(result).toEqual(["unprotected-1"]);
  });

  it("unpreventable source passes all targets through", () => {
    const state = createEmptyGameState();
    const protectedCard = createCardInstance(
      createDemoCardDefinition({
        cardNo: "T-001",
        name: "Protected",
        printedCategory: "spirit",
      }),
      {
        instanceId: "protected-1",
        ownerPlayerId: "bob",
        zone: "field",
        cores: 1,
      }
    );
    const stateWithCards = {
      ...state,
      cardInstances: [...state.cardInstances, protectedCard],
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "other",
          sourceDefinitionId: "OTHER-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: "protected-1",
        },
      ],
    };

    const result = filterTargetsByPreventionLevel(
      stateWithCards,
      ["protected-1"],
      "unpreventable"
    );
    expect(result).toEqual(["protected-1"]);
  });
});

describe("E-4 resolver integration: prevention blocks target in useFieldCardEffectAsAction", () => {
  it("throws when target is protected by immune defense and source has no prevention", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "SRC-001",
      name: "Source Spirit",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "TGT-001",
      name: "Target Spirit",
      printedCategory: "spirit",
    });
    const state = createEmptyGameState();
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const stateWithCards: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, sourceCard, targetCard],
      activeContinuousEffects: [
        {
          effectId: "ce-immune",
          sourceInstanceId: "shield-card",
          sourceDefinitionId: "SHIELD-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: "target-1",
        },
      ],
    };

    expect(() =>
      useFieldCardEffectAsAction({
        state: stateWithCards,
        actingPlayerId: "alice",
        sourceInstanceId: "source-1",
        sourceKind: "spirit",
        targetInstanceIds: ["target-1"],
        sourcePreventionLevel: "none",
        getCardDefinitionById: createDefinitionLookup([sourceDef, targetDef]),
      })
    ).toThrow("prevented_by_defense:immune");
  });

  it("succeeds when source is unpreventable against immune defense", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "SRC-001",
      name: "Source Spirit",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "TGT-001",
      name: "Target Spirit",
      printedCategory: "spirit",
    });
    const state = createEmptyGameState();
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const stateWithCards: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, sourceCard, targetCard],
      activeContinuousEffects: [
        {
          effectId: "ce-immune",
          sourceInstanceId: "shield-card",
          sourceDefinitionId: "SHIELD-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: "target-1",
        },
      ],
    };

    // Should NOT throw — unpreventable > immune
    const result = useFieldCardEffectAsAction({
      state: stateWithCards,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["target-1"],
      sourcePreventionLevel: "unpreventable",
      getCardDefinitionById: createDefinitionLookup([sourceDef, targetDef]),
    });
    expect(result.state).toBeDefined();
    expect(result.chainId).toBeDefined();
  });

  it("immune source penetrates suppress defense", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "SRC-001",
      name: "Source Spirit",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "TGT-001",
      name: "Target Spirit",
      printedCategory: "spirit",
    });
    const state = createEmptyGameState();
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const stateWithCards: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, sourceCard, targetCard],
      activeContinuousEffects: [
        {
          effectId: "ce-suppress",
          sourceInstanceId: "shield-card",
          sourceDefinitionId: "SHIELD-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_suppress",
          targetInstanceId: "target-1",
        },
      ],
    };

    // immune > suppress: should succeed
    const result = useFieldCardEffectAsAction({
      state: stateWithCards,
      actingPlayerId: "alice",
      sourceInstanceId: "source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["target-1"],
      sourcePreventionLevel: "immune",
      getCardDefinitionById: createDefinitionLookup([sourceDef, targetDef]),
    });
    expect(result.state).toBeDefined();
  });
});

// ===== E-8: ContinuousEffect generation from resolver =====

describe("resolveContinuousEffectOnTarget", () => {
  function createCETestState() {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CE-SRC-001",
      name: "CE Source Spirit",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "CE-TGT-001",
      name: "CE Target Spirit",
      printedCategory: "spirit",
    });
    const base = createEmptyGameState();
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "ce-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "ce-target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    return {
      sourceDef,
      targetDef,
      state: {
        ...base,
        cardInstances: [...base.cardInstances, sourceCard, targetCard],
      } as GameState,
    };
  }

  it("registers defense_immune on target via resolver", () => {
    const { sourceDef, targetDef, state } = createCETestState();
    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "ce-source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["ce-target-1"],
      getCardDefinitionById: createDefinitionLookup([sourceDef, targetDef]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "CE-SRC-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "defense_immune",
              duration: { scope: "turn" },
            })
          : undefined,
    });

    expect(result.state.activeContinuousEffects).toHaveLength(1);
    const ce = result.state.activeContinuousEffects[0];
    expect(ce.modifierTag).toBe("defense_immune");
    expect(ce.targetInstanceId).toBe("ce-target-1");
    expect(ce.sourceInstanceId).toBe("ce-source-1");
    expect(ce.duration).toEqual({ scope: "turn" });
    expect(result.state.log).toContainEqual(
      expect.stringContaining("continuous-effect:registered:")
    );
  });

  it("registers defense_suppress with modifierAmount", () => {
    const { sourceDef, targetDef, state } = createCETestState();
    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "ce-source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["ce-target-1"],
      getCardDefinitionById: createDefinitionLookup([sourceDef, targetDef]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "CE-SRC-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "defense_suppress",
              duration: { scope: "battle" },
            })
          : undefined,
    });

    expect(result.state.activeContinuousEffects).toHaveLength(1);
    const ce = result.state.activeContinuousEffects[0];
    expect(ce.modifierTag).toBe("defense_suppress");
    expect(ce.duration).toEqual({ scope: "battle" });
  });
});

describe("E-8 integration: generated CE affects legality and resolver", () => {
  function createIntegrationTestSetup() {
    const shieldDef = createDemoCardDefinition({
      cardNo: "SHIELD-001",
      name: "Shield Spirit",
      printedCategory: "spirit",
    });
    const attackerDef = createDemoCardDefinition({
      cardNo: "ATTACKER-001",
      name: "Attacker Spirit",
      printedCategory: "spirit",
    });
    const victimDef = createDemoCardDefinition({
      cardNo: "VICTIM-001",
      name: "Victim Spirit",
      printedCategory: "spirit",
    });
    const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const shieldCard = createCardInstance(shieldDef, {
      instanceId: "shield-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackerCard = createCardInstance(attackerDef, {
      instanceId: "attacker-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const victimCard = createCardInstance(victimDef, {
      instanceId: "victim-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    return {
      shieldDef,
      attackerDef,
      victimDef,
      defs: [shieldDef, attackerDef, victimDef],
      state: {
        ...base,
        cardInstances: [
          ...base.cardInstances,
          shieldCard,
          attackerCard,
          victimCard,
        ],
      } as GameState,
    };
  }

  it("step 1: shield generates defense_immune on victim", () => {
    const {
      shieldDef: _shieldDef,
      victimDef: _victimDef,
      defs,
      state,
    } = createIntegrationTestSetup();

    // Shield spirit uses effect to grant defense_immune to victim
    const shieldResult = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "shield-1",
      sourceKind: "spirit",
      targetInstanceIds: ["victim-1"],
      getCardDefinitionById: createDefinitionLookup(defs),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SHIELD-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "defense_immune",
              duration: { scope: "turn" },
            })
          : undefined,
    });

    // CE registered
    expect(shieldResult.state.activeContinuousEffects).toHaveLength(1);
    expect(shieldResult.state.activeContinuousEffects[0].modifierTag).toBe(
      "defense_immune"
    );

    // Now check: getStrongestDefenseLevel should report "immune" for victim
    expect(getStrongestDefenseLevel(shieldResult.state, "victim-1")).toBe(
      "immune"
    );
  });

  it("step 2: attacker effect blocked by generated defense_immune", () => {
    const { defs, state } = createIntegrationTestSetup();

    // First: Shield grants defense_immune to victim
    const shieldResult = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "shield-1",
      sourceKind: "spirit",
      targetInstanceIds: ["victim-1"],
      getCardDefinitionById: createDefinitionLookup(defs),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SHIELD-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "defense_immune",
              duration: { scope: "turn" },
            })
          : undefined,
    });

    // Then: Attacker tries to target victim — should throw (prevention block)
    expect(() =>
      useFieldCardEffectAsAction({
        state: shieldResult.state,
        actingPlayerId: "bob",
        sourceInstanceId: "attacker-1",
        sourceKind: "spirit",
        targetInstanceIds: ["victim-1"],
        sourcePreventionLevel: "none",
        getCardDefinitionById: createDefinitionLookup(defs),
      })
    ).toThrow("prevented_by_defense:immune");
  });

  it("step 3: unpreventable attacker penetrates generated defense_immune", () => {
    const { defs, state } = createIntegrationTestSetup();

    // Shield grants defense_immune to victim
    const shieldResult = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "shield-1",
      sourceKind: "spirit",
      targetInstanceIds: ["victim-1"],
      getCardDefinitionById: createDefinitionLookup(defs),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SHIELD-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "defense_immune",
              duration: { scope: "turn" },
            })
          : undefined,
    });

    // Attacker with unpreventable can target victim
    const attackResult = useFieldCardEffectAsAction({
      state: shieldResult.state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker-1",
      sourceKind: "spirit",
      targetInstanceIds: ["victim-1"],
      sourcePreventionLevel: "unpreventable",
      getCardDefinitionById: createDefinitionLookup(defs),
    });

    expect(attackResult.state).toBeDefined();
    expect(attackResult.chainId).toBeDefined();
  });

  it("step 4: reevaluation prevention_clash catches generated defense_immune", () => {
    const { defs, state } = createIntegrationTestSetup();

    // Shield grants defense_immune to victim
    const shieldResult = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "shield-1",
      sourceKind: "spirit",
      targetInstanceIds: ["victim-1"],
      getCardDefinitionById: createDefinitionLookup(defs),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SHIELD-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "defense_immune",
              duration: { scope: "turn" },
            })
          : undefined,
    });

    // Check reevaluation prevention_clash with the generated CE
    const reeval = executeReevaluationCheck({
      state: shieldResult.state,
      checkKind: "prevention_clash",
      sourceInstanceId: "attacker-1",
      targetInstanceIds: ["victim-1"],
      sourcePreventionLevel: "none",
    });
    expect(reeval).toBe(false); // blocked by defense_immune

    // But unpreventable passes
    const reevalPass = executeReevaluationCheck({
      state: shieldResult.state,
      checkKind: "prevention_clash",
      sourceInstanceId: "attacker-1",
      targetInstanceIds: ["victim-1"],
      sourcePreventionLevel: "unpreventable",
    });
    expect(reevalPass).toBe(true);
  });

  it("step 5: CE cleaned up when target leaves field and resolution stabilizes", () => {
    const { defs, state } = createIntegrationTestSetup();

    // Shield grants defense_immune to victim
    const shieldResult = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "shield-1",
      sourceKind: "spirit",
      targetInstanceIds: ["victim-1"],
      getCardDefinitionById: createDefinitionLookup(defs),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SHIELD-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "defense_immune",
              duration: { scope: "turn" },
            })
          : undefined,
    });
    expect(shieldResult.state.activeContinuousEffects).toHaveLength(1);

    // Attacker destroys victim (using pending leave resolver with unpreventable)
    const destroyResult = useFieldCardEffectAsAction({
      state: shieldResult.state,
      actingPlayerId: "bob",
      sourceInstanceId: "attacker-1",
      sourceKind: "spirit",
      targetInstanceIds: ["victim-1"],
      sourcePreventionLevel: "unpreventable",
      getCardDefinitionById: createDefinitionLookup(defs),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "ATTACKER-001"
          ? createTargetCardPendingLeaveResolver({
              pendingLeaveKind: "destroy",
            })
          : undefined,
    });

    // victim should be in trash after flushPendingLeaves
    const victim = destroyResult.state.cardInstances.find(
      (c) => c.instanceId === "victim-1"
    );
    expect(victim?.zone).toBe("trash");

    // CE is cleaned up after pending leave flush, before the next action.
    expect(destroyResult.state.activeContinuousEffects).toHaveLength(0);
    expect(destroyResult.state.log).toContainEqual(
      expect.stringContaining("continuous-effect:expired:")
    );
  });
});

// ===== E-8 (continued): bp_modifier ContinuousEffect =====

describe("getBpModifierTotal", () => {
  it("returns 0 when no bp_modifier CE exists", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    expect(getBpModifierTotal(state, "some-card")).toBe(0);
  });

  it("sums multiple bp_modifier CEs for the same target", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 3000,
          targetInstanceId: "target-1",
        },
        {
          effectId: "ce-2",
          sourceInstanceId: "src-2",
          sourceDefinitionId: "SRC-002",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: -1000,
          targetInstanceId: "target-1",
        },
        {
          effectId: "ce-3",
          sourceInstanceId: "src-3",
          sourceDefinitionId: "SRC-003",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "defense_immune",
          targetInstanceId: "target-1",
        },
      ],
    };
    // Only bp_modifier CEs are counted, not defense_immune
    expect(getBpModifierTotal(state, "target-1")).toBe(2000);
  });

  it("ignores bp_modifier for different target", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [
        {
          effectId: "ce-1",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 5000,
          targetInstanceId: "other-card",
        },
      ],
    };
    expect(getBpModifierTotal(state, "target-1")).toBe(0);
  });
});

describe("getEffectiveBp", () => {
  it("returns base BP when no modifiers exist", () => {
    const def = createDemoSpiritDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCard = {
      ...state,
      cardInstances: [...state.cardInstances, card],
    };
    // Lv1 requires 1 core, BP = 2000
    expect(getEffectiveBp(stateWithCard, card, def)).toBe(2000);
  });

  it("adds bp_modifier CE to base BP", () => {
    const def = createDemoSpiritDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCard: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-bp",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 5000,
          targetInstanceId: "spirit-1",
        },
      ],
    };
    // Base 2000 + 5000 = 7000
    expect(getEffectiveBp(stateWithCard, card, def)).toBe(7000);
  });

  it("clamps to 0 when negative modifier exceeds base BP", () => {
    const def = createDemoSpiritDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCard: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-debuff",
          sourceInstanceId: "debuff-src",
          sourceDefinitionId: "DEBUFF-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: -10000,
          targetInstanceId: "spirit-1",
        },
      ],
    };
    // Base 2000 - 10000 = -8000, clamped to 0
    expect(getEffectiveBp(stateWithCard, card, def)).toBe(0);
  });
});

describe("recomputeBattleEntityBp", () => {
  it("updates BattleEntity.resolvedBp after bp_modifier CE is added", () => {
    const def = createDemoSpiritDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithBattle: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      battleEntities: [
        {
          entityId: "entity-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000, // original base BP
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-bp",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 3000,
          targetInstanceId: "spirit-1",
        },
      ],
    };

    const result = recomputeBattleEntityBp(
      stateWithBattle,
      createDefinitionLookup([def])
    );
    expect(result.battleEntities[0].resolvedBp).toBe(5000);
  });

  it("returns unchanged state when no BP change needed", () => {
    const def = createDemoSpiritDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithBattle: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      battleEntities: [
        {
          entityId: "entity-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    const result = recomputeBattleEntityBp(
      stateWithBattle,
      createDefinitionLookup([def])
    );
    // Same object reference — no change
    expect(result).toBe(stateWithBattle);
  });
});

describe("E-8 bp_modifier integration: resolver generates bp_modifier and it affects battle", () => {
  it("bp_modifier CE registered via resolver updates BattleEntity BP in resolution pipeline", () => {
    const buffDef = createDemoCardDefinition({
      cardNo: "BUFF-001",
      name: "Buff Spirit",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "WARRIOR-001",
      name: "Warrior Spirit",
      printedCategory: "spirit",
      levelDefs: [
        { level: 1, requiredCores: 1, bp: 3000 },
        { level: 2, requiredCores: 3, bp: 5000 },
      ],
    });
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const buffCard = createCardInstance(buffDef, {
      instanceId: "buff-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const warriorCard = createCardInstance(targetDef, {
      instanceId: "warrior-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCards: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, buffCard, warriorCard],
      battleEntities: [
        {
          entityId: "entity-warrior",
          memberInstanceIds: ["warrior-1"],
          resolvedBp: 3000, // base BP at Lv1
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    // Buff spirit uses effect to add +2000 BP to warrior
    const result = useFieldCardEffectAsAction({
      state: stateWithCards,
      actingPlayerId: "alice",
      sourceInstanceId: "buff-1",
      sourceKind: "spirit",
      targetInstanceIds: ["warrior-1"],
      getCardDefinitionById: createDefinitionLookup([buffDef, targetDef]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "BUFF-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "bp_modifier",
              duration: { scope: "turn" },
              modifierAmount: 2000,
            })
          : undefined,
    });

    // CE registered
    expect(result.state.activeContinuousEffects).toHaveLength(1);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "bp_modifier"
    );
    expect(result.state.activeContinuousEffects[0].modifierAmount).toBe(2000);

    // BattleEntity BP updated by recomputeBattleEntityBp in pipeline
    expect(result.state.battleEntities[0].resolvedBp).toBe(5000);

    // Log confirms CE registration
    expect(result.state.log).toContainEqual(
      expect.stringContaining("continuous-effect:registered:")
    );
  });

  it("bp_modifier CE expires at turn end and BP reverts", () => {
    const def = createDemoSpiritDefinition();
    const lookup = createDefinitionLookup([def]);
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [card],
      battleEntities: [
        {
          entityId: "entity-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 5000, // base 2000 + modifier 3000
          resolvedSymbols: ["red"],
          attackState: "idle",
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-bp-buff",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 3000,
          targetInstanceId: "spirit-1",
        },
      ],
    };

    // Advance step to trigger turn end cleanup
    const advancedState = advanceStep(state, lookup);

    // Keep advancing until turn wraps (end step -> start of next turn)
    // P3-40: drain step_transition pendings before each advanceStep
    let current = advancedState;
    while (current.turnNumber === 1) {
      current = { ...current, pendingTriggeredEffects: [] };
      current = advanceStep(current, lookup);
    }

    // After turn end, "this_turn" CE should be removed
    expect(current.activeContinuousEffects).toHaveLength(0);
    // resolvedBp should revert to base BP (2000)
    expect(current.battleEntities[0].resolvedBp).toBe(2000);
  });

  it("bp_modifier CE with this_battle duration expires at battle end and BP reverts", () => {
    const def = createDemoSpiritDefinition();
    const lookup = createDefinitionLookup([def]);
    const attackerCard = createCardInstance(def, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack-group:1:alice:entity-atk";
    // P3-55: start_battle_resolution apply で battle resolution を完了させるため、
    // pre-resolve 状態 (window=declare_attack, battleResolutionGroup=null) で構築する。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      step: "attack",
      window: "declare_attack",
      cardInstances: [attackerCard],
      battleEntities: [
        {
          entityId: "entity-atk",
          memberInstanceIds: ["attacker-1"],
          resolvedBp: 5000, // base 2000 + modifier 3000
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId,
        primaryEntityId: "entity-atk",
        participantEntityIds: ["entity-atk"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          { participantEntityId: "entity-atk", blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: ["entity-atk"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      activeContinuousEffects: [
        {
          effectId: "ce-bp-battle",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "battle" },
          createdAtTurn: 1,
          createdAtAttackId: attackId,
          modifierTag: "bp_modifier",
          modifierAmount: 3000,
          targetInstanceId: "attacker-1",
        },
      ],
    };

    // P3-55 Phase B: 防御側 (bob) の decline_block apply でバトル解決まで完了する。
    const result = applyLegalAction({
      state,
      action: {
        kind: "decline_block",
        actionId: "decline-block-test",
        can: true,
        reason: "",
        actingPlayerId: "bob",
        attackId,
      },
      getCardDefinitionById: lookup,
    });

    // After battle end, "this_battle" CE should be removed
    expect(result.state.activeContinuousEffects).toHaveLength(0);
    // resolvedBp should revert to base BP (2000)
    const entity = result.state.battleEntities.find(
      (e) => e.entityId === "entity-atk"
    );
    expect(entity).toBeDefined();
    expect(entity!.resolvedBp).toBe(2000);
  });
});

// ===== E-8 (continued): bp_modifier via trigger-system paths =====

describe("E-8 bp_modifier integration: trigger / burst / deferred reaction paths", () => {
  it("bp_modifier CE registered via triggered effect resolver immediately updates BattleEntity.resolvedBp", () => {
    const spiritDef = createDemoCardDefinition({
      cardNo: "TRIGGER-SPIRIT-001",
      name: "Trigger Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([spiritDef]);
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [spiritCard],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:attack-declared:1",
          actingPlayerId: "alice",
          eventKind: "attack_declared",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-1",
          amount: 0,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const triggerAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "resolve_pending_triggered_effect");

    expect(triggerAction).toBeDefined();

    const result = applyLegalAction({
      state,
      action: triggerAction!,
      getCardDefinitionById: lookup,
      resolvePendingTriggeredEffect: (currentState) => ({
        ...currentState,
        activeContinuousEffects: [
          ...currentState.activeContinuousEffects,
          {
            effectId: "ce-trigger-bp-buff",
            sourceInstanceId: "spirit-1",
            sourceDefinitionId: "TRIGGER-SPIRIT-001",
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: currentState.turnNumber,
            createdAtAttackId: currentState.activeAttack?.attackId ?? null,
            modifierTag: "bp_modifier",
            modifierAmount: 2000,
            targetInstanceId: "spirit-1",
          },
        ],
        log: [
          ...currentState.log,
          "continuous-effect:registered:ce-trigger-bp-buff:bp_modifier:spirit-1:this_turn",
        ],
      }),
    });

    // CE was registered
    expect(result.state.activeContinuousEffects).toHaveLength(1);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "bp_modifier"
    );
    expect(result.state.activeContinuousEffects[0].modifierAmount).toBe(2000);

    // BattleEntity.resolvedBp updated in the trigger resolution path (not catch-up)
    const entity = result.state.battleEntities.find(
      (e) => e.entityId === "battle-entity:spirit-1"
    );
    expect(entity).toBeDefined();
    expect(entity!.resolvedBp).toBe(5000); // 3000 base + 2000 modifier
  });

  it("bp_modifier CE registered via burst check resolver immediately updates BattleEntity.resolvedBp", () => {
    const spiritDef = createDemoCardDefinition({
      cardNo: "BURST-SPIRIT-001",
      name: "Burst Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 4000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([spiritDef]);
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [spiritCard],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 4000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst-check:life-reduced:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "resolve_pending_burst_check");

    expect(burstAction).toBeDefined();

    const result = applyLegalAction({
      state,
      action: burstAction!,
      getCardDefinitionById: lookup,
      resolvePendingBurstCheck: (currentState) => ({
        ...currentState,
        activeContinuousEffects: [
          ...currentState.activeContinuousEffects,
          {
            effectId: "ce-burst-bp-buff",
            sourceInstanceId: "spirit-1",
            sourceDefinitionId: "BURST-SPIRIT-001",
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: currentState.turnNumber,
            createdAtAttackId: currentState.activeAttack?.attackId ?? null,
            modifierTag: "bp_modifier",
            modifierAmount: 3000,
            targetInstanceId: "spirit-1",
          },
        ],
        log: [
          ...currentState.log,
          "continuous-effect:registered:ce-burst-bp-buff:bp_modifier:spirit-1:this_turn",
        ],
      }),
    });

    // CE was registered
    expect(result.state.activeContinuousEffects).toHaveLength(1);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "bp_modifier"
    );

    // BattleEntity.resolvedBp updated in the burst resolution path
    const entity = result.state.battleEntities.find(
      (e) => e.entityId === "battle-entity:spirit-1"
    );
    expect(entity).toBeDefined();
    expect(entity!.resolvedBp).toBe(7000); // 4000 base + 3000 modifier
  });

  it("bp_modifier CE registered via deferred reaction (chained trigger) updates resolvedBp", () => {
    // Set up: a triggered effect resolver registers a bp_modifier CE,
    // and a second pending trigger is queued. Verify the BP is updated
    // after the first trigger resolves, before the second is processed.
    const spiritDef = createDemoCardDefinition({
      cardNo: "CHAIN-SPIRIT-001",
      name: "Chain Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([spiritDef]);
    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [spiritDef.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "attack_declared",
            reason: "chained_bp_trigger",
          },
        ],
      });
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [spiritCard],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:first:1",
          actingPlayerId: "alice",
          eventKind: "attack_declared",
          source: "action_resolution",
          chainId: "chain-1",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-1",
          amount: 0,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
        {
          pendingId: "trigger:second:2",
          actingPlayerId: "alice",
          eventKind: "attack_declared",
          source: "action_resolution",
          chainId: "chain-1",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-1",
          amount: 0,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    // P3-36 厳密モード: 同一オーナー (alice) 複数 pending でも turn=alice が select する
    const selectFirstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) =>
        a.kind === "select_pending_to_resolve" &&
        a.pendingId === "trigger:first:1"
    );
    expect(selectFirstAction).toBeDefined();
    const stateAfterSelectFirst = applyLegalAction({
      state,
      action: selectFirstAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
    }).state;

    // Resolve first trigger - registers bp_modifier +1500
    const firstTriggerAction = getLegalActions({
      state: stateAfterSelectFirst,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === "trigger:first:1"
    );
    expect(firstTriggerAction).toBeDefined();

    const afterFirst = applyLegalAction({
      state: stateAfterSelectFirst,
      action: firstTriggerAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      resolvePendingTriggeredEffect: (currentState) => ({
        ...currentState,
        activeContinuousEffects: [
          ...currentState.activeContinuousEffects,
          {
            effectId: "ce-chain-bp-1",
            sourceInstanceId: "spirit-1",
            sourceDefinitionId: "CHAIN-SPIRIT-001",
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: currentState.turnNumber,
            createdAtAttackId: currentState.activeAttack?.attackId ?? null,
            modifierTag: "bp_modifier",
            modifierAmount: 1500,
            targetInstanceId: "spirit-1",
          },
        ],
        log: [
          ...currentState.log,
          "continuous-effect:registered:ce-chain-bp-1:bp_modifier:spirit-1:this_turn",
        ],
      }),
    });

    // After first trigger: BP should already be updated
    const entityAfterFirst = afterFirst.state.battleEntities.find(
      (e) => e.entityId === "battle-entity:spirit-1"
    );
    expect(entityAfterFirst).toBeDefined();
    expect(entityAfterFirst!.resolvedBp).toBe(3500); // 2000 + 1500

    // P3-36 厳密モード: 残った pending を select してから resolve（残り 1 件なら auto-select）
    const stateBeforeSecond = afterFirst.state;
    const stateForSecondResolve =
      stateBeforeSecond.pendingTriggeredEffects.length > 1
        ? applyLegalAction({
            state: stateBeforeSecond,
            action: getLegalActions({
              state: stateBeforeSecond,
              actingPlayerId: "alice",
              getCardDefinitionById: lookup,
              getRegisteredFieldCardEffectActions:
                createFieldEffectActionRegistrationLookup({}),
              getRegisteredTriggeredEffectActions,
            }).find(
              (a) =>
                a.kind === "select_pending_to_resolve" &&
                a.pendingId === "trigger:second:2"
            )!,
            getCardDefinitionById: lookup,
            getRegisteredTriggeredEffectActions,
          }).state
        : stateBeforeSecond;

    // Resolve second trigger - registers additional bp_modifier +500
    const secondTriggerAction = getLegalActions({
      state: stateForSecondResolve,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_triggered_effect" &&
        a.pendingId === "trigger:second:2"
    );
    expect(secondTriggerAction).toBeDefined();

    const afterSecond = applyLegalAction({
      state: stateForSecondResolve,
      action: secondTriggerAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions,
      resolvePendingTriggeredEffect: (currentState) => ({
        ...currentState,
        activeContinuousEffects: [
          ...currentState.activeContinuousEffects,
          {
            effectId: "ce-chain-bp-2",
            sourceInstanceId: "spirit-1",
            sourceDefinitionId: "CHAIN-SPIRIT-001",
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: currentState.turnNumber,
            createdAtAttackId: currentState.activeAttack?.attackId ?? null,
            modifierTag: "bp_modifier",
            modifierAmount: 500,
            targetInstanceId: "spirit-1",
          },
        ],
        log: [
          ...currentState.log,
          "continuous-effect:registered:ce-chain-bp-2:bp_modifier:spirit-1:this_turn",
        ],
      }),
    });

    // After second trigger: both modifiers stacked
    const entityAfterSecond = afterSecond.state.battleEntities.find(
      (e) => e.entityId === "battle-entity:spirit-1"
    );
    expect(entityAfterSecond).toBeDefined();
    expect(entityAfterSecond!.resolvedBp).toBe(4000); // 2000 + 1500 + 500
    expect(afterSecond.state.activeContinuousEffects).toHaveLength(2);
  });
});

// ===== E-8 (continued): symbol_addition ContinuousEffect =====

describe("getSymbolAdditions", () => {
  it("returns empty array when no symbol_addition CE exists", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    expect(getSymbolAdditions(state, "some-card")).toEqual([]);
  });

  it("collects multiple symbol_addition CEs for the same target", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [
        {
          effectId: "ce-sym-1",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["green"],
          targetInstanceId: "target-1",
        },
        {
          effectId: "ce-sym-2",
          sourceInstanceId: "src-2",
          sourceDefinitionId: "SRC-002",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["blue"],
          targetInstanceId: "target-1",
        },
        {
          effectId: "ce-bp-1",
          sourceInstanceId: "src-3",
          sourceDefinitionId: "SRC-003",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 1000,
          targetInstanceId: "target-1",
        },
      ],
    };
    // Only symbol_addition CEs are collected, not bp_modifier.
    // 単色は長さ1の配列、dual-color は複数要素の配列で表現される。
    expect(getSymbolAdditions(state, "target-1")).toEqual([
      ["green"],
      ["blue"],
    ]);
  });

  it("returns dual-color additions as multi-element arrays", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [
        {
          effectId: "ce-dual-1",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "step", step: "main" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["red", "purple"],
          targetInstanceId: "target-1",
        },
      ],
    };
    expect(getSymbolAdditions(state, "target-1")).toEqual([["red", "purple"]]);
  });

  it("ignores symbol_addition for different target", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activeContinuousEffects: [
        {
          effectId: "ce-sym-other",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["green"],
          targetInstanceId: "other-card",
        },
      ],
    };
    expect(getSymbolAdditions(state, "target-1")).toEqual([]);
  });
});

describe("getEffectiveSymbols", () => {
  it("returns base symbols when no symbol_addition CE exists", () => {
    const def = createDemoSpiritDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCard: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, card],
    };
    expect(getEffectiveSymbols(stateWithCard, card, def)).toEqual(["red"]);
  });

  it("appends symbol_addition CE symbols to base symbols", () => {
    const def = createDemoSpiritDefinition();
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCard: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, card],
      activeContinuousEffects: [
        {
          effectId: "ce-sym-1",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["green"],
          targetInstanceId: "spirit-1",
        },
      ],
    };
    expect(getEffectiveSymbols(stateWithCard, card, def)).toEqual([
      "red",
      "green",
    ]);
  });
});

describe("E-8 symbol_addition integration: resolver generates symbol_addition and it affects battle", () => {
  it("symbol_addition CE registered via resolver updates BattleEntity.resolvedSymbols in resolution pipeline", () => {
    const buffDef = createDemoCardDefinition({
      cardNo: "SYM-BUFF-001",
      name: "Symbol Buff Spirit",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "WARRIOR-SYM-001",
      name: "Warrior Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const buffCard = createCardInstance(buffDef, {
      instanceId: "buff-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const warriorCard = createCardInstance(targetDef, {
      instanceId: "warrior-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const stateWithCards: GameState = {
      ...state,
      cardInstances: [...state.cardInstances, buffCard, warriorCard],
      battleEntities: [
        {
          entityId: "entity-warrior",
          memberInstanceIds: ["warrior-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    // Buff spirit uses effect to add green symbol to warrior
    const result = useFieldCardEffectAsAction({
      state: stateWithCards,
      actingPlayerId: "alice",
      sourceInstanceId: "buff-1",
      sourceKind: "spirit",
      targetInstanceIds: ["warrior-1"],
      getCardDefinitionById: createDefinitionLookup([buffDef, targetDef]),
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SYM-BUFF-001"
          ? createContinuousEffectOnTargetResolver({
              modifierTag: "symbol_addition",
              duration: { scope: "turn" },
              modifierSymbol: ["green"],
            })
          : undefined,
    });

    // CE registered
    expect(result.state.activeContinuousEffects).toHaveLength(1);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "symbol_addition"
    );
    expect(result.state.activeContinuousEffects[0].modifierSymbol).toEqual([
      "green",
    ]);

    // BattleEntity symbols updated
    expect(result.state.battleEntities[0].resolvedSymbols).toEqual([
      "red",
      "green",
    ]);
  });

  it("symbol_addition CE registered via triggered effect resolver immediately updates BattleEntity.resolvedSymbols", () => {
    const spiritDef = createDemoCardDefinition({
      cardNo: "TRIGGER-SYM-001",
      name: "Trigger Symbol Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([spiritDef]);
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [spiritCard],
      battleEntities: [
        {
          entityId: "battle-entity:spirit-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:sym-add:1",
          actingPlayerId: "alice",
          eventKind: "attack_declared",
          source: "action_resolution",
          chainId: "demo-chain",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-1",
          amount: 0,
          step: "attack",
          window: "none",
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const triggerAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    }).find((a) => a.kind === "resolve_pending_triggered_effect");
    expect(triggerAction).toBeDefined();

    const result = applyLegalAction({
      state,
      action: triggerAction!,
      getCardDefinitionById: lookup,
      resolvePendingTriggeredEffect: (currentState) => ({
        ...currentState,
        activeContinuousEffects: [
          ...currentState.activeContinuousEffects,
          {
            effectId: "ce-trigger-sym",
            sourceInstanceId: "spirit-1",
            sourceDefinitionId: "TRIGGER-SYM-001",
            actingPlayerId: "alice",
            duration: { scope: "turn" },
            createdAtTurn: currentState.turnNumber,
            createdAtAttackId: currentState.activeAttack?.attackId ?? null,
            modifierTag: "symbol_addition",
            modifierSymbol: ["purple"] as const,
            targetInstanceId: "spirit-1",
          },
        ],
        log: [
          ...currentState.log,
          "continuous-effect:registered:ce-trigger-sym:symbol_addition:spirit-1:this_turn",
        ],
      }),
    });

    // BattleEntity.resolvedSymbols updated in the trigger resolution path
    const entity = result.state.battleEntities.find(
      (e) => e.entityId === "battle-entity:spirit-1"
    );
    expect(entity).toBeDefined();
    expect(entity!.resolvedSymbols).toEqual(["red", "purple"]);
  });

  it("symbol_addition CE expires at turn end and symbols revert", () => {
    const def = createDemoSpiritDefinition();
    const lookup = createDefinitionLookup([def]);
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [card],
      battleEntities: [
        {
          entityId: "entity-1",
          memberInstanceIds: ["spirit-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red", "green"], // base red + added green
          attackState: "idle",
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-sym-turn",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["green"],
          targetInstanceId: "spirit-1",
        },
      ],
    };

    // Advance step until turn wraps (P3-40: drain step_transition pendings)
    let current = advanceStep(state, lookup);
    while (current.turnNumber === 1) {
      current = { ...current, pendingTriggeredEffects: [] };
      current = advanceStep(current, lookup);
    }

    // After turn end, "this_turn" CE should be removed
    expect(current.activeContinuousEffects).toHaveLength(0);
    // resolvedSymbols should revert to base ["red"]
    expect(current.battleEntities[0].resolvedSymbols).toEqual(["red"]);
  });

  it("symbol_addition CE with this_battle duration expires at battle end and symbols revert", () => {
    const def = createDemoSpiritDefinition();
    const lookup = createDefinitionLookup([def]);
    const attackerCard = createCardInstance(def, {
      instanceId: "attacker-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const attackId = "attack-group:1:alice:entity-atk";
    // P3-55: start_battle_resolution apply に統合されたため、pre-resolve 状態
    // (window=declare_attack, battleResolutionGroup=null) で構築する。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      step: "attack",
      window: "declare_attack",
      activeAttack: {
        attackId,
        primaryEntityId: "entity-atk",
        participantEntityIds: ["entity-atk"],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        blockAssignments: [
          { participantEntityId: "entity-atk", blockedByEntityIds: [] },
        ],
        symbolResolutionOrder: ["entity-atk"],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      cardInstances: [attackerCard],
      battleEntities: [
        {
          entityId: "entity-atk",
          memberInstanceIds: ["attacker-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red", "blue"], // base red + added blue
          attackState: "attacking",
        },
      ],
      activeContinuousEffects: [
        {
          effectId: "ce-sym-battle",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "battle" },
          createdAtTurn: 1,
          createdAtAttackId: attackId,
          modifierTag: "symbol_addition",
          modifierSymbol: ["blue"],
          targetInstanceId: "attacker-1",
        },
      ],
    };

    // P3-55 Phase B: 防御側 (bob) の decline_block apply でバトル解決まで完了する。
    const result = applyLegalAction({
      state,
      action: {
        kind: "decline_block",
        actionId: "decline-block-test",
        can: true,
        reason: "",
        actingPlayerId: "bob",
        attackId,
      },
      getCardDefinitionById: lookup,
    });

    // After battle end, "this_battle" CE should be removed
    expect(result.state.activeContinuousEffects).toHaveLength(0);
    // resolvedSymbols should revert to base ["red"]
    const entity = result.state.battleEntities.find(
      (e) => e.entityId === "entity-atk"
    );
    expect(entity).toBeDefined();
    expect(entity!.resolvedSymbols).toEqual(["red"]);
  });
});

describe("E-8 symbol_addition: multi-member BattleEntity (host + brave)", () => {
  function createMultiMemberSetup() {
    const hostDef = createDemoCardDefinition({
      cardNo: "HOST-001",
      name: "Host Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const braveDef = createDemoCardDefinition({
      cardNo: "BRAVE-001",
      name: "Attached Brave",
      printedCategory: "brave",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 1000 }],
      symbolColors: ["white"],
    });
    const lookup = createDefinitionLookup([hostDef, braveDef]);
    const hostCard = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const braveCard = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      attachedToInstanceId: "host-1",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [hostCard, braveCard],
      battleEntities: [
        {
          entityId: "entity-combined",
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
      ],
    };
    return { hostDef, braveDef, lookup, state };
  }

  it("recomputeBattleEntityBp preserves multi-member base symbols (host red + brave white)", () => {
    const { lookup, state } = createMultiMemberSetup();
    // No CEs — recompute should keep ["red", "white"]
    const result = recomputeBattleEntityBp(state, lookup);
    expect(result.battleEntities[0].resolvedSymbols).toEqual(["red", "white"]);
  });

  it("symbol_addition on host adds green while preserving brave white", () => {
    const { lookup, state } = createMultiMemberSetup();
    const stateWithCE: GameState = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-sym-green",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["green"],
          targetInstanceId: "host-1",
        },
      ],
    };
    const result = recomputeBattleEntityBp(stateWithCE, lookup);
    // host(red) + host-CE(green) + brave(white) = [red, green, white]
    expect(result.battleEntities[0].resolvedSymbols).toEqual([
      "red",
      "green",
      "white",
    ]);
  });

  it("symbol_addition expires at turn end and brave white remains", () => {
    const { lookup, state } = createMultiMemberSetup();
    const stateWithCE: GameState = {
      ...state,
      activeContinuousEffects: [
        {
          effectId: "ce-sym-green-turn",
          sourceInstanceId: "buff-src",
          sourceDefinitionId: "BUFF-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          modifierSymbol: ["green"],
          targetInstanceId: "host-1",
        },
      ],
      battleEntities: [
        {
          entityId: "entity-combined",
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "green", "white"], // currently buffed
          attackState: "idle",
        },
      ],
    };

    // Advance step until turn wraps (P3-40: drain step_transition pendings)
    let current = advanceStep(stateWithCE, lookup);
    while (current.turnNumber === 1) {
      current = { ...current, pendingTriggeredEffects: [] };
      current = advanceStep(current, lookup);
    }

    // CE removed
    expect(current.activeContinuousEffects).toHaveLength(0);
    // resolvedSymbols reverts to base: host(red) + brave(white)
    expect(current.battleEntities[0].resolvedSymbols).toEqual(["red", "white"]);
  });
});

// ===== E-5: simultaneous effect composition =====

describe("createSimultaneousCompositionResolver", () => {
  it("runs all resolvers atomically and combines their effects", () => {
    const buffDef = createDemoCardDefinition({
      cardNo: "SIM-BUFF-001",
      name: "Simultaneous Buff",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "SIM-TARGET-001",
      name: "Target Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([buffDef, targetDef]);
    const buffCard = createCardInstance(buffDef, {
      instanceId: "buff-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [buffCard, targetCard],
      battleEntities: [
        {
          entityId: "entity-target",
          memberInstanceIds: ["target-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    // Combine two resolvers: bp_modifier +2000 AND symbol_addition green
    const combinedResolver = createSimultaneousCompositionResolver([
      createContinuousEffectOnTargetResolver({
        modifierTag: "bp_modifier",
        duration: { scope: "turn" },
        modifierAmount: 2000,
      }),
      createContinuousEffectOnTargetResolver({
        modifierTag: "symbol_addition",
        duration: { scope: "turn" },
        modifierSymbol: ["green"],
      }),
    ]);

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "buff-1",
      sourceKind: "spirit",
      targetInstanceIds: ["target-1"],
      getCardDefinitionById: lookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "SIM-BUFF-001" ? combinedResolver : undefined,
    });

    // Both CEs registered
    expect(result.state.activeContinuousEffects).toHaveLength(2);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "bp_modifier"
    );
    expect(result.state.activeContinuousEffects[1].modifierTag).toBe(
      "symbol_addition"
    );

    // Both applied to BattleEntity
    expect(result.state.battleEntities[0].resolvedBp).toBe(5000); // 3000 + 2000
    expect(result.state.battleEntities[0].resolvedSymbols).toEqual([
      "red",
      "green",
    ]);
  });

  it("handles single-step composition (degenerate case)", () => {
    const def = createDemoSpiritDefinition();
    const lookup = createDefinitionLookup([def]);
    const card = createCardInstance(def, {
      instanceId: "spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [card],
    };

    // Single resolver wrapped in simultaneous
    const combinedResolver = createSimultaneousCompositionResolver([
      createContinuousEffectOnTargetResolver({
        modifierTag: "bp_modifier",
        duration: { scope: "turn" },
        modifierAmount: 1000,
      }),
    ]);

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "spirit-1",
      sourceKind: "spirit",
      targetInstanceIds: ["spirit-1"],
      getCardDefinitionById: lookup,
      getHandWrittenEffectResolver: (cardNo) =>
        cardNo === "DEMO-SPIRIT-001" ? combinedResolver : undefined,
    });

    expect(result.state.activeContinuousEffects).toHaveLength(1);
  });
});

describe("simultaneousGroupId generation", () => {
  it("assigns shared simultaneousGroupId when multiple pending effects are queued in one batch", () => {
    // Both players lose life → 2 life_reduced events in one delta
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const beforeState: GameState = {
      ...state,
      players: state.players.map((p) => ({
        ...p,
        lifeNormalCoreCount: 3,
      })),
    };
    const afterState: GameState = {
      ...beforeState,
      players: beforeState.players.map((p) => ({
        ...p,
        lifeNormalCoreCount: 1, // both lost 2 cores
      })),
    };

    // P3-39: lookup を渡さずに raw push で 2 件の pending を作る (テスト目的: simultaneousGroupId 付与)。
    const events = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState,
      source: "action_resolution",
      chainId: "test-chain",
      attackId: null,
    });
    const result = queuePendingReactionsRawForTesting(afterState, events);

    // Two life_reduced events → two pending triggered effects
    expect(result.pendingTriggeredEffects.length).toBe(2);

    // They share the same simultaneousGroupId
    expect(result.pendingTriggeredEffects[0].simultaneousGroupId).toBeDefined();
    expect(result.pendingTriggeredEffects[1].simultaneousGroupId).toBeDefined();
    expect(result.pendingTriggeredEffects[0].simultaneousGroupId).toBe(
      result.pendingTriggeredEffects[1].simultaneousGroupId
    );
  });

  it("does not assign simultaneousGroupId when only one pending effect is queued", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const beforeState: GameState = {
      ...state,
      players: state.players.map((p, i) => ({
        ...p,
        lifeNormalCoreCount: i === 0 ? 3 : p.lifeNormalCoreCount,
      })),
    };
    const afterState: GameState = {
      ...beforeState,
      players: beforeState.players.map((p, i) => ({
        ...p,
        lifeNormalCoreCount: i === 0 ? 2 : p.lifeNormalCoreCount, // only alice lost 1
      })),
    };

    // P3-39: lookup を渡さずに raw push で 1 件の pending を作る。
    const events = collectTriggerEventsFromStateDelta({
      beforeState,
      afterState,
      source: "action_resolution",
      chainId: "test-chain",
      attackId: null,
    });
    const result = queuePendingReactionsRawForTesting(afterState, events);

    // Single pending effect — no group
    expect(result.pendingTriggeredEffects.length).toBe(1);
    expect(
      result.pendingTriggeredEffects[0].simultaneousGroupId
    ).toBeUndefined();
  });
});

describe("getSimultaneousGroups", () => {
  it("groups pending triggered effects by simultaneousGroupId", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:1",
          actingPlayerId: "alice",
          eventKind: "destroy",
          source: "action_resolution",
          chainId: "chain-1",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-a",
          amount: 0,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
          simultaneousGroupId: "sim-group:test",
        },
        {
          pendingId: "trigger:2",
          actingPlayerId: "alice",
          eventKind: "destroy",
          source: "action_resolution",
          chainId: "chain-1",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: "spirit-b",
          amount: 0,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
          simultaneousGroupId: "sim-group:test",
        },
        {
          pendingId: "trigger:3",
          actingPlayerId: "bob",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "chain-2",
          attackId: null,
          relatedPlayerId: "bob",
          relatedInstanceId: null,
          amount: 1,
          step: "main",
          window: "none",
          resolvedSourceInstanceIds: [],
          // no simultaneousGroupId
        },
      ],
    };

    const groups = getSimultaneousGroups(state);

    // Grouped: 2 effects under "sim-group:test"
    expect(groups.get("sim-group:test")).toHaveLength(2);
    expect(groups.get("sim-group:test")![0].pendingId).toBe("trigger:1");
    expect(groups.get("sim-group:test")![1].pendingId).toBe("trigger:2");

    // Ungrouped: 1 effect under "ungrouped"
    expect(groups.get("ungrouped")).toHaveLength(1);
    expect(groups.get("ungrouped")![0].pendingId).toBe("trigger:3");
  });

  it("returns empty map when no pending effects exist", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const groups = getSimultaneousGroups(state);
    expect(groups.size).toBe(0);
  });
});

// ===== E-5: simultaneous composition — registration metadata end-to-end =====

describe("simultaneous composition via registration metadata (end-to-end)", () => {
  it("field card effect with composition metadata dispatches composed resolver via buildComposedResolverFromComposition + useFieldCardEffectAsAction", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "SIM-E2E-FIELD-001",
      name: "Simultaneous Field Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "SIM-E2E-TARGET-001",
      name: "Simultaneous Field Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "sim-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "sim-target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
      battleEntities: [
        {
          entityId: "entity-sim-target",
          memberInstanceIds: ["sim-target-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
    };

    // Step-specific resolvers keyed by cardNo:step:index
    const handWrittenLookup = (cardNo: string) => {
      if (cardNo === "SIM-E2E-FIELD-001:step:0") {
        return createContinuousEffectOnTargetResolver({
          modifierTag: "bp_modifier",
          duration: { scope: "turn" },
          modifierAmount: 2000,
        });
      }
      if (cardNo === "SIM-E2E-FIELD-001:step:1") {
        return createContinuousEffectOnTargetResolver({
          modifierTag: "symbol_addition",
          duration: { scope: "turn" },
          modifierSymbol: ["green"],
        });
      }
      return undefined;
    };

    // Build composed resolver from composition metadata
    const composition = {
      kind: "simultaneous" as const,
      steps: [{ label: "bp_boost" }, { label: "add_symbol" }],
    };
    const composedResolver = buildComposedResolverFromComposition(
      handWrittenLookup,
      "SIM-E2E-FIELD-001",
      composition
    );
    expect(composedResolver).toBeDefined();

    // Use field card effect with the composed resolver
    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "sim-source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["sim-target-1"],
      getCardDefinitionById: lookup,
      resolveEffect: composedResolver!,
    });

    // Both CEs registered atomically
    expect(result.state.activeContinuousEffects).toHaveLength(2);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "bp_modifier"
    );
    expect(result.state.activeContinuousEffects[1].modifierTag).toBe(
      "symbol_addition"
    );

    // BattleEntity updated
    expect(result.state.battleEntities[0].resolvedBp).toBe(5000);
    expect(result.state.battleEntities[0].resolvedSymbols).toEqual([
      "red",
      "green",
    ]);
  });

  it("triggered effect with composition metadata dispatches composed resolver", () => {
    const triggerSourceDef = createDemoCardDefinition({
      cardNo: "SIM-E2E-TRIGGER-001",
      name: "Simultaneous Trigger Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([triggerSourceDef]);
    const triggerCard = createCardInstance(triggerSourceDef, {
      instanceId: "sim-trigger-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const baseState: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [triggerCard],
      battleEntities: [
        {
          entityId: "entity-sim-trigger",
          memberInstanceIds: ["sim-trigger-1"],
          resolvedBp: 2000,
          resolvedSymbols: ["red"],
          attackState: "attacking",
        },
      ],
      // Simulate a pending triggered effect from this card
      pendingTriggeredEffects: [
        {
          chainId: "test:index:23105",
          pendingId: "sim-pending-1",
          eventKind: "summon",
          actingPlayerId: "alice",
          sourceInstanceId: "sim-trigger-1",
          sourceDefinitionId: triggerSourceDef.cardNo,
          sourceCardNo: triggerSourceDef.cardNo,
          sourceKind: "spirit",
          registrationIndex: 0,
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    // Registration with composition metadata
    const triggeredRegistrations =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDef.cardNo]: [
          {
            eventKind: "summon",
            sourceKind: "spirit",
            composition: {
              kind: "simultaneous",
              steps: [{ label: "bp_boost" }, { label: "add_symbol" }],
            },
          },
        ],
      });

    // Step-specific resolvers — operate on sourceCard (self-targeting)
    const handWrittenLookup = (cardNo: string) => {
      if (cardNo === "SIM-E2E-TRIGGER-001:step:0") {
        return (state: GameState, context: EffectActionContext): GameState => ({
          ...state,
          activeContinuousEffects: [
            ...state.activeContinuousEffects,
            {
              effectId: "ce-trigger-bp-1",
              sourceInstanceId: context.sourceCard.instanceId,
              sourceDefinitionId: context.sourceDefinition.cardNo,
              actingPlayerId: context.actingPlayerId,
              duration: { scope: "turn" },
              createdAtTurn: state.turnNumber,
              createdAtAttackId: state.activeAttack?.attackId ?? null,
              modifierTag: "bp_modifier",
              modifierAmount: 1500,
              targetInstanceId: context.sourceCard.instanceId,
            },
          ],
          log: [...state.log, "trigger-step-0:bp_modifier"],
        });
      }
      if (cardNo === "SIM-E2E-TRIGGER-001:step:1") {
        return (state: GameState, context: EffectActionContext): GameState => ({
          ...state,
          activeContinuousEffects: [
            ...state.activeContinuousEffects,
            {
              effectId: "ce-trigger-symbol-1",
              sourceInstanceId: context.sourceCard.instanceId,
              sourceDefinitionId: context.sourceDefinition.cardNo,
              actingPlayerId: context.actingPlayerId,
              duration: { scope: "turn" },
              createdAtTurn: state.turnNumber,
              createdAtAttackId: state.activeAttack?.attackId ?? null,
              modifierTag: "symbol_addition",
              modifierSymbol: ["blue"] as const,
              targetInstanceId: context.sourceCard.instanceId,
            },
          ],
          log: [...state.log, "trigger-step-1:symbol_addition"],
        });
      }
      return undefined;
    };

    // Get legal actions for resolve_pending_triggered_effect
    const legalActions = getLegalActions({
      state: baseState,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions: triggeredRegistrations,
    });
    const triggerAction = legalActions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(triggerAction).toBeDefined();

    // Apply (end-to-end) — P3-29 Phase 1 以降は stack window を経由するため pass で閉じる
    const declared = applyLegalAction({
      state: baseState,
      action: triggerAction!,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: triggeredRegistrations,
      getHandWrittenEffectResolver: handWrittenLookup,
    });
    const result = {
      state: fullyResolveMainStepStack({
        state: declared.state,
        getCardDefinitionById: lookup,
        getHandWrittenEffectResolver: handWrittenLookup,
      }),
    };

    // Both CEs registered atomically
    expect(result.state.activeContinuousEffects).toHaveLength(2);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "bp_modifier"
    );
    expect(result.state.activeContinuousEffects[1].modifierTag).toBe(
      "symbol_addition"
    );

    // BattleEntity updated
    expect(result.state.battleEntities[0].resolvedBp).toBe(3500); // 2000 + 1500
    expect(result.state.battleEntities[0].resolvedSymbols).toEqual([
      "red",
      "blue",
    ]);
  });

  it("buildComposedResolverFromComposition returns undefined for non-simultaneous kinds", () => {
    const resolver = buildComposedResolverFromComposition(
      () => undefined,
      "CARD-001",
      { kind: "sequential", steps: [{ label: "a" }, { label: "b" }] }
    );
    expect(resolver).toBeUndefined();
  });

  it("buildComposedResolverFromComposition returns undefined when no step resolvers found", () => {
    const resolver = buildComposedResolverFromComposition(
      () => undefined,
      "CARD-001",
      { kind: "simultaneous", steps: [{ label: "a" }, { label: "b" }] }
    );
    expect(resolver).toBeUndefined();
  });

  it("buildComposedResolverFromComposition returns undefined when step 0 exists but step 1 is missing", () => {
    const step0Resolver: HandWrittenEffectResolver = (state) => state;
    const lookup: HandWrittenEffectResolverLookup = (key) =>
      key === "CARD-001:step:0" ? step0Resolver : undefined;

    const resolver = buildComposedResolverFromComposition(lookup, "CARD-001", {
      kind: "simultaneous",
      steps: [{ label: "a" }, { label: "b" }],
    });
    expect(resolver).toBeUndefined();
  });
});

describe("burst follow-up card with composition metadata (end-to-end)", () => {
  it("burst follow-up play target card applies composition metadata from field effect registration", () => {
    // Burst source spirit definition
    const burstSourceDef = createDemoCardDefinition({
      cardNo: "BURST-COMP-SOURCE-001",
      name: "Burst Composition Source",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
      textLines: ["【バースト：自分のライフ減少後】"],
      keywordTags: ["burst"],
    });

    // Follow-up target spirit with composition
    const followUpDef = createDemoCardDefinition({
      cardNo: "BURST-COMP-FOLLOWUP-001",
      name: "Burst Composition Follow-up Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
      symbolColors: ["red"],
    });

    const definitionLookup = createDefinitionLookup([
      burstSourceDef,
      followUpDef,
    ]);

    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(burstSourceDef, {
          instanceId: "burst-comp-source-1",
          ownerPlayerId: "alice",
          zone: "burst",
        }),
        createCardInstance(followUpDef, {
          instanceId: "burst-comp-followup-1",
          ownerPlayerId: "alice",
          zone: "hand",
        }),
      ],
      setBurstStates: [
        { playerId: "alice", cardInstanceId: "burst-comp-source-1" },
      ],
      pendingBurstChecks: [
        {
          checkId: "burst:comp:test",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "battle_resolution",
          chainId: "test:index:23304",
          attackId: "attack-1",
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack",
          window: "battle_resolution",
          resolvedBurstCardInstanceIds: [],
        },
      ],
    });

    // Burst registration: play target card after resolve
    const getRegisteredBurstActions = createBurstActionRegistrationLookup({
      [burstSourceDef.cardNo]: [
        {
          sourceKind: "spirit",
          eventKind: "reduce_life",
          requiredTargetCount: 1,
          candidateTargetZones: ["hand"],
          candidateTargetPlayerScope: "acting_player",
          playTargetCardWithoutCostAfterResolve: true,
        },
      ],
    });

    // Follow-up card's field effect registration WITH composition
    const getRegisteredFieldCardEffectActions =
      createFieldEffectActionRegistrationLookup({
        [followUpDef.cardNo]: [
          {
            sourceKind: "spirit",
            composition: {
              kind: "simultaneous",
              steps: [{ label: "bp_boost" }, { label: "add_symbol" }],
            },
          },
        ],
      });

    // Step resolvers for the follow-up card — apply CEs to the source card itself
    const getHandWrittenEffectResolver: HandWrittenEffectResolverLookup = (
      cardNo
    ) => {
      if (cardNo === `${followUpDef.cardNo}:step:0`) {
        return (state, context) =>
          resolveContinuousEffectOnTarget(
            state,
            {
              ...context,
              targetInstanceIds: [context.sourceCard.instanceId],
            },
            {
              modifierTag: "bp_modifier",
              duration: { scope: "turn" },
              modifierAmount: 5000,
            }
          );
      }
      if (cardNo === `${followUpDef.cardNo}:step:1`) {
        return (state, context) =>
          resolveContinuousEffectOnTarget(
            state,
            {
              ...context,
              targetInstanceIds: [context.sourceCard.instanceId],
            },
            {
              modifierTag: "symbol_addition",
              duration: { scope: "turn" },
              modifierSymbol: ["green"],
            }
          );
      }
      return undefined;
    };

    const burstAction = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: definitionLookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredBurstActions,
    }).find(
      (a) =>
        a.kind === "resolve_pending_burst_check" &&
        a.sourceInstanceId === "burst-comp-source-1"
    );

    expect(burstAction).toBeDefined();
    expect(burstAction).toEqual(
      expect.objectContaining({
        playsTargetCardWithoutCostAfterResolve: true,
      })
    );

    const resolvedState = resolveStackIfOpen({
      state: applyLegalAction({
        state,
        action: burstAction!,
        followUpPerTargetInputs: [
          {
            targetInstanceId: "burst-comp-followup-1",
            enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
          },
        ],
        getCardDefinitionById: definitionLookup,
        getRegisteredBurstActions,
        getRegisteredFieldCardEffectActions,
        getHandWrittenEffectResolver,
      }).state,
      pendingEffectTargetInstanceIds: ["burst-comp-followup-1"],
      getCardDefinitionById: definitionLookup,
      getRegisteredBurstActions,
      getRegisteredFieldCardEffectActions,
      getHandWrittenEffectResolver,
    });

    // Follow-up card should be on field
    expect(
      resolvedState.cardInstances.find(
        (c) => c.instanceId === "burst-comp-followup-1"
      )
    ).toEqual(expect.objectContaining({ zone: "field" }));

    // Both CEs from composition should be registered on the follow-up card itself
    const followUpCEs = resolvedState.activeContinuousEffects.filter(
      (ce) => ce.sourceInstanceId === "burst-comp-followup-1"
    );
    expect(followUpCEs).toHaveLength(2);
    expect(followUpCEs[0].modifierTag).toBe("bp_modifier");
    expect(followUpCEs[0].targetInstanceId).toBe("burst-comp-followup-1");
    expect(followUpCEs[1].modifierTag).toBe("symbol_addition");
    expect(followUpCEs[1].targetInstanceId).toBe("burst-comp-followup-1");
  });
});

describe("conditional_cost composition (E-6 ことで構文)", () => {
  // Shared helpers for conditional_cost tests
  function makeDummyContext(
    overrides?: Partial<EffectActionContext>
  ): EffectActionContext {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CC-DUMMY-001",
      name: "Conditional Cost Dummy",
      printedCategory: "spirit",
    });
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cc-dummy-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    return {
      chainId: "cc-test-chain",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: "alice",
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition: sourceDef,
      targetInstanceIds: ["cc-dummy-target"],
      getCardDefinitionById: () => undefined,
      ...overrides,
    };
  }

  it("createConditionalCostCompositionResolver executes both steps when both canExecute checks pass", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const costResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "cost:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });
    const canExecuteCost: ConditionalCostCanExecuteCheck = () => true;
    const canExecuteResult: ConditionalCostCanExecuteCheck = () => true;

    const composed = createConditionalCostCompositionResolver(
      costResolver,
      resultResolver,
      canExecuteCost,
      canExecuteResult
    );
    const result = composed(state, ctx);

    expect(result.log).toContain("cost:executed");
    expect(result.log).toContain("result:executed");
  });

  it("createConditionalCostCompositionResolver returns original state when cost canExecute fails", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const costResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "cost:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });
    const canExecuteCost: ConditionalCostCanExecuteCheck = () => false;
    const canExecuteResult: ConditionalCostCanExecuteCheck = () => true;

    const composed = createConditionalCostCompositionResolver(
      costResolver,
      resultResolver,
      canExecuteCost,
      canExecuteResult
    );
    const result = composed(state, ctx);

    // Neither step executed — original state returned
    expect(result.log).not.toContain("cost:executed");
    expect(result.log).not.toContain("result:executed");
    expect(result).toBe(state);
  });

  it("createConditionalCostCompositionResolver returns original state when result canExecute fails (no partial execution)", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const costResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "cost:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });
    const canExecuteCost: ConditionalCostCanExecuteCheck = () => true;
    // Result check runs against post-cost state, but returns false
    const canExecuteResult: ConditionalCostCanExecuteCheck = () => false;

    const composed = createConditionalCostCompositionResolver(
      costResolver,
      resultResolver,
      canExecuteCost,
      canExecuteResult
    );
    const result = composed(state, ctx);

    // Cost was trial-executed internally but rolled back — no partial execution
    expect(result.log).not.toContain("cost:executed");
    expect(result.log).not.toContain("result:executed");
    expect(result).toBe(state);
  });

  it("createConditionalCostCompositionResolver executes both when no canExecute checks are provided", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const costResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "cost:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });

    const composed = createConditionalCostCompositionResolver(
      costResolver,
      resultResolver
    );
    const result = composed(state, ctx);

    expect(result.log).toContain("cost:executed");
    expect(result.log).toContain("result:executed");
  });

  it("buildComposedResolverFromComposition returns composed resolver for conditional_cost kind", () => {
    const costResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "cost:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });
    const lookup: HandWrittenEffectResolverLookup = (key) => {
      if (key === "CARD-CC-001:step:0") return costResolver;
      if (key === "CARD-CC-001:step:1") return resultResolver;
      return undefined;
    };
    const canExecuteLookup: CanExecuteCheckAccessor = (_cardNo, stepIndex) => {
      if (stepIndex === 0) return () => true;
      if (stepIndex === 1) return () => true;
      return undefined;
    };

    const resolver = buildComposedResolverFromComposition(
      lookup,
      "CARD-CC-001",
      {
        kind: "conditional_cost",
        steps: [{ label: "cost" }, { label: "result" }],
      },
      canExecuteLookup
    );
    expect(resolver).toBeDefined();

    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const result = resolver!(state, ctx);
    expect(result.log).toContain("cost:executed");
    expect(result.log).toContain("result:executed");
  });

  it("buildComposedResolverFromComposition returns undefined for conditional_cost with missing step resolver", () => {
    const costResolver: HandWrittenEffectResolver = (s) => s;
    const lookup: HandWrittenEffectResolverLookup = (key) => {
      if (key === "CARD-CC-002:step:0") return costResolver;
      // step:1 is missing
      return undefined;
    };

    const resolver = buildComposedResolverFromComposition(
      lookup,
      "CARD-CC-002",
      {
        kind: "conditional_cost",
        steps: [{ label: "cost" }, { label: "result" }],
      }
    );
    expect(resolver).toBeUndefined();
  });

  it("buildComposedResolverFromComposition returns undefined for conditional_cost with fewer than 2 steps", () => {
    const resolver = buildComposedResolverFromComposition(
      () => undefined,
      "CARD-CC-003",
      { kind: "conditional_cost", steps: [{ label: "only_one" }] }
    );
    expect(resolver).toBeUndefined();
  });

  it("field card effect with conditional_cost composition performs bidirectional check via applyLegalAction (end-to-end)", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CC-E2E-FIELD-001",
      name: "Conditional Cost Field Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "CC-E2E-TARGET-001",
      name: "Conditional Cost Field Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cc-e2e-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "cc-e2e-target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
    };

    // Step 0 (cost): add a log marker
    // Step 1 (result): register a BP modifier CE on target
    const getHandWrittenEffectResolver: HandWrittenEffectResolverLookup = (
      cardNo
    ) => {
      if (cardNo === "CC-E2E-FIELD-001:step:0") {
        return (s, _ctx) => ({
          ...s,
          log: [...s.log, "conditional_cost:cost_paid"],
        });
      }
      if (cardNo === "CC-E2E-FIELD-001:step:1") {
        return createContinuousEffectOnTargetResolver({
          modifierTag: "bp_modifier",
          duration: { scope: "turn" },
          modifierAmount: 3000,
        });
      }
      return undefined;
    };

    // Both steps are executable
    const getConditionalCostCanExecuteCheck: CanExecuteCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) return () => true;
      if (stepIndex === 1) return () => true;
      return undefined;
    };

    const _getRegisteredFieldCardEffectActions =
      createFieldEffectActionRegistrationLookup({
        [sourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            composition: {
              kind: "conditional_cost",
              steps: [{ label: "cost" }, { label: "result" }],
            },
          },
        ],
      });

    // Use field card effect
    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "cc-e2e-source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["cc-e2e-target-1"],
      getCardDefinitionById: lookup,
      resolveEffect: buildComposedResolverFromComposition(
        getHandWrittenEffectResolver,
        sourceDef.cardNo,
        {
          kind: "conditional_cost",
          steps: [{ label: "cost" }, { label: "result" }],
        },
        getConditionalCostCanExecuteCheck
      )!,
    });

    // Both steps executed
    expect(result.state.log).toContain("conditional_cost:cost_paid");
    expect(result.state.activeContinuousEffects).toHaveLength(1);
    expect(result.state.activeContinuousEffects[0].modifierTag).toBe(
      "bp_modifier"
    );
    expect(result.state.activeContinuousEffects[0].modifierAmount).toBe(3000);
  });

  it("field card effect with conditional_cost composition is no-op when result check fails (end-to-end)", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CC-E2E-NOOP-001",
      name: "Conditional Cost Noop Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "CC-E2E-NOOP-TARGET-001",
      name: "Conditional Cost Noop Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cc-noop-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "cc-noop-target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
    };

    const getHandWrittenEffectResolver: HandWrittenEffectResolverLookup = (
      cardNo
    ) => {
      if (cardNo === "CC-E2E-NOOP-001:step:0") {
        return (s) => ({ ...s, log: [...s.log, "cost:should_not_persist"] });
      }
      if (cardNo === "CC-E2E-NOOP-001:step:1") {
        return createContinuousEffectOnTargetResolver({
          modifierTag: "bp_modifier",
          duration: { scope: "turn" },
          modifierAmount: 9999,
        });
      }
      return undefined;
    };

    // Cost is OK, but result check fails
    const getConditionalCostCanExecuteCheck: CanExecuteCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) return () => true;
      if (stepIndex === 1) return () => false;
      return undefined;
    };

    const composed = buildComposedResolverFromComposition(
      getHandWrittenEffectResolver,
      sourceDef.cardNo,
      {
        kind: "conditional_cost",
        steps: [{ label: "cost" }, { label: "result" }],
      },
      getConditionalCostCanExecuteCheck
    );
    expect(composed).toBeDefined();

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "cc-noop-source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["cc-noop-target-1"],
      getCardDefinitionById: lookup,
      resolveEffect: composed!,
    });

    // Neither cost nor result persisted — no partial execution
    expect(result.state.log).not.toContain("cost:should_not_persist");
    expect(result.state.activeContinuousEffects).toHaveLength(0);
  });

  it("getLegalActions excludes field card effect when conditional_cost canExecute check fails (legality filtering)", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CC-LEG-FIELD-001",
      name: "Conditional Cost Legality Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([sourceDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cc-leg-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
    };

    const getRegisteredFieldCardEffectActions =
      createFieldEffectActionRegistrationLookup({
        [sourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            composition: {
              kind: "conditional_cost",
              steps: [{ label: "cost" }, { label: "result" }],
            },
          },
        ],
      });

    // Cost check fails — action should not appear in legal actions
    const getConditionalCostCanExecuteCheck: CanExecuteCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) return () => false;
      if (stepIndex === 1) return () => true;
      return undefined;
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions,
      getConditionalCostCanExecuteCheck,
    });

    const fieldEffectActions = actions.filter(
      (a) => a.kind === "use_field_card_effect"
    );
    expect(fieldEffectActions).toHaveLength(0);
  });

  it("getLegalActions includes field card effect when conditional_cost canExecute checks all pass", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CC-LEG-PASS-001",
      name: "Conditional Cost Legality Pass Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([sourceDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cc-leg-pass-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
    };

    const getRegisteredFieldCardEffectActions =
      createFieldEffectActionRegistrationLookup({
        [sourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            composition: {
              kind: "conditional_cost",
              steps: [{ label: "cost" }, { label: "result" }],
            },
          },
        ],
      });

    // Both checks pass — action should appear
    const getConditionalCostCanExecuteCheck: CanExecuteCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) return () => true;
      if (stepIndex === 1) return () => true;
      return undefined;
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions,
      getConditionalCostCanExecuteCheck,
    });

    const fieldEffectActions = actions.filter(
      (a) => a.kind === "use_field_card_effect"
    );
    expect(fieldEffectActions).toHaveLength(1);
  });

  it("getLegalActions excludes field card effect when result canExecute check fails", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CC-LEG-RES-001",
      name: "Conditional Cost Result Fail Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([sourceDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cc-leg-res-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
    };

    const getRegisteredFieldCardEffectActions =
      createFieldEffectActionRegistrationLookup({
        [sourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            composition: {
              kind: "conditional_cost",
              steps: [{ label: "cost" }, { label: "result" }],
            },
          },
        ],
      });

    // Cost passes, result fails — action should NOT appear
    const getConditionalCostCanExecuteCheck: CanExecuteCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) return () => true;
      if (stepIndex === 1) return () => false;
      return undefined;
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions,
      getConditionalCostCanExecuteCheck,
    });

    const fieldEffectActions = actions.filter(
      (a) => a.kind === "use_field_card_effect"
    );
    expect(fieldEffectActions).toHaveLength(0);
  });

  it("getLegalActions excludes magic action when conditional_cost canExecute check fails (legality filtering)", () => {
    const magicDef = createDemoCardDefinition({
      cardNo: "CC-LEG-MAGIC-001",
      name: "Conditional Cost Magic",
      printedCategory: "magic",
      printedCost: 0,
    });
    const lookup = createDefinitionLookup([magicDef]);
    const magicCard = createCardInstance(magicDef, {
      instanceId: "cc-leg-magic-1",
      ownerPlayerId: "alice",
      zone: "hand",
      cores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [magicCard],
    };

    const getRegisteredMagicActions = createMagicActionRegistrationLookup({
      [magicDef.cardNo]: {
        timing: "main",
        composition: {
          kind: "conditional_cost",
          steps: [{ label: "cost" }, { label: "result" }],
        },
      },
    });

    // Cost check fails — magic should not appear
    const getConditionalCostCanExecuteCheck: CanExecuteCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) return () => false;
      return undefined;
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredMagicActions,
      getConditionalCostCanExecuteCheck,
    });

    const magicActions = actions.filter((a) => a.kind === "use_magic");
    expect(magicActions).toHaveLength(0);
  });
});

describe("conditional_result composition (E-7 そうしたとき構文)", () => {
  function makeDummyContext(
    overrides?: Partial<EffectActionContext>
  ): EffectActionContext {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CR-DUMMY-001",
      name: "Conditional Result Dummy",
      printedCategory: "spirit",
    });
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cr-dummy-source",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    return {
      chainId: "cr-test-chain",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: "alice",
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition: sourceDef,
      targetInstanceIds: [],
      getCardDefinitionById: () => undefined,
      ...overrides,
    };
  }

  it("createConditionalResultCompositionResolver executes both steps when successCheck passes", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const actionResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "action:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });
    const successCheck: ConditionalResultSuccessCheck = (pre, post) =>
      post.log.length > pre.log.length;

    const composed = createConditionalResultCompositionResolver(
      actionResolver,
      resultResolver,
      successCheck
    );
    const result = composed(state, ctx);

    expect(result.log).toContain("action:executed");
    expect(result.log).toContain("result:executed");
  });

  it("createConditionalResultCompositionResolver skips result when successCheck fails (step 0 kept)", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const actionResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "action:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });
    // Success check always fails
    const successCheck: ConditionalResultSuccessCheck = () => false;

    const composed = createConditionalResultCompositionResolver(
      actionResolver,
      resultResolver,
      successCheck
    );
    const result = composed(state, ctx);

    // Step 0 executed and kept (not rolled back)
    expect(result.log).toContain("action:executed");
    // Step 1 not executed
    expect(result.log).not.toContain("result:executed");
    // Result is NOT the original state (unlike conditional_cost)
    expect(result).not.toBe(state);
  });

  it("createConditionalResultCompositionResolver executes both when no successCheck provided", () => {
    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const actionResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "action:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });

    const composed = createConditionalResultCompositionResolver(
      actionResolver,
      resultResolver
    );
    const result = composed(state, ctx);

    expect(result.log).toContain("action:executed");
    expect(result.log).toContain("result:executed");
  });

  it("buildComposedResolverFromComposition returns composed resolver for conditional_result kind", () => {
    const actionResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "action:executed"],
    });
    const resultResolver: HandWrittenEffectResolver = (s) => ({
      ...s,
      log: [...s.log, "result:executed"],
    });
    const getResolver: HandWrittenEffectResolverLookup = (key) => {
      if (key === "CR-001:step:0") return actionResolver;
      if (key === "CR-001:step:1") return resultResolver;
      return undefined;
    };

    const successCheck: ConditionalResultSuccessCheck = (pre, post) =>
      post.log.length > pre.log.length;
    const getSuccessCheck: SuccessCheckAccessor = (_cardNo, stepIndex) => {
      if (stepIndex === 0) return successCheck;
      return undefined;
    };

    const composed = buildComposedResolverFromComposition(
      getResolver,
      "CR-001",
      {
        kind: "conditional_result",
        steps: [{ label: "action" }, { label: "result" }],
      },
      undefined,
      getSuccessCheck
    );

    expect(composed).toBeDefined();

    const state = createEmptyGameState({ playerIds: ["alice", "bob"] });
    const ctx = makeDummyContext();
    const result = composed!(state, ctx);

    expect(result.log).toContain("action:executed");
    expect(result.log).toContain("result:executed");
  });

  it("buildComposedResolverFromComposition returns undefined for conditional_result with missing step resolver", () => {
    const getResolver: HandWrittenEffectResolverLookup = () => undefined;
    const composed = buildComposedResolverFromComposition(
      getResolver,
      "CR-002",
      {
        kind: "conditional_result",
        steps: [{ label: "action" }, { label: "result" }],
      }
    );
    expect(composed).toBeUndefined();
  });

  it("buildComposedResolverFromComposition returns undefined for conditional_result with fewer than 2 steps", () => {
    const composed = buildComposedResolverFromComposition(
      () => undefined,
      "CR-003",
      { kind: "conditional_result", steps: [{ label: "only_one" }] }
    );
    expect(composed).toBeUndefined();
  });

  it("field card effect with conditional_result composition via applyLegalAction (end-to-end)", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CR-E2E-001",
      name: "Conditional Result E2E Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "CR-E2E-TARGET-001",
      name: "Conditional Result E2E Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cr-e2e-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "cr-e2e-target-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
    };

    const getHandWrittenEffectResolver: HandWrittenEffectResolverLookup = (
      cardNo
    ) => {
      if (cardNo === "CR-E2E-001:step:0") {
        return (s) => ({
          ...s,
          log: [...s.log, "conditional_result:action_done"],
        });
      }
      if (cardNo === "CR-E2E-001:step:1") {
        return createContinuousEffectOnTargetResolver({
          modifierTag: "bp_modifier",
          duration: { scope: "turn" },
          modifierAmount: 5000,
        });
      }
      return undefined;
    };

    // Action succeeds (log changed)
    const getConditionalResultSuccessCheck: SuccessCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) {
        return (pre, post) => post.log.length > pre.log.length;
      }
      return undefined;
    };

    const _getRegisteredFieldCardEffectActions =
      createFieldEffectActionRegistrationLookup({
        [sourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            composition: {
              kind: "conditional_result",
              steps: [{ label: "action" }, { label: "result" }],
            },
          },
        ],
      });

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "cr-e2e-source-1",
      sourceKind: "spirit",
      targetInstanceIds: ["cr-e2e-target-1"],
      getCardDefinitionById: lookup,
      resolveEffect: buildComposedResolverFromComposition(
        getHandWrittenEffectResolver,
        sourceDef.cardNo,
        {
          kind: "conditional_result",
          steps: [{ label: "action" }, { label: "result" }],
        },
        undefined,
        getConditionalResultSuccessCheck
      )!,
    });

    expect(result.state.log).toContain("conditional_result:action_done");
    expect(result.state.activeContinuousEffects).toHaveLength(1);
    expect(result.state.activeContinuousEffects[0].modifierAmount).toBe(5000);
  });

  it("field card effect with conditional_result skips result when action fails (end-to-end)", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "CR-E2E-FAIL-001",
      name: "Conditional Result Fail Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([sourceDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "cr-e2e-fail-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
    };

    const getHandWrittenEffectResolver: HandWrittenEffectResolverLookup = (
      cardNo
    ) => {
      // Step 0 tries to do something but state doesn't actually change meaningfully
      if (cardNo === "CR-E2E-FAIL-001:step:0") {
        return (s) => s; // No-op — action "failed"
      }
      if (cardNo === "CR-E2E-FAIL-001:step:1") {
        return (s) => ({
          ...s,
          log: [...s.log, "result:should_not_execute"],
        });
      }
      return undefined;
    };

    // Success check: action must change log length
    const getConditionalResultSuccessCheck: SuccessCheckAccessor = (
      _cardNo,
      stepIndex
    ) => {
      if (stepIndex === 0) {
        return (pre, post) => post.log.length > pre.log.length;
      }
      return undefined;
    };

    const composed = buildComposedResolverFromComposition(
      getHandWrittenEffectResolver,
      sourceDef.cardNo,
      {
        kind: "conditional_result",
        steps: [{ label: "action" }, { label: "result" }],
      },
      undefined,
      getConditionalResultSuccessCheck
    );
    expect(composed).toBeDefined();

    const result = useFieldCardEffectAsAction({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "cr-e2e-fail-1",
      sourceKind: "spirit",
      targetInstanceIds: [],
      getCardDefinitionById: lookup,
      resolveEffect: composed!,
    });

    // Step 0 ran (no-op), step 1 skipped
    expect(result.state.log).not.toContain("result:should_not_execute");
    expect(result.state.activeContinuousEffects).toHaveLength(0);
  });
});

describe("E-1 mandatory/optional execution mode", () => {
  it("getLegalActions includes executionMode in triggered effect legal action (optional)", () => {
    const triggerSourceDef = createDemoCardDefinition({
      cardNo: "E1-OPT-001",
      name: "Optional Trigger Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([triggerSourceDef]);
    const sourceCard = createCardInstance(triggerSourceDef, {
      instanceId: "e1-opt-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:e1-opt:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life" as const,
          event: {
            family: "life" as const,
            validationMode: "snapshot_only" as const,
          },
          source: "action_resolution" as const,
          chainId: "test:index:24426",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main" as const,
          window: null,
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            executionMode: "optional",
            reason: "optional_trigger",
          },
        ],
      });

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });

    const triggerActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(triggerActions).toHaveLength(1);
    expect(triggerActions[0].executionMode).toBe("optional");
  });

  it("getLegalActions includes executionMode 'mandatory' for triggered effect without explicit mode", () => {
    const triggerSourceDef = createDemoCardDefinition({
      cardNo: "E1-MAND-001",
      name: "Mandatory Trigger Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([triggerSourceDef]);
    const sourceCard = createCardInstance(triggerSourceDef, {
      instanceId: "e1-mand-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:e1-mand:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life" as const,
          event: {
            family: "life" as const,
            validationMode: "snapshot_only" as const,
          },
          source: "action_resolution" as const,
          chainId: "test:index:24494",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main" as const,
          window: null,
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            // no executionMode — defaults to "mandatory"
          },
        ],
      });

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });

    const triggerActions = actions.filter(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(triggerActions).toHaveLength(1);
    expect(triggerActions[0].executionMode).toBe("mandatory");
  });

  it("applyLegalAction with skipOptionalEffect skips optional triggered effect", () => {
    const triggerSourceDef = createDemoCardDefinition({
      cardNo: "E1-SKIP-001",
      name: "Skippable Trigger Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([triggerSourceDef]);
    const sourceCard = createCardInstance(triggerSourceDef, {
      instanceId: "e1-skip-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:e1-skip:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life" as const,
          event: {
            family: "life" as const,
            validationMode: "snapshot_only" as const,
          },
          source: "action_resolution" as const,
          chainId: "test:index:24561",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main" as const,
          window: null,
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            executionMode: "optional",
          },
        ],
      });

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });

    const triggerAction = actions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(triggerAction).toBeDefined();

    // Skip the optional effect
    const result = applyLegalAction({
      state,
      action: triggerAction!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
    });

    // Pending effect removed, no resolver executed
    expect(result.state.pendingTriggeredEffects).toHaveLength(0);
    expect(result.state.log).toContain(
      "skip_optional_triggered_effect:trigger:e1-skip:1"
    );
  });

  it("applyLegalAction does not skip mandatory triggered effect even with skipOptionalEffect", () => {
    const triggerSourceDef = createDemoCardDefinition({
      cardNo: "E1-NOSK-001",
      name: "Non-skippable Trigger Source",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([triggerSourceDef]);
    const sourceCard = createCardInstance(triggerSourceDef, {
      instanceId: "e1-nosk-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
      pendingTriggeredEffects: [
        {
          pendingId: "trigger:e1-nosk:1",
          actingPlayerId: "alice",
          eventKind: "reduce_life" as const,
          event: {
            family: "life" as const,
            validationMode: "snapshot_only" as const,
          },
          source: "action_resolution" as const,
          chainId: "test:index:24641",
          attackId: null,
          relatedPlayerId: "alice",
          relatedInstanceId: null,
          amount: 1,
          step: "main" as const,
          window: null,
          resolvedSourceInstanceIds: [],
        },
      ],
    };

    const getRegisteredTriggeredEffectActions =
      createTriggeredEffectActionRegistrationLookup({
        [triggerSourceDef.cardNo]: [
          {
            sourceKind: "spirit",
            eventKind: "reduce_life",
            // mandatory (default)
          },
        ],
      });

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
      getRegisteredTriggeredEffectActions,
    });

    const triggerAction = actions.find(
      (a) => a.kind === "resolve_pending_triggered_effect"
    );
    expect(triggerAction).toBeDefined();
    expect(triggerAction!.executionMode).toBe("mandatory");

    // Try to skip a mandatory effect — should NOT be skipped
    const result = applyLegalAction({
      state,
      action: triggerAction!,
      skipOptionalEffect: true,
      getCardDefinitionById: lookup,
    });

    // Pending effect was resolved normally (not skipped)
    expect(result.state.pendingTriggeredEffects).toHaveLength(0);
    expect(result.state.log).not.toContain(
      "skip_optional_triggered_effect:trigger:e1-nosk:1"
    );
  });
});

describe("E-3 effect conflict priority (forceLevel)", () => {
  it("prohibition-level CE blocks normal-level CE with same modifierTag", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "E3-BLOCK-001",
      name: "ForceLevel Block Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "E3-BLOCK-TARGET-001",
      name: "ForceLevel Block Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "e3-block-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "e3-block-target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
      // Existing prohibition-level CE on target
      activeContinuousEffects: [
        {
          effectId: "ce-prohibition-1",
          sourceInstanceId: "e3-block-target-1",
          sourceDefinitionId: "E3-BLOCK-TARGET-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 0,
          targetInstanceId: "e3-block-target-1",
          forceLevel: "prohibition",
        },
      ],
    };

    // Try to apply a normal-level bp_modifier CE
    const resolver = createContinuousEffectOnTargetResolver({
      modifierTag: "bp_modifier",
      duration: { scope: "turn" },
      modifierAmount: -3000,
    });

    const ctx: EffectActionContext = {
      chainId: "e3-test",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: "alice",
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition: sourceDef,
      targetInstanceIds: ["e3-block-target-1"],
      getCardDefinitionById: lookup,
      forceLevel: "normal",
    };

    const result = resolver(state, ctx);

    // CE was NOT added — blocked by prohibition
    expect(result.activeContinuousEffects).toHaveLength(1);
    expect(result.log).toContain(
      "continuous-effect:blocked:bp_modifier:e3-block-target-1:blocked_by_force:prohibition"
    );
  });

  it("obligation-level CE passes when no higher forceLevel exists", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "E3-PASS-001",
      name: "ForceLevel Pass Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "E3-PASS-TARGET-001",
      name: "ForceLevel Pass Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "e3-pass-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "e3-pass-target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
      // Existing normal-level CE on target
      activeContinuousEffects: [
        {
          effectId: "ce-normal-1",
          sourceInstanceId: "e3-pass-target-1",
          sourceDefinitionId: "E3-PASS-TARGET-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 1000,
          targetInstanceId: "e3-pass-target-1",
        },
      ],
    };

    // Apply an obligation-level bp_modifier CE
    const resolver = createContinuousEffectOnTargetResolver({
      modifierTag: "bp_modifier",
      duration: { scope: "turn" },
      modifierAmount: -3000,
      forceLevel: "obligation",
    });

    const ctx: EffectActionContext = {
      chainId: "e3-test",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: "alice",
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition: sourceDef,
      targetInstanceIds: ["e3-pass-target-1"],
      getCardDefinitionById: lookup,
    };

    const result = resolver(state, ctx);

    // CE was added — obligation beats normal
    expect(result.activeContinuousEffects).toHaveLength(2);
    expect(result.activeContinuousEffects[1].forceLevel).toBe("obligation");
  });

  it("normal-level CE passes when target has no CE with same tag", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "E3-NOTAG-001",
      name: "ForceLevel No Conflict Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "E3-NOTAG-TARGET-001",
      name: "ForceLevel No Conflict Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "e3-notag-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "e3-notag-target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
      // prohibition CE exists but on a DIFFERENT tag
      activeContinuousEffects: [
        {
          effectId: "ce-diff-tag-1",
          sourceInstanceId: "e3-notag-target-1",
          sourceDefinitionId: "E3-NOTAG-TARGET-001",
          actingPlayerId: "bob",
          duration: { scope: "turn" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
          targetInstanceId: "e3-notag-target-1",
          forceLevel: "prohibition",
        },
      ],
    };

    // Apply normal-level bp_modifier — different tag, should not be blocked
    const resolver = createContinuousEffectOnTargetResolver({
      modifierTag: "bp_modifier",
      duration: { scope: "turn" },
      modifierAmount: 2000,
    });

    const ctx: EffectActionContext = {
      chainId: "e3-test",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: "alice",
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition: sourceDef,
      targetInstanceIds: ["e3-notag-target-1"],
      getCardDefinitionById: lookup,
    };

    const result = resolver(state, ctx);

    // CE was added — different tag, no conflict
    expect(result.activeContinuousEffects).toHaveLength(2);
  });

  it("forceLevel is stored on ContinuousEffect when not 'normal'", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "E3-STORE-001",
      name: "ForceLevel Store Source",
      printedCategory: "spirit",
    });
    const targetDef = createDemoCardDefinition({
      cardNo: "E3-STORE-TARGET-001",
      name: "ForceLevel Store Target",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const lookup = createDefinitionLookup([sourceDef, targetDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "e3-store-source-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const targetCard = createCardInstance(targetDef, {
      instanceId: "e3-store-target-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard, targetCard],
    };

    const resolver = createContinuousEffectOnTargetResolver({
      modifierTag: "bp_modifier",
      duration: { scope: "turn" },
      modifierAmount: 0,
      forceLevel: "prohibition",
    });

    const ctx: EffectActionContext = {
      chainId: "e3-test",
      resolutionKind: "field_card_effect_action",
      actingPlayerId: "alice",
      sourceKind: "spirit",
      sourceCard,
      sourceDefinition: sourceDef,
      targetInstanceIds: ["e3-store-target-1"],
      getCardDefinitionById: lookup,
    };

    const result = resolver(state, ctx);

    expect(result.activeContinuousEffects).toHaveLength(1);
    expect(result.activeContinuousEffects[0].forceLevel).toBe("prohibition");
  });
});

describe("illegal burst set detection", () => {
  it("revealBurstCardForResolution detects illegal burst (non-burst card) and sets gameResult", () => {
    // Card without burst keyword
    const nonBurstDef = createDemoCardDefinition({
      cardNo: "IB-NOBURST-001",
      name: "Non-Burst Card",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([nonBurstDef]);
    const nonBurstCard = createCardInstance(nonBurstDef, {
      instanceId: "ib-noburst-1",
      ownerPlayerId: "alice",
      zone: "burst",
      cores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [nonBurstCard],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "ib-noburst-1" }],
    };

    const result = revealBurstCardForResolution({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "ib-noburst-1",
      checkId: "check-ib-1",
      getCardDefinitionById: lookup,
    });

    expect(result.illegalBurstRevealPlayerId).toBe("alice");
    expect(result.gameResult).toEqual({
      kind: "player_loss",
      losingPlayerId: "alice",
      reason: "illegal_burst_set",
    });
    expect(result.log).toContain("illegal_burst_detected:ib-noburst-1:alice");
  });

  it("revealBurstCardForResolution does NOT flag legal burst card", () => {
    const burstDef = createDemoCardDefinition({
      cardNo: "IB-BURST-001",
      name: "Legal Burst Card",
      printedCategory: "spirit",
      textLines: ["【バースト：自分のライフ減少後】"],
    });
    const lookup = createDefinitionLookup([burstDef]);
    const burstCard = createCardInstance(burstDef, {
      instanceId: "ib-burst-1",
      ownerPlayerId: "alice",
      zone: "burst",
      cores: 0,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [burstCard],
      setBurstStates: [{ playerId: "alice", cardInstanceId: "ib-burst-1" }],
    };

    const result = revealBurstCardForResolution({
      state,
      actingPlayerId: "alice",
      sourceInstanceId: "ib-burst-1",
      checkId: "check-ib-2",
      getCardDefinitionById: lookup,
    });

    expect(result.illegalBurstRevealPlayerId).toBeNull();
    expect(result.gameResult).toBeNull();
    expect(result.revealedBurstStates).toHaveLength(1);
  });

  it("canCardDefinitionBeSetAsBurst returns false for non-burst card", () => {
    const def = createDemoCardDefinition({
      cardNo: "IB-CHECK-001",
      name: "Plain Spirit",
      printedCategory: "spirit",
    });
    expect(canCardDefinitionBeSetAsBurst(def)).toBe(false);
  });

  it("canCardDefinitionBeSetAsBurst returns true for card with printed burst header", () => {
    const def = createDemoCardDefinition({
      cardNo: "IB-CHECK-002",
      name: "Burst Spirit",
      printedCategory: "spirit",
      textLines: ["【バースト：自分のライフ減少後】"],
    });
    expect(canCardDefinitionBeSetAsBurst(def)).toBe(true);
  });

  it("canCardDefinitionBeSetAsBurst ignores non-header burst text and legacy burst tags", () => {
    const def = createDemoCardDefinition({
      cardNo: "IB-CHECK-003",
      name: "Anti Burst Magic",
      printedCategory: "magic",
      textLines: [
        "スタック",
        "〔自分のメインステップ〕相手のバースト1つを破棄する。",
      ],
      keywordTags: ["burst"],
    });
    expect(canCardDefinitionBeSetAsBurst(def)).toBe(false);
  });

  it("canCardDefinitionBeSetAsBurst allows explicit set-as-burst override tag", () => {
    const def = createDemoCardDefinition({
      cardNo: "IB-CHECK-004",
      name: "Explicit Settable Card",
      printedCategory: "spirit",
      keywordTags: ["can_set_as_burst"],
    });
    expect(canCardDefinitionBeSetAsBurst(def)).toBe(true);
  });
});

describe("card_left_field trigger separation (離れるとき vs 離れたとき)", () => {
  it("collectAndQueueTriggerReactions generates card_left_field when pending-leave card is flushed to trash", () => {
    const spiritDef = createDemoCardDefinition({
      cardNo: "LF-SEP-001",
      name: "Leave Field Spirit",
      printedCategory: "spirit",
    });
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "lf-sep-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
      pendingLeaveKind: "destroy",
      pendingLeaveCause: "state_based_action",
      pendingLeaveChainId: "chain-1",
    });

    // Before: card is on field, pending leave already set (pre-leave event already fired)
    const beforeState: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [spiritCard],
      pendingLeaveEntities: [
        {
          instanceId: "lf-sep-1",
          kind: "destroy",
          cause: "state_based_action",
          chainId: "chain-1",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    // After: card flushed from field to trash (flushPendingLeaves ran)
    const afterState: GameState = {
      ...beforeState,
      cardInstances: [
        {
          ...spiritCard,
          zone: "trash",
          pendingLeaveKind: null,
          pendingLeaveCause: null,
          pendingLeaveChainId: null,
        },
      ],
      pendingLeaveEntities: [],
    };

    const result = collectAndQueueTriggerReactions({
      chainId: "test:index:25150",
      beforeState,
      afterState,
      source: "state_based_action",
      // P3-39: テストでは listener 解決の挙動は問わない (burst check の検証のみ)。
      getCardDefinitionById: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    // 待機入りで宣言したバーストを物理離脱時に再提示しない (Q480)。
    const burstChecks = result.pendingBurstChecks.filter(
      (b) => b.eventKind === "leave_field"
    );
    expect(burstChecks).toHaveLength(0);
  });

  it("collectAndQueueTriggerReactions does NOT generate card_left_field when card stays on field", () => {
    const spiritDef = createDemoCardDefinition({
      cardNo: "LF-STAY-001",
      name: "Staying Spirit",
      printedCategory: "spirit",
    });
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "lf-stay-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [spiritCard],
    };

    // Same state — card didn't move
    const result = collectAndQueueTriggerReactions({
      chainId: "test:index:25187",
      beforeState: state,
      afterState: state,
      source: "state_based_action",
      getCardDefinitionById: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    expect(result.pendingBurstChecks).toHaveLength(0);
    expect(result.pendingTriggeredEffects).toHaveLength(0);
  });

  it("card_destroyed (pre-leave) and card_left_field (post-leave) are separate events", () => {
    const spiritDef = createDemoCardDefinition({
      cardNo: "LF-DUAL-001",
      name: "Dual Event Spirit",
      printedCategory: "spirit",
    });
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "lf-dual-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
    });

    // Before: card on field, no pending leave
    const beforeState: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [spiritCard],
    };

    // After: card entered pending leave AND moved to trash (both in one delta)
    const afterState: GameState = {
      ...beforeState,
      cardInstances: [
        {
          ...spiritCard,
          zone: "trash",
          pendingLeaveKind: "destroy",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId: "chain-1",
        },
      ],
      pendingLeaveEntities: [
        {
          instanceId: "lf-dual-1",
          kind: "destroy",
          cause: "state_based_action",
          chainId: "chain-1",
          deferZoneMoveUntilChainEnd: false,
        },
      ],
    };

    const result = collectAndQueueTriggerReactions({
      chainId: "test:index:25244",
      beforeState,
      afterState,
      source: "state_based_action",
      getCardDefinitionById: () => undefined,
      getRegisteredTriggeredEffectActions: () => [],
      getRegisteredBurstActions: undefined,
    });

    // card_destroyed (pre-leave) fires, but card_left_field does NOT fire in same delta.
    // card_left_field fires only when flush happens in a separate collectAndQueueTriggerReactions call.
    const burstChecks = result.pendingBurstChecks.filter(
      (b) => b.eventKind === "leave_field"
    );
    expect(burstChecks).toHaveLength(1);
  });
});

describe("simultaneous burst defense-side priority (同時バースト防御側優先)", () => {
  it("defense-side player resolves burst first when both players have pending burst checks", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice", // alice is attacker (turn player)
      step: "attack",
      pendingBurstChecks: [
        // Attacker's burst check comes first in array
        {
          checkId: "bc-attacker-1",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "test:index:25270",
          attackId: null,
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack" as const,
          turnNumber: 2,
          window: null,
          resolvedBurstCardInstanceIds: [],
        },
        // Defender's burst check comes second in array
        {
          checkId: "bc-defender-1",
          actingPlayerId: "bob",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "test:index:25285",
          attackId: null,
          relatedPlayerId: "bob",
          amount: 1,
          step: "attack" as const,
          turnNumber: 2,
          window: null,
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    // Defense-side (bob) should get legal actions, not attacker (alice)
    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });
    const bobActions = getLegalActions({
      state,
      actingPlayerId: "bob",
      getCardDefinitionById: () => undefined,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    const aliceBurstActions = aliceActions.filter(
      (a) => a.kind === "resolve_pending_burst_check"
    );
    const bobBurstActions = bobActions.filter(
      (a) => a.kind === "resolve_pending_burst_check"
    );

    // Bob (defender) gets priority
    expect(bobBurstActions).toHaveLength(1);
    expect(bobBurstActions[0].checkId).toBe("bc-defender-1");

    // Alice (attacker) does NOT get to act yet
    expect(aliceBurstActions).toHaveLength(0);
  });

  it("attacker resolves burst when only attacker has pending burst checks", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "attack",
      pendingBurstChecks: [
        {
          checkId: "bc-attacker-only",
          actingPlayerId: "alice",
          eventKind: "reduce_life",
          source: "action_resolution",
          chainId: "test:index:25339",
          attackId: null,
          relatedPlayerId: "alice",
          amount: 1,
          step: "attack" as const,
          turnNumber: 2,
          window: null,
          resolvedBurstCardInstanceIds: [],
        },
      ],
    };

    const aliceActions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: () => undefined,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    const burstActions = aliceActions.filter(
      (a) => a.kind === "resolve_pending_burst_check"
    );
    // Alice gets to resolve since she's the only one with burst checks
    expect(burstActions).toHaveLength(1);
  });
});

describe("game progression stop after gameResult", () => {
  it("getLegalActions returns empty when gameResult is set", () => {
    const sourceDef = createDemoCardDefinition({
      cardNo: "GR-STOP-001",
      name: "Game Result Stop Spirit",
      printedCategory: "spirit",
    });
    const lookup = createDefinitionLookup([sourceDef]);
    const sourceCard = createCardInstance(sourceDef, {
      instanceId: "gr-stop-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [sourceCard],
      gameResult: {
        kind: "player_loss",
        losingPlayerId: "alice",
        reason: "illegal_burst_set",
      },
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    expect(actions).toHaveLength(0);
  });

  it("applyLegalAction throws when gameResult is set", () => {
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      gameResult: {
        kind: "player_loss",
        losingPlayerId: "alice",
        reason: "illegal_burst_set",
      },
    };

    expect(() =>
      applyLegalAction({
        state,
        action: {
          kind: "end_attack_step",
          actionId: "test",
          can: true,
          reason: "test",
          actingPlayerId: "alice",
        },
        getCardDefinitionById: () => undefined,
      })
    ).toThrow("Cannot apply action after game has ended");
  });
});

describe("ultimate summon condition", () => {
  it("ultimate with summonCondition requiring field spirit is blocked when no spirit on field", () => {
    const ultimateDef = createDemoCardDefinition({
      cardNo: "ULT-COND-001",
      name: "Conditional Ultimate",
      printedCategory: "ultimate",
      cost: 5,
      levelDefs: [{ level: 3, requiredCores: 3, bp: 10000 }],
      summonCondition: (state, actingPlayerId) =>
        state.cardInstances.some(
          (c) =>
            c.controllerPlayerId === actingPlayerId &&
            c.zone === "field" &&
            c.zoneRoleName === "spirit"
        ),
    });
    const lookup = createDefinitionLookup([ultimateDef]);
    const ultimateCard = createCardInstance(ultimateDef, {
      instanceId: "ult-cond-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [ultimateCard],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    // No spirit on field → cannot summon ultimate
    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(0);
  });

  it("ultimate with summonCondition is allowed when condition is met", () => {
    const spiritDef = createDemoCardDefinition({
      cardNo: "ULT-SPIRIT-001",
      name: "Field Spirit",
      printedCategory: "spirit",
      colors: ["red"],
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const ultimateDef = createDemoCardDefinition({
      cardNo: "ULT-COND-002",
      name: "Red Ultimate",
      printedCategory: "ultimate",
      cost: 5,
      levelDefs: [{ level: 3, requiredCores: 3, bp: 10000 }],
      summonCondition: (state, actingPlayerId, getDefById) =>
        state.cardInstances.some((c) => {
          if (c.controllerPlayerId !== actingPlayerId || c.zone !== "field")
            return false;
          const def = getDefById(c.definitionId);
          return (
            def !== undefined &&
            def.colors.includes("red") &&
            def.printedCategory === "spirit"
          );
        }),
    });
    const lookup = createDefinitionLookup([spiritDef, ultimateDef]);
    const spiritCard = createCardInstance(spiritDef, {
      instanceId: "ult-spirit-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const ultimateCard = createCardInstance(ultimateDef, {
      instanceId: "ult-cond-2",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 8 }],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [spiritCard, ultimateCard],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    // Red spirit on field → can summon ultimate
    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(1);
    expect(summonActions[0].sourceCardNo).toBe("ULT-COND-002");
  });

  it("ultimate without summonCondition can be summoned freely", () => {
    const ultimateDef = createDemoCardDefinition({
      cardNo: "ULT-FREE-001",
      name: "Free Ultimate",
      printedCategory: "ultimate",
      cost: 3,
      levelDefs: [{ level: 3, requiredCores: 3, bp: 8000 }],
    });
    const lookup = createDefinitionLookup([ultimateDef]);
    const ultimateCard = createCardInstance(ultimateDef, {
      instanceId: "ult-free-1",
      ownerPlayerId: "alice",
      zone: "hand",
    });
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: [{ reserveNormalCoreCount: 6 }],
      }),
      activePlayerId: "alice",
      step: "main",
      cardInstances: [ultimateCard],
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    // No condition → can summon
    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(1);
  });
});

describe("field card cost payment", () => {
  const spiritDef = createDemoCardDefinition({
    cardNo: "PAY-SPIRIT-001",
    name: "Pay Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 3,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 2000 }],
    symbolColors: ["red"],
  });

  const costySpiritDef = createDemoCardDefinition({
    cardNo: "PAY-SPIRIT-002",
    name: "Costy Spirit",
    printedCategory: "spirit",
    colors: ["red"],
    cost: 4,
    reductionSymbols: [],
    levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
    symbolColors: ["red"],
  });

  const lookup = createDefinitionLookup([spiritDef, costySpiritDef]);

  it("applyCardCostPayments moves cores from field card to trash", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDef, {
          instanceId: "field-spirit",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5 }],
    });

    const result = applyCardCostPayments({
      state,
      actingPlayerId: "alice",
      chainId: "test-chain-1",
      paymentSources: [
        { kind: "card", instanceId: "field-spirit", amount: 2 },
        { kind: "reserve", amount: 1 },
      ],
    });

    const fieldCard = result.cardInstances.find(
      (c) => c.instanceId === "field-spirit"
    );
    expect(fieldCard?.normalCoreCount).toBe(1);
    const alice = result.players.find((p) => p.id === "alice")!;
    expect(alice.reserveNormalCoreCount).toBe(4);
    expect(alice.trashNormalCoreCount).toBe(3);
  });

  it("applyCardCostPayments marks card for vanish when all cores are removed", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDef, {
          instanceId: "field-spirit",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 2,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 5 }],
    });

    const result = applyCardCostPayments({
      state,
      actingPlayerId: "alice",
      chainId: "test-chain-2",
      paymentSources: [
        { kind: "card", instanceId: "field-spirit", amount: 2 },
        { kind: "reserve", amount: 1 },
      ],
    });

    const fieldCard = result.cardInstances.find(
      (c) => c.instanceId === "field-spirit"
    );
    expect(fieldCard?.pendingLeaveKind).toBe("vanish");
    expect(fieldCard?.pendingLeaveCause).toBe("cost_payment");
    expect(fieldCard?.deferZoneMoveUntilChainEnd).toBe(true);
    expect(result.pendingLeaveEntities).toHaveLength(1);
    expect(result.pendingLeaveEntities[0].cause).toBe("cost_payment");
  });

  it("getAvailableCardCostPaymentSources includes field cards with cores", () => {
    const state = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDef, {
          instanceId: "field-spirit",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });

    const sources = getAvailableCardCostPaymentSources({
      state,
      actingPlayerId: "alice",
      card: costySpiritDef,
      getCardDefinitionById: lookup,
    });

    expect(sources.onBoardCoreSources).toHaveLength(1);
    expect(sources.onBoardCoreSources[0].instanceId).toBe("field-spirit");
    expect(sources.onBoardCoreSources[0].availableCoreAmount).toBe(3);
    expect(sources.totalAvailableCoreAmount).toBe(5); // 2 reserve + 3 field
    expect(sources.canFullyPay).toBe(true);
  });

  it("includes remaining waiting cores as payment sources regardless of the waiting cause", () => {
    // 03f: cost_payment 由来も実移動前の残存コアは利用可能。移動済みコアの再使用ではない。
    const sbaPending = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDef, {
          instanceId: "vanishing-spirit",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "state_based_action",
          pendingLeaveChainId: "sba-chain",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });
    const sbaSources = getAvailableCardCostPaymentSources({
      state: sbaPending,
      actingPlayerId: "alice",
      card: costySpiritDef,
      getCardDefinitionById: lookup,
    });
    expect(sbaSources.onBoardCoreSources).toHaveLength(1);
    expect(sbaSources.onBoardCoreSources[0].instanceId).toBe(
      "vanishing-spirit"
    );
    expect(sbaSources.totalAvailableCoreAmount).toBe(5);
    expect(sbaSources.canFullyPay).toBe(true);

    const costPaymentPending = createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(spiritDef, {
          instanceId: "paying-spirit",
          ownerPlayerId: "alice",
          zone: "field",
          cores: 3,
          pendingLeaveKind: "vanish",
          pendingLeaveCause: "cost_payment",
          pendingLeaveChainId: "pay-chain",
        }),
      ],
      playerOverrides: [{ reserveNormalCoreCount: 2 }],
    });
    const costPaymentSources = getAvailableCardCostPaymentSources({
      state: costPaymentPending,
      actingPlayerId: "alice",
      card: costySpiritDef,
      getCardDefinitionById: lookup,
    });
    expect(costPaymentSources.onBoardCoreSources).toHaveLength(1);
    expect(costPaymentSources.onBoardCoreSources[0].instanceId).toBe(
      "paying-spirit"
    );
    expect(costPaymentSources.totalAvailableCoreAmount).toBe(5);
    expect(costPaymentSources.canFullyPay).toBe(true);
  });

  it("getLegalActions excludes summon when reserve cannot cover placement after field payment", () => {
    // Reserve: 3, Field spirit: 1 core, Cost: 4, Min placement: 1
    // Total available = 4 = finalCost, BUT reserve - minPlacement = 2, field = 1 → max payable = 3 < 4
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(costySpiritDef, {
            instanceId: "hand-card",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(spiritDef, {
            instanceId: "field-spirit",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 1,
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 3 }],
      }),
      step: "main" as const,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(0);
  });

  it("getLegalActions allows summon when field payment makes cost + placement feasible", () => {
    // Reserve: 3, Field spirit: 3 cores, Cost: 4, Min placement: 1
    // reserve - minPlacement = 2, field = 3 → max payable = 5 >= 4 ✓
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(costySpiritDef, {
            instanceId: "hand-card",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(spiritDef, {
            instanceId: "field-spirit",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 3,
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 3 }],
      }),
      step: "main" as const,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(1);
  });

  it("playSummonAsAction works with mixed reserve + field payment", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDef, {
            instanceId: "hand-spirit",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(spiritDef, {
            instanceId: "field-spirit",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 2,
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 3 }],
      }),
      step: "main" as const,
    };

    const result = playSummonAsAction({
      state,
      actingPlayerId: "alice",
      cardInstanceId: "hand-spirit",
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
      paymentSources: [
        { kind: "reserve", amount: 1 },
        { kind: "card", instanceId: "field-spirit", amount: 2 },
      ],
      enterFieldCorePlacements: [{ kind: "reserve_normal", amount: 1 }],
    });

    const summoned = result.state.cardInstances.find(
      (c) => c.instanceId === "hand-spirit"
    );
    expect(summoned?.zone).toBe("field");
    expect(summoned?.normalCoreCount).toBe(1);

    const fieldSpirit = result.state.cardInstances.find(
      (c) => c.instanceId === "field-spirit"
    );
    // minimumRequiredCores is 1, cores paid = 2 → 0 cores → vanish → flushed to trash
    expect(fieldSpirit?.zone).toBe("trash");
    expect(fieldSpirit?.pendingLeaveKind).toBeNull();

    const alice = result.state.players.find((p) => p.id === "alice")!;
    // reserve started 3, paid 1, placed 1 → 1 remaining
    expect(alice.reserveNormalCoreCount).toBe(1);
  });

  it("allows summon when reserve is 0 but field cores cover cost + placement", () => {
    // Reserve: 0, Field spirit: 5 cores, Cost: 3 (Pay Spirit), reduction: 0 → finalCost: 3, Min placement: 1
    // 配置はリザーブ／フィールドどちらからも出せる (03a:58)。
    // reserve(0) + field(5) = 5 >= cost(3) + minPlacement(1) = 4 ✓
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDef, {
            instanceId: "hand-card",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(spiritDef, {
            instanceId: "field-spirit",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 5,
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 0 }],
      }),
      step: "main" as const,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(1);
  });

  it("does not count opponent-controlled field cores toward payment", () => {
    // Reserve: 0, Alice's field: 0, Bob's field: 5 cores, Cost: 3, Min placement: 1
    // 相手フィールドのコアは支払いソースに含まれない (controllerPlayerId フィルタ)。
    // alice 単独では reserve(0) + field(0) = 0 < cost(3) + minPlacement(1) ✗
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDef, {
            instanceId: "hand-card",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(spiritDef, {
            instanceId: "bob-field-spirit",
            ownerPlayerId: "bob",
            zone: "field",
            cores: 5,
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 0 }],
      }),
      step: "main" as const,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(0);
  });

  it("excludes summon when reserve+field cannot cover cost + placement", () => {
    // Reserve: 0, Field spirit: 3 cores, Cost: 3, Min placement: 1
    // reserve(0) + field(3) = 3 < cost(3) + minPlacement(1) = 4 ✗
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(spiritDef, {
            instanceId: "hand-card",
            ownerPlayerId: "alice",
            zone: "hand",
          }),
          createCardInstance(spiritDef, {
            instanceId: "field-spirit",
            ownerPlayerId: "alice",
            zone: "field",
            cores: 3,
          }),
        ],
        playerOverrides: [{ reserveNormalCoreCount: 0 }],
      }),
      step: "main" as const,
    };

    const actions = getLegalActions({
      state,
      actingPlayerId: "alice",
      getCardDefinitionById: lookup,
      getRegisteredFieldCardEffectActions:
        createFieldEffectActionRegistrationLookup({}),
    });

    const summonActions = actions.filter((a) => a.kind === "summon");
    expect(summonActions).toHaveLength(0);
  });
});

describe("start_step triggered effect window", () => {
  it("queues a start_step pending triggered effect when advancing to start step", () => {
    // Start at end step, then advance to start step (which wraps the turn)
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "end" as const,
      turnNumber: 1,
      activePlayerId: "alice",
    };

    const afterStart = advanceStep(state);

    expect(afterStart.step).toBe("start");
    expect(afterStart.activePlayerId).toBe("bob");
    expect(afterStart.turnNumber).toBe(2);

    // Should have queued a start_step pending triggered effect
    const startStepTriggers = afterStart.pendingTriggeredEffects.filter(
      (pe) => pe.eventKind === "start_step"
    );
    expect(startStepTriggers).toHaveLength(1);
    expect(startStepTriggers[0]!.actingPlayerId).toBe("bob");
    expect(startStepTriggers[0]!.source).toBe("step_transition");
  });

  it("does not queue start_step trigger when deck is empty (game over)", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        startingDeckCount: 0,
      }),
      step: "end" as const,
      turnNumber: 1,
      activePlayerId: "alice",
    };

    const afterStart = advanceStep(state);

    expect(afterStart.step).toBe("start");
    expect(afterStart.gameResult).toBeTruthy();
    expect(afterStart.gameResult?.kind).toBe("player_loss");

    // Should NOT queue start_step trigger when game is over
    const startStepTriggers = afterStart.pendingTriggeredEffects.filter(
      (pe) => pe.eventKind === "start_step"
    );
    expect(startStepTriggers).toHaveLength(0);
  });

  it("queues start_step trigger with step field for non-start steps", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "start" as const,
      turnNumber: 1,
      activePlayerId: "alice",
    };

    // T1先攻: start → draw (core skipped)
    const afterDraw = advanceStep(state);
    expect(afterDraw.step).toBe("draw");

    const startStepTriggers = afterDraw.pendingTriggeredEffects.filter(
      (pe) => pe.eventKind === "start_step" && pe.event?.subPhase === "start"
    );
    // 全ステップ共通パターン: draw ステップ開始時も start_step イベントが発火する
    expect(startStepTriggers).toHaveLength(1);
    expect(startStepTriggers[0]!.event?.step).toBe("draw");
  });

  it("queues step_end trigger with subPhase 'end' before step transition", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "main" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    const afterAttack = advanceStep(state);
    expect(afterAttack.step).toBe("attack");

    // step-end for main step should be queued
    const stepEndTriggers = afterAttack.pendingTriggeredEffects.filter(
      (pe) => pe.eventKind === "start_step" && pe.event?.subPhase === "end"
    );
    expect(stepEndTriggers).toHaveLength(1);
    expect(stepEndTriggers[0]!.event?.step).toBe("main");

    // step-start for attack step should also be queued
    const stepStartTriggers = afterAttack.pendingTriggeredEffects.filter(
      (pe) => pe.eventKind === "start_step" && pe.event?.subPhase === "start"
    );
    expect(stepStartTriggers).toHaveLength(1);
    expect(stepStartTriggers[0]!.event?.step).toBe("attack");
  });

  it("start_step trigger has correct event metadata", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "end" as const,
      turnNumber: 1,
      activePlayerId: "alice",
    };

    const afterStart = advanceStep(state);

    const trigger = afterStart.pendingTriggeredEffects.find(
      (pe) => pe.eventKind === "start_step"
    );
    expect(trigger).toBeDefined();
    expect(trigger!.event).toEqual({
      family: "step_timing",
      step: "start",
      subPhase: "start",
      validationMode: "snapshot_only",
    });
    expect(trigger!.relatedPlayerId).toBe("bob");
    expect(trigger!.chainId).toMatch(/^event-root-/);
    expect(trigger!.attackId).toBeNull();
  });

  it("queues start_step trigger on initial game state advance to start step from turn 1", () => {
    // The initial game state starts at step "start", turn 1.
    // Advance through a full cycle back to start.
    let state = createEmptyGameState({
      playerIds: ["alice", "bob"],
    });

    // Advance through all steps to end (end_step_effects)
    // P3-40: drain step_transition pendings before each advanceStep
    while (state.step !== "end") {
      state = { ...state, pendingTriggeredEffects: [] };
      state = advanceStep(state);
    }

    // Advance through end step phases: effects → end effects → cleanup → start
    state = { ...state, pendingTriggeredEffects: [] }; // clear end_step trigger
    state = advanceStep(state); // → end_step_end_effects
    state = { ...state, pendingTriggeredEffects: [] }; // clear end-step-end trigger
    state = advanceStep(state); // → end_step_cleanup
    state = { ...state, pendingTriggeredEffects: [] };
    const afterStart = advanceStep(state); // → start (turn 2, bob's turn)
    expect(afterStart.step).toBe("start");
    expect(afterStart.turnNumber).toBe(2);

    const startStepTriggers = afterStart.pendingTriggeredEffects.filter(
      (pe) => pe.eventKind === "start_step"
    );
    expect(startStepTriggers).toHaveLength(1);
    expect(startStepTriggers[0]!.actingPlayerId).toBe("bob");
  });
});

describe("end_step 2-phase effect window", () => {
  it("entering end step sets window to end_step_effects and queues end_step trigger", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    const afterEnd = advanceStep(state);

    expect(afterEnd.step).toBe("end");
    expect(afterEnd.window).toBe("end_step_effects");
    expect(afterEnd.activePlayerId).toBe("alice");
    expect(afterEnd.turnNumber).toBe(2);

    const endStepTriggers = afterEnd.pendingTriggeredEffects.filter(
      (pe) => pe.eventKind === "end_step"
    );
    expect(endStepTriggers).toHaveLength(1);
    expect(endStepTriggers[0]!.actingPlayerId).toBe("alice");
    expect(endStepTriggers[0]!.source).toBe("step_transition");
  });

  it("advancing from end_step_effects queues end-step-end effects before cleanup removes this_turn continuous effects", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "end" as const,
      window: "end_step_effects" as const,
      turnNumber: 2,
      activePlayerId: "alice",
      activeContinuousEffects: [
        {
          effectId: "ce-this-turn-1",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 2,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 1000,
        },
        {
          effectId: "ce-permanent-1",
          sourceInstanceId: "src-2",
          sourceDefinitionId: "SRC-002",
          actingPlayerId: "alice",
          duration: { scope: "permanent" },
          createdAtTurn: 1,
          createdAtAttackId: null,
          modifierTag: "symbol_addition",
        },
      ],
      pendingTriggeredEffects: [],
    };

    const afterEndEffects = advanceStep(state);

    expect(afterEndEffects.step).toBe("end");
    expect(afterEndEffects.window).toBe("end_step_end_effects");
    expect(afterEndEffects.turnNumber).toBe(2);
    expect(afterEndEffects.activeContinuousEffects).toHaveLength(2);

    const afterCleanup = advanceStep({
      ...afterEndEffects,
      pendingTriggeredEffects: [],
    });

    expect(afterCleanup.step).toBe("end");
    expect(afterCleanup.window).toBe("end_step_cleanup");
    // this_turn effect should be removed
    expect(afterCleanup.activeContinuousEffects).toHaveLength(1);
    expect(afterCleanup.activeContinuousEffects[0]!.effectId).toBe(
      "ce-permanent-1"
    );
  });

  it("advancing from end_step_cleanup wraps to next turn start step", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "end" as const,
      window: "end_step_cleanup" as const,
      turnNumber: 2,
      activePlayerId: "alice",
      pendingTriggeredEffects: [],
    };

    const afterStart = advanceStep(state);

    expect(afterStart.step).toBe("start");
    expect(afterStart.window).toBe("none");
    expect(afterStart.turnNumber).toBe(3);
    expect(afterStart.activePlayerId).toBe("bob");
  });

  it("full end step cycle: attack → end_step_effects → end_step_cleanup → start", () => {
    let state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "attack" as const,
      turnNumber: 2,
      activePlayerId: "alice",
      activeContinuousEffects: [
        {
          effectId: "ce-turn-1",
          sourceInstanceId: "src-1",
          sourceDefinitionId: "SRC-001",
          actingPlayerId: "alice",
          duration: { scope: "turn" },
          createdAtTurn: 2,
          createdAtAttackId: null,
          modifierTag: "bp_modifier",
          modifierAmount: 500,
        },
      ],
    };

    // Phase 1: enter end step (end_step_effects)
    state = advanceStep(state);
    expect(state.step).toBe("end");
    expect(state.window).toBe("end_step_effects");
    expect(state.activeContinuousEffects).toHaveLength(1); // not yet cleaned

    // Phase 2: end-step-end effects stay in End Step before cleanup
    state = { ...state, pendingTriggeredEffects: [] }; // clear end_step trigger
    state = advanceStep(state);
    expect(state.step).toBe("end");
    expect(state.window).toBe("end_step_end_effects");
    expect(state.activeContinuousEffects).toHaveLength(1); // not yet cleaned
    expect(
      state.pendingTriggeredEffects.some(
        (pe) =>
          pe.eventKind === "end_step" &&
          pe.event.family === "step_timing" &&
          pe.event.step === "end" &&
          pe.event.subPhase === "end"
      )
    ).toBe(true);

    // Phase 3: cleanup (end_step_cleanup)
    state = { ...state, pendingTriggeredEffects: [] }; // clear end-step-end trigger
    state = advanceStep(state);
    expect(state.step).toBe("end");
    expect(state.window).toBe("end_step_cleanup");
    expect(state.activeContinuousEffects).toHaveLength(0); // this_turn removed

    // Phase 4: advance to start
    state = advanceStep(state);
    expect(state.step).toBe("start");
    expect(state.turnNumber).toBe(3);
    expect(state.activePlayerId).toBe("bob");
  });

  it("end_step trigger has correct event metadata", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "attack" as const,
      turnNumber: 3,
      activePlayerId: "bob",
    };

    const afterEnd = advanceStep(state);

    const trigger = afterEnd.pendingTriggeredEffects.find(
      (pe) => pe.eventKind === "end_step"
    );
    expect(trigger).toBeDefined();
    expect(trigger!.event).toEqual({
      family: "step_timing",
      step: "end",
      subPhase: "start",
      validationMode: "snapshot_only",
    });
    expect(trigger!.actingPlayerId).toBe("bob");
    expect(trigger!.relatedPlayerId).toBe("bob");
    expect(trigger!.chainId).toMatch(/^event-root-/);
  });

  it("legacy: step=end with window=none advances directly to start", () => {
    const state = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
      }),
      step: "end" as const,
      window: "none" as const,
      turnNumber: 2,
      activePlayerId: "alice",
    };

    const afterStart = advanceStep(state);

    expect(afterStart.step).toBe("start");
    expect(afterStart.turnNumber).toBe(3);
    expect(afterStart.activePlayerId).toBe("bob");
  });
});

describe("brave attack continuation after host destruction", () => {
  function createCombinedAttackSetup() {
    const hostDef = createDemoCardDefinition({
      cardNo: "HOST-ATK-001",
      name: "Attacking Host",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 3000 }],
      symbolColors: ["red"],
    });
    const braveDef = createDemoCardDefinition({
      cardNo: "BRAVE-ATK-001",
      name: "Attached Brave",
      printedCategory: "brave",
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: ["white"],
    });
    const blockerDef = createDemoCardDefinition({
      cardNo: "BLOCKER-001",
      name: "Blocker Spirit",
      printedCategory: "spirit",
      levelDefs: [{ level: 1, requiredCores: 1, bp: 5000 }],
      symbolColors: ["blue"],
    });
    const lookup = createDefinitionLookup([hostDef, braveDef, blockerDef]);

    const hostCard = createCardInstance(hostDef, {
      instanceId: "host-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 1,
    });
    const braveCard = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
      }),
      attachedToInstanceId: "host-1",
    };
    const hostWithBrave = {
      ...hostCard,
      attachedChildrenIds: ["brave-1"],
    };
    const blockerCard = createCardInstance(blockerDef, {
      instanceId: "blocker-1",
      ownerPlayerId: "bob",
      zone: "field",
      cores: 1,
    });

    return {
      hostDef,
      braveDef,
      blockerDef,
      lookup,
      hostWithBrave,
      braveCard,
      blockerCard,
    };
  }

  it("combined spirit battle entity includes both host and brave in memberInstanceIds", () => {
    const {
      lookup: _lookup,
      hostWithBrave,
      braveCard,
      blockerCard,
    } = createCombinedAttackSetup();

    // Create a state where the combined spirit is attacking
    // with a BattleEntity that includes both host and brave
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [hostWithBrave, braveCard, blockerCard],
      step: "attack" as const,
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId: "entity-combined",
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
      ],
    };

    // Verify the battle entity has both members
    const entity = state.battleEntities[0]!;
    expect(entity.memberInstanceIds).toContain("host-1");
    expect(entity.memberInstanceIds).toContain("brave-1");
    expect(entity.memberInstanceIds).toHaveLength(2);
  });

  it("brave remains on field after host is destroyed in battle", () => {
    const { lookup, hostWithBrave, braveCard, blockerCard } =
      createCombinedAttackSetup();

    // Set up a state where battle resolution is about to happen.
    // Host (BP 3000) loses to blocker (BP 5000).
    const attackEntityId = "entity-combined";
    const blockerEntityId = "entity-blocker";
    const attackId = "atk-1";

    // P3-55: start_battle_resolution apply に統合されたため、pre-resolve 状態
    // (window=declare_block, battleResolutionGroup=null) で構築する。
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [hostWithBrave, braveCard, blockerCard],
      step: "attack" as const,
      window: "declare_block" as const,
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId: attackEntityId,
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
        {
          entityId: blockerEntityId,
          memberInstanceIds: ["blocker-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["blue"],
          attackState: "blocking",
        },
      ],
      activeAttack: {
        attackId,
        primaryEntityId: attackEntityId,
        participantEntityIds: [attackEntityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        designatedTargetInstanceId: undefined,
        blockAssignments: [
          {
            participantEntityId: attackEntityId,
            blockedByEntityIds: [blockerEntityId],
          },
        ],
        symbolResolutionOrder: [attackEntityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
    };

    // P3-55 Phase B: 既にブロック宣言済 + flashAfterBlockCompleted=true の状態は
    // 通常 pass_battle_flash apply の auto-chain で消費される。テストでは構築済みの中間
    // 状態から直接バトル解決を呼ぶため executeBattleResolution helper を使用する。
    const result = executeBattleResolution({
      state,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });

    // P2-09: ブレイヴ選択待ちが発生する
    expect(result.state.pendingBraveLeaveChoice).not.toBeNull();
    expect(result.state.pendingBraveLeaveChoice!.hostInstanceId).toBe("host-1");
    expect(result.state.pendingBraveLeaveChoice!.braveInstanceIds).toEqual([
      "brave-1",
    ]);

    // ホストはまだフラッシュされていない（選択待ち中）
    const hostBeforeChoice = result.state.cardInstances.find(
      (c) => c.instanceId === "host-1"
    );
    expect(hostBeforeChoice?.zone).toBe("field");

    // 「フィールドに残す」を選択
    const afterKeep = resolveBraveLeaveChoice(result.state, "keep");
    expect(afterKeep.pendingBraveLeaveChoice).toBeNull();

    // ホストのフラッシュを実行
    const afterFlush = flushPendingLeaves(afterKeep, lookup);

    // Host should be destroyed (moved to trash)
    const host = afterFlush.cardInstances.find(
      (c) => c.instanceId === "host-1"
    );
    expect(host?.zone).toBe("trash");

    // Brave should remain on field (detached from host)
    const brave = afterFlush.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );
    expect(brave?.zone).toBe("field");
    expect(brave?.attachedToInstanceId).toBeNull();

    // Blocker should survive (it won)
    const blocker = afterFlush.cardInstances.find(
      (c) => c.instanceId === "blocker-1"
    );
    expect(blocker?.zone).toBe("field");
  });

  it("brave moves to trash with host when send_with_host is chosen (P2-09)", () => {
    const { lookup, hostWithBrave, braveCard, blockerCard } =
      createCombinedAttackSetup();

    const attackEntityId = "entity-combined";
    const blockerEntityId = "entity-blocker";
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [hostWithBrave, braveCard, blockerCard],
      step: "attack" as const,
      window: "declare_block" as const,
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId: attackEntityId,
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
        {
          entityId: blockerEntityId,
          memberInstanceIds: ["blocker-1"],
          resolvedBp: 5000,
          resolvedSymbols: ["blue"],
          attackState: "blocking",
        },
      ],
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: attackEntityId,
        participantEntityIds: [attackEntityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        designatedTargetInstanceId: undefined,
        blockAssignments: [
          {
            participantEntityId: attackEntityId,
            blockedByEntityIds: [blockerEntityId],
          },
        ],
        symbolResolutionOrder: [attackEntityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
    };

    const result = executeBattleResolution({
      state,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions: () => [],
    });
    expect(result.state.pendingBraveLeaveChoice).not.toBeNull();

    // 「一緒に移動」を選択
    const afterSend = resolveBraveLeaveChoice(result.state, "send_with_host");
    expect(afterSend.pendingBraveLeaveChoice).toBeNull();
    // ブレイヴは合体解除され、ホストと同じく離脱予約される
    const braveQueued = afterSend.pendingLeaveEntities.find(
      (pl) => pl.instanceId === "brave-1"
    );
    expect(braveQueued).toBeDefined();
    const braveMid = afterSend.cardInstances.find(
      (c) => c.instanceId === "brave-1"
    );
    expect(braveMid?.attachedToInstanceId).toBeNull();
    expect(braveMid?.pendingLeaveKind).not.toBeNull();

    // フラッシュ実行: ホストもブレイヴもトラッシュへ
    const afterFlush = flushPendingLeaves(afterSend, lookup);
    expect(
      afterFlush.cardInstances.find((c) => c.instanceId === "host-1")?.zone
    ).toBe("trash");
    expect(
      afterFlush.cardInstances.find((c) => c.instanceId === "brave-1")?.zone
    ).toBe("trash");
  });

  it("automatically continues attack when host leaves with surviving brave", () => {
    const { hostDef, braveDef, lookup } = createCombinedAttackSetup();

    // ホストは合体解除済み (P2-09 経由後) で離脱予約中、ブレイヴは場に残存
    const host = {
      ...createCardInstance(hostDef, {
        instanceId: "host-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
        zoneRoleName: "spirit",
      }),
      attachedChildrenIds: [] as string[],
      pendingLeaveKind: "destroy" as const,
      pendingLeaveCause: "effect_resolution" as const,
      pendingLeaveChainId: "chain-1",
    };
    const brave = {
      ...createCardInstance(braveDef, {
        instanceId: "brave-1",
        ownerPlayerId: "alice",
        zone: "field",
        cores: 0,
        zoneRoleName: "brave",
      }),
      attachedToInstanceId: null,
    };

    const entityId = "entity-combined";
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      cardInstances: [host, brave],
      step: "attack" as const,
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 3000,
          resolvedSymbols: ["red", "white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        designatedTargetInstanceId: undefined,
        blockAssignments: [],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      pendingLeaveEntities: [
        {
          instanceId: "host-1",
          kind: "destroy",
          cause: "effect_resolution",
          causePlayerId: null,
          chainId: "chain-1",
          deferZoneMoveUntilChainEnd: false,
          leaveFieldCoreDestinationOverride: null,
        },
      ],
    };

    const afterFlush = flushPendingLeaves(state, lookup);

    // ホストはトラッシュへ、ブレイヴは場に残存
    expect(
      afterFlush.cardInstances.find((c) => c.instanceId === "host-1")?.zone
    ).toBe("trash");
    expect(
      afterFlush.cardInstances.find((c) => c.instanceId === "brave-1")?.zone
    ).toBe("field");
    // 残留後は継続するかの選択を要求しない。
    expect(afterFlush.pendingBraveAttackContinuation).toBeNull();
    expect(
      afterFlush.battleEntities.find((e) => e.entityId === entityId)
        ?.memberInstanceIds
    ).toEqual(["brave-1"]);
  });

  it("continues attack with brave alone when continue is chosen (P2-10)", () => {
    const braveDef = createDemoCardDefinition({
      cardNo: "BRAVE-ATK-CONTINUE-001",
      name: "Continuable Brave",
      printedCategory: "brave",
      levelDefs: [{ level: 1, requiredCores: 0, bp: 1000 }],
      symbolColors: ["white"],
    });
    const brave = createCardInstance(braveDef, {
      instanceId: "brave-1",
      ownerPlayerId: "alice",
      zone: "field",
      cores: 0,
      zoneRoleName: "brave",
    });
    const entityId = "entity-combined";
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [brave],
      }),
      step: "attack" as const,
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        designatedTargetInstanceId: undefined,
        blockAssignments: [],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      pendingBraveAttackContinuation: {
        choosingPlayerId: "alice",
        entityId,
        braveInstanceIds: ["brave-1"],
      },
    };

    const after = resolveBraveAttackContinuation(state, "continue");
    expect(after.pendingBraveAttackContinuation).toBeNull();
    // memberInstanceIds がブレイヴだけに絞られる
    const entity = after.battleEntities.find((e) => e.entityId === entityId);
    expect(entity?.memberInstanceIds).toEqual(["brave-1"]);
    // アタックは継続 (activeAttack 維持)
    expect(after.activeAttack).not.toBeNull();
  });

  it("ends brave participation but preserves the battle when end_attack is chosen (P2-10)", () => {
    const entityId = "entity-combined";
    const state: GameState = {
      ...createEmptyGameState({ playerIds: ["alice", "bob"] }),
      step: "attack" as const,
      activePlayerId: "alice",
      battleEntities: [
        {
          entityId,
          memberInstanceIds: ["host-1", "brave-1"],
          resolvedBp: 1000,
          resolvedSymbols: ["white"],
          attackState: "attacking",
        },
      ],
      activeAttack: {
        attackId: "atk-1",
        primaryEntityId: entityId,
        participantEntityIds: [entityId],
        groupMode: "single",
        target: { kind: "player", playerId: "bob" },
        designatedTargetInstanceId: undefined,
        blockAssignments: [],
        symbolResolutionOrder: [entityId],
        flashBeforeBlockCompleted: true,
        flashAfterBlockCompleted: true,
        flashWindowState: null,
      },
      pendingBraveAttackContinuation: {
        choosingPlayerId: "alice",
        entityId,
        braveInstanceIds: ["brave-1"],
      },
    };

    const after = resolveBraveAttackContinuation(state, "end_attack");
    expect(after.pendingBraveAttackContinuation).toBeNull();
    expect(after.activeAttack).toEqual(state.activeAttack);
    expect(
      after.battleEntities.find((e) => e.entityId === entityId)
    ).toMatchObject({
      memberInstanceIds: [],
      resolvedBp: 0,
      resolvedSymbols: [],
    });
    expect(after.window).toBe(state.window);
  });
});
