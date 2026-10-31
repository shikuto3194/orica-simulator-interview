// Card-replacement クラスタ (P2-12): structured-effect-interpreter.ts から抽出。
// 破壊/消滅/ゲーム外/煌臨変身/転生/逆転生などカード置換系実行。

import { replaceCardInstances } from "../zone/card-instance-state";
import { getAttackDeclarationBlockReason } from "../battle/battle-availability";
import {
  recomputeBattleEntityBp,
  removeBattleEntityMembersAndRecompute,
} from "../battle/battle-shared";
import { getCardById } from "../card/card-lookup";
import { getCEsForTarget } from "../card/ce-lookup";
import {
  getTotalCoresOnCardById,
  resolveCardLeavesFieldCores,
  updateCard,
  updatePlayer,
} from "../core/core-system";
import { calculateReduction } from "../core/cost-system";
import { getAvailableCardCostPaymentSources } from "../core/payment-system";
import { reverseRebirthSummonSourceReturnedState } from "../core/reverse-rebirth-core-return";
import {
  getDefaultZoneRoleName,
  getMinimumRequiredCoresFromDefinition,
} from "../factories";
import {
  getEffectiveLevelCostDelta,
  getValidBraveCombineHosts,
} from "../legal/legal-actions-shared";
import { getEffectiveCategory } from "../mechanics/act-as-spirit";
import { attachAsAdventSource } from "../mechanics/advent-system";
import { resolveSeparatedBraveExhaustState } from "../mechanics/brave-spirit-state-recovery";
import { buildChargeCoresPendingCoreDistribution } from "../mechanics/core-charge-distribution";
import {
  createPostChoiceRebirthCompletion,
  nextRebirthPostChoicePendingId,
} from "../mechanics/rebirth-post-choice";
import type {
  ActiveStack,
  CardCategory,
  CardDefinition,
  CardInstance,
  DivineTransformAction,
  EffectPlayerRef,
  EffectTarget,
  GameState,
  PendingLeaveCause,
  PendingTriggeredEffect,
  PlayerState,
  RebirthAction,
  RemoveFromGameAction,
  ReverseRebirthAction,
} from "../model";
import { adventSourceIdsOf, stripUnderCardReferences } from "../model";
import type { Effect } from "../dsl-types";
import type { DeferredStackResolverOptions } from "../legal/stack-resolution-types";
import { queuePendingLeave } from "../state-based-actions";
import { applyFaceDownPolicyOnZoneChange } from "../zone/face-down-policy";
import { collectAndQueueTriggerReactions } from "./trigger-system";
import { recomputeAndRebuildContinuousEffectsForSources } from "./continuous-effect-rebuild";
import {
  executeCountIncrease,
  shrinkProtectedCounts,
  withCount,
} from "./structured-modifiers";
import { isCardLeaveAffectBlockedByResistance } from "./effect-affect-adapter";
import type { ResistanceSourceCause } from "./effect-resistance-check";
import {
  resolveCardLeaveGate,
  resolvePlayerRef,
  resolveTargetCards,
} from "./structured-effect-interpreter";
import { nextVanishCoreDestinationId } from "./structured-effect-sequences";
import { synthesizeBackFaceDefinition } from "./structured-effect-registrations";
import type { TargetLockBypassProfile } from "./target-affect-gate";

/** アタック宣言とその疲労は共通原因。効果による後続の疲労はこの窓を使わない。 */
export function getAttackDeclarationRebirthTimingWindowId(
  attackId: string,
  simultaneousGroupId: string,
  actingPlayerId: string
): string {
  return [
    "pending_triggered",
    "attack_declaration",
    attackId,
    simultaneousGroupId,
    actingPlayerId,
  ].join(":");
}

/** 同じ誘発群でも原因（召喚 / ライフ増加等）が異なる転醒は共存する。10_rules/08a §2。 */
export function getPendingTriggeredRebirthTimingWindowId(
  pending: PendingTriggeredEffect,
  actingPlayerId = pending.actingPlayerId
): string {
  if (
    (pending.eventKind === "attack" || pending.eventKind === "exhaust") &&
    pending.chainId === pending.attackId &&
    pending.attackId !== null &&
    pending.simultaneousGroupId !== undefined
  ) {
    return getAttackDeclarationRebirthTimingWindowId(
      pending.attackId,
      pending.simultaneousGroupId,
      actingPlayerId
    );
  }
  return [
    "pending_triggered",
    pending.simultaneousGroupId ?? pending.pendingId,
    actingPlayerId,
    pending.chainId,
    pending.eventKind,
  ].join(":");
}

export function hasRebirthResolvedInCurrentTimingWindow(
  state: GameState,
  rebirthTimingWindowId?: string
): boolean {
  if (rebirthTimingWindowId !== undefined) {
    if (hasRebirthResolvedInTimingWindow(state, rebirthTimingWindowId))
      return true;
    if (rebirthTimingWindowId.startsWith("pending_triggered:")) return false;
  }
  const sameTimingScanStart = state.actionStartLogIndex ?? 0;
  return state.log
    .slice(sameTimingScanStart)
    .some((l) => l.startsWith("effect:rebirth:") && l.includes(":flip_to:"));
}

const REBIRTH_TIMING_WINDOW_MARKER_PREFIX =
  "effect:rebirth:timing-window-resolved:";

export function hasRebirthResolvedInTimingWindow(
  state: GameState,
  rebirthTimingWindowId: string
): boolean {
  return (
    (state.resolvedRebirthTimingWindowIds?.includes(rebirthTimingWindowId) ??
      false) ||
    state.log.includes(
      `${REBIRTH_TIMING_WINDOW_MARKER_PREFIX}${rebirthTimingWindowId}`
    )
  );
}

function markRebirthResolvedInTimingWindow(
  state: GameState,
  rebirthTimingWindowId: string | undefined
): void {
  if (
    rebirthTimingWindowId === undefined ||
    hasRebirthResolvedInTimingWindow(state, rebirthTimingWindowId)
  ) {
    return;
  }
  state.resolvedRebirthTimingWindowIds = [
    ...(state.resolvedRebirthTimingWindowIds ?? []),
    rebirthTimingWindowId,
  ];
  state.log.push(
    `${REBIRTH_TIMING_WINDOW_MARKER_PREFIX}${rebirthTimingWindowId}`
  );
}

export function applyRebirthCountBonus(
  player: PlayerState,
  action: RebirthAction
): PlayerState {
  switch (action.countBonusMode ?? "increment_1") {
    case "increment_1": {
      const actualIncrease = Math.min(player.voidNormalCoreCount, 1);
      return {
        ...withCount(
          player,
          player.countValue + actualIncrease,
          player.protectedCounts
        ),
        voidNormalCoreCount: player.voidNormalCoreCount - actualIncrease,
      };
    }
    case "reset_to_zero":
      return {
        ...withCount(
          player,
          0,
          shrinkProtectedCounts(player.protectedCounts, 0)
        ),
        voidNormalCoreCount: player.voidNormalCoreCount + player.countValue,
      };
    case "none":
      return withCount(player, player.countValue, player.protectedCounts);
  }
}

function normalizeBattleEntitiesAfterFoldedAdventSources(
  state: GameState,
  sourceInstanceId: string,
  foldedPartnerIds: readonly string[],
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  if (foldedPartnerIds.length === 0 || state.battleEntities.length === 0) {
    return state;
  }

  const folded = new Set(foldedPartnerIds);
  const source = getCardById(state, sourceInstanceId);
  const sourceCanRemainParticipant =
    source?.zone === "field" &&
    source.zoneRoleName !== "advent-source" &&
    source.pendingLeaveKind === null;
  // 転醒後の本体へ参加を引き継いでから、共通処理で煌臨元を除く。
  // 空になった参加体・成立済みバトルの寿命はここでは変更しない。
  const battleEntities = sourceCanRemainParticipant
    ? state.battleEntities.map((entity) =>
        entity.memberInstanceIds.some((id) => folded.has(id)) &&
        !entity.memberInstanceIds.includes(sourceInstanceId)
          ? {
              ...entity,
              memberInstanceIds: [
                sourceInstanceId,
                ...entity.memberInstanceIds,
              ],
            }
          : entity
      )
    : state.battleEntities;
  return removeBattleEntityMembersAndRecompute(
    { ...state, battleEntities },
    foldedPartnerIds,
    getCardDefinitionById
  );
}

export function canExecuteRebirthNow(
  state: GameState,
  actingPlayerId: string,
  action: Pick<RebirthAction, "maxCount" | "forceTriggerCondition">,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  rebirthTimingWindowId?: string
): boolean {
  const card = getCardById(state, sourceInstanceId);
  if (!card) return false;
  if (
    card.zone !== "field" &&
    card.zone !== "hand" &&
    card.zone !== "set_aside" &&
    card.zone !== "in_use"
  ) {
    return false;
  }

  const def = getCardDefinitionById(card.definitionId);
  if (!def || !def.isDoubleSided || !def.backFace) return false;

  if (!action.forceTriggerCondition) {
    const player = state.players.find((p) => p.id === actingPlayerId);
    const currentCount = player?.countValue ?? 0;
    if (currentCount > (action.maxCount ?? Number.POSITIVE_INFINITY))
      return false;
  }

  return !hasRebirthResolvedInCurrentTimingWindow(state, rebirthTimingWindowId);
}

type RebirthEffectGate = {
  maxCount: number;
  forceTriggerCondition?: boolean;
};

export function getRebirthEffectGate(
  effect: Effect | undefined
): RebirthEffectGate | null {
  if (!effect) return null;

  for (const step of effect.steps) {
    const condition = step.stepCondition;
    if (condition?.kind === "rebirth_precheck" && condition.not !== true) {
      return {
        maxCount: condition.maxCount ?? Number.POSITIVE_INFINITY,
        ...(condition.forceTriggerCondition
          ? { forceTriggerCondition: true }
          : {}),
      };
    }
  }

  for (const step of effect.steps) {
    const action = step.action;
    if (action.kind === "rebirth") {
      return {
        maxCount: action.maxCount ?? Number.POSITIVE_INFINITY,
        ...(action.forceTriggerCondition
          ? { forceTriggerCondition: true }
          : {}),
      };
    }
  }

  return null;
}

export function canExecuteRebirthEffectNow(
  state: GameState,
  actingPlayerId: string,
  effect: Effect | undefined,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  rebirthTimingWindowId?: string
): boolean {
  const gate = getRebirthEffectGate(effect);
  if (!gate) return true;
  return canExecuteRebirthNow(
    state,
    actingPlayerId,
    gate,
    sourceInstanceId,
    getCardDefinitionById,
    rebirthTimingWindowId
  );
}

