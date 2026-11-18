import { getCardById } from "../card/card-lookup";
import { moveNormalCores, moveSoulCore } from "./core-system";
import type { GameState } from "../model";

/** 逆転醒の支払い前状態。候補生成・事前確認・実行で同じコア返却を使う。 */
export function reverseRebirthSummonSourceReturnedState(
  state: GameState,
  action: { sourceInstanceId: string; actingPlayerId: string }
): GameState {
  const source = getCardById(state, action.sourceInstanceId);
  if (!source || source.zone !== "field") return state;
  let next = state;
  if (source.normalCoreCount > 0)
    next = moveNormalCores(
      next,
      { kind: "card", instanceId: source.instanceId },
      { kind: "reserve", playerId: action.actingPlayerId },
      source.normalCoreCount
    );
  if (source.soulCoreCount > 0)
    next = moveSoulCore(
      next,
      action.actingPlayerId,
      { kind: "card", instanceId: source.instanceId },
      { kind: "reserve", playerId: action.actingPlayerId },
      source.soulCoreCount
    );
  return next;
}
