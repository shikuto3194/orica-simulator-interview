import { requireCardZone } from "../model";
import type { CardInstance, CardZone, GameState } from "../model";

export function countPlayerZoneCards(
  cards: readonly CardInstance[],
  playerId: string,
  zone: "hand" | "deck"
): number {
  return cards.filter(
    (card) => card.ownerPlayerId === playerId && card.zone === zone
  ).length;
}

/** カード配列の唯一の更新境界。枚数を別途同期する呼出しは不要。 */
export function replaceCardInstances(
  state: GameState,
  cardInstances: CardInstance[]
): GameState {
  // Bulk zone stamps must obey the same card/core boundary as moveCardZone.
  // Validate before either cards or synchronized hand/deck counts can change.
  for (const card of cardInstances) requireCardZone(card.zone);
  let changed = cardInstances !== state.cardInstances;
  const players = state.players.map((player) => {
    const count = (zone: "hand" | "deck", previous: number): number => {
      const actual = countPlayerZoneCards(cardInstances, player.id, zone);
      return state.zoneCountMode === "abstract"
        ? Math.max(
            0,
            previous +
              actual -
              countPlayerZoneCards(state.cardInstances, player.id, zone)
          )
        : actual;
    };
    const handCount = count("hand", player.handCount);
    const deckCount = count("deck", player.deckCount);
    if (handCount === player.handCount && deckCount === player.deckCount)
      return player;
    changed = true;
    return { ...player, handCount, deckCount };
  });
  return changed ? { ...state, cardInstances, players } : state;
}

/** 抽象fixtureで実体のないカードだけを移す。実対戦では利用不可。 */
export function moveUninstantiatedCards(
  state: GameState,
  playerId: string,
  from: "deck",
  to: CardZone,
  amount: number
): GameState {
  requireCardZone(to);
  if (amount <= 0) return state;
  if (state.zoneCountMode !== "abstract")
    throw new Error("Uninstantiated cards require an explicit abstract state");
  const player = state.players.find((entry) => entry.id === playerId);
  if (
    !player ||
    !Number.isInteger(amount) ||
    amount >
      player.deckCount -
        countPlayerZoneCards(state.cardInstances, playerId, from)
  ) {
    throw new Error("Uninstantiated card movement exceeds the abstract deck");
  }
  if (to === from) return state;
  return {
    ...state,
    players: state.players.map((entry) =>
      entry.id === playerId
        ? {
            ...entry,
            deckCount: entry.deckCount - amount,
            handCount: entry.handCount + (to === "hand" ? amount : 0),
          }
        : entry
    ),
  };
}

/** 実体と抽象fixture双方のドローを同じ移動境界で処理する。 */
export function drawCardsToHand(
  state: GameState,
  playerId: string,
  requested: number,
  position: "top" | "bottom" = "top",
  /** 指定範囲を確定した後に判定する。耐性札の代わりに次の札を引かない。 */
  canDrawCard?: (card: CardInstance) => boolean
): { state: GameState; drawnIds: Set<string>; amount: number } {
  const deck = state.cardInstances.filter(
    (card) => card.ownerPlayerId === playerId && card.zone === "deck"
  );
  const available =
    state.zoneCountMode === "abstract"
      ? (state.players.find((player) => player.id === playerId)?.deckCount ?? 0)
      : deck.length;
  const requestedAmount = Math.max(
    0,
    Math.min(Math.floor(requested), available)
  );
  const physicalAmount = Math.min(requestedAmount, deck.length);
  const selected =
    position === "bottom"
      ? deck.slice(deck.length - physicalAmount)
      : deck.slice(0, physicalAmount);
  const affected = canDrawCard ? selected.filter(canDrawCard) : selected;
  const amount = requestedAmount - selected.length + affected.length;
  const drawnIds = new Set(affected.map((card) => card.instanceId));
  const next = replaceCardInstances(
    state,
    state.cardInstances.map((card) =>
      drawnIds.has(card.instanceId) ? { ...card, zone: "hand" } : card
    )
  );
  return {
    state: moveUninstantiatedCards(
      next,
      playerId,
      "deck",
      "hand",
      requestedAmount - physicalAmount
    ),
    drawnIds,
    amount,
  };
}
