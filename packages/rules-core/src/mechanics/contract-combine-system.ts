import { recordSemanticTriggerEvent } from "../effect/semantic-trigger-events";
/**
 * 契約合体（フラッシュ【契約合体：<条件>】、P3-111 S2/S4 自己完結型/プロキシ起動）。
 * 発動元は手札（召喚コストは支払わない）。起動コストは自分のソウルコアをトラッシュに
 * 置くこと（プロキシ起動は免除）。
 *
 * P3-112: 起動コスト（ソウルコアをトラッシュに置く）は使用コストでなく効果文内のため、
 * 発揮宣言でスタック窓を開き、コスト支払い・場入り解決とも窓クローズ後の deferred 解決で
 * 行う（divine_skill と同型、08c:196 一般化）。
 */
import type {
  ActiveStack,
  CardDefinition,
  CardInstance,
  GameState,
  PendingAsIfSoulCoreChoiceOption,
} from "../model";
import { getCardById, isPlayersContractCard } from "../card/card-lookup";
import { matchesCardName } from "../card/card-filter";
import { moveCardZone, updateCard, updatePlayer } from "../core/core-system";
import { recomputeAndRebuildContinuousEffects } from "../effect/continuous-effect-rebuild";
import { collectAndQueueTriggerReactions } from "../effect/trigger-system";
import { queuePendingLeave } from "../state-based-actions";
import { queuePreFlushGrantedEffectsAndFlushPendingLeaves } from "../zone/pending-leave-flush";
import {
  consumeSoulCore,
  hasSoulCoreAvailable,
  isExcludedByHostExclusiveLock,
} from "./advent-system";
import { hasCannotCombineRestriction } from "./act-as-spirit";
import {
  canUseEffectByUsageLimit,
  getEffectiveCardName,
  matchesBraveConditionForCard,
  recordEffectUsageIfLimited,
} from "../legal/legal-actions-shared";
import { buildChargeCoresPendingCoreDistribution } from "./core-charge-distribution";
import type { DeferredStackResolverOptions } from "../legal/stack-resolution-types";
import type { CardNameMatch } from "../dsl-types";
import { evaluateCondition } from "../effect/structured-condition-eval";

export function getContractCombineCandidateTargets({
  state,
  actingPlayerId,
  braveCard,
  braveDefinition,
  getCardDefinitionById,
  proxyTargetCardNames,
}: {
  state: GameState;
  actingPlayerId: string;
  braveCard: CardInstance;
  braveDefinition: CardDefinition;
  getCardDefinitionById: (id: string) => CardDefinition | undefined;
  proxyTargetCardNames?: readonly CardNameMatch[];
}): CardInstance[] {
  const data = braveDefinition.contractCombineData;
  if (!data) return [];
  if (braveCard.zone !== "hand") return [];
  if (braveCard.controllerPlayerId !== actingPlayerId) return [];

  const actingPlayer = state.players.find((p) => p.id === actingPlayerId);
  const soulStateIds = new Set(actingPlayer?.soulStateInstanceIds ?? []);

  return state.cardInstances.filter((target) => {
    if (target.zone !== "field") return false;
    if (target.controllerPlayerId !== actingPlayerId) return false;
    if (target.pendingLeaveKind !== null) return false;

    const isNormalFieldHost =
      (target.zoneRoleName === "spirit" ||
        target.zoneRoleName === "ultimate") &&
      !soulStateIds.has(target.instanceId);
    const isSoulStateContractHost =
      soulStateIds.has(target.instanceId) &&
      isPlayersContractCard(target, actingPlayer?.contractCardNo);
    if (!isNormalFieldHost && !isSoulStateContractHost) return false;

    const targetDefinition = getCardDefinitionById(target.definitionId);
    if (!targetDefinition) return false;

    if (proxyTargetCardNames && proxyTargetCardNames.length > 0) {
      const effectiveName = getEffectiveCardName(
        state,
        target,
        targetDefinition,
        getCardDefinitionById
      );
      if (!matchesCardName(effectiveName, [...proxyTargetCardNames])) {
        return false;
      }
    }

    if (
      hasCannotCombineRestriction(state, target.instanceId, targetDefinition)
    ) {
      return false;
    }

    if (
      isExcludedByHostExclusiveLock(
        state,
        target,
        braveDefinition,
        getCardDefinitionById
      )
    ) {
      return false;
    }

    return matchesBraveConditionForCard({
      condition: data.braveCondition,
      state,
      card: target,
      definition: targetDefinition,
      getCardDefinitionById,
      categoryEvaluation: "brave_host",
    });
  });
}