export function executeDestroy(
  state: GameState,
  actingPlayerId: string,
  target: EffectTarget,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  suppressDestroyedEffects?: "destroyed_only" | "all_opponent",
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  suppressDestroyedEffectsByCategory?: CardCategory[],
  sourceCause: ResistanceSourceCause = "effect",
  pendingLeaveCause: PendingLeaveCause = "effect_resolution",
  pendingLeaveCausePlayerId?: string | null,
  sourcePreventionBypass?: TargetLockBypassProfile,
  /**
   * BSLH01-C07 (ENGINE-soul-drive-departure-prevention-immunity): 【ソウルドライブ・S】発揮元
   * 効果が grant_effect_source_prevention_immunity(soulDriveDeparture) の対象になったときだけ
   * true。stay_on_field 型残置リアクション (`queuePendingLeave` の `preventStayOnField`) を
   * BSLH01-T10 の `pierceCannotLeaveField` と同様に貫通させる (destroy 経路)。
   */
  preventStayOnField?: boolean,
  pendingLeaveChainId?: string,
  preservePreSelectedTargetRefs?: boolean
): GameState {
  const targetPlayerIds =
    target.player === "either"
      ? state.players.map((player) => player.id)
      : [resolvePlayerRef(actingPlayerId, target.player, state)];
  const seenTargetIds = new Set<string>();
  let toDestroy = targetPlayerIds
    .flatMap((targetPlayerId) =>
      resolveTargetCards(
        state,
        targetPlayerId,
        target,
        getCardDefinitionById,
        sourceInstanceId ?? "dsl-unknown",
        preSelectedIds,
        actingPlayerId,
        sourcePreventionLevel,
        sourceTargetLockBypass,
        true,
        !target.includeGrandwalker
          ? (card) => !card.divineTransformState?.protectedFromNonGrandwalker
          : undefined,
        sourcePreventionBypass,
        undefined,
        undefined,
        {
          preservePreSelectedTargetRefs: preservePreSelectedTargetRefs === true,
        }
      )
    )
    .filter((card) => {
      if (seenTargetIds.has(card.instanceId)) return false;
      seenTargetIds.add(card.instanceId);
      return true;
    })
    // A target selected before a response window can leave the field while
    // that response resolves. A destroy action only affects field cards, so
    // preserve the already-selected target identity but fizzle it at
    // resolution instead of passing an off-field card to queuePendingLeave.
    .filter((card) => card.zone === "field" && card.pendingLeaveKind === null);

  // 残置抑制を per-card で適用するかの判定 (suppressDestroyedEffectsByCategory との AND)。
  // pierce 判定 (Q19) も同じ per-card 真偽に揃える: category 外のカードは「効果は発揮されない」
  // を受けないので cannot_leave_field を貫通させてはいけない (verifier 2026-06-23 round 8 lens 4)。
  // category 判定は SSOT として getEffectiveCategory を使う (act_as_spirit 等の treat-as に追従)。
  const computePerCardSuppress = (
    c: CardInstance,
    s: GameState
  ): "destroyed_only" | "all_opponent" | undefined => {
    if (suppressDestroyedEffects === undefined) return undefined;
    if (suppressDestroyedEffectsByCategory === undefined) {
      return suppressDestroyedEffects;
    }
    const def = getCardDefinitionById(c.definitionId);
    if (!def) return undefined;
    const effCat = getEffectiveCategory(s, c, def);
    if (effCat === undefined) return undefined;
    return suppressDestroyedEffectsByCategory.includes(effCat)
      ? suppressDestroyedEffects
      : undefined;
  };
  // P3-41: cannot_be_destroyed / cannot_leave_field 効果耐性で阻止される対象を除外
  // P3-43: sourcePreventionLevel === "unpreventable" のとき耐性を貫通
  // P3-74 Phase A: suppressDestroyedEffects (「効果は発揮されない」) を伴う破壊効果は
  //   Q19 裁定により cannot_leave_field 常時効果を貫通する (cannot_be_destroyed は貫通対象外)。
  // 残置抑制が per-card で異なる場合 (suppressDestroyedEffectsByCategory 指定時)、
  // gate も per-card に分けて pierce 値を切り替える。
  const willSuppressMap = new Map<string, boolean>();
  for (const c of toDestroy) {
    willSuppressMap.set(
      c.instanceId,
      computePerCardSuppress(c, state) !== undefined
    );
  }
  const suppressingTargets = toDestroy.filter((c) =>
    willSuppressMap.get(c.instanceId)
  );
  const nonSuppressingTargets = toDestroy.filter(
    (c) => !willSuppressMap.get(c.instanceId)
  );
  const suppressingGate =
    suppressingTargets.length > 0
      ? resolveCardLeaveGate(
          state,
          suppressingTargets,
          "destroy",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          true,
          sourceCause,
          sourcePreventionBypass
        )
      : { allowed: [], blocked: [] };
  const nonSuppressingGate =
    nonSuppressingTargets.length > 0
      ? resolveCardLeaveGate(
          state,
          nonSuppressingTargets,
          "destroy",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          false,
          sourceCause,
          sourcePreventionBypass
        )
      : { allowed: [], blocked: [] };
  const destroyAllowed = [
    ...suppressingGate.allowed,
    ...nonSuppressingGate.allowed,
  ];
  const destroyBlocked = [
    ...suppressingGate.blocked,
    ...nonSuppressingGate.blocked,
  ];
  // P3-105 Phase B: cannot_* / cannot_leave_field 判定結果を TargetRef ベースの
  // AffectDecision に畳んでから既存 destroy queue へ戻す。ログと pendingLeave の形は
  // P3-41/P3-74 互換のまま維持する。
  // P3-74 Phase B: cannot_leave_field 耐性で物理離脱が阻止された対象も pendingLeave に
  // blockedByResistance:true で積む。Q16/Q17 準拠で破壊判定の成立を内包 conditional_result から
  // 参照可能にする (card.pendingLeaveKind はセットしないのでフィールドには残る)。
  let current = state;
  const suppressedDestroyBatchChainId =
    suppressDestroyedEffects !== undefined
      ? `effect:destroy:${actingPlayerId}:${sourceInstanceId ?? "unknown"}:${state.log.length}`
      : null;
  for (const card of destroyBlocked) {
    current.log.push(
      `effect:destroy:blocked-by-resistance:${actingPlayerId}:${card.instanceId}`
    );
    current = queuePendingLeave({
      state: current,
      instanceId: card.instanceId,
      kind: "destroy",
      cause: pendingLeaveCause,
      chainId:
        pendingLeaveChainId ??
        suppressedDestroyBatchChainId ??
        `effect:destroy:${actingPlayerId}:${card.instanceId}`,
      causePlayerId: pendingLeaveCausePlayerId ?? actingPlayerId,
      blockedByResistance: true,
      outcomeEstablished:
        resolveCardLeaveGate(
          state,
          [card],
          "destroy",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          true,
          sourceCause,
          sourcePreventionBypass
        ).allowed.length > 0,
      causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      causedByEffectSourcePreventionLevel: sourcePreventionLevel ?? "none",
    });
  }
  toDestroy = destroyAllowed;
  if (toDestroy.length === 0) return current;

  // P3-74 Phase C: Q19 貫通の追跡可能性。pierce が掛かった (= per-card で suppress 有り)
  // 対象が、pierce 無しなら cannot_leave_field で阻止されたはずの場合に
  // `cannot-leave-field-pierced` ログを残す (なぜ destroy が成立したかの追跡用)。
  const piercedInstanceIds = new Set<string>();
  for (const c of toDestroy) {
    if (!willSuppressMap.get(c.instanceId)) continue;
    const wouldBlockWithoutPierce = isCardLeaveAffectBlockedByResistance(
      state,
      c,
      "destroy",
      actingPlayerId,
      getCardDefinitionById,
      sourcePreventionLevel,
      false
    );
    if (wouldBlockWithoutPierce) {
      piercedInstanceIds.add(c.instanceId);
    }
  }

  for (const card of toDestroy) {
    if (piercedInstanceIds.has(card.instanceId)) {
      current.log.push(
        `effect:destroy:cannot-leave-field-pierced:${actingPlayerId}:${card.instanceId}`
      );
    }
    current.log.push(`effect:destroy:${actingPlayerId}:${card.instanceId}`);
    const perCardSuppress = computePerCardSuppress(card, current);
    current = queuePendingLeave({
      state: current,
      instanceId: card.instanceId,
      kind: "destroy",
      cause: pendingLeaveCause,
      chainId:
        pendingLeaveChainId ??
        suppressedDestroyBatchChainId ??
        `effect:destroy:${actingPlayerId}:${card.instanceId}`,
      causePlayerId: pendingLeaveCausePlayerId ?? actingPlayerId,
      deferZoneMoveUntilChainEnd: false,
      ...(perCardSuppress ? { suppressDestroyedEffects: perCardSuppress } : {}),
      causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      causedByEffectSourcePreventionLevel: sourcePreventionLevel ?? "none",
      ...(preventStayOnField ? { preventStayOnField: true } : {}),
    });
  }
  return current;
}

export function executeDivineTransform(
  state: GameState,
  actingPlayerId: string,
  action: DivineTransformAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const targets = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true
  );
  if (targets.length === 0) return state;

  const transformIds = new Set(targets.map((c) => c.instanceId));
  const transformState: import("../model").DivineTransformState = {
    bpByLevel: action.bpByLevel,
    ...(action.colors ? { colors: action.colors } : {}),
    ...(action.symbols ? { symbols: action.symbols } : {}),
    protectedFromNonGrandwalker: action.protectedFromNonGrandwalker ?? true,
  };

  for (const card of targets) {
    state.log.push(
      `effect:divine_transform:${actingPlayerId}:${card.instanceId}`
    );
  }

  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) =>
      transformIds.has(c.instanceId)
        ? { ...c, divineTransformState: transformState }
        : c
    )
  );
}

