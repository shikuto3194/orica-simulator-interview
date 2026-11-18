import {
  buildFieldCardEffectLookup,
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  finalizeEffectResolution,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function rebirthLeaveLookups(allCards: CardDefinition[]) {
  const cards = expandCardDefinitionsWithBackFaces(allCards);
  return {
    getCardDefinitionById: (id: string) => cards.find((c) => c.cardNo === id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
    getRegisteredFieldCardEffectActions: buildFieldCardEffectLookup(cards),
    getRegisteredBurstActions: () => [],
  };
}

/** 萃香の実カード効果で3枚を破壊し、太陽の畑の転醒宣言直前へ。 */
export function buildRebirthSimultaneousLeaveScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const lookups = rebirthLeaveLookups(allCards);
  const instance = (
    no: string,
    id: string,
    player: string,
    zone: "field" | "trash",
    cores = 0
  ) =>
    createCardInstance(lookups.getCardDefinitionById(no)!, {
      instanceId: id,
      ownerPlayerId: player,
      zone,
      normalCoreCount: cores,
    });
  const before: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        countValue: id === owner ? 2 : 0,
        reserveNormalCoreCount: 0,
        trashNormalCoreCount: id === owner ? 2 : 0,
      })),
      cardInstances: [
        instance("BSTH02.5-X01", "leave-suika", opponent, "field", 3),
        instance("BSTH04-転醒R02(A)", "leave-sun", owner, "field", 1),
        instance("BSTH04-XX01", "leave-eiki", owner, "field", 2),
        instance(
          params?.get("mode") === "spirit" ? "BSTH04-C01" : "BSTH04-X01",
          "leave-other",
          owner,
          "field",
          1
        ),
        instance("BSTH04-C01", "leave-old-trash", owner, "trash"),
      ],
    }),
    step: "attack",
    activePlayerId: opponent,
    turnNumber: 6,
  };
  const chainId = "scenario:rebirth-simultaneous-leave";
  const state = executeEffect({
    state: before,
    chainId,
    effect: lookups.getCardDefinitionById("BSTH02.5-X01")!.effects![2]!,
    sourceInstanceId: "leave-suika",
    actingPlayerId: opponent,
    targetInstanceIds: ["leave-sun", "leave-eiki", "leave-other"],
    ...lookups,
  });
  return finalizeEffectResolution({
    state,
    beforeState: before,
    chainId,
    endLogs: [],
    actingPlayerId: opponent,
    causedBySourceInstanceId: "leave-suika",
    ...lookups,
  });
}
