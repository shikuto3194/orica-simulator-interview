import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Telegram 629905085: reserve=0, 界王神界から魂状態への契約煌臨を維持する。 */
export function buildContractAdventChargeScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const instance = (
    cardNo: string,
    instanceId: string,
    zone: "hand" | "field",
    normalCoreCount = 0
  ) =>
    createCardInstance(definitions.get(cardNo)!, {
      instanceId,
      ownerPlayerId: owner,
      controllerPlayerId: owner,
      zone,
      normalCoreCount,
      soulCoreCount: instanceId === "card-8" ? 1 : 0,
    });
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [
        instance("BSDB01-CX01", "card-26", "field"),
        instance("BSDB01-C08", "card-8", "field", 4),
        instance("BSDB01-R01", "card-5", "hand"),
      ],
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 1 : 0,
        reserveNormalCoreCount: 0,
        ...(id === owner
          ? {
              countValue: 6,
              contractCardNo: "BSDB01-CX01",
              soulStateInstanceIds: ["card-26"],
              soulCoreLocation: { kind: "card" as const, instanceId: "card-8" },
            }
          : {}),
      })),
    }),
    turnNumber: 6,
    activePlayerId: owner,
    step: "main",
    window: "none",
  };
}
