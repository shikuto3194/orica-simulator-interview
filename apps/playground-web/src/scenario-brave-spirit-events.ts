import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Minimal reconstruction of the 2026-10-31 snapshot's turn-4 brave attack. */
export function buildBraveSpiritEventsScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const attacker = params?.get("owner") === "alice" ? "alice" : "bob";
  const observer = attacker === "alice" ? "bob" : "alice";
  const nexusNo =
    params?.get("nexus") === "bsth06"
      ? "BSTH06-転醒R01(A)"
      : "BSTH03-転醒R01(A)";
  const getDef = (id: string) => cards.find((c) => c.cardNo === id);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(getDef("BSSL01-R03")!, {
          instanceId: "card-77",
          ownerPlayerId: attacker,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(getDef(nexusNo)!, {
          instanceId: "card-1",
          ownerPlayerId: observer,
          zone: "field",
        }),
      ],
    }),
    activePlayerId: attacker,
    turnNumber: 4,
    step: "attack",
    window: "none",
  };
  return recomputeAndRebuildContinuousEffects(state, getDef);
}
