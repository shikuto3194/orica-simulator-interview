import {
  createCardInstance,
  createEmptyGameState,
  expandCardDefinitionsWithBackFaces,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Q30857 / Telegram 629905093: productionマミゾウのLv1アタックから同時疲労転醒。 */
export function buildSimultaneousTriggerLevelScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definition = expandCardDefinitionsWithBackFaces(allCards).find(
    (d) => d.cardNo === "BSTH09.2-転醒R01(A)"
  )!;
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        createCardInstance(definition, {
          instanceId: "mamizou",
          ownerPlayerId: owner,
          controllerPlayerId: owner,
          zone: "field",
          normalCoreCount: 2,
        }),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? 3 : 0,
        voidNormalCoreCount: 20,
      })),
    }),
    turnNumber: 3,
    activePlayerId: owner,
    step: "attack",
    window: "none",
  };
}
