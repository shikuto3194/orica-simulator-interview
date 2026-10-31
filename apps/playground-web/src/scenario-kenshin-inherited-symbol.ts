import {
  createCardInstance,
  createEmptyGameState,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** CX01→C04/R03の白扱いを柱斧の効果解決後も保ち、弥彦の軽減に使う。 */
export function buildKenshinInheritedSymbolScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const getDef = (id: string) => definitions.get(id);
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { reserveNormalCoreCount: 4 },
        { reserveNormalCoreCount: 4 },
      ],
      cardInstances: [
        createCardInstance(getDef("BSRK01-CX01")!, {
          instanceId: "symbol-source",
          ownerPlayerId: owner,
          zone: "field",
          zoneRoleName: "advent-source",
        }),
        {
          ...createCardInstance(
            getDef(
              params?.get("host") === "r03" ? "BSRK01-R03" : "BSRK01-C04"
            )!,
            {
              instanceId: "symbol-host",
              ownerPlayerId: owner,
              zone: "field",
              normalCoreCount: 1,
            }
          ),
          underCards: [
            { role: "advent_source", cardInstanceId: "symbol-source" },
          ],
        },
        createCardInstance(getDef("BSTH09-TR01(A)")!, {
          instanceId: "symbol-red",
          ownerPlayerId: owner,
          zone: "field",
        }),
        createCardInstance(getDef("BSRK01-C07")!, {
          instanceId: "symbol-hand",
          ownerPlayerId: owner,
          zone: "hand",
        }),
        ...[0, 1].map((index) =>
          createCardInstance(getDef("BSRK01-C01")!, {
            instanceId: `symbol-deck-${index}`,
            ownerPlayerId: owner,
            zone: "deck",
          })
        ),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: "main",
    window: "none",
  };
  return rebuildContinuousEffectsFromField(state, getDef);
}
