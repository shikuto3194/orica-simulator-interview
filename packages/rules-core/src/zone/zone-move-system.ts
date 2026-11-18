import { replaceCardInstances } from "./card-instance-state";
import type { CardInstance, GameState } from "../model";
import { applyFaceDownPolicyOnZoneChange } from "./face-down-policy";
import { moveNormalCores } from "../core/core-system";
import { resetCardBattleStatus } from "../card/card-state-reset";

function resetCardForDeck(card: CardInstance): CardInstance {
  return applyFaceDownPolicyOnZoneChange(
    {
      ...resetCardBattleStatus(card),
      zone: "deck",
      controllerPlayerId: card.ownerPlayerId,
      normalCoreCount: 0,
      attachedToInstanceId: null,
      attachedChildrenIds: [],
      underCards: [],
    },
    "deck"
  );
}

export function moveTrashCardsToDeckTopBottom(options: {
  state: GameState;
  actingPlayerId: string;
  cardIds: readonly string[];
}): GameState {
  const { actingPlayerId, cardIds } = options;
  if (cardIds.length !== 2) {
    throw new Error(
      `Zone cost payment requires one deck-top card and one deck-bottom card: ${cardIds.length}`
    );
  }
  const idSet = new Set(cardIds);
  if (idSet.size !== cardIds.length) {
    throw new Error("Zone cost payment cards must be unique");
  }

  const selectedCardsById = new Map(
    options.state.cardInstances
      .filter((card) => idSet.has(card.instanceId))
      .map((card) => [card.instanceId, card])
  );
  const selectedCards = cardIds.map((id) => selectedCardsById.get(id));
  for (const card of selectedCards) {
    if (!card) {
      throw new Error("Zone cost payment card not found");
    }
    if (card.ownerPlayerId !== actingPlayerId || card.zone !== "trash") {
      throw new Error(`Invalid zone cost payment card: ${card.instanceId}`);
    }
  }

  let state = options.state;
  for (const card of selectedCards) {
    if (card && card.normalCoreCount > 0) {
      state = moveNormalCores(
        state,
        { kind: "card", instanceId: card.instanceId },
        { kind: "reserve", playerId: actingPlayerId },
        card.normalCoreCount
      );
    }
  }

  const topCard = state.cardInstances.find(
    (card) => card.instanceId === cardIds[0]
  );
  const bottomCard = state.cardInstances.find(
    (card) => card.instanceId === cardIds[1]
  );
  if (!topCard || !bottomCard) {
    throw new Error("Zone cost payment card not found after core movement");
  }
  const nonMoved = state.cardInstances.filter(
    (card) => !idSet.has(card.instanceId)
  );
  const deckCards = nonMoved.filter(
    (card) => card.ownerPlayerId === actingPlayerId && card.zone === "deck"
  );
  const nonDeckCards = nonMoved.filter(
    (card) => !(card.ownerPlayerId === actingPlayerId && card.zone === "deck")
  );

  return replaceCardInstances(
    {
      ...state,
      players: state.players.map((player) =>
        player.id === actingPlayerId ? { ...player } : player
      ),
    },
    [
      resetCardForDeck(topCard),
      ...deckCards,
      resetCardForDeck(bottomCard),
      ...nonDeckCards,
    ]
  );
}
