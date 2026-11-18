import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** BSLH01-C05の任意確認から、破壊後の強制処理までを実行する。 */
export function buildMandatoryFollowupScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const definitions = new Map(allCards.map((card) => [card.cardNo, card]));
  const source = definitions.get("BSLH01-C05")!;
  const base = createEmptyGameState({ playerIds: ["alice", "bob"] });
  return executeEffect({
    chainId: "scenario:scenario-mandatory-followup.ts:19",
    state: {
      ...base,
      activePlayerId: owner,
      turnNumber: 3,
      step: "main",
      players: base.players.map((player) =>
        player.id === owner
          ? {
              ...player,
              countValue: 2,
              trashNormalCoreCount: 5,
              trashSoulCoreCount: 1,
              reserveNormalCoreCount: 0,
              reserveSoulCoreCount: 0,
              soulCoreLocation: { kind: "trash" as const },
            }
          : player
      ),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "followup-source",
          ownerPlayerId: owner,
          zone: "field",
          normalCoreCount: 1,
        }),
        createCardInstance(definitions.get("BSLH01-C06")!, {
          instanceId: "followup-target",
          ownerPlayerId: opponent,
          zone: "field",
          normalCoreCount: 1,
        }),
      ],
    },
    effect: source.effects![0]!,
    effectIndex: 0,
    sourceInstanceId: "followup-source",
    actingPlayerId: owner,
    choiceIndex: 0,
    getCardDefinitionById: (id) => definitions.get(id),
    getRegisteredTriggeredEffectActions: () => [],
  });
}
