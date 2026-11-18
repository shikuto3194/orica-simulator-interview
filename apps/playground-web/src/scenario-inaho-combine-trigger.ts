import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905087: normal combine must offer Analytical Engine. */
export function buildInahoCombineTriggerScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const zone = params?.get("zone") === "trash" ? "trash" : "hand";
  const make = (
    no: string,
    id: string,
    location: "field" | "hand" | "trash",
    cores = 0
  ) =>
    createCardInstance(cards.find((c) => c.cardNo === no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone: location,
      normalCoreCount: cores,
    });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        make("BSAZ01-C01", "card-20", "field", 1),
        make("BSAZ01-CX01", "card-17", "field", 1),
        make("BSAZ01-C18", "card-6", zone),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner && zone === "hand" ? 1 : 0,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 5,
    step: "main",
    window: "none",
  };
}
