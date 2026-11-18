import {
  buildTriggeredEffectLookup,
  createCardInstance,
  createEmptyGameState,
  executeEffect,
} from "@orica/rules-core";
import type { CardDefinition, GameState } from "@orica/rules-core";

/** 宣言後の効果本文から、同じコアHUDで全移動元を選ぶ。 */
export function buildCoreSourceUnionScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const opponent = owner === "alice" ? "bob" : "alice";
  const sourceNo = params?.get("card") ?? "BSTH02-X01";
  const map = new Map(allCards.map((card) => [card.cardNo, card]));
  const definition = map.get(sourceNo)!;
  const effectIndex =
    sourceNo === "BSTH02-X01" ? 1 : sourceNo === "BSTH02.7-X02" ? 3 : 0;
  const rows = [
    [
      "source",
      sourceNo,
      sourceNo === "BSTH11-X02" ? "hand" : "field",
      owner,
      sourceNo === "BSTH11-X02" ? 0 : 2,
    ],
    ["own", "BSTH001-R01", "field", owner, 1],
    ["opponent", "BSTH001-R01", "field", opponent, 1],
    ["guided", "BSTH01-XX01", "field", owner, 2],
    ["grandwalker", "BSTH11-X01", "field", owner, 2],
    ["deck-1", "BSTH001-R01", "deck", owner, 0],
    ["deck-2", "BSTH001-R01", "deck", owner, 0],
    ["deck-3", "BSTH001-R01", "deck", owner, 0],
  ] as const;
  let state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: rows.map(([id, no, zone, player, normalCoreCount]) =>
      createCardInstance(map.get(no)!, {
        instanceId: `sc-core-union-${id}`,
        ownerPlayerId: player,
        zone,
        normalCoreCount,
      })
    ),
    playerOverrides: ["alice", "bob"].map((id) => ({
      reserveNormalCoreCount: 5,
      voidNormalCoreCount: 30,
      lifeNormalCoreCount: 4,
      deckCount: id === owner ? 3 : 0,
      handCount: id === owner && sourceNo === "BSTH11-X02" ? 1 : 0,
      ...(id === owner && sourceNo === "BSTH11-X02"
        ? {
            soulCoreLocation: { kind: "life" as const },
            reserveSoulCoreCount: 0,
            lifeSoulCoreCount: 1,
          }
        : {}),
    })),
  });
  state = { ...state, activePlayerId: owner, step: "main", turnNumber: 4 };
  if (params?.get("stage") === "before") return state;
  return executeEffect({
    chainId: "scenario:scenario-core-source-union.ts:64",
    state,
    effect: definition.effects![effectIndex]!,
    effectIndex,
    sourceInstanceId: "sc-core-union-source",
    actingPlayerId: owner,
    getCardDefinitionById: (id) => map.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
    optionalExecuteResumeStepIndex: 0,
  });
}
