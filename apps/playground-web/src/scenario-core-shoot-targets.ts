import {
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** コア除去の通常カードと独立コア管理カードを同じ盤面で比較する。 */
export function buildCoreShootTargetsScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = new Map(allCards.map((d) => [d.cardNo, d]));
  const card = (
    no: string,
    id: string,
    zone: "hand" | "field",
    cores: number,
    player = opponent
  ) => {
    const definition = definitions.get(no);
    if (!definition) throw new Error(`Unknown scenario card: ${no}`);
    return createCardInstance(definition, {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  };
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        card(
          params?.get("card") ?? "BSTH01-C22",
          "shoot-magic",
          "hand",
          0,
          owner
        ),
        card("BSTH05-R02", "shoot-response", "hand", 0),
        card("BSTH01-C01", "shoot-spirit-a", "field", 3),
        card("BSTH01-C02", "shoot-spirit-b", "field", 3),
        card("BSTH01-C12", "shoot-nexus", "field", 3),
        card("BSSA01-XX01", "shoot-grandwalker", "field", 3),
        card("BSTH01-XX01", "shoot-guided", "field", 3),
        card("BSTH04-転醒R01(A)", "shoot-grandstone", "field", 2),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        handCount: 1,
        deckCount: 20,
        reserveNormalCoreCount: 10,
        reserveSoulCoreCount: 0,
        soulCoreLocation: null,
      })),
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
  return recomputeAndRebuildContinuousEffects(state, (id) =>
    definitions.get(id)
  );
}
