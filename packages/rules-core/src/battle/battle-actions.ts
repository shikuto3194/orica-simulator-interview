import { replaceCardInstances } from "../zone/card-instance-state";
import { executeSendToDeck } from "../effect/structured-effect-interpreter";
import { hasPendingBattleEndEntryReactions } from "./battle-end-entry-blockers";
import { recomputeAndRebuildBattleStateContinuousEffects } from "../effect/continuous-effect-rebuild";
import { designateActiveAttackTarget } from "./designated-attack-target";
import { computeLifeReductionAmountBonus } from "../effect/structured-modifiers";
import { getCardById } from "../card/card-lookup";
import {
  resolveLifeDamage,
  getPlayerLifeCoreCount,
  getTotalCoresOnCardById,
  moveNormalCores,
} from "../core/core-system";
import { queueRegisteredBattleImmediateEffects } from "./battle-immediate-effect-system";
import { executeDestroy } from "../effect/structured-card-replacement";
import { appendPublicDisclosuresForStateTransition } from "../public-disclosure";
import {
  getBattleEntityById,
  createBattleResolutionGroup,
  createActiveAttack,
  getBattleCardDefinitionOrThrow,
  getBattleCardInstanceOrThrow,
  getCombinedUnitBp,
  getCombinedUnitSymbolCount,
  getOrCreateCombatBattleEntity,
  isBattleCapableCategory,
  isCurrentCombatMember,
  mergeBlockAssignments,
  recomputeBattleEntityBp,
  resetBattleEntitiesAfterAttackEnd,
} from "./battle-shared";
import {
  getAttackDeclarationBlockReason,
  getBlockDeclarationBlockReason,
  getDeclineBlockBlockReason,
  getDesignatedAttackAttackerCard,
  getIgnoredBlockPreventPlayerIdForUnpreventableRequireBlock,
  getJoinActiveAttackBlockReason,
  getOpenBattleFlashBlockReason,
  getPassBattleFlashBlockReason,
  getRequiredAttackExhaustCostCount,
  getRequiredAttackExhaustCostSourceCandidates,
  getRequiredBattleCostGateAmount,
  getBattleCardCostPaymentPlan,
  getRequiredBlockerCountForParticipant,
  hasPendingAdditionalAttackGrant,
  hasUnusedTaplessBattleDeclareGrant,
  isAttackAllowedWhileExhaustedByCE,
  isDesignatedAttackTargetLegal,
  resolveRequiredBlockerCountForAttacker,
} from "./battle-availability";
import type {
  AttackDeclarationResult,
  BlockDeclarationResult,
  DeclineBlockResult,
  ExecuteBattleResolutionOptions,
  ExecuteBattleResolutionResult,
  JoinActiveAttackOptions,
  OpenBattleFlashResult,
  PassBattleFlashResult,
  PassPreDeclarationStackResult,
  UseAttackAsActionOptions,
  UseBlockAsActionOptions,
  UseDeclineBlockAsActionOptions,
  UseJoinActiveAttackAsActionOptions,
  UseOpenBattleFlashAsActionOptions,
  UsePassBattleFlashAsActionOptions,
  UsePassPreDeclarationStackAsActionOptions,
} from "./battle-types";
import type {
  ActiveAttack,
  ActiveStack,
  BattleDestroyedRecord,
  BattleFlashWindowKind,
  BattleResolutionGroup,
  BattleResolutionEntitySnapshot,
  BattleResolutionParticipantSnapshot,
  CardInstance,
  CardDefinition,
  GameState,
  PendingBattleEndDeferral,
  PendingTriggeredEffect,
  PendingImmediateBattleEnd,
  PreDeclarationStackWindow,
} from "../model";
import {
  peelResolvedStack,
  transferResponseWindowPriority,
} from "../stack/stack-window-shared";
import {
  getEffectiveColors,
  getCombinedUnitCostFilterOptions,
  getFlashConsecutiveUseLimitGrant,
  getSimultaneousAttackGrant,
  hasActiveEndRestriction,
  hasForceAttackStepEndAfterFirstBattle,
} from "../legal/legal-actions-shared";
import { getEffectiveLevel } from "./battle-shared";
import {
  matchesCardFilter,
  matchesCardReferenceFilter,
} from "../card/card-filter";
import type { CardFilter } from "../dsl-types";
import {
  executeEndAttackStep,
  finalizePendingEndFinalizations,
} from "../effect/structured-effect-interpreter";
import { executeMatchingRetriggers } from "../effect/retrigger-system";
import {
  hasOutstandingEffectResolutionContinuation,
  queuePendingLeave,
} from "../state-based-actions";
import { resolveBpCompareDestroyAffect } from "../effect/effect-affect-adapter";
import {
  collectAndQueueTriggerReactions,
  createSimultaneousGroupId,
  getAvailableTriggeredEffectSourceChoices,
  getTriggeredEffectActionRegistrationLookupOrEmpty,
  queuePendingReactionsFromTriggerEvents,
  queuePreDeclarationStackTriggers,
  queueBattleEndTriggers,
  queueBattleDeclarationTriggers,
  pushAttackDeclarationLog,
} from "../effect/trigger-system";
import type {
  BurstActionRegistrationLookup,
  CollectedTriggerEvent,
  TriggeredEffectActionRegistrationLookup,
} from "../effect/trigger-system";
import { checkAndQueueUnsealChoicesForCardEvent } from "../mechanics/grandstone-system";
import { allocateRootTriggerChain, requireTriggerChainId } from "../chain-id";
import type { TurnTransitionLookups } from "../effect/structured-state-grants";
import {
  isCardExhaustionForbidden,
  synchronizeBraveExhaustion,
} from "../mechanics/brave-spirit-state-recovery";
import { resolveBattleEndDeferral } from "../effect/effect-resolution";
import { evaluateAttackStepEndBlockedRetryCondition } from "../effect/attack-step-end-blocked-retry";
import { canFireBattleEndDeferral } from "./battle-end-deferral-gate";
import {
  finalizeBattleEndScopeExpirations,
  getBattleEndDeferralChainId,
  hasPendingBattleEndFinalizeBlockers,
} from "./battle-end-scope-finalize";
import { flushPendingLeavesAndRecomputeContinuousEffects } from "../zone/pending-leave-continuous-upkeep";
import { flushPendingLeavesAndQueueReactions } from "../zone/pending-leave-flush";

function getPreDeclarationStackOpponentId(
  state: GameState,
  actingPlayerId: string
): string {
  const actingPlayerIndex = state.playerOrder.indexOf(actingPlayerId);

  if (actingPlayerIndex === -1 || state.playerOrder.length < 2) {
    throw new Error("Cannot resolve pre-declaration stack opponent player");
  }

  const opponentPlayerId =
    state.playerOrder[(actingPlayerIndex + 1) % state.playerOrder.length];

  if (!opponentPlayerId) {
    throw new Error("Cannot resolve pre-declaration stack opponent player");
  }

  return opponentPlayerId;
}

/**
 * 同時アタック宣言 (P2-05) の追加参加カードを検証する。
 * 不正なら理由文字列を返す (正当なら null)。
 */
