import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  expandCardDefinitionsWithBackFaces,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

/** Actual BSTH09-TR01(B) reveal, before choosing an entrant. */
export function buildEffectEntryCoreChoiceScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const definitions = expandCardDefinitionsWithBackFaces(cards);
  const lookup = (id: string) => definitions.find((d) => d.cardNo === id);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  if (params?.get("mode") === "separation") {
    const sourceDef = lookup("BSAZ03-C01")!;
    const state: GameState = {
      ...createEmptyGameState({
        playerIds: ["alice", "bob"],
        cardInstances: [
          createCardInstance(sourceDef, {
            instanceId: "separation-source",
            ownerPlayerId: owner,
            zone: "hand",
          }),
          createCardInstance(lookup("BSKB01-TX01(B)")!, {
            instanceId: "entry-host",
            ownerPlayerId: owner,
            zone: "field",
            normalCoreCount: 3,
            attachedChildrenIds: ["separation-brave"],
          }),
          createCardInstance(lookup("BSAZ01-CX01")!, {
            instanceId: "separation-brave",
            ownerPlayerId: owner,
            zone: "field",
            attachedToInstanceId: "entry-host",
          }),
        ],
        playerOverrides: ["alice", "bob"].map((id) => ({
          id,
          reserveNormalCoreCount: 4,
          reserveSoulCoreCount: id === owner ? 1 : 0,
          soulCoreLocation: id === owner ? { kind: "reserve" as const } : null,
        })),
      }),
      activePlayerId: owner,
      step: "main",
    };
    return executeEffect({
      state,
      chainId: "scenario:separation-core-choice",
      effect: sourceDef.effects![2]!,
      effectIndex: 2,
      sourceInstanceId: "separation-source",
      actingPlayerId: owner,
      choiceIndex: 2,
      getCardDefinitionById: lookup,
      getRegisteredTriggeredEffectActions:
        buildTriggeredEffectLookup(definitions),
    });
  }
  const braveDef = lookup("BSTH09-TR01(B)")!;
  const host = createCardInstance(lookup("BSKB01-TX01(B)")!, {
    instanceId: "entry-host",
    ownerPlayerId: owner,
    zone: "field",
    normalCoreCount: 3,
    attachedChildrenIds: ["entry-brave"],
  });
  const brave = createCardInstance(braveDef, {
    instanceId: "entry-brave",
    ownerPlayerId: owner,
    zone: "field",
    attachedToInstanceId: host.instanceId,
  });
  const deck = Array.from({ length: 8 }, (_, i) =>
    createCardInstance(lookup("BSAZ01-C01")!, {
      instanceId: `entry-deck-${i}`,
      ownerPlayerId: owner,
      zone: "deck",
    })
  );
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      cardInstances: [host, brave, ...deck],
      playerOverrides: ["alice", "bob"].map((id) => ({
        id,
        countValue: id === owner ? 2 : 0,
        reserveNormalCoreCount: 4,
        reserveSoulCoreCount: id === owner ? 1 : 0,
        soulCoreLocation: id === owner ? { kind: "reserve" as const } : null,
      })),
    }),
    activePlayerId: owner,
    step: "attack",
  };
  return executeEffect({
    state,
    chainId: "scenario:entry-core-choice",
    effect: braveDef.effects![1]!,
    effectIndex: 1,
    sourceInstanceId: brave.instanceId,
    actingPlayerId: owner,
    getCardDefinitionById: lookup,
    getRegisteredTriggeredEffectActions:
      buildTriggeredEffectLookup(definitions),
  });
}
