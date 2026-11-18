import {
  checkAndQueuePlacementOracle,
  createCardInstance,
  createEmptyGameState,
  recomputeAndRebuildContinuousEffects,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 2026-10-16 snapshot: 宵越しの銭・ブレイジングスター・小町の配置時導託。 */
export function buildBlazingStarOracleScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const definitions = new Map(cards.map((card) => [card.cardNo, card]));
  const getDefinition = (id: string) => definitions.get(id);
  if (params?.get("case") === "conditional-placement") {
    const opponent = owner === "alice" ? "bob" : "alice";
    const card = (
      cardNo: string,
      instanceId: string,
      zone: "hand" | "deck",
      playerId = owner
    ) =>
      createCardInstance(getDefinition(cardNo)!, {
        instanceId,
        ownerPlayerId: playerId,
        zone,
      });
    // 2026-11-15 の保存時点では配置事象が終了済み。公開された3枚を使って
    // 新たな通常配置から進め、失われた過去の誘発を初期状態へ注入しない。
    return {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        playerOverrides: ["alice", "bob"].map((id) => ({
          deckCount: id === owner ? 3 : 0,
          handCount: id === owner ? 1 : 4,
          reserveNormalCoreCount: 4,
          voidNormalCoreCount: 20,
        })),
        cardInstances: [
          card("BSTH06-X01", "card-45", "hand"),
          ...["BSTH06-R02", "BSTH06-C03", "BSTH09-TR01(A)"].map(
            (cardNo, index) => card(cardNo, `card-${46 + index}`, "deck")
          ),
          // 元の相手手札の内容は非公開。枚数だけを再現するダミー札。
          ...Array.from({ length: 4 }, (_, index) =>
            card("BSTH06-C01", `opponent-${index}`, "hand", opponent)
          ),
        ],
      }),
      turnNumber: 1,
      step: "main",
      window: "none",
      activePlayerId: owner,
    };
  }
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    playerOverrides: ["alice", "bob"].map((id) => ({
      deckCount: id === owner ? 3 : 0,
      handCount: 0,
      voidNormalCoreCount: 100,
    })),
    cardInstances: [
      createCardInstance(getDefinition("BSTH04-XX01")!, {
        instanceId: "yamazanadu",
        ownerPlayerId: owner,
        zone: "field",
      }),
      ...["BSTH04-C12", "BSTH01-C21", "BSTH04-X03"].map((cardNo, index) =>
        createCardInstance(getDefinition(cardNo)!, {
          instanceId: `oracle-deck-${index}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
  });
  return checkAndQueuePlacementOracle(
    recomputeAndRebuildContinuousEffects(
      { ...state, step: "main", activePlayerId: owner },
      getDefinition
    ),
    "yamazanadu",
    getDefinition,
    "scenario:blazing-star-oracle"
  );
}
