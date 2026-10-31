import {
  createCardInstance,
  createEmptyGameState,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** 添付盤面のBP-5000を受けた剣心に、小町のLvコスト+2を解決する。 */
export function buildKenshinLevelBpScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const getDef = (id: string) => cards.find((c) => c.cardNo === id);
  const komachi = getDef("BSTH04-X03")!;
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: [
        { countValue: 2, voidNormalCoreCount: 50 },
        { countValue: 2, voidNormalCoreCount: 50 },
      ],
      cardInstances: [
        createCardInstance(komachi, {
          instanceId: "lv-komachi",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(getDef("BSRK01-R03")!, {
          instanceId: "lv-kenshin",
          ownerPlayerId: opponent,
          zone: "field",
          normalCoreCount: 3,
        }),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 5,
    step: "main",
    window: "none",
    activeContinuousEffects: [
      {
        effectId: "snapshot-bp-minus",
        sourceInstanceId: "lv-komachi",
        sourceDefinitionId: komachi.cardNo,
        actingPlayerId: owner,
        targetInstanceId: "lv-kenshin",
        modifierTag: "bp_modifier",
        modifierAmount: -5000,
        duration: { scope: "turn" },
        createdAtTurn: 5,
        createdAtAttackId: null,
      },
    ],
  };
  // 小町の召喚時発揮宣言から通常のスタック・対象選択・解決へ進める。
  return {
    ...state,
    pendingTriggeredEffects: [
      {
        pendingId: "komachi-summon",
        eventKind: "summon",
        actingPlayerId: owner,
        source: "action_resolution",
        chainId: "komachi-summon-chain",
        attackId: null,
        relatedPlayerId: owner,
        relatedInstanceId: "lv-komachi",
        amount: null,
        step: "main",
        window: "none",
        resolvedSourceInstanceIds: [],
      },
    ],
  };
}
