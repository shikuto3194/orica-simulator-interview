import {
  createCardInstance,
  createEmptyGameState,
  buildTriggeredEffectLookup,
  queuePendingReactionsFromTriggerEvents,
  executeEffect,
  rebuildContinuousEffectsFromField,
  type CardDefinition,
  type GameState,
} from "@orica/rules-core";

export function buildHandGainCostScenario(
  cards: CardDefinition[],
  params?: URLSearchParams
): GameState {
  const getCardDefinitionById = (id: string) =>
    cards.find((c) => c.cardNo === id);
  const owner = params?.get("owner") === "bob" ? "bob" : "alice";
  const other = owner === "alice" ? "bob" : "alice";
  const draw = params?.get("mode") === "draw";
  const mirror = params?.get("mode") === "mirror";
  const zone = params?.get("mode") === "zone";
  const empty = params?.get("cores") === "zero";
  const field = params?.get("cores") === "field";
  const source = getCardDefinitionById(
    mirror || zone ? "BSTH04-転醒R01(A)" : draw ? "BSTH04-C12" : "BSTH04-C01"
  )!;
  let state: GameState = {
    ...createEmptyGameState({
      playerIds: ["alice", "bob"],
      playerOverrides: ["alice", "bob"].map((id) => ({
        reserveNormalCoreCount: id === owner && !empty && !field ? 1 : 0,
        handCount: 0,
        deckCount: id === owner && !zone ? 3 : 0,
      })),
      cardInstances: [
        createCardInstance(source, {
          instanceId: "source",
          ownerPlayerId: owner,
          zone: draw ? "in_use" : "field",
          normalCoreCount: draw || mirror || zone ? 0 : 2,
        }),
        createCardInstance(getCardDefinitionById("BSRK01-C02")!, {
          instanceId: "tax",
          ownerPlayerId: other,
          zone: "field",
        }),
        ...(field
          ? [
              createCardInstance(getCardDefinitionById("BSRK01-C02")!, {
                instanceId: "supply",
                ownerPlayerId: owner,
                zone: "field",
                normalCoreCount: 1,
              }),
            ]
          : []),
        ...["BSTH04-XX01", "BSTH04-C01", "BSRK01-C01"].map((no, i) =>
          createCardInstance(getCardDefinitionById(no)!, {
            instanceId: ["nexus", "spirit", "rest"][i]!,
            ownerPlayerId: owner,
            zone: zone ? "trash" : "deck",
          })
        ),
      ],
    }),
    activePlayerId: owner,
    step: "main",
  };
  state = rebuildContinuousEffectsFromField(state, getCardDefinitionById);
  if (mirror) {
    const queued = queuePendingReactionsFromTriggerEvents(
      state,
      [
        {
          actingPlayerId: owner,
          eventKind: "place",
          source: "action_resolution",
          chainId: "scenario-mirror",
          attackId: null,
          relatedPlayerId: owner,
          relatedInstanceId: "source",
          amount: 1,
        },
      ],
      undefined,
      {
        getCardDefinitionById,
        getRegisteredTriggeredEffectActions: buildTriggeredEffectLookup(cards),
        getRegisteredBurstActions: undefined,
      }
    );
    // バーストを持たない盤面。配置時の任意発揮から検証を始める。
    return { ...queued, pendingBurstChecks: [] };
  }
  return executeEffect({
    chainId: "scenario:scenario-hand-gain-cost.ts:96",
    state,
    effect: zone
      ? {
          timing: { kind: "activated", mode: "main" },
          steps: [
            {
              action: {
                kind: "search_zone",
                zone: "trash",
                destination: "hand",
                count: 1,
                mandatory: true,
              },
            },
          ],
        }
      : source.effects![draw ? 0 : 1]!,
    effectIndex: draw ? 0 : 1,
    sourceInstanceId: "source",
    actingPlayerId: owner,
    getCardDefinitionById,
    getRegisteredTriggeredEffectActions: () => [],
  });
}
