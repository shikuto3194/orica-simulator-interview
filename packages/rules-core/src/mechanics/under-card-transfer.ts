import { replaceCardInstances } from "../zone/card-instance-state";
import type { GameState } from "../model";

/** 煌臨・煌臨元化時の下カード継承。役割・表裏は維持し、text_role の親参照も移す。 */
export function transferUnderCards(
  state: GameState,
  fromHostId: string,
  toHostId: string
): GameState {
  if (fromHostId === toHostId) return state;
  const from = state.cardInstances.find(
    (card) => card.instanceId === fromHostId
  );
  const to = state.cardInstances.find((card) => card.instanceId === toHostId);
  if (!from || !to) return state;
  // 合体相手を畳む転醒では新host自身が元hostの下にある場合がある。
  const entries = from.underCards.filter(
    (entry) =>
      entry.cardInstanceId !== toHostId && entry.cardInstanceId !== fromHostId
  );
  const textRoleIds = new Set(
    entries
      .filter((entry) => entry.role === "text_role")
      .map((entry) => entry.cardInstanceId)
  );
  return replaceCardInstances(
    {
      ...state,
    },
    state.cardInstances.map((card) => {
      if (card.instanceId === fromHostId) return { ...card, underCards: [] };
      if (card.instanceId === toHostId)
        return {
          ...card,
          underCards: [
            ...card.underCards,
            ...entries.filter(
              (entry) =>
                !card.underCards.some(
                  (existing) => existing.cardInstanceId === entry.cardInstanceId
                )
            ),
          ],
        };
      if (textRoleIds.has(card.instanceId))
        return { ...card, attachedToInstanceId: toHostId };
      return card;
    })
  );
}
