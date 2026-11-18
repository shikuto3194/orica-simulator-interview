import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905097: てゐの実召喚からデッド・プルーフで発揮を無効化する。 */
export function buildDeadProofCompoundTimingScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const lookup = (id: string) => cards.find((c) => c.cardNo === id)!;
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(lookup("BSTH03-C02"), {
          instanceId: "tewi",
          ownerPlayerId: owner,
          zone: "hand",
        }),
        createCardInstance(lookup("BSGE01-C17"), {
          instanceId: "dead-proof",
          ownerPlayerId: opponent,
          zone: "hand",
        }),
        ...[1, 2, 3, 4].map((i) =>
          createCardInstance(lookup("BSGE01-C01"), {
            instanceId: `deck-${i}`,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: 1,
        deckCount: id === owner ? 4 : 0,
        reserveNormalCoreCount: 8,
        reserveSoulCoreCount: 0,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 8,
    step: "main",
    window: "none",
  };
}