export function executeVanish(
  state: GameState,
  actingPlayerId: string,
  target: EffectTarget,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  suppressDestroyedEffects?: "destroyed_only" | "all_opponent",
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  braveCannotRemain?: boolean,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  /**
   * 「この効果で消滅する…のコアは、相手がリザーブ/トラッシュに置く」型の対象コントローラー
   * 選択 (BSTH02-X02 界放)。指定時、最初に見つかった normalCoreCount > 0 の対象だけ
   * `pendingCoreSplitSelection` (fromLocation:card_instance, actingPlayerId=対象コントローラー)
   * を生成して行き先選択を挟む。既存の core_move splitDestinations 選択機構を再利用する。
   */
  coreDestinationChoice?: { options: ("reserve" | "trash")[] },
  effectTiming?: import("../model").EffectTiming,
  sourcePreventionBypass?: TargetLockBypassProfile,
  pendingLeaveChainId?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(actingPlayerId, target.player, state);
  const rawToVanish = resolveTargetCards(
    state,
    targetPlayerId,
    target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    undefined,
    sourcePreventionBypass
  );

  // P3-41: cannot_be_vanished / cannot_leave_field 効果耐性で阻止される対象を除外
  // P3-43: sourcePreventionLevel === "unpreventable" のとき耐性を貫通
  // P3-74/Q19: suppressDestroyedEffects（「その効果を発揮させない」）を伴う消滅は
  //   destroy と同じく cannot_leave_field 常時効果を貫通する（cannot_be_vanished は貫通対象外）。
  const pierceCannotLeaveField = suppressDestroyedEffects !== undefined;
  const vanishFilter = resolveCardLeaveGate(
    state,
    rawToVanish,
    "vanish",
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    pierceCannotLeaveField,
    "effect",
    sourcePreventionBypass
  );
  let current = state;
  for (const card of vanishFilter.blocked) {
    current.log.push(
      `effect:vanish:blocked-by-resistance:${actingPlayerId}:${card.instanceId}`
    );
    current = queuePendingLeave({
      state: current,
      instanceId: card.instanceId,
      kind: "vanish",
      cause: "effect_resolution",
      chainId:
        pendingLeaveChainId ??
        `effect:vanish:${actingPlayerId}:${card.instanceId}`,
      causePlayerId: actingPlayerId,
      blockedByResistance: true,
      outcomeEstablished:
        resolveCardLeaveGate(
          state,
          [card],
          "vanish",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          true,
          "effect",
          sourcePreventionBypass
        ).allowed.length > 0,
      causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      causedByEffectSourcePreventionLevel: sourcePreventionLevel ?? "none",
    });
  }
  const toVanish = vanishFilter.allowed;
  if (toVanish.length === 0) return current;

  // Q19 貫通の追跡可能性（destroy と同じく、pierce 無しなら阻止されたはずの対象に
  // ログを残す）。
  const piercedInstanceIds = new Set<string>();
  if (pierceCannotLeaveField) {
    for (const c of toVanish) {
      if (
        isCardLeaveAffectBlockedByResistance(
          state,
          c,
          "vanish",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          false,
          sourcePreventionBypass
        )
      ) {
        piercedInstanceIds.add(c.instanceId);
      }
    }
  }

  let totalCoresReturned = 0;
  let coreDestinationChoiceTarget: {
    instanceId: string;
    definitionId: string;
    normalCoreCount: number;
  } | null = null;
  for (const card of toVanish) {
    // 複数対象同時消滅時は最初の 1 体だけ選択対象にする（pendingCoreSplitSelection は
    // 単一スロットのため。現行カードは count:1 の vanish のみがこのフィールドを使う）。
    const useCoreDestinationChoice =
      coreDestinationChoice !== undefined &&
      coreDestinationChoiceTarget === null &&
      card.normalCoreCount > 0;
    if (piercedInstanceIds.has(card.instanceId)) {
      current.log.push(
        `effect:vanish:cannot-leave-field-pierced:${actingPlayerId}:${card.instanceId}`
      );
    }
    if (useCoreDestinationChoice) {
      coreDestinationChoiceTarget = {
        instanceId: card.instanceId,
        definitionId: card.definitionId,
        normalCoreCount: card.normalCoreCount,
      };
      current.log.push(
        `effect:vanish:${actingPlayerId}:${card.instanceId}:cores_destination_choice:${card.normalCoreCount}`
      );
    } else {
      totalCoresReturned += card.normalCoreCount;
      current.log.push(
        `effect:vanish:${actingPlayerId}:${card.instanceId}:cores_to_reserve:${card.normalCoreCount}`
      );
      current = updateCard(current, card.instanceId, (c) => ({
        ...c,
        normalCoreCount: 0,
      }));
    }
    current = queuePendingLeave({
      state: current,
      instanceId: card.instanceId,
      kind: "vanish",
      cause: "effect_resolution",
      chainId:
        pendingLeaveChainId ??
        `effect:vanish:${actingPlayerId}:${card.instanceId}`,
      causePlayerId: actingPlayerId,
      deferZoneMoveUntilChainEnd: false,
      // useCoreDestinationChoice のカードは pendingCoreSplitSelection 解決時に
      // executeCoreMove がコアを退避し終える（flush 時点で normalCoreCount=0 済み）ため、
      // override は不要。
      ...(useCoreDestinationChoice
        ? {}
        : {
            leaveFieldCoreDestinationOverride: {
              normalCoreDestination: {
                kind: "reserve" as const,
                playerId: targetPlayerId,
              },
            },
          }),
      ...(suppressDestroyedEffects ? { suppressDestroyedEffects } : {}),
      ...(braveCannotRemain ? { forceBraveSendWithHost: true } : {}),
      causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      causedByEffectSourcePreventionLevel: sourcePreventionLevel ?? "none",
    });
  }
  if (totalCoresReturned > 0) {
    current = updatePlayer(current, targetPlayerId, (p) => ({
      ...p,
      reserveNormalCoreCount: p.reserveNormalCoreCount + totalCoresReturned,
    }));
  }
  if (coreDestinationChoiceTarget) {
    const options =
      coreDestinationChoice && coreDestinationChoice.options.length > 0
        ? coreDestinationChoice.options
        : (["reserve", "trash"] as const);
    current = {
      ...current,
      pendingCoreSplitSelection: {
        pendingId: nextVanishCoreDestinationId(),
        // 選択者 = 消滅したカードのコントローラー（カードテキスト上の「相手」）。
        // vanish の actingPlayerId (幽々子側) とは別人。
        actingPlayerId: targetPlayerId,
        sourceInstanceId: coreDestinationChoiceTarget.instanceId,
        sourceDefinitionId: coreDestinationChoiceTarget.definitionId,
        fromLocation: {
          kind: "card_instance",
          instanceId: coreDestinationChoiceTarget.instanceId,
        },
        totalAmount: coreDestinationChoiceTarget.normalCoreCount,
        destinations: options.map((kind) => ({
          location: { kind, player: "self" as EffectPlayerRef },
        })),
        effectTiming: effectTiming as import("../model").EffectTiming,
      },
    };
  }
  return current;
}

export function executeRemoveFromGame(
  state: GameState,
  actingPlayerId: string,
  action: RemoveFromGameAction,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  sourceInstanceId?: string,
  preSelectedIds?: string[],
  sourcePreventionLevel?: import("../model").EffectPreventionLevel,
  sourceTargetLockBypass?: TargetLockBypassProfile,
  sourcePreventionBypass?: TargetLockBypassProfile,
  pendingLeaveChainId?: string,
  battleEndDeferralAttackId?: string
): GameState {
  const targetPlayerId = resolvePlayerRef(
    actingPlayerId,
    action.target.player,
    state
  );
  const rawToRemove = resolveTargetCards(
    state,
    targetPlayerId,
    action.target,
    getCardDefinitionById,
    sourceInstanceId ?? "dsl-unknown",
    preSelectedIds,
    actingPlayerId,
    sourcePreventionLevel,
    sourceTargetLockBypass,
    true,
    undefined,
    sourcePreventionBypass
  );

  // P3-41: cannot_be_removed_from_game / cannot_leave_field 効果耐性で阻止される対象を除外
  // P3-43: sourcePreventionLevel === "unpreventable" のとき耐性を貫通
  // 「この効果で離れた対象はフィールドに残せない」(BSLH01-T10): pierceCannotLeaveField が
  //   指定されていれば cannot_leave_field のみ貫通する（cannot_be_removed_from_game は維持）。
  const pierceCannotLeaveField = action.pierceCannotLeaveField === true;
  const removeFilter = resolveCardLeaveGate(
    state,
    rawToRemove,
    "remove_from_game",
    actingPlayerId,
    getCardDefinitionById,
    sourcePreventionLevel,
    pierceCannotLeaveField,
    "effect",
    sourcePreventionBypass
  );
  for (const card of removeFilter.blocked) {
    state.log.push(
      `effect:remove_from_game:blocked-by-resistance:${actingPlayerId}:${card.instanceId}`
    );
  }
  const toRemove = removeFilter.allowed;
  if (toRemove.length === 0) return state;
  // Q19 貫通の追跡可能性。pierce 無しなら阻止されたはずの対象にログを残す（destroy / vanish と同様）。
  const piercedInstanceIds = new Set<string>();
  if (pierceCannotLeaveField) {
    for (const card of toRemove) {
      if (
        isCardLeaveAffectBlockedByResistance(
          state,
          card,
          "remove_from_game",
          actingPlayerId,
          getCardDefinitionById,
          sourcePreventionLevel,
          false,
          sourcePreventionBypass
        )
      ) {
        piercedInstanceIds.add(card.instanceId);
      }
    }
  }

  // Step 4/4 (ENGINE-remove-from-game-attached-brave-orphan):
  // フィールド離脱の対象は queuePendingLeave 経由化する。
  // - 合体ホスト × 残存ブレイヴ: flushPendingLeaves → checkBraveLeaveChoice で
  //   pendingBraveLeaveChoice が立ち、orphan を解消（Step 3 で配線確認済）。
  // - 煌臨元の追従移動 / 魂状態 cleanup / コアリザーブ復帰 / B→A 面復帰 / アンダーカード破棄 /
  //   replace_field_exit 置換は flushPendingLeaves 側の SSOT パイプラインに統合される。
  //
  // 非フィールド対象 (set_aside / trash / hand 等。例: BSTS01-M01 = 相手手元カード除外) は
  // フィールド離脱機構を持たないため、queuePendingLeave に通さず直接 zone を切り替える。
  // 場特有の付随処理 (合体 / 煌臨元 / コア / 魂状態) は元から該当しない。
  const fieldTargetChildIdsToFollowHost = new Set<string>();
  for (const card of toRemove) {
    if (card.zone !== "field") continue;
    for (const childId of card.attachedChildrenIds) {
      fieldTargetChildIdsToFollowHost.add(childId);
    }
  }
  const fieldTargets = toRemove.filter(
    (c) =>
      c.zone === "field" && !fieldTargetChildIdsToFollowHost.has(c.instanceId)
  );
  const nonFieldTargets = toRemove.filter((c) => c.zone !== "field");

  let current = state;
  for (const card of fieldTargets) {
    if (piercedInstanceIds.has(card.instanceId)) {
      current.log.push(
        `effect:remove_from_game:cannot-leave-field-pierced:${actingPlayerId}:${card.instanceId}`
      );
    }
    current.log.push(
      `effect:remove_from_game:${card.instanceId}:cores_to_reserve:${card.normalCoreCount}`
    );
    current = queuePendingLeave({
      state: current,
      instanceId: card.instanceId,
      kind: "remove_from_game",
      cause: "effect_resolution",
      chainId:
        pendingLeaveChainId ??
        `effect:remove_from_game:${actingPlayerId}:${card.instanceId}`,
      causePlayerId: actingPlayerId,
      deferZoneMoveUntilChainEnd: false,
      ...(pierceCannotLeaveField ? { preventStayOnField: true } : {}),
      causedByEffectSourceInstanceId: sourceInstanceId ?? null,
      causedByEffectSourcePreventionLevel: sourcePreventionLevel ?? "none",
    });
  }

  if (nonFieldTargets.length > 0) {
    // ENGINE-set-aside-exit-replacement-choice: 自分自身の効果で手元 (set_aside) の
    // カードを除外しようとしているとき、`effect_resistance` の `replace_field_exit`
    // 置換 (`replacement.kind:"move_to"`, `source:"self"`) が一致すれば、通常の除外の
    // 代わりに「置換先へ移動する / そのまま除外する」の選択を提示する
    // (BSTH08.5-M11「自分がこのカードを除外するとき、かわりに手札に戻せる」)。
    // BSAZ01-C03の複数対象も、各札の自己置換を選び終えるまで待機させる。
    const choiceTargets: {
      card: CardInstance;
      replacement: SetAsideExitReplacementMatch;
    }[] = [];
    for (const card of nonFieldTargets) {
      if (card.zone !== "set_aside") continue;
      if (card.controllerPlayerId !== actingPlayerId) continue;
      const match = findSelfSetAsideExitReplacementMatch(
        state,
        card.instanceId
      );
      if (match) {
        choiceTargets.push({ card, replacement: match });
      }
    }

    const choiceIds = new Set(choiceTargets.map(({ card }) => card.instanceId));
    const directTargets = nonFieldTargets.filter(
      (c) => !choiceIds.has(c.instanceId)
    );
    current = applyNonFieldRemoveFromGameStamp(current, directTargets);

    const firstChoice = choiceTargets[0];
    if (firstChoice) {
      const { card: choiceTarget, replacement: choiceReplacement } =
        firstChoice;
      current.log.push(
        `set-aside-exit-replacement:pending:${choiceTarget.instanceId}`
      );
      current = {
        ...current,
        pendingSetAsideExitReplacementChoice: {
          choosingPlayerId: choiceTarget.controllerPlayerId,
          cardInstanceId: choiceTarget.instanceId,
          removalTargetInstanceIds: toRemove.map((c) => c.instanceId),
          ...(choiceTargets.length > 1
            ? {
                remainingCardInstanceIds: choiceTargets
                  .slice(1)
                  .map(({ card }) => card.instanceId),
              }
            : {}),
          ...(battleEndDeferralAttackId !== undefined
            ? { battleEndDeferralAttackId }
            : {}),
          replacement: choiceReplacement,
        },
      };
    }
  }
  return current;
}

