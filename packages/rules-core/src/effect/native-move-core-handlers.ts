import { requireCardZone } from "../model";
import {
  moveUninstantiatedCards,
  replaceCardInstances,
} from "../zone/card-instance-state";
import { isCardInEffectZone } from "./card-access-rules";
import { getCoreDistributionAllocationCapacity } from "../core/core-distribution-constraints";
// P2-14 inc4: effect-interpreter god-file 分解。カード移動・コア移動/分配・待機効果抑制・
// ライフダメージ迎撃登録の native handler 群を兄弟ファイルへ抽出。共有 helper
// (nextDslCeId / convertCoreLocation / resolveCountToNumber) は native-action-shared から
// 一方向 import (P2-14 inc5 で循環解消)。barrel/振る舞い不変。

import {
  nextDslCeId,
  convertCoreLocation,
  matchesHostCardFilter,
  resolveCountToNumber,
} from "./native-action-shared";
import { getCardById } from "../card/card-lookup";
import {
  resolveZoneMoveHandGainCost,
  type HandGainCostExecutionOptions,
} from "./hand-gain-cost";
import {
  matchesCardFilter,
  shouldExcludeAttachedCombinedChildForFieldCategoryFilter,
} from "../card/card-filter";
import {
  canMoveCoresFrom,
  canMoveNormalCoresFrom,
  collectNonLifeNormalCoreSources,
} from "../core/core-movability";
import { getDefaultZoneRoleName } from "../factories";
import { attachAsAdventSource } from "../mechanics/advent-system";
import { removeBattleEntityMembersAndRecompute } from "../battle/battle-shared";
import {
  getTotalCoresOnCardById,
  moveNormalCores,
  moveCardZone,
  resolveCardLeavesFieldCores,
} from "../core/core-system";
import {
  computeCoreDistributionNormalMoveCapacity,
  type NormalCoreDistributionSourceChunk,
} from "../core/core-distribution-flow";
import {
  getEffectiveColors,
  getEffectiveLevelCostDelta,
  isCardUseRestricted,
} from "../legal/legal-actions-shared";
import { getEffectiveLevel } from "../battle/battle-shared";
import {
  hasDiscardOnLeaveRestriction,
  resolveActAsSpiritMinimumRequiredCores,
} from "../mechanics/act-as-spirit";
import {
  countTextRoleUnderCards,
  getEffectiveUnderCardSlotCap,
} from "../mechanics/star-garment-utils";
import {
  applyFreeMirageSetBookkeeping,
  planMirageSetReplacements,
  resolveMirageReplacementSelection,
  getPlayerMirageSetStates,
  removeMirageSetState,
} from "../mechanics/mirage-system";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";
import {
  collectUnderCardScopeIds,
  hasEnterFieldOnlyCorePlacementRestriction,
  stripUnderCardReferences,
} from "../model";
import { createStepExecutionContext } from "../step-execution-context";
import { getAvailableTriggeredEffectSourceChoices } from "./trigger-system";
import {
  processMovedToTrashEffects,
  resolvePlayerRef,
} from "./structured-effect-interpreter";
import {
  resolveCorePlacementFromVoidAffect,
  resolveCardImmunityAffectDecisions,
  resolveDeckDiscardContainerAffect,
  isDeckDiscardExcludeRedirectActive,
  type CardEffectSource,
} from "./effect-affect-adapter";
import { resolveAffectSourceIdentity } from "./effect-source-identity";
import { isHandGainPreventedByOwnEffect } from "./effect-resistance-check";
import { resolveTargetSpec } from "./target-resolution";
import {
  coreShootCardMatchesFilter,
  getFieldCoreSourceTakeableCount,
  resolveFieldCoreSourceMinRemaining,
} from "./structured-core-shoot";
import { buildChargeCoresPendingCoreDistribution } from "../mechanics/core-charge-distribution";
import { queuePendingLeave } from "../state-based-actions";
import type {
  CardDefinition,
  CardInstance,
  ContinuousEffect,
  ContinuousEffectTag,
  CoreDistributionAllowedSource,
  EffectCoreLocation,
  EffectPlayerRef,
  EffectPreventionLevel,
  EffectTiming,
  GameState,
  PendingLeaveKind,
  PendingTriggeredEffect,
  PlayerState,
  Zone,
} from "../model";
import type { DSL, Effect } from "../dsl-types";
import type { StepExecutionContext } from "../step-execution-context";
import type { TargetLockBypassProfile } from "./target-affect-gate";

