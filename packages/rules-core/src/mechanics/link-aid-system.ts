/**
 * 【リンクエイド】(P3-111 S6、BSGE01-CX01〜CX04/R01〜R05)。
 * 魂状態のカードが、自分のフィールドスピリット（`linkAidData.costSourceTribes` に一致）の
 * 通常コア1個を起動コストとして支払い、スピリット状態になる（召喚扱いではない
 * state-change。召喚時効果は誘発しない、10_rules/07b §リンクエイド）。
 *
 * P3-112: 起動コスト（コアをボイドに置く）は使用コストでなく効果文内のため、
 * 発揮宣言でスタック窓を開き、コスト支払い・state-change とも窓クローズ後の
 * deferred 解決で行う（divine_skill と同型、08c:196 一般化）。
 */
import type {
  ActiveStack,
  CardDefinition,
  GameState,
  PendingLinkAidCostSourceCandidate,
} from "../model";
import { finalizeEffectResolution } from "../effect/effect-resolution";
import { collectTriggerEventsFromStateDelta } from "../effect/trigger-system";
import { getCardById } from "../card/card-lookup";
import { getCEsForTarget } from "../card/ce-lookup";
import { matchesTribes } from "../card/tribe-filter";
import { canMoveNormalCoresFrom } from "../core/core-movability";
import { moveNormalCores, updatePlayer } from "../core/core-system";
import { recomputeAndRebuildContinuousEffects } from "../effect/continuous-effect-rebuild";
import { buildChargeCoresPendingCoreDistribution } from "./core-charge-distribution";
import { getEffectiveTribes } from "../legal/legal-actions-shared";
import type { DeferredStackResolverOptions } from "../legal/stack-resolution-types";

/**
 * コスト源コンテナのセンチネル（フィールドカードでなく自分のリザーブそのもの）。
 * SummonCostCoreMoveChoice 等と同型の規約 (model.ts「コア源コンテナ」参照)。
 */
export const LINK_AID_RESERVE_COST_SOURCE = "reserve";

/**
 * `grant_link_aid_cost_override` CE (BSGE01-C03「ディソレイト」フラッシュ) が
 * playerId に登録されているか判定する。player-scoped CE (targetInstanceId = playerId)。
 * 登録中は【リンクエイド】の起動コスト源が「フィールド/リザーブから1コスト」
 * (costSourceTribes 不問) に、charge が「フィールド/リザーブ」に拡張される。
 */
export function isLinkAidCostOverrideActive(
  state: GameState,
  playerId: string
): boolean {
  return getCEsForTarget(state, playerId).some(
    (ce) => ce.modifierTag === "grant_link_aid_cost_override"
  );
}