/** 1枚の置換解決後、未選択札の現在位置・コントローラー・CEを再評価する。 */
export function advanceSetAsideExitReplacementChoice(
  state: GameState,
  previous: NonNullable<GameState["pendingSetAsideExitReplacementChoice"]>
): GameState {
  let current: GameState = {
    ...state,
    pendingSetAsideExitReplacementChoice: null,
  };
  const remaining = [...(previous.remainingCardInstanceIds ?? [])];
  while (remaining.length > 0) {
    const id = remaining.shift()!;
    const card = current.cardInstances.find((c) => c.instanceId === id);
    if (!card || card.zone !== "set_aside") continue;
    const replacement =
      card.controllerPlayerId === previous.choosingPlayerId
        ? findSelfSetAsideExitReplacementMatch(current, id)
        : null;
    if (!replacement) {
      current = applyNonFieldRemoveFromGameStamp(current, [card]);
      continue;
    }
    const { remainingCardInstanceIds: _previousRemaining, ...context } =
      previous;
    current.log.push(`set-aside-exit-replacement:pending:${id}`);
    return {
      ...current,
      pendingSetAsideExitReplacementChoice: {
        ...context,
        cardInstanceId: id,
        replacement,
        ...(remaining.length > 0
          ? { remainingCardInstanceIds: remaining }
          : {}),
      },
    };
  }
  return current;
}

/**
 * 非フィールド (in_use / set_aside / hand 等) の `remove_from_game` 対象を
 * `removed_from_game` へ直接スタンプする (SSOT)。`executeRemoveFromGame` の通常経路と、
 * `resolveSetAsideExitReplacementChoice` (state-based-actions.ts) の置換辞退分岐の
 * 両方から呼ばれる。カード上にコアが残っていれば controller の reserve へ返す
 * (例: in_use のセルフ remove_from_game)。
 */
export function applyNonFieldRemoveFromGameStamp(
  state: GameState,
  cards: readonly CardInstance[]
): GameState {
  if (cards.length === 0) return state;
  const idsSet = new Set(cards.map((c) => c.instanceId));
  const reserveDeltaByPlayer = new Map<string, number>();
  const current = state;
  for (const card of cards) {
    current.log.push(
      `effect:remove_from_game:${card.instanceId}:from_zone:${card.zone}`
    );
    if (card.normalCoreCount > 0) {
      reserveDeltaByPlayer.set(
        card.controllerPlayerId,
        (reserveDeltaByPlayer.get(card.controllerPlayerId) ?? 0) +
          card.normalCoreCount
      );
    }
  }
  return replaceCardInstances(
    {
      ...current,
      players: current.players.map((p) => {
        const reserveDelta = reserveDeltaByPlayer.get(p.id) ?? 0;
        if (reserveDelta === 0) return p;
        return {
          ...p,
          reserveNormalCoreCount: p.reserveNormalCoreCount + reserveDelta,
        };
      }),
    },
    current.cardInstances.map((c) => {
      if (!idsSet.has(c.instanceId)) return c;
      const definitionId =
        c.definitionId !== c.originalDefinitionId
          ? c.originalDefinitionId
          : c.definitionId;
      return applyFaceDownPolicyOnZoneChange(
        {
          ...c,
          definitionId,
          zone: "removed_from_game" as const,
          normalCoreCount: 0,
          exhaustState: "recovered" as const,
          attachedToInstanceId: null,
          attachedChildrenIds: [],
          underCards: [],
        },
        "removed_from_game"
      );
    })
  );
}

type SetAsideExitReplacementMatch =
  | { kind: "move_to"; zone: "hand" }
  | { kind: "pay_cost"; amount: number };

/**
 * `card_instanceId` 上に「自分がこのカードを除外するとき、かわりに手札へ戻せる/コスト支払って
 * 残せる」型の `replace_field_exit` CE (`source:"self"`, `replacement.kind:"move_to"|"pay_cost"`)
 * があれば返す (ENGINE-set-aside-exit-replacement-choice、BSTH08.5-M11/X04 正源)。
 * `checkFieldExitReplacement` (state-based-actions.ts) と同じ CE metadata 形状を読むが、
 * `PendingLeaveEntity` を要求しない (`queuePendingLeave` は `zone==="field"` 専用のため、
 * 手元カードはそちらを経由できない)。
 */
function findSelfSetAsideExitReplacementMatch(
  state: GameState,
  instanceId: string
): SetAsideExitReplacementMatch | null {
  const ces = getCEsForTarget(state, instanceId);
  for (const ce of ces) {
    if (ce.modifierTag !== "replace_field_exit") continue;
    const meta = ce.metadata as
      | {
          source?: "opponent_effect" | "opponent" | "all" | "self";
          replacement?: {
            kind?: string;
            zone?: "hand" | "deck_bottom";
            amount?: number;
          };
        }
      | undefined;
    if (meta?.source !== "self") continue;
    if (meta.replacement?.kind === "move_to") {
      if (meta.replacement.zone !== "hand") continue;
      return { kind: "move_to", zone: "hand" };
    }
    if (meta.replacement?.kind === "pay_cost") {
      const amount = meta.replacement.amount;
      if (typeof amount !== "number" || amount <= 0) continue;
      return { kind: "pay_cost", amount };
    }
  }
  return null;
}

function buildProjectedRebirthStateForPostChoice(options: {
  state: GameState;
  card: CardInstance;
  sourceInstanceId: string;
  actingPlayerId: string;
  backDefId: string;
  backFaceZoneRoleName: CardInstance["zoneRoleName"];
  printedMinCoresRequired: number;
  retainCores: number;
  coresReturned: number;
  returnedCoresDest: "reserve" | "void";
  action: RebirthAction;
}): GameState {
  const wasLeaving =
    options.card.pendingLeaveKind !== null ||
    options.state.pendingLeaveEntities.some(
      (pl) => pl.instanceId === options.sourceInstanceId
    );
  return replaceCardInstances(
    {
      ...options.state,
      pendingLeaveEntities: wasLeaving
        ? options.state.pendingLeaveEntities.filter(
            (pl) => pl.instanceId !== options.sourceInstanceId
          )
        : options.state.pendingLeaveEntities,
      players: options.state.players.map((p) =>
        p.id === options.actingPlayerId
          ? (() => {
              const afterReturnedCores =
                options.returnedCoresDest === "void"
                  ? {
                      ...p,
                      voidNormalCoreCount:
                        p.voidNormalCoreCount + options.coresReturned,
                    }
                  : {
                      ...p,
                      reserveNormalCoreCount:
                        p.reserveNormalCoreCount + options.coresReturned,
                    };
              return applyRebirthCountBonus(afterReturnedCores, options.action);
            })()
          : p
      ),
    },
    options.state.cardInstances.map((c) =>
      c.instanceId === options.sourceInstanceId
        ? {
            ...c,
            definitionId: options.backDefId,
            zoneRoleName: options.backFaceZoneRoleName,
            normalCoreCount: options.retainCores,
            minimumRequiredCores: options.printedMinCoresRequired,
            ...(wasLeaving
              ? {
                  pendingLeaveKind: null,
                  pendingLeaveCause: null,
                  pendingLeaveChainId: null,
                  deferZoneMoveUntilChainEnd: false,
                }
              : {}),
          }
        : c
    )
  );
}