function shuffleUnseenMoveCandidates<T>(candidates: readonly T[]): T[] {
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

type MoveCardExecutionPlan = {
  fromPlayer: string;
  toPlayer: string;
  fromZones: readonly Zone[];
  sourceCard: CardInstance | undefined;
  count: number;
  toMove: CardInstance[];
  hiddenDeckMoveCount: number;
  deckDiscardBlocked: boolean;
  deckDiscardExcludeRedirect: boolean;
};

function resolveMoveCardExecutionPlan(args: {
  action: DSL.MoveCardAction;
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepCtx: StepExecutionContext;
  resolvedTargetIds?: readonly string[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
  shuffleUnseen: boolean;
}): MoveCardExecutionPlan {
  const {
    action,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepCtx,
    resolvedTargetIds,
    sourcePreventionLevel,
    sourcePreventionBypass,
    shuffleUnseen,
  } = args;
  const fromPlayer = resolvePlayerRef(
    actingPlayerId,
    action.from.player,
    state
  );
  const toPlayer = action.to.player
    ? resolvePlayerRef(actingPlayerId, action.to.player, state)
    : fromPlayer;
  const fromZones: readonly Zone[] = Array.isArray(action.from.zone)
    ? action.from.zone
    : [action.from.zone];
  const isSingleFromZone = (zone: Zone): boolean =>
    fromZones.length === 1 && fromZones[0] === zone;
  let candidates = state.cardInstances.filter(
    (c) =>
      c.ownerPlayerId === fromPlayer &&
      isCardInEffectZone(
        state,
        c,
        fromZones,
        actingPlayerId,
        getCardDefinitionById
      )
  );
  const underCardIds = collectUnderCardScopeIds(state);
  if (action.from.sourceUnderCardRole) {
    const sourceCard = state.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    );
    const sourceUnderCardIds = new Set(
      (sourceCard?.underCards ?? [])
        .filter((entry) => entry.role === action.from.sourceUnderCardRole)
        .map((entry) => entry.cardInstanceId)
    );
    candidates = candidates.filter((c) => sourceUnderCardIds.has(c.instanceId));
  }
  if (action.from.hostFilter && action.from.hostUnderCardRoleTag) {
    const roleTag = action.from.hostUnderCardRoleTag;
    const hostFilter = action.from.hostFilter;
    const hostCandidates = state.cardInstances.filter(
      (c) =>
        c.ownerPlayerId === fromPlayer &&
        c.zone === "field" &&
        c.attachedToInstanceId === null
    );
    const matchingHosts = hostCandidates.filter((c) => {
      const def = getCardDefinitionById(c.definitionId);
      if (!def) return false;
      return matchesHostCardFilter(
        state,
        c,
        def,
        hostFilter,
        getCardDefinitionById,
        { underCardIds }
      );
    });
    const hostUnderCardIds = new Set(
      matchingHosts.flatMap((host) =>
        host.underCards
          .filter(
            (entry) => entry.role === "text_role" && entry.roleTag === roleTag
          )
          .map((entry) => entry.cardInstanceId)
      )
    );
    candidates = candidates.filter((c) => hostUnderCardIds.has(c.instanceId));
  }

  if (isSingleFromZone("deck") && action.from.position === "bottom") {
    candidates = [...candidates].reverse();
  }

  if (action.from.filter) {
    const filter = action.from.filter;
    candidates = candidates.filter((c) => {
      const def = getCardDefinitionById(c.definitionId);
      if (!def) return false;
      return matchesCardFilter(c, def, filter, {
        effectiveColors: getEffectiveColors(state, c, def),
        effectiveLevel:
          c.zone === "field"
            ? getEffectiveLevel(state, c, def, getCardDefinitionById)
            : undefined,
        underCardIds,
      });
    });
  }
  const count = resolveCountToNumber(
    action.count,
    state,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
  // 「デッキの上/下からN枚」は、個別カードの効果耐性より先に位置付きの取得窓を確定する。
  // 先頭カードが耐性を持つからといって N+1 枚目を繰り上げて移動してはならない。
  const fixedDeckPositionWindow =
    isSingleFromZone("deck") &&
    action.from.position !== undefined &&
    action.target === undefined &&
    count !== -1
      ? candidates.slice(0, count)
      : undefined;
  // 実体化済みのデッキ候補数は耐性判定前に保持する。後段の hiddenDeckMoveCount は
  // 「state に存在しない残りデッキ」だけを表すため、耐性で除外した既知カードを
  // hidden card と取り違えて deckCount だけ減らしてはならない。
  const deckMoveCandidatesBeforeImmunity =
    fixedDeckPositionWindow ?? candidates;
  const sourceCard = getCardById(state, sourceInstanceId);
  candidates = resolveCardImmunityAffectDecisions(
    state,
    fixedDeckPositionWindow ?? candidates,
    actingPlayerId,
    sourcePreventionLevel,
    {
      instance: sourceCard,
      definition: sourceCard
        ? getCardDefinitionById(sourceCard.definitionId)
        : undefined,
      effectActivationTiming: stepCtx.effectActivationTiming,
    },
    getCardDefinitionById,
    sourcePreventionBypass
  )
    .filter(({ decision }) => decision.kind === "allowed")
    .map(({ card }) => card);
  const explicitMoveCandidates = action.target
    ? action.target.kind === "self" && sourceCard
      ? candidates.filter((c) => c.instanceId === sourceCard.instanceId)
      : (resolvedTargetIds ?? []).flatMap((id) => {
          const card = candidates.find((c) => c.instanceId === id);
          return card ? [card] : [];
        })
    : null;
  let toMove =
    explicitMoveCandidates !== null
      ? count === -1
        ? explicitMoveCandidates
        : explicitMoveCandidates.slice(0, count)
      : count === -1
        ? candidates
        : fixedDeckPositionWindow !== undefined
          ? candidates
          : (action.unseen === true && shuffleUnseen
              ? shuffleUnseenMoveCandidates(candidates)
              : candidates
            ).slice(0, count);
  if (
    action.to.zone === "mirage" &&
    action.mirageSourceInstanceIds !== undefined
  ) {
    const fixed = action.mirageSourceInstanceIds;
    if (
      new Set(fixed).size !== fixed.length ||
      (count !== -1 && fixed.length > count) ||
      fixed.some((id) => !candidates.some((card) => card.instanceId === id))
    )
      throw new Error("Invalid fixed mirage sources");
    toMove = fixed.map(
      (id) => candidates.find((card) => card.instanceId === id)!
    );
  }
  if (explicitMoveCandidates !== null && explicitMoveCandidates.length === 0) {
    toMove = [];
  }
  if (action.to.zone === "field" && !action.to.sourceUnderCardRole) {
    toMove = toMove.filter((card) => {
      if (card.zone === "field") return true;
      const definition = getCardDefinitionById(card.definitionId);
      return (
        !definition ||
        !isCardUseRestricted(
          state,
          toPlayer,
          card,
          definition,
          getCardDefinitionById,
          "put_on_field",
          { byEffect: true }
        )
      );
    });
  }
  if (
    action.requireFullCount === true &&
    count !== -1 &&
    toMove.length < count
  ) {
    toMove = [];
  }
  if (
    action.to.sourceUnderCardRole === "text_role" &&
    action.to.textRoleTag &&
    sourceCard
  ) {
    const roleTag = action.to.textRoleTag;
    const sourceHostDef = getCardDefinitionById(sourceCard.definitionId);
    const effectiveCap = sourceHostDef
      ? getEffectiveUnderCardSlotCap(
          state,
          sourceCard,
          sourceHostDef,
          roleTag,
          getCardDefinitionById
        )
      : undefined;
    if (effectiveCap !== undefined) {
      const openSlots = Math.max(
        0,
        effectiveCap -
          countTextRoleUnderCards(
            sourceCard,
            roleTag,
            state,
            getCardDefinitionById
          )
      );
      toMove = toMove.slice(0, openSlots);
    }
  }
  const fromPlayerDeckCount =
    state.players.find((p) => p.id === fromPlayer)?.deckCount ?? 0;
  const isDeckToTrash = isSingleFromZone("deck") && action.to.zone === "trash";
  const isDeckDiscard = isDeckToTrash && action.deckDiscard === true;
  const deckDiscardBlocked =
    isDeckDiscard &&
    resolveDeckDiscardContainerAffect(
      state,
      fromPlayer,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass
    ).kind !== "allowed";
  const requestedDeckMoveCount =
    explicitMoveCandidates !== null
      ? toMove.length
      : !deckDiscardBlocked && isDeckToTrash && count !== -1
        ? Math.min(fromPlayerDeckCount, count)
        : !deckDiscardBlocked && isDeckToTrash && count === -1
          ? fromPlayerDeckCount
          : toMove.length;
  const knownDeckMoveCountBeforeImmunity =
    explicitMoveCandidates !== null
      ? requestedDeckMoveCount
      : !isDeckToTrash
        ? 0
        : count === -1
          ? deckMoveCandidatesBeforeImmunity.length
          : Math.min(deckMoveCandidatesBeforeImmunity.length, count);
  const hiddenDeckMoveCount = isDeckToTrash
    ? Math.max(0, requestedDeckMoveCount - knownDeckMoveCountBeforeImmunity)
    : 0;
  // BSTH05.5-X02 Lv2【導域】: 相手へのデッキ破棄効果をデッキ除外効果へ書き換える
  // redirect_deck_discard_to_exclude CE。ブロック (deckDiscardBlocked) されていない
  // `deckDiscard: true` の移動に限り、移動先を trash から removed_from_game へ差し替える。
  const deckDiscardExcludeRedirect =
    isDeckDiscard &&
    !deckDiscardBlocked &&
    isDeckDiscardExcludeRedirectActive(state, fromPlayer);

  return {
    fromPlayer,
    toPlayer,
    fromZones,
    sourceCard,
    count,
    toMove,
    hiddenDeckMoveCount,
    deckDiscardBlocked,
    deckDiscardExcludeRedirect,
  };
}

export function canExecuteMoveCardAction(args: {
  action: DSL.MoveCardAction;
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  stepCtx: StepExecutionContext;
  resolvedTargetIds?: readonly string[];
  sourcePreventionLevel?: EffectPreventionLevel;
  sourcePreventionBypass?: TargetLockBypassProfile;
}): boolean {
  const plan = resolveMoveCardExecutionPlan({ ...args, shuffleUnseen: false });
  if (plan.deckDiscardBlocked) return false;
  // BSRK01-X01 型「(対象)は、(対象)の効果で手札を増やせない」は、既存の
  // draw / bounce / search 系だけでなく、汎用 zone primitive である move_card にも
  // 適用する。移動先プレイヤー自身が発揮した、hand 外から hand への純増だけを
  // 禁止するため、相手の効果でカードを手札へ戻す場合や hand→hand の no-op は妨げない。
  if (
    args.action.to.zone === "hand" &&
    plan.toMove.some((card) => card.zone !== "hand") &&
    isHandGainPreventedByOwnEffect(
      args.state,
      plan.toPlayer,
      args.actingPlayerId
    )
  ) {
    return false;
  }
  if (args.action.to.sourceUnderCardRole !== undefined) {
    if (!plan.sourceCard || plan.sourceCard.zone !== "field") return false;
  }
  return plan.toMove.length > 0 || plan.hiddenDeckMoveCount > 0;
}

/** 実際のmove_cardと同じ対象・耐性経路で、効果セット前の個体を固定する。 */
export function getMoveCardMirageSetSources(
  args: Parameters<typeof canExecuteMoveCardAction>[0]
): { playerId: string; sourceInstanceIds: string[] } {
  const plan = resolveMoveCardExecutionPlan({ ...args, shuffleUnseen: true });
  return {
    playerId: plan.toPlayer,
    sourceInstanceIds: plan.toMove
      .filter(
        (card) => args.getCardDefinitionById(card.definitionId)?.mirageData
      )
      .map((card) => card.instanceId),
  };
}

export function executeSuppressPendingLeaveEffects(
  state: GameState,
  targetIds: string[] | undefined,
  suppressDestroyedEffects: "destroyed_only" | "all_opponent",
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  getRegisteredTriggeredEffectActions?: import("./trigger-system").TriggeredEffectActionRegistrationLookup
): GameState {
  if (!targetIds || targetIds.length === 0) return state;
  const targetSet = new Set(targetIds);
  const blockedTargetSet = new Set(
    state.pendingLeaveEntities
      .filter(
        (pendingLeave) =>
          targetSet.has(pendingLeave.instanceId) &&
          pendingLeave.kind === "destroy" &&
          pendingLeave.blockedByResistance === true
      )
      .map((pendingLeave) => pendingLeave.instanceId)
  );
  const suppressTargetSet = new Set(
    [...targetSet].filter((targetId) => !blockedTargetSet.has(targetId))
  );
  if (suppressTargetSet.size === 0) return state;
  let changed = false;
  // engine-generic-effect-activation-causal-trigger: カード原文「フィールドを
  // 離れる…効果は発揮されない」は destroy に限らず vanish/bounce/remove_from_game
  // 全ての離脱経路を含む。suppressDestroyedEffects というフィールド名は destroy
  // 由来だが、離脱理由 (kind) を問わず一律に適用する (destroy 限定ではない)。
  const pendingLeaveEntities = state.pendingLeaveEntities.map(
    (pendingLeave) => {
      if (!suppressTargetSet.has(pendingLeave.instanceId)) return pendingLeave;
      if (pendingLeave.suppressDestroyedEffects === suppressDestroyedEffects) {
        return pendingLeave;
      }
      changed = true;
      return { ...pendingLeave, suppressDestroyedEffects };
    }
  );
  const suppressedTriggerLogs: string[] = [];
  const pendingTriggeredEffects = state.pendingTriggeredEffects.flatMap(
    (pending): PendingTriggeredEffect[] => {
      if (
        pending.eventKind !== "destroy" &&
        pending.eventKind !== "vanish" &&
        pending.eventKind !== "bounce" &&
        pending.eventKind !== "remove_from_game" &&
        pending.eventKind !== "leave_field"
      ) {
        return [pending];
      }
      if (
        !pending.relatedInstanceId ||
        !suppressTargetSet.has(pending.relatedInstanceId)
      ) {
        return [pending];
      }
      if (suppressDestroyedEffects === "all_opponent") {
        changed = true;
        suppressedTriggerLogs.push(
          `trigger:effect-suppressed:${pending.pendingId}:all`
        );
        return [];
      }
      const sourceIds = pending.resolvedSourceInstanceIds ?? [];
      if (
        sourceIds.length > 0 &&
        sourceIds.every((sourceId) => suppressTargetSet.has(sourceId))
      ) {
        changed = true;
        for (const sourceId of sourceIds) {
          suppressedTriggerLogs.push(
            `trigger:effect-suppressed:${pending.pendingId}:${sourceId}`
          );
        }
        return [];
      }
      const suppressed = new Set(pending.suppressedSourceInstanceIds ?? []);
      for (const targetId of suppressTargetSet) suppressed.add(targetId);
      const suppressedSourceInstanceIds = Array.from(suppressed);
      const nextPending = { ...pending, suppressedSourceInstanceIds };
      if (getRegisteredTriggeredEffectActions !== undefined) {
        const sourceChoices = getAvailableTriggeredEffectSourceChoices({
          state,
          pendingEffect: nextPending,
          getCardDefinitionById,
          getRegisteredTriggeredEffectActions,
        }).filter(
          (sourceChoice) =>
            nextPending.effectSuppressed !== true &&
            !suppressed.has(sourceChoice.sourceCard.instanceId)
        );
        if (sourceChoices.length === 0) {
          changed = true;
          suppressedTriggerLogs.push(
            `trigger:effect-suppressed:${pending.pendingId}:${pending.relatedInstanceId}`
          );
          return [];
        }
      }
      if (
        pending.suppressedSourceInstanceIds?.length ===
          suppressedSourceInstanceIds.length &&
        pending.suppressedSourceInstanceIds.every((id) => suppressed.has(id))
      ) {
        return [pending];
      }
      changed = true;
      return [nextPending];
    }
  );
  const pendingBurstChecks = state.pendingBurstChecks.map((pending) => {
    if (suppressDestroyedEffects !== "all_opponent") return pending;
    if (
      pending.event?.family !== "leave_field" &&
      pending.eventKind !== "leave_field"
    ) {
      return pending;
    }
    if (
      !pending.relatedInstanceId ||
      !suppressTargetSet.has(pending.relatedInstanceId)
    ) {
      return pending;
    }
    if (pending.effectSuppressed === true) return pending;
    changed = true;
    return { ...pending, effectSuppressed: true };
  });
  const next: GameState = {
    ...state,
    pendingLeaveEntities,
    pendingTriggeredEffects,
    pendingBurstChecks,
  };
  if (!changed) return state;
  return {
    ...next,
    log: [
      ...next.log,
      `effect:suppress-pending-leave-effects:${Array.from(suppressTargetSet).join(",")}:${suppressDestroyedEffects}`,
      ...suppressedTriggerLogs,
    ],
  };
}

export function executeSetSelfAsMirage(
  action: DSL.SetSelfAsMirageAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  /**
   * `action.target` 解決済みの対象カード（ENGINE-mirage-set-target-primitive）。
   * 省略時は従来通り `sourceInstanceId`（発揮元カード自身）を対象にする。
   */
  targetInstanceId?: string
): GameState {
  const mirageCardInstanceId = targetInstanceId ?? sourceInstanceId;
  const sourceCard = getCardById(state, mirageCardInstanceId);
  if (!sourceCard) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:set_self_as_mirage:skipped:source_not_found:${mirageCardInstanceId}`,
      ],
    };
  }

  if (sourceCard.controllerPlayerId !== actingPlayerId) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:set_self_as_mirage:skipped:not_controlled:${mirageCardInstanceId}`,
      ],
    };
  }

  const sourceDefinition = getCardDefinitionById(sourceCard.definitionId);
  if (!sourceDefinition?.mirageData) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:set_self_as_mirage:skipped:no_mirage_data:${mirageCardInstanceId}`,
      ],
    };
  }

  const existingMirages = getPlayerMirageSetStates(state, actingPlayerId);
  if (
    existingMirages.some(
      (entry) => entry.cardInstanceId === mirageCardInstanceId
    )
  )
    return state;
  if (action.onlyIfNoMirage && existingMirages.length > 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `effect:set_self_as_mirage:skipped:existing:${mirageCardInstanceId}:${existingMirages.map((s) => s.cardInstanceId).join(",")}`,
      ],
    };
  }
  const replaced = resolveMirageReplacementSelection({
    state,
    actingPlayerId,
    sourceDefinition,
    getCardDefinitionById,
    ...(action.replacedMirageInstanceIds !== undefined
      ? { replacedMirageInstanceIds: action.replacedMirageInstanceIds }
      : {}),
  });
  const moved = moveCardZone(
    state,
    mirageCardInstanceId,
    "mirage",
    getDefaultZoneRoleName(sourceDefinition, "mirage")
  );
  const placed = applyFreeMirageSetBookkeeping(
    moved,
    actingPlayerId,
    mirageCardInstanceId,
    getCardDefinitionById,
    replaced
  );
  return {
    ...placed,
    log: [
      ...placed.log,
      ...replaced.map(
        (id) =>
          `effect:set_self_as_mirage:replace:${mirageCardInstanceId}:${id}`
      ),
      replaced.length === 0
        ? `effect:set_self_as_mirage:set:${mirageCardInstanceId}`
        : `effect:set_self_as_mirage:set:${mirageCardInstanceId}:replaced:${replaced.length}`,
    ],
  };
}

// --- move_card: ゾーン間カード移動 ---

export function executeMoveCard(
  action: DSL.MoveCardAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  resolvedTargetIds?: string[],
  sourcePreventionLevel?: EffectPreventionLevel,
  sourcePreventionBypass?: TargetLockBypassProfile,
  handGainCostOptions: HandGainCostExecutionOptions = {}
): GameState {
  requireCardZone(action.to.zone);
  const plan = resolveMoveCardExecutionPlan({
    action,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepCtx,
    ...(resolvedTargetIds !== undefined ? { resolvedTargetIds } : {}),
    ...(sourcePreventionLevel !== undefined ? { sourcePreventionLevel } : {}),
    ...(sourcePreventionBypass !== undefined ? { sourcePreventionBypass } : {}),
    shuffleUnseen: true,
  });
  const {
    fromPlayer,
    toPlayer,
    fromZones,
    sourceCard,
    toMove: plannedToMove,
    hiddenDeckMoveCount,
    deckDiscardBlocked,
    deckDiscardExcludeRedirect,
  } = plan;
  let toMove = plannedToMove;
  const toZone = action.to.zone;
  if (
    toZone === "hand" &&
    toMove.some((card) => card.zone !== "hand") &&
    isHandGainPreventedByOwnEffect(state, toPlayer, actingPlayerId)
  ) {
    state.log.push(
      `effect:move_card:blocked-by-hand-gain-prevention:${actingPlayerId}:${toPlayer}`
    );
    return state;
  }
  if (toZone === "mirage") {
    const mirageCapable = toMove.filter((card) => {
      const def = getCardDefinitionById(card.definitionId);
      return !!def?.mirageData;
    });
    const skipped = toMove.length - mirageCapable.length;
    if (skipped > 0) {
      state.log.push(`effect:move_card:mirage:skipped_non_mirage:${skipped}`);
    }
    toMove = mirageCapable;
  }
  const miragePlan =
    toZone === "mirage"
      ? planMirageSetReplacements({
          state,
          actingPlayerId: toPlayer,
          sourceInstanceIds: toMove.map((card) => card.instanceId),
          getCardDefinitionById,
          ...(action.mirageReplacementsByInstanceId !== undefined
            ? {
                replacementsByInstanceId: action.mirageReplacementsByInstanceId,
              }
            : {}),
        })
      : undefined;
  if (miragePlan?.unresolved)
    throw new Error(
      "Mirage replacement choice is required before moving cards"
    );
  const underCardIds = collectUnderCardScopeIds(state);
  // 単一ゾーン限定の分岐判定 (deck 特殊処理・discard-on-leave リダイレクト・burst 掃除等)
  // は fromZones 経由に統一する。配列指定 (合算プール) は単一ゾーン扱いされないため false。
  const isSingleFromZone = (zone: Zone): boolean =>
    fromZones.length === 1 && fromZones[0] === zone;

  // デッキ破棄耐性 (prevent_deck_discard CE。BSTH08.5-C21「お互いのデッキは破棄されない」)。
  // Q3895/Q3900 により、`deckDiscard:true` を明示した「デッキを破棄する」だけを
  // 止める。単にデッキからトラッシュへ置く通常移動には適用しない。
  if (deckDiscardBlocked) {
    state.log.push(
      `effect:move_card:deck->trash:immune:no-discardable:${fromPlayer}`
    );
    return state;
  }

  if (toMove.length === 0 && hiddenDeckMoveCount === 0) return state;

  const handGainGate = resolveZoneMoveHandGainCost(
    state,
    { actingPlayerId, sourceInstanceId },
    toPlayer,
    toMove,
    toZone,
    getCardDefinitionById,
    handGainCostOptions
  );
  if (!handGainGate.canGain) return handGainGate.state;
  state = handGainGate.state;

  // 候補抽出時に移動前のカードの耐性を評価済み。移動先の耐性で入場を止めない。

  const toSourceUnderCardRole = action.to.sourceUnderCardRole;
  if (toSourceUnderCardRole !== undefined) {
    if (!sourceCard || sourceCard.zone !== "field") return state;
  }
  if (toSourceUnderCardRole === "advent_source") {
    // Use the existing advent primitive for core return, inherited under-cards,
    // A-face identity and leave replacement before the common zone counters run.
    const beforeAttachment = state;
    if (toMove.some((card) => card.instanceId === sourceInstanceId))
      return state;
    for (const card of toMove) {
      if (card.zone === "field") {
        state = resolveCardLeavesFieldCores(
          state,
          card.instanceId,
          null,
          getCardDefinitionById
        );
      }
      const attached = attachAsAdventSource(
        state,
        card.instanceId,
        sourceInstanceId
      );
      if (!attached) return beforeAttachment;
      state = attached;
    }
  }
  const movedToSourceUnderCardIds =
    toSourceUnderCardRole !== undefined
      ? new Set(toMove.map((c) => c.instanceId))
      : new Set<string>();

  // engine-deck-derived-clone-spirit: 分身スピリット (discard_on_leave) はデッキ/手札等
  // トラッシュ以外へ戻る move_card もトラッシュへ強制着地する (07b §5 分身、bounce と同型)。
  // destroy/vanish は既に trash 既定のため対象外。単一ゾーン "field" のときのみ判定。
  const discardRedirectIds =
    isSingleFromZone("field") && toZone !== "trash"
      ? new Set(
          toMove
            .filter((c) => hasDiscardOnLeaveRestriction(state, c.instanceId))
            .map((c) => c.instanceId)
        )
      : new Set<string>();
  // BSTH05.5-X02 Lv2【導域】: redirect_deck_discard_to_exclude CE が有効なら、
  // このデッキ→トラッシュ移動 (toMove 全件) の移動先を removed_from_game へ差し替える。
  const excludeRedirectIds = deckDiscardExcludeRedirect
    ? new Set(toMove.map((c) => c.instanceId))
    : new Set<string>();
  const resolveActualToZone = (
    cardId: string
  ): DSL.MoveCardAction["to"]["zone"] =>
    discardRedirectIds.has(cardId)
      ? "trash"
      : excludeRedirectIds.has(cardId)
        ? "removed_from_game"
        : toZone;
  const pendingLeaveKindForFieldMove = (zone: Zone): PendingLeaveKind => {
    if (zone === "removed_from_game") return "remove_from_game";
    // move_card の field→trash は「破壊」ではなく、自己破棄などの汎用フィールド離脱。
    // PendingLeaveKind では非破壊の zone 指定離脱を bounce として表現する。
    return "bounce";
  };

  const fieldLeaveMoveCards =
    isSingleFromZone("field") &&
    toZone !== "field" &&
    toSourceUnderCardRole === undefined
      ? toMove
      : [];
  const fieldLeaveMoveChildIds = new Set<string>();
  for (const host of fieldLeaveMoveCards) {
    for (const childId of host.attachedChildrenIds) {
      fieldLeaveMoveChildIds.add(childId);
    }
  }
  const pendingFieldLeaveMoveCards = fieldLeaveMoveCards.filter(
    (c) => !fieldLeaveMoveChildIds.has(c.instanceId)
  );
  const pendingFieldLeaveMoveIds = new Set(
    pendingFieldLeaveMoveCards.map((c) => c.instanceId)
  );

  if (pendingFieldLeaveMoveCards.length > 0) {
    let pendingState = state;
    for (const card of pendingFieldLeaveMoveCards) {
      const actualToZone = resolveActualToZone(card.instanceId);
      pendingState = queuePendingLeave({
        state: pendingState,
        instanceId: card.instanceId,
        kind: pendingLeaveKindForFieldMove(actualToZone),
        cause: "effect_resolution",
        chainId: `effect:move_card:${fromZones.join("|")}->${toZone}:${
          card.instanceId
        }`,
        causePlayerId: actingPlayerId,
        deferZoneMoveUntilChainEnd: false,
        leaveDestination: {
          zone: actualToZone,
          ...(actualToZone === "deck" && action.to.position
            ? { position: action.to.position }
            : {}),
        },
        causedByEffectSourceInstanceId: sourceInstanceId,
      });
    }
    state = pendingState;
  }
  if (pendingFieldLeaveMoveIds.size > 0 || fieldLeaveMoveChildIds.size > 0) {
    toMove = toMove.filter(
      (c) =>
        !pendingFieldLeaveMoveIds.has(c.instanceId) &&
        !fieldLeaveMoveChildIds.has(c.instanceId)
    );
  }

  if (
    toMove.length === 0 &&
    hiddenDeckMoveCount === 0 &&
    pendingFieldLeaveMoveIds.size === 0
  ) {
    return state;
  }

  const movedCount =
    toMove.length + hiddenDeckMoveCount + pendingFieldLeaveMoveIds.size;
  const movedIds = new Set(toMove.map((c) => c.instanceId));
  // 【セット中】ミラージュが効果で別ゾーンへ移動した場合、カード移動と
  // mirageSetStates の登録解除を同じ共通プリミティブで同期する。個別カードの
  // 破棄効果に bookkeeping を重ねると、他の mirage 起点 move_card で不整合が残る。
  const movedOutOfMirageIds = toMove
    .filter(
      (card) =>
        card.zone === "mirage" &&
        resolveActualToZone(card.instanceId) !== "mirage"
    )
    .map((card) => card.instanceId);
  const movedUnderCardIds = new Set(
    [...toMove, ...pendingFieldLeaveMoveCards]
      .map((c) => c.instanceId)
      .filter(
        (id) =>
          underCardIds.adventSource.has(id) || underCardIds.textRole.has(id)
      )
  );

  state.log.push(
    `effect:move_card:${fromZones.join("|")}->${toZone}:${movedCount}cards`
  );
  if (discardRedirectIds.size > 0) {
    state.log.push(
      ...[...discardRedirectIds].map(
        (id) => `effect:move_card:${id}:discard_on_leave:to_trash`
      )
    );
  }
  if (excludeRedirectIds.size > 0) {
    state.log.push(
      `effect:move_card:deck_discard_redirected_to_exclude:${fromPlayer}:${excludeRedirectIds.size}cards`
    );
  }

  // 移動カードの faceDown 制御 (P3-47 F-1):
  // - action.faceDown=true: 強制的に faceDown=true (裏向き配置)
  // - action.faceDown=false: 強制的に faceDown=false (表向き配置)
  // - 省略時: 既存 faceDown 状態を移動先 zone visibility に従って解除/維持
  const applyMoveFaceDown = (card: CardInstance): CardInstance => {
    const movedDefinition = getCardDefinitionById(card.definitionId);
    if (movedToSourceUnderCardIds.has(card.instanceId)) {
      const moved: CardInstance = {
        ...card,
        zone: "field",
        zoneRoleName:
          toSourceUnderCardRole === "advent_source"
            ? "advent-source"
            : movedDefinition
              ? getDefaultZoneRoleName(movedDefinition, "field")
              : card.zoneRoleName,
        // advent_source は既存モデル通り attachedToInstanceId=null を許す
        // (star-garment-swap.test.ts precedent)。text_role は place_text_role_under_card /
        // star-garment 系と同じく host instanceId を設定する (engine-tx01b-under-card-multi-select)。
        attachedToInstanceId:
          toSourceUnderCardRole === "text_role" ? sourceInstanceId : null,
        attachedChildrenIds: [],
        underCards: [],
        normalCoreCount: 0,
        exhaustState: "recovered",
        faceDown: false,
      };
      return moved;
    }
    if (discardRedirectIds.has(card.instanceId)) {
      // 破棄リダイレクト: action.faceDown 指定に関わらず表向きトラッシュへ強制。
      const moved: CardInstance = { ...card, zone: "trash" };
      return applyFaceDownPolicyOnZoneChange(moved, "trash");
    }
    if (excludeRedirectIds.has(card.instanceId)) {
      // デッキ除外リダイレクト (BSTH05.5-X02): トラッシュではなく removed_from_game へ。
      const moved: CardInstance = { ...card, zone: "removed_from_game" };
      return applyFaceDownPolicyOnZoneChange(moved, "removed_from_game");
    }
    const moved: CardInstance = {
      ...card,
      zone: toZone as CardInstance["zone"],
      // 裏向きの場への配置は印字種別の実体にしない。分身等は後続の共通処理で扱いを得る。
      ...((toZone === "mirage" ||
        (card.zone !== toZone &&
          !(toZone === "field" && action.faceDown === true))) &&
      movedDefinition
        ? { zoneRoleName: getDefaultZoneRoleName(movedDefinition, toZone) }
        : {}),
      ...(movedUnderCardIds.has(card.instanceId)
        ? {
            zoneRoleName: movedDefinition
              ? getDefaultZoneRoleName(movedDefinition, toZone)
              : card.zoneRoleName,
            attachedToInstanceId: null,
          }
        : {}),
    };
    if (action.faceDown === true) return { ...moved, faceDown: true };
    if (action.faceDown === false) return { ...moved, faceDown: false };
    return applyFaceDownPolicyOnZoneChange(moved, toZone);
  };

  // デッキ位置処理: top/bottom
  let updatedInstances: CardInstance[];
  if (toZone === "deck" && action.to.position) {
    // まず移動対象以外と対象を分離
    const nonMoved = state.cardInstances.filter(
      (c) => !movedIds.has(c.instanceId)
    );
    const moved = toMove.map((c) => applyMoveFaceDown(c));
    const toPlayerDeck = nonMoved.filter(
      (c) => c.ownerPlayerId === toPlayer && c.zone === "deck"
    );
    const nonDeck = nonMoved.filter(
      (c) => !(c.ownerPlayerId === toPlayer && c.zone === "deck")
    );

    if (action.to.position === "top") {
      updatedInstances = [...moved, ...toPlayerDeck, ...nonDeck];
    } else {
      updatedInstances = [...toPlayerDeck, ...moved, ...nonDeck];
    }
  } else {
    updatedInstances = state.cardInstances.map((c) =>
      movedIds.has(c.instanceId) ? applyMoveFaceDown(c) : c
    );
  }
  if (movedUnderCardIds.size > 0) {
    updatedInstances = stripUnderCardReferences(
      updatedInstances,
      movedUnderCardIds
    );
  }
  if (
    toSourceUnderCardRole !== undefined &&
    movedToSourceUnderCardIds.size > 0
  ) {
    const entries = toMove.map((card) => ({
      cardInstanceId: card.instanceId,
      role: toSourceUnderCardRole,
      ...(toSourceUnderCardRole === "text_role" && action.to.textRoleTag
        ? { roleTag: action.to.textRoleTag }
        : {}),
    }));
    updatedInstances = updatedInstances.map((c) => ({
      ...c,
      // Becoming an under-card ends its prior combined-child relationship.
      attachedChildrenIds: c.attachedChildrenIds.filter(
        (id) => !movedToSourceUnderCardIds.has(id)
      ),
      ...(c.instanceId === sourceInstanceId
        ? {
            underCards: [
              ...entries,
              ...c.underCards.filter(
                (entry) => !movedToSourceUnderCardIds.has(entry.cardInstanceId)
              ),
            ],
          }
        : {}),
    }));
  }

  let nextState: GameState = replaceCardInstances(
    {
      ...state,
      ...(toSourceUnderCardRole === "advent_source"
        ? {
            pendingLeaveEntities: state.pendingLeaveEntities.filter(
              (pending) => !movedToSourceUnderCardIds.has(pending.instanceId)
            ),
          }
        : {}),
      setBurstStates:
        isSingleFromZone("burst") && toZone !== "burst"
          ? state.setBurstStates.filter(
              (setBurstState) => !movedIds.has(setBurstState.cardInstanceId)
            )
          : state.setBurstStates,
    },
    updatedInstances
  );
  if (toSourceUnderCardRole === "advent_source") {
    nextState = removeBattleEntityMembersAndRecompute(
      nextState,
      [...movedToSourceUnderCardIds],
      getCardDefinitionById
    );
  }
  // 実体は上の共通配列更新で同期済み。明示的な抽象fixtureの省略分だけを移す。
  nextState = moveUninstantiatedCards(
    nextState,
    fromPlayer,
    "deck",
    "trash",
    hiddenDeckMoveCount
  );

  for (const cardInstanceId of movedOutOfMirageIds) {
    nextState = removeMirageSetState(nextState, cardInstanceId);
  }

  // toZone === "trash" の場合、moved_to_trash 自動効果を発火
  // （deck_reveal 経由の finalizeDeckReveal 相当の挙動を汎用プリミティブに移植）
  if (toZone === "trash" && movedIds.size > 0) {
    const srcCard = state.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    );
    const srcDef = srcCard
      ? getCardDefinitionById(srcCard.definitionId)
      : undefined;
    return processMovedToTrashEffects(
      nextState,
      [...movedIds],
      getCardDefinitionById,
      {
        sourceColors: getEffectiveColors(state, srcCard, srcDef),
        sourceTribes: srcDef?.tribe ? srcDef.tribe.split("・") : [],
        ...(srcDef?.name ? { sourceCardName: srcDef.name } : {}),
        ...(srcDef?.printedCategory
          ? { sourceCategory: srcDef.printedCategory }
          : {}),
        ...(srcCard ? { sourcePlayerId: srcCard.controllerPlayerId } : {}),
        // 複数ゾーン合算プールは trigger_from_zone 評価上の単一ゾーンに絞れないため未設定にする。
        ...(fromZones.length === 1 ? { fromZone: fromZones[0] } : {}),
      }
    );
  }

  if (toZone === "mirage") {
    for (const id of movedIds) {
      nextState = applyFreeMirageSetBookkeeping(
        nextState,
        toPlayer,
        id,
        getCardDefinitionById,
        miragePlan?.replacementsByInstanceId[id]
      );
    }
  }

  return nextState;
}

export function executeMoveCardPrimitive(options: {
  action: DSL.MoveCardAction;
  state: GameState;
  actingPlayerId: string;
  sourceInstanceId: string;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
}): GameState {
  return executeMoveCard(
    options.action,
    options.state,
    options.actingPlayerId,
    options.sourceInstanceId,
    options.getCardDefinitionById,
    createStepExecutionContext(options.state)
  );
}

// --- core_move splitDestinations: 複数移動先への配分プレイヤー選択 ---

let coreSplitPendingSequence = 0;

// --- core_distribute mode=player_choice: pendingCoreDistribution 生成用 sequence ---

let coreDistributePendingSequence = 0;

type AnyMovableCoreDistributionSourceScope =
  | "any"
  | "field_and_reserve"
  | "field_reserve_and_trash"
  | "non_life_normal";

function getAnyMovableZoneSoulCoreCount(
  player: PlayerState,
  kind: "reserve" | "trash" | "life"
): number {
  const tracked = player.soulCoreLocation?.kind === kind ? 1 : 0;
  if (kind === "reserve") {
    return Math.max(player.reserveSoulCoreCount, tracked);
  }
  if (kind === "trash") {
    return Math.max(player.trashSoulCoreCount, tracked);
  }
  return Math.max(player.lifeSoulCoreCount, tracked);
}

function getAnyMovableCardSoulCoreCount(
  player: PlayerState,
  card: CardInstance
): number {
  const tracked =
    player.soulCoreLocation?.kind === "card" &&
    player.soulCoreLocation.instanceId === card.instanceId
      ? 1
      : 0;
  return Math.max(card.soulCoreCount, tracked);
}

function collectAnyMovableSoulSourceAvailable(options: {
  state: GameState;
  player: PlayerState;
  actingPlayerId: string;
  targetIds: readonly string[];
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  sourceScope: AnyMovableCoreDistributionSourceScope;
  trashCoreLimit?: number;
  trashCoreKind?: "generic" | "normal_only";
}): Record<string, number> {
  const {
    state,
    player,
    actingPlayerId,
    targetIds,
    getCardDefinitionById,
    sourceScope,
  } = options;
  const out: Record<string, number> = {};
  if (sourceScope === "non_life_normal") return out;
  const reserveSoul = getAnyMovableZoneSoulCoreCount(player, "reserve");
  if (reserveSoul > 0) out["reserve"] = reserveSoul;
  if (sourceScope === "any") {
    const trashSoul = getAnyMovableZoneSoulCoreCount(player, "trash");
    if (trashSoul > 0) out["trash"] = trashSoul;
    const lifeSoul = getAnyMovableZoneSoulCoreCount(player, "life");
    if (lifeSoul > 0) out["life"] = lifeSoul;
  } else if (
    sourceScope === "field_reserve_and_trash" &&
    options.trashCoreKind !== "normal_only"
  ) {
    const trashLimit = Math.max(0, options.trashCoreLimit ?? 0);
    const trashSoul = Math.min(
      getAnyMovableZoneSoulCoreCount(player, "trash"),
      trashLimit
    );
    if (trashSoul > 0) out["trash"] = trashSoul;
  }
  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== actingPlayerId) continue;
    if (!targetIds.some((targetId) => targetId !== card.instanceId)) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!canMoveCoresFrom(state, card, def)) continue;
    const soulCount = getAnyMovableCardSoulCoreCount(player, card);
    if (soulCount <= 0) continue;
    out[`field:${card.instanceId}`] = soulCount;
  }
  return out;
}

function resolveCoreDistributeFieldTargetPlayerId(
  action: DSL.CoreDistributeAction,
  state: GameState,
  actingPlayerId: string,
  targetIds: readonly string[]
): string {
  if (action.to.kind === "filter") {
    return resolvePlayerRef(actingPlayerId, action.to.player, state);
  }
  const controllers = new Set(
    targetIds
      .map(
        (targetId) =>
          state.cardInstances.find((card) => card.instanceId === targetId)
            ?.controllerPlayerId
      )
      .filter((playerId): playerId is string => playerId !== undefined)
  );
  return controllers.size === 1 ? [...controllers][0]! : actingPlayerId;
}

function normalizeCoreDistributeTargetIds(
  action: DSL.CoreDistributeAction,
  state: GameState,
  targetIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): string[] {
  const filter = action.to.kind === "filter" ? action.to.filter : undefined;
  return targetIds.filter((targetId) => {
    const card = state.cardInstances.find((c) => c.instanceId === targetId);
    if (!card) return true;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) return true;
    if (hasEnterFieldOnlyCorePlacementRestriction(def)) return false;
    return (
      filter === undefined ||
      !shouldExcludeAttachedCombinedChildForFieldCategoryFilter(
        state,
        card,
        def,
        filter
      )
    );
  });
}

export function executeCoreMoveSplit(
  action: DSL.CoreMoveAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  effect: Effect,
  sourcePreventionLevel?: EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectSourceInstanceId?: string,
  effectSourceDefinitionId?: string,
  battleEndDeferralAttackId?: string
): GameState {
  if (!action.splitDestinations) return state;

  // amount を解決
  let totalAmount = resolveCountToNumber(
    action.amount,
    state,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
  if (totalAmount <= 0) {
    state.log.push(`effect:core_move_split:noop:amount=${totalAmount}`);
    return state;
  }

  // ソースのプレイヤー解決（pending の actingPlayerId 設定用）
  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const fromLocation = convertCoreLocation(action.from);
  const availableFromSource = getKnownAvailableNormalCoresForSplitSource(
    state,
    fromLocation,
    actingPlayerId,
    sourceInstanceId
  );
  if (availableFromSource !== null && availableFromSource < totalAmount) {
    if (action.requireFullCount || availableFromSource <= 0) {
      state.log.push(
        `effect:core_move_split:insufficient:${availableFromSource}/${totalAmount}`
      );
      return state;
    }
    totalAmount = availableFromSource;
  }

  // 各 destination の location と cap を解決
  const resolvedDestinations = action.splitDestinations.destinations.map(
    (d) => {
      const location = convertCoreLocation(d.location);
      if (d.cap !== undefined) {
        const cap = resolveCountToNumber(
          d.cap,
          state,
          actingPlayerId,
          stepCtx,
          getCardDefinitionById
        );
        return { location, cap };
      }
      return { location };
    }
  );

  state.log.push(
    `effect:core_move_split:pending:${totalAmount}cores->${resolvedDestinations.length}destinations`
  );

  return {
    ...state,
    pendingCoreSplitSelection: {
      pendingId: `cms-${coreSplitPendingSequence++}`,
      actingPlayerId,
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      fromLocation,
      totalAmount,
      destinations: resolvedDestinations,
      effectTiming: effect.timing,
      ...(sourcePreventionLevel !== undefined ? { sourcePreventionLevel } : {}),
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
      ...(battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId }
        : {}),
    },
  };
}

function getKnownAvailableNormalCoresForSplitSource(
  state: GameState,
  fromLocation: EffectCoreLocation,
  actingPlayerId: string,
  sourceInstanceId: string
): number | null {
  switch (fromLocation.kind) {
    case "union":
      throw new Error("core source union does not support split destinations");
    case "void":
    case "reserve":
    case "trash":
    case "life": {
      const playerId = resolvePlayerRef(
        actingPlayerId,
        fromLocation.player,
        state
      );
      const player = state.players.find((p) => p.id === playerId);
      if (!player) return 0;
      if (fromLocation.kind === "void") return player.voidNormalCoreCount;
      if (fromLocation.kind === "reserve") return player.reserveNormalCoreCount;
      if (fromLocation.kind === "trash") return player.trashNormalCoreCount;
      return player.lifeNormalCoreCount;
    }
    case "this_card":
      return (
        state.cardInstances.find((card) => card.instanceId === sourceInstanceId)
          ?.normalCoreCount ?? 0
      );
    case "card_instance":
      return (
        state.cardInstances.find(
          (card) => card.instanceId === fromLocation.instanceId
        )?.normalCoreCount ?? 0
      );
    case "field":
    case "field_card":
    case "target_card":
    case "outside_game":
    case "removed_from_game":
    case "count_area":
      return null;
  }
}

function executeCoreDistributeFieldSource(
  action: DSL.CoreDistributeAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  targetIds: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  isAll: boolean,
  rawAmount: number,
  sourcePreventionLevel?: EffectPreventionLevel,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectTiming?: EffectTiming,
  battleEndDeferralAttackId?: string
): GameState {
  if (action.mode !== "player_choice") {
    state.log.push(`effect:core_distribute:field:requires_player_choice`);
    return state;
  }
  const fromLoc = convertCoreLocation(action.from);
  if (fromLoc.kind !== "field") return state;

  const fromPlayerId = resolvePlayerRef(actingPlayerId, fromLoc.player, state);
  const targetCandidateIds = normalizeCoreDistributeTargetIds(
    action,
    state,
    targetIds,
    getCardDefinitionById
  );
  if (targetCandidateIds.length === 0) {
    state.log.push(
      `effect:core_distribute:field:no_destination_targets:${targetIds.length}->0`
    );
    return state;
  }
  const toPlayerId = resolveCoreDistributeFieldTargetPlayerId(
    action,
    state,
    actingPlayerId,
    targetCandidateIds
  );
  const fromPlayer = state.players.find((p) => p.id === fromPlayerId);
  if (!fromPlayer) return state;

  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );
  const effectSourceDefinition =
    sourceCard !== undefined
      ? getCardDefinitionById(sourceCard.definitionId)
      : undefined;
  const effectSource =
    sourceCard !== undefined
      ? {
          instance: sourceCard,
          ...(effectSourceDefinition !== undefined
            ? { definition: effectSourceDefinition }
            : {}),
        }
      : effectSourceDefinition !== undefined
        ? { definition: effectSourceDefinition }
        : undefined;
  const preventionLevel = sourcePreventionLevel ?? "none";
  const effectKind = action.effectKind ?? "generic";
  const canMoveSoul =
    effectKind !== "normal_only" && fromPlayerId === toPlayerId;

  const allowedSources: CoreDistributionAllowedSource[] = [];
  const sourceAvailable: Record<string, number> = {};
  const soulSourceAvailable: Record<string, number> = {};
  const sourceTotalAvailable: Record<string, number> = {};

  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.pendingLeaveKind !== null) continue;
    if (card.controllerPlayerId !== fromPlayerId) continue;
    if (!targetIds.some((targetId) => targetId !== card.instanceId)) continue;
    if (
      !coreShootCardMatchesFilter(
        state,
        card,
        fromLoc.filter,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    const minRemaining = resolveFieldCoreSourceMinRemaining(
      state,
      card,
      fromLoc,
      getCardDefinitionById
    );
    const soulCount = canMoveSoul
      ? getAnyMovableCardSoulCoreCount(fromPlayer, card)
      : 0;
    const totalTakeable = getFieldCoreSourceTakeableCount(
      state,
      card,
      actingPlayerId,
      {
        minRemaining,
        soulCoresOnCard: soulCount,
        soulCoresMovable: soulCount,
        sourcePreventionLevel: preventionLevel,
        ...(effectSource !== undefined ? { effectSource } : {}),
        getCardDefinitionById,
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        filter: fromLoc.filter,
        sourceInstanceId,
      }
    );
    if (totalTakeable <= 0) continue;

    const normalTakeable = Math.min(
      card.normalCoreCount,
      getFieldCoreSourceTakeableCount(state, card, actingPlayerId, {
        minRemaining,
        soulCoresOnCard: soulCount,
        soulCoresMovable: 0,
        sourcePreventionLevel: preventionLevel,
        ...(effectSource !== undefined ? { effectSource } : {}),
        getCardDefinitionById,
        ...(sourcePreventionBypass !== undefined
          ? { sourcePreventionBypass }
          : {}),
        filter: fromLoc.filter,
        sourceInstanceId,
      })
    );
    const soulTakeable = soulCount > 0 ? Math.min(soulCount, totalTakeable) : 0;
    if (normalTakeable <= 0 && soulTakeable <= 0) continue;

    const key = `field:${card.instanceId}`;
    allowedSources.push({ kind: "field", instanceId: card.instanceId });
    sourceAvailable[key] = normalTakeable;
    if (soulTakeable > 0) soulSourceAvailable[key] = soulTakeable;
    sourceTotalAvailable[key] = totalTakeable;
  }

  const normalSourceChunks: NormalCoreDistributionSourceChunk[] =
    allowedSources.flatMap((source) =>
      source.kind === "field"
        ? [
            {
              container: { kind: "card", instanceId: source.instanceId },
              remaining: sourceAvailable[`field:${source.instanceId}`] ?? 0,
            },
          ]
        : []
    );
  const normalMoveCapacity = computeCoreDistributionNormalMoveCapacity(
    normalSourceChunks,
    targetCandidateIds
  );
  const coresToDistribute = isAll
    ? normalMoveCapacity
    : Math.min(rawAmount, normalMoveCapacity);
  const totalSoulCores = Object.values(soulSourceAvailable).reduce(
    (sum, amount) => sum + Math.max(0, amount),
    0
  );
  const minTotal = action.minTotal ?? 0;
  const placeableTotal = isAll
    ? coresToDistribute + totalSoulCores
    : Math.min(rawAmount, coresToDistribute + totalSoulCores);
  if (placeableTotal < minTotal) {
    state.log.push(
      `effect:core_distribute:field:insufficient_cores:${placeableTotal}<${minTotal}`
    );
    return state;
  }
  if (placeableTotal <= 0) return state;

  state.log.push(
    `effect:core_distribute:player_choice:field:${fromPlayerId}->${toPlayerId}:${targetCandidateIds.length}targets:available=${coresToDistribute}:min=${minTotal}:sources=${allowedSources.length}:pending`
  );

  const priorStateSnapshot = state;
  return {
    ...state,
    pendingCoreDistribution: {
      pendingId: `cd-${coreDistributePendingSequence++}`,
      actingPlayerId:
        fromPlayerId !== actingPlayerId ? actingPlayerId : fromPlayerId,
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      candidates: targetCandidateIds.map((id) => {
        const card = state.cardInstances.find((c) => c.instanceId === id);
        return {
          instanceId: id,
          definitionId: card?.definitionId ?? "dsl-unknown",
        };
      }),
      totalNormalCores: coresToDistribute,
      hasSoulCore: totalSoulCores > 0,
      ...(totalSoulCores > 0 ? { totalSoulCores } : {}),
      fromKind: "any_movable",
      allowedSources,
      sourceAvailable,
      ...(totalSoulCores > 0 ? { soulSourceAvailable } : {}),
      sourceTotalAvailable,
      ...(fromPlayerId !== actingPlayerId
        ? {
            targetTotalSelection: {
              mode: "target_totals_then_core_owner_sources" as const,
              targetChooserPlayerId: actingPlayerId,
              sourceOwnerPlayerId: fromPlayerId,
            },
          }
        : {}),
      ...(minTotal > 0 ? { minTotal } : {}),
      ...(!isAll ? { maxTotal: rawAmount } : {}),
      fromPlayerId,
      toPlayerId,
      effectTiming: effectTiming ?? { kind: "activated", mode: "main" },
      ...(battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId }
        : {}),
      priorStateSnapshot,
    },
  };
}

// --- core_distribute: コア分配 ---

export function executeCoreDistribute(
  ...args: Parameters<typeof executeUnconstrainedCoreDistribute>
): GameState {
  const [
    action,
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById,
    stepCtx,
  ] = args;
  const result = executeUnconstrainedCoreDistribute(...args);
  const pending = result.pendingCoreDistribution;
  if (
    !pending ||
    pending === state.pendingCoreDistribution ||
    (action.maxPerCandidate === undefined &&
      action.allocationGroups === undefined)
  )
    return result;
  const constrained = {
    ...pending,
    ...(action.maxPerCandidate !== undefined
      ? { maxPerCandidate: action.maxPerCandidate }
      : {}),
    ...(action.allocationGroups !== undefined
      ? {
          allocationGroups: action.allocationGroups.map((group) => ({
            maxCount: group.maxCount,
            candidateInstanceIds: resolveTargetSpec({
              targetSpec: {
                kind: "filter",
                player: "either",
                filter: group.filter,
                count: "all",
              },
              state,
              actingPlayerId,
              sourceInstanceId,
              getCardDefinitionById,
              stepContext: stepCtx,
            })
              .map((card) => card.instanceId)
              .filter((id) =>
                pending.candidates.some((c) => c.instanceId === id)
              ),
          })),
        }
      : {}),
  };
  const capacity = getCoreDistributionAllocationCapacity(
    constrained,
    pending.maxTotal ??
      pending.totalNormalCores +
        (pending.totalSoulCores ?? (pending.hasSoulCore ? 1 : 0))
  );
  if (capacity === 0 || capacity < (pending.minTotal ?? 0)) return state;
  return {
    ...result,
    pendingCoreDistribution: {
      ...constrained,
      totalNormalCores: Math.min(pending.totalNormalCores, capacity),
      maxTotal: capacity,
    },
  };
}

function executeUnconstrainedCoreDistribute(
  action: DSL.CoreDistributeAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  resolvedTargetIds?: string[],
  sourcePreventionLevel?: EffectPreventionLevel,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectTiming?: EffectTiming,
  battleEndDeferralAttackId?: string,
  source?: CardEffectSource
): GameState {
  const rawAmount = resolveCountToNumber(
    action.amount,
    state,
    actingPlayerId,
    stepCtx,
    getCardDefinitionById
  );
  const isAll = rawAmount < 0;
  if (!isAll && rawAmount <= 0) return state;

  // 分配先: resolvedTargetIds が明示されればそれを尊重し (空配列 = プレイヤーが 0 体を
  // 確定した状態 / targetSelectionResolved=true 経由)、内側 resolveTargetSpec への
  // 二重解決＆耐性ゲート貫通を防ぐ。`undefined` (= 外側経路を通っていない) のみ内側 fallback。
  // ENGINE-core-distribute-field-targeting-registration 着地時の verifier round 1 lens 4 で指摘。
  let targetIds =
    resolvedTargetIds !== undefined
      ? resolvedTargetIds
      : resolveTargetSpec({
          targetSpec: action.to,
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepContext: stepCtx,
        }).map((c) => c.instanceId);

  if (targetIds.length === 0) return state;

  if (action.from.kind === "field") {
    return executeCoreDistributeFieldSource(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      targetIds,
      getCardDefinitionById,
      isAll,
      rawAmount,
      sourcePreventionLevel,
      sourcePreventionBypass,
      effectTiming,
      battleEndDeferralAttackId
    );
  }

  targetIds = normalizeCoreDistributeTargetIds(
    action,
    state,
    targetIds,
    getCardDefinitionById
  );
  if (targetIds.length === 0) return state;

  // P3-47 F-5: from="any_movable_self" → 自分の全 movable ゾーン (reserve / trash / life /
  // 自分 field カード) を多元ソースとして展開し、`mode="player_choice"` 専用の pending を生成。
  if (action.from.kind === "any_movable_self") {
    if (action.mode !== "player_choice") {
      state.log.push(
        `effect:core_distribute:any_movable_self:requires_player_choice`
      );
      return state;
    }
    return executeCoreDistributeAnyMovableSelf(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      targetIds,
      getCardDefinitionById,
      isAll,
      rawAmount,
      undefined,
      undefined,
      battleEndDeferralAttackId
    );
  }

  // 「ライフと《ソウルコア》以外の自分のコアすべて」型。any_movable_self と同じ
  // 移動元列挙を使い、life と soul core を除外する。全数・単一配置先なら直接移動する。
  if (action.from.kind === "non_life_normal_self") {
    if (action.mode !== "player_choice") {
      state.log.push(
        `effect:core_distribute:non_life_normal_self:requires_player_choice`
      );
      return state;
    }
    return executeCoreDistributeAnyMovableSelf(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      targetIds,
      getCardDefinitionById,
      isAll,
      rawAmount,
      "non_life_normal",
      undefined,
      battleEndDeferralAttackId
    );
  }

  // トラッシュのコアN個まで + フィールド/リザーブのコアを1つの core placement HUD で選ばせる。
  // trash 側のソウルコア可否は action.from.trashCoreKind でカード本文ごとに指定する。
  if (action.from.kind === "field_reserve_and_trash_self") {
    if (action.mode !== "player_choice") {
      state.log.push(
        `effect:core_distribute:field_reserve_and_trash_self:requires_player_choice`
      );
      return state;
    }
    return executeCoreDistributeAnyMovableSelf(
      action,
      state,
      actingPlayerId,
      sourceInstanceId,
      targetIds,
      getCardDefinitionById,
      isAll,
      rawAmount,
      "field_reserve_and_trash",
      undefined,
      battleEndDeferralAttackId
    );
  }

  // 「自分のフィールド/リザーブのコアを好きなだけ<対象>に置ける」型 (BSFT01 TR系【転醒】許可窓等)。
  // any_movable_self の trash/life を除いた縮小版。単一 target は SSOT ヘルパーの
  // buildChargeCoresPendingCoreDistribution (単一 targetInstanceId 前提) を使う。
  // 複数 target (engine-deck-derived-clone-spirit「フィールド/リザーブのコア1個以上を
  // 置く」複数分身への同時配分、BSAZ01-C12/BSAZ02-C07) は any_movable_self と同じ
  // 複数 target pending 構造を sourceScope="field_and_reserve" で流用する。
  if (action.from.kind === "field_and_reserve_self") {
    if (action.mode !== "player_choice") {
      state.log.push(
        `effect:core_distribute:field_and_reserve_self:requires_player_choice`
      );
      return state;
    }
    const minTotal = action.minTotal ?? 0;
    if (targetIds.length > 1) {
      return executeCoreDistributeAnyMovableSelf(
        action,
        state,
        actingPlayerId,
        sourceInstanceId,
        targetIds,
        getCardDefinitionById,
        isAll,
        rawAmount,
        "field_and_reserve",
        minTotal,
        battleEndDeferralAttackId
      );
    }
    const chargeTargetId = targetIds[0]!;
    const chargeTargetCard = state.cardInstances.find(
      (c) => c.instanceId === chargeTargetId
    );
    const pending = buildChargeCoresPendingCoreDistribution(
      state,
      actingPlayerId,
      chargeTargetId,
      chargeTargetCard?.definitionId ?? "dsl-unknown",
      getCardDefinitionById,
      "dsl-charge",
      { sourceScope: "field_and_reserve", minTotal }
    );
    if (!pending) {
      state.log.push(
        `effect:core_distribute:field_and_reserve_self:no-cores-available:${chargeTargetId}`
      );
      return state;
    }
    state.log.push(
      `effect:core_distribute:field_and_reserve_self:${chargeTargetId}:available=${pending.totalNormalCores}:pending`
    );
    return {
      ...state,
      pendingCoreDistribution:
        battleEndDeferralAttackId === undefined
          ? pending
          : { ...pending, battleEndDeferralAttackId },
    };
  }

  // ソースからコアを取得 — CoreLocation から直接プレイヤーを解決
  if (action.from.kind === "union")
    throw new Error("core source union is only supported by core_move");
  const fromPlayerRef =
    action.from.kind === "this_card" ||
    action.from.kind === "target_card" ||
    action.from.kind === "card_instance" ||
    action.from.kind === "ref" ||
    action.from.kind === "outside_game"
      ? ("self" as EffectPlayerRef)
      : (action.from.player as EffectPlayerRef);
  const fromPlayerId = resolvePlayerRef(actingPlayerId, fromPlayerRef, state);
  const fromLoc = convertCoreLocation(action.from);

  // 利用可能コア数を計算
  let availableCores = 0;
  const effectKind = action.effectKind ?? "generic";
  let hasSourceSoulCore = false;
  if (fromLoc.kind === "reserve") {
    const player = state.players.find((p) => p.id === fromPlayerId);
    availableCores = player?.reserveNormalCoreCount ?? 0;
  } else if (fromLoc.kind === "void") {
    const player = state.players.find((p) => p.id === fromPlayerId);
    availableCores = isAll ? 0 : (player?.voidNormalCoreCount ?? 0);
  } else if (fromLoc.kind === "trash") {
    const player = state.players.find((p) => p.id === fromPlayerId);
    availableCores = player?.trashNormalCoreCount ?? 0;
    hasSourceSoulCore =
      action.mode === "player_choice" &&
      effectKind !== "normal_only" &&
      player?.soulCoreLocation?.kind === "trash" &&
      (isAll || rawAmount > 0);
  }

  const coresToDistribute = isAll
    ? availableCores
    : Math.min(rawAmount, availableCores);
  const effectiveCoresToDistribute = isAll
    ? coresToDistribute + (hasSourceSoulCore ? 1 : 0)
    : Math.min(rawAmount, coresToDistribute + (hasSourceSoulCore ? 1 : 0));
  if (effectiveCoresToDistribute <= 0) return state;
  const fromCoreContainer =
    fromLoc.kind === "reserve" ||
    fromLoc.kind === "trash" ||
    fromLoc.kind === "void"
      ? { kind: fromLoc.kind, playerId: fromPlayerId }
      : undefined;
  if (!fromCoreContainer) return state;

  if (
    fromLoc.kind === "void" &&
    resolveCorePlacementFromVoidAffect(
      state,
      actingPlayerId,
      fromPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass,
      effectTiming,
      source ??
        resolveAffectSourceIdentity({
          state,
          sourceInstanceId,
          getCardDefinitionById,
        })
    ).kind !== "allowed"
  ) {
    state.log.push(
      `effect:core_distribute:void->${action.to.kind}:blocked-by-restrict_core_placement_void:${fromPlayerId}`
    );
    return state;
  }

  // P3-47 Phase 2-1: mode="player_choice" のとき pending を生成して player に分配を委ねる。
  // フランドール「自分のコア1個以上をそれらのカードに置く」のような任意分配のコスト効果に使う。
  if (action.mode === "player_choice") {
    // void は「ボイドからコアN個を選択した自分カードに置く」用の単一ソース。
    // availableCores は上の分岐で player.voidNormalCoreCount から算出し、解決時に減算する。
    if (
      fromLoc.kind !== "reserve" &&
      fromLoc.kind !== "trash" &&
      fromLoc.kind !== "void"
    ) {
      state.log.push(
        `effect:core_distribute:player_choice:unsupported_source:${fromLoc.kind}`
      );
      return state;
    }
    const minTotal = action.minTotal ?? 0;
    if (effectiveCoresToDistribute < minTotal) {
      state.log.push(
        `effect:core_distribute:player_choice:insufficient_cores:${effectiveCoresToDistribute}<${minTotal}`
      );
      return state;
    }
    const sourceCard = state.cardInstances.find(
      (c) => c.instanceId === sourceInstanceId
    );
    state.log.push(
      `effect:core_distribute:player_choice:${fromLoc.kind}:${fromPlayerId}->${targetIds.length}targets:available=${coresToDistribute}:min=${minTotal}:pending`
    );
    // P3-48 follow-up: cancel/abort 用 snapshot — pending 追加前の state をそのまま参照保持。
    // 自己参照を避けるため snapshot 自身は pendingCoreDistribution を含まない。
    const priorStateSnapshot = state;
    return {
      ...state,
      pendingCoreDistribution: {
        pendingId: `cd-${coreDistributePendingSequence++}`,
        actingPlayerId,
        sourceInstanceId,
        sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
        candidates: targetIds.map((id) => {
          const card = state.cardInstances.find((c) => c.instanceId === id);
          return {
            instanceId: id,
            definitionId: card?.definitionId ?? "dsl-unknown",
          };
        }),
        totalNormalCores: coresToDistribute,
        hasSoulCore: hasSourceSoulCore,
        fromKind: fromLoc.kind,
        ...(minTotal > 0 ? { minTotal } : {}),
        ...(!isAll && hasSourceSoulCore ? { maxTotal: rawAmount } : {}),
        ...(isAll && hasSourceSoulCore ? { mustPlaceSoulCore: true } : {}),
        fromPlayerId,
        toPlayerId: actingPlayerId,
        effectTiming: { kind: "activated", mode: "main" },
        ...(battleEndDeferralAttackId !== undefined
          ? { battleEndDeferralAttackId }
          : {}),
        priorStateSnapshot,
      },
    };
  }

  // mode="one_each": 各選択ターゲットへ 1 個ずつ配置 (「コア1個ずつをN体まで」)。
  // 実配置数 = min(amount, targetIds.length, availableCores)。
  // BSLH01-X04[0] / BSTH05-X03[0] / BSTH05-R01[0] 等の「1個ずつ」基盤。
  if (action.mode === "one_each") {
    const oneEachCount = Math.min(coresToDistribute, targetIds.length);
    if (oneEachCount <= 0) return state;
    const oneEachTargets = targetIds.slice(0, oneEachCount);
    const targetCoreMapOne = new Map<string, number>();
    for (const id of oneEachTargets) {
      targetCoreMapOne.set(id, (targetCoreMapOne.get(id) ?? 0) + 1);
    }
    state.log.push(
      `effect:core_distribute:one_each:${oneEachCount}cores->${oneEachTargets.length}targets`
    );
    let updatedStateOne = state;
    for (const [targetId, cores] of targetCoreMapOne) {
      if (cores <= 0) continue;
      updatedStateOne = moveNormalCores(
        updatedStateOne,
        fromCoreContainer,
        { kind: "card", instanceId: targetId },
        cores,
        getCardDefinitionById
      );
    }
    return updatedStateOne;
  }

  // 均等分配（端数は先頭のターゲットに）
  const perTarget = Math.floor(coresToDistribute / targetIds.length);
  const remainder = coresToDistribute % targetIds.length;
  const distribution = targetIds.map(
    (_, i) => perTarget + (i < remainder ? 1 : 0)
  );

  state.log.push(
    `effect:core_distribute:${coresToDistribute}cores->${targetIds.length}targets`
  );

  // ターゲットカードにコアを追加
  const targetCoreMap = new Map<string, number>();
  targetIds.forEach((id, i) => {
    targetCoreMap.set(id, (targetCoreMap.get(id) ?? 0) + distribution[i]!);
  });

  let updatedState = state;
  for (const [targetId, cores] of targetCoreMap) {
    if (cores <= 0) continue;
    updatedState = moveNormalCores(
      updatedState,
      fromCoreContainer,
      { kind: "card", instanceId: targetId },
      cores,
      getCardDefinitionById
    );
  }

  return updatedState;
}

export function executeCoreSetToLevel(
  action: DSL.CoreSetToLevelAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  stepCtx: StepExecutionContext,
  resolvedTargetIds?: string[],
  sourcePreventionLevel?: EffectPreventionLevel,
  sourcePreventionBypass?: TargetLockBypassProfile,
  effectTiming?: EffectTiming,
  source?: CardEffectSource
): GameState {
  const targetIds =
    resolvedTargetIds !== undefined
      ? resolvedTargetIds
      : resolveTargetSpec({
          targetSpec: action.target,
          state,
          actingPlayerId,
          sourceInstanceId,
          getCardDefinitionById,
          stepContext: stepCtx,
        }).map((card) => card.instanceId);
  if (targetIds.length === 0) return state;

  if (action.from.kind !== "void") {
    state.log.push(
      `effect:core_set_to_level:unsupported_source:${action.from.kind}`
    );
    return state;
  }

  const fromPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.from.player,
    state
  );
  if (
    resolveCorePlacementFromVoidAffect(
      state,
      actingPlayerId,
      fromPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      sourcePreventionBypass,
      effectTiming,
      source ??
        resolveAffectSourceIdentity({
          state,
          sourceInstanceId,
          getCardDefinitionById,
        })
    ).kind !== "allowed"
  ) {
    state.log.push(
      `effect:core_set_to_level:void->field:blocked-by-restrict_core_placement_void:${fromPlayerId}`
    );
    return state;
  }

  const fromPlayer = state.players.find((p) => p.id === fromPlayerId);
  let remainingVoidCores = fromPlayer?.voidNormalCoreCount ?? 0;
  if (remainingVoidCores <= 0) return state;

  let updatedState = state;
  let movedTotal = 0;
  for (const targetId of targetIds) {
    if (remainingVoidCores <= 0) break;
    const card = getCardById(updatedState, targetId);
    if (!card) continue;
    if (card.zone !== "field" || card.pendingLeaveKind !== null) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!def) continue;
    if (hasEnterFieldOnlyCorePlacementRestriction(def)) continue;
    const targetLevel = def.levelDefs.find(
      (levelDef) => levelDef.level === action.level
    );
    if (!targetLevel) continue;
    const effectiveRequiredCores = Math.max(
      0,
      targetLevel.requiredCores +
        getEffectiveLevelCostDelta(
          updatedState,
          card,
          def,
          getCardDefinitionById
        )
    );
    const currentCores = getTotalCoresOnCardById(updatedState, card.instanceId);
    const needed = Math.max(0, effectiveRequiredCores - currentCores);
    const toMove = Math.min(needed, remainingVoidCores);
    if (toMove <= 0) continue;
    updatedState = moveNormalCores(
      updatedState,
      { kind: "void", playerId: fromPlayerId },
      { kind: "card", instanceId: card.instanceId },
      toMove,
      getCardDefinitionById
    );
    remainingVoidCores -= toMove;
    movedTotal += toMove;
  }

  if (movedTotal <= 0) return state;
  return {
    ...updatedState,
    log: [
      ...updatedState.log,
      `effect:core_set_to_level:void:${fromPlayerId}->level${action.level}:${movedTotal}cores/${targetIds.length}targets`,
    ],
  };
}

export function getMinimumAdditionalCoresForFieldTargets(
  state: GameState,
  targetIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  return targetIds.reduce((total, targetId) => {
    const card = getCardById(state, targetId);
    if (!card) return total;
    const actAsSpiritMinimumRequiredCores =
      resolveActAsSpiritMinimumRequiredCores(
        state,
        card,
        getCardDefinitionById
      );
    const baseMinimumRequired =
      actAsSpiritMinimumRequiredCores ??
      (card.zone === "field" ? card.minimumRequiredCores : 0);
    const definition = getCardDefinitionById(card.definitionId);
    const levelCostDelta = getEffectiveLevelCostDelta(
      state,
      card,
      definition,
      getCardDefinitionById
    );
    const minimumRequired = Math.max(0, baseMinimumRequired + levelCostDelta);
    const currentCores = getTotalCoresOnCardById(state, targetId);
    return total + Math.max(0, minimumRequired - currentCores);
  }, 0);
}

// --- core_distribute: any_movable_self (P3-47 F-5) ---
//
// 「自分の通常移動可能な全ゾーン」(reserve / trash / life / 自分 field カード) の
// 任意混合をソースとする player_choice 配分。`mode="player_choice"` 専用。
// 利用可能ソース毎の通常コア数を `sourceAvailable` snapshot に記録し、
// `allowedSources` リストと共に pendingCoreDistribution を生成する。
//
// engine-deck-derived-clone-spirit: sourceScope="field_and_reserve" で trash/life を
// 除外した「フィールド/リザーブのコア」限定ソースに縮小できる (BSAZ01-C12/BSAZ02-C07
// 「フィールド/リザーブのコア1個以上を置く」複数対象への分配)。単一 target 限定の
// `CoreLocation.field_and_reserve_self`(buildChargeCoresPendingCoreDistribution 経由) と
// 異なり、こちらは any_movable_self と同じ複数 target pending 構造を再利用できる。
export function executeCoreDistributeAnyMovableSelf(
  action: DSL.CoreDistributeAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  targetIds: string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  isAll: boolean,
  rawAmount: number,
  sourceScope: AnyMovableCoreDistributionSourceScope = "any",
  minTotalOverride?: number,
  battleEndDeferralAttackId?: string
): GameState {
  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) return state;

  // 全数・移動元全域・単一配置先なら選択がない。「好きなだけ」のallとは区別する。
  if (
    sourceScope === "non_life_normal" &&
    isAll &&
    targetIds.length === 1 &&
    action.maxPerCandidate === undefined &&
    action.allocationGroups === undefined
  ) {
    let next = state;
    for (const source of collectNonLifeNormalCoreSources(
      state,
      actingPlayerId,
      targetIds,
      getCardDefinitionById
    )) {
      if (source.container.kind === "card") {
        const card = getCardById(next, source.container.instanceId);
        if (
          !card ||
          !canMoveNormalCoresFrom(
            next,
            card,
            getCardDefinitionById(card.definitionId)
          )
        )
          continue;
      }
      next = moveNormalCores(
        next,
        source.container,
        { kind: "card", instanceId: targetIds[0]! },
        source.remaining,
        getCardDefinitionById
      );
    }
    return next;
  }

  const allowedSources: CoreDistributionAllowedSource[] = [];
  const sourceAvailable: Record<string, number> = {};
  const sourceTotalAvailable: Record<string, number> = {};
  const limitedTrashSource =
    action.from.kind === "field_reserve_and_trash_self"
      ? {
          limit: Math.max(0, action.from.trashCoreLimit),
          kind: action.from.trashCoreKind ?? "generic",
        }
      : null;

  const reserveSoulSourceAvailable =
    sourceScope !== "non_life_normal"
      ? getAnyMovableZoneSoulCoreCount(player, "reserve")
      : 0;
  if (player.reserveNormalCoreCount > 0 || reserveSoulSourceAvailable > 0) {
    allowedSources.push({ kind: "reserve" });
    if (player.reserveNormalCoreCount > 0) {
      sourceAvailable["reserve"] = player.reserveNormalCoreCount;
    }
  }
  const trashNormalSourceAvailable =
    sourceScope === "field_reserve_and_trash"
      ? Math.min(player.trashNormalCoreCount, limitedTrashSource?.limit ?? 0)
      : sourceScope !== "field_and_reserve"
        ? player.trashNormalCoreCount
        : 0;
  const trashSoulSourceAvailable =
    sourceScope === "field_reserve_and_trash" &&
    limitedTrashSource?.kind !== "normal_only"
      ? Math.min(
          getAnyMovableZoneSoulCoreCount(player, "trash"),
          limitedTrashSource?.limit ?? 0
        )
      : 0;
  if (trashNormalSourceAvailable > 0 || trashSoulSourceAvailable > 0) {
    allowedSources.push({ kind: "trash" });
    if (trashNormalSourceAvailable > 0) {
      sourceAvailable["trash"] = trashNormalSourceAvailable;
    }
    if (sourceScope === "field_reserve_and_trash") {
      sourceTotalAvailable["trash"] = limitedTrashSource?.limit ?? 0;
    }
  }
  if (sourceScope === "any" && player.lifeNormalCoreCount > 0) {
    allowedSources.push({ kind: "life" });
    sourceAvailable["life"] = player.lifeNormalCoreCount;
  }
  for (const card of state.cardInstances) {
    if (card.zone !== "field") continue;
    if (card.controllerPlayerId !== actingPlayerId) continue;
    const def = getCardDefinitionById(card.definitionId);
    if (!canMoveCoresFrom(state, card, def)) continue;
    const movableNormalCoreCount = canMoveNormalCoresFrom(state, card, def)
      ? card.normalCoreCount
      : 0;
    if (
      sourceScope === "non_life_normal" &&
      targetIds.includes(card.instanceId)
    ) {
      continue;
    }
    const fieldSoulSourceAvailable =
      sourceScope !== "non_life_normal" &&
      targetIds.some((targetId) => targetId !== card.instanceId)
        ? getAnyMovableCardSoulCoreCount(player, card)
        : 0;
    if (movableNormalCoreCount <= 0 && fieldSoulSourceAvailable <= 0) continue;
    allowedSources.push({ kind: "field", instanceId: card.instanceId });
    if (movableNormalCoreCount > 0) {
      sourceAvailable[`field:${card.instanceId}`] = movableNormalCoreCount;
    }
  }
  const normalSourceChunks: NormalCoreDistributionSourceChunk[] =
    allowedSources.map((source) => ({
      container:
        source.kind === "reserve" ||
        source.kind === "trash" ||
        source.kind === "life"
          ? { kind: source.kind, playerId: actingPlayerId }
          : { kind: "card", instanceId: source.instanceId },
      remaining:
        sourceAvailable[
          source.kind === "field" ? `field:${source.instanceId}` : source.kind
        ] ?? 0,
    }));

  // ソウルコアも「自分のコア」。通常移動可能ゾーン (reserve / trash / life / 自分の
  // field カード) にあればカード(疑似スピリット含む)へ置ける (06_core-system.md:36,75-79)。
  // 複数ソウル環境ではロケーション別カウントを source snapshot として保持し、完了時に
  // coreDistributionSoulCoreSourceAllocations で source を指定する。
  const soulSourceAvailable = collectAnyMovableSoulSourceAvailable({
    state,
    player,
    actingPlayerId,
    targetIds,
    getCardDefinitionById,
    sourceScope,
    ...(limitedTrashSource !== null
      ? {
          trashCoreLimit: limitedTrashSource.limit,
          trashCoreKind: limitedTrashSource.kind,
        }
      : {}),
  });
  const totalSoulCores = Object.values(soulSourceAvailable).reduce(
    (sum, n) => sum + Math.max(0, n),
    0
  );
  const soulCanBePlaced = totalSoulCores > 0;
  if (sourceScope === "field_reserve_and_trash") {
    for (const source of allowedSources) {
      const key =
        source.kind === "field" ? `field:${source.instanceId}` : source.kind;
      sourceTotalAvailable[key] =
        key === "trash"
          ? (limitedTrashSource?.limit ?? 0)
          : (sourceAvailable[key] ?? 0) + (soulSourceAvailable[key] ?? 0);
    }
  }

  const normalMoveCapacity = computeCoreDistributionNormalMoveCapacity(
    normalSourceChunks,
    targetIds
  );

  const coresToDistribute = isAll
    ? normalMoveCapacity
    : Math.min(rawAmount, normalMoveCapacity);
  const minTotal =
    minTotalOverride ??
    (sourceScope === "non_life_normal" && isAll
      ? coresToDistribute
      : (action.minTotal ?? 0));

  // ソウルコアも配置可能枠として最低数判定に数える (「コア1個以上」をソウル単独で満たせる)。
  const placeableTotal = coresToDistribute + totalSoulCores;
  const sourceLabel =
    sourceScope === "field_and_reserve"
      ? "field_and_reserve_self"
      : sourceScope === "field_reserve_and_trash"
        ? "field_reserve_and_trash_self"
        : sourceScope === "non_life_normal"
          ? "non_life_normal_self"
          : "any_movable_self";
  if (placeableTotal < minTotal) {
    state.log.push(
      `effect:core_distribute:${sourceLabel}:insufficient_cores:${placeableTotal}<${minTotal}`
    );
    return state;
  }
  if (placeableTotal <= 0) return state;

  const sourceCard = state.cardInstances.find(
    (c) => c.instanceId === sourceInstanceId
  );

  state.log.push(
    `effect:core_distribute:player_choice:${sourceLabel}:${actingPlayerId}->${targetIds.length}targets:available=${coresToDistribute}:min=${minTotal}:sources=${allowedSources.length}:pending`
  );

  // P3-48 follow-up: cancel/abort 用 snapshot — pending 追加前の state をそのまま参照保持。
  const priorStateSnapshot = state;
  return {
    ...state,
    pendingCoreDistribution: {
      pendingId: `cd-${coreDistributePendingSequence++}`,
      actingPlayerId,
      sourceInstanceId,
      sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
      candidates: targetIds.map((id) => {
        const card = state.cardInstances.find((c) => c.instanceId === id);
        return {
          instanceId: id,
          definitionId: card?.definitionId ?? "dsl-unknown",
        };
      }),
      totalNormalCores: coresToDistribute,
      hasSoulCore: soulCanBePlaced,
      ...(soulCanBePlaced ? { totalSoulCores } : {}),
      fromKind: "any_movable",
      allowedSources,
      sourceAvailable,
      ...(soulCanBePlaced ? { soulSourceAvailable } : {}),
      ...(Object.keys(sourceTotalAvailable).length > 0
        ? { sourceTotalAvailable }
        : {}),
      // Multi-source distributions are factored into target totals followed by
      // physical source allocation. The two chooser ids may be equal: that
      // preserves the complete self-owned choice surface without making a
      // policy enumerate targets, sources, and soul cores in one node.
      targetTotalSelection: {
        mode: "target_totals_then_core_owner_sources" as const,
        targetChooserPlayerId: actingPlayerId,
        sourceOwnerPlayerId: actingPlayerId,
      },
      ...(minTotal > 0 ? { minTotal } : {}),
      fromPlayerId: actingPlayerId,
      toPlayerId: actingPlayerId,
      effectTiming: { kind: "activated", mode: "main" },
      ...(battleEndDeferralAttackId !== undefined
        ? { battleEndDeferralAttackId }
        : {}),
      priorStateSnapshot,
    },
  };
}

// --- life_damage_interception: ライフダメージインターセプション CE 登録 ---

export function executeLifeDamageInterception(
  action: DSL.LifeDamageInterceptionAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  effect: Effect,
  provenance?: { effectIndex: number; stepIndex: number },
  resolvedTargetIds?: string[]
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);

  // attackerSelf / attackerSelectedTarget はどちらも attackerInstanceIds として
  // 「ライフ減少を 0 にするアタッカー leader」を CE metadata に格納する（受け口は
  // getUnblockedLifeDamage の prevention.instanceIds 照合で共通）。
  // attackerSelectedTarget はプレイヤーが解決時に選んだ対象 (resolvedTargetIds)。
  const attackerInstanceIds: string[] | undefined = action.attackerSelf
    ? [sourceInstanceId]
    : action.attackerSelectedTarget &&
        resolvedTargetIds &&
        resolvedTargetIds.length > 0
      ? resolvedTargetIds
      : undefined;

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("life_damage_interception"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag: "life_damage_interception" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(effect.timingScope ? { timingScope: effect.timingScope } : {}),
    ...(provenance ? { provenance } : {}),
    metadata: {
      cause: action.cause,
      mode: action.mode,
      turnThreshold: action.turnThreshold ?? 1,
      floor: action.floor ?? 1,
      ...(action.cap !== undefined ? { cap: action.cap } : {}),
      ...(action.attackerBpTurnCap !== undefined
        ? { attackerBpTurnCap: action.attackerBpTurnCap }
        : {}),
      ...(action.attackerFilter
        ? { attackerFilter: action.attackerFilter }
        : {}),
      ...(action.battleOnly ? { battleOnly: true } : {}),
      ...(attackerInstanceIds ? { attackerInstanceIds } : {}),
      ...(action.coreAction
        ? {
            coreAction: {
              from: action.coreAction.from,
              to: action.coreAction.to,
            },
          }
        : {}),
      ...(action.discardCostGate
        ? { discardCostGate: action.discardCostGate }
        : {}),
      ...(action.useCostGate ? { useCostGate: action.useCostGate } : {}),
      ...(action.declareGimmickGate
        ? { declareGimmickGate: action.declareGimmickGate }
        : {}),
    },
  };

  state.log.push(
    `effect:life_damage_interception:registered:${targetPlayerId}:mode=${action.mode}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}