export function collectLinkAidCostSourceCandidates(
  state: GameState,
  actingPlayerId: string,
  soulStateCardInstanceId: string,
  getCardDefinitionById: (definitionId: string) => CardDefinition | undefined
): PendingLinkAidCostSourceCandidate[] {
  const actingPlayer = state.players.find((p) => p.id === actingPlayerId);
  const soulCard = getCardById(state, soulStateCardInstanceId);
  const soulDef =
    soulCard !== undefined
      ? getCardDefinitionById(soulCard.definitionId)
      : undefined;
  if (
    actingPlayer === undefined ||
    soulCard === undefined ||
    soulDef?.linkAidData === undefined ||
    !actingPlayer.soulStateInstanceIds.includes(soulStateCardInstanceId)
  ) {
    return [];
  }

  const costOverrideActive = isLinkAidCostOverrideActive(state, actingPlayerId);
  const candidates: PendingLinkAidCostSourceCandidate[] = [];

  for (const source of state.cardInstances) {
    if (source.zone !== "field") continue;
    if (source.controllerPlayerId !== actingPlayerId) continue;
    if (source.pendingLeaveKind !== null) continue;
    if (source.instanceId === soulStateCardInstanceId) continue;
    if (
      !costOverrideActive &&
      source.zoneRoleName !== "spirit" &&
      source.zoneRoleName !== "ultimate"
    ) {
      continue;
    }

    const sourceDef = getCardDefinitionById(source.definitionId);
    if (sourceDef === undefined) continue;
    if (!canMoveNormalCoresFrom(state, source, sourceDef)) continue;
    if (source.normalCoreCount <= 0) continue;

    if (!costOverrideActive) {
      const effectiveTribes = getEffectiveTribes(
        state,
        source,
        sourceDef,
        getCardDefinitionById
      );
      if (
        !matchesTribes(
          sourceDef.tribe,
          { tribes: [...soulDef.linkAidData.costSourceTribes] },
          effectiveTribes
        )
      ) {
        continue;
      }
    }

    candidates.push({
      costSourceInstanceId: source.instanceId,
      costSourceCardNo: sourceDef.cardNo,
      availableNormalCoreCount: source.normalCoreCount,
    });
  }

  if (costOverrideActive && actingPlayer.reserveNormalCoreCount > 0) {
    candidates.push({
      costSourceInstanceId: LINK_AID_RESERVE_COST_SOURCE,
      availableNormalCoreCount: actingPlayer.reserveNormalCoreCount,
    });
  }

  return candidates;
}

/**
 * リンクエイドの deferred 解決（発揮宣言→スタック窓クローズ後）。
 * コスト源スピリットの通常コア1個をボイドへ支払い、魂状態を離れさせる。
 */
export function resolveDeferredLinkAidStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  // 無効化された場合は効果・コストともスキップ（起動コストは効果文内のため）。
  if (resolvedStack.isNullified) return state;

  const soulStateCardInstanceId = resolvedStack.cardInstanceId;
  const actingPlayerId = resolvedStack.actingPlayerId;
  const candidates = collectLinkAidCostSourceCandidates(
    state,
    actingPlayerId,
    soulStateCardInstanceId,
    options.getCardDefinitionById
  );

  const legacyChosenCostSourceId = resolvedStack.linkAidCostSourceInstanceId;
  if (legacyChosenCostSourceId !== undefined) {
    const legacyCandidate = candidates.find(
      (candidate) => candidate.costSourceInstanceId === legacyChosenCostSourceId
    );
    if (legacyCandidate !== undefined) {
      return resolveLinkAidWithChosenCostSource(
        state,
        resolvedStack,
        legacyCandidate,
        options
      );
    }
  }

  if (candidates.length === 0) {
    return {
      ...state,
      log: [
        ...state.log,
        `[LinkAid] 起動条件が失われたため不発: ${soulStateCardInstanceId}`,
      ],
    };
  }

  if (candidates.length > 1) {
    const soulDef = options.getCardDefinitionById(
      resolvedStack.cardDefinitionId
    );
    return {
      ...state,
      pendingLinkAidCostSourceChoice: {
        pendingId: `link-aid-cost-source:${resolvedStack.chainId}`,
        actingPlayerId,
        soulStateCardInstanceId,
        soulStateCardNo: soulDef?.cardNo ?? resolvedStack.cardDefinitionId,
        candidates,
        deferredStack: resolvedStack,
      },
      log: [
        ...state.log,
        `link_aid:cost-source-choice:pending:${resolvedStack.chainId}:${candidates.length}`,
      ],
    };
  }

  return resolveLinkAidWithChosenCostSource(
    state,
    resolvedStack,
    candidates[0]!,
    options
  );
}

