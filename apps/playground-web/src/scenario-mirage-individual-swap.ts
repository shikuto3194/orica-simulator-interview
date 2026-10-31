import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type CardInstance,
} from "@orica/rules-core";

/** 化け化けの0枠・個別交換を実カードの支払いHUDから検証する。 */
export function buildMirageIndividualSwapScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
) {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const multiple = params?.get("multiple") === "1";
  const incomingExempt = params?.get("incoming") === "exempt";
  const cards: CardInstance[] = [];
  const add = (
    cardNo: string,
    instanceId: string,
    zone: CardInstance["zone"],
    player = owner,
    normalCoreCount = 0
  ) => {
    const definition = allCards.find((card) => card.cardNo === cardNo)!;
    cards.push(
      createCardInstance(definition, {
        instanceId,
        ownerPlayerId: player,
        zone,
        normalCoreCount,
      })
    );
  };
  const normalCardNo = "BSGE01-C02"; // 剛属性バックラー真。通常枠と有料セットの実カード。
  add("BSTH002-C01", "mirage-old-0", "mirage");
  add(multiple ? "BSTH002-C01" : normalCardNo, "mirage-old-1", "mirage");
  add(incomingExempt ? "BSTH002-C01" : normalCardNo, "mirage-incoming", "hand");
  add("BSTH01-C01", "payment-source", "field", owner, 2);
  for (const player of ["alice", "bob"]) {
    for (let i = 0; i < 3; i++)
      add("BSTH01-C01", `${player}-deck-${i}`, "deck", player);
  }
  return {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: cards,
      playerOverrides: ["alice", "bob"].map((id) => ({
        handCount: id === owner ? 1 : 0,
        deckCount: 3,
        reserveNormalCoreCount: 10,
        reserveSoulCoreCount: 0,
        soulCoreLocation: null,
      })),
    }),
    step: "main" as const,
    activePlayerId: owner,
    turnNumber: 3,
    mirageSetStates: [0, 1].map((i) => ({
      playerId: owner,
      cardInstanceId: `mirage-old-${i}`,
    })),
    // 使用済みでもセット済みの各個体は0枠のまま。
    mirageSetCountExemptionsUsed: [{ playerId: owner, cardNo: "BSTH002-C01" }],
  };
}