function maybeQueueRebirthPostChoice(options: {
  state: GameState;
  card: CardInstance;
  sourceInstanceId: string;
  actingPlayerId: string;
  action: RebirthAction;
  backDef: CardDefinition;
  backDefId: string;
  backFaceZoneRoleName: CardInstance["zoneRoleName"];
  printedMinCoresRequired: number;
  retainCores: number;
  retainedTotalCores: number;
  minCoresRequired: number;
  coresReturned: number;
  returnedCoresDest: "reserve" | "void";
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  rebirthTimingWindowId?: string;
  chainId: string;
}): { kind: "pending" | "blocked"; state: GameState } | { kind: "proceed" } {
  const postChoice =
    options.action.postRebirthChoice ??
    (options.action.separatesFromHost &&
    !options.action.deferRebirthCompletionUntilPostChoice
      ? { kind: "core_distribute" as const, minimum: "back_face_lv" as const }
      : undefined);
  if (!postChoice) return { kind: "proceed" };

  const completion = createPostChoiceRebirthCompletion({
    action: options.action,
    sourceInstanceId: options.sourceInstanceId,
    actingPlayerId: options.actingPlayerId,
    chainId: options.chainId,
    ...(options.rebirthTimingWindowId !== undefined
      ? { rebirthTimingWindowId: options.rebirthTimingWindowId }
      : {}),
  });
  const projectedState = buildProjectedRebirthStateForPostChoice(options);
  const buildCorePending = (params: {
    minTotal: number;
    maxTotal?: number;
    prefix: string;
    sourceScope?: "field_and_reserve" | "reserve_only";
  }) => {
    const pending = buildChargeCoresPendingCoreDistribution(
      options.state,
      options.actingPlayerId,
      options.sourceInstanceId,
      options.card.definitionId,
      options.getCardDefinitionById,
      params.prefix,
      {
        sourceScope: params.sourceScope ?? "field_and_reserve",
        minTotal: params.minTotal,
        candidateDefinitionId: options.backDefId,
      }
    );
    if (!pending) return null;
    return {
      ...pending,
      ...(params.minTotal > 0
        ? {
            minTotal: params.minTotal,
            rollbackIfBelowMinTotal: {
              minTotal: params.minTotal,
              reason: "rebirth_minimum_core" as const,
            },
          }
        : {}),
      ...(params.maxTotal !== undefined ? { maxTotal: params.maxTotal } : {}),
      rebirthCompletion: completion,
      priorStateSnapshot: options.state,
    };
  };

  if (postChoice.kind === "core_distribute") {
    const minimum =
      postChoice.minimum === "back_face_lv"
        ? Math.max(0, options.minCoresRequired - options.retainedTotalCores)
        : (postChoice.minimum ?? 0);
    const pending = buildCorePending({
      minTotal: minimum,
      prefix: "rebirth-post-core",
      ...(postChoice.sourceScope !== undefined
        ? { sourceScope: postChoice.sourceScope }
        : {}),
    });
    if (pending) {
      return {
        kind: "pending",
        state: {
          ...options.state,
          pendingCoreDistribution: pending,
          log: [
            ...options.state.log,
            `effect:rebirth:${options.sourceInstanceId}:post-choice-core-pending:${pending.pendingId}`,
          ],
        },
      };
    }
    if (minimum > 0) {
      return {
        kind: "blocked",
        state: {
          ...options.state,
          log: [
            ...options.state.log,
            `effect:rebirth:${options.sourceInstanceId}:post-choice-no-core:min=${minimum}`,
          ],
        },
      };
    }
    return { kind: "proceed" };
  }

  const hosts = getValidBraveCombineHosts(
    projectedState,
    options.backDef,
    options.actingPlayerId,
    options.getCardDefinitionById,
    options.sourceInstanceId
  );

  if (postChoice.kind === "brave_combine") {
    if (hosts.length === 0 && postChoice.optional !== true) {
      return {
        kind: "blocked",
        state: {
          ...options.state,
          log: [
            ...options.state.log,
            `effect:rebirth:${options.sourceInstanceId}:post-choice-no-combine-host`,
          ],
        },
      };
    }
    if (hosts.length === 0 && postChoice.optional === true) {
      return { kind: "proceed" };
    }
    const pendingId = nextRebirthPostChoicePendingId("rebirth-post-combine");
    return {
      kind: "pending",
      state: {
        ...options.state,
        pendingStoneFlipCombine: {
          pendingId,
          actingPlayerId: options.actingPlayerId,
          braveInstanceId: options.sourceInstanceId,
          braveDefinitionId: options.backDefId,
          hostCandidateInstanceIds: hosts.map((h) => h.instanceId),
          allowNoCombineChoice: postChoice.optional === true,
          rebirthCompletion: completion,
          priorStateSnapshot: options.state,
        },
        log: [
          ...options.state.log,
          `effect:rebirth:${options.sourceInstanceId}:post-choice-combine-pending:${pendingId}`,
        ],
      },
    };
  }

  const exactCoreCount = postChoice.coreCount;
  const corePending = buildCorePending({
    minTotal: exactCoreCount,
    maxTotal: exactCoreCount,
    prefix: "rebirth-post-combine-core",
    ...(postChoice.sourceScope !== undefined
      ? { sourceScope: postChoice.sourceScope }
      : {}),
  });
  if (hosts.length === 0 && !corePending) {
    return {
      kind: "blocked",
      state: {
        ...options.state,
        log: [
          ...options.state.log,
          `effect:rebirth:${options.sourceInstanceId}:post-choice-no-combine-or-core`,
        ],
      },
    };
  }
  const pendingId = nextRebirthPostChoicePendingId("rebirth-post-combine");
  return {
    kind: "pending",
    state: {
      ...options.state,
      pendingStoneFlipCombine: {
        pendingId,
        actingPlayerId: options.actingPlayerId,
        braveInstanceId: options.sourceInstanceId,
        braveDefinitionId: options.backDefId,
        hostCandidateInstanceIds: hosts.map((h) => h.instanceId),
        allowNoCombineChoice: false,
        ...(corePending
          ? {
              corePlacementChoice: {
                sourceScope: postChoice.sourceScope ?? "field_and_reserve",
                minTotal: exactCoreCount,
                maxTotal: exactCoreCount,
              },
            }
          : {}),
        rebirthCompletion: completion,
        priorStateSnapshot: options.state,
      },
      log: [
        ...options.state.log,
        `effect:rebirth:${options.sourceInstanceId}:post-choice-combine-or-core-pending:${pendingId}`,
      ],
    },
  };
}