export function getContractCombineAsIfSoulCoreChoiceOptions(
  state: GameState,
  stack: ActiveStack,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): PendingAsIfSoulCoreChoiceOption[] {
  if (stack.actionKind !== "contract_combine") return [];
  const braveCard = getCardById(state, stack.cardInstanceId);
  const braveDefinition = getCardDefinitionById(stack.cardDefinitionId);
  if (!braveCard || !braveDefinition?.contractCombineData) return [];
  if (
    braveCard.zone !== "hand" ||
    braveCard.controllerPlayerId !== stack.actingPlayerId
  ) {
    return [];
  }

  const options: PendingAsIfSoulCoreChoiceOption[] = [];
  if (hasSoulCoreAvailable(state, stack.actingPlayerId)) {
    options.push({
      choiceId: "normal",
      label: "ソウルコアを置いて契約合体",
      costWaived: false,
    });
  }

  for (const proxySource of state.cardInstances) {
    if (proxySource.zone !== "field") continue;
    if (proxySource.controllerPlayerId !== stack.actingPlayerId) continue;
    if (proxySource.faceDown) continue;

    const proxyDefinition = getCardDefinitionById(proxySource.definitionId);
    const proxyData = proxyDefinition?.contractCombineProxyData;
    if (!proxyData) continue;
    if (
      !evaluateCondition(
        state,
        [{ kind: "min_level", value: proxyData.requiredLevel }],
        proxySource.instanceId,
        stack.actingPlayerId,
        getCardDefinitionById
      )
    ) {
      continue;
    }
    if (
      !canUseEffectByUsageLimit({
        state,
        sourceInstanceId: proxySource.instanceId,
        sourceDefinitionId: proxySource.definitionId,
        getCardDefinitionById,
        effectLabel: "contract_combine_proxy",
        usageLimit: { kind: "per_card_name", duration: "turn" },
      })
    ) {
      continue;
    }

    options.push({
      choiceId: `proxy:${proxySource.instanceId}`,
      label: "置いたものとして契約合体",
      costWaived: true,
      proxySourceInstanceId: proxySource.instanceId,
      proxySourceDefinitionId: proxySource.definitionId,
      proxySourceCardNo: proxyDefinition.cardNo,
      ...(proxyData.targetCardNames !== undefined
        ? { proxyTargetCardNames: proxyData.targetCardNames }
        : {}),
    });
  }

  return options;
}

/**
 * 契約合体の deferred 解決（発揮宣言→スタック窓クローズ後）。
 * ソウルコアをトラッシュへ支払い（プロキシは免除）、旧ブレイヴを破棄してから
 * 手札のブレイヴを合体状態でフィールドへ出す。
 */
export function resolveDeferredContractCombineStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  // 無効化された場合は効果・コストともスキップ（起動コストは効果文内のため）。
  if (resolvedStack.isNullified) return state;

  const braveId = resolvedStack.cardInstanceId;
  const targetId = resolvedStack.targetInstanceIds[0];
  const actingPlayerId = resolvedStack.actingPlayerId;
  const costWaived = resolvedStack.contractCombineCostWaived === true;
  const proxySourceInstanceId =
    resolvedStack.contractCombineProxySourceInstanceId;
  // 常時の許可元は支払い方法だけを提供し、契約合体効果の発揮元は手札のブレイヴ。
  const causalSourceInstanceId = braveId;

  const braveCard = getCardById(state, braveId);
  const targetCard = targetId ? getCardById(state, targetId) : undefined;

  const braveStillValid =
    braveCard !== undefined &&
    braveCard.zone === "hand" &&
    braveCard.controllerPlayerId === actingPlayerId;
  const targetDef = targetCard
    ? options.getCardDefinitionById(targetCard.definitionId)
    : undefined;
  const targetStillValid =
    targetCard !== undefined &&
    targetCard.zone === "field" &&
    targetCard.controllerPlayerId === actingPlayerId &&
    targetCard.pendingLeaveKind === null &&
    !hasCannotCombineRestriction(state, targetCard.instanceId, targetDef);
  const soulCoreStillAvailable =
    costWaived || hasSoulCoreAvailable(state, actingPlayerId);
  const proxyStillAvailable =
    !costWaived ||
    (proxySourceInstanceId !== undefined &&
      (() => {
        const proxySourceCard = getCardById(state, proxySourceInstanceId);
        if (
          proxySourceCard === undefined ||
          proxySourceCard.zone !== "field" ||
          proxySourceCard.controllerPlayerId !== actingPlayerId ||
          proxySourceCard.faceDown
        ) {
          return false;
        }
        const proxySourceDefinition = options.getCardDefinitionById(
          proxySourceCard.definitionId
        );
        const proxyData = proxySourceDefinition?.contractCombineProxyData;
        if (!proxyData) return false;
        if (
          !evaluateCondition(
            state,
            [{ kind: "min_level", value: proxyData.requiredLevel }],
            proxySourceCard.instanceId,
            actingPlayerId,
            options.getCardDefinitionById
          )
        ) {
          return false;
        }
        return canUseEffectByUsageLimit({
          state,
          sourceInstanceId: proxySourceCard.instanceId,
          sourceDefinitionId: proxySourceCard.definitionId,
          getCardDefinitionById: options.getCardDefinitionById,
          effectLabel: "contract_combine_proxy",
          usageLimit: { kind: "per_card_name", duration: "turn" },
        });
      })());

  // ソース消失（窓中に対象が離脱・耐性付与・ソウルコア喪失）= 不発。
  // braveCondition/timingScope の再検証は divine_skill と同水準（source/target 在席のみ）に
  // 留める（P3-112 スコープはスタック窓の追加、既存の availability 再検証範囲の拡張ではない）。
  if (
    !braveStillValid ||
    !targetStillValid ||
    !soulCoreStillAvailable ||
    !proxyStillAvailable
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `[ContractCombine] 起動条件が失われたため不発: ${braveId}`,
      ],
    };
  }

  let combinedState = state;

  // 起動コスト: 自分のソウルコアをトラッシュに置く（召喚コストは支払わない）。
  // プロキシ起動 (P3-111 S4, costWaived) は「トラッシュに置いたものとして」扱い、
  // 実際のソウルコア消費をスキップする。
  if (!costWaived) {
    combinedState = consumeSoulCore(
      combinedState,
      actingPlayerId,
      "trash",
      braveId
    );
  }

  // プロキシ起動元 (P3-111 S4) の〔ターンに1回：同名〕使用制限を記録する。
  if (proxySourceInstanceId) {
    const proxySourceCard = getCardById(combinedState, proxySourceInstanceId);
    if (proxySourceCard) {
      combinedState = recordEffectUsageIfLimited({
        state: combinedState,
        sourceInstanceId: proxySourceInstanceId,
        sourceDefinitionId: proxySourceCard.definitionId,
        effectLabel: "contract_combine_proxy",
        usageLimit: { kind: "per_card_name", duration: "turn" },
      });
    }
  }

  // 合体していたブレイヴは破棄する: pendingLeave 経由でホストからの切り離しと
  // 「破壊された/離れたとき」誘発の検出窓 (窓1) を確保してからトラッシュへ送る。
  const oldBraveIds = targetCard.attachedChildrenIds;
  const stateBeforeOldBraveLeave = combinedState;
  for (const oldBraveId of oldBraveIds) {
    combinedState = queuePendingLeave({
      state: combinedState,
      instanceId: oldBraveId,
      kind: "destroy",
      cause: "effect_resolution",
      causePlayerId: actingPlayerId,
      chainId: `contract-combine-discard:${oldBraveId}`,
      causedByEffectSourceInstanceId: causalSourceInstanceId,
    });
  }
  if (oldBraveIds.length > 0) {
    combinedState = collectAndQueueTriggerReactions({
      beforeState: stateBeforeOldBraveLeave,
      afterState: combinedState,
      source: "action_resolution",
      chainId: `contract-combine-discard:${braveId}`,
      getCardDefinitionById: options.getCardDefinitionById,
      getRegisteredTriggeredEffectActions:
        options.getRegisteredTriggeredEffectActions,
      getRegisteredBurstActions: options.getRegisteredBurstActions,
      causedByPlayerId: actingPlayerId,
      causedBySourceInstanceId: causalSourceInstanceId,
    });
    // 物理移動 (トラッシュへ, コアはリザーブへ) を確定する。
    combinedState = queuePreFlushGrantedEffectsAndFlushPendingLeaves({
      state: combinedState,
      getCardDefinitionById: options.getCardDefinitionById,
    });
  }

  const stateBeforeNewBraveAttach = combinedState;

  // 手札のブレイヴをフィールドへ（合体状態で場入り。召喚コストは支払わない）。
  combinedState = moveCardZone(combinedState, braveId, "field", "brave");
  combinedState = updateCard(combinedState, braveId, (c) => ({
    ...c,
    exhaustState: "recovered",
    attachedToInstanceId: targetId!,
  }));
  combinedState = updateCard(combinedState, targetId!, (c) => ({
    ...c,
    attachedChildrenIds: [braveId],
  }));
  combinedState = recordSemanticTriggerEvent(combinedState, {
    eventKind: "brave_combined",
    relatedInstanceId: braveId,
    triggerRelatedCombinedHostInstanceId: targetId!,
    cause: "contract_combine",
  });

  combinedState.log.push(
    `brave:contract_combine:${combinedState.turnNumber}:${actingPlayerId}:${braveId}:${targetId}`
  );

  combinedState = recomputeAndRebuildContinuousEffects(
    combinedState,
    options.getCardDefinitionById
  );

  // Deliver the operation-owned contract_combine fact through the common funnel.
  combinedState = collectAndQueueTriggerReactions({
    beforeState: stateBeforeNewBraveAttach,
    afterState: combinedState,
    source: "action_resolution",
    chainId: `contract-combine:${braveId}`,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: actingPlayerId,
    causedBySourceInstanceId: causalSourceInstanceId,
  });

  // 魂状態のカードへの契約合体 (P3-111 S4/S5, BSGE01-CX01〜CX04)。08a:180 の契約煌臨と
  // 同型に、魂状態を離れさせ、buildChargeCoresPendingCoreDistribution (契約煌臨/創界石転醒
  // postRebirth と共通の SSOT ヘルパー) で任意コア配置を開く。
  const wasTargetInSoulState =
    state.players
      .find((p) => p.id === actingPlayerId)
      ?.soulStateInstanceIds.includes(targetId!) ?? false;
  if (wasTargetInSoulState) {
    combinedState = updatePlayer(combinedState, actingPlayerId, (p) => ({
      ...p,
      soulStateInstanceIds: p.soulStateInstanceIds.filter(
        (id) => id !== targetId
      ),
    }));
    const chargePending = buildChargeCoresPendingCoreDistribution(
      combinedState,
      actingPlayerId,
      targetId!,
      targetCard.definitionId,
      options.getCardDefinitionById,
      "contract-combine-charge"
    );
    if (chargePending) {
      return { ...combinedState, pendingCoreDistribution: chargePending };
    }
  }

  return combinedState;
}