export function resolveLinkAidWithChosenCostSource(
  state: GameState,
  resolvedStack: ActiveStack,
  chosenCandidate: PendingLinkAidCostSourceCandidate,
  options: DeferredStackResolverOptions
): GameState {
  const soulStateCardInstanceId = resolvedStack.cardInstanceId;
  const costSourceInstanceId = chosenCandidate.costSourceInstanceId;
  const actingPlayerId = resolvedStack.actingPlayerId;
  const isReserveCostSource =
    costSourceInstanceId === LINK_AID_RESERVE_COST_SOURCE;

  const currentCandidate = collectLinkAidCostSourceCandidates(
    state,
    actingPlayerId,
    soulStateCardInstanceId,
    options.getCardDefinitionById
  ).find(
    (candidate) => candidate.costSourceInstanceId === costSourceInstanceId
  );
  const player = state.players.find((p) => p.id === actingPlayerId);
  const stillInSoulState =
    player?.soulStateInstanceIds.includes(soulStateCardInstanceId) ?? false;
  const costSourceCard =
    costSourceInstanceId && !isReserveCostSource
      ? getCardById(state, costSourceInstanceId)
      : undefined;
  const costSourceStillValid = isReserveCostSource
    ? (player?.reserveNormalCoreCount ?? 0) > 0
    : costSourceCard !== undefined &&
      costSourceCard.zone === "field" &&
      costSourceCard.normalCoreCount > 0;

  // ソース消失（窓中に魂状態を離れた/コスト源が離脱・コア不足）= 不発。
  if (
    currentCandidate === undefined ||
    !stillInSoulState ||
    !costSourceStillValid
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `[LinkAid] 起動条件が失われたため不発: ${soulStateCardInstanceId}`,
      ],
    };
  }

  // 起動コスト: コスト源（フィールドカード、または override 時のみリザーブ）の
  // 通常コア1個 → ボイド（効果文内、固定1）。
  let newState = moveNormalCores(
    state,
    isReserveCostSource
      ? { kind: "reserve", playerId: actingPlayerId }
      : { kind: "card", instanceId: costSourceInstanceId },
    { kind: "void", playerId: actingPlayerId },
    1
  );

  // 魂状態を離れる（召喚扱いではない state-change）。
  newState = updatePlayer(newState, actingPlayerId, (p) => ({
    ...p,
    soulStateInstanceIds: p.soulStateInstanceIds.filter(
      (id) => id !== soulStateCardInstanceId
    ),
  }));

  newState = recomputeAndRebuildContinuousEffects(
    newState,
    options.getCardDefinitionById
  );

  newState.log.push(
    `link_aid:${newState.turnNumber}:${actingPlayerId}:${soulStateCardInstanceId}:${costSourceInstanceId}`
  );

  const soulCard = getCardById(newState, soulStateCardInstanceId);
  const chargePending = buildChargeCoresPendingCoreDistribution(
    newState,
    actingPlayerId,
    soulStateCardInstanceId,
    soulCard?.definitionId ?? soulStateCardInstanceId,
    options.getCardDefinitionById,
    "link-aid-charge",
    {
      sourceScope: isLinkAidCostOverrideActive(newState, actingPlayerId)
        ? "field_and_reserve"
        : "reserve_only",
    }
  );

  // 状態化とコア配置は一つの解決。0コアの中間状態で合体可否を評価すると、
  // 合法な反応まで捨てられる。共通の差分検出でイベントを保持し、配置後に評価する。
  if (chargePending) {
    return {
      ...newState,
      pendingCoreDistribution: {
        ...chargePending,
        supplementalTriggerEvents: collectTriggerEventsFromStateDelta({
          beforeState: state,
          afterState: newState,
          source: "action_resolution",
          chainId: resolvedStack.chainId,
          attackId: newState.activeAttack?.attackId ?? null,
          causedByPlayerId: actingPlayerId,
          causedBySourceInstanceId: soulStateCardInstanceId,
          getCardDefinitionById: options.getCardDefinitionById,
        }),
      },
    };
  }

  return finalizeEffectResolution({
    state: newState,
    beforeState: state,
    chainId: resolvedStack.chainId,
    endLogs: [],
    actingPlayerId,
    causedBySourceInstanceId: soulStateCardInstanceId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
  });
}