// --- grant_life_damage_source_prevention_immunity: 「[sourceFilter] 一致カードに
//     よるライフの減少は相手の効果では防げない」player-scoped CE 登録 (P3-125 Step3)。

export function executeGrantLifeDamageSourcePreventionImmunity(
  action: DSL.GrantLifeDamageSourcePreventionImmunityAction,
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  provenance?: { effectIndex: number; stepIndex: number }
): GameState {
  const sourceCard = getCardById(state, sourceInstanceId);
  const targetPlayerId = resolvePlayerRef(actingPlayerId, action.player, state);

  const newEffect: ContinuousEffect = {
    effectId: nextDslCeId("life_damage_source_prevention_immunity"),
    sourceInstanceId,
    sourceDefinitionId: sourceCard?.definitionId ?? "dsl-unknown",
    actingPlayerId,
    duration: action.duration,
    createdAtTurn: state.turnNumber,
    createdAtAttackId: state.activeAttack?.attackId ?? null,
    modifierTag:
      "life_damage_source_prevention_immunity" as ContinuousEffectTag,
    targetInstanceId: targetPlayerId,
    ...(provenance ? { provenance } : {}),
    metadata: {
      sourceFilter: action.sourceFilter,
    },
  };

  state.log.push(
    `effect:life_damage_source_prevention_immunity:registered:${targetPlayerId}`
  );
  return {
    ...state,
    activeContinuousEffects: [...state.activeContinuousEffects, newEffect],
  };
}