export function executeRebirth(
  state: GameState,
  actingPlayerId: string,
  action: RebirthAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  chainId: string,
  rebirthTimingWindowId?: string
): GameState {
  const card = getCardById(state, sourceInstanceId);
  const asIfCombinedWithInstanceId = action.asIfCombinedWithInstanceId;
  // 疑似合体は転醒成立時だけ使い、失敗時は元の煌臨元関係を保つ。
  if (asIfCombinedWithInstanceId !== undefined) {
    const host = getCardById(state, asIfCombinedWithInstanceId);
    if (
      !host ||
      host.zone !== "field" ||
      !adventSourceIdsOf(host).includes(sourceInstanceId)
    ) {
      state.log.push(
        `effect:rebirth:${sourceInstanceId}:as-if-combined-host-missing`
      );
      return state;
    }
  }
  // 手札/手元/in_use にあるマジックカードの『転醒』(公式先例BS55-TCP07(A) +
  // BSFT01 鍵ブレイヴ)。通常の転醒（場のカードの flip）とは別に、フィールドへの
  // 新規配置を伴うため専用関数へ委譲する (ENGINE-magic-rebirth-from-hand)。
  if (
    card &&
    (card.zone === "hand" ||
      card.zone === "set_aside" ||
      card.zone === "in_use")
  ) {
    return executeMagicRebirthFromHand(
      state,
      actingPlayerId,
      action,
      sourceInstanceId,
      getCardDefinitionById,
      chainId,
      rebirthTimingWindowId
    );
  }
  if (!card || card.zone !== "field") {
    state.log.push(`effect:rebirth:${sourceInstanceId}:not-on-field`);
    return state;
  }

  const def = getCardDefinitionById(card.definitionId);
  if (!def || !def.isDoubleSided || !def.backFace) {
    state.log.push(`effect:rebirth:${sourceInstanceId}:no-back-face`);
    return state;
  }

  // カウント条件チェック（PlayerState.countValue を使用）。
  // 外部転醒（BSSA01-XX01 神技4「転醒条件を満たしたものとして発揮」）は forceTriggerCondition:true で
  // maxCount チェックを skip する（対象カードの転醒条件は満たされたものとして flip する）。
  if (!action.forceTriggerCondition) {
    const player = state.players.find((p) => p.id === actingPlayerId);
    const currentCount = player?.countValue ?? 0;
    if (currentCount > (action.maxCount ?? Number.POSITIVE_INFINITY)) {
      state.log.push(
        `effect:rebirth:${sourceInstanceId}:count-over:${currentCount}>${action.maxCount}`
      );
      return state;
    }
  }

  // 同一タイミング複数転醒不可: battle immediate / pending triggered の同時解決群では
  // rebirthTimingWindowId marker を使い、legal action boundary をまたいでも既転醒を保持する。
  // 直呼び（テスト等）や旧経路は actionStartLogIndex 以降の log 走査へ fallback する。
  if (hasRebirthResolvedInCurrentTimingWindow(state, rebirthTimingWindowId)) {
    state.log.push(`effect:rebirth:${sourceInstanceId}:blocked:same-timing`);
    return state;
  }

  // 裏面の definitionId を解決（backFace.cardNo がキー）
  const backDefId = def.backFace.cardNo ?? `${def.cardNo}_back`;
  const backDef =
    getCardDefinitionById(backDefId) ??
    synthesizeBackFaceDefinition(def, def.backFace);

  // Lv 検証: 転醒後の B 面最低 Lv コア数を確認
  const retainCores = action.retainCores ?? card.normalCoreCount;
  const retainedTotalCores = retainCores + (card.soulCoreCount ?? 0);
  const coresReturned = Math.max(0, card.normalCoreCount - retainCores);
  const printedMinCoresRequired = backDef
    ? getMinimumRequiredCoresFromDefinition(backDef)
    : 0;
  const backFaceZoneRoleName = backDef
    ? getDefaultZoneRoleName(backDef, "field")
    : card.zoneRoleName;
  const minCoresRequired = backDef
    ? getRebirthBackFaceMinimumRequiredCores(
        state,
        card,
        backDef,
        getCardDefinitionById
      )
    : 0;

  // 分離を伴う転醒も通常の分離と同様に、供給元と任意の配置数を選ぶ。
  // 既存の転醒後選択pendingを使い、Lv1以上の配置確定まで面・煌臨元・countを保留する。
  const workingState = state;

  const returnedCoresDest = action.returnedCoresDest ?? "reserve";
  const postChoiceResult = backDef
    ? maybeQueueRebirthPostChoice({
        state: workingState,
        card,
        sourceInstanceId,
        actingPlayerId,
        chainId,
        action,
        backDef,
        backDefId,
        backFaceZoneRoleName,
        printedMinCoresRequired,
        retainCores,
        retainedTotalCores,
        minCoresRequired,
        coresReturned,
        returnedCoresDest,
        getCardDefinitionById,
        ...(rebirthTimingWindowId !== undefined
          ? { rebirthTimingWindowId }
          : {}),
      })
    : { kind: "proceed" as const };
  if (postChoiceResult.kind !== "proceed") {
    return postChoiceResult.state;
  }

  const isCombinedWithoutSeparation =
    card.attachedToInstanceId !== null && !action.separatesFromHost;
  const hasLvDeficit = Boolean(
    backDef &&
    !isCombinedWithoutSeparation &&
    !action.skipBackFaceLvDeficitForPostChoice &&
    !action.allowPostRebirthCorePlacementForLvDeficit &&
    retainedTotalCores < minCoresRequired
  );
  const shouldDeferRebirthCompletion = Boolean(
    action.deferRebirthCompletionUntilPostChoice ||
    (backDef &&
      !isCombinedWithoutSeparation &&
      action.allowPostRebirthCorePlacementForLvDeficit &&
      retainedTotalCores < minCoresRequired)
  );
  if (hasLvDeficit && !action.vanishAfterFlipOnLvDeficit) {
    // 最低 Lv 未満 → 「自分の効果で消滅」扱い（カウント不増加で転醒中断）
    workingState.log.push(
      `effect:rebirth:${sourceInstanceId}:lv-deficit:retain=${retainedTotalCores}<min=${minCoresRequired}`
    );
    return queuePendingLeave({
      state: workingState,
      instanceId: sourceInstanceId,
      kind: "vanish",
      cause: "effect_resolution",
      chainId: `effect:rebirth:${sourceInstanceId}:lv-deficit`,
      causePlayerId: actingPlayerId,
      deferZoneMoveUntilChainEnd: false,
      causedByEffectSourceInstanceId: sourceInstanceId,
      resolvedSourceRegistrationKeys: [sourceInstanceId],
    });
  }

  // 転醒成功: カード裏返し + B面定型文に応じた count 処理。
  // 直後の「このとき」コア配置で最低 Lv を満たせる型は、配置確定まで count/転醒時を保留する。
  // 残さないコアの行き先は既定でリザーブ、創界石の転醒は "void"（カード本文の
  // 「置かれているコアすべて（/1個を残して）をボイドに置く」）。
  workingState.log.push(
    `effect:rebirth:${sourceInstanceId}:flip_to:${backDefId}:retain=${retainCores}:return=${coresReturned}:${returnedCoresDest}`
  );
  markRebirthResolvedInTimingWindow(workingState, rebirthTimingWindowId);
  // 転醒が「フィールドを離れるとき」トリガー（相手による離脱等）で発火した場合、
  // 対象は離脱待機状態 (pendingLeaveEntities) に入っている。転醒は離脱を置換して
  // フィールドに残す（08a:83 + 04:14「フィールドを離れるとき」効果は待機状態で参照され、
  // 残置（魂状態/転醒）はその置換選択）。stay_on_field と同じく pendingLeave* を解除し
  // pendingLeaveEntities から取り除く。
  const wasLeaving =
    card.pendingLeaveKind !== null ||
    workingState.pendingLeaveEntities.some(
      (pl) => pl.instanceId === sourceInstanceId
    );

  let newState: GameState = replaceCardInstances(
    {
      ...workingState,
      pendingLeaveEntities: wasLeaving
        ? workingState.pendingLeaveEntities.filter(
            (pl) => pl.instanceId !== sourceInstanceId
          )
        : workingState.pendingLeaveEntities,
      players: workingState.players.map((p) =>
        p.id === actingPlayerId
          ? (() => {
              const afterReturnedCores =
                returnedCoresDest === "void"
                  ? {
                      ...p,
                      voidNormalCoreCount:
                        p.voidNormalCoreCount + coresReturned,
                    }
                  : {
                      ...p,
                      reserveNormalCoreCount:
                        p.reserveNormalCoreCount + coresReturned,
                    };
              return shouldDeferRebirthCompletion
                ? afterReturnedCores
                : applyRebirthCountBonus(afterReturnedCores, action);
            })()
          : p
      ),
    },
    workingState.cardInstances.map((c) =>
      c.instanceId === sourceInstanceId
        ? {
            ...c,
            definitionId: backDefId,
            zoneRoleName: backFaceZoneRoleName,
            ...(action.separatesFromHost
              ? {
                  exhaustState: resolveSeparatedBraveExhaustState(
                    c,
                    backDef,
                    getCardById(
                      workingState,
                      asIfCombinedWithInstanceId ??
                        card.attachedToInstanceId ??
                        ""
                    )
                  ),
                }
              : {}),
            normalCoreCount: retainCores,
            minimumRequiredCores: printedMinCoresRequired,
            ...(wasLeaving
              ? {
                  pendingLeaveKind: null,
                  pendingLeaveCause: null,
                  pendingLeaveChainId: null,
                  deferZoneMoveUntilChainEnd: false,
                }
              : {}),
          }
        : c
    )
  );
  if (shouldDeferRebirthCompletion) {
    newState.log.push(
      `effect:rebirth:${sourceInstanceId}:completion-deferred:min=${minCoresRequired}:current=${retainedTotalCores}`
    );
  }
  if (wasLeaving) {
    newState.log.push(`effect:rebirth:${sourceInstanceId}:stay-on-field`);
  }

  // 08a §2「合体相手を煌臨元カードとして追加することで…裏返せる」型（BSSA01-転醒X02/X03）。
  // 転醒後カード (sourceInstanceId) の合体相手を attachAsAdventSource で sourceInstanceId の
  // 煌臨元へ畳む（SSOT）。合体相手の判定は転醒前の合体リンク（card）から行う:
  //   - 転醒カードがブレイヴ (X02): attachedToInstanceId = host を畳む。
  //   - 転醒カードが host (X03):   attachedChildrenIds の合体ブレイヴを畳む。
  // attachAsAdventSource が合体リンク解除・コア 0・表向き・A 面復帰までまとめて行う。
  if (action.foldCombinedPartnerToAdventSource) {
    const partnerIds: string[] = [];
    const foldedPartnerIds: string[] = [];
    if (asIfCombinedWithInstanceId !== undefined) {
      partnerIds.push(asIfCombinedWithInstanceId);
      newState = replaceCardInstances(
        {
          ...newState,
        },
        stripUnderCardReferences(
          newState.cardInstances,
          new Set([sourceInstanceId])
        )
      );
    } else if (card.attachedToInstanceId) {
      partnerIds.push(card.attachedToInstanceId);
    }
    for (const childId of card.attachedChildrenIds) {
      const child = getCardById(newState, childId);
      if (child) partnerIds.push(childId);
    }
    for (const partnerId of partnerIds) {
      const partner = getCardById(newState, partnerId);
      if (
        !partner ||
        partner.zone !== "field" ||
        partnerId === sourceInstanceId
      )
        continue;
      // 煌臨元化前にコアを退避し、元のアンダーカードを新しいhostへ引き継ぐ。
      newState = resolveCardLeavesFieldCores(
        newState,
        partnerId,
        null,
        getCardDefinitionById
      );
      const folded = attachAsAdventSource(
        newState,
        partnerId,
        sourceInstanceId
      );
      if (folded) {
        newState = folded;
        newState.log.push(
          `effect:rebirth:${sourceInstanceId}:fold-advent-source:${partnerId}`
        );
        foldedPartnerIds.push(partnerId);
        // partner 自身が離脱待機中だったケース（BSSA01-転醒X02(A): host が離脱待機、
        // brave 側が flip する逆パターン）。attachAsAdventSource は card.pendingLeaveKind
        // 等の instance フィールドは解除するが、state.pendingLeaveEntities 配列からの
        // 除去は行わないため、resolveAdventSourceReplacement (state-based-actions.ts) と
        // 同じ後処理をここでも行う（SSOT: 離脱待機を煌臨元へ置換したら stale entry を残さない）。
        newState = {
          ...newState,
          pendingLeaveEntities: newState.pendingLeaveEntities.filter(
            (pl) => pl.instanceId !== partnerId
          ),
          pendingBurstChecks: newState.pendingBurstChecks.filter(
            (bc) =>
              (bc as { relatedInstanceId?: string }).relatedInstanceId ===
                undefined ||
              (bc as { relatedInstanceId?: string }).relatedInstanceId !==
                partnerId
          ),
        };
      }
    }
    // 転醒後カード側に残る合体リンクを解除（partner は attachAsAdventSource 内で解除済み）。
    newState = replaceCardInstances(
      {
        ...newState,
      },
      newState.cardInstances.map((c) =>
        c.instanceId === sourceInstanceId
          ? { ...c, attachedToInstanceId: null, attachedChildrenIds: [] }
          : c
      )
    );
    newState = normalizeBattleEntitiesAfterFoldedAdventSources(
      newState,
      sourceInstanceId,
      foldedPartnerIds,
      getCardDefinitionById
    );
  }

  // アタック中転醒: バトルエンティティの BP・シンボルを B 面で再計算
  if (newState.battleEntities.length > 0 && backDef) {
    const entity = newState.battleEntities.find((e) =>
      e.memberInstanceIds.includes(sourceInstanceId)
    );
    if (entity) {
      newState = recomputeBattleEntityBp(newState, getCardDefinitionById);
      newState.log.push(
        `effect:rebirth:${sourceInstanceId}:battle-entity-updated`
      );
    }
  }

  if (hasLvDeficit && action.vanishAfterFlipOnLvDeficit) {
    newState.log.push(
      `effect:rebirth:${sourceInstanceId}:lv-deficit:retain=${retainedTotalCores}<min=${minCoresRequired}`
    );
    return queuePendingLeave({
      state: newState,
      instanceId: sourceInstanceId,
      kind: "vanish",
      cause: "effect_resolution",
      chainId: `effect:rebirth:${sourceInstanceId}:lv-deficit`,
      causePlayerId: actingPlayerId,
      deferZoneMoveUntilChainEnd: false,
      causedByEffectSourceInstanceId: sourceInstanceId,
      resolvedSourceRegistrationKeys: [sourceInstanceId],
    });
  }

  return newState;
}

/**
 * アタック宣言の代替宣言 (BSDB01-TX01(A) 型、CardDefinition.attackAlternativeFlip) 用の
 * 面反転。executeRebirth の面反転コア (definitionId/zoneRoleName/minimumRequiredCores
 * 更新 + Lv不足時消滅) だけを、転醒特有のカウント+1・煌臨元畳み込み・pendingLeave置換・
 * バトル中BP再計算を伴わない形で切り出す。呼び出し時点でこのカードは必ずアタック宣言可能
 * 窓 (フィールド上・pendingLeave無し・バトル外) にあるため、それらの分岐は不要
 * (executeRebirth は誘発/離脱応答/バトル中転醒など executeRebirth 固有の呼び出し文脈を
 * 幅広くカバーする必要があるが、この代替宣言はアタック宣言 legality と同一ゲートを
 * legal-actions-availability 側で既に通しているため対象外)。
 * カウント増加はカード本文が明記する量 (CardDefinition.attackAlternativeFlip.countIncreaseAmount)
 * のみを呼び出し側 (legal-actions-apply.ts の flip_instead_of_attack ハンドラ) で
 * count_increase として別途実行する。呼び出し側が Lv不足消滅時にカウント増加を
 * スキップできるよう、`flipped` (実際に裏返ったか) を結果に含める
 * (executeRebirth のカウント+1 が lv-deficit 早期 return では実行されないのと同じ扱い)。
 */
