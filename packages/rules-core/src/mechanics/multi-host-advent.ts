/**
 * 多重煌臨（1宣言で2 host に同時に重ねる）システム (BSSG01-X03「暁 切歌＆月読 調
 * 『アマルガム』」、10_rules/08a_advent-rebirth-contract.md §多重煌臨、裁定確定
 * 2026-08-01、ユーザー確認)。
 *
 * 通常の煌臨 (advent-system.ts) は「煌臨する側」が1枚1host (1対1) だが、本モジュールは
 * 1枚の occupant が2つの host スロット条件を同時に満たす自分のフィールドカード2体を
 * 対象に選び、1つの煌臨元スタックへ統合する。host-dual-advent.ts (BSDB01-CX01
 * 【真バディ】、host 側が2枚の occupant を分岐で保持する**逆方向**パターン) とは別軸。
 *
 * 実行は SSOT 再利用が基本方針:
 * - 対象候補列挙は各スロットにつき既存 `getAdventTargets` を呼ぶ (通常煌臨と同じ
 *   対象除外/条件判定を共有)。
 * - 「上」(状態引き継ぎ側) への重ねは既存 `executeAdvent` を1回だけ呼ぶ (通常の煌臨と
 *   完全に同じ処理: ソウルコア消費・状態引き継ぎ・煌臨元スタック構築)。
 * - 「下」の統合は既存 `attachAsAdventSource` (host→occupant 参照追加 + カード状態初期化)
 *   を呼んだ上で、コア/ソウルコアを統合後インスタンスへ合算する (裁定「維持コアは統合
 *   される」。attachAsAdventSource 単体では呼び出し側がコアを事前退避済みという前提で
 *   normalCoreCount を 0 にリセットするだけのため、そのまま流用するとコアが消失する)。
 */
import type {
  ActiveStack,
  CardDefinition,
  DualHostAdventData,
  GameState,
} from "../model";
import { getCardById } from "../card/card-lookup";
import { updateCard, withSoulCoreLocation } from "../core/core-system";
import { collectAndQueueTriggerReactions } from "../effect/trigger-system";
import type { DeferredStackResolverOptions } from "../legal/stack-resolution-types";
import {
  attachAsAdventSource,
  executeAdvent,
  getAdventTargets,
} from "./advent-system";

export interface DualHostAdventExecuteParams {
  /** 煌臨する側 (手札から重ねるカード、統合後インスタンス) の instanceId。 */
  adventCardInstanceId: string;
  /** 「上」(直接の煌臨先、状態引き継ぎ側) の instanceId。 */
  topHostInstanceId: string;
  /** 「下」(単純に畳まれる側、コアのみ統合先へ合算) の instanceId。 */
  bottomHostInstanceId: string;
  dualHostAdventData: DualHostAdventData;
}

/**
 * host を advent_source として `occupantInstanceId` へ統合する。`attachAsAdventSource`
 * (advent-system.ts) は呼び出し側がコアを事前退避済みという前提で host の
 * `normalCoreCount` を 0 にリセットするだけなので、統合前にコア数/ソウルコア所持を
 * 読み取っておき、統合後インスタンスへ合算する (裁定: 維持コアは統合される)。
 *
 * @returns 統合後の state。host が既にフィールドにない等で統合できない場合は
 *          引数の state をそのまま返す (不発)。
 */
function mergeBottomHostIntoAdventSource(
  state: GameState,
  actingPlayerId: string,
  bottomHostInstanceId: string,
  occupantInstanceId: string
): GameState {
  const bottomHost = getCardById(state, bottomHostInstanceId);
  if (!bottomHost) return state;

  const carriedCoreCount = bottomHost.normalCoreCount;
  const player = state.players.find((p) => p.id === actingPlayerId);
  const bottomHeldSoulCore =
    player?.soulCoreLocation?.kind === "card" &&
    player.soulCoreLocation.instanceId === bottomHostInstanceId;

  const attached = attachAsAdventSource(
    state,
    bottomHostInstanceId,
    occupantInstanceId
  );
  if (!attached) return state;

  let merged = attached;
  if (carriedCoreCount > 0) {
    merged = updateCard(merged, occupantInstanceId, (c) => ({
      ...c,
      normalCoreCount: c.normalCoreCount + carriedCoreCount,
    }));
  }
  if (bottomHeldSoulCore) {
    merged = withSoulCoreLocation(merged, actingPlayerId, {
      kind: "card",
      instanceId: occupantInstanceId,
    });
  }
  return merged;
}

/**
 * 多重煌臨を実行する。対象2体それぞれが2つのスロット条件のどちらを満たすかは、
 * 宣言時点ではなくこの解決時点で再判定する (declare_advent と同型: 窓中の state
 * 変化を許容するため、宣言時に固定しない)。
 *
 * @returns 更新後の state。前提を満たさない場合は引数の state をそのまま返す (不発)。
 */
