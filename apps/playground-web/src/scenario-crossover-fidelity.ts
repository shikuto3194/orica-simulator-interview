import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";
/** 本文どおりの枚数選択と公開残りの移動先を GUI/REST で比較する。 */
export function buildCrossoverFidelityScenario(
  allCards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const kind = params?.get("kind") ?? "reveal";
  const defs = new Map(allCards.map((def) => [def.cardNo, def]));
  const source = defs.get(kind === "count" ? "BSAZ01-C12" : "BSES01-C02")!;
  const effects = source.effects!;
  const effect =
    kind === "count"
      ? effects.find(
          (e) => e.timing.kind === "activated" && e.timing.mode === "main"
        )!
      : effects[2]!;
  const state = createEmptyGameState({
    playerIds: ["alice", "bob"],
    cardInstances: [
      createCardInstance(source, {
        instanceId: "audit-source",
        ownerPlayerId: owner,
        zone: kind === "count" ? "hand" : "field",
        normalCoreCount: kind === "count" ? 0 : 1,
      }),
      ...Array.from({ length: 3 }, (_, i) =>
        createCardInstance(defs.get("BSAZ01-C01")!, {
          instanceId: `audit-deck-${i}`,
          ownerPlayerId: owner,
          zone: "deck",
        })
      ),
    ],
    playerOverrides: ["alice", "bob"].map((id) => ({
      id,
      deckCount: id === owner ? 3 : 0,
      reserveNormalCoreCount: 3,
      soulCoreLocation: null,
    })),
  });
  return executeEffect({
    chainId: "scenario:scenario-crossover-fidelity.ts:49",
    state: { ...state, activePlayerId: owner, step: "main" },
    effect,
    effectIndex: effects.indexOf(effect),
    sourceInstanceId: "audit-source",
    actingPlayerId: owner,
    getCardDefinitionById: (id) => defs.get(id),
    getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(allCards),
  });
}