export function flipCardFaceWithoutRebirthCountBonus(
  state: GameState,
  actingPlayerId: string,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): { state: GameState; flipped: boolean } {
  const card = getCardById(state, sourceInstanceId);
  if (!card || card.zone !== "field") {
    state.log.push(
      `effect:flip_instead_of_attack:${sourceInstanceId}:not-on-field`
    );
    return { state, flipped: false };
  }

  const def = getCardDefinitionById(card.definitionId);
  if (!def || !def.isDoubleSided || !def.backFace) {
    state.log.push(
      `effect:flip_instead_of_attack:${sourceInstanceId}:no-back-face`
    );
    return { state, flipped: false };
  }

  const backDefId = def.backFace.cardNo ?? `${def.cardNo}_back`;
  const backDef =
    getCardDefinitionById(backDefId) ??
    synthesizeBackFaceDefinition(def, def.backFace);
  const retainCores = card.normalCoreCount;
  const retainedTotalCores = retainCores + (card.soulCoreCount ?? 0);
  const printedMinCoresRequired = backDef
    ? getMinimumRequiredCoresFromDefinition(backDef)
    : 0;
  const backFaceZoneRoleName = backDef
    ? getDefaultZoneRoleName(backDef, "field")
    : card.zoneRoleName;
  const minCoresRequired = backDef
    ? getRebirthBackFaceMinimumRequiredCores(
        state,
        card,
        backDef,
        getCardDefinitionById
      )
    : 0;

  if (backDef && retainedTotalCores < minCoresRequired) {
    state.log.push(
      `effect:flip_instead_of_attack:${sourceInstanceId}:lv-deficit:retain=${retainedTotalCores}<min=${minCoresRequired}`
    );
    return {
      state: queuePendingLeave({
        state,
        instanceId: sourceInstanceId,
        kind: "vanish",
        cause: "effect_resolution",
        chainId: `effect:flip_instead_of_attack:${sourceInstanceId}:lv-deficit`,
        causePlayerId: actingPlayerId,
        deferZoneMoveUntilChainEnd: false,
        causedByEffectSourceInstanceId: sourceInstanceId,
      }),
      flipped: false,
    };
  }

  state.log.push(
    `effect:flip_instead_of_attack:${sourceInstanceId}:flip_to:${backDefId}`
  );
  const flippedState: GameState = replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) =>
      c.instanceId === sourceInstanceId
        ? {
            ...c,
            definitionId: backDefId,
            zoneRoleName: backFaceZoneRoleName,
            minimumRequiredCores: printedMinCoresRequired,
          }
        : c
    )
  );

  return {
    // 面反転直後に B 面の continuous 効果を登録する。次の action 境界まで待つと、
    // B 面の常時ルール（例: 攻撃不可・通常コア移動不可）が未登録の中間 state を
    // 生成し、invariant と実際の legality の両方を壊す。
    state: recomputeAndRebuildContinuousEffectsForSources(
      flippedState,
      getCardDefinitionById,
      [sourceInstanceId]
    ),
    flipped: true,
  };
}

/**
 * flip_instead_of_attack (BSDB01-TX01(A) 型) の宣言スタック窓クローズ後の deferred 解決。
 * 「アタック/ブロック宣言」は 02:190 の4カテゴリの1つで、apply ハンドラ自身が
 * preDeclarationStackWindow を開く分類 (legal-action-window-classification.ts
 * "opens_own_window"、declare_manifest と同型)。窓が閉じた後にここで実際の
 * 疲労 (通常のアタック宣言確定 confirmAttackDeclarationAsAction と同様、推論。
 * needs-ruling.jsonl:BSDB01-TX01(A) 参照) + 面反転 + カウント増加を行う。
 */
export function resolveDeferredFlipInsteadOfAttackStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  if (resolvedStack.isNullified) return state;

  const sourceInstanceId = resolvedStack.cardInstanceId;
  const actingPlayerId = resolvedStack.actingPlayerId;
  const def = options.getCardDefinitionById(resolvedStack.cardDefinitionId);
  if (!def?.attackAlternativeFlip) {
    return {
      ...state,
      log: [
        ...state.log,
        `[FlipInsteadOfAttack] 宣言データ不整合のため不発: ${sourceInstanceId}`,
      ],
    };
  }

  // 宣言スタック窓の間に legality が崩れていないか再検証する (confirmAttackDeclarationAsAction
  // の attackReasonAfterStack / legality-changed 再チェックと同型、battle-actions.ts:753-769)。
  // このガードが無いと、窓の間に相手が prevent_attack CE を付与する/このカードを疲労させる等
  // しても無条件で成立してしまう (adversarial verifier 指摘)。attack と異なり対象・コスト源選択を
  // 伴わないため、attackExhaustCostGateCEs/battleDestroyCostGateCEs のバイパスは不要。
  const attackReasonAfterStack = getAttackDeclarationBlockReason({
    state,
    actingPlayerId,
    sourceInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
  });
  if (attackReasonAfterStack !== null) {
    return {
      ...state,
      log: [
        ...state.log,
        `flip_instead_of_attack:cancelled:${sourceInstanceId}:legality-changed:${attackReasonAfterStack}`,
      ],
    };
  }

  const beforeState = state;

  // 裁定確定 (2026-08-01、ユーザー確認): 疲労しないし、バトルも発生しない
  // (アタック宣言そのものではなく「裏返せる」という任意効果の発揮に過ぎない)。
  // アタックできる状態でなければ発揮できない、という前提ゲートは
  // getAvailableFlipInsteadOfAttackLegalActions/getAttackDeclarationBlockReason
  // 側で既に担保済み（このスピリット自身は疲労も戦闘もしない）。
  const { state: stateAfterFlip, flipped } =
    flipCardFaceWithoutRebirthCountBonus(
      state,
      actingPlayerId,
      sourceInstanceId,
      options.getCardDefinitionById
    );

  // Lv不足で消滅した場合はカード本文のカウント増加も発生しない
  // (executeRebirth の lv-deficit 早期 return でカウント+1 が起きないのと同型)。
  const afterCount = flipped
    ? executeCountIncrease(
        stateAfterFlip,
        actingPlayerId,
        "self",
        def.attackAlternativeFlip.countIncreaseAmount
      )
    : stateAfterFlip;

  return collectAndQueueTriggerReactions({
    beforeState,
    afterState: afterCount,
    source: "action_resolution",
    chainId: resolvedStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: actingPlayerId,
    causedBySourceInstanceId: sourceInstanceId,
  });
}

function getRebirthBackFaceMinimumRequiredCores(
  state: GameState,
  card: CardInstance,
  backDef: CardDefinition,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): number {
  const printedMinCoresRequired =
    getMinimumRequiredCoresFromDefinition(backDef);
  const projectedCard: CardInstance = {
    ...card,
    zone: "field",
    zoneRoleName: getDefaultZoneRoleName(backDef, "field"),
    definitionId: backDef.cardNo,
    minimumRequiredCores: printedMinCoresRequired,
  };
  return Math.max(
    0,
    printedMinCoresRequired +
      getEffectiveLevelCostDelta(
        state,
        projectedCard,
        backDef,
        getCardDefinitionById
      )
  );
}

/**
 * 手札/手元/in_use にあるマジックカードの『転醒』(公式先例BS55-TCP07(A)氷刃血解、
 * ENGINE-magic-rebirth-from-hand)。
 * executeRebirth（場のカードの flip）とは異なり、フィールドに存在しないカードを backFace
 * 定義で新規にフィールドへ配置する。召喚パイプライン（executeSummonSelf）とはコスト計算・
 * summon-condition 判定を持たない点で異なるため独立関数とする（転醒コストは declarative
 * pay_cost で解決側が既に支払い済み・召喚コストは無視）。
 * hand/set_aside から直接フィールドへ置くプリミティブ呼び出しでは executeSummonSelf の
 * フォールバック（プレイヤー入力なし）経路と同じく最低Lv分を reserve から自動供給する。
 * in_use からの実使用解決では、印字の「このとき」コア配置 step/HUD に任せる。
 */
