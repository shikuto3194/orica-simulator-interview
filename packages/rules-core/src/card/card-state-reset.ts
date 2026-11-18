import { replaceCardInstances } from "../zone/card-instance-state";
import {
  isCardTextCardState,
  type CardInstance,
  type GameState,
} from "../model";

/** カード状態には疲労・重疲労や、その実体の回復制限を持ち越さない。回復効果ではない。 */
export function resetCardBattleStatus(card: CardInstance): CardInstance {
  if (
    card.exhaustState === "recovered" &&
    !card.exhaustedByUnpreventableEffect &&
    !card.skipNextRefreshRecovery
  )
    return card;
  return {
    ...card,
    exhaustState: "recovered",
    exhaustedByUnpreventableEffect: false,
    skipNextRefreshRecovery: false,
  };
}

/** 純化・分身の状態付与終了など、ゾーンを移動しないカード状態化も共通判定で処理する。 */
export function normalizeCardStateBattleStatus(state: GameState): GameState {
  let changed = false;
  const cardInstances = state.cardInstances.map((card) => {
    const reset = resetCardBattleStatus(card);
    if (reset === card) return card;
    const next = isCardTextCardState(card, state) ? reset : card;
    if (next !== card) changed = true;
    return next;
  });
  return changed ? replaceCardInstances({ ...state }, cardInstances) : state;
}
