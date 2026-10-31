import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905096: 要石の実召喚/アタック後に相手の除外2枚を閲覧。 */
export function buildKanameRemovalScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const attack = params?.get("mode") === "attack";
  const lookup = (id: string) => cards.find((c) => c.cardNo === id)!;
  const instances = [
    createCardInstance(lookup("BSTH05.5-C01"), {
      instanceId: "kaname",
      ownerPlayerId: owner,
      zone: attack ? "field" : "hand",
      normalCoreCount: attack ? 1 : 0,
    }),
    ...(attack
      ? [
          createCardInstance(lookup("BSTH05.5-C03"), {
            instanceId: "attacker",
            ownerPlayerId: owner,
            zone: "field",
            normalCoreCount: 1,
          }),
        ]
      : []),
    ...["BSTH005-TX01(A)", "BSTH04-X01", "BSTH01-C01"].map((no, i) =>
      createCardInstance(lookup(no), {
        instanceId: `deck-${i + 1}`,
        ownerPlayerId: opponent,
        zone: "deck",
      })
    ),
  ];
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: instances,
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner && !attack ? 1 : 0,
        deckCount: id === opponent ? 3 : 0,
        reserveNormalCoreCount: 8,
        reserveSoulCoreCount: 0,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 4,
    step: attack ? "attack" : "main",
    window: "none",
  };
}
