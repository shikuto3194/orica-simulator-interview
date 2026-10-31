import { getCardById } from "../card/card-lookup";
import { getZoneMoveHandGainCost } from "../effect/hand-gain-cost";
import type { GameState, PendingZoneSelection } from "../model";

/** 未選択時は課税されうる候補を照会。確定時はカードごとの実際の行き先を使う。 */
export function getZoneSelectionHandGainCost(
  state: GameState,
  pending: PendingZoneSelection,
  selectedIds: readonly string[] = pending.candidateCardInstanceIds,
  destinations?: Readonly<Record<string, "hand" | "set_aside">>
): number {
  // 手札/手元との交換は純増ではない。
  if (pending.swapPickedInstanceId !== undefined) return 0;
  const effectPlayerId = pending.effectActingPlayerId ?? pending.actingPlayerId;
  return Math.max(
    0,
    ...selectedIds.map((id) => {
      const card = getCardById(state, id);
      if (!card) return 0;
      const destination =
        pending.destination === "hand_or_set_aside_choice"
          ? (destinations?.[id] ?? "hand")
          : pending.destination;
      return getZoneMoveHandGainCost(
        state,
        pending.targetPlayerId ?? card.ownerPlayerId,
        effectPlayerId,
        [card],
        destination
      );
    })
  );
}
