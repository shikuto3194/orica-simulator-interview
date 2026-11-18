import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Same public cards and field soul core as Telegram 629905109, from the real C23 DSL. */
export function buildC23ExclusiveRevealScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const getDefinition = (id: string) => cards.find((c) => c.cardNo === id);
  const source = getDefinition("BSTH08.5-C23")!;
  const deck =
    params?.get("short") === "1"
      ? ["BSTH08.5-X03", "BSTH08.5-C21", "BSTH08.5-C23"]
      : [
          "BSTH08.5-X03",
          "BSTH08.5-C21",
          "BSTH08.5-C23",
          "BSTH08.5-M11",
          "BSTH08.5-M11",
        ];
  const base = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: ["alice", "bob"].map((id) => ({
      reserveNormalCoreCount:
        id === owner && params?.get("cores") === "reserve" ? 1 : 0,
      reserveSoulCoreCount: 0,
      handCount: 0,
      deckCount: id === owner ? deck.length : 0,
    })),
    cardInstances: [
      createCardInstance(source, {
        instanceId: "c23-source",
        ownerPlayerId: owner,
        zone: "set_aside",
      }),
      createCardInstance(getDefinition("BSTH01-M01")!, {
        instanceId: "supply",
        ownerPlayerId: owner,
        zone: "field",
        soulCoreCount: 1,
      }),
      ...deck.map((no, index) =>
        createCardInstance(getDefinition(no)!, {
          instanceId: `reveal-${index}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
  });
  const state: GameState = {
    ...base,
    activePlayerId: owner,
    step: "main",
    turnNumber: 4,
    players: base.players.map((player) =>
      player.id === owner
        ? {
            ...player,
            soulCoreLocation: { kind: "card", instanceId: "supply" },
          }
        : player
    ),
  };
  return executeEffect({
    chainId: "scenario-c23-exclusive-reveal",
    state,
    effect: source.accelData!.effects![0]!,
    sourceInstanceId: "c23-source",
    actingPlayerId: owner,
    getCardDefinitionById: getDefinition,
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
  });
}