function getSimultaneousAttackDeclarationBlockReason(options: {
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  targetInstanceId?: string;
  additionalSourceInstanceIds: string[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): string | null {
  // 指定アタックとの併用は未サポート (XX01/R03 とも通常アタックのみ)
  if (options.targetInstanceId !== undefined) {
    return "simultaneous_attack_cannot_target_spirit";
  }
  const grant = getSimultaneousAttackGrant(
    options.state,
    options.actingPlayerId
  );
  if (grant === null) {
    return "no_simultaneous_attack_grant";
  }
  const allIds = [
    options.sourceInstanceId,
    ...options.additionalSourceInstanceIds,
  ];
  if (new Set(allIds).size !== allIds.length) {
    return "duplicate_participant";
  }
  if (allIds.length > grant.maxCount) {
    return "exceeds_simultaneous_attack_max_count";
  }
  // primary を含む全参加体が grant の filter に合致し、かつ単体でも
  // アタック宣言可能であることを検証する (primary は呼び出し元で検証済み)。
  for (const instanceId of allIds) {
    const card = getCardById(options.state, instanceId);
    const def = card
      ? options.getCardDefinitionById(card.definitionId)
      : undefined;
    if (
      !card ||
      !def ||
      !matchesCardFilter(card, def, grant.filter, {
        state: options.state,
        effectiveColors: getEffectiveColors(options.state, card, def),
        effectiveBp:
          card.zone === "field"
            ? getCombinedUnitBp(
                options.state,
                card,
                def,
                options.getCardDefinitionById
              )
            : undefined,
        coreCount:
          card.zone === "field"
            ? getTotalCoresOnCardById(options.state, card.instanceId)
            : undefined,
        effectiveLevel:
          card.zone === "field"
            ? getEffectiveLevel(
                options.state,
                card,
                def,
                options.getCardDefinitionById
              )
            : undefined,
        effectiveSymbolCount:
          card.zone === "field"
            ? getCombinedUnitSymbolCount(
                options.state,
                card,
                def,
                options.getCardDefinitionById
              )
            : undefined,
      })
    ) {
      return "participant_does_not_match_filter";
    }
    if (instanceId === options.sourceInstanceId) continue;
    const declarationBlockReason = getAttackDeclarationBlockReason({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: instanceId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    if (declarationBlockReason !== null) {
      return `participant_cannot_attack:${declarationBlockReason}`;
    }
  }
  return null;
}

function isAttackExhaustCostSourceSelectionValid(options: {
  state: GameState;
  sourceCard: CardInstance;
  selectedCostSourceInstanceId: string | undefined;
  selectedCostSourceInstanceIds?: readonly string[] | undefined;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  excludedInstanceIds?: ReadonlySet<string>;
}): boolean {
  const candidates = getRequiredAttackExhaustCostSourceCandidates(
    options.state,
    options.sourceCard,
    options.getCardDefinitionById,
    options.excludedInstanceIds
  );
  const requiredCount = getRequiredAttackExhaustCostCount(
    options.state,
    options.sourceCard,
    options.getCardDefinitionById
  );
  const selectedIds =
    options.selectedCostSourceInstanceIds ??
    (options.selectedCostSourceInstanceId !== undefined
      ? [options.selectedCostSourceInstanceId]
      : []);
  if (candidates === null || requiredCount === 0) {
    return selectedIds.length === 0;
  }
  if (selectedIds.length !== requiredCount) {
    return false;
  }
  const uniqueSelectedIds = new Set(selectedIds);
  return (
    uniqueSelectedIds.size === selectedIds.length &&
    selectedIds.every((id) => candidates.includes(id))
  );
}

function getSelectedAttackExhaustCostSourceIds(input: {
  attackExhaustCostSourceInstanceId?: string;
  attackExhaustCostSourceInstanceIds?: readonly string[];
}): string[] {
  return input.attackExhaustCostSourceInstanceIds !== undefined
    ? [...input.attackExhaustCostSourceInstanceIds]
    : input.attackExhaustCostSourceInstanceId !== undefined
      ? [input.attackExhaustCostSourceInstanceId]
      : [];
}

function normalizeAttackExhaustCostSourceSelection(
  selection: string | readonly string[] | undefined
): string[] | undefined {
  if (selection === undefined) return undefined;
  return typeof selection === "string" ? [selection] : [...selection];
}

function payAttackExhaustCostSources(options: {
  state: GameState;
  sourceInstanceId: string;
  costSourceInstanceIds: readonly string[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  if (options.costSourceInstanceIds.length === 0) {
    return options.state;
  }
  const exhaustTargetIds = new Set(options.costSourceInstanceIds);
  return synchronizeBraveExhaustion(
    replaceCardInstances(
      {
        ...options.state,
        log: [
          ...options.state.log,
          ...options.costSourceInstanceIds.map(
            (costSourceId) =>
              `attack:exhaust-cost-paid:${options.sourceInstanceId}:${costSourceId}`
          ),
        ],
      },
      options.state.cardInstances.map((card) =>
        exhaustTargetIds.has(card.instanceId) &&
        !isCardExhaustionForbidden(
          card,
          options.getCardDefinitionById(card.definitionId)
        )
          ? { ...card, exhaustState: "exhausted" as const }
          : card
      )
    ),
    options.getCardDefinitionById
  );
}

function withoutAttackExhaustCostGateCEs(state: GameState): GameState {
  return {
    ...state,
    activeContinuousEffects: state.activeContinuousEffects.filter(
      (ce) => ce.modifierTag !== "attack_exhaust_cost_gate"
    ),
  };
}

/**
 * battle_destroy_cost_gate (BSDB01-C09) CE を除いた state を返す。宣言確定時の
 * 再検証 (legality-changed チェック) は、既に破壊コストを支払い済みの場合に使う
 * (支払いで破壊コスト源自体が失われ、再検証で誤って unaffordable と判定されるのを防ぐ。
 * withoutAttackExhaustCostGateCEs と同じ回避パターン)。
 */
function withoutBattleDestroyCostGateCEs(state: GameState): GameState {
  return {
    ...state,
    activeContinuousEffects: state.activeContinuousEffects.filter(
      (ce) =>
        ce.modifierTag !== "battle_destroy_cost_gate_attack" &&
        ce.modifierTag !== "battle_destroy_cost_gate_block" &&
        ce.modifierTag !== "battle_destroy_cost_gate_both"
    ),
  };
}

/**
 * joinActiveAttackAsAction の legality 再チェック用: 既に支払い済みのゲート種別
 * (attack_exhaust_cost_gate / battle_destroy_cost_gate) だけを state から除いて返す
 * (支払い済みの結果で候補が失われ、誤って unaffordable と再判定されるのを防ぐ)。
 */
function withoutJoinCostGateCEsIfAlreadyPaid(options: {
  state: GameState;
  attackExhaustCostAlreadyPaid?: boolean;
  battleDestroyCostAlreadyPaid?: boolean;
}): GameState {
  let state = options.state;
  if (options.attackExhaustCostAlreadyPaid) {
    state = withoutAttackExhaustCostGateCEs(state);
  }
  if (options.battleDestroyCostAlreadyPaid) {
    state = withoutBattleDestroyCostGateCEs(state);
  }
  return state;
}

/** battle_destroy_cost_gate (BSDB01-C09) の破壊コスト源選択が有効か検証する。 */
function isBattleDestroyCostSourceSelectionValid(options: {
  state: GameState;
  sourceCard: CardInstance;
  tags: readonly string[];
  selectedCostSourceInstanceId: string | undefined;
  selectedCostSourceInstanceIds?: readonly string[] | undefined;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  excludedInstanceIds?: ReadonlySet<string>;
}): boolean {
  const selectedIds =
    options.selectedCostSourceInstanceIds ??
    (options.selectedCostSourceInstanceId !== undefined
      ? [options.selectedCostSourceInstanceId]
      : []);
  return (
    getBattleCardCostPaymentPlan(
      options.state,
      options.sourceCard,
      options.getCardDefinitionById,
      options.tags,
      selectedIds,
      options.excludedInstanceIds
    ) !== null
  );
}

function getSelectedBattleDestroyCostSourceIds(input: {
  battleDestroyCostSourceInstanceId?: string;
  battleDestroyCostSourceInstanceIds?: readonly string[];
}): string[] {
  return input.battleDestroyCostSourceInstanceIds !== undefined
    ? [...input.battleDestroyCostSourceInstanceIds]
    : input.battleDestroyCostSourceInstanceId !== undefined
      ? [input.battleDestroyCostSourceInstanceId]
      : [];
}

/**
 * battle_destroy_cost_gate の破壊コストを実行する (executeDestroy 経由、trigger 済
 * destroy と同じ経路)。コストとして即座に成立させるため、queuePendingLeave された
 * 離脱をその場で flushPendingLeaves する (通常の効果解決内 destroy と異なり、宣言確定を
 * 続けるにはコスト支払いが完了している必要がある)。
 */
function payBattleDestroyCostSources(options: {
  restriction: "attack" | "block";
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  costSourceInstanceIds: readonly string[];
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  if (options.costSourceInstanceIds.length === 0) {
    return options.state;
  }
  const source = getCardById(options.state, options.sourceInstanceId);
  if (!source) return options.state;
  const plan = getBattleCardCostPaymentPlan(
    options.state,
    source,
    options.getCardDefinitionById,
    [
      "battle_destroy_cost_gate_both",
      "battle_destroy_cost_gate_" + options.restriction,
    ],
    options.costSourceInstanceIds
  );
  if (!plan) throw new Error("Invalid battle card cost selection");
  const destroyIds = plan
    .filter((item) => item.destination === "destroy")
    .map((item) => item.instanceId);
  const returnIds = plan
    .filter((item) => item.destination === "deck_bottom")
    .map((item) => item.instanceId);
  let state = destroyIds.length
    ? executeDestroy(
        options.state,
        options.actingPlayerId,
        { player: "self", count: destroyIds.length },
        options.getCardDefinitionById,
        options.sourceInstanceId,
        destroyIds
      )
    : options.state;
  if (returnIds.length)
    state = executeSendToDeck(
      state,
      options.actingPlayerId,
      {
        kind: "send_to_deck",
        target: { player: "self", count: returnIds.length },
        position: "bottom",
      },
      options.getCardDefinitionById,
      options.sourceInstanceId,
      returnIds
    );
  return flushPendingLeavesAndRecomputeContinuousEffects(
    state,
    options.getCardDefinitionById
  );
}

export function useAttackAsAction(
  options: UseAttackAsActionOptions
): GameState {
  const blockReason = getAttackDeclarationBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Attack declaration is not legal: source=${options.sourceInstanceId} reason=${blockReason}`
    );
  }

  const additionalSourceInstanceIds = options.additionalSourceInstanceIds ?? [];
  const declaredParticipantIds = new Set([
    options.sourceInstanceId,
    ...additionalSourceInstanceIds,
  ]);
  const sourceCardForExhaustCost = getCardById(
    options.state,
    options.sourceInstanceId
  );
  if (
    sourceCardForExhaustCost !== undefined &&
    !isAttackExhaustCostSourceSelectionValid({
      state: options.state,
      sourceCard: sourceCardForExhaustCost,
      selectedCostSourceInstanceId: options.attackExhaustCostSourceInstanceId,
      selectedCostSourceInstanceIds: options.attackExhaustCostSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
      excludedInstanceIds: declaredParticipantIds,
    })
  ) {
    throw new Error(
      `Attack declaration requires an exhaust cost source: source=${options.sourceInstanceId}`
    );
  }
  const usedAttackExhaustCostSourceIds = new Set(
    getSelectedAttackExhaustCostSourceIds(options)
  );

  // battle_destroy_cost_gate (BSDB01-C09): 破壊コスト源の選択検証。
  // 同時アタック追加参加体側 (additionalSourceInstanceIds) は本ゲート未対応
  // (P2-05 同時アタックとの組み合わせは isAttackPreventedByCE の unaffordable
  // 判定により支払い不能なら宣言自体が阻止されるが、支払い可能な場合でも本経路では
  // 破壊コストを徴収しない。単独カードのみが出典の残存ギャップとして記録)。
  if (
    sourceCardForExhaustCost !== undefined &&
    !isBattleDestroyCostSourceSelectionValid({
      state: options.state,
      sourceCard: sourceCardForExhaustCost,
      tags: [
        "battle_destroy_cost_gate_attack",
        "battle_destroy_cost_gate_both",
      ],
      selectedCostSourceInstanceId: options.battleDestroyCostSourceInstanceId,
      selectedCostSourceInstanceIds: options.battleDestroyCostSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
      excludedInstanceIds: declaredParticipantIds,
    })
  ) {
    throw new Error(
      `Attack declaration requires a destroy cost source: source=${options.sourceInstanceId}`
    );
  }

  if (additionalSourceInstanceIds.length > 0) {
    const simulBlockReason = getSimultaneousAttackDeclarationBlockReason({
      state: options.state,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: options.sourceInstanceId,
      ...(options.targetInstanceId !== undefined
        ? { targetInstanceId: options.targetInstanceId }
        : {}),
      additionalSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    if (simulBlockReason !== null) {
      throw new Error(
        `Simultaneous attack declaration is not legal: source=${options.sourceInstanceId} reason=${simulBlockReason}`
      );
    }

    const additionalCostSelections =
      options.additionalAttackExhaustCostSourceInstanceIds ?? {};
    for (const additionalId of additionalSourceInstanceIds) {
      const additionalCard = getCardById(options.state, additionalId);
      const selectedAdditionalCostSourceIds =
        normalizeAttackExhaustCostSourceSelection(
          additionalCostSelections[additionalId]
        );
      if (
        additionalCard !== undefined &&
        !isAttackExhaustCostSourceSelectionValid({
          state: options.state,
          sourceCard: additionalCard,
          selectedCostSourceInstanceId: selectedAdditionalCostSourceIds?.[0],
          selectedCostSourceInstanceIds: selectedAdditionalCostSourceIds,
          getCardDefinitionById: options.getCardDefinitionById,
          excludedInstanceIds: new Set([
            ...declaredParticipantIds,
            ...usedAttackExhaustCostSourceIds,
          ]),
        })
      ) {
        throw new Error(
          `Simultaneous attack participant requires an exhaust cost source: source=${additionalId}`
        );
      }
      for (const costSourceId of selectedAdditionalCostSourceIds ?? []) {
        usedAttackExhaustCostSourceIds.add(costSourceId);
      }
    }
  }

  const opponentPlayerId = getPreDeclarationStackOpponentId(
    options.state,
    options.actingPlayerId
  );
  let stateBeforeWindow = payAttackExhaustCostSources({
    state: options.state,
    sourceInstanceId: options.sourceInstanceId,
    costSourceInstanceIds: getSelectedAttackExhaustCostSourceIds(options),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  stateBeforeWindow = payBattleDestroyCostSources({
    restriction: "attack",
    state: stateBeforeWindow,
    actingPlayerId: options.actingPlayerId,
    sourceInstanceId: options.sourceInstanceId,
    costSourceInstanceIds: getSelectedBattleDestroyCostSourceIds(options),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (additionalSourceInstanceIds.length > 0) {
    const additionalCostSelections =
      options.additionalAttackExhaustCostSourceInstanceIds ?? {};
    for (const additionalId of additionalSourceInstanceIds) {
      stateBeforeWindow = payAttackExhaustCostSources({
        state: stateBeforeWindow,
        sourceInstanceId: additionalId,
        costSourceInstanceIds:
          normalizeAttackExhaustCostSourceSelection(
            additionalCostSelections[additionalId]
          ) ?? [],
        getCardDefinitionById: options.getCardDefinitionById,
      });
    }
  }
  const root = allocateRootTriggerChain(stateBeforeWindow);
  stateBeforeWindow = root.state;
  stateBeforeWindow = collectAndQueueTriggerReactions({
    beforeState: options.state,
    afterState: stateBeforeWindow,
    source: "action_resolution",
    chainId: root.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      getTriggeredEffectActionRegistrationLookupOrEmpty(
        options.getRegisteredTriggeredEffectActions
      ),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: options.actingPlayerId,
    causedBySourceInstanceId: null,
  });

  const stateAtWindow: GameState = {
    ...stateBeforeWindow,
    step: "attack",
    window: "pre_declaration_stack",
    preDeclarationStackWindow: {
      kind: "attack",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: options.sourceInstanceId,
      ...(options.targetInstanceId !== undefined
        ? { targetInstanceId: options.targetInstanceId }
        : {}),
      ...(options.attackExhaustCostSourceInstanceId !== undefined
        ? {
            attackExhaustCostSourceInstanceId:
              options.attackExhaustCostSourceInstanceId,
          }
        : {}),
      ...(options.attackExhaustCostSourceInstanceIds !== undefined
        ? {
            attackExhaustCostSourceInstanceIds:
              options.attackExhaustCostSourceInstanceIds,
          }
        : {}),
      ...(additionalSourceInstanceIds.length > 0
        ? { additionalSourceInstanceIds }
        : {}),
      ...(options.additionalAttackExhaustCostSourceInstanceIds !== undefined
        ? {
            additionalAttackExhaustCostSourceInstanceIds:
              options.additionalAttackExhaustCostSourceInstanceIds,
          }
        : {}),
      ...(options.battleDestroyCostSourceInstanceId !== undefined
        ? {
            battleDestroyCostSourceInstanceId:
              options.battleDestroyCostSourceInstanceId,
          }
        : {}),
      ...(options.battleDestroyCostSourceInstanceIds !== undefined
        ? {
            battleDestroyCostSourceInstanceIds:
              options.battleDestroyCostSourceInstanceIds,
          }
        : {}),
      priorityPlayerId: opponentPlayerId,
      consecutivePassCount: 0,
      previousWindow: options.state.window,
      stackResponseSourcePlayerId: options.actingPlayerId,
      pendingStackAction: null,
    },
    log: [
      ...stateBeforeWindow.log,
      `attack:tentative:${stateBeforeWindow.turnNumber}:${options.actingPlayerId}:${options.sourceInstanceId}`,
    ],
  };

  return queuePreDeclarationStackTriggers({
    state: recomputeAndRebuildBattleStateContinuousEffects(
      stateAtWindow,
      options.getCardDefinitionById
    ),
    windowKind: "attack",
    sourceInstanceId: options.sourceInstanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      getTriggeredEffectActionRegistrationLookupOrEmpty(
        options.getRegisteredTriggeredEffectActions
      ),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

export function confirmAttackDeclarationAsAction(
  win: PreDeclarationStackWindow,
  state: GameState,
  options: Pick<
    UseAttackAsActionOptions,
    | "getCardDefinitionById"
    | "getRegisteredBattleImmediateEffectActions"
    | "getRegisteredTriggeredEffectActions"
    | "getRegisteredBurstActions"
  >
): AttackDeclarationResult {
  const sourceCard = getCardById(state, win.sourceInstanceId);

  // ENGINE-additional-attack-mid-declare-attack-window-risk: additional_attack grant を
  // 持つカードは疲労状態でもこのアタック宣言を確定できる (一回限り、確定時に grant を消費)。
  const hasAdditionalAttackGrant =
    sourceCard !== undefined &&
    hasPendingAdditionalAttackGrant(state, win.sourceInstanceId);
  const consumesAdditionalAttackGrant = hasAdditionalAttackGrant;

  // BSTH09-C04【追撃】: allow_attack_while_exhausted CE を持つ疲労状態のカードは
  // 重疲労遷移を対価にアタック宣言を確定できる (実際の遷移は下の exhaustTargetIds 処理)。
  const hasAllowAttackWhileExhaustedGrant =
    sourceCard !== undefined &&
    sourceCard.exhaustState === "exhausted" &&
    isAttackAllowedWhileExhaustedByCE(state, win.sourceInstanceId);

  // キャンセル: アタッカーが field にいない、または既に疲労済み (grant があれば疲労を許容)
  if (
    !sourceCard ||
    sourceCard.zone !== "field" ||
    (sourceCard.exhaustState !== "recovered" &&
      !hasAdditionalAttackGrant &&
      !hasAllowAttackWhileExhaustedGrant)
  ) {
    state.log.push(
      `attack:cancelled:${win.sourceInstanceId}:attacker-no-longer-valid`
    );
    const cancelledState: GameState = {
      ...state,
      preDeclarationStackWindow: null,
      window: win.previousWindow,
    };
    return { attackId: "", entityId: "", state: cancelledState };
  }

  const stateForAttackLegalityBase: GameState = {
    ...state,
    window: win.previousWindow,
  };
  const stateForAttackLegalityAfterExhaustBypass =
    getSelectedAttackExhaustCostSourceIds(win).length > 0
      ? withoutAttackExhaustCostGateCEs(stateForAttackLegalityBase)
      : stateForAttackLegalityBase;
  const stateForAttackLegality =
    getSelectedBattleDestroyCostSourceIds(win).length > 0
      ? withoutBattleDestroyCostGateCEs(
          stateForAttackLegalityAfterExhaustBypass
        )
      : stateForAttackLegalityAfterExhaustBypass;
  const attackReasonAfterStack = getAttackDeclarationBlockReason({
    state: stateForAttackLegality,
    actingPlayerId: win.actingPlayerId,
    sourceInstanceId: win.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (attackReasonAfterStack !== null) {
    state.log.push(
      `attack:cancelled:${win.sourceInstanceId}:legality-changed:${attackReasonAfterStack}`
    );
    const cancelledState: GameState = {
      ...state,
      preDeclarationStackWindow: null,
      window: win.previousWindow,
    };
    return { attackId: "", entityId: "", state: cancelledState };
  }

  if (consumesAdditionalAttackGrant) {
    const grantIndex = state.pendingAdditionalAttackGrants.indexOf(
      win.sourceInstanceId
    );
    state = {
      ...state,
      pendingAdditionalAttackGrants: [
        ...state.pendingAdditionalAttackGrants.slice(0, grantIndex),
        ...state.pendingAdditionalAttackGrants.slice(grantIndex + 1),
      ],
    };
    state.log.push(
      `attack:additional-attack-grant-consumed:${win.sourceInstanceId}`
    );
  }

  const sourceDefinition = getBattleCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  const attackBattleEntity = getOrCreateCombatBattleEntity({
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const hasExistingBattleEntity = state.battleEntities.some(
    (e) => e.entityId === attackBattleEntity.entityId
  );
  const attackerBattleEntities = (
    hasExistingBattleEntity
      ? state.battleEntities
      : [...state.battleEntities, attackBattleEntity]
  ).map((e) =>
    e.entityId === attackBattleEntity.entityId
      ? { ...attackBattleEntity, attackState: "attacking" as const }
      : e
  );
  const nextActiveAttack = createActiveAttack(
    state,
    attackBattleEntity.entityId,
    win.actingPlayerId
  );
  state.log.push(
    `attack:declare:${state.turnNumber}:${win.actingPlayerId}:${win.sourceInstanceId}:${attackBattleEntity.entityId}`,
    `attack:source-exhausted:${win.sourceInstanceId}`,
    `attack:group-created:${nextActiveAttack.attackId}:${attackBattleEntity.entityId}`
  );
  // BSTH09-C03「ターンに1回、疲労せずにアタック/ブロックできる」: 本カードだけ
  // (attachedChildrenIds は対象外) 宣言確定時の疲労遷移をスキップし、消費を記録する。
  // hasAllowAttackWhileExhaustedGrant (BSTH09-C04) が優先し、両方は同時消費しない
  // (疲労状態のカードは exhaustState!=="recovered" のためタップ無し grant の対象外)。
  const usesTaplessBattleDeclareGrant =
    !hasAllowAttackWhileExhaustedGrant &&
    sourceCard.exhaustState === "recovered" &&
    hasUnusedTaplessBattleDeclareGrant(state, win.sourceInstanceId);
  const sourceDeclareExhaustResultState:
    | "recovered"
    | "exhausted"
    | "heavily_exhausted" = hasAllowAttackWhileExhaustedGrant
    ? "heavily_exhausted"
    : usesTaplessBattleDeclareGrant
      ? sourceCard.exhaustState
      : "exhausted";
  if (usesTaplessBattleDeclareGrant) {
    state = {
      ...state,
      usedTaplessBattleDeclareInstanceIdsThisTurn: [
        ...state.usedTaplessBattleDeclareInstanceIdsThisTurn,
        win.sourceInstanceId,
      ],
    };
  }
  const sharedCardInstances = synchronizeBraveExhaustion(
    replaceCardInstances(
      {
        ...state,
      },
      state.cardInstances.map((card) =>
        card.instanceId === win.sourceInstanceId
          ? { ...card, exhaustState: sourceDeclareExhaustResultState }
          : card
      )
    ),
    options.getCardDefinitionById
  ).cardInstances;
  // 指定アタック: 対象スピリットが指定されている場合
  const targetInstanceId = win.targetInstanceId;
  const targetCard =
    targetInstanceId !== undefined
      ? getCardById(state, targetInstanceId)
      : undefined;
  const spiritTargetValid =
    targetCard !== undefined &&
    isDesignatedAttackTargetLegal(
      state,
      targetCard,
      options.getCardDefinitionById,
      sourceCard
    );

  let nextStateWithAttack: GameState;

  if (spiritTargetValid && targetCard !== undefined) {
    const preparedState: GameState = replaceCardInstances(
      {
        ...state,
        window: "declare_attack",
        preDeclarationStackWindow: null,
        battleEntities: attackerBattleEntities,
        activeAttack: {
          ...nextActiveAttack,
          ...(win.pendingForcedBlockerInstanceId !== undefined
            ? { forcedBlockerInstanceId: win.pendingForcedBlockerInstanceId }
            : {}),
        },
      },
      sharedCardInstances
    );
    nextStateWithAttack = designateActiveAttackTarget(
      preparedState,
      targetCard.instanceId,
      options.getCardDefinitionById
    );
  } else {
    // 通常アタック (指定なし、または宣言確定前に指定対象として成立しなくなった場合)
    if (targetInstanceId !== undefined) {
      state.log.push(
        `attack:spirit-target-cancelled:${targetInstanceId}:target-no-longer-valid`
      );
    }
    nextStateWithAttack = replaceCardInstances(
      {
        ...state,
        window: "declare_attack",
        preDeclarationStackWindow: null,
        battleEntities: attackerBattleEntities,
        activeAttack:
          win.pendingForcedBlockerInstanceId !== undefined
            ? {
                ...nextActiveAttack,
                forcedBlockerInstanceId: win.pendingForcedBlockerInstanceId,
              }
            : nextActiveAttack,
      },
      sharedCardInstances
    );
  }

  // battle_cost_gate (BSAZ01-C09): アタック宣言が要求する対象自身のコアからのコスト支払い。
  // 宣言時 (useAttackAsAction → getAttackDeclarationBlockReason) で支払い可能性は確認済みだが、
  // 宣言〜確定間の pre_declaration_stack 窓でコアが失われる可能性はゼロではないため、
  // 支払い可能な分だけ実行する (不足時は宣言時チェックを信頼し無理な負数化はしない)。
  const attackCostGateAmount = getRequiredBattleCostGateAmount(
    state,
    sourceCard,
    options.getCardDefinitionById,
    ["battle_cost_gate_attack", "battle_cost_gate_both"]
  );
  if (
    attackCostGateAmount > 0 &&
    sourceCard.normalCoreCount >= attackCostGateAmount
  ) {
    nextStateWithAttack = moveNormalCores(
      nextStateWithAttack,
      { kind: "card", instanceId: win.sourceInstanceId },
      { kind: "trash", playerId: sourceCard.controllerPlayerId },
      attackCostGateAmount,
      options.getCardDefinitionById
    );
    nextStateWithAttack.log.push(
      `attack:cost-gate-paid:${win.sourceInstanceId}:${attackCostGateAmount}`
    );
  }

  const activeAttack = nextStateWithAttack.activeAttack;
  if (activeAttack === null) {
    throw new Error("Expected activeAttack to exist after attack confirmation");
  }

  // 同時誘発グループ: アタック時効果と疲労誘発効果を同じグループに束ねる
  const simultaneousGroupId = createSimultaneousGroupId();

  // 同時アタック宣言 (P2-05): 追加参加体を join 合成する。
  // 宣言時に検証済みだが、宣言前スタック窓の応答で状況が変わりうるため
  // confirm 時に再検証し、無効になった参加体は脱落させる (primary 無効は
  // 上の attacker-no-longer-valid キャンセルで宣言全体が落ちる)。
  // joinMode: "simultaneous_declaration" により「アタックしたとき」観測は
  // primary の 1 回のみ (公式 Q26342)。各参加体自身の『アタック時』は
  // 同じ simultaneousGroupId で束ね、解決順をターンプレイヤーが選ぶ (Q26329)。
  let stateWithSimultaneousJoins = nextStateWithAttack;
  const additionalSourceInstanceIds = spiritTargetValid
    ? []
    : (win.additionalSourceInstanceIds ?? []);
  for (const additionalId of additionalSourceInstanceIds) {
    const joinBlockReason = getJoinActiveAttackBlockReason({
      state: withoutAttackExhaustCostGateCEs(stateWithSimultaneousJoins),
      actingPlayerId: win.actingPlayerId,
      sourceInstanceId: additionalId,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    if (joinBlockReason !== null) {
      stateWithSimultaneousJoins.log.push(
        `attack:simul-join-skipped:${additionalId}:${joinBlockReason}`
      );
      continue;
    }
    const selectedAdditionalCostSourceIds =
      normalizeAttackExhaustCostSourceSelection(
        win.additionalAttackExhaustCostSourceInstanceIds?.[additionalId]
      );
    const joinResult = joinActiveAttackAsAction({
      state: stateWithSimultaneousJoins,
      actingPlayerId: win.actingPlayerId,
      sourceInstanceId: additionalId,
      ...(selectedAdditionalCostSourceIds !== undefined
        ? {
            attackExhaustCostSourceInstanceId:
              selectedAdditionalCostSourceIds[0],
            attackExhaustCostSourceInstanceIds: selectedAdditionalCostSourceIds,
          }
        : {}),
      getCardDefinitionById: options.getCardDefinitionById,
      joinMode: "simultaneous_declaration",
      simultaneousGroupId,
      attackExhaustCostAlreadyPaid: true,
      // battle_destroy_cost_gate: 同時アタック追加参加体は破壊コスト選択 UI/API が
      // まだ無いため常に「支払い済み扱い」でスキップする (joinActiveAttackAsAction の
      // コメント参照。既知の残存ギャップ)。
      battleDestroyCostAlreadyPaid: true,
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
    });
    stateWithSimultaneousJoins = joinResult.state;
  }

  // 同時アタックが成立したら、許可 CE の blockerCapacity をスナップショットする
  // (Phase 2: 複数ブロックの容量ゲートが消費。CE が後で消えても上限は維持)。
  if (
    stateWithSimultaneousJoins.activeAttack !== null &&
    stateWithSimultaneousJoins.activeAttack.participantEntityIds.length >= 2
  ) {
    const simulGrant = getSimultaneousAttackGrant(
      stateWithSimultaneousJoins,
      win.actingPlayerId
    );
    if (simulGrant !== null) {
      stateWithSimultaneousJoins = {
        ...stateWithSimultaneousJoins,
        activeAttack: {
          ...stateWithSimultaneousJoins.activeAttack,
          blockerCapacity: simulGrant.blockerCapacity,
        },
      };
    }
  }

  // 複数体ブロック強制 (P2-05 Phase 5, require_multi_block CE, BSFT01-TR06(B) 型):
  // 各 participant について blockerCapacity と同じくアタック宣言確定時に
  // requiredBlockerCount をスナップショットする (current-actor.ts が
  // getCardDefinitionById 無しの純粋関数であるため、実行時の CardFilter 照合ではなく
  // 確定済みの数値をここへ持つ)。
  if (stateWithSimultaneousJoins.activeAttack !== null) {
    const attackForRequiredBlockerCount =
      stateWithSimultaneousJoins.activeAttack;
    const nextBlockAssignments =
      attackForRequiredBlockerCount.blockAssignments.map((assignment) => {
        const requiredBlockerCount = resolveRequiredBlockerCountForAttacker(
          stateWithSimultaneousJoins,
          win.actingPlayerId,
          assignment.participantEntityId,
          options.getCardDefinitionById
        );
        return requiredBlockerCount !== undefined
          ? { ...assignment, requiredBlockerCount }
          : assignment;
      });
    stateWithSimultaneousJoins = {
      ...stateWithSimultaneousJoins,
      activeAttack: {
        ...attackForRequiredBlockerCount,
        blockAssignments: nextBlockAssignments,
      },
    };
  }

  const queuedStateBeforeDeclaration = queueRegisteredBattleImmediateEffects({
    state: stateWithSimultaneousJoins,
    attackId: activeAttack.attackId,
    participantEntityId: attackBattleEntity.entityId,
    actingPlayerId: win.actingPlayerId,
    sourceCard: getBattleCardInstanceOrThrow(
      stateWithSimultaneousJoins,
      win.sourceInstanceId,
      "Unknown attack source card after confirmation"
    ),
    sourceDefinition,
    timing: "attack",
    getCardDefinitionById: options.getCardDefinitionById,
    simultaneousGroupId,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
  });

  // P3-14 C-2: 「〜がアタックしたとき」game_event 観測トリガー (他カード上のリスナー)。
  // 自カードの『アタック時』battle immediate と同じ同時誘発グループに束ねる。
  const queuedState = queueBattleDeclarationTriggers({
    chainId: activeAttack.attackId,
    state: queuedStateBeforeDeclaration,
    kind: "attack",
    declaringInstanceId: win.sourceInstanceId,
    declaringPlayerId: win.actingPlayerId,
    simultaneousGroupId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  // retrigger: アタック時の条件付き再発火効果を実行
  const attackerCard = getBattleCardInstanceOrThrow(
    queuedState,
    win.sourceInstanceId,
    "Unknown attack source card for retrigger"
  );
  // 疲労などの状態変化を検出し、同じ simultaneousGroupId で PendingTriggeredEffect にキューイング
  // card_exhausted は該当カードに on_exhaust 効果がある場合のみキューイング（filterOptInTriggerEvents）
  // P3-39: getRegisteredTriggeredEffectActions は UseAttackAsActionOptions で必須化済み。
  // テストが省略した場合は空 lookup `() => []` で fallback (defensive guard で空 sourceChoices 扱い)。
  const withTriggers = collectAndQueueTriggerReactions({
    beforeState: state,
    afterState: queuedState,
    source: "action_resolution",
    chainId: activeAttack.attackId,
    attackId: activeAttack.attackId,
    simultaneousGroupId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    // P3-68 ギャップ 1: アタック時効果の起因はアタッカーのコントローラ。
    causedByPlayerId: attackerCard.controllerPlayerId,
    causedBySourceInstanceId: null,
  });

  // 創界石の解封（アタック系条件）: アタック宣言は state delta に現れないため、
  // ここで明示的にフックする（合流アタック joinActiveAttackAsAction は対象外 =
  // 「アタックしたとき」系トリガーと同じ扱い）。
  const afterRetrigger = executeMatchingRetriggers({
    ...options,
    state: withTriggers,
    event: "attack",
    triggerCard: attackerCard,
    triggerCardDefinition: sourceDefinition,
  });
  const withUnseal = checkAndQueueUnsealChoicesForCardEvent(
    afterRetrigger,
    win.sourceInstanceId,
    "attack",
    options.getCardDefinitionById,
    activeAttack.attackId
  );

  return {
    attackId: activeAttack.attackId,
    entityId: attackBattleEntity.entityId,
    state: withUnseal,
  };
}

/**
 * P3-115: `join_active_attack` をプレイヤーが独立して宣言するエントリポイント。
 * `useAttackAsAction`/`useBlockAsAction` と同型に `02:190`「アタック/ブロック宣言」
 * (途中合流アタックもアタック宣言の一種) に対するスタック窓を自分で開き、実際の合流処理は
 * 窓クローズ後の `confirmJoinActiveAttackDeclarationAsAction` へ委譲する。
 *
 * `joinActiveAttackAsAction` 自体 (joinMode:"mid_battle"/"simultaneous_declaration") は
 * 既存の呼び出し元 (confirmAttackDeclarationAsAction の同時アタック合成、効果解決内の
 * hand-written resolver) が既に窓を処理済みの nested 呼び出し用プリミティブのままとする。
 */
export function useJoinActiveAttackAsAction(
  options: UseJoinActiveAttackAsActionOptions
): GameState {
  const blockReason = getJoinActiveAttackBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Join attack is not legal: source=${options.sourceInstanceId} reason=${blockReason}`
    );
  }

  const sourceCardForExhaustCost = getCardById(
    options.state,
    options.sourceInstanceId
  );
  if (
    sourceCardForExhaustCost !== undefined &&
    !isAttackExhaustCostSourceSelectionValid({
      state: options.state,
      sourceCard: sourceCardForExhaustCost,
      selectedCostSourceInstanceId: options.attackExhaustCostSourceInstanceId,
      selectedCostSourceInstanceIds: options.attackExhaustCostSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
    })
  ) {
    throw new Error(
      `Join attack declaration requires an exhaust cost source: source=${options.sourceInstanceId}`
    );
  }
  // battle_destroy_cost_gate (BSDB01-C09): 途中合流アタック (P3-115) も
  // getJoinActiveAttackBlockReason (isAttackPreventedByCE 経由) でゲート対象になるため、
  // useAttackAsAction/useBlockAsAction と同じく宣言時に破壊コスト源を検証・支払う。
  if (
    sourceCardForExhaustCost !== undefined &&
    !isBattleDestroyCostSourceSelectionValid({
      state: options.state,
      sourceCard: sourceCardForExhaustCost,
      tags: [
        "battle_destroy_cost_gate_attack",
        "battle_destroy_cost_gate_both",
      ],
      selectedCostSourceInstanceId: options.battleDestroyCostSourceInstanceId,
      selectedCostSourceInstanceIds: options.battleDestroyCostSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
    })
  ) {
    throw new Error(
      `Join attack declaration requires a destroy cost source: source=${options.sourceInstanceId}`
    );
  }

  const opponentPlayerId = getPreDeclarationStackOpponentId(
    options.state,
    options.actingPlayerId
  );
  let stateBeforeWindow = payAttackExhaustCostSources({
    state: options.state,
    sourceInstanceId: options.sourceInstanceId,
    costSourceInstanceIds: getSelectedAttackExhaustCostSourceIds(options),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  stateBeforeWindow = payBattleDestroyCostSources({
    restriction: "attack",
    state: stateBeforeWindow,
    actingPlayerId: options.actingPlayerId,
    sourceInstanceId: options.sourceInstanceId,
    costSourceInstanceIds: getSelectedBattleDestroyCostSourceIds(options),
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const root = allocateRootTriggerChain(stateBeforeWindow);
  stateBeforeWindow = root.state;
  stateBeforeWindow = collectAndQueueTriggerReactions({
    beforeState: options.state,
    afterState: stateBeforeWindow,
    source: "action_resolution",
    chainId: root.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      getTriggeredEffectActionRegistrationLookupOrEmpty(
        options.getRegisteredTriggeredEffectActions
      ),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: options.actingPlayerId,
    causedBySourceInstanceId: null,
  });

  const stateAtWindow: GameState = {
    ...stateBeforeWindow,
    window: "pre_declaration_stack",
    preDeclarationStackWindow: {
      kind: "join_active_attack",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: options.sourceInstanceId,
      ...(options.attackExhaustCostSourceInstanceId !== undefined
        ? {
            attackExhaustCostSourceInstanceId:
              options.attackExhaustCostSourceInstanceId,
          }
        : {}),
      ...(options.attackExhaustCostSourceInstanceIds !== undefined
        ? {
            attackExhaustCostSourceInstanceIds:
              options.attackExhaustCostSourceInstanceIds,
          }
        : {}),
      ...(options.battleDestroyCostSourceInstanceId !== undefined
        ? {
            battleDestroyCostSourceInstanceId:
              options.battleDestroyCostSourceInstanceId,
          }
        : {}),
      ...(options.battleDestroyCostSourceInstanceIds !== undefined
        ? {
            battleDestroyCostSourceInstanceIds:
              options.battleDestroyCostSourceInstanceIds,
          }
        : {}),
      priorityPlayerId: opponentPlayerId,
      consecutivePassCount: 0,
      previousWindow: options.state.window,
      stackResponseSourcePlayerId: options.actingPlayerId,
      pendingStackAction: null,
    },
    log: [
      ...stateBeforeWindow.log,
      `attack:join:tentative:${stateBeforeWindow.turnNumber}:${options.actingPlayerId}:${options.sourceInstanceId}`,
    ],
  };

  return queuePreDeclarationStackTriggers({
    state: stateAtWindow,
    windowKind: "attack",
    sourceInstanceId: options.sourceInstanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      getTriggeredEffectActionRegistrationLookupOrEmpty(
        options.getRegisteredTriggeredEffectActions
      ),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

export function joinActiveAttackAsAction(
  options: JoinActiveAttackOptions
): AttackDeclarationResult {
  const blockReason = getJoinActiveAttackBlockReason({
    ...options,
    state: withoutJoinCostGateCEsIfAlreadyPaid(options),
  });

  if (blockReason !== null) {
    throw new Error(
      `Join attack is not legal: source=${options.sourceInstanceId} reason=${blockReason}`
    );
  }

  const sourceCard = getBattleCardInstanceOrThrow(
    options.state,
    options.sourceInstanceId,
    "Unknown join-attack source card"
  );
  const sourceDefinition = getBattleCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  if (
    !options.attackExhaustCostAlreadyPaid &&
    !isAttackExhaustCostSourceSelectionValid({
      state: options.state,
      sourceCard,
      selectedCostSourceInstanceId: options.attackExhaustCostSourceInstanceId,
      selectedCostSourceInstanceIds: options.attackExhaustCostSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
    })
  ) {
    throw new Error(
      `Join attack declaration requires an exhaust cost source: source=${options.sourceInstanceId}`
    );
  }
  // battle_destroy_cost_gate (BSDB01-C09): mid_battle join (P3-115) はここで検証・支払う。
  // simultaneous_declaration join (同時アタック追加参加体) は battleDestroyCostAlreadyPaid:true
  // 固定で本チェックを常にスキップする (P3-105以前からの既知の残存ギャップ:
  // additionalSourceInstanceIds 側に参加体ごとの破壊コスト選択 UI/API がまだ無いため、
  // confirmAttackDeclarationAsAction の同時参加ループでは常に「支払い済み扱い」で通す。
  // 単独の join_active_attack 宣言 (本関数の attackExhaustCostAlreadyPaid 無し経路) は
  // 正しく検証・徴収する)。
  if (
    !options.battleDestroyCostAlreadyPaid &&
    !isBattleDestroyCostSourceSelectionValid({
      state: options.state,
      sourceCard,
      tags: [
        "battle_destroy_cost_gate_attack",
        "battle_destroy_cost_gate_both",
      ],
      selectedCostSourceInstanceId: options.battleDestroyCostSourceInstanceId,
      selectedCostSourceInstanceIds: options.battleDestroyCostSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
    })
  ) {
    throw new Error(
      `Join attack declaration requires a destroy cost source: source=${options.sourceInstanceId}`
    );
  }
  // 途中合流も1つの宣言。attack / exhaust / 即時効果で同じ発生を共有する。
  const simultaneousGroupId =
    options.simultaneousGroupId ?? createSimultaneousGroupId();
  let stateAfterJoinCost = options.state;
  if (!options.attackExhaustCostAlreadyPaid) {
    stateAfterJoinCost = payAttackExhaustCostSources({
      state: options.state,
      sourceInstanceId: options.sourceInstanceId,
      costSourceInstanceIds: getSelectedAttackExhaustCostSourceIds(options),
      getCardDefinitionById: options.getCardDefinitionById,
    });
    stateAfterJoinCost = collectAndQueueTriggerReactions({
      beforeState: options.state,
      afterState: stateAfterJoinCost,
      source: "action_resolution",
      chainId: requireTriggerChainId(options.state.activeAttack?.attackId),
      attackId: options.state.activeAttack?.attackId ?? null,
      simultaneousGroupId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      causedByPlayerId: options.actingPlayerId,
      causedBySourceInstanceId: null,
    });
  }
  if (!options.battleDestroyCostAlreadyPaid) {
    stateAfterJoinCost = payBattleDestroyCostSources({
      restriction: "attack",
      state: stateAfterJoinCost,
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: options.sourceInstanceId,
      costSourceInstanceIds: getSelectedBattleDestroyCostSourceIds(options),
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }
  const sourceBattleEntity = getOrCreateCombatBattleEntity({
    state: stateAfterJoinCost,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const hasExistingBattleEntity = stateAfterJoinCost.battleEntities.some(
    (battleEntity) => battleEntity.entityId === sourceBattleEntity.entityId
  );
  const nextBattleEntities = (
    hasExistingBattleEntity
      ? stateAfterJoinCost.battleEntities
      : [...stateAfterJoinCost.battleEntities, sourceBattleEntity]
  ).map((battleEntity) =>
    battleEntity.entityId === sourceBattleEntity.entityId
      ? {
          ...sourceBattleEntity,
          attackState: "attacking" as const,
        }
      : battleEntity
  );
  const activeAttack = stateAfterJoinCost.activeAttack;

  if (activeAttack === null) {
    throw new Error("Cannot join an attack when no active attack exists");
  }

  const nextParticipantEntityIds = [
    ...activeAttack.participantEntityIds,
    sourceBattleEntity.entityId,
  ];
  const nextActiveAttack: ActiveAttack = {
    ...activeAttack,
    participantEntityIds: nextParticipantEntityIds,
    groupMode: nextParticipantEntityIds.length >= 2 ? "simultaneous" : "single",
    blockAssignments: mergeBlockAssignments({
      existingAssignments: activeAttack.blockAssignments,
      participantEntityIds: nextParticipantEntityIds,
    }),
    symbolResolutionOrder: [
      ...activeAttack.symbolResolutionOrder,
      sourceBattleEntity.entityId,
    ],
  };

  let nextStateWithJoin: GameState = replaceCardInstances(
    {
      ...stateAfterJoinCost,
      battleEntities: nextBattleEntities,
      activeAttack: nextActiveAttack,
      log: [
        ...stateAfterJoinCost.log,
        `attack:join:${stateAfterJoinCost.turnNumber}:${options.actingPlayerId}:${options.sourceInstanceId}:${sourceBattleEntity.entityId}:${activeAttack.attackId}`,
        `attack:source-exhausted:${options.sourceInstanceId}`,
      ],
    },
    synchronizeBraveExhaustion(
      replaceCardInstances(
        {
          ...stateAfterJoinCost,
        },
        stateAfterJoinCost.cardInstances.map((card) =>
          card.instanceId === options.sourceInstanceId
            ? { ...card, exhaustState: "exhausted" as const }
            : card
        )
      ),
      options.getCardDefinitionById
    ).cardInstances
  );
  // battle_cost_gate (BSAZ01-C09): getJoinActiveAttackBlockReason (関数冒頭) が
  // isAttackPreventedByCE 経由で支払い可能性を確認済みのため無条件で実行する。
  const joinCostGateAmount = getRequiredBattleCostGateAmount(
    options.state,
    sourceCard,
    options.getCardDefinitionById,
    ["battle_cost_gate_attack", "battle_cost_gate_both"]
  );
  if (joinCostGateAmount > 0) {
    nextStateWithJoin = moveNormalCores(
      nextStateWithJoin,
      { kind: "card", instanceId: options.sourceInstanceId },
      { kind: "trash", playerId: sourceCard.controllerPlayerId },
      joinCostGateAmount,
      options.getCardDefinitionById
    );
    nextStateWithJoin.log.push(
      `attack:cost-gate-paid:${options.sourceInstanceId}:${joinCostGateAmount}`
    );
  }
  const joinMode = options.joinMode ?? "mid_battle";
  const queuedState = queueRegisteredBattleImmediateEffects({
    state: nextStateWithJoin,
    attackId: activeAttack.attackId,
    participantEntityId: sourceBattleEntity.entityId,
    actingPlayerId: options.actingPlayerId,
    sourceCard: getBattleCardInstanceOrThrow(
      nextStateWithJoin,
      options.sourceInstanceId,
      "Unknown join-attack source card after declaration"
    ),
    sourceDefinition,
    timing: "attack",
    getCardDefinitionById: options.getCardDefinitionById,
    // 同時アタック宣言では primary の『アタック時』と同じグループに束ねる (Q26329)
    simultaneousGroupId,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
  });

  // 同時アタック宣言 (P2-05) では group 全体で「アタックしたとき」観測は 1 回
  // (公式 Q26342)。primary 宣言側で観測済みのため、観測トリガーと
  // timing:"join" 即時効果はスキップする。ただし attackDeclarationLog
  // (attack_occurred ConditionClause の SSOT、「誰が物理的にアタック宣言したか」) は
  // 観測トリガーの重複排除とは別軸なので、同時参加体ごとに漏れなく記録する。
  if (joinMode === "simultaneous_declaration") {
    return {
      attackId: activeAttack.attackId,
      entityId: sourceBattleEntity.entityId,
      state: pushAttackDeclarationLog(queuedState, {
        declaringInstanceId: options.sourceInstanceId,
        declaringPlayerId: options.actingPlayerId,
        getCardDefinitionById: options.getCardDefinitionById,
      }),
    };
  }

  // P3-14 C-2: 途中合流アタックは「〜がアタックしたとき」game_event 観測の対象。
  // joinMode:"simultaneous_declaration" は上の分岐で return 済みなので、
  // ここ以降の観測トリガー / retrigger / timing:"join" は mid_battle 専用。
  const queuedStateWithDeclaration = queueBattleDeclarationTriggers({
    chainId: activeAttack.attackId,
    state: queuedState,
    kind: "attack",
    declaringInstanceId: options.sourceInstanceId,
    declaringPlayerId: options.actingPlayerId,
    simultaneousGroupId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  const joinAttackerCard = getBattleCardInstanceOrThrow(
    queuedStateWithDeclaration,
    options.sourceInstanceId,
    "Unknown join-attack source card for retrigger"
  );
  const queuedStateWithJoin = queueRegisteredBattleImmediateEffects({
    state: queuedStateWithDeclaration,
    attackId: activeAttack.attackId,
    participantEntityId: sourceBattleEntity.entityId,
    actingPlayerId: options.actingPlayerId,
    sourceCard: getBattleCardInstanceOrThrow(
      queuedStateWithDeclaration,
      options.sourceInstanceId,
      "Unknown join-attack source card after declaration"
    ),
    sourceDefinition,
    timing: "join",
    simultaneousGroupId,
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
  });

  const withTriggers = collectAndQueueTriggerReactions({
    beforeState: options.state,
    afterState: queuedStateWithJoin,
    source: "action_resolution",
    chainId: activeAttack.attackId,
    attackId: activeAttack.attackId,
    simultaneousGroupId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: sourceCard.controllerPlayerId,
    causedBySourceInstanceId: null,
  });

  return {
    attackId: activeAttack.attackId,
    entityId: sourceBattleEntity.entityId,
    state: executeMatchingRetriggers({
      ...options,
      state: withTriggers,
      event: "attack",
      triggerCard: joinAttackerCard,
      triggerCardDefinition: sourceDefinition,
    }),
  };
}

/**
 * P3-115: `useJoinActiveAttackAsAction` が開いた窓のクローズ後に呼ばれ、実際の合流
 * (参加者追加・疲労・トリガーキュー) を確定する。`confirmAttackDeclarationAsAction` と
 * 同様、窓中の応答で参加体が無効化されていれば (フィールド離脱/疲労済み等) 合流を
 * キャンセルする。
 */
export function confirmJoinActiveAttackDeclarationAsAction(
  win: PreDeclarationStackWindow,
  state: GameState,
  options: Pick<
    UseJoinActiveAttackAsActionOptions,
    "getCardDefinitionById" | "getRegisteredBattleImmediateEffectActions"
  > &
    Partial<
      Pick<
        UseJoinActiveAttackAsActionOptions,
        "getRegisteredTriggeredEffectActions" | "getRegisteredBurstActions"
      >
    >
): AttackDeclarationResult {
  const stateAfterWindow: GameState = {
    ...state,
    preDeclarationStackWindow: null,
    window: win.previousWindow,
  };

  // 支払い済みゲート (exhaust/destroy) は候補が失われて誤って unaffordable と
  // 再判定されうるため、legality-changed 再チェックからは除外する
  // (confirmAttackDeclarationAsAction/confirmBlockDeclarationAsAction と同じ回避パターン)。
  const cancelReason = getJoinActiveAttackBlockReason({
    state: withoutJoinCostGateCEsIfAlreadyPaid({
      state: stateAfterWindow,
      attackExhaustCostAlreadyPaid: true,
      battleDestroyCostAlreadyPaid: true,
    }),
    actingPlayerId: win.actingPlayerId,
    sourceInstanceId: win.sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });

  if (cancelReason !== null) {
    stateAfterWindow.log.push(
      `attack:join-cancelled:${win.sourceInstanceId}:${cancelReason}`
    );
    return {
      attackId: state.activeAttack?.attackId ?? "",
      entityId: "",
      state: stateAfterWindow,
    };
  }

  return joinActiveAttackAsAction({
    state: stateAfterWindow,
    actingPlayerId: win.actingPlayerId,
    sourceInstanceId: win.sourceInstanceId,
    ...(win.attackExhaustCostSourceInstanceId !== undefined
      ? {
          attackExhaustCostSourceInstanceId:
            win.attackExhaustCostSourceInstanceId,
        }
      : {}),
    ...(win.attackExhaustCostSourceInstanceIds !== undefined
      ? {
          attackExhaustCostSourceInstanceIds:
            win.attackExhaustCostSourceInstanceIds,
        }
      : {}),
    ...(win.battleDestroyCostSourceInstanceId !== undefined
      ? {
          battleDestroyCostSourceInstanceId:
            win.battleDestroyCostSourceInstanceId,
        }
      : {}),
    ...(win.battleDestroyCostSourceInstanceIds !== undefined
      ? {
          battleDestroyCostSourceInstanceIds:
            win.battleDestroyCostSourceInstanceIds,
        }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    joinMode: "mid_battle",
    attackExhaustCostAlreadyPaid: true,
    battleDestroyCostAlreadyPaid: true,
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
    ...(options.getRegisteredBurstActions
      ? { getRegisteredBurstActions: options.getRegisteredBurstActions }
      : {}),
  });
}

export function useBlockAsAction(options: UseBlockAsActionOptions): GameState {
  const blockReason = getBlockDeclarationBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Block declaration is not legal: source=${options.sourceInstanceId} participant=${options.participantEntityId} reason=${blockReason}`
    );
  }

  // battle_destroy_cost_gate (BSDB01-C09): 破壊コスト源の選択検証+支払い。
  // アタック側 (useAttackAsAction) と同じく宣言時 (pre_declaration_stack window を
  // 開く前) に破壊する。
  const sourceCardForDestroyCost = getCardById(
    options.state,
    options.sourceInstanceId
  );
  if (
    sourceCardForDestroyCost !== undefined &&
    !isBattleDestroyCostSourceSelectionValid({
      state: options.state,
      sourceCard: sourceCardForDestroyCost,
      tags: ["battle_destroy_cost_gate_block", "battle_destroy_cost_gate_both"],
      selectedCostSourceInstanceId: options.battleDestroyCostSourceInstanceId,
      selectedCostSourceInstanceIds: options.battleDestroyCostSourceInstanceIds,
      getCardDefinitionById: options.getCardDefinitionById,
      excludedInstanceIds: new Set([options.sourceInstanceId]),
    })
  ) {
    throw new Error(
      `Block declaration requires a destroy cost source: source=${options.sourceInstanceId}`
    );
  }
  const stateAfterDestroyCost = payBattleDestroyCostSources({
    restriction: "block",
    state: options.state,
    actingPlayerId: options.actingPlayerId,
    sourceInstanceId: options.sourceInstanceId,
    costSourceInstanceIds: getSelectedBattleDestroyCostSourceIds(options),
    getCardDefinitionById: options.getCardDefinitionById,
  });

  const opponentPlayerId = getPreDeclarationStackOpponentId(
    stateAfterDestroyCost,
    options.actingPlayerId
  );

  const stateAtWindow: GameState = {
    ...stateAfterDestroyCost,
    window: "pre_declaration_stack",
    preDeclarationStackWindow: {
      kind: "block",
      actingPlayerId: options.actingPlayerId,
      sourceInstanceId: options.sourceInstanceId,
      participantEntityId: options.participantEntityId,
      ...(options.battleDestroyCostSourceInstanceId !== undefined
        ? {
            battleDestroyCostSourceInstanceId:
              options.battleDestroyCostSourceInstanceId,
          }
        : {}),
      ...(options.battleDestroyCostSourceInstanceIds !== undefined
        ? {
            battleDestroyCostSourceInstanceIds:
              options.battleDestroyCostSourceInstanceIds,
          }
        : {}),
      priorityPlayerId: opponentPlayerId,
      consecutivePassCount: 0,
      previousWindow: options.state.window,
      stackResponseSourcePlayerId: options.actingPlayerId,
      pendingStackAction: null,
    },
    log: [
      ...stateAfterDestroyCost.log,
      `block:tentative:${stateAfterDestroyCost.turnNumber}:${options.actingPlayerId}:${options.sourceInstanceId}:${options.participantEntityId}`,
    ],
  };

  return queuePreDeclarationStackTriggers({
    state: stateAtWindow,
    windowKind: "block",
    sourceInstanceId: options.sourceInstanceId,
    actingPlayerId: options.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      getTriggeredEffectActionRegistrationLookupOrEmpty(
        options.getRegisteredTriggeredEffectActions
      ),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

export function confirmBlockDeclarationAsAction(
  win: PreDeclarationStackWindow,
  state: GameState,
  // P3-14 C-2: 「〜がブロックしたとき」game_event 観測トリガーのキューイングに
  // triggered/burst lookup を使う (未指定経路は空 lookup fallback)。
  options: Pick<
    UseBlockAsActionOptions,
    "getCardDefinitionById" | "getRegisteredBattleImmediateEffectActions"
  > &
    Partial<
      Pick<
        UseBlockAsActionOptions,
        "getRegisteredTriggeredEffectActions" | "getRegisteredBurstActions"
      >
    >
): BlockDeclarationResult {
  const activeAttack = state.activeAttack;
  const participantEntityId = win.participantEntityId;
  const sourceCard = getCardById(state, win.sourceInstanceId);
  const participantAssignment = activeAttack?.blockAssignments.find(
    (a) => a.participantEntityId === participantEntityId
  );
  if (win.kind === "forced_block") {
    const sourceDefinition =
      sourceCard !== undefined
        ? getBattleCardDefinitionOrThrow(
            sourceCard.definitionId,
            options.getCardDefinitionById
          )
        : null;
    // ENGINE-attack-declaration-replacement-primitive: 指定アタックの forced_block
    // (target.kind==="battle_entity" 側が強制ブロック) とは別軸の、汎用 forced blocker
    // (activeAttack.forcedBlockerInstanceId、通常アタックでも成立) を同じ窓で扱う。
    const isDesignatedAttackForcedBlock =
      activeAttack !== null &&
      activeAttack.target.kind === "battle_entity" &&
      activeAttack.designatedTargetInstanceId === win.sourceInstanceId;
    const isCustomForcedBlock =
      activeAttack !== null &&
      activeAttack.forcedBlockerInstanceId === win.sourceInstanceId;

    const forcedBlockAttackerCard =
      activeAttack !== null
        ? getDesignatedAttackAttackerCard(state, activeAttack)
        : undefined;

    const forcedBlockStillValid =
      activeAttack !== null &&
      participantEntityId !== undefined &&
      sourceCard !== undefined &&
      sourceDefinition !== null &&
      sourceCard.controllerPlayerId === win.actingPlayerId &&
      sourceCard.zone === "field" &&
      sourceCard.pendingLeaveKind === null &&
      sourceCard.attachedToInstanceId === null &&
      isBattleCapableCategory(sourceDefinition, sourceCard, state) &&
      isDesignatedAttackTargetLegal(
        state,
        sourceCard,
        options.getCardDefinitionById,
        forcedBlockAttackerCard
      ) &&
      (isDesignatedAttackForcedBlock || isCustomForcedBlock) &&
      activeAttack.participantEntityIds.includes(participantEntityId) &&
      participantAssignment !== undefined &&
      participantAssignment.blockedByEntityIds.length === 0;

    if (!forcedBlockStillValid) {
      const fallbackPlayerId =
        sourceCard?.controllerPlayerId ??
        state.playerOrder.find((id) => id !== state.activePlayerId) ??
        null;

      if (!activeAttack || !participantEntityId || !fallbackPlayerId) {
        state.log.push(
          `block:forced-cancelled:${win.sourceInstanceId}:target-no-longer-valid-after-forced-block-stack`
        );
        return {
          attackId: activeAttack?.attackId ?? "",
          blockerEntityId: "",
          participantEntityId: participantEntityId ?? "",
          state: {
            ...state,
            preDeclarationStackWindow: null,
            window: win.previousWindow,
          },
        };
      }

      const nextActiveAttack: ActiveAttack = {
        ...activeAttack,
        target: { kind: "player", playerId: fallbackPlayerId },
        blockAssignments: activeAttack.participantEntityIds.map(
          (currentParticipantEntityId) => ({
            participantEntityId: currentParticipantEntityId,
            blockedByEntityIds: [],
          })
        ),
        flashBeforeBlockCompleted: false,
      };
      delete nextActiveAttack.designatedTargetInstanceId;
      delete nextActiveAttack.forcedBlockerInstanceId;
      const designatedTargetEntityId =
        activeAttack.target.kind === "battle_entity"
          ? activeAttack.target.entityId
          : null;

      state.log.push(
        isCustomForcedBlock
          ? `attack:forced-blocker-cancelled:${win.sourceInstanceId}:blocker-no-longer-valid-after-forced-block-stack`
          : `attack:spirit-target-cancelled:${win.sourceInstanceId}:target-no-longer-valid-after-forced-block-stack`
      );
      return {
        attackId: activeAttack.attackId,
        blockerEntityId: "",
        participantEntityId,
        state: {
          ...state,
          window: win.previousWindow,
          preDeclarationStackWindow: null,
          battleEntities: state.battleEntities.map((battleEntity) =>
            battleEntity.entityId === designatedTargetEntityId
              ? { ...battleEntity, attackState: "idle" as const }
              : battleEntity
          ),
          activeAttack: nextActiveAttack,
        },
      };
    }

    const blockerBattleEntity = getOrCreateCombatBattleEntity({
      state,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    });
    const hasExistingBattleEntity = state.battleEntities.some(
      (battleEntity) => battleEntity.entityId === blockerBattleEntity.entityId
    );
    const nextBattleEntities = (
      hasExistingBattleEntity
        ? state.battleEntities
        : [...state.battleEntities, blockerBattleEntity]
    ).map((battleEntity) =>
      battleEntity.entityId === blockerBattleEntity.entityId
        ? { ...blockerBattleEntity, attackState: "blocking" as const }
        : battleEntity
    );
    const nextActiveAttack: ActiveAttack = {
      ...activeAttack,
      blockAssignments: activeAttack.blockAssignments.map((assignment) =>
        assignment.participantEntityId === participantEntityId
          ? {
              ...assignment,
              blockedByEntityIds: [
                ...assignment.blockedByEntityIds,
                blockerBattleEntity.entityId,
              ],
            }
          : assignment
      ),
      flashBeforeBlockCompleted: true,
    };
    state.log.push(
      isCustomForcedBlock
        ? `attack:forced-blocker:${win.sourceInstanceId}:${blockerBattleEntity.entityId}`
        : `attack:spirit-target:${win.sourceInstanceId}:${blockerBattleEntity.entityId}`,
      `attack:flash-before-block-skipped`,
      `block:forced:${blockerBattleEntity.entityId}:${win.sourceInstanceId}`
    );
    const nextStateWithBlock: GameState = {
      ...state,
      window: "declare_block",
      preDeclarationStackWindow: null,
      battleEntities: nextBattleEntities,
      activeAttack: nextActiveAttack,
    };
    const stateWithBlockImmediateEffects =
      queueRegisteredBattleImmediateEffects({
        state: recomputeAndRebuildBattleStateContinuousEffects(
          nextStateWithBlock,
          options.getCardDefinitionById
        ),
        attackId: activeAttack.attackId,
        participantEntityId: blockerBattleEntity.entityId,
        actingPlayerId: win.actingPlayerId,
        sourceCard: getBattleCardInstanceOrThrow(
          nextStateWithBlock,
          win.sourceInstanceId,
          "Unknown forced block source card after confirmation"
        ),
        sourceDefinition,
        timing: "block",
        getCardDefinitionById: options.getCardDefinitionById,
        ...(options.getRegisteredBattleImmediateEffectActions
          ? {
              getRegisteredBattleImmediateEffectActions:
                options.getRegisteredBattleImmediateEffectActions,
            }
          : {}),
      });
    // P3-14 C-2: 強制ブロックも「〜がブロックしたとき」game_event 観測の対象。
    const stateWithBlockDeclaration = queueBattleDeclarationTriggers({
      chainId: activeAttack.attackId,
      state: stateWithBlockImmediateEffects,
      kind: "block",
      declaringInstanceId: win.sourceInstanceId,
      declaringPlayerId: win.actingPlayerId,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions ?? (() => []),
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    });

    const queuedState = queueRegisteredBattleImmediateEffects({
      state: stateWithBlockDeclaration,
      attackId: activeAttack.attackId,
      participantEntityId: blockerBattleEntity.entityId,
      actingPlayerId: win.actingPlayerId,
      sourceCard: getBattleCardInstanceOrThrow(
        stateWithBlockDeclaration,
        win.sourceInstanceId,
        "Unknown forced battle source card after confirmation"
      ),
      sourceDefinition,
      timing: "battle",
      getCardDefinitionById: options.getCardDefinitionById,
      ...(options.getRegisteredBattleImmediateEffectActions
        ? {
            getRegisteredBattleImmediateEffectActions:
              options.getRegisteredBattleImmediateEffectActions,
          }
        : {}),
    });

    return {
      attackId: activeAttack.attackId,
      blockerEntityId: blockerBattleEntity.entityId,
      participantEntityId,
      state: queuedState,
    };
  }

  // キャンセル: activeAttack がない、participantEntityId がない、ブロッカーが field にいない、または participant が既にブロックされている
  if (
    !activeAttack ||
    !participantEntityId ||
    !sourceCard ||
    sourceCard.zone !== "field" ||
    !participantAssignment ||
    participantAssignment.blockedByEntityIds.length >=
      getRequiredBlockerCountForParticipant(state, participantEntityId)
  ) {
    state.log.push(
      `block:cancelled:${win.sourceInstanceId}:blocker-no-longer-valid`
    );
    const cancelledState: GameState = {
      ...state,
      preDeclarationStackWindow: null,
      window: win.previousWindow,
    };

    return {
      attackId: activeAttack?.attackId ?? "",
      blockerEntityId: "",
      participantEntityId: participantEntityId ?? "",
      state: cancelledState,
    };
  }

  const stateForBlockLegalityBase: GameState = {
    ...state,
    window: win.previousWindow,
  };
  const stateForBlockLegality =
    getSelectedBattleDestroyCostSourceIds(win).length > 0
      ? withoutBattleDestroyCostGateCEs(stateForBlockLegalityBase)
      : stateForBlockLegalityBase;
  const blockReasonAfterStack = getBlockDeclarationBlockReason({
    state: stateForBlockLegality,
    actingPlayerId: win.actingPlayerId,
    sourceInstanceId: win.sourceInstanceId,
    participantEntityId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (blockReasonAfterStack !== null) {
    state.log.push(
      `block:cancelled:${win.sourceInstanceId}:legality-changed:${blockReasonAfterStack}`
    );
    const cancelledState: GameState = {
      ...state,
      preDeclarationStackWindow: null,
      window: win.previousWindow,
    };

    return {
      attackId: activeAttack.attackId,
      blockerEntityId: "",
      participantEntityId,
      state: cancelledState,
    };
  }

  const sourceDefinition = getBattleCardDefinitionOrThrow(
    sourceCard.definitionId,
    options.getCardDefinitionById
  );
  const blockerBattleEntity = getOrCreateCombatBattleEntity({
    state,
    sourceCard,
    sourceDefinition,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const hasExistingBattleEntity = state.battleEntities.some(
    (battleEntity) => battleEntity.entityId === blockerBattleEntity.entityId
  );
  const nextBattleEntities = (
    hasExistingBattleEntity
      ? state.battleEntities
      : [...state.battleEntities, blockerBattleEntity]
  ).map((battleEntity) =>
    battleEntity.entityId === blockerBattleEntity.entityId
      ? { ...blockerBattleEntity, attackState: "blocking" as const }
      : battleEntity
  );
  const nextActiveAttack: ActiveAttack = {
    ...activeAttack,
    blockAssignments: activeAttack.blockAssignments.map((assignment) =>
      assignment.participantEntityId === participantEntityId
        ? {
            ...assignment,
            blockedByEntityIds: [
              ...assignment.blockedByEntityIds,
              blockerBattleEntity.entityId,
            ],
          }
        : assignment
    ),
  };
  state.log.push(
    `block:declare:${state.turnNumber}:${win.actingPlayerId}:${win.sourceInstanceId}:${blockerBattleEntity.entityId}:${participantEntityId}:${activeAttack.attackId}`,
    `block:source-exhausted:${win.sourceInstanceId}`
  );
  // BSTH09-C03「ターンに1回、疲労せずにアタック/ブロックできる」: 回復状態からの
  // ブロック宣言時のみ、合体スピリットの疲労遷移をスキップし
  // 消費を記録する (アタック側と共有の同一ターン予算)。
  const usesTaplessBattleDeclareGrantForBlock =
    sourceCard.exhaustState === "recovered" &&
    hasUnusedTaplessBattleDeclareGrant(state, win.sourceInstanceId);
  let nextStateWithBlock: GameState = replaceCardInstances(
    {
      ...state,
      window: "declare_block",
      preDeclarationStackWindow: null,
      battleEntities: nextBattleEntities,
      activeAttack: nextActiveAttack,
      ...(usesTaplessBattleDeclareGrantForBlock
        ? {
            usedTaplessBattleDeclareInstanceIdsThisTurn: [
              ...state.usedTaplessBattleDeclareInstanceIdsThisTurn,
              win.sourceInstanceId,
            ],
          }
        : {}),
    },
    synchronizeBraveExhaustion(
      replaceCardInstances(
        {
          ...state,
        },
        state.cardInstances.map((card) =>
          card.instanceId === win.sourceInstanceId &&
          !usesTaplessBattleDeclareGrantForBlock &&
          card.exhaustState === "recovered"
            ? { ...card, exhaustState: "exhausted" as const }
            : card
        )
      ),
      options.getCardDefinitionById
    ).cardInstances
  );
  // battle_cost_gate (BSAZ01-C09): ブロック宣言が要求する対象自身のコアからのコスト支払い。
  // 直前の getBlockDeclarationBlockReason 再チェック (legality-changed) と同じ
  // 防止不可 bypass を適用したうえで、残る支払い義務だけを実行する。
  const ignoreBlockPreventFromPlayerId =
    getIgnoredBlockPreventPlayerIdForUnpreventableRequireBlock({
      state: stateForBlockLegality,
      participantEntityId,
      sourceCard,
      sourceDefinition,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  const blockCostGateAmount = getRequiredBattleCostGateAmount(
    stateForBlockLegality,
    sourceCard,
    options.getCardDefinitionById,
    ["battle_cost_gate_block", "battle_cost_gate_both"],
    ignoreBlockPreventFromPlayerId !== undefined
      ? { ignoreEffectsFromPlayerId: ignoreBlockPreventFromPlayerId }
      : undefined
  );
  if (blockCostGateAmount > 0) {
    nextStateWithBlock = moveNormalCores(
      nextStateWithBlock,
      { kind: "card", instanceId: win.sourceInstanceId },
      { kind: "trash", playerId: sourceCard.controllerPlayerId },
      blockCostGateAmount,
      options.getCardDefinitionById
    );
    nextStateWithBlock.log.push(
      `block:cost-gate-paid:${win.sourceInstanceId}:${blockCostGateAmount}`
    );
  }
  const stateWithBlockImmediateEffects = queueRegisteredBattleImmediateEffects({
    state: recomputeAndRebuildBattleStateContinuousEffects(
      nextStateWithBlock,
      options.getCardDefinitionById
    ),
    attackId: activeAttack.attackId,
    participantEntityId: blockerBattleEntity.entityId,
    actingPlayerId: win.actingPlayerId,
    sourceCard: getBattleCardInstanceOrThrow(
      nextStateWithBlock,
      win.sourceInstanceId,
      "Unknown block source card after confirmation"
    ),
    sourceDefinition,
    timing: "block",
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
  });
  // P3-14 C-2: 「〜がブロックしたとき」game_event 観測トリガー (他カード上のリスナー)。
  const stateWithBlockDeclaration = queueBattleDeclarationTriggers({
    chainId: activeAttack.attackId,
    state: stateWithBlockImmediateEffects,
    kind: "block",
    declaringInstanceId: win.sourceInstanceId,
    declaringPlayerId: win.actingPlayerId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });

  const queuedState = queueRegisteredBattleImmediateEffects({
    state: stateWithBlockDeclaration,
    attackId: activeAttack.attackId,
    participantEntityId: blockerBattleEntity.entityId,
    actingPlayerId: win.actingPlayerId,
    sourceCard: getBattleCardInstanceOrThrow(
      stateWithBlockDeclaration,
      win.sourceInstanceId,
      "Unknown block source card after confirmation"
    ),
    sourceDefinition,
    timing: "battle",
    getCardDefinitionById: options.getCardDefinitionById,
    ...(options.getRegisteredBattleImmediateEffectActions
      ? {
          getRegisteredBattleImmediateEffectActions:
            options.getRegisteredBattleImmediateEffectActions,
        }
      : {}),
  });

  return {
    attackId: activeAttack.attackId,
    blockerEntityId: blockerBattleEntity.entityId,
    participantEntityId,
    state: queuedState,
  };
}

/**
 * P3-55 Phase B: battle resolution group 作成 + BP 比較 + ライフ減少 +
 * entity 破壊 + 二次イベント listener pending の生成までを 1 回で完了させる helper。
 *
 * `decline_block` apply (防御側「ブロックしない」) と `pass_battle_flash`
 * (after_block close) からの auto-chain で共通利用される。
 * 呼び出し側で前提条件 (フラッシュ完了 / battle resolution 未生成 など) は確認済みの
 * 前提なので、本 helper は内部状態の検証だけ行う。
 */
export function executeBattleResolution(
  options: ExecuteBattleResolutionOptions
): ExecuteBattleResolutionResult {
  const activeAttack = options.state.activeAttack;

  if (activeAttack === null) {
    throw new Error("Cannot start battle resolution without an active attack");
  }

  if (options.state.battleResolutionGroup !== null) {
    throw new Error(
      "Cannot start battle resolution while another resolution is already active"
    );
  }

  const battleResolutionGroup = createBattleResolutionGroup(options.state);
  const stateBeforeResolution: GameState = {
    ...options.state,
    window: "battle_resolution",
    battleResolutionGroup,
    log: [
      ...options.state.log,
      `battle:resolution:start:${activeAttack.attackId}:${battleResolutionGroup.participantSnapshots
        .map((snapshot) => snapshot.entityId)
        .join(",")}`,
    ],
  };

  const chainId = createBattleResolutionChainId(
    stateBeforeResolution,
    battleResolutionGroup.attackId
  );
  let currentState: GameState = {
    ...stateBeforeResolution,
    log: [
      ...stateBeforeResolution.log,
      `battle:resolution:resolve:start:${battleResolutionGroup.attackId}`,
    ],
  };
  const unblockedLifeDamage = getUnblockedLifeDamage(
    currentState,
    options.getCardDefinitionById
  );

  let appliedLifeDamage = 0;
  if (
    unblockedLifeDamage &&
    (unblockedLifeDamage.totalLifeDamage > 0 ||
      unblockedLifeDamage.bypassedLifeDamage > 0)
  ) {
    const targetPlayerBefore = currentState.players.find(
      (p) => p.id === unblockedLifeDamage.targetPlayerId
    );
    const lifeBefore = targetPlayerBefore
      ? getPlayerLifeCoreCount(targetPlayerBefore)
      : 0;
    if (unblockedLifeDamage.totalLifeDamage > 0) {
      currentState = resolveLifeDamage(
        currentState,
        unblockedLifeDamage.targetPlayerId,
        unblockedLifeDamage.totalLifeDamage,
        [],
        { cause: "battle", actingPlayerId: currentState.activePlayerId },
        options.getCardDefinitionById
      );
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `battle:resolution:life-damage:${battleResolutionGroup.attackId}:${unblockedLifeDamage.targetPlayerId}:${unblockedLifeDamage.totalLifeDamage}`,
        ],
      };
    }
    // P3-125 Step3: life_damage_source_prevention_immunity 一致分は、防御側の
    // どの life_damage_interception CE でも防げない (forcedUnpreventable:true)。
    if (unblockedLifeDamage.bypassedLifeDamage > 0) {
      currentState = resolveLifeDamage(
        currentState,
        unblockedLifeDamage.targetPlayerId,
        unblockedLifeDamage.bypassedLifeDamage,
        [],
        {
          cause: "battle",
          actingPlayerId: currentState.activePlayerId,
          forcedUnpreventable: true,
        },
        options.getCardDefinitionById
      );
      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `battle:resolution:life-damage:bypassed:${battleResolutionGroup.attackId}:${unblockedLifeDamage.targetPlayerId}:${unblockedLifeDamage.bypassedLifeDamage}`,
        ],
      };
    }
    const targetPlayerAfter = currentState.players.find(
      (p) => p.id === unblockedLifeDamage.targetPlayerId
    );
    const lifeAfter = targetPlayerAfter
      ? getPlayerLifeCoreCount(targetPlayerAfter)
      : lifeBefore;
    appliedLifeDamage = Math.max(0, lifeBefore - lifeAfter);
  }
  // BP 閾値 gate cap (BSTH08.5-C21) の累積カウンタは、ダメージが 0 にクランプされた
  // 場合でも「閾値一致アタッカーが当該ターンに減らした分」を計上する（実際に減った分のみ）。
  if (unblockedLifeDamage && unblockedLifeDamage.bpThresholdCapConsumed > 0) {
    const prev = currentState.bpThresholdCappedLifeReductionThisTurn ?? {};
    currentState = {
      ...currentState,
      bpThresholdCappedLifeReductionThisTurn: {
        ...prev,
        [unblockedLifeDamage.targetPlayerId]:
          (prev[unblockedLifeDamage.targetPlayerId] ?? 0) +
          unblockedLifeDamage.bpThresholdCapConsumed,
      },
    };
  }
  if (unblockedLifeDamage && unblockedLifeDamage.turnCapConsumed > 0) {
    const turnCapAppliedDamage = Math.min(
      unblockedLifeDamage.turnCapAppliedDamage,
      appliedLifeDamage
    );
    const commitFullTurnCapBuckets =
      turnCapAppliedDamage === unblockedLifeDamage.turnCapAppliedDamage;
    let remainingAppliedDamage = turnCapAppliedDamage;
    let nextFiltered = currentState.filteredLifeReductionCappedThisTurn;
    for (const entry of unblockedLifeDamage.turnCapConsumptions) {
      if (remainingAppliedDamage <= 0) break;
      const consumed = commitFullTurnCapBuckets
        ? entry.amount
        : Math.min(entry.amount, remainingAppliedDamage);
      if (consumed <= 0) continue;
      if (!commitFullTurnCapBuckets) {
        remainingAppliedDamage -= consumed;
      }
      const prev = nextFiltered ?? {};
      const key = filteredTurnCapKey(entry.targetPlayerId, entry.effectId);
      nextFiltered = {
        ...prev,
        [key]: (prev[key] ?? 0) + consumed,
      };
    }
    if (
      nextFiltered !== undefined &&
      nextFiltered !== currentState.filteredLifeReductionCappedThisTurn
    ) {
      currentState = {
        ...currentState,
        filteredLifeReductionCappedThisTurn: nextFiltered,
      };
    }
  }

  const destroyedEntityIds =
    getDestroyedEntityIdsFromBattleResolution(currentState);

  for (const participantSnapshot of battleResolutionGroup.participantSnapshots) {
    if (!hasFieldBattleResolutionMember(currentState, participantSnapshot)) {
      continue;
    }
    // P2-05 Phase 5: 複数ブロッカー時は各ブロッカーと個別に 1vs1 で比較する
    // (合算比較ではない、10_rules/05b §複数体ブロック強制)。
    for (const blockerSnapshot of participantSnapshot.blockedBy) {
      if (!hasFieldBattleResolutionMember(currentState, blockerSnapshot)) {
        continue;
      }
      const outcome =
        participantSnapshot.resolvedBp > blockerSnapshot.resolvedBp
          ? "blocker_destroyed"
          : participantSnapshot.resolvedBp < blockerSnapshot.resolvedBp
            ? "attacker_destroyed"
            : "both_destroyed";

      currentState = {
        ...currentState,
        log: [
          ...currentState.log,
          `battle:resolution:bp-compare:${battleResolutionGroup.attackId}:${participantSnapshot.entityId}:${blockerSnapshot.entityId}:${participantSnapshot.resolvedBp}:${blockerSnapshot.resolvedBp}:${outcome}`,
        ],
      };
    }
  }

  return finalizeBattleResolutionAfterCombat(options, {
    stateBeforeResolution,
    currentState,
    battleResolutionGroup,
    chainId,
    destroyedEntityIds,
    totalLifeDamage: unblockedLifeDamage?.totalLifeDamage ?? 0,
    appliedLifeDamage,
    participantOwnSymbols:
      unblockedLifeDamage?.participantOwnSymbols ?? new Map(),
  });
}

/**
 * P3-55 Phase B / engine-single-battle-end: BP比較・ライフダメージ確定後 (通常の
 * `executeBattleResolution`) と、BP比較・ライフダメージを一切行わず即終了する
 * `executeEndSingleBattle` の両方から共有される「バトル終了」共通テール。
 * destroy 確定 → battle_resolution 由来トリガー収集 → pending leave flush →
 * battle_end 誘発 (card_event/game_event) → battleEntities reset →
 * battle_end deferred 発火 → scope:"battle" CE 失効 → ターン内バトル数計上・
 * 初回バトル後強制アタックステップ終了、までを 1 か所にまとめる (SSOT)。
 */
function finalizeBattleResolutionAfterCombat(
  options: ExecuteBattleResolutionOptions,
  params: {
    stateBeforeResolution: GameState;
    currentState: GameState;
    battleResolutionGroup: BattleResolutionGroup;
    chainId: string;
    destroyedEntityIds: readonly string[];
    totalLifeDamage: number;
    /**
     * このバトル解決で対象プレイヤーへ実際に適用されたライフ減少量
     * (`Math.max(0, lifeBefore - lifeAfter)`、interception/cap 適用後)。
     * `ConditionClause.kind:"battle_life_reduced"` (BSTH05-X04 型) の判定に使う。
     * `executeEndSingleBattle` (ただちにバトル終了、BP比較/ライフダメージ計算を行わない)
     * からは常に 0。
     */
    appliedLifeDamage: number;
    /**
     * `getUnblockedLifeDamage` が算出した参加体ごとの個別 cap/免疫適用後 symbols 数
     * (SSOT、関数コメント参照)。`fireBattleEndDeferrals` の `battle_life_reduced` 判定に
     * そのまま渡す。`executeEndSingleBattle` からは空 Map。
     */
    participantOwnSymbols: ReadonlyMap<string, number>;
  }
): ExecuteBattleResolutionResult {
  const {
    stateBeforeResolution,
    battleResolutionGroup,
    chainId,
    destroyedEntityIds,
    totalLifeDamage,
    appliedLifeDamage,
    participantOwnSymbols,
  } = params;
  let currentState = params.currentState;

  currentState = queueBattleResolutionDestroys({
    state: currentState,
    chainId,
    destroyedEntityIds,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  const battleResolutionTriggerGroupId = createSimultaneousGroupId();
  currentState = queueBattleDestroyOpponentOnlyTriggers({
    state: currentState,
    battleResolutionGroup,
    chainId,
    simultaneousGroupId: battleResolutionTriggerGroupId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  // ENGINE-battle-reduce-life-source-instance: 単一 attacker (合体/同時アタックでない、
  // participantSnapshots が単一 かつ その memberInstanceIds も単一) のときだけ、そのカードを
  // reduce_life イベントの causedBySourceInstanceId として thread する。「自分のスピリットの
  // アタックによって相手のライフを減らしたとき」型 triggerFilter/triggerSourceFilter による
  // 系統/色等の絞り込みを可能にする (BSLH01-C09)。複数同時アタック/合体で単一カードに
  // 一意特定できない場合は fail-close (undefined のまま、cause の opponent_effect/self_effect
  // 判定には影響しない)。
  const [soleParticipantSnapshot, ...restParticipantSnapshots] =
    battleResolutionGroup.participantSnapshots;
  const [soleAttackerMemberInstanceId, ...restAttackerMemberInstanceIds] =
    soleParticipantSnapshot?.memberInstanceIds ?? [];
  const singleAttackerInstanceId =
    soleParticipantSnapshot !== undefined &&
    restParticipantSnapshots.length === 0 &&
    soleAttackerMemberInstanceId !== undefined &&
    restAttackerMemberInstanceIds.length === 0
      ? soleAttackerMemberInstanceId
      : undefined;
  currentState = collectAndQueueTriggerReactions({
    beforeState: stateBeforeResolution,
    afterState: currentState,
    source: "battle_resolution",
    chainId,
    attackId: battleResolutionGroup.attackId,
    simultaneousGroupId: battleResolutionTriggerGroupId,
    // reduce_life の cause 導出 (trigger-system.ts collectTriggerEventsFromStateDelta) 用。
    // このブロックの unblockedLifeDamage はアタッカー (= activePlayerId、この解決窓中は
    // 不変) が防御側プレイヤーへ与えるバトルダメージのみなので、常にアタッカーで正しい
    // (BSTH02.7-TX01(A) 等「相手によって自分のライフが減ったとき」の battle 分岐用)。
    causedByPlayerId: stateBeforeResolution.activePlayerId,
    ...(singleAttackerInstanceId !== undefined
      ? { causedBySourceInstanceId: singleAttackerInstanceId }
      : {}),
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  const destroyedRecords = [
    ...(currentState.activeAttack?.battleDestroyedRecords ?? []),
  ];
  currentState = flushPendingLeavesAndQueueReactions({
    beforeFlushState: currentState,
    chainId,
    source: "battle_resolution",
    simultaneousGroupId: battleResolutionTriggerGroupId,
    attackId: battleResolutionGroup.attackId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
  const participantInstanceIds = new Set<string>();
  const blockSideInstanceIds = new Set<string>();
  for (const snapshot of battleResolutionGroup.participantSnapshots) {
    for (const memberId of snapshot.memberInstanceIds) {
      participantInstanceIds.add(memberId);
    }
    for (const blocker of snapshot.blockedBy) {
      for (const memberId of blocker.memberInstanceIds) {
        participantInstanceIds.add(memberId);
        blockSideInstanceIds.add(memberId);
      }
    }
  }
  const participantSnapshots = battleResolutionGroup.participantSnapshots;
  if (
    hasPendingBattleEndEntryReactions(
      currentState,
      options.getCardDefinitionById,
      options.getRegisteredTriggeredEffectActions,
      options.getRegisteredBurstActions
    )
  ) {
    const pendingImmediateBattleEnd: PendingImmediateBattleEnd = {
      attackId: battleResolutionGroup.attackId,
      participantInstanceIds: Array.from(participantInstanceIds),
      blockSideInstanceIds: Array.from(blockSideInstanceIds),
      participantSnapshots,
      appliedLifeDamage,
      participantOwnSymbols: Array.from(
        participantOwnSymbols,
        ([entityId, ownSymbols]) => ({ entityId, ownSymbols })
      ),
      ...(destroyedRecords.length > 0 ? { destroyedRecords } : {}),
    };
    currentState = resetBattleEntitiesAfterResolution(
      currentState,
      battleResolutionGroup.attackId,
      options.getCardDefinitionById
    );
    currentState = {
      ...currentState,
      pendingImmediateBattleEnds: [
        ...currentState.pendingImmediateBattleEnds,
        pendingImmediateBattleEnd,
      ],
      log: [
        ...currentState.log,
        `battle:end-entry:deferred:${battleResolutionGroup.attackId}`,
      ],
    };
  } else if (
    isConnectBattleDecisionEligible(
      currentState,
      battleResolutionGroup.attackId
    )
  ) {
    // ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md, Q9098): battle_end
    // 誘発 (card_event:"battle_end") を発揮する前に、続行/終了の選択窓を開く。宣言時と
    // 異なりアタッカーは "attacking" のままなので queueBattleEndTriggers/
    // resetBattleEntitiesAfterResolution はまだ呼ばない (choice:"end" で初めて呼ぶ)。
    currentState = openConnectBattleDecision(currentState, {
      attackId: battleResolutionGroup.attackId,
      participantInstanceIds: Array.from(participantInstanceIds),
      blockSideInstanceIds: Array.from(blockSideInstanceIds),
      destroyedRecords,
      participantSnapshots,
      appliedLifeDamage,
      participantOwnSymbols,
    });
  } else {
    currentState = finalizeBattleEndSequenceAfterCombat(options, {
      state: currentState,
      attackId: battleResolutionGroup.attackId,
      participantInstanceIds: Array.from(participantInstanceIds),
      blockSideInstanceIds: Array.from(blockSideInstanceIds),
      destroyedRecords,
      participantSnapshots,
      appliedLifeDamage,
      participantOwnSymbols,
    });
  }

  // Q9098: connected battles do not reach battle_end.  Their accounting and
  // "after the first battle ends" effects must wait until choice:"end" (or
  // exhausted uses) enters finalizeBattleEndSequenceAfterCombat.
  if (currentState.pendingConnectBattleDecision === null) {
    currentState = recordCompletedBattleAndFinalizeAttackStepEnd(
      currentState,
      battleResolutionGroup.attackId,
      options.getCardDefinitionById,
      options
    );
  }

  // activeAttack を片付ける前の破壊記録を使い、付随する消滅とバトル破壊を区別する。
  currentState = appendPublicDisclosuresForStateTransition({
    before: {
      ...stateBeforeResolution,
      activeAttack: stateBeforeResolution.activeAttack
        ? {
            ...stateBeforeResolution.activeAttack,
            battleDestroyedRecords: destroyedRecords,
          }
        : null,
    },
    after: currentState,
    actorPlayerId: stateBeforeResolution.activePlayerId,
  });

  return {
    state: currentState,
    attackId: battleResolutionGroup.attackId,
    totalLifeDamage,
    destroyedEntityIds: [...destroyedEntityIds],
  };
}

/**
 * ENGINE-battle-connect-repeat (10_rules/05c_connect-battle.md): `activeAttack.connectBattleGrant`
 * が残っており、かつアタッカー本体がまだフィールドにいる (Q9094「このスピリットがフィールドを
 * 離れていなければ」) かを判定する。煌臨/入れ替わり/破壊等でこの instanceId が場を離れれば
 * (pendingLeaveKind 確定含む) 自動的に false になる — 「Lv1化で不可」等の個別条件は、
 * 対象カードの連続バトル効果自体が特定 Lv 範囲限定のときに限り、呼び出し元でその条件を
 * 別途 evaluateCondition すること (三歩必殺は全レベル対象なので追加条件不要)。
 */
function isConnectBattleDecisionEligible(
  state: GameState,
  attackId: string
): boolean {
  const grant = state.activeAttack?.connectBattleGrant;
  if (!grant || grant.remainingUses <= 0) return false;
  if (state.activeAttack?.attackId !== attackId) return false;
  return state.cardInstances.some(
    (card) =>
      card.instanceId === grant.sourceInstanceId &&
      card.zone === "field" &&
      card.pendingLeaveKind === null
  );
}

/**
 * ENGINE-battle-connect-repeat: 続行/終了の選択待ち pending を開く。この時点では
 * activeAttack はまだ null 化されておらず (queueBattleEndTriggers/
 * resetBattleEntitiesAfterResolution 未実行)、アタッカーは "attacking" のまま。
 */
function openConnectBattleDecision(
  state: GameState,
  ctx: {
    attackId: string;
    participantInstanceIds: readonly string[];
    blockSideInstanceIds: readonly string[];
    destroyedRecords: readonly BattleDestroyedRecord[];
    participantSnapshots: readonly BattleResolutionParticipantSnapshot[];
    appliedLifeDamage: number;
    participantOwnSymbols: ReadonlyMap<string, number>;
  }
): GameState {
  const grant = state.activeAttack!.connectBattleGrant!;
  const sourceCard = state.cardInstances.find(
    (card) => card.instanceId === grant.sourceInstanceId
  );
  const actingPlayerId = sourceCard?.ownerPlayerId ?? state.activePlayerId;
  return {
    ...state,
    pendingConnectBattleDecision: {
      pendingId: `connect-battle:${ctx.attackId}:${grant.remainingUses}`,
      actingPlayerId,
      sourceInstanceId: grant.sourceInstanceId,
      attackId: ctx.attackId,
      remainingUses: grant.remainingUses,
      participantInstanceIds: ctx.participantInstanceIds,
      blockSideInstanceIds: ctx.blockSideInstanceIds,
      participantSnapshots: ctx.participantSnapshots,
      appliedLifeDamage: ctx.appliedLifeDamage,
      participantOwnSymbols: Array.from(
        ctx.participantOwnSymbols,
        ([entityId, ownSymbols]) => ({ entityId, ownSymbols })
      ),
      ...(ctx.destroyedRecords.length > 0
        ? { destroyedRecords: ctx.destroyedRecords }
        : {}),
    },
    log: [
      ...state.log,
      `battle:connect-battle:decision-pending:${ctx.attackId}:${grant.sourceInstanceId}:${grant.remainingUses}`,
    ],
  };
}

/**
 * ENGINE-battle-connect-repeat: battle_end 誘発 → battleEntities reset →
 * deferredTo:"battle_end" 効果発火 → scope:"battle" CE 失効、までの battle_end 経路本体。
 * 通常の `finalizeBattleResolutionAfterCombat` (connect 対象外) と、
 * `pendingConnectBattleDecision` で `choice:"end"` を選んだ再開経路の両方から呼ばれる
 * 共通テール (SSOT、旧「else」分岐を抽出)。`battlesEndedThisTurn` 計上等の呼び出し元テールは
 * 含まない (pending 生成前に既に実行済みのため、pending 解決時は再実行しない)。
 */
export function finalizeBattleEndSequenceAfterCombat(
  options: ExecuteBattleResolutionOptions,
  ctx: {
    state: GameState;
    attackId: string;
    participantInstanceIds: readonly string[];
    blockSideInstanceIds: readonly string[];
    destroyedRecords: readonly BattleDestroyedRecord[];
    participantSnapshots: readonly BattleResolutionParticipantSnapshot[];
    appliedLifeDamage: number;
    participantOwnSymbols: ReadonlyMap<string, number>;
  }
): GameState {
  const {
    attackId,
    participantInstanceIds,
    blockSideInstanceIds,
    destroyedRecords,
    participantSnapshots,
    appliedLifeDamage,
    participantOwnSymbols,
  } = ctx;
  let currentState = ctx.state;
  currentState = queueBattleEndTriggers({
    state: currentState,
    participantInstanceIds: Array.from(participantInstanceIds),
    attackId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    destroyedRecords: Array.from(destroyedRecords),
    blockSideInstanceIds: Array.from(blockSideInstanceIds),
  });
  currentState = resetBattleEntitiesAfterResolution(
    currentState,
    attackId,
    options.getCardDefinitionById
  );
  currentState = fireBattleEndDeferrals(
    currentState,
    attackId,
    participantSnapshots,
    options.getCardDefinitionById,
    options.getRegisteredTriggeredEffectActions,
    options.getRegisteredBurstActions,
    appliedLifeDamage,
    participantOwnSymbols,
    {
      participantInstanceIds: Array.from(participantInstanceIds),
      blockSideInstanceIds: Array.from(blockSideInstanceIds),
      appliedLifeDamage,
      participantOwnSymbols: Array.from(
        participantOwnSymbols,
        ([entityId, ownSymbols]) => ({ entityId, ownSymbols })
      ),
      ...(destroyedRecords.length > 0
        ? { destroyedRecords: Array.from(destroyedRecords) }
        : {}),
    }
  );
  if (hasPendingBattleEndFinalizeBlockers(currentState, attackId)) {
    return {
      ...currentState,
      pendingBattleEndFinalizeAttackIds:
        currentState.pendingBattleEndFinalizeAttackIds.includes(attackId)
          ? currentState.pendingBattleEndFinalizeAttackIds
          : [...currentState.pendingBattleEndFinalizeAttackIds, attackId],
      log: [
        ...currentState.log,
        `battle:end-scope-finalize:deferred:${attackId}`,
      ],
    };
  }
  currentState = flushPendingLeavesAndQueueReactions({
    beforeFlushState: currentState,
    chainId: getBattleEndDeferralChainId(attackId),
    attackId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions ?? (() => []),
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    queueRegisteredPreFlush: true,
  });
  if (hasPendingBattleEndFinalizeBlockers(currentState, attackId)) {
    return {
      ...currentState,
      pendingBattleEndFinalizeAttackIds:
        currentState.pendingBattleEndFinalizeAttackIds.includes(attackId)
          ? currentState.pendingBattleEndFinalizeAttackIds
          : [...currentState.pendingBattleEndFinalizeAttackIds, attackId],
      log: [
        ...currentState.log,
        `battle:end-scope-finalize:deferred:${attackId}`,
      ],
    };
  }
  return finalizeBattleEndScopeExpirations(
    currentState,
    attackId,
    options.getCardDefinitionById
  );
}

/**
 * Records one actual battle end and resolves the P2-05 first-battle attack-step
 * end effect.  Connected battles call this only after their continuation is
 * declined or no continuation remains, keeping Q9098's pre-battle_end rounds
 * outside both the counter and the force-end trigger.
 */
export function recordCompletedBattleAndFinalizeAttackStepEnd(
  state: GameState,
  attackId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  lookups: TurnTransitionLookups = {}
): GameState {
  const battlesEndedThisTurn = (state.battlesEndedThisTurn ?? 0) + 1;
  const battlesEndedThisAttackStep =
    (state.battlesEndedThisAttackStep ?? 0) + 1;
  let currentState: GameState = {
    ...state,
    battlesEndedThisTurn,
    battlesEndedThisAttackStep,
  };
  currentState = recomputeAndRebuildBattleStateContinuousEffects(
    currentState,
    getCardDefinitionById
  );
  if (
    battlesEndedThisTurn === 1 &&
    currentState.step === "attack" &&
    hasForceAttackStepEndAfterFirstBattle(
      currentState,
      currentState.activePlayerId
    )
  ) {
    currentState.log.push(`battle:forced-attack-step-end:${attackId}`);
    currentState = executeEndAttackStep(
      currentState,
      currentState.activePlayerId
    );
  }

  return finalizePendingEndFinalizations(
    currentState,
    getCardDefinitionById,
    (args) =>
      evaluateAttackStepEndBlockedRetryCondition({
        ...args,
        getCardDefinitionById,
      }),
    lookups
  );
}

/**
 * engine-single-battle-end: 「ただちにバトルを終了する」primitive (BSDB01-C03[7,8] /
 * BSFT01-TR07(A)[4,5] 共通ギャップ)。
 *
 * `end_attack_step` はアタックステップ全体を終了する別挙動のため、進行中の 1 バトル
 * (= 現在の `activeAttack` 単位。`groupMode:"simultaneous"` の複数アタッカーも
 * 通常のバトル解決と同じ粒度で一括終了する) だけを BP 比較・ライフダメージ無しで
 * 終了させたいカード効果向けに新設する。`executeBattleResolution` の BP比較/
 * ライフダメージ分岐 (destroyedEntityIds を算出する処理) を丸ごとスキップし、
 * 空の `destroyedEntityIds` で `finalizeBattleResolutionAfterCombat` 以降
 * (battle_end 誘発・battleEntities reset・scope:"battle" CE 失効) だけを実行する。
 *
 * before_block/after_block flash ウィンドウ中のフラッシュ効果ステップとして発火する
 * 想定 (BSDB01-C03/BSFT01-TR07(A) とも flash 効果内)。flash 効果は「宣言→スタック→
 * 解決」で processing されるため、本関数はスタック解決 (`resolveDeferredStackAction`
 * 経由の `executeEffect`) の最中に呼ばれる。呼び出し元 (`pass_battle_flash` apply /
 * `pass_stack` apply) は解決後の state をそのまま返すだけで window/activeAttack を
 * 追加で読み書きしないため、本関数内で `window:"none"`/`activeAttack:null` まで
 * 進めてよい (`executeBattleResolution` が after_block flash close 後に到達する状態と
 * 完全に同型)。
 */
export function executeEndSingleBattle(
  state: GameState,
  actingPlayerId: string,
  unaffectedByRestriction: boolean | undefined,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions:
    | TriggeredEffectActionRegistrationLookup
    | undefined,
  getRegisteredBurstActions?: BurstActionRegistrationLookup
): GameState {
  const activeAttack = state.activeAttack;

  if (activeAttack === null || state.battleResolutionGroup !== null) {
    state.log.push(`effect:end_single_battle:no-op:${actingPlayerId}`);
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
      `effect:end_single_battle:blocked-by-restriction:${actingPlayerId}`
    );
    return state;
  }

  const battleResolutionGroup = createBattleResolutionGroup(state);
  const stateBeforeResolution: GameState = {
    ...state,
    window: "battle_resolution",
    battleResolutionGroup,
    log: [
      ...state.log,
      `battle:resolution:start:${activeAttack.attackId}:${battleResolutionGroup.participantSnapshots
        .map((snapshot) => snapshot.entityId)
        .join(",")}`,
      `battle:end-single-battle:${activeAttack.attackId}:${actingPlayerId}`,
    ],
  };
  const chainId = createBattleResolutionChainId(
    stateBeforeResolution,
    battleResolutionGroup.attackId
  );
  const triggeredEffectLookup: TriggeredEffectActionRegistrationLookup =
    getRegisteredTriggeredEffectActions ?? (() => []);

  const result = finalizeBattleResolutionAfterCombat(
    {
      state,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions: triggeredEffectLookup,
      getRegisteredBurstActions,
    },
    {
      stateBeforeResolution,
      currentState: stateBeforeResolution,
      battleResolutionGroup,
      chainId,
      destroyedEntityIds: [],
      totalLifeDamage: 0,
      appliedLifeDamage: 0,
      participantOwnSymbols: new Map(),
    }
  );
  return result.state;
}

/**
 * P3-55 Phase B: 防御側プレイヤーが「ブロックしない」を意思表示する apply。
 * before_block flash 完了後・ブロック宣言前の状態でのみ legal。
 * `executeBattleResolution` を呼んでバトル解決まで完了させる。
 */
export function useDeclineBlockAsAction(
  options: UseDeclineBlockAsActionOptions
): DeclineBlockResult {
  const blockReason = getDeclineBlockBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Decline block is not legal: actingPlayer=${options.actingPlayerId} reason=${blockReason}`
    );
  }

  // P2-05: 既にブロック宣言がある場合の decline は「残りはブロックしない」
  // 完了宣言。バトル解決には進まず、攻撃側の after_block flash を解禁する
  // (ブロックが 1 件でもあるため後半フラッシュは省略されない)。
  const activeAttack = options.state.activeAttack;
  if (
    activeAttack !== null &&
    activeAttack.blockAssignments.some((a) => a.blockedByEntityIds.length > 0)
  ) {
    const completedState: GameState = {
      ...options.state,
      activeAttack: {
        ...activeAttack,
        blockDeclarationCompleted: true,
      },
      log: [
        ...options.state.log,
        `block:declaration-completed:${activeAttack.attackId}:${options.actingPlayerId}`,
      ],
    };
    return {
      state: completedState,
      attackId: activeAttack.attackId,
      totalLifeDamage: 0,
      destroyedEntityIds: [],
    };
  }

  return executeBattleResolution({
    state: options.state,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}

function getFlashWindowPriorityOpponentId(
  state: GameState,
  actingPlayerId: string
): string {
  const activeAttack = state.activeAttack;

  if (activeAttack?.target.kind === "player") {
    if (actingPlayerId === activeAttack.target.playerId) {
      return state.activePlayerId;
    }

    return activeAttack.target.playerId;
  }

  const actingPlayerIndex = state.playerOrder.indexOf(actingPlayerId);

  if (actingPlayerIndex === -1 || state.playerOrder.length < 2) {
    throw new Error("Cannot resolve flash window opponent player");
  }

  const opponentPlayerId =
    state.playerOrder[(actingPlayerIndex + 1) % state.playerOrder.length];

  if (!opponentPlayerId) {
    throw new Error("Cannot resolve flash window opponent player");
  }

  return opponentPlayerId;
}

function closeBattleFlashWindow(
  state: GameState,
  flashKind: BattleFlashWindowKind
): GameState {
  const activeAttack = state.activeAttack;

  if (activeAttack === null) {
    throw new Error("Cannot close battle flash window without activeAttack");
  }

  state.log.push(`battle:flash:closed:${flashKind}:${activeAttack.attackId}`);
  const closedState: GameState = {
    ...state,
    window: "declare_block",
    activeAttack: {
      ...activeAttack,
      flashBeforeBlockCompleted:
        flashKind === "before_block"
          ? true
          : activeAttack.flashBeforeBlockCompleted,
      flashAfterBlockCompleted:
        flashKind === "after_block"
          ? true
          : activeAttack.flashAfterBlockCompleted,
      flashWindowState: null,
    },
  };

  return closedState;
}

export function useOpenBattleFlashAsAction(
  options: UseOpenBattleFlashAsActionOptions
): OpenBattleFlashResult {
  const blockReason = getOpenBattleFlashBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Open battle flash is not legal: actingPlayer=${options.actingPlayerId} kind=${options.flashKind} reason=${blockReason}`
    );
  }

  const activeAttack = options.state.activeAttack;

  if (activeAttack === null) {
    throw new Error("Cannot open battle flash without activeAttack");
  }

  // before_block: 非アクティブプレイヤーが先にフラッシュを使う
  // after_block: 非アクティブプレイヤーが先にフラッシュを使う
  const nonActivePlayerId = getFlashWindowPriorityOpponentId(
    options.state,
    options.actingPlayerId
  );
  const stackResponseSourcePlayerId = nonActivePlayerId;

  return {
    attackId: activeAttack.attackId,
    flashKind: options.flashKind,
    state: {
      ...options.state,
      window:
        options.flashKind === "before_block"
          ? "flash_before_block"
          : "flash_after_block",
      activeAttack: {
        ...activeAttack,
        flashWindowState: {
          kind: options.flashKind,
          priorityPlayerId: nonActivePlayerId,
          consecutivePassCount: 0,
          stackResponseSourcePlayerId,
          pendingStackAction: null,
        },
      },
      log: [
        ...options.state.log,
        `battle:flash:open:${options.flashKind}:${activeAttack.attackId}:${options.actingPlayerId}`,
      ],
    },
  };
}

export function usePassBattleFlashAsAction(
  options: UsePassBattleFlashAsActionOptions
): PassBattleFlashResult {
  const blockReason = getPassBattleFlashBlockReason(options);

  if (blockReason !== null) {
    throw new Error(
      `Pass battle flash is not legal: actingPlayer=${options.actingPlayerId} reason=${blockReason}`
    );
  }

  const activeAttack = options.state.activeAttack;

  if (activeAttack === null || activeAttack.flashWindowState === null) {
    throw new Error("Cannot pass battle flash without flash window state");
  }

  const flashWindowState = activeAttack.flashWindowState;
  const flashWindow =
    flashWindowState.kind === "before_block"
      ? "flash_before_block"
      : "flash_after_block";
  const stackWindow =
    flashWindowState.kind === "before_block"
      ? "stack_before_block"
      : "stack_after_block";

  // Stack sub-window (pending stack present): 1-pass cascade close (2026-03-31 rule)
  // フラッシュ本体の 2-pass ループとは別に、内側のスタックサブ窓はスタックルール適用
  if (flashWindowState.pendingStackAction !== null) {
    const resolvedStacks: ActiveStack[] = [];
    let workingFlashState = flashWindowState;
    // BSAZ01-C12 の支払い前使用は、元マジックをまだ支払い前で保留したまま、
    // その C12 使用だけを先に通常のスタックとして解決する。C12 が既存の
    // battle-flash 親スタックへの応答中に使われた場合、この pass で親まで peel
    // すると、元マジックを同じ親の上へ戻す前に親応答を解決してしまう。
    // pending の trigger 済み source を境界にして、復元した親は保持する。
    const preCostTriggerStackSourceInstanceId =
      options.state.pendingFieldMagicPreCostTrigger?.triggered === true
        ? options.state.pendingFieldMagicPreCostTrigger.triggerSourceInstanceId
        : null;
    while (workingFlashState.pendingStackAction !== null) {
      const {
        resolvedStack: peeledStack,
        restoredPendingStackAction,
        restoredResponseSourcePlayerId,
        restoredPriorityPlayerId,
      } = peelResolvedStack({ windowState: workingFlashState });
      resolvedStacks.push(peeledStack);
      workingFlashState = {
        ...workingFlashState,
        pendingStackAction: restoredPendingStackAction,
        stackResponseSourcePlayerId: restoredResponseSourcePlayerId,
        priorityPlayerId: restoredPriorityPlayerId,
        consecutivePassCount: 0,
      };

      // C12 のみを peel した直後は、restoredPendingStackAction を残して
      // core_distribute 等の C12 内部 pending を先に解決する。完了後に中断元を
      // この親スタックの上へ再提示する（03a の支払い前使用の順序）。
      if (peeledStack.cardInstanceId === preCostTriggerStackSourceInstanceId) {
        break;
      }
    }

    // フラッシュ優先権ループの交互 (「両プレイヤーが交互にフラッシュ効果を使用」
    // 10_rules/02) は **能動フラッシュ使用** でのみ進む。誘発効果 (例: BSTH01-X05 咲夜の
    // 「相手が使用したとき発揮前に無効化」) は誘発レイヤーであって能動フラッシュ使用ではなく、
    // 「誘発レイヤーと能動スタックレイヤーは別系統」(10_rules/02 発揮前無効化節)。
    // よって最外スタックが誘発効果のときは「使用者→相手へ移譲」を行わず、peel で復元された
    // 直前のフラッシュ本体優先権をそのまま用いる。これにより「自分フラッシュ使用 → 相手誘発で
    // 無効 → 相手のフラッシュタイミング」が成立し、通常の契約合体時誘発も直前 priority へ戻る。
    const outermostResolved = resolvedStacks[resolvedStacks.length - 1];
    const outermostIsInducedTrigger =
      outermostResolved?.actionKind === "triggered_effect";

    // ENGINE-flash-priority-consecutive-use-grant (BSLH01-T15): 既定は能動使用1回ごとに
    // 相手へ優先権移譲だが、grant_flash_consecutive_use CE を持つ使用者は連続使用回数が
    // 上限に達するまで自分に優先権を留められる。誘発解決 (outermostIsInducedTrigger) は
    // 能動使用ではないため、この延長ロジック・ストリークカウンタの対象外
    // （priorityPlayerId は上の分岐と同じく peel 復元値をそのまま使う）。
    let nextFlashPriorityPlayerId = workingFlashState.priorityPlayerId;
    let nextConsecutiveActiveUseCount =
      workingFlashState.consecutiveActiveUseCount ?? 0;
    if (resolvedStacks.length > 0 && !outermostIsInducedTrigger) {
      const activeUser = outermostResolved!.actingPlayerId;
      const usedCount = (workingFlashState.consecutiveActiveUseCount ?? 0) + 1;
      const limit = getFlashConsecutiveUseLimitGrant(options.state, activeUser);
      if (usedCount < limit) {
        nextFlashPriorityPlayerId = activeUser;
        nextConsecutiveActiveUseCount = usedCount;
      } else {
        nextFlashPriorityPlayerId = getFlashWindowPriorityOpponentId(
          options.state,
          activeUser
        );
        nextConsecutiveActiveUseCount = 0;
      }
    } else if (resolvedStacks.length > 0) {
      // 誘発解決: ストリークは能動使用者のものではなくなるためリセットする。
      nextConsecutiveActiveUseCount = 0;
    }
    workingFlashState = {
      ...workingFlashState,
      priorityPlayerId: nextFlashPriorityPlayerId,
      stackResponseSourcePlayerId: nextFlashPriorityPlayerId,
      consecutivePassCount: 0,
      consecutiveActiveUseCount: nextConsecutiveActiveUseCount,
    };

    // All sub-stacks unwound → return to flash window (loop continues)
    const newState: GameState = {
      ...options.state,
      window: flashWindow,
      activeAttack: {
        ...activeAttack,
        flashWindowState: workingFlashState,
      },
      log: [
        ...options.state.log,
        ...resolvedStacks.map(
          (s) =>
            `battle:flash:stack:closed:${s.stackId}:${options.actingPlayerId}`
        ),
      ],
    };

    return {
      attackId: activeAttack.attackId,
      flashKind: flashWindowState.kind,
      closed: false,
      nextPriorityPlayerId: workingFlashState.priorityPlayerId,
      outcome: "stack_closed_needs_resolution",
      resolvedStack: null,
      resolvedStacks,
      state: newState,
    };
  }

  // Flash window itself (no pending stack): 2-pass loop (kept intact)
  if (flashWindowState.consecutivePassCount === 0) {
    // 1st pass: transfer priority to opponent
    const nextPriorityPlayerId = getFlashWindowPriorityOpponentId(
      options.state,
      options.actingPlayerId
    );

    return {
      attackId: activeAttack.attackId,
      flashKind: flashWindowState.kind,
      closed: false,
      nextPriorityPlayerId,
      outcome: "priority_transferred",
      resolvedStack: null,
      resolvedStacks: [],
      state: {
        ...options.state,
        window:
          options.state.window === flashWindow ? flashWindow : stackWindow,
        activeAttack: {
          ...activeAttack,
          flashWindowState: {
            ...flashWindowState,
            ...transferResponseWindowPriority(
              flashWindowState,
              nextPriorityPlayerId
            ),
            // 明示パスによる優先権移譲でも連続使用ストリークは断たれる（次に優先権を
            // 得るプレイヤーの grant_flash_consecutive_use 判定を 1 回目から正しく行うため）。
            // 既に 0/未設定 なら key 自体を追加しない (既存の厳密 toEqual 回帰と両立させる、
            // packages/rules-core/test/index.test.ts の flash 優先権移譲テスト)。
            ...(flashWindowState.consecutiveActiveUseCount
              ? { consecutiveActiveUseCount: 0 }
              : {}),
          },
        },
        log: [
          ...options.state.log,
          `battle:flash:pass:${flashWindowState.kind}:${options.actingPlayerId}:${nextPriorityPlayerId}:${activeAttack.attackId}`,
        ],
      },
    };
  }

  // 2nd pass with no pending stack: close the flash window entirely
  const closedState = closeBattleFlashWindow(
    options.state,
    flashWindowState.kind
  );

  return {
    attackId: activeAttack.attackId,
    flashKind: flashWindowState.kind,
    closed: true,
    nextPriorityPlayerId: null,
    outcome: "flash_window_closed",
    resolvedStack: null,
    resolvedStacks: [],
    state: closedState,
  };
}

function createBattleResolutionChainId(
  state: GameState,
  attackId: string
): string {
  return `battle-resolution:${state.turnNumber}:${state.activePlayerId}:${attackId}`;
}

/**
 * 防御側プレイヤーに有効な「攻撃者限定ライフ減少防止」CE
 * (`life_damage_interception` mode:"replace" + `attackerFilter`) を返す。
 * 攻撃元 (アタッカー leader カード) がフィルタに一致するバトルライフ減少のみを
 * 0 にするために、`getUnblockedLifeDamage` が各 unblocked 参加体ごとに照合する。
 * 10_rules/05「ブロックされなかった参加体のライフ減少」per-participant 帰属が根拠。
 */
interface AttackerLifePrevention {
  /**
   * CE/filter バケット型 turn_cap の累積キーに使う continuous effect id。
   */
  effectId: string;
  filter?: CardFilter;
  instanceIds?: string[];
  /**
   * 一致アタッカーのライフ減少上限（mode:"replace" 系）。
   * 0 = 完全防止（従来挙動）／N = この参加体のライフ減少を最大 N にクランプ
   * （「相手のアタックでは自分のライフは N しか減らない」）。
   */
  cap?: number;
  /**
   * 一致アタッカー由来のバトルライフ減少後、防御プレイヤーのライフがこの値を
   * 下回らないようにクランプする絶対下限（mode:"floor"）。
   * 「効果の記述を持つ相手のアタックでは自分のライフは1以下にならない」= floor:2。
   */
  floor?: number;
  /**
   * 一致アタッカー由来のバトルライフ減少を**ターン内累積**でこの値に頭打ちにする
   * per-attacker-BP gate cap（BSTH08.5-C21「BP6000 以下のアタックでは 1 ターンに 2 以上
   * 減らない」= attackerFilter:{maxBp:6000} + attackerBpTurnCap:1）。基底 turn_cap とは
   * 独立トラック。getUnblockedLifeDamage が bpThresholdCappedLifeReductionThisTurn を参照し、
   * 当該プレイヤーの残量で一致参加体合計をクランプする。
   */
  bpTurnCap?: number;
  /**
   * 一致アタッカー由来のバトルライフ減少を、CE/filter バケット単位で
   * filteredLifeReductionCappedThisTurn に累積する。
   */
  turnCap?: number;
}

interface FilteredTurnCapConsumption {
  targetPlayerId: string;
  effectId: string;
  amount: number;
}

interface FilteredTurnCapBucket {
  targetPlayerId: string;
  effectId: string;
  remaining: number;
  consumed: number;
}

interface FilteredTurnCapParticipant {
  symbols: number;
  bucketKeys: string[];
}

function filteredTurnCapKey(targetPlayerId: string, effectId: string): string {
  return `${targetPlayerId}:${effectId}`;
}

function getAttackerFilteredLifePreventionCEs(
  state: GameState,
  defendingPlayerId: string
): AttackerLifePrevention[] {
  const preventions: AttackerLifePrevention[] = [];
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "life_damage_interception") continue;
    if (ce.targetInstanceId !== defendingPlayerId) continue;
    const meta = ce.metadata as
      | {
          cause?: string;
          mode?: string;
          cap?: number;
          floor?: number;
          attackerBpTurnCap?: number;
          attackerFilter?: CardFilter;
          attackerInstanceIds?: string[];
        }
      | undefined;
    if (!meta) continue;
    if (meta.cause === "opponent_effect") continue;
    // replace=ライフ減少を 0/cap にクランプ、floor=絶対下限クランプ、
    // turn_cap=一致参加体由来のターン累積上限。
    if (
      meta.mode !== "replace" &&
      meta.mode !== "floor" &&
      meta.mode !== "turn_cap"
    ) {
      continue;
    }
    const hasAttackerScope = !!(
      meta.attackerFilter || meta.attackerInstanceIds
    );
    // アタッカー限定 (filter / instanceIds) が無い CE は、原則 core-system 側
    // (applyLifeDamageInterception) が全ダメージに適用するためバトル経路では扱わない。
    // 例外: cap が正の値で指定された「ライフは N しか減らない」型は per-participant
    // のクランプが必要なため、フィルタ無しでも（全アタッカー一致として）ここで扱う。
    const isPerParticipantCap = meta.mode === "replace" && (meta.cap ?? 0) > 0;
    if (!hasAttackerScope && !isPerParticipantCap) continue;
    const hasBpTurnCap =
      meta.mode === "replace" && meta.attackerBpTurnCap !== undefined;
    preventions.push({
      effectId: ce.effectId,
      ...(meta.attackerFilter ? { filter: meta.attackerFilter } : {}),
      ...(meta.attackerInstanceIds
        ? { instanceIds: meta.attackerInstanceIds }
        : {}),
      // bpTurnCap 型はターン累積でクランプするため per-participant cap は適用しない
      // （cap:0 を立てると一致参加体のダメージが先に 0 になり累積判定へ届かない）。
      ...(meta.mode === "replace" && !hasBpTurnCap
        ? { cap: meta.cap ?? 0 }
        : {}),
      ...(meta.mode === "floor" ? { floor: meta.floor ?? 1 } : {}),
      ...(hasBpTurnCap ? { bpTurnCap: meta.attackerBpTurnCap } : {}),
      ...(meta.mode === "turn_cap" ? { turnCap: meta.cap ?? 0 } : {}),
    });
  }
  return preventions;
}

/**
 * `life_damage_source_prevention_immunity` (P3-125 Step3、
 * BSLH01-X08【ソウルドライブ・S】) の付与元プレイヤーが持つ、免疫対象の発生源
 * カードフィルタ一覧を返す。`getUnblockedLifeDamage` が参加体 (アタッカー leader)
 * ごとにこのフィルタへ一致するか照合し、一致すれば `bypassedLifeDamage` へ回して
 * 防御側のどの `life_damage_interception` CE（blanket/attackerFilter 問わず）でも
 * 防げない扱いにする。
 */
function getLifeDamageSourcePreventionImmunityFilters(
  state: GameState,
  grantingPlayerId: string
): CardFilter[] {
  const filters: CardFilter[] = [];
  for (const ce of state.activeContinuousEffects) {
    if (ce.modifierTag !== "life_damage_source_prevention_immunity") continue;
    if (ce.targetInstanceId !== grantingPlayerId) continue;
    const meta = ce.metadata as { sourceFilter?: CardFilter } | undefined;
    if (meta?.sourceFilter) filters.push(meta.sourceFilter);
  }
  return filters;
}

export function getUnblockedLifeDamage(
  state: GameState,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): {
  targetPlayerId: string;
  totalLifeDamage: number;
  /**
   * このバトル解決で実際に bpThresholdCappedLifeReductionThisTurn へ計上すべき
   * BP 閾値 gate cap 由来のライフ減少量（per-attacker-BP gate cap, BSTH08.5-C21）。
   * 0 のとき計上不要。呼び出し元 (executeBattleResolution) が damage 適用後にコミットする。
   */
  bpThresholdCapConsumed: number;
  /**
   * source-filter 付き mode:"turn_cap" がこのバトルで実際に通したライフ減少量。
   * 呼び出し元が filteredLifeReductionCappedThisTurn へ計上する。
   */
  turnCapConsumed: number;
  turnCapAppliedDamage: number;
  turnCapConsumptions: FilteredTurnCapConsumption[];
  /**
   * P3-125 Step3: `life_damage_source_prevention_immunity` に一致した参加体由来の
   * ライフ減少量。`totalLifeDamage` には含めない。呼び出し元 (executeBattleResolution)
   * が `forcedUnpreventable:true` で別途 `resolveLifeDamage` に通し、相手のどの
   * `life_damage_interception` CE（blanket/attackerFilter 問わず）でも防げない。
   */
  bypassedLifeDamage: number;
  /**
   * 各参加体 (entityId) が個別の attackerFilter/attackerInstanceIds cap・免疫適用後に
   * 保持していた symbols 数 (0 ならその参加体自身の寄与はゼロ)。ブロック済み/フィールド
   * 離脱済み/免疫該当の参加体は未セット (未セット=0 として扱う)。floor/turn_cap/bpTurnCap
   * 一致参加体は、このループ内では最終クランプ後の実寄与が確定できない
   * (highestFloor/turnCapBuckets/bpCapBudget によるグループ単位クランプは後段の別ループで
   * 行う。floor は特に `flooredDamage = Math.min(flooredDamage, maxFlooredDamage)` の
   * グループ合算クランプのため、複数の floor 一致参加体がいる場合どちらの寄与が実際に反映
   * されたか一意に按分できない) ため、fail-close で 0 (寄与なし扱い) をセットする
   * (adversarial verifier round3/round4 lens3 指摘: turn_cap/bpTurnCap/floor 一致参加体の
   * 未クランプ値がそのまま漏れていた点の修正)。
   * `ConditionClause.kind:"battle_life_reduced"` (BSTH05-X04 型) が
   * 「このスピリット自身の寄与」を判定するための正源 (fireBattleEndDeferrals が参照する。
   * 並行計算を避けるため、この Map の値だけを使い resolvedSymbols を直接見ない)。
   */
  participantOwnSymbols: ReadonlyMap<string, number>;
} | null {
  const battleResolutionGroup = state.battleResolutionGroup;

  if (
    !battleResolutionGroup ||
    battleResolutionGroup.target.kind !== "player"
  ) {
    return null;
  }

  const defendingPlayerId = battleResolutionGroup.target.playerId;
  const attackerPreventions = getAttackerFilteredLifePreventionCEs(
    state,
    defendingPlayerId
  );
  const preventionImmunityFilters =
    getLifeDamageSourcePreventionImmunityFilters(state, state.activePlayerId);

  // 一致 prevention 判定（leader カード照合）を共通化。
  const matchPrevention = (
    prevention: AttackerLifePrevention,
    leaderId: string | undefined,
    leaderCard: ReturnType<typeof getCardById>,
    leaderDef: CardDefinition | undefined,
    leaderResolvedBp: number | undefined
  ): boolean => {
    // instanceIds 指定があり leader が含まれなければ不一致。
    if (
      prevention.instanceIds &&
      (!leaderId || !prevention.instanceIds.includes(leaderId))
    ) {
      return false;
    }
    // filter 指定があれば leader カードを照合（cost/category/系統/効果記述 等）。
    if (prevention.filter) {
      if (!leaderCard || !leaderDef) return false;
      if (
        !matchesCardReferenceFilter(leaderCard, leaderDef, prevention.filter, {
          battleEntities: state.battleEntities,
          // BP 閾値 (maxBp) はアタック解決時の実効 BP で判定する（10_rules/05、
          // 裁定 2026-06-16）。snapshot.resolvedBp = 解決時の確定 BP。
          ...(leaderResolvedBp !== undefined
            ? { effectiveBp: leaderResolvedBp }
            : {}),
          // 実効 category (P3-47 F-2) を act_as_spirit token も含めて判定するため
          // state を注入する（[[project_effective_bp_ssot]] 同型 SSOT）。
          // 未注入だと印字 category にフォールバックして filter.category:["spirit"] が
          // act_as_spirit token を取り逃がす silent gap になる。
          state,
          // minCost/maxCost は、合体ユニットの host+brave コストと
          // 「コストは X としても扱う」候補を同じ SSOT で見る。
          ...getCombinedUnitCostFilterOptions(
            state,
            leaderCard,
            leaderDef,
            getCardDefinitionById
          ),
          // maxCores/minCores は実効コア数で判定するため注入する。
          coreCount: getTotalCoresOnCardById(state, leaderCard.instanceId),
          effectiveLevel: getEffectiveLevel(
            state,
            leaderCard,
            leaderDef,
            getCardDefinitionById
          ),
          // 合体ユニット (host+attached brave) と symbol_addition CE 由来の
          // 実効シンボル数を symbolCount/minSymbolCount 判定へ注入。
          effectiveSymbolCount: getCombinedUnitSymbolCount(
            state,
            leaderCard,
            leaderDef,
            getCardDefinitionById
          ),
        })
      ) {
        return false;
      }
    }
    return true;
  };

  // 累積: floor 一致参加体の被ダメージ小計（後段で絶対下限クランプ）と、
  // それ以外（cap 適用済み）の確定ダメージ。
  let unconstrainedDamage = 0;
  let flooredDamage = 0;
  let highestFloor = 0;
  // P3-125 Step3: life_damage_source_prevention_immunity 一致参加体由来のダメージ
  // （防御側のどの life_damage_interception CE でも防げない）。
  let bypassedDamage = 0;
  // BP 閾値 gate cap (BSTH08.5-C21): 一致参加体由来ダメージをグループ合計してから
  // ターン内残量でクランプする。bpCapBudget は最小 bpTurnCap（複数ゲート併存時は最厳）。
  let bpCapMatchedDamage = 0;
  let bpCapBudget: number | undefined;
  // fireBattleEndDeferrals の battle_life_reduced 判定用 SSOT (関数コメント参照)。
  const participantOwnSymbols = new Map<string, number>();
  const turnCapBuckets = new Map<string, FilteredTurnCapBucket>();
  const turnCapParticipants: FilteredTurnCapParticipant[] = [];
  const turnCapConsumptions: FilteredTurnCapConsumption[] = [];

  for (const entityId of battleResolutionGroup.symbolResolutionOrder) {
    const snapshot = battleResolutionGroup.participantSnapshots.find(
      (participantSnapshot) => participantSnapshot.entityId === entityId
    );

    if (!snapshot || snapshot.blockedBy.length > 0) continue;

    // 非参加者の履歴は、ライフ下限など他参加者へ及ぶ保護集計にも含めない。
    if (!hasFieldBattleResolutionMember(state, snapshot)) {
      participantOwnSymbols.set(entityId, 0);
      continue;
    }

    let symbols =
      snapshot.resolvedSymbolCount ?? snapshot.resolvedSymbols.length;
    const lifeSourceId = snapshot.memberInstanceIds[0];
    const lifeSource = lifeSourceId
      ? getCardById(state, lifeSourceId)
      : undefined;
    if (symbols > 0 && lifeSource) {
      symbols += computeLifeReductionAmountBonus(
        state,
        lifeSource.ownerPlayerId,
        lifeSource.instanceId
      );
    }
    let participantFloor = 0;
    let participantBpCapped = false;
    const participantTurnCapBucketKeys = new Set<string>();

    if (preventionImmunityFilters.length > 0) {
      const immunityLeaderId = snapshot.memberInstanceIds[0];
      const immunityLeaderCard = immunityLeaderId
        ? getCardById(state, immunityLeaderId)
        : undefined;
      const immunityLeaderDef =
        immunityLeaderCard && getCardDefinitionById
          ? getCardDefinitionById(immunityLeaderCard.definitionId)
          : undefined;
      const immune =
        immunityLeaderCard &&
        immunityLeaderDef &&
        preventionImmunityFilters.some((filter) =>
          matchesCardReferenceFilter(
            immunityLeaderCard,
            immunityLeaderDef,
            filter,
            {
              state,
              battleEntities: state.battleEntities,
              ...(snapshot.resolvedBp !== undefined
                ? { effectiveBp: snapshot.resolvedBp }
                : {}),
              ...getCombinedUnitCostFilterOptions(
                state,
                immunityLeaderCard,
                immunityLeaderDef,
                getCardDefinitionById
              ),
              coreCount: getTotalCoresOnCardById(
                state,
                immunityLeaderCard.instanceId
              ),
              effectiveLevel: getEffectiveLevel(
                state,
                immunityLeaderCard,
                immunityLeaderDef,
                getCardDefinitionById
              ),
              effectiveSymbolCount: getCombinedUnitSymbolCount(
                state,
                immunityLeaderCard,
                immunityLeaderDef,
                getCardDefinitionById
              ),
            }
          )
        );
      if (immune) {
        bypassedDamage += symbols;
        continue;
      }
    }

    if (attackerPreventions.length > 0) {
      const leaderId = snapshot.memberInstanceIds[0];
      const leaderCard = leaderId ? getCardById(state, leaderId) : undefined;
      const leaderDef =
        leaderCard && getCardDefinitionById
          ? getCardDefinitionById(leaderCard.definitionId)
          : undefined;
      for (const prevention of attackerPreventions) {
        if (
          !matchPrevention(
            prevention,
            leaderId,
            leaderCard,
            leaderDef,
            snapshot.resolvedBp
          )
        )
          continue;
        // cap: 一致参加体のライフ減少を cap でクランプ（replace, cap 0=完全防止）。
        if (prevention.cap !== undefined) {
          symbols = Math.min(symbols, prevention.cap);
        }
        // floor: この参加体の被ダメージを絶対下限クランプ対象に回す。
        if (prevention.floor !== undefined) {
          participantFloor = Math.max(participantFloor, prevention.floor);
        }
        // bpTurnCap: この参加体由来のダメージは BP 閾値 gate cap バケットへ回し、
        // グループ合計をターン内残量でクランプする（per-participant ではなく累積）。
        if (prevention.bpTurnCap !== undefined) {
          participantBpCapped = true;
          bpCapBudget =
            bpCapBudget === undefined
              ? prevention.bpTurnCap
              : Math.min(bpCapBudget, prevention.bpTurnCap);
        }
        if (prevention.turnCap !== undefined) {
          const key = filteredTurnCapKey(
            defendingPlayerId,
            prevention.effectId
          );
          participantTurnCapBucketKeys.add(key);
          const prev = turnCapBuckets.get(key);
          const cumulative =
            (state.filteredLifeReductionCappedThisTurn ?? {})[key] ?? 0;
          const remaining = Math.max(0, prevention.turnCap - cumulative);
          if (!prev) {
            turnCapBuckets.set(key, {
              targetPlayerId: defendingPlayerId,
              effectId: prevention.effectId,
              remaining,
              consumed: 0,
            });
          } else {
            turnCapBuckets.set(key, {
              ...prev,
              remaining: Math.min(prev.remaining, remaining),
            });
          }
        }
      }
    }

    // turn_cap/bpTurnCap/floor 一致参加体は、このループ時点の symbols では最終クランプ後の
    // 実寄与を確定できない (turnCapBuckets/bpCapBudget/highestFloor によるグループ単位
    // クランプ (flooredDamage = Math.min(...) 含む) はこのループの後段で行われるため)。
    // 一意に確定できない以上、fail-close で寄与ゼロ扱いにする
    // (adversarial verifier round3/round4 lens3 指摘の修正。floor も turn_cap/bpTurnCap と
    // 同じ「グループ単位クランプで参加体単位に一意帰属できない」構造のため同列に扱う)。
    participantOwnSymbols.set(
      entityId,
      participantTurnCapBucketKeys.size > 0 ||
        participantBpCapped ||
        participantFloor > 0
        ? 0
        : symbols
    );

    if (participantTurnCapBucketKeys.size > 0) {
      turnCapParticipants.push({
        symbols,
        bucketKeys: Array.from(participantTurnCapBucketKeys),
      });
    } else if (participantBpCapped) {
      // 閾値一致参加体は floor/unconstrained に計上せず、bpCap バケットへ集約する
      // （floor と併存し得ないカードのみが対象＝C21 は floor を持たない）。
      bpCapMatchedDamage += symbols;
    } else if (participantFloor > 0) {
      flooredDamage += symbols;
      highestFloor = Math.max(highestFloor, participantFloor);
    } else {
      unconstrainedDamage += symbols;
    }
  }

  let turnCappedDamage = 0;
  for (const participant of turnCapParticipants) {
    let cappedDamage = participant.symbols;
    for (const key of participant.bucketKeys) {
      const bucket = turnCapBuckets.get(key);
      cappedDamage = Math.min(cappedDamage, bucket?.remaining ?? 0);
    }
    if (cappedDamage <= 0) continue;
    turnCappedDamage += cappedDamage;
    for (const key of participant.bucketKeys) {
      const bucket = turnCapBuckets.get(key);
      if (!bucket) continue;
      turnCapBuckets.set(key, {
        ...bucket,
        remaining: Math.max(0, bucket.remaining - cappedDamage),
        consumed: bucket.consumed + cappedDamage,
      });
    }
  }
  for (const bucket of turnCapBuckets.values()) {
    if (bucket.consumed <= 0) continue;
    turnCapConsumptions.push({
      targetPlayerId: bucket.targetPlayerId,
      effectId: bucket.effectId,
      amount: bucket.consumed,
    });
  }

  // floor 一致参加体由来のダメージは、防御プレイヤーのライフが floor を
  // 下回らないようにクランプする（残ライフ = currentLife − unconstrained − floored ≥ floor）。
  if (flooredDamage > 0 && highestFloor > 0) {
    const defendingPlayer = state.players.find(
      (p) => p.id === defendingPlayerId
    );
    const currentLife = defendingPlayer
      ? getPlayerLifeCoreCount(defendingPlayer)
      : 0;
    const maxFlooredDamage = Math.max(
      0,
      currentLife - unconstrainedDamage - highestFloor
    );
    flooredDamage = Math.min(flooredDamage, maxFlooredDamage);
  }

  // BP 閾値 gate cap (BSTH08.5-C21): 一致参加体合計をターン内残量で頭打ちにする。
  // 残量 = budget − これまでの当該プレイヤー累積。実際に減る分のみ計上する。
  let bpCappedDamage = bpCapMatchedDamage;
  let bpThresholdCapConsumed = 0;
  if (bpCapBudget !== undefined && bpCapMatchedDamage > 0) {
    const cumulative =
      (state.bpThresholdCappedLifeReductionThisTurn ?? {})[defendingPlayerId] ??
      0;
    const remaining = Math.max(0, bpCapBudget - cumulative);
    bpCappedDamage = Math.min(bpCapMatchedDamage, remaining);
    bpThresholdCapConsumed = bpCappedDamage;
  }

  const totalLifeDamage =
    unconstrainedDamage + flooredDamage + bpCappedDamage + turnCappedDamage;

  return {
    targetPlayerId: defendingPlayerId,
    totalLifeDamage,
    bpThresholdCapConsumed,
    turnCapConsumed: turnCapConsumptions.reduce(
      (sum, entry) => sum + entry.amount,
      0
    ),
    turnCapAppliedDamage: turnCappedDamage,
    turnCapConsumptions,
    bypassedLifeDamage: bypassedDamage,
    participantOwnSymbols,
  };
}

function getDestroyedEntityIdsFromBattleResolution(state: GameState): string[] {
  const battleResolutionGroup = state.battleResolutionGroup;

  if (!battleResolutionGroup) {
    return [];
  }

  const destroyedEntityIds = new Set<string>();

  for (const participantSnapshot of battleResolutionGroup.participantSnapshots) {
    if (!hasFieldBattleResolutionMember(state, participantSnapshot)) {
      continue;
    }
    // P2-05 Phase 5: 複数ブロッカー時は各ブロッカーと個別に 1vs1 で比較する
    // (合算比較ではない、10_rules/05b §複数体ブロック強制)。
    for (const blockerSnapshot of participantSnapshot.blockedBy) {
      if (!hasFieldBattleResolutionMember(state, blockerSnapshot)) {
        continue;
      }
      if (participantSnapshot.resolvedBp > blockerSnapshot.resolvedBp) {
        destroyedEntityIds.add(blockerSnapshot.entityId);
        continue;
      }

      if (participantSnapshot.resolvedBp < blockerSnapshot.resolvedBp) {
        destroyedEntityIds.add(participantSnapshot.entityId);
        continue;
      }

      destroyedEntityIds.add(participantSnapshot.entityId);
      destroyedEntityIds.add(blockerSnapshot.entityId);
    }
  }

  return [...destroyedEntityIds];
}

function hasFieldBattleResolutionMember(
  state: GameState,
  entity: BattleResolutionEntitySnapshot
): boolean {
  // snapshot はバトル終了時用の履歴も含む。BP比較・ライフ計算への参加は現在の実体を正源にする。
  const currentMembers =
    getBattleEntityById(state, entity.entityId)?.memberInstanceIds ?? [];
  return entity.memberInstanceIds.some((memberId) => {
    if (!currentMembers.includes(memberId)) return false;
    const card = getCardById(state, memberId);
    return (
      card &&
      card.pendingLeaveKind === null &&
      isCurrentCombatMember(
        state,
        { memberInstanceIds: currentMembers },
        memberId
      )
    );
  });
}

// 10_rules/05b §複数体ブロック強制: 複数ブロッカーは各ブロッカーと個別に BP を比べる。
// 破壊 source も BP 比較ペア単位で保持し、triggerSourceFilter は source 群の any-match で評価する。
function getBattleDestroySourceInstanceIds(options: {
  state: GameState;
  battleResolutionGroup: BattleResolutionGroup;
  destroyedEntityId: string;
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined;
}): string[] {
  const firstBattleCapableMemberId = (
    entity: BattleResolutionEntitySnapshot
  ): string | null => {
    for (const memberId of entity.memberInstanceIds) {
      const card = getCardById(options.state, memberId);
      if (
        !card ||
        card.zone !== "field" ||
        card.attachedToInstanceId !== null
      ) {
        continue;
      }
      const def = options.getCardDefinitionById?.(card.definitionId);
      if (!def) continue;
      if (!isBattleCapableCategory(def, card, options.state)) continue;
      return memberId;
    }
    return null;
  };
  const sourceInstanceIds = new Set<string>();
  const addSourceEntity = (entity: BattleResolutionEntitySnapshot): void => {
    const sourceInstanceId = firstBattleCapableMemberId(entity);
    if (sourceInstanceId !== null) sourceInstanceIds.add(sourceInstanceId);
  };

  for (const participant of options.battleResolutionGroup
    .participantSnapshots) {
    for (const blocker of participant.blockedBy) {
      if (
        blocker.entityId === options.destroyedEntityId &&
        participant.resolvedBp >= blocker.resolvedBp
      ) {
        addSourceEntity(participant);
      }
      if (
        participant.entityId === options.destroyedEntityId &&
        blocker.resolvedBp >= participant.resolvedBp
      ) {
        addSourceEntity(blocker);
      }
    }
  }

  return [...sourceInstanceIds];
}

function queueBattleResolutionDestroys(options: {
  state: GameState;
  chainId: string;
  destroyedEntityIds: readonly string[];
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined;
}): GameState {
  let currentState = options.state;

  for (const entityId of options.destroyedEntityIds) {
    const battleEntity = getBattleEntityById(currentState, entityId);

    if (!battleEntity) {
      continue;
    }
    const causedByBattleSourceInstanceIds = currentState.battleResolutionGroup
      ? getBattleDestroySourceInstanceIds({
          state: currentState,
          battleResolutionGroup: currentState.battleResolutionGroup,
          destroyedEntityId: entityId,
          ...(options.getCardDefinitionById !== undefined
            ? { getCardDefinitionById: options.getCardDefinitionById }
            : {}),
        })
      : [];

    for (const memberInstanceId of battleEntity.memberInstanceIds) {
      const memberCard = getCardById(currentState, memberInstanceId);

      if (!memberCard || memberCard.zone !== "field") {
        continue;
      }

      // 合体スピリットのブレイヴはバトル破壊の対象外。
      // ホスト破壊時に flushPendingLeaves が自動でブレイヴを分離してフィールドに残す。
      if (memberCard.attachedToInstanceId !== null) {
        continue;
      }

      // 転神/転者状態で「創界神ネクサス以外では破壊されない」保護
      if (memberCard.divineTransformState?.protectedFromNonGrandwalker) {
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `battle:divine_transform_protection:${memberInstanceId}`,
          ],
        };
        continue;
      }

      // バトル破壊の causePlayerId は相手プレイヤー（破壊されるカードのコントローラーの対戦相手）
      const opponentPlayerId =
        currentState.playerOrder.find(
          (pid) => pid !== memberCard.controllerPlayerId
        ) ?? null;

      // 「BP比べでは破壊されない」(BSTH09.2-転醒R01(B))。バトルの破壊はすべて
      // BP比べによる破壊なので、本耐性を持つカードはバトルで破壊されない
      // (04_state-based-rules.md §BP比べ破壊)。
      const bpCompareDestroyDecision = resolveBpCompareDestroyAffect(
        currentState,
        memberCard,
        opponentPlayerId,
        options.getCardDefinitionById,
        "none",
        "battle"
      );
      if (bpCompareDestroyDecision.kind !== "allowed") {
        if (
          bpCompareDestroyDecision.kind === "blocked" &&
          bpCompareDestroyDecision.reason === "effect_resistance"
        ) {
          currentState = queuePendingLeave({
            state: currentState,
            instanceId: memberInstanceId,
            kind: "destroy",
            cause: "battle",
            causePlayerId: opponentPlayerId,
            chainId: options.chainId,
            blockedByResistance: true,
            causedByBattleSourceInstanceIds,
          });
          continue;
        }
        currentState = {
          ...currentState,
          log: [
            ...currentState.log,
            `battle:bp_compare_destroy_immunity:${memberInstanceId}`,
          ],
        };
        continue;
      }

      currentState = queuePendingLeave({
        state: currentState,
        instanceId: memberInstanceId,
        kind: "destroy",
        cause: "battle",
        causePlayerId: opponentPlayerId,
        chainId: options.chainId,
        causedByBattleSourceInstanceIds,
      });
    }
  }

  return currentState;
}

function queueBattleDestroyOpponentOnlyTriggers(options: {
  state: GameState;
  battleResolutionGroup: BattleResolutionGroup;
  chainId: string;
  simultaneousGroupId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined;
}): GameState {
  if (typeof options.getRegisteredTriggeredEffectActions !== "function") {
    return options.state;
  }
  const pendingBattleDestroyIds = new Set(
    options.state.pendingLeaveEntities
      .filter(
        (pendingLeave) =>
          pendingLeave.kind === "destroy" &&
          pendingLeave.cause === "battle" &&
          pendingLeave.blockedByResistance !== true
      )
      .map((pendingLeave) => pendingLeave.instanceId)
  );
  if (pendingBattleDestroyIds.size === 0) {
    return options.state;
  }

  const getDestroyedBattleMemberIds = (
    entity: BattleResolutionEntitySnapshot
  ): string[] =>
    entity.memberInstanceIds.filter((memberId) => {
      const card = getCardById(options.state, memberId);
      if (!card || !pendingBattleDestroyIds.has(memberId)) return false;
      const def = options.getCardDefinitionById(card.definitionId);
      if (!def) return false;
      // isBattleCapableCategory (カード状態の共通判定 + 実効種類) を使い、
      // excludeCategory (「〇〇として扱わない」型 override、BSTH03-M01 等) の影響を受けない
      // ようにする。excludeCategory はブロック対象判定等のカテゴリ参照ゲートに限定される
      // べきで、「バトルで相手を破壊した勝者」の誘発発火可否まで抑制するのは原文の射程を
      // 超える (adversarial verifier round2 refute 対応)。brave category も対象に含める:
      // ホストが離れてブレイヴ単独でアタック継続する場合 (P2-10、
      // 05_brave-and-attack-special-cases.md「スピリット状態のブレイヴは独立したスピリット
      // として扱われる」) は memberInstanceIds が brave 単体になり得るため、これを除外する
      // 旧 getEffectiveCategory 基準は「独立したスピリット」原則と不整合だった
      // (adversarial verifier round3 refute 対応、旧コメント「combined 前提で単独では
      // battle 参加できないため挙動差なし」は誤り、getAttackDeclarationBlockReason/
      // getBlockDeclarationBlockReason も同じ isBattleCapableCategory で単独 brave を許可)。
      return isBattleCapableCategory(def, card, options.state);
    });

  const events: CollectedTriggerEvent[] = [];
  const pushWinnerEvent = (
    winner: BattleResolutionEntitySnapshot,
    destroyedLoserIds: readonly string[]
  ) => {
    if (destroyedLoserIds.length === 0) return;

    const winnerCards = winner.memberInstanceIds
      .map((memberId) => getCardById(options.state, memberId))
      .filter(
        (card): card is CardInstance =>
          card !== undefined &&
          card.zone === "field" &&
          card.pendingLeaveKind === null &&
          card.attachedToInstanceId === null
      );
    for (const winnerCard of winnerCards) {
      const winnerDef = options.getCardDefinitionById(winnerCard.definitionId);
      if (!winnerDef) {
        continue;
      }
      // isBattleCapableCategory を使う理由は getDestroyedBattleMemberIds と同じ
      // (excludeCategory がこの誘発発火可否まで抑制しないようにする)。
      if (!isBattleCapableCategory(winnerDef, winnerCard, options.state)) {
        continue;
      }
      const destroyedControllers = new Set(
        destroyedLoserIds
          .map((memberId) => getCardById(options.state, memberId))
          .filter((card): card is CardInstance => card !== undefined)
          .map((card) => card.controllerPlayerId)
      );
      if (
        destroyedControllers.size === 0 ||
        destroyedControllers.has(winnerCard.controllerPlayerId)
      ) {
        continue;
      }
      events.push({
        actingPlayerId: winnerCard.controllerPlayerId,
        eventKind: "battle_destroy_opponent_only",
        source: "battle_resolution",
        chainId: options.chainId,
        attackId: options.battleResolutionGroup.attackId,
        relatedPlayerId: winnerCard.controllerPlayerId,
        relatedInstanceId: winnerCard.instanceId,
        relatedInstanceIds: destroyedLoserIds,
        amount: destroyedLoserIds.length,
      });
    }
  };

  for (const participant of options.battleResolutionGroup
    .participantSnapshots) {
    // P2-05 Phase 5: 複数ブロッカー時は各ブロッカーと個別に勝敗を判定する
    // (合算比較ではない、10_rules/05b §複数体ブロック強制)。
    const destroyedParticipantIds = getDestroyedBattleMemberIds(participant);
    for (const blocker of participant.blockedBy) {
      const destroyedBlockerIds = getDestroyedBattleMemberIds(blocker);
      if (
        destroyedParticipantIds.length === 0 &&
        destroyedBlockerIds.length > 0
      ) {
        pushWinnerEvent(participant, destroyedBlockerIds);
      } else if (
        destroyedBlockerIds.length === 0 &&
        destroyedParticipantIds.length > 0
      ) {
        pushWinnerEvent(blocker, destroyedParticipantIds);
      }
    }
  }

  if (events.length === 0) {
    return options.state;
  }
  const queuedState = queuePendingReactionsFromTriggerEvents(
    options.state,
    events,
    options.simultaneousGroupId,
    {
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
    }
  );
  const deferredInstanceIds = collectBattleDestroyStayDeferredInstanceIds({
    state: queuedState,
    chainId: options.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  });
  if (deferredInstanceIds.size === 0) return queuedState;

  return replaceCardInstances(
    {
      ...queuedState,
      pendingLeaveEntities: queuedState.pendingLeaveEntities.map(
        (pendingLeave) =>
          deferredInstanceIds.has(pendingLeave.instanceId)
            ? { ...pendingLeave, deferZoneMoveUntilChainEnd: true }
            : pendingLeave
      ),
    },
    queuedState.cardInstances.map((card) =>
      deferredInstanceIds.has(card.instanceId)
        ? { ...card, deferZoneMoveUntilChainEnd: true }
        : card
    )
  );
}

function collectBattleDestroyStayDeferredInstanceIds(options: {
  state: GameState;
  chainId: string;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
}): Set<string> {
  const deferredInstanceIds = new Set<string>();
  for (const pending of options.state.pendingTriggeredEffects) {
    if (
      pending.eventKind !== "battle_destroy_opponent_only" ||
      pending.chainId !== options.chainId ||
      !pendingBattleDestroyEffectHasStayOnFieldSource({
        state: options.state,
        pending,
        getCardDefinitionById: options.getCardDefinitionById,
        getRegisteredTriggeredEffectActions:
          options.getRegisteredTriggeredEffectActions,
      })
    ) {
      continue;
    }
    for (const relatedId of pending.relatedInstanceIds ?? []) {
      deferredInstanceIds.add(relatedId);
    }
  }
  return deferredInstanceIds;
}

function pendingBattleDestroyEffectHasStayOnFieldSource(options: {
  state: GameState;
  pending: PendingTriggeredEffect;
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined;
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup;
}): boolean {
  return getAvailableTriggeredEffectSourceChoices({
    state: options.state,
    pendingEffect: options.pending,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
  }).some((sourceChoice) => {
    const effectIndex =
      sourceChoice.actionRegistration.effectIndex ??
      sourceChoice.registrationIndex;
    return (
      sourceChoice.sourceEffectDefinition.effects?.[effectIndex]?.steps.some(
        (step) => step.action.kind === "stay_on_field"
      ) ?? false
    );
  });
}

function resetBattleEntitiesAfterResolution(
  state: GameState,
  attackId: string,
  getCardDefinitionById?: (definitionId: string) => CardDefinition | undefined
): GameState {
  const nextBattleEntities = resetBattleEntitiesAfterAttackEnd(state);

  state.log.push(
    `battle:resolution:end:${attackId}`,
    `battle:end:${attackId}`,
    `attack:end:${attackId}`
  );
  // scope:"battle" CE の失効 / battle-state 依存 CE の再評価は `fireBattleEndDeferrals`
  // 後の `finalizeBattleEndScopeExpirations` でまとめて行う。10_rules/02 L167
  // 「バトル終了時 に誘発する効果を先に解決し、バトル中のみ有効な効果が失効してから
  // バトル終了。」に従い、deferred 解決中は battle CE (effect_immunity duration:battle 等)
  // を保持しなければならない。
  // 注意: `recomputeContinuousEffects` (legal-actions-shared.ts) は activeAttack:null
  // の状態で呼ばれると scope:"battle" CE を createdAtAttackId 不一致として除去するため、
  // `recomputeAndRebuildBattleStateContinuousEffects` (内部で recomputeContinuousEffects
  // を呼ぶ) も finalize 側に移す必要がある。
  // BP のみは battleEntities reset 直後に refresh しておく (battle-state-dependent CE は
  // predicate 不一致で BP に効かない。scope:"battle" simple duration CE は deferred 解決
  // までは BP に反映され続けるが、最終 finalize で除去後再 recompute される)。
  let result: GameState = {
    ...state,
    battleEntities: nextBattleEntities,
    activeAttack: null,
    battleResolutionGroup: null,
    window: "none",
  };

  if (getCardDefinitionById) {
    result = recomputeBattleEntityBp(result, getCardDefinitionById);
  }

  return result;
}

/**
 * `pendingBattleEndDeferrals` のうち、いま解決し終えた `attackId` のバトルに紐づく予約を発火する。
 *
 * ルール正源: 10_rules/02_turn-flow-and-timing.md「バトル終了時 に誘発する効果を先に解決し」。
 * `resetBattleEntitiesAfterResolution` 後 (activeAttack クリア後) に呼ぶ。R12 の `end_attack_step`
 * は `state.step === "attack"` のまま発火するためアタックステップ全体を `end` へ遷移できる。
 *
 * 条件 (例: 創界神/導界者ネクサスの有無) は予約時ではなく本発火時に `executeEffect` 内で再評価する。
 * 同一バトルに複数予約があれば順に発火する (先発の `end_attack_step` で step が変われば後続は no-op)。
 *
 * `participantSnapshots`: 呼び出し元が `resetBattleEntitiesAfterResolution` 前に読んだローカル
 * `battleResolutionGroup.participantSnapshots`。`groupMode:"simultaneous"` では複数の攻撃体が
 * 並ぶため、「このバトルはブロックされたか」(`ConditionClause.kind:"battle_was_blocked"`、
 * BSFT01-X01 型) は attackId 全体の any-participant ではなく、各 deferral の sourceInstanceId が
 * 属する参加体 (memberInstanceIds) 1件だけの blockedBy で判定する (deferral ごとに算出)。
 *
 * `appliedLifeDamage`: 呼び出し元が同一解決内で算出した、対象プレイヤーへ実際に適用された
 * ライフ減少量 (attackId 全体・単一の battle 解決に対するスカラー値)。`battle_was_blocked` と
 * 同様、deferral ごとに「このスピリット自身のアタックが寄与したか」へ絞り込む必要があるため、
 * `groupMode:"simultaneous"`（複数体同時アタック）で他の参加体がブロックされずライフを
 * 減らした場合でも、この deferral の sourceInstanceId 自身がブロックされていれば
 * `battleLifeReduced=false`（このスピリットの寄与はゼロ、`getUnblockedLifeDamage` が
 * `snapshot.blockedBy.length > 0` の参加体を合算対象から除外するのと同じ扱い）とする
 * (adversarial verifier 2026-07-22 round1 lens1 指摘の修正、ENGINE-battle-reduce-life-source-instance
 * と同じ「単一 attacker に一意特定できないときは fail-close」思想)。
 *
 * `participantOwnSymbols`: `getUnblockedLifeDamage` が算出した、各参加体の個別 cap/免疫
 * 適用後 symbols 数 (SSOT、同関数のコメント参照)。`groupMode:"simultaneous"` の複数参加体
 * では appliedLifeDamage はバトル全体の合算スカラーのため、自分自身がブロックされていなくても
 * 個別 cap で symbols=0 にクランプされていれば自分の寄与は0と確定できる。floor/turn_cap/
 * bpTurnCap 一致参加体は、グループ単位クランプにより最終クランプ後の実寄与を参加体単位に
 * 一意特定できないため fail-close で 0 がセットされる (`getUnblockedLifeDamage` 側のコメント
 * 参照) — (adversarial verifier 2026-07-22 round2/round3/round4 lens3 指摘の修正、
 * resolvedSymbols 直読みの並行計算を廃し `getUnblockedLifeDamage` の正源値を参照する形に変更)。
 */
function fireBattleEndDeferrals(
  state: GameState,
  attackId: string,
  participantSnapshots: readonly BattleResolutionParticipantSnapshot[],
  getCardDefinitionById:
    | ((definitionId: string) => CardDefinition | undefined)
    | undefined,
  getRegisteredTriggeredEffectActions: TriggeredEffectActionRegistrationLookup,
  getRegisteredBurstActions: BurstActionRegistrationLookup | undefined,
  appliedLifeDamage: number,
  participantOwnSymbols: ReadonlyMap<string, number>,
  pendingImmediateBattleEndContext: Pick<
    PendingImmediateBattleEnd,
    | "participantInstanceIds"
    | "blockSideInstanceIds"
    | "destroyedRecords"
    | "appliedLifeDamage"
    | "participantOwnSymbols"
  >
): GameState {
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

  if (!getCardDefinitionById) return currentState;

  const enrichDeferral = (
    deferral: PendingBattleEndDeferral
  ): PendingBattleEndDeferral => {
    const ownSnapshot = participantSnapshots.find((snapshot) =>
      snapshot.memberInstanceIds.includes(deferral.sourceInstanceId)
    );
    const wasBlocked = ownSnapshot ? ownSnapshot.blockedBy.length > 0 : false;
    const isSoleParticipant = participantSnapshots.length <= 1;
    const ownContributed =
      isSoleParticipant ||
      (ownSnapshot
        ? (participantOwnSymbols.get(ownSnapshot.entityId) ?? 0) > 0
        : false);
    const battleLifeReduced =
      !wasBlocked && ownContributed && appliedLifeDamage > 0;
    return {
      ...deferral,
      battleEndDeferralWasBlocked: wasBlocked,
      battleEndDeferralLifeReduced: battleLifeReduced,
    };
  };

  for (let index = 0; index < matching.length; index += 1) {
    const deferral = enrichDeferral(matching[index]!);
    const definition = getCardDefinitionById(deferral.sourceDefinitionId);
    const effect =
      deferral.resumeEffectOverride ??
      definition?.effects?.[deferral.effectIndex];
    if (!effect) continue;
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
    // このスピリット自身がブロックされていれば、バトル全体のライフ減少が他の同時アタック
    // 参加体由来であっても、このスピリットの寄与はゼロ (fail-close)。
    // 単独アタック (participantSnapshots が1件) なら appliedLifeDamage はそのまま自分の寄与。
    // groupMode:"simultaneous" の複数参加体では appliedLifeDamage はバトル全体の合算スカラー
    // のため、getUnblockedLifeDamage が算出した自分自身の個別 cap 適用後 symbols 数
    // (participantOwnSymbols、SSOT) が 0 なら自分の寄与は0と確定できる。
    currentState.log.push(
      `battle:end-deferral:fire:${attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`
    );
    currentState = resolveBattleEndDeferral({
      state: currentState,
      deferral,
      wasBlocked: deferral.battleEndDeferralWasBlocked ?? false,
      battleLifeReduced: deferral.battleEndDeferralLifeReduced ?? false,
      getCardDefinitionById,
      getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions,
    });
    if (hasOutstandingEffectResolutionContinuation(currentState)) {
      const remainingDeferrals = matching
        .slice(index + 1)
        .map((remaining) => enrichDeferral(remaining));
      return {
        ...currentState,
        pendingBattleEndDeferrals: [
          ...currentState.pendingBattleEndDeferrals,
          ...remainingDeferrals,
        ],
        pendingImmediateBattleEnds:
          remainingDeferrals.length > 0
            ? [
                ...currentState.pendingImmediateBattleEnds,
                {
                  attackId,
                  participantSnapshots,
                  ...pendingImmediateBattleEndContext,
                  battleEndEntryStarted: true,
                },
              ]
            : currentState.pendingImmediateBattleEnds,
        log: [
          ...currentState.log,
          `battle:end-deferral:paused:${attackId}:${deferral.sourceInstanceId}:${deferral.effectIndex}`,
        ],
      };
    }
  }

  return currentState;
}

export function usePassPreDeclarationStackAsAction(
  options: UsePassPreDeclarationStackAsActionOptions
): PassPreDeclarationStackResult {
  const { state, actingPlayerId } = options;
  const win = state.preDeclarationStackWindow;

  if (!win || state.window !== "pre_declaration_stack") {
    throw new Error(
      `Pass pre-declaration stack is not legal: actingPlayer=${actingPlayerId} reason=not_in_pre_declaration_stack_window`
    );
  }

  if (win.priorityPlayerId !== actingPlayerId) {
    throw new Error(
      `Pass pre-declaration stack is not legal: actingPlayer=${actingPlayerId} reason=not_priority_player`
    );
  }

  // 1-pass close + LIFO cascade (2026-03-31 user-confirmed rule):
  // 片方がパスした時点で pre_declaration_stack 窓は即閉じ、保留スタックは LIFO で全て解決。
  const resolvedStacks: ActiveStack[] = [];
  let workingWindow: PreDeclarationStackWindow = win;
  while (workingWindow.pendingStackAction !== null) {
    const {
      resolvedStack: peeledStack,
      restoredPendingStackAction,
      restoredResponseSourcePlayerId,
      restoredPriorityPlayerId,
    } = peelResolvedStack({ windowState: workingWindow });
    resolvedStacks.push(peeledStack);
    state.log.push(
      `pre-declaration:sub-stack:closed:${win.kind}:${peeledStack.stackId}:${actingPlayerId}`
    );
    workingWindow = {
      ...workingWindow,
      pendingStackAction: restoredPendingStackAction,
      stackResponseSourcePlayerId: restoredResponseSourcePlayerId,
      priorityPlayerId: restoredPriorityPlayerId,
      consecutivePassCount: 0,
    };
  }

  state.log.push(`pre-declaration:closed:${win.kind}:${actingPlayerId}`);
  return {
    outcome: "stack_closed",
    closedWindow: win,
    resolvedStack: null,
    resolvedStacks,
    state: {
      ...state,
      preDeclarationStackWindow: null,
    },
  };
}