export function executeMagicRebirthFromHand(
  state: GameState,
  actingPlayerId: string,
  action: RebirthAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined,
  chainId: string,
  rebirthTimingWindowId?: string
): GameState {
  const card = getCardById(state, sourceInstanceId);
  if (!card) {
    state.log.push(`effect:rebirth:${sourceInstanceId}:not-found`);
    return state;
  }

  const def = getCardDefinitionById(card.definitionId);
  if (!def || !def.isDoubleSided || !def.backFace) {
    state.log.push(`effect:rebirth:${sourceInstanceId}:no-back-face`);
    return state;
  }

  if (!action.forceTriggerCondition) {
    const player = state.players.find((p) => p.id === actingPlayerId);
    const currentCount = player?.countValue ?? 0;
    if (currentCount > (action.maxCount ?? Number.POSITIVE_INFINITY)) {
      state.log.push(
        `effect:rebirth:${sourceInstanceId}:count-over:${currentCount}>${action.maxCount}`
      );
      return state;
    }
  }

  if (hasRebirthResolvedInCurrentTimingWindow(state, rebirthTimingWindowId)) {
    state.log.push(`effect:rebirth:${sourceInstanceId}:blocked:same-timing`);
    return state;
  }

  const backDefId = def.backFace.cardNo ?? `${def.cardNo}_back`;
  const backDef =
    getCardDefinitionById(backDefId) ??
    synthesizeBackFaceDefinition(def, def.backFace);

  const printedMinCoresRequired =
    getMinimumRequiredCoresFromDefinition(backDef);
  const minCoresRequired = getRebirthBackFaceMinimumRequiredCores(
    state,
    card,
    backDef,
    getCardDefinitionById
  );

  const player = state.players.find((p) => p.id === actingPlayerId);
  if (!player) {
    state.log.push(`effect:rebirth:${sourceInstanceId}:no-player`);
    return state;
  }

  const prevZone = card.zone;
  const workingState = state;

  if (
    prevZone !== "in_use" &&
    action.postRebirthChoice === undefined &&
    !action.deferRebirthCompletionUntilPostChoice
  ) {
    return executeMagicRebirthFromHand(
      state,
      actingPlayerId,
      {
        ...action,
        postRebirthChoice: {
          kind: "core_distribute",
          minimum: "back_face_lv",
          sourceScope: "field_and_reserve",
        },
      },
      sourceInstanceId,
      getCardDefinitionById,
      chainId,
      rebirthTimingWindowId
    );
  }

  if (action.postRebirthChoice?.kind === "core_distribute") {
    const existingTotalCores = getTotalCoresOnCardById(
      workingState,
      sourceInstanceId
    );
    const minimum =
      action.postRebirthChoice.minimum === "back_face_lv"
        ? Math.max(0, minCoresRequired - existingTotalCores)
        : (action.postRebirthChoice.minimum ?? 0);
    const pending = buildChargeCoresPendingCoreDistribution(
      workingState,
      actingPlayerId,
      sourceInstanceId,
      def.cardNo,
      getCardDefinitionById,
      "rebirth-post-core",
      {
        sourceScope:
          action.postRebirthChoice.sourceScope ?? "field_and_reserve",
        minTotal: minimum,
        candidateDefinitionId: backDefId,
      }
    );
    if (pending) {
      const completion = createPostChoiceRebirthCompletion({
        action,
        sourceInstanceId,
        actingPlayerId,
        chainId,
        ...(rebirthTimingWindowId !== undefined
          ? { rebirthTimingWindowId }
          : {}),
      });
      return {
        ...workingState,
        pendingCoreDistribution: {
          ...pending,
          ...(minimum > 0
            ? {
                minTotal: minimum,
                rollbackIfBelowMinTotal: {
                  minTotal: minimum,
                  reason: "rebirth_minimum_core" as const,
                },
              }
            : {}),
          rebirthCompletion: completion,
          priorStateSnapshot: workingState,
        },
        log: [
          ...workingState.log,
          `effect:rebirth:${sourceInstanceId}:post-choice-core-pending:${pending.pendingId}`,
        ],
      };
    }
    if (minimum > 0) {
      return {
        ...workingState,
        log: [
          ...workingState.log,
          `effect:rebirth:${sourceInstanceId}:post-choice-no-core:min=${minimum}`,
        ],
      };
    }
  }

  if (prevZone === "in_use" && action.separatesFromHost) {
    const existingCores = getTotalCoresOnCardById(
      workingState,
      sourceInstanceId
    );
    const needed = Math.max(0, minCoresRequired - existingCores);
    if (needed > 0) {
      const pendingCorePlacement = buildChargeCoresPendingCoreDistribution(
        workingState,
        actingPlayerId,
        sourceInstanceId,
        backDefId,
        getCardDefinitionById,
        "rebirth-precheck",
        { sourceScope: "field_and_reserve", minTotal: needed }
      );
      if (!pendingCorePlacement) {
        workingState.log.push(
          `effect:rebirth:${sourceInstanceId}:lv-deficit:retain=${existingCores}<min=${minCoresRequired}`
        );
        return workingState;
      }
    }
  }

  const cardAfterTopUp = getCardById(workingState, sourceInstanceId) ?? card;
  const existingCores = cardAfterTopUp.normalCoreCount;
  const coresForField = 0;
  const existingTotalCores = getTotalCoresOnCardById(
    workingState,
    sourceInstanceId
  );
  const shouldDeferRebirthCompletion = Boolean(
    action.deferRebirthCompletionUntilPostChoice ||
    (prevZone === "in_use" &&
      action.allowPostRebirthCorePlacementForLvDeficit &&
      existingTotalCores + coresForField < minCoresRequired)
  );
  const zoneRoleName = getDefaultZoneRoleName(backDef, "field");

  workingState.log.push(
    `effect:rebirth:${sourceInstanceId}:flip_to:${backDefId}:from=${prevZone}:cores=${coresForField}`
  );
  markRebirthResolvedInTimingWindow(workingState, rebirthTimingWindowId);

  const newState: GameState = replaceCardInstances(
    {
      ...workingState,
      players: workingState.players.map((p) =>
        p.id === actingPlayerId
          ? (() => {
              const afterZoneCounts = {
                ...p,
              };
              return shouldDeferRebirthCompletion
                ? afterZoneCounts
                : applyRebirthCountBonus(afterZoneCounts, action);
            })()
          : p
      ),
    },
    workingState.cardInstances.map((c) =>
      c.instanceId === sourceInstanceId
        ? {
            ...c,
            zone: "field" as const,
            zoneRoleName,
            definitionId: backDefId,
            normalCoreCount: existingCores,
            minimumRequiredCores: printedMinCoresRequired,
            exhaustState: "recovered" as const,
          }
        : c
    )
  );
  if (shouldDeferRebirthCompletion) {
    newState.log.push(
      `effect:rebirth:${sourceInstanceId}:completion-deferred:min=${minCoresRequired}:current=${existingTotalCores + coresForField}`
    );
  }

  return newState;
}

/**
 * 逆転醒（B面→A面）。issues/P3-98、10_rules/08a §逆転醒。
 *
 * mode:"flip"（パターン1）= 面反転のみ。表面 def は instance.originalDefinitionId（印字=A面 cardNo）
 * から逆引きする（A→B flip の executeRebirth は originalDefinitionId を保持するため逆引き index 不要）。
 * コア・疲労/回復・期間指定効果・instanceId は完全引継。**countValue は変動しない**（裁定 2026-06-14）。
 * アタック中なら battle entity の BP/シンボルを A 面で再計算する（executeRebirth と対称）。
 *
 * mode:"summon"（パターン2: 裏返して配置/召喚）は summon パイプラインを再利用する。支払い元と
 * 維持コア配置は pending カスケードで選択し、`resolve_reverse_rebirth_summon` で確定する。
 * `withoutCost` は支払いだけを 0 にし、instance の作り直しと維持コア配置は通常どおり行う。
 */
export function executeReverseRebirth(
  state: GameState,
  actingPlayerId: string,
  action: ReverseRebirthAction,
  sourceInstanceId: string,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const card = getCardById(state, sourceInstanceId);
  if (!card || card.zone !== "field") {
    state.log.push(`effect:reverse_rebirth:${sourceInstanceId}:not-on-field`);
    return state;
  }

  if (action.mode === "summon") {
    // パターン2: 裏返して「配置/召喚」する（08a §逆転醒）。通常召喚/配置と同処理で、
    // instance を新規エンティティとして再評価する（フィールド上のコア→リザーブ→コスト支払い
    // →維持コア再配置・疲労リセット）。count は不変（裁定 2026-06-14）。
    //
    // 【P3-98 §3】支払いソース + 維持コア配置はプレイヤー選択（既存 summon HUD 流用）。誘発で
    // 宣言モーメントが無いため、pendingReverseRebirthSummon を立てて中断し、resolve アクション
    // （resolve_reverse_rebirth_summon）で支払い/配置を受ける。軽減は自身シンボル不可
    // （自身を供給側から除外）。card_event:summon 誘発発火は後続スライス。
    const frontDefId = card.originalDefinitionId;
    if (card.definitionId === frontDefId) {
      state.log.push(
        `effect:reverse_rebirth:${sourceInstanceId}:already-front:${frontDefId}`
      );
      return state;
    }
    const frontDef = getCardDefinitionById(frontDefId);
    if (!frontDef) {
      state.log.push(
        `effect:reverse_rebirth:${sourceInstanceId}:no-front-def:${frontDefId}`
      );
      return state;
    }

    const player = state.players.find((p) => p.id === actingPlayerId);
    if (!player) return state;

    // コスト計算: withoutCost なら 0、それ以外は軽減後コスト（自身シンボルは軽減不可＝自身除外）。
    const costToPay = action.withoutCost
      ? 0
      : calculateReduction({
          state,
          actingPlayerId,
          card: frontDef,
          getCardDefinitionById,
          sourceInstanceId,
          excludeFieldInstanceIds: [sourceInstanceId],
        }).finalCost;

    const minCores =
      frontDef.levelDefs.length > 0
        ? Math.min(...frontDef.levelDefs.map((ld) => ld.requiredCores))
        : 0;
    // 実行可能性（リザーブ + 自身コア + 他フィールドコアで cost + 維持コアを賄えるか）。
    // 詳細なソース選択と配置検証は resolve アクション側の既存支払い/配置 helper に委ねる。
    const returnedState = reverseRebirthSummonSourceReturnedState(state, {
      sourceInstanceId,
      actingPlayerId,
    });
    const totalAvailable = getAvailableCardCostPaymentSources({
      state: returnedState,
      actingPlayerId,
      card: frontDef,
      sourceInstanceId,
      getCardDefinitionById,
      excludeFieldInstanceIds: [sourceInstanceId],
    }).totalAvailableCoreAmount;
    if (totalAvailable < costToPay + minCores) {
      state.log.push(
        `effect:reverse_rebirth:${sourceInstanceId}:summon-core-deficit:available=${totalAvailable}<need=${costToPay + minCores}`
      );
      return state;
    }

    // pending を立てて中断（支払いソース + 維持コア配置は resolve アクションで選択）。
    state.log.push(
      `effect:reverse_rebirth:${sourceInstanceId}:summon-pending:to=${frontDefId}:withoutCost=${!!action.withoutCost}:cost=${costToPay}:cores=${minCores}`
    );
    return {
      ...state,
      pendingReverseRebirthSummon: {
        pendingId: `rr-${sourceInstanceId}-${state.log.length}`,
        actingPlayerId,
        sourceInstanceId,
        frontDefinitionId: frontDefId,
        costToPay,
        minimumCoreCount: minCores,
        remainingStacks: [],
      },
    };
  }

  // パターン1（flip）: 現在 B 面（definitionId !== originalDefinitionId）であることが前提。
  const frontDefId = card.originalDefinitionId;
  if (card.definitionId === frontDefId) {
    state.log.push(
      `effect:reverse_rebirth:${sourceInstanceId}:already-front:${frontDefId}`
    );
    return state;
  }
  const frontDef = getCardDefinitionById(frontDefId);
  if (!frontDef) {
    state.log.push(
      `effect:reverse_rebirth:${sourceInstanceId}:no-front-def:${frontDefId}`
    );
    return state;
  }

  // 面反転のみ（コア・疲労・instanceId・期間効果・count はすべて保持）。
  state.log.push(
    `effect:reverse_rebirth:${sourceInstanceId}:flip_to:${frontDefId}`
  );
  let newState: GameState = replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((c) =>
      c.instanceId === sourceInstanceId ? { ...c, definitionId: frontDefId } : c
    )
  );

  // アタック中逆転醒: バトルエンティティの BP・シンボルを A 面で再計算（executeRebirth と対称）。
  if (newState.battleEntities.length > 0) {
    const entity = newState.battleEntities.find((e) =>
      e.memberInstanceIds.includes(sourceInstanceId)
    );
    if (entity) {
      newState = recomputeBattleEntityBp(newState, getCardDefinitionById);
      newState.log.push(
        `effect:reverse_rebirth:${sourceInstanceId}:battle-entity-updated`
      );
    }
  }

  return newState;
}
