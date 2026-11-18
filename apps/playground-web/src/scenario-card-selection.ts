import {
  createCardInstance,
  createEmptyGameState,
  executeEffect,
  buildTriggeredEffectLookup,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildCardSelectionScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const mode = params?.get("mode") ?? "exclude";
  const getDefinition = (id: string) =>
    cards.find((card) => card.cardNo === id);
  const source = getDefinition(
    mode === "payment" ? "BSTH01-C04" : "BSTH01-C01"
  )!;
  const candidate = getDefinition("BSSL01-C01")!;
  const mixed = mode === "mixed";
  const draw = mode === "draw";
  const battle = mode === "battle";
  const state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map(() => ({
        reserveNormalCoreCount: 20,
        deckCount: draw ? 3 : 0,
      })),
      cardInstances: [
        ...(mode === "payment"
          ? [
              createCardInstance(getDefinition("BSTH01-C01")!, {
                instanceId: "selection-donor",
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 3,
              }),
            ]
          : []),
        createCardInstance(source, {
          instanceId: "selection-source",
          ownerPlayerId: owner,
          zone: battle || draw || mode === "grouped" ? "field" : "hand",
          normalCoreCount: battle || draw || mode === "grouped" ? 1 : 0,
        }),
        ...["a", "b", "c"].map((suffix, index) =>
          createCardInstance(candidate, {
            instanceId: `selection-${suffix}`,
            ownerPlayerId: owner,
            zone: battle
              ? "field"
              : draw || (mixed && index === 0)
                ? "hand"
                : mixed
                  ? "set_aside"
                  : "trash",
            normalCoreCount: battle ? 1 : 0,
          })
        ),
        ...(draw
          ? [0, 1, 2].map((index) =>
              createCardInstance(source, {
                instanceId: `selection-deck-${index}`,
                ownerPlayerId: owner,
                zone: "deck",
              })
            )
          : []),
      ],
    }),
    activePlayerId: owner,
    turnNumber: 3,
    step: battle ? "attack" : draw ? "draw" : "main",
  };
  if (battle)
    return executeEffect({
      state,
      chainId: "scenario:card-selection-battle",
      actingPlayerId: owner,
      sourceInstanceId: "selection-source",
      getCardDefinitionById: getDefinition,
      getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
      effect: {
        timing: { kind: "activated", mode: "main" },
        steps: [
          {
            action: {
              kind: "require_battle_destroy_cost",
              target: {
                kind: "filter",
                player: "self",
                filter: { category: ["spirit"] },
                count: "all",
              },
              restriction: ["attack", "block"],
              costTargetFilter: { category: ["spirit"] },
              duration: { scope: "turn" },
            },
          },
        ],
      },
    });
  if (draw) {
    state.pendingDrawStepCostChoice = {
      pendingId: "selection-draw",
      actingPlayerId: owner,
      resolvedBonus: 0,
      entries: [1, 2].map((bonus) => ({
        sourceInstanceId: "selection-source",
        sourceDefinitionId: source.cardNo,
        effectIndex: bonus,
        candidateCardInstanceIds: ["selection-a", "selection-b", "selection-c"],
        cardFilter: { tribes: ["影", "プレイヤー"] },
        bonus,
      })),
    };
  } else if (mode === "grouped") {
    state.cardInstances.push(
      createCardInstance(source, {
        instanceId: "selection-summon",
        ownerPlayerId: owner,
        zone: "hand",
      })
    );
    state.pendingGroupedSummonCostOverrideChoice = {
      pendingId: "selection-grouped",
      chainId: "scenario:card-selection",
      actingPlayerId: owner,
      sourceInstanceId: "selection-source",
      sourceDefinitionId: source.cardNo,
      summonTargetInstanceIds: ["selection-summon"],
      candidateCardInstanceIds: ["selection-a", "selection-b", "selection-c"],
      maxCount: 2,
      groupSize: 2,
      overrideCost: 0,
    };
  } else {
    state.pendingSummonCostExcludeChoice = {
      pendingId: "selection-exclude",
      actingPlayerId: owner,
      sourceInstanceId: "selection-source",
      sourceDefinitionId: source.cardNo,
      effectIndex: 0,
      candidateCardInstanceIds: ["selection-a", "selection-b", "selection-c"],
      maxCount: 2,
      minCount: mixed ? 2 : 0,
      discountPerCard: 1,
      sourceZone: mixed ? "hand_or_set_aside" : "trash",
      ...(mixed ? { fullCostPaid: true } : {}),
    };
  }
  return state;
}