export function executeDualHostAdvent(
  state: GameState,
  actingPlayerId: string,
  params: DualHostAdventExecuteParams,
  getCardDefinitionById: (id: string) => CardDefinition | undefined
): GameState {
  const {
    adventCardInstanceId,
    topHostInstanceId,
    bottomHostInstanceId,
    dualHostAdventData,
  } = params;

  if (topHostInstanceId === bottomHostInstanceId) {
    state.log.push(`dual_host_advent:${adventCardInstanceId}:same-target`);
    return state;
  }

  const adventCard = getCardById(state, adventCardInstanceId);
  const adventDef = adventCard
    ? getCardDefinitionById(adventCard.definitionId)
    : undefined;
  if (!adventCard || !adventDef) {
    state.log.push(`dual_host_advent:${adventCardInstanceId}:card-not-found`);
    return state;
  }

  const [slotA, slotB] = dualHostAdventData.hostSlotConditions;
  const sharedFields = {
    adventTiming: dualHostAdventData.adventTiming,
    soulCoreDest: dualHostAdventData.soulCoreDest,
  };
  const slotATargetIds = getAdventTargets(
    state,
    actingPlayerId,
    { adventCondition: slotA, ...sharedFields },
    getCardDefinitionById,
    adventDef
  ).map((c) => c.instanceId);
  const slotBTargetIds = getAdventTargets(
    state,
    actingPlayerId,
    { adventCondition: slotB, ...sharedFields },
    getCardDefinitionById,
    adventDef
  ).map((c) => c.instanceId);

  // 対象2体がそれぞれ別のスロット条件を1つずつ満たす組み合わせのみ有効
  // (top/bottom の順序はスロット割当とは独立: どちらが「上」になるかはプレイヤー選択)。
  const topIsSlotA =
    slotATargetIds.includes(topHostInstanceId) &&
    slotBTargetIds.includes(bottomHostInstanceId);
  const topIsSlotB =
    slotBTargetIds.includes(topHostInstanceId) &&
    slotATargetIds.includes(bottomHostInstanceId);
  if (!topIsSlotA && !topIsSlotB) {
    state.log.push(`dual_host_advent:${adventCardInstanceId}:slot-mismatch`);
    return state;
  }
  const topSlotCondition = topIsSlotA ? slotA : slotB;

  const beforeState = state;

  // 「上」= 通常の煌臨 (executeAdvent) をそのまま1回実行 (ソウルコア消費・状態引き継ぎ)。
  const afterTopAdvent = executeAdvent(
    beforeState,
    actingPlayerId,
    {
      adventCardInstanceId,
      targetInstanceId: topHostInstanceId,
      adventData: { adventCondition: topSlotCondition, ...sharedFields },
    },
    getCardDefinitionById
  );
  if (afterTopAdvent === beforeState) return beforeState;

  // 「下」= attachAsAdventSource + コア統合合算。
  const merged = mergeBottomHostIntoAdventSource(
    afterTopAdvent,
    actingPlayerId,
    bottomHostInstanceId,
    adventCardInstanceId
  );
  if (merged === afterTopAdvent) {
    afterTopAdvent.log.push(
      `dual_host_advent:${adventCardInstanceId}:bottom-merge-failed:${bottomHostInstanceId}`
    );
    return afterTopAdvent;
  }

  merged.log.push(
    `dual_host_advent:${adventCardInstanceId}:top:${topHostInstanceId}:bottom:${bottomHostInstanceId}`
  );
  return merged;
}

/**
 * declare_dual_host_advent の deferred 解決 (発揮宣言→スタック窓クローズ後)。
 * resolvedStack.cardInstanceId = 煌臨するカード (統合後インスタンス)、
 * targetInstanceIds = [上, 下] (宣言時の選択順序をそのまま保持)。
 */
export function resolveDeferredDualHostAdventStack(
  state: GameState,
  resolvedStack: ActiveStack,
  options: DeferredStackResolverOptions
): GameState {
  if (resolvedStack.isNullified) return state;

  const adventCardInstanceId = resolvedStack.cardInstanceId;
  const [topHostInstanceId, bottomHostInstanceId] =
    resolvedStack.targetInstanceIds;
  const actingPlayerId = resolvedStack.actingPlayerId;

  const adventDef = options.getCardDefinitionById(
    resolvedStack.cardDefinitionId
  );
  if (
    !adventDef?.dualHostAdventData ||
    topHostInstanceId === undefined ||
    bottomHostInstanceId === undefined
  ) {
    return {
      ...state,
      log: [
        ...state.log,
        `[DualHostAdvent] 多重煌臨データ不整合のため不発: ${adventCardInstanceId}`,
      ],
    };
  }

  const beforeState = state;
  const afterAdvent = executeDualHostAdvent(
    beforeState,
    actingPlayerId,
    {
      adventCardInstanceId,
      topHostInstanceId,
      bottomHostInstanceId,
      dualHostAdventData: adventDef.dualHostAdventData,
    },
    options.getCardDefinitionById
  );
  if (afterAdvent === beforeState) return afterAdvent;

  return collectAndQueueTriggerReactions({
    beforeState,
    afterState: afterAdvent,
    source: "action_resolution",
    chainId: resolvedStack.chainId,
    getCardDefinitionById: options.getCardDefinitionById,
    getRegisteredTriggeredEffectActions:
      options.getRegisteredTriggeredEffectActions,
    getRegisteredBurstActions: options.getRegisteredBurstActions,
    causedByPlayerId: actingPlayerId,
    causedBySourceInstanceId: adventCardInstanceId,
  });
}
