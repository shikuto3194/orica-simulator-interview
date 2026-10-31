import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
  type Zone,
} from "@orica/rules-core";

/** カード詳細・除外閲覧とC09の残り札処理を実カードで確認する。 */
export function buildCardDetailZonesScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const lookup = (id: string) => cards.find((card) => card.cardNo === id);
  const make = (no: string, id: string, owner: string, zone: Zone, cores = 0) =>
    createCardInstance(lookup(no)!, {
      instanceId: id,
      ownerPlayerId: owner,
      zone,
      normalCoreCount: cores,
    });
  const search = params?.get("mode") === "search";
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const noMatch = params?.get("noMatch") === "1";
  const instances = search
    ? [
        make("BSLH01-C09", "yuna", owner, "field", 1),
        make(
          noMatch ? "BSLH01-C09" : "BSLH01-C12",
          "search-nexus",
          owner,
          "deck"
        ),
        make(
          noMatch ? "BSLH01-C09" : "BSLH01-C01",
          "search-spirit",
          owner,
          "deck"
        ),
        make("BSLH01-C09", "search-cheap", owner, "deck"),
        make("BSTH01-C01", "unopened", owner, "deck"),
      ]
    : ["alice", "bob"].flatMap((player) => [
        make("BSLH01-C12", `${player}-token-source`, player, "field", 1),
        ...(params?.get("emptyTrash") === "1"
          ? []
          : [make("BSLH01-C09", `${player}-trash`, player, "trash")]),
        make("BSLH01-C09", `${player}-deck`, player, "deck"),
        ...(params?.get("empty") === "1"
          ? []
          : [
              make(
                "BSLH01-C12",
                `${player}-removed-source`,
                player,
                "removed_from_game"
              ),
              ...(player === "bob"
                ? [
                    make(
                      "BSLH01-T03",
                      "bob-removed-token",
                      player,
                      "removed_from_game"
                    ),
                  ]
                : []),
            ]),
      ]);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: instances,
      playerOverrides: [
        { reserveNormalCoreCount: 5 },
        { reserveNormalCoreCount: 5 },
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
  return search
    ? executeEffect({
        chainId: "scenario:c09-search",
        state,
        effect: lookup("BSLH01-C09")!.effects![0]!,
        sourceInstanceId: "yuna",
        actingPlayerId: owner,
        getCardDefinitionById: lookup,
        getRegisteredTriggeredEffectActions: () => [],
      })
    : state;
}
